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
    ("note", "Write down the values you READ on the current screenshot (exactly as displayed), to use them later on "
             "another page. You only see the current screen: anything not noted is forgotten.", {"text": "string"}),
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


TEXT_AT = """([x, y]) => {
  const el = document.elementFromPoint(x, y);
  if (!el) return '';
  const t = el.closest('input,textarea,a,td,th,li,span,div,p,h1,h2,h3,b,strong') || el;
  return String(t.value ?? t.innerText ?? '').trim().split('\\n')[0].slice(0, 300);
}"""

ELEMENT_AT = """([x, y]) => {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  const t = el.closest('button,a,input,select,textarea,label,li,td,th,[role=button]') || el;
  const txt = (t.innerText || t.value || t.getAttribute('aria-label') || t.placeholder || t.name || '').trim();
  return {tag: t.tagName.toLowerCase(), text: txt.slice(0, 80)};
}"""


def run_agent(url: str, mission: str, out_dir: Path, model: str, max_steps: int = 30,
              init_script: str | None = None, on_event=None, progress_fn=None, done_guard=None,
              hints: str = "", subtasks: list[dict] | None = None) -> dict:
    """progress_fn(state) -> texte d'avancement montré à Holo à chaque étape ;
    done_guard(state) -> raison de refuser « fini » (ou None) ; hints : conseils tirés de l'essai précédent."""
    """Rejoue `mission` dans le jumeau servi à `url`. Renvoie stats, issue et état final du jumeau.
    subtasks : [{mission, progress_fn, done_guard, max_steps}] exécutées l'une après l'autre dans la MÊME page,
    chacune avec un historique neuf (un « sous-agent » par sous-tâche)."""
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
    refusals = 0
    clipboard = ""
    notes: list[str] = []  # mémoire de travail de Holo : il ne voit que l'écran courant
    read_state = "() => (window.__twinState ? window.__twinState() : null)"
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        ctx = browser.new_context(viewport={"width": VIEW_W, "height": VIEW_H})
        if init_script:
            ctx.add_init_script(init_script)
        page = ctx.new_page()
        page.on("dialog", lambda d: d.dismiss() if FORBIDDEN.search(d.message) else d.accept())
        page.goto(url)
        page.wait_for_timeout(800)
        plan = subtasks or [{"mission": mission, "progress_fn": progress_fn, "done_guard": done_guard, "max_steps": max_steps}]
        step = 0
        sub_results = []
        for k, sub in enumerate(plan, 1):
          mission, progress_fn, done_guard = sub["mission"], sub.get("progress_fn"), sub.get("done_guard")
          history, refusals, sub_done = [], 0, None
          emit("subtask", text=f"sous-tâche {k}/{len(plan)}")
          for _ in range(sub.get("max_steps", max_steps)):
            step += 1
            shot = out_dir / f"{step:02d}.jpg"
            page.screenshot(path=str(shot), type="jpeg", quality=70)
            wait = gap - (time.time() - last_call)
            if wait > 0:
                time.sleep(wait)
            progress = ""
            if progress_fn:
                try:
                    progress = "\n\n## Progress of the table (checked by the system)\n" + progress_fn(page.evaluate(read_state))
                except Exception:  # noqa: BLE001
                    progress = ""
            mem = ("\n\n## Your notes (values you read earlier)\n" + "\n".join(f"- {n}" for n in notes[-12:])) if notes else ""
            prompt = (mission + (f"\n\n## Advice from the previous attempt\n{hints}" if hints else "") + progress + mem +
                      "\n\n## What you already did\n" + ("\n".join(history[-12:]) or "(nothing yet)") +
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
            if name == "done" and done_guard and refusals < 2:
                why = done_guard(page.evaluate(read_state))
                if why:
                    refusals += 1
                    stats["done_refused"] = refusals
                    history.append(f"{step}. done REFUSED by the system: {why}")
                    emit("refused", step=step, text=why)
                    continue
            if name == "done":
                sub_done = bool(args.get("success"))
                summary = (summary + " | " if summary else "") + str(args.get("summary", ""))
                emit("done", step=step, text=str(args.get("summary", "")))
                break
            if name == "note":
                notes.append(str(args.get("text", ""))[:300])
                history.append(f"{step}. note -> saved")
                emit("note", step=step, text=notes[-1])
                continue
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
                elif name == "copy_text":
                    clipboard = page.evaluate(TEXT_AT, [px, py]) or ""
                    args["copied"] = clipboard[:80]
                elif name == "paste":
                    page.mouse.click(px, py)
                    page.keyboard.press("ControlOrMeta+A")
                    page.keyboard.press("Backspace")
                    page.keyboard.insert_text(clipboard)
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
          sub_results.append(sub_done)
          outcome = "done" if all(r is not None for r in sub_results) else "max_steps"
          claimed_success = all(bool(r) for r in sub_results)
        try:
            state = page.evaluate(read_state)
        except Exception:  # noqa: BLE001
            state = None
        page.screenshot(path=str(out_dir / "final.jpg"), type="jpeg", quality=70)
        browser.close()
    stats["holo_seconds"] = round(stats["holo_seconds"], 1)
    stats["seconds"] = round(time.time() - t0, 1)
    return {"outcome": outcome, "claimed_success": claimed_success, "summary": summary, "state": state,
            "stats": stats, "history": history}
