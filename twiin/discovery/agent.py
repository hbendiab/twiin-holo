"""Agent Holo générique, piloté dans le JUMEAU (jamais sur l'outil réel de l'employé).

Boucle : capture -> Holo choisit UNE action -> exécution -> ... jusqu'à `done` ou max_steps.
Garde-fou : un clic sur un libellé irréversible (valider, envoyer, payer, supprimer…) est bloqué.
"""
import base64
import json
import os
import re
import time
from pathlib import Path

from openai import OpenAI

HOLO_BASE_URL = "https://api.hcompany.ai/v1/"
FREE_MODELS = {"holo3-1-35b-a3b"}          # gratuit : 10 requêtes / minute
FREE_GAP = 6.5
VIEW_W, VIEW_H = 1280, 800
FORBIDDEN = re.compile(r"\b(valider|validate|payer|pay|acheter|buy|commander|order|envoyer|send|transmettre|supprimer|delete)\b", re.I)

TOOLS_SPEC = [
    ("click", "Click on the element at (x, y).", {"x": "integer", "y": "integer"}),
    ("type_text", "Click the input field or cell at (x, y), clear it, then type the text.", {"x": "integer", "y": "integer", "text": "string"}),
    ("press_key", "Press a keyboard key (Enter, Tab, Escape...).", {"key": "string"}),
    ("scroll", "Scroll the page (direction: up or down).", {"direction": "string"}),
    ("done", "The task is finished, or impossible. Summarize what was done.", {"summary": "string", "success": "boolean"}),
]


def _tools():
    out = []
    for name, desc, props in TOOLS_SPEC:
        p = {k: {"type": v} for k, v in props.items()}
        p["reason"] = {"type": "string", "description": "One short sentence, in French: what you see and why you do this."}
        if "x" in p:
            p["x"]["description"] = p["y"]["description"] = "Coordinate normalized 0-1000 on the screenshot"
        out.append({"type": "function", "function": {"name": name, "description": desc,
                                                     "parameters": {"type": "object", "properties": p, "required": list(p)}}})
    return out


ELEMENT_AT = """([x, y]) => {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  const t = el.closest('button,a,input,select,textarea,label,li,td,th,[role=button]') || el;
  const txt = (t.innerText || t.value || t.getAttribute('aria-label') || t.placeholder || t.name || '').trim();
  return {tag: t.tagName.toLowerCase(), text: txt.slice(0, 80)};
}"""


def run_agent(url: str, mission: str, out_dir: Path, model: str, max_steps: int = 30,
              init_script: str | None = None, on_event=None) -> dict:
    """Rejoue `mission` dans le jumeau servi à `url`. Renvoie stats, issue et état final du jumeau."""
    from playwright.sync_api import sync_playwright
    out_dir.mkdir(parents=True, exist_ok=True)
    client = OpenAI(base_url=HOLO_BASE_URL, api_key=os.environ["HAI_API_KEY"])
    emit = on_event or (lambda *a, **k: None)
    history: list[str] = []
    stats = {"model": model, "calls": 0, "prompt_tokens": 0, "completion_tokens": 0, "holo_seconds": 0.0,
             "blocked": 0, "errors": 0}
    outcome, claimed_success, summary = "max_steps", None, ""
    last_call, t0 = 0.0, time.time()
    gap = FREE_GAP if model in FREE_MODELS else 0.5
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        ctx = browser.new_context(viewport={"width": VIEW_W, "height": VIEW_H})
        if init_script:
            ctx.add_init_script(init_script)
        page = ctx.new_page()
        page.on("dialog", lambda d: d.dismiss() if FORBIDDEN.search(d.message) else d.accept())
        page.goto(url)
        page.wait_for_timeout(800)
        for step in range(1, max_steps + 1):
            shot = out_dir / f"{step:02d}.jpg"
            page.screenshot(path=str(shot), type="jpeg", quality=70)
            wait = gap - (time.time() - last_call)
            if wait > 0:
                time.sleep(wait)
            prompt = (mission + "\n\n## What you already did\n" + ("\n".join(history[-12:]) or "(nothing yet)") +
                      "\n\nLook at the screenshot and call exactly ONE tool for the next action.")
            uri = "data:image/jpeg;base64," + base64.b64encode(shot.read_bytes()).decode()
            resp = None
            for attempt in range(4):
                try:
                    last_call = time.time()
                    resp = client.chat.completions.create(
                        model=model, tools=_tools(), tool_choice="required",
                        messages=[{"role": "user", "content": [{"type": "image_url", "image_url": {"url": uri}},
                                                               {"type": "text", "text": prompt}]}])
                    break
                except Exception as e:  # noqa: BLE001
                    if "429" in str(e) and attempt < 3:
                        time.sleep(30)
                        continue
                    raise
            took = time.time() - last_call
            u = getattr(resp, "usage", None)
            stats["calls"] += 1
            stats["holo_seconds"] += took
            stats["prompt_tokens"] += getattr(u, "prompt_tokens", 0) or 0
            stats["completion_tokens"] += getattr(u, "completion_tokens", 0) or 0
            calls = resp.choices[0].message.tool_calls or []
            if not calls:
                history.append(f"{step}. (no action)")
                continue
            name = calls[0].function.name
            try:
                args = json.loads(calls[0].function.arguments or "{}")
            except json.JSONDecodeError:
                args = {}
            if name == "done":
                outcome, claimed_success, summary = "done", bool(args.get("success")), str(args.get("summary", ""))
                emit("done", step=step, text=summary)
                break
            px = py = None
            info = None
            if "x" in args and "y" in args:
                px = max(0, min(VIEW_W - 1, round(int(args["x"]) / 1000 * VIEW_W)))
                py = max(0, min(VIEW_H - 1, round(int(args["y"]) / 1000 * VIEW_H)))
                info = page.evaluate(ELEMENT_AT, [px, py])
            emit("action", step=step, action=name, text=args.get("reason", ""))
            if name == "click" and info and FORBIDDEN.search(info.get("text", "")):
                stats["blocked"] += 1
                history.append(f"{step}. BLOCKED: clicking '{info.get('text')}' is an irreversible action and is forbidden.")
                continue
            try:
                if name == "click":
                    page.mouse.click(px, py)
                elif name == "type_text":
                    page.mouse.click(px, py)
                    page.keyboard.press("ControlOrMeta+A")
                    page.keyboard.press("Backspace")
                    page.keyboard.type(str(args.get("text", "")), delay=30)
                elif name == "press_key":
                    page.keyboard.press(str(args.get("key", "Enter")))
                elif name == "scroll":
                    page.mouse.wheel(0, 500 if "down" in str(args.get("direction", "down")).lower() else -500)
                page.wait_for_timeout(700)
                where = f" on {info['tag']} '{info['text'][:40]}'" if info else ""
                shown = {k: v for k, v in args.items() if k != "reason"}
                history.append(f"{step}. {name} {json.dumps(shown, ensure_ascii=False)}{where} -> ok")
            except Exception as e:  # noqa: BLE001
                stats["errors"] += 1
                history.append(f"{step}. {name} failed: {str(e)[:100]}")
        try:
            state = page.evaluate("() => (window.__twinState ? window.__twinState() : null)")
        except Exception:  # noqa: BLE001
            state = None
        page.screenshot(path=str(out_dir / "final.jpg"), type="jpeg", quality=70)
        browser.close()
    stats["holo_seconds"] = round(stats["holo_seconds"], 1)
    stats["seconds"] = round(time.time() - t0, 1)
    return {"outcome": outcome, "claimed_success": claimed_success, "summary": summary, "state": state,
            "stats": stats, "history": history}
