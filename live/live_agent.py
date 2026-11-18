#!/usr/bin/env python3
"""Twiin Live — regarder un agent Holo saisir une facture dans comptarex, étape par étape.

Ce qui se passe à chaque tour de boucle :
  1. 📸 on prend une capture d'écran du navigateur
  2. 🧠 on l'envoie à Holo avec la tâche et l'historique
  3. 🎯 Holo répond par UNE action (cliquer / écrire / choisir / touche / défiler / terminer) + sa raison
  4. 🛡️ garde-fou : un clic sur « Valider », « Payer », « Envoyer »… est bloqué
  5. ▶️ on exécute l'action dans la vraie fenêtre (un point rouge montre où il clique)
  6. ➡️ si l'URL change, on le signale (nouvelle page)

Tu vois tout en même temps dans :
  - la fenêtre Chromium qui s'ouvre (l'agent la pilote) ;
  - la page de suivi http://localhost:8100 (captures, cibles, raisons, navigation).

    .venv/bin/python live/live_agent.py                     # INV-002, comptarex local
    .venv/bin/python live/live_agent.py --invoice INV-005 --reset
    .venv/bin/python live/live_agent.py --skill capture/backend/data/recordings/<id>/skill.md

Connexion : le script se connecte lui-même avec les identifiants de comptarex/.env (comme un coffre-fort).
L'agent ne voit jamais le mot de passe. Données fictives uniquement.
"""
from __future__ import annotations

import argparse
import base64
import csv
import json
import os
import re
import subprocess
import sys
import threading
import time
import webbrowser
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LIVE = Path(__file__).resolve().parent
COMPTAREX = ROOT / "comptarex"

try:
    from dotenv import dotenv_values
    from openai import OpenAI
    from playwright.sync_api import sync_playwright
    import uvicorn
    from fastapi import FastAPI
    from fastapi.responses import FileResponse
    from fastapi.staticfiles import StaticFiles
except ImportError as e:
    sys.exit(f"Dépendance manquante ({e.name}) : .venv/bin/pip install -r live/requirements.txt "
             "&& .venv/bin/python -m playwright install chromium")

HOLO_BASE_URL = "https://api.hcompany.ai/v1/"
DEFAULT_MODEL = "holo3-1-35b-a3b"          # gratuit, 10 requêtes / minute
MIN_SECONDS_BETWEEN_CALLS = 6.5            # reste sous la limite gratuite
VIEW_W, VIEW_H = 1280, 800
FORBIDDEN = re.compile(r"\b(valider|validate|payer|pay|envoyer|send|transmettre|supprimer|delete)\b", re.I)


# ---------------------------------------------------------------- journal d'événements (lu par la page)

class Feed:
    def __init__(self, run_dir: Path):
        self.run_dir = run_dir
        self.events: list[dict] = []
        self.lock = threading.Lock()
        self.t0 = time.time()

    def add(self, kind: str, **data) -> dict:
        with self.lock:
            ev = {"n": len(self.events), "kind": kind, "t": round(time.time() - self.t0, 1), **data}
            self.events.append(ev)
            (self.run_dir / "events.json").write_text(json.dumps(self.events, ensure_ascii=False, indent=1))
        label = data.get("text") or data.get("reason") or data.get("url") or ""
        print(f"[{ev['t']:6.1f}s] {kind:<11} {str(label)[:120]}", flush=True)
        return ev

    def since(self, n: int) -> list[dict]:
        with self.lock:
            return self.events[n:]


def free_port(port: int) -> int:
    import socket
    for p in range(port, port + 20):
        with socket.socket() as s:
            if s.connect_ex(("127.0.0.1", p)) != 0:
                return p
    return port


class ReplayFeed(Feed):
    """Rejoue un run passé (events.json) au rythme d'origine, sans appeler Holo."""
    def __init__(self, run_dir: Path, speed: float = 1.0):
        super().__init__(run_dir)
        self.saved = json.loads((run_dir / "events.json").read_text())
        self.speed = speed

    def since(self, n: int) -> list[dict]:
        elapsed = (time.time() - self.t0) * self.speed
        return [e for e in self.saved if e["t"] <= elapsed][n:]


def run_summary(run_dir: Path) -> dict | None:
    """Temps de saisie d'un run, recalculé depuis son journal : de la 1re capture au brouillon enregistré."""
    try:
        ev = json.loads((run_dir / "events.json").read_text())
    except (OSError, ValueError):
        return None
    task = next((e for e in ev if e["kind"] == "task"), {})
    m = re.search(r"INV-\d+", task.get("text", ""))
    start = next((e["t"] for e in ev if e["kind"] == "capture"), None)
    draft = next((e["t"] for e in ev if e["kind"] == "draft"), None)
    verify = next((e for e in ev if e["kind"] == "verify"), None)
    stats = next((e for e in ev if e["kind"] == "stats"), {})
    end = draft if draft is not None else (verify or {}).get("t", ev[-1]["t"] if ev else None)
    steps = sum(e["kind"] == "decision" for e in ev)
    seconds = round(end - start, 1) if start is not None and end is not None else None
    return {"run": run_dir.name, "invoice": m.group(0) if m else "?", "vision": stats.get("vision", "full"),
            "ok": bool(verify and verify.get("ok")), "finished": verify is not None,
            "seconds": seconds, "steps": steps, "per_step": round(seconds / steps, 1) if seconds and steps else None,
            "holo_seconds": stats.get("holo_seconds"), "calls": stats.get("calls")}


def start_server(feed: Feed, port: int) -> None:
    app = FastAPI()
    app.mount("/run", StaticFiles(directory=feed.run_dir), name="run")

    @app.get("/")
    def index():
        return FileResponse(LIVE / "live.html")

    @app.get("/history")
    def history():
        runs = [run_summary(d) for d in sorted((LIVE / "runs").iterdir(), reverse=True) if d.is_dir()]
        return [r for r in runs if r and r["finished"]]

    @app.get("/events")
    def events(since: int = 0):
        return feed.since(since)

    cfg = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning")
    threading.Thread(target=uvicorn.Server(cfg).run, daemon=True).start()


# ---------------------------------------------------------------- tâche

def invoice_task(invoice_id: str) -> tuple[str, dict]:
    rows = {r["invoice_id"]: r for r in csv.DictReader((COMPTAREX / "data" / "verite_terrain_factures.csv").open(encoding="utf-8"))}
    inv = rows[invoice_id]
    lines = json.loads((LIVE / "invoice_lines.json").read_text())[invoice_id]
    lines_txt = "\n".join(f"   - Line {i}: Libellé '{l}', Quantité {q}, Prix unitaire HT {pu}, Taxe '{tx}'"
                          for i, (l, q, pu, tx) in enumerate(lines, 1))
    task = (
        f"You are in QONTA, an old accounting web app. Enter the supplier invoice {invoice_id} as a DRAFT.\n"
        f"1. If you are on the folder list, open the folder '00417 ATELIER DORN SAS'.\n"
        f"2. Open a new supplier invoice: menu 'Saisie' > 'Factures fournisseurs' > 'Nouvelle facture', "
        f"or 'Factures à traiter' then 'Saisir' next to {invoice_id}.\n"
        f"3. Fill the form with this invoice data:\n"
        f"   - Fournisseur: {inv['fournisseur']} (type the first letters, then CLICK the matching name in the suggestion list)\n"
        f"   - Référence fournisseur: {inv['numero_facture']}\n"
        f"   - Date de facture: {inv['date']} (format DD/MM/YYYY)\n"
        f"{lines_txt}\n"
        f"   (if there are several lines, click the button to add a line before filling the next one)\n"
        f"4. Check the totals (HT {inv['total_ht']}, TVA {inv['total_tva']}), then click 'Enregistrer le brouillon'. "
        f"NEVER click 'Valider'.\n"
        f"5. Call done ONLY after you see the confirmation 'Brouillon enregistré'. If an error message appears, fix it.\n"
        f"Before each action, check the screenshot: if a field already has the right value, move on.\n"
        f"type_text clicks the field by itself: do NOT click a field before typing in it."
    )
    return task, inv


TOOLS_SPEC = [
    ("click", "Click on the element at (x, y).", {"x": "integer", "y": "integer"}),
    ("type_text", "Click the input field at (x, y), clear it, then type the text.", {"x": "integer", "y": "integer", "text": "string"}),
    ("select_option", "Choose an option in a dropdown list (<select>, e.g. 'Taxe') at (x, y). Never use click on a dropdown.", {"x": "integer", "y": "integer", "option": "string"}),
    ("press_key", "Press a keyboard key (Enter, Tab, Escape, ArrowDown...).", {"key": "string"}),
    ("scroll", "Scroll the page.", {"direction": "string"}),
    ("full_view", "The screenshot is a zoomed part of the screen and what you need is not visible: ask for the full screen.", {}),
    ("done", "The task is finished (draft saved) or impossible. Summarize what was done.", {"summary": "string", "success": "boolean"}),
]


def tools() -> list[dict]:
    out = []
    for name, desc, props in TOOLS_SPEC:
        p = {k: {"type": v} for k, v in props.items()}
        p["reason"] = {"type": "string", "description": "One short sentence, in French: what you see and why you do this."}
        if "x" in p:
            p["x"]["description"] = p["y"]["description"] = "Coordinate normalized 0-1000 on the screenshot"
        out.append({"type": "function", "function": {"name": name, "description": desc,
                                                     "parameters": {"type": "object", "properties": p, "required": list(p)}}})
    return out


# ---------------------------------------------------------------- navigateur

ELEMENT_AT = """([x, y]) => {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  const t = el.closest('button,a,input,select,textarea,label,li,[role=option],[role=menuitem],td') || el;
  const lab = (t.labels && t.labels[0] && t.labels[0].innerText) || '';
  const txt = (t.innerText || t.value || t.getAttribute('aria-label') || t.getAttribute('title') || lab || t.name || t.placeholder || '').trim();
  return {tag: t.tagName.toLowerCase(), text: txt.slice(0, 80), label: lab.trim().slice(0, 60),
          name: t.getAttribute('name') || '', value: (t.getAttribute('value') || '')};
}"""

SHOW_DOT = """([x, y, color]) => {
  const d = document.createElement('div');
  d.style.cssText = `position:fixed;left:${x-14}px;top:${y-14}px;width:28px;height:28px;border-radius:50%;` +
    `border:4px solid ${color};background:${color}33;z-index:2147483647;pointer-events:none;transition:opacity .6s`;
  document.body.appendChild(d);
  setTimeout(() => d.style.opacity = '0', 1100); setTimeout(() => d.remove(), 1800);
}"""

SET_SELECT = """([x, y, option]) => {
  const el = document.elementFromPoint(x, y);
  const s = el && (el.closest('select') || el.parentElement?.querySelector('select'));
  if (!s) return null;
  const norm = (v) => v.toLowerCase().replace(/\\s+/g, ' ').trim();
  const o = [...s.options].find((o) => norm(o.text) === norm(option)) || [...s.options].find((o) => norm(o.text).includes(norm(option)));
  if (!o) return {error: 'options: ' + [...s.options].map((o) => o.text).join(' | ')};
  s.value = o.value; s.dispatchEvent(new Event('input', {bubbles: true})); s.dispatchEvent(new Event('change', {bubbles: true}));
  return {chosen: o.text};
}"""


ACTIVE_AREA = """() => {
  const a = document.activeElement;
  if (!a || a === document.body) return null;
  const box = a.closest('form, [role=dialog], dialog, .fenetre, .window, main, table') || a;
  const r = box.getBoundingClientRect();
  return [r.left, r.top, r.right, r.bottom];
}"""
FOCUS_MIN_W, FOCUS_MIN_H, FOCUS_PAD = 640, 400, 40


def focus_box(area, point) -> tuple[int, int, int, int] | None:
    """Zone d'intérêt = fenêtre de travail du champ actif ∪ dernier point d'action, avec une marge.
    None = envoyer tout l'écran."""
    if not area:
        return None  # pas de champ actif (page de liste, menu…) : on garde tout le contexte
    boxes = [tuple(area)]
    if point:
        boxes.append((point[0] - 150, point[1] - 100, point[0] + 150, point[1] + 100))
    if not boxes:
        return None
    l = min(b[0] for b in boxes) - FOCUS_PAD
    t = min(b[1] for b in boxes) - FOCUS_PAD
    r = max(b[2] for b in boxes) + FOCUS_PAD
    b_ = max(b[3] for b in boxes) + FOCUS_PAD
    if r - l < FOCUS_MIN_W:
        c = (l + r) / 2; l, r = c - FOCUS_MIN_W / 2, c + FOCUS_MIN_W / 2
    if b_ - t < FOCUS_MIN_H:
        c = (t + b_) / 2; t, b_ = c - FOCUS_MIN_H / 2, c + FOCUS_MIN_H / 2
    # on ramène la zone dans l'écran
    if l < 0: r, l = r - l, 0
    if t < 0: b_, t = b_ - t, 0
    if r > VIEW_W: l, r = max(0, l - (r - VIEW_W)), VIEW_W
    if b_ > VIEW_H: t, b_ = max(0, t - (b_ - VIEW_H)), VIEW_H
    box = (int(l), int(t), int(r), int(b_))
    if (box[2] - box[0]) * (box[3] - box[1]) > 0.75 * VIEW_W * VIEW_H:
        return None  # presque tout l'écran : autant tout envoyer
    return box


def draw_zone(src: Path, dst: Path, box) -> None:
    from PIL import Image, ImageDraw
    im = Image.open(src).convert("RGB")
    ImageDraw.Draw(im).rectangle(box, outline=(78, 161, 255), width=5)
    im.save(dst, "JPEG", quality=80)


def annotate(src: Path, dst: Path, x: int, y: int) -> None:
    from PIL import Image, ImageDraw
    im = Image.open(src).convert("RGB")
    d = ImageDraw.Draw(im)
    for r, w in ((26, 5), (8, 0)):
        d.ellipse([x - r, y - r, x + r, y + r], outline=(234, 67, 53), width=w or 1, fill=(234, 67, 53) if not w else None)
    d.line([x - 44, y, x - 30, y], fill=(234, 67, 53), width=4)
    d.line([x + 30, y, x + 44, y], fill=(234, 67, 53), width=4)
    d.line([x, y - 44, x, y - 30], fill=(234, 67, 53), width=4)
    d.line([x, y + 30, x, y + 44], fill=(234, 67, 53), width=4)
    im.save(dst, "JPEG", quality=80)


def describe(info: dict | None) -> str:
    if not info:
        return "zone vide"
    kind = {"button": "bouton", "a": "lien", "input": "champ", "select": "liste", "textarea": "zone de texte",
            "li": "élément de liste", "td": "cellule"}.get(info["tag"], info["tag"])
    if info["tag"] in ("input", "select", "textarea"):
        name = info.get("label") or (info.get("name") or "").replace("_", " ").capitalize()
    else:
        name = info.get("text")
    name = " ".join(str(name or "").split())[:60]
    return f'{kind} « {name} »' if name else kind


# ---------------------------------------------------------------- boucle de l'agent

def main() -> None:
    ap = argparse.ArgumentParser(description="Twiin Live : regarder l'agent Holo travailler")
    ap.add_argument("--invoice", default="INV-002")
    ap.add_argument("--site", help="URL de comptarex (défaut : http://127.0.0.1:<PORT>)")
    ap.add_argument("--skill", help="skill.md capturé à ajouter à la tâche (procédure démontrée)")
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--max-steps", type=int, default=30)
    ap.add_argument("--port", type=int, default=8100)
    ap.add_argument("--reset", action="store_true", help="vider les saisies de comptarex avant de commencer")
    ap.add_argument("--no-open", action="store_true", help="ne pas ouvrir la page de suivi automatiquement")
    ap.add_argument("--vision", choices=["focus", "full"], default="full",
                    help="full : tout l'écran (défaut) ; focus : seulement la zone d'intérêt (expérimental)")
    ap.add_argument("--replay", metavar="DOSSIER_RUN", help="rejouer un run passé (live/runs/<date>) sans appeler Holo")
    ap.add_argument("--speed", type=float, default=1.0, help="vitesse du replay (2 = deux fois plus vite)")
    a = ap.parse_args()
    a.port = free_port(a.port)

    if a.replay:
        feed = ReplayFeed(Path(a.replay).resolve(), a.speed)
        start_server(feed, a.port)
        print(f"Replay de {a.replay} sur http://localhost:{a.port} (Ctrl+C pour quitter)", flush=True)
        if not a.no_open:
            webbrowser.open(f"http://localhost:{a.port}")
        try:
            while True:
                time.sleep(3600)
        except KeyboardInterrupt:
            return

    key = dotenv_values(ROOT / ".env").get("HAI_API_KEY") or os.getenv("HAI_API_KEY")
    if not key:
        sys.exit("HAI_API_KEY absente de .env (racine du projet).")
    cx = dotenv_values(COMPTAREX / ".env")
    site = (a.site or f"http://127.0.0.1:{cx.get('PORT', '8042')}").rstrip("/")

    run_dir = LIVE / "runs" / datetime.now().strftime("%Y%m%d-%H%M%S")
    run_dir.mkdir(parents=True)
    feed = Feed(run_dir)
    start_server(feed, a.port)
    print(f"Page de suivi : http://localhost:{a.port}", flush=True)
    if not a.no_open:
        webbrowser.open(f"http://localhost:{a.port}")

    verify = [sys.executable, str(ROOT / "capture" / "scripts" / "verify_comptarex.py"), "--site", site]
    if a.reset:
        subprocess.run(verify + ["--reset"], capture_output=True)

    task, inv = invoice_task(a.invoice)
    if a.skill:
        task += "\n\n## Procedure demonstrated by the employee (hints)\n" + Path(a.skill).read_text()[:6000]
    feed.add("task", text=f"Saisir la facture {a.invoice} ({inv['fournisseur']}, {inv['numero_facture']}) en brouillon",
             invoice=inv, model=a.model, site=site)

    client = OpenAI(base_url=HOLO_BASE_URL, api_key=key)
    history: list[str] = []
    last_call = 0.0
    refusals = 0
    outcome = "stopped"
    want_full = False
    last_point = None
    stats = {"calls": 0, "prompt_tokens": 0, "completion_tokens": 0, "holo_seconds": 0.0, "pixels_sent": 0,
             "full_views": 0, "focus_views": 0}

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, args=[f"--window-size={VIEW_W},{VIEW_H + 120}", "--window-position=0,0"])
        page = browser.new_page(viewport={"width": VIEW_W, "height": VIEW_H})

        def on_dialog(d):
            if FORBIDDEN.search(d.message):
                feed.add("blocked", text=f"Fenêtre « {d.message[:90]} » refusée (action irréversible)")
                d.dismiss()
            else:
                feed.add("dialog", text=f"Fenêtre « {d.message[:90]} » acceptée")
                d.accept()
        page.on("dialog", on_dialog)

        # Connexion par « coffre » : le script remplit les identifiants, l'agent ne les voit jamais.
        page.goto(f"{site}/login")
        page.fill("input[name=email]", cx.get("SITE_LOGIN", ""))
        page.fill("input[name=password]", cx.get("SITE_PASSWORD", ""))
        page.locator("form button[type=submit], form input[type=submit]").first.click()
        page.wait_for_load_state()
        feed.add("vault", text="Connecté à comptarex par le coffre (le mot de passe n'est jamais montré à l'agent)", url=page.url)

        last_url = page.url
        for step in range(1, a.max_steps + 1):
            # 0. la page a-t-elle changé depuis la dernière capture ?
            navigated = page.url != last_url
            if navigated:
                feed.add("navigation", step=step - 1, url=page.url, title=page.title(), text=f"Nouvelle page : {page.title()}")
                last_url = page.url
                last_point = None
            # 1. capture (toujours de tout l'écran, pour l'affichage) + zone d'intérêt envoyée à Holo
            shot = run_dir / f"{step:02d}.jpg"
            page.screenshot(path=str(shot), type="jpeg", quality=75)
            failed_before = bool(history) and any(k in history[-1] for k in ("FAILED", "BLOCKED", "REFUSED", "failed", "does nothing"))
            box = None
            if a.vision == "focus" and step > 1 and not navigated and not want_full and not failed_before:
                box = focus_box(page.evaluate(ACTIVE_AREA), last_point)
            want_full = False
            if box:
                from PIL import Image
                sent = run_dir / f"{step:02d}_vue.jpg"
                Image.open(shot).crop(box).save(sent, "JPEG", quality=75)
                draw_zone(shot, run_dir / f"{step:02d}_zone.jpg", box)
                stats["focus_views"] += 1
                feed.add("capture", step=step, img=f"run/{step:02d}_zone.jpg", url=page.url, title=page.title(),
                         zone=list(box), text=f"Zone d'intérêt {box[2]-box[0]}×{box[3]-box[1]} px envoyée à Holo "
                         f"({round((box[2]-box[0])*(box[3]-box[1])/(VIEW_W*VIEW_H)*100)} % de l'écran)")
            else:
                sent = shot
                box = (0, 0, VIEW_W, VIEW_H)
                stats["full_views"] += 1
                feed.add("capture", step=step, img=f"run/{shot.name}", url=page.url, title=page.title(),
                         text="Écran entier envoyé à Holo")
            bw, bh = box[2] - box[0], box[3] - box[1]

            # 2. Holo réfléchit (en respectant la limite gratuite)
            wait = MIN_SECONDS_BETWEEN_CALLS - (time.time() - last_call)
            if wait > 0:
                time.sleep(wait)
            feed.add("thinking", step=step, text="Holo regarde la capture et choisit l'action suivante…")
            view_note = ("" if (bw, bh) == (VIEW_W, VIEW_H) else
                         "\n\nNOTE: the screenshot is a ZOOMED part of the screen around the current work area. "
                         "Coordinates are relative to this image. If what you need is not visible, call full_view.")
            prompt = (task + "\n\n## What you already did\n" + ("\n".join(history[-12:]) or "(nothing yet)") +
                      view_note + "\n\nLook at the screenshot and call exactly ONE tool for the next action.")
            data_uri = "data:image/jpeg;base64," + base64.b64encode(sent.read_bytes()).decode()
            for attempt in range(4):
                try:
                    last_call = time.time()
                    resp = client.chat.completions.create(
                        model=a.model, tools=tools(), tool_choice="required",
                        messages=[{"role": "user", "content": [{"type": "image_url", "image_url": {"url": data_uri}},
                                                               {"type": "text", "text": prompt}]}])
                    took = time.time() - last_call
                    u = getattr(resp, "usage", None)
                    stats["calls"] += 1
                    stats["holo_seconds"] += took
                    stats["pixels_sent"] += bw * bh
                    stats["prompt_tokens"] += getattr(u, "prompt_tokens", 0) or 0
                    stats["completion_tokens"] += getattr(u, "completion_tokens", 0) or 0
                    call_metrics = {"tokens": getattr(u, "prompt_tokens", None), "latency": round(took, 1), "px": f"{bw}×{bh}"}
                    break
                except Exception as e:  # noqa: BLE001
                    if "429" in str(e) and attempt < 3:
                        feed.add("info", text="Limite gratuite atteinte (10/min) : pause de 30 s")
                        time.sleep(30)
                        continue
                    feed.add("error", text=f"Erreur Holo : {str(e)[:200]}")
                    raise
            calls = resp.choices[0].message.tool_calls or []
            if not calls:
                history.append(f"{step}. (no action returned)")
                feed.add("info", text="Holo n'a pas proposé d'action, nouvel essai")
                continue
            name = calls[0].function.name
            try:
                args = json.loads(calls[0].function.arguments or "{}")
            except json.JSONDecodeError:
                args = {}
            reason = args.get("reason", "")

            if name == "full_view":
                want_full = True
                feed.add("info", step=step, text="L'agent demande à voir tout l'écran", **call_metrics)
                history.append(f"{step}. full_view (next screenshot shows the whole screen)")
                continue

            if name == "done":
                err = re.search(r"Erreur\(s\) de saisie\s*:?\s*(.{0,200})", page.inner_text("body"), re.S)
                if "ok=brouillon" not in page.url and err and refusals < 3:
                    refusals += 1
                    msg = " ".join(err.group(1).split())
                    feed.add("blocked", step=step, text=f"L'agent dit avoir fini, mais la page affiche une erreur : « {msg[:120]} ». "
                             "On le renvoie corriger.")
                    history.append(f"{step}. done REFUSED: the page shows an error message: {msg}. Fix it, then save the draft again.")
                    continue
                feed.add("done", step=step, reason=reason, text=args.get("summary", ""), success=bool(args.get("success")))
                if "ok=brouillon" not in page.url:
                    feed.add("blocked", step=step, text="Attention : l'agent dit avoir fini, mais aucun brouillon n'a été "
                             "enregistré à l'écran. La vérification va trancher.")
                outcome = "done"
                break

            # 3. décision : où et quoi
            px = py = None
            info = None
            if "x" in args and "y" in args:
                # coordonnées 0-1000 dans l'image envoyée → pixels de l'écran
                px = max(0, min(VIEW_W - 1, box[0] + round(int(args["x"]) / 1000 * bw)))
                py = max(0, min(VIEW_H - 1, box[1] + round(int(args["y"]) / 1000 * bh)))
                last_point = (px, py)
                info = page.evaluate(ELEMENT_AT, [px, py])
                target = run_dir / f"{step:02d}_cible.jpg"
                annotate(shot, target, px, py)
            human = {
                "click": lambda: f"Cliquer sur le {describe(info)}",
                "type_text": lambda: f"Écrire « {args.get('text', '')} » dans le {describe(info)}",
                "select_option": lambda: f"Choisir « {args.get('option', '')} » dans la {describe(info)}",
                "press_key": lambda: f"Appuyer sur la touche {args.get('key', '')}",
                "scroll": lambda: f"Faire défiler vers le {'bas' if 'down' in str(args.get('direction', 'down')) else 'haut'}",
            }.get(name, lambda: name)()
            feed.add("decision", step=step, action=name, text=human, reason=reason, x=px, y=py,
                     img=f"run/{step:02d}_cible.jpg" if px is not None else None, **call_metrics)

            # 4. garde-fou
            if name == "click" and info and (FORBIDDEN.search(info.get("text", "")) or info.get("value") == "valider"):
                feed.add("blocked", step=step, text=f"Clic sur {describe(info)} bloqué : Twiin s'arrête au brouillon")
                history.append(f"{step}. BLOCKED: clicking {info.get('text')} is forbidden. Use 'Enregistrer le brouillon'.")
                continue

            # Écrire ailleurs que dans un champ ne sert à rien : on le dit à l'agent.
            if name == "type_text" and info and info.get("tag") not in ("input", "textarea"):
                feed.add("info", step=step, text=f"Pas de champ de saisie à cet endroit ({describe(info)}) : l'agent doit viser la case blanche")
                history.append(f"{step}. type_text FAILED: there is no input field at ({args.get('x')}, {args.get('y')}), "
                               f"only {describe(info)}. Aim at the white input box itself.")
                continue

            # Une liste déroulante native s'ouvre hors de la capture d'écran : l'agent ne verrait jamais les choix.
            if name == "click" and info and info.get("tag") == "select":
                feed.add("info", step=step, text="C'est une liste déroulante : l'agent doit utiliser « choisir une option »")
                history.append(f"{step}. Clicking a dropdown (<select>) does nothing visible. "
                               f"Use select_option at the same (x, y) with the option text instead.")
                continue

            # 5. exécution dans la vraie fenêtre
            before = page.url
            try:
                if px is not None:
                    page.evaluate(SHOW_DOT, [px, py, "#ea4335"])
                    time.sleep(0.6)
                if name == "click":
                    page.mouse.click(px, py)
                elif name == "type_text":
                    page.mouse.click(px, py)
                    page.keyboard.press("ControlOrMeta+A")
                    page.keyboard.press("Backspace")
                    page.keyboard.type(str(args.get("text", "")), delay=70)
                elif name == "select_option":
                    r = page.evaluate(SET_SELECT, [px, py, str(args.get("option", ""))])
                    if not r or r.get("error"):
                        raise RuntimeError((r or {}).get("error") or "aucune liste à cet endroit")
                elif name == "press_key":
                    page.keyboard.press(str(args.get("key", "Enter")))
                elif name == "scroll":
                    page.mouse.wheel(0, 500 if "down" in str(args.get("direction", "down")).lower() else -500)
                if name in ("click", "press_key"):
                    try:  # un clic peut charger une nouvelle page : on lui laisse le temps
                        page.wait_for_url(lambda u: u != before, timeout=2500)
                    except Exception:  # noqa: BLE001
                        pass
                page.wait_for_load_state(timeout=8000)
                time.sleep(0.8)
                history.append(f"{step}. {name} {json.dumps({k: v for k, v in args.items() if k != 'reason'}, ensure_ascii=False)}"
                               f" on {describe(info) if info else ''} -> ok")
            except Exception as e:  # noqa: BLE001
                feed.add("error", step=step, text=f"Action impossible : {str(e)[:160]}")
                history.append(f"{step}. {name} failed: {str(e)[:120]}")
                continue

            # 6. nouvelle page ?
            if page.url != last_url:
                feed.add("navigation", step=step, url=page.url, title=page.title(), text=f"Nouvelle page : {page.title()}")
                last_url = page.url
                want_full, last_point = True, None  # nouvelle page : Holo doit tout voir
            if "ok=brouillon" in page.url:
                feed.add("draft", step=step, text="Brouillon enregistré. L'agent s'arrête là (pas de validation).")
                outcome = "draft"
                break
        else:
            feed.add("info", text=f"Nombre maximal d'étapes atteint ({a.max_steps})")

        stats.update(vision=a.vision, invoice=a.invoice, outcome=outcome, seconds=round(time.time() - feed.t0, 1),
                     avg_latency=round(stats["holo_seconds"] / max(1, stats["calls"]), 2),
                     avg_prompt_tokens=round(stats["prompt_tokens"] / max(1, stats["calls"])),
                     avg_pixels=round(stats["pixels_sent"] / max(1, stats["calls"])))
        stats["holo_seconds"] = round(stats["holo_seconds"], 1)
        (run_dir / "stats.json").write_text(json.dumps(stats, indent=1))
        feed.add("stats", text=(f"{stats['calls']} appels à Holo · {stats['prompt_tokens']} tokens envoyés "
                                f"(moy. {stats['avg_prompt_tokens']}/appel) · latence moy. {stats['avg_latency']} s · "
                                f"{stats['focus_views']} vues recadrées / {stats['full_views']} plein écran"), **stats)

        # Vérification indépendante via l'API technique de comptarex
        res = subprocess.run(verify + ["--invoice", a.invoice], capture_output=True, text=True)
        feed.add("verify", ok=res.returncode == 0, text=(res.stdout or res.stderr).strip())
        feed.add("end", outcome=outcome, text="Fin du run")
        print(f"\nRun gardé dans {run_dir}. Page de suivi : http://localhost:{a.port} (Ctrl+C pour quitter)")
        time.sleep(2)
        browser.close()
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
