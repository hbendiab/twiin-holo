#!/usr/bin/env python3
"""Découverte d'une tâche et environnement de test interne (jumeau), lancés en arrière-plan par le serveur Twiin.

    python -m discovery.discovery discover <dossier de session>   # après l'enregistrement + l'analyse
    python -m discovery.discovery casse    <dossier de session>   # après le « oui » de l'employé

discover :
  1. envoie la tâche dans Supabase (`taches`, statut processing) + ses captures (bucket task-captures) ;
  2. croise la tâche avec les fiches `dictionnaire` des logiciels reconnus ;
  3. un modèle de vision (Qwen via Hugging Face) écrit la fiche de cadrage, la mission, l'état attendu
     et le JUMEAU (une page web avec des données fictives) ;
  4. test « dev » : Holo rejoue la mission dans le jumeau, on compare l'état final à l'état attendu ;
  5. pose la question à l'employé (statut analysed + `confirmation`).
casse : rejoue la mission dans le jumeau avec des perturbations (popup, lenteur, zoom), modèle gratuit puis payant,
        écrit chaque essai dans `tests` (taux de réussite, coût, faux « réussi »).

L'employé ne voit jamais le jumeau : seulement la question « Ai-je bien compris votre problème ? ».
État local, lu par la page : <session>/discovery.json.
"""
import base64
import functools
import http.server
import json
import os
import re
import socket
import sys
import threading
import time
import traceback
import unicodedata
from datetime import datetime, timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI

ROOT = Path(__file__).resolve().parents[1]          # dossier twiin/
load_dotenv(ROOT.parent / ".env")                   # même .env que le serveur (racine du dépôt)
load_dotenv(ROOT / ".env")

from discovery.agent import run_agent  # noqa: E402
from discovery.supa import Supa  # noqa: E402

HF_MODEL = os.environ.get("HF_MODEL", "Qwen/Qwen3.8-27B")
DEV_MODEL = os.environ.get("DISCOVERY_DEV_MODEL", "holo4-35b-a3b")  # pas de limite de débit : test dev rapide
CASSE_MODEL = os.environ.get("DISCOVERY_CASSE_MODEL", "holo4-35b-a3b")  # holo3-1-35b-a3b = gratuit, 3x plus lent
MAX_IMAGES = 4

# Perturbations injectées dans le jumeau pour la casse (scripts exécutés à chaque chargement de page).
VARIANTS = {
    "base": None,
    "popup": """window.addEventListener('DOMContentLoaded', () => {
      const o = document.createElement('div');
      o.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:99999;display:flex;align-items:center;justify-content:center';
      o.innerHTML = '<div style="background:#fff;padding:28px;border-radius:10px;max-width:460px;font:15px sans-serif">' +
        '<h3>Nous respectons votre vie privée</h3><p>Ce site utilise des cookies pour améliorer votre expérience.</p>' +
        '<button id="tw-refuse" style="margin-right:10px;padding:8px 14px">Tout refuser</button>' +
        '<button id="tw-accept" style="padding:8px 14px;background:#1a73e8;color:#fff;border:0">Tout accepter</button></div>';
      document.body.appendChild(o);
      o.querySelectorAll('button').forEach((b) => b.onclick = () => o.remove());
    });""",
    "lent": """window.addEventListener('DOMContentLoaded', () => {
      document.body.style.visibility = 'hidden';
      setTimeout(() => document.body.style.visibility = 'visible', 3000);
      document.addEventListener('click', () => { document.body.style.opacity = '.15';
        setTimeout(() => document.body.style.opacity = '1', 1500); }, true);
    });""",
    "zoom": "window.addEventListener('DOMContentLoaded', () => { document.body.style.zoom = '1.35'; });",
}

CADRAGE_PROMPT = """An employee recorded a task on their computer; a previous analysis found the steps below. Reformulate what you
understood, so the employee can confirm it. IGNORE the recording tool itself (the "Twiin"/"Twin" page on localhost:3000,
"Enregistrer ma tâche", "Terminer et analyser"): it is not part of their task.
Return ONLY this JSON, in French, no fences:
{"probleme": "one sentence from the employee's point of view: what they do and why it costs time",
 "etapes": ["3 to 5 short steps as the employee would describe them"],
 "outils": ["software / websites used"],
 "objectif": "accélérer | automatiser, with a few words",
 "doutes": ["0 to 3 things to confirm with the employee"]}
"""

TWIN_PROMPT = """You prepare an INTERNAL test environment (a "twin") for a task an employee recorded on their computer.
The employee will NEVER see the twin. It is used to replay and stress-test automations safely, without touching
their real software or data.

You receive: the task steps found by a previous analysis, a few screenshots of the recording, and documentation
about the software involved. Produce TWO blocks, in this order, and nothing else:

```json
{
 "mission": "English instruction for a computer-use agent working INSIDE THE TWIN, as the employee would ask a colleague: the goal and where to look, ending with 'then call done'. Do NOT give the values to copy: the agent must READ them in the twin pages (that is what we test). Never ask to buy, send, pay, validate or delete.",
 "expected": {"rows": [{"<column>": "<exact expected value>"}]},
 "fidelite": "low | medium | high : how close the twin is to the real tools, given what the screenshots show",
 "items": ["the names of the items the task processes, in order (e.g. the 3 sites)"],
 "routes": [{"nom": "short French name", "strategie": "English: a DIFFERENT way to reach the same final result (other starting point, other order, other navigation), 1-3 sentences"}]  // exactly 3, truly different
}
```

```html
<!doctype html> ... a SINGLE self-contained HTML file (inline CSS and JS, no external resources, no network) ...
```

IGNORE the recording tool itself (the "Twiin"/"Twin" page on localhost:3000 with "Enregistrer ma tâche" or
"Terminer et analyser"): it is NOT part of the employee's task. Never put it in the twin, the steps or the tools.

Rules for the twin HTML:
- 1280x800 viewport, French UI, looks like the real tools seen in the screenshots (layout, labels, colors), simplified.
- Use FICTITIOUS data only (invented product names, prices, URLs on example.test). Never copy personal data.
- One page with a top navigation bar of tabs, one tab per website or tool used (e.g. 3 merchant sites + a spreadsheet).
  Switching tabs must work with a click.
- Include the distractors seen in the recording when relevant (search results, crossed-out old prices, buttons such as
  "Ajouter au panier" or "Acheter" that must NOT be used).
- The spreadsheet / form where the employee writes data is made of <input> cells under clear column headers.
- Define window.__twinState = () => ({rows: [...]}) returning the NON-EMPTY rows of that table as objects keyed by the
  column headers, read from the inputs at call time.
- "expected.rows" must be exactly what __twinState() returns once the mission is done correctly.
- Keep it under 350 lines.
"""


# ---------------------------------------------------------------- état local (lu par le serveur et la page)

class State:
    def __init__(self, session_dir: Path):
        self.path = session_dir / "discovery.json"
        self.data = json.loads(self.path.read_text(encoding="utf-8")) if self.path.exists() else {}

    def reload(self) -> dict:
        try:
            self.data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            pass
        return self.data

    def set(self, **kw):
        self.reload()  # le serveur peut avoir écrit la réponse de l'employé entre-temps
        self.data.update(kw, updated_at=datetime.now(timezone.utc).isoformat(timespec="seconds"))
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.data, ensure_ascii=False, indent=1), encoding="utf-8")
        tmp.replace(self.path)
        print(f"[découverte] {kw.get('phase', '')} {kw.get('message', '')}", flush=True)


# ---------------------------------------------------------------- outils

def load_frames(session_dir: Path) -> list[dict]:
    p = session_dir / "frames.jsonl"
    if p.exists():
        return [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()]
    p = session_dir / "frames.json"
    return json.loads(p.read_text(encoding="utf-8")).get("frames", []) if p.exists() else []


def norm(v) -> str:
    s = unicodedata.normalize("NFKD", str(v or "")).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"(eur|€|\s)", "", s).replace(",", ".")
    if s in ("-", "--", "n/a", "na", "?"):  # « — » devient vide après normalisation ; on aligne les autres marques d'absence
        s = ""
    return s.rstrip("/")


def score(expected: dict, state: dict | None) -> tuple[float, list[str]]:
    """Part des cellules attendues retrouvées dans l'état final du jumeau (ordre des lignes indifférent)."""
    exp = (expected or {}).get("rows") or []
    got = (state or {}).get("rows") or []
    if not exp:
        return 0.0, ["aucun état attendu"]
    total = hit = 0
    errs = []
    remaining = list(got)
    for row in exp:
        best, best_hits = None, -1
        for g in remaining:
            h = sum(1 for k, v in row.items() if norm(g.get(k)) == norm(v))
            if h > best_hits:
                best, best_hits = g, h
        total += len(row)
        hit += max(best_hits, 0)
        if best is not None:
            remaining.remove(best)
        for k, v in row.items():
            if best is None or norm(best.get(k)) != norm(v):
                errs.append(f"{k} : attendu « {v} », obtenu « {(best or {}).get(k, '')} »")
    return (hit / total if total else 0.0), errs[:8]


def serve(directory: Path) -> tuple[str, http.server.ThreadingHTTPServer]:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(directory))
    handler.log_message = lambda *a, **k: None
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return f"http://127.0.0.1:{port}/index.html", srv


def hf_client() -> OpenAI:
    return OpenAI(base_url="https://router.huggingface.co/v1", api_key=os.environ["HF_TOKEN"])


def fenced(raw: str, lang: str) -> str | None:
    m = re.search(rf"```{lang}\s*(.*?)```", raw, re.S | re.I)
    return m.group(1).strip() if m else None


def record_test(sb: Supa, task_id: str, variant: str, res: dict, sc: float, errs: list[str], phase: str) -> None:
    st = res["stats"]
    false_success = bool(res["claimed_success"]) and sc < 1
    sb.insert("tests", {
        "task_id": task_id, "kind": "holo_replay", "status": "succeeded" if sc >= 1 else "failed",
        "success_rate": round(sc, 3),
        "summary": f"[{phase}] variante {variant} · {st['model']} · {st['calls']} appels · {st['seconds']} s"
                   + (" · FAUX RÉUSSI (l'agent dit avoir réussi)" if false_success else ""),
        "steps_log": {"variant": variant, "phase": phase, "stats": st, "history": res["history"][-40:],
                      "agent_summary": res["summary"], "claimed_success": res["claimed_success"],
                      "false_success": false_success, "errors": errs},
        "error": "; ".join(errs[:3]) or None,
        "cost_usd": 0 if st["model"] == "holo3-1-35b-a3b" else None,  # coût réel du payant : à lire sur le portail H
        "ended_at": datetime.now(timezone.utc).isoformat(),
    })


# ---------------------------------------------------------------- phase 1 : découverte

def discover(session_dir: Path) -> None:
    """Question à l'employé en ~30 s ; jumeau, test dev et envoi des captures continuent en parallèle."""
    st = State(session_dir)
    st.set(phase="upload", message="Envoi de la tâche dans la base", started_at=time.time(), answer=None)
    frames = load_frames(session_dir)
    cand = json.loads((ROOT / "workflows" / "candidates.json").read_text(encoding="utf-8")).get("workflows", [{}])[0]
    steps = cand.get("steps", [])
    sb = Supa()

    # 1. logiciels reconnus (nom du dictionnaire présent dans les étapes) + la tâche dans Supabase
    dico = sb.select("dictionnaire", "select=id,name,has_api,connector,docs,screens")
    text = " ".join(steps + [cand.get("summary", ""), cand.get("name", "")]).lower()
    used = [d for d in dico if d["name"].lower() in text]
    started, ended = (frames[0].get("timestamp"), frames[-1].get("timestamp")) if frames else (None, None)
    old = sb.select("taches", f"select=id&source_session_id=eq.{session_dir.name}")
    fields = {"status": "processing", "software_ids": [d["id"] for d in used],
              "started_at": started, "ended_at": ended,
              "expires_at": (datetime.now(timezone.utc) + timedelta(days=30)).isoformat(), "stats": {"frames": len(frames)}}
    if old:  # la page a déjà créé la tâche (même enregistrement) : on la complète au lieu d'en créer une autre
        sb.update("taches", f"id=eq.{old[0]['id']}", fields)
        task = {"id": old[0]["id"]}
    else:
        task = sb.insert("taches", {
            "company_id": sb.company_id, "title": cand.get("name") or "Tâche enregistrée", "summary": cand.get("summary"),
            "context": cand.get("general_intent"), "steps": [{"position": i + 1, "instruction": s} for i, s in enumerate(steps)],
            "source_session_id": session_dir.name, **fields})
    tid = task["id"]
    st.set(task_id=tid, message=f"Tâche {tid} créée")

    # 2. captures envoyées en arrière-plan
    def upload_all():
        shots = []
        for f in frames:
            b = base64.b64decode(f["dataUrl"].split(",", 1)[1])
            p = f"{sb.company_id}/{tid}/frame-{int(f.get('index', 0)):04d}.jpg"
            try:
                sb.upload("task-captures", p, b, "image/jpeg")
                shots.append({"storage_path": p, "screen_index": int(f.get("screen", 1)) - 1,
                              "at_ms": int(f.get("seconds", 0)) * 1000})
            except Exception as e:  # noqa: BLE001
                print("capture non envoyée :", e, flush=True)
        sb.update("taches", f"id=eq.{tid}", {"screenshots": shots})
    # Par défaut les captures restent sur le poste (règle de l'équipe : texte et chiffres seulement dans Supabase)
    uploader = threading.Thread(target=upload_all, daemon=True)
    if os.environ.get("DISCOVERY_UPLOAD_CAPTURES", "off") == "on":
        uploader.start()

    # 3. fiche de cadrage (appel court, texte seul) -> question posée tout de suite
    st.set(phase="cadrage", message="Reformulation de la tâche")
    t0 = time.time()
    steps_txt = (f"TASK: {cand.get('name', '')}\nSUMMARY: {cand.get('summary', '')}\nSTEPS:\n"
                 + "\n".join(f"{i + 1}. {s}" for i, s in enumerate(steps))
                 + f"\nKNOWN SOFTWARE: {', '.join(d['name'] for d in used) or '-'}")
    r = hf_client().chat.completions.create(
        model=HF_MODEL, max_tokens=1500, temperature=0.2,
        messages=[{"role": "system", "content": CADRAGE_PROMPT}, {"role": "user", "content": steps_txt}],
        extra_body={"reasoning_effort": "low"})
    raw = (r.choices[0].message.content or "").strip()
    raw = fenced(raw, "json") or raw[raw.find("{"): raw.rfind("}") + 1]
    cadrage = json.loads(raw)
    question = {"titre": "Ai-je bien compris votre problème ?", **cadrage}
    sb.update("taches", f"id=eq.{tid}", {"status": "analysed",
                                          "confirmation": {"question": question,
                                                           "asked_at": datetime.now(timezone.utc).isoformat()}})
    st.set(phase="awaiting_confirmation", question=question, work="twin",
           message=f"Question posée en {time.time() - t0:.0f} s ; jumeau en construction en parallèle")

    # 4. jumeau (modèle de vision), pendant que l'employé lit la question
    pick = frames[:: max(1, len(frames) // MAX_IMAGES)][:MAX_IMAGES]
    docs = "\n".join(f"- {d['name']} ({'API ' + (d['connector'] or '') if d['has_api'] else 'pas d API'}) : "
                     + " | ".join((x.get("title", "") + " : " + x.get("excerpt", "")[:300]) for x in (d.get("docs") or [])[:2])
                     for d in used) or "(aucun logiciel du dictionnaire reconnu)"
    content = [{"type": "text", "text": steps_txt + f"\n\nSOFTWARE (dictionnaire):\n{docs}"}]
    for f in pick:
        content += [{"type": "text", "text": f"Screenshot t+{f.get('seconds', '?')}s"},
                    {"type": "image_url", "image_url": {"url": f["dataUrl"]}}]
    t0 = time.time()
    resp = hf_client().chat.completions.create(
        model=HF_MODEL, max_tokens=14000, temperature=0.2,
        messages=[{"role": "system", "content": TWIN_PROMPT}, {"role": "user", "content": content}],
        extra_body={"reasoning_effort": "low"})
    raw = resp.choices[0].message.content or ""
    spec_txt, html = fenced(raw, "json"), fenced(raw, "html")
    if not spec_txt or not html:
        (session_dir / "twin_raw.txt").write_text(raw, encoding="utf-8")
        raise RuntimeError("le modèle n'a pas rendu le jumeau attendu (voir twin_raw.txt)")
    spec = json.loads(spec_txt)
    spec["cadrage"] = cadrage
    twin_dir = session_dir / "twin"
    twin_dir.mkdir(exist_ok=True)
    (twin_dir / "index.html").write_text(html, encoding="utf-8")
    (twin_dir / "spec.json").write_text(json.dumps(spec, ensure_ascii=False, indent=1), encoding="utf-8")
    hf_cost = getattr(resp.usage, "cost", None) if resp.usage else None
    st.set(work="dev_test", twin_seconds=round(time.time() - t0), twin_cost_usd=hf_cost,
           message=f"Jumeau construit en {time.time() - t0:.0f} s ; test dev avec {DEV_MODEL}")

    # 5. itération 1 (test « dev ») : le jumeau est-il rejouable ? Guidée comme les suivantes.
    url, srv = serve(twin_dir)
    try:
        r0 = route_zero(session_dir)
        bricks = list_bricks(url)
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=2) as pool:  # Holo à l'écran ET automatisation n8n, en même temps
            f_wave = pool.submit(parallel_wave, spec, url, session_dir, DEV_MODEL, 1, bricks, [], r0, sb, tid,
                                 int(os.environ.get("DISCOVERY_AGENTS", "3")))
            f_auto = pool.submit(automation_iterations, spec, twin_dir, session_dir, sb, tid, 100, used)
            wave1 = f_wave.result() + f_auto.result()
    finally:
        srv.shutdown()
    best = max(wave1, key=lambda r: (r["success_rate"], -r["seconds"]))
    dev = {"model": DEV_MODEL, "success_rate": best["success_rate"], "seconds": max(r["seconds"] for r in wave1),
           "chemins": [r["route"] for r in wave1]}
    st.set(iterations=wave1, bricks=bricks)
    if uploader.is_alive():
        uploader.join(timeout=120)
    sb.update("taches", f"id=eq.{tid}", {"twin": {"fidelite": spec.get("fidelite"), "mission": spec["mission"],
                                                    "expected": spec.get("expected"), "dev_test": dev,
                                                    "hf_cost_usd": hf_cost}})
    st.set(work="ready", dev_test=dev, fidelite=spec.get("fidelite"), message="Environnement de test prêt")

    # 6. l'employé a peut-être déjà répondu pendant ce temps
    if st.reload().get("answer"):
        answer(session_dir)


# ---------------------------------------------------------------- guidage de Holo (sans jamais lui donner les valeurs)

GUIDE = """
## How to work (rules checked by the system)
- Work ONE item at a time: open its page or tab, call note with the values you read there (exactly as displayed),
  then go to the table and type them FROM YOUR NOTES. Never type a value you did not note from the screen.
- Copy text EXACTLY as displayed. A link is the address shown in the page's address bar, copied completely: never invent a link.
- A price is the CURRENT price of the product of the page: ignore crossed-out old prices, ads, banners and other products.
- Fill every column the task asks for; leave empty the columns the task says to leave empty.
- Click a cell before typing in it (type_text does it for you). Never use buy / add to cart / send / validate buttons.
- Call done only when every row and every column is filled."""


def _columns(expected: dict) -> tuple[int, list[str]]:
    """Nombre de lignes et colonnes À REMPLIR (une colonne vide partout dans l'attendu n'est pas exigée)."""
    rows = (expected or {}).get("rows") or []
    cols = [c for c in (rows[0].keys() if rows else []) if any(str(r.get(c, "")).strip() for r in rows)]
    return len(rows), cols


def progress_text(expected: dict, state: dict | None) -> str:
    """Avancement du tableau, sans aucune valeur attendue : lignes remplies et cases encore vides."""
    n, cols = _columns(expected)
    got = (state or {}).get("rows") or []
    lines = [f"{len(got)}/{n} rows started."]
    for i in range(n):
        row = got[i] if i < len(got) else {}
        empty = [c for c in cols if not str(row.get(c, "")).strip()]
        lines.append(f"Row {i + 1}: " + ("complete" if not empty else "empty cells: " + ", ".join(empty)))
    return "\n".join(lines)


def done_guard(expected: dict):
    n, cols = _columns(expected)

    def guard(state):
        got = (state or {}).get("rows") or []
        if len(got) < n:
            return f"only {len(got)} of {n} rows are filled"
        for i, row in enumerate(got[:n], 1):
            empty = [c for c in cols if not str(row.get(c, "")).strip()]
            if empty:
                return f"row {i} still has empty cells: {', '.join(empty)}"
        return None
    return guard


def hints_from(errs: list[str]) -> str:
    """Conseils pour l'essai suivant à partir des erreurs, sans révéler les valeurs attendues."""
    cols = sorted({e.split(" : ")[0] for e in errs})
    tips = []
    if any("prix" in c or "price" in c for c in cols):
        tips.append("Last time some prices were wrong: take the current price of THE product of the page, not a crossed-out price, an ad or another product.")
    if any("lien" in c or "link" in c or "url" in c for c in cols):
        tips.append("Last time some links were wrong: copy the full address shown in the address bar of each page, not the site's home.")
    others = [c for c in cols if not any(k in c for k in ("prix", "price", "lien", "link", "url"))]
    if others:
        tips.append("Last time these columns were wrong or empty: " + ", ".join(others) + ". Read them carefully on each page.")
    return "\n".join(tips)


def row_guard(expected: dict, i: int):
    """Refuse « fini » tant que la ligne i (1..n) a des cases vides."""
    _, cols = _columns(expected)

    def guard(state):
        got = (state or {}).get("rows") or []
        if len(got) < i:
            return f"row {i} is still empty"
        empty = [c for c in cols if not str(got[i - 1].get(c, "")).strip()]
        return f"row {i} still has empty cells: {', '.join(empty)}" if empty else None
    return guard


ROUTES_PROMPT = """A computer-use agent must reach the result below inside a test web page. Propose exactly 3 TRULY DIFFERENT
routes to reach the same final result (like a GPS proposing 3 itineraries): different starting point, different order,
different navigation (search page links vs tabs, item by item vs column by column...). Never buy, send, pay or delete.
Return ONLY JSON: {"routes": [{"nom": "short French name", "strategie": "English, 1-3 sentences"}]}"""


def ensure_routes(spec: dict, spec_path: Path) -> list[dict]:
    if len(spec.get("routes") or []) >= 2:
        return spec["routes"][:3]
    r = hf_client().chat.completions.create(
        model=HF_MODEL, max_tokens=1200, temperature=0.4,
        messages=[{"role": "system", "content": ROUTES_PROMPT}, {"role": "user", "content": "TASK:\n" + spec["mission"]}],
        extra_body={"reasoning_effort": "low"})
    raw = (r.choices[0].message.content or "").strip()
    raw = fenced(raw, "json") or raw[raw.find("{"): raw.rfind("}") + 1]
    spec["routes"] = json.loads(raw)["routes"][:3]
    spec_path.write_text(json.dumps(spec, ensure_ascii=False, indent=1), encoding="utf-8")
    return spec["routes"]


def route_zero(session_dir: Path) -> dict | None:
    """Chemin n°0 = le chemin réel de l'employé, tiré du journal d'actions (aucun appel à une IA, coût nul)."""
    p = session_dir / "actions.jsonl"
    if not p.exists():
        return None
    steps, last = [], None
    for line in p.read_text(encoding="utf-8").splitlines():
        try:
            e = json.loads(line)
        except ValueError:
            continue
        win = e.get("window") or ""
        if re.search(r"improveme|Twiin|localhost:3000", win, re.I) or e.get("type") in ("start", "stop", "error"):
            continue
        where = (win or e.get("app") or "").split(" - ")[0][:40]
        if e["type"] == "click":
            t = f"in « {where} », click {e.get('element') or 'an element'}"
        elif e["type"] == "typing":
            t = f"type in {e.get('element') or 'the field'}"
        elif e["type"] == "key":
            t = f"press {({'Entrée': 'Enter', 'Échap': 'Escape'}).get(e.get('keys'), e.get('keys'))}"
        elif e["type"] == "shortcut":
            t = f"shortcut {e.get('keys')}"
        elif e["type"] == "app":
            t = f"switch to « {where} »"
        else:
            continue
        if t != last:
            steps.append(t)
            last = t
    if len(steps) < 3:
        return None
    return {"nom": "chemin de l'employé",
            "strategie": "Follow the employee's own way, as recorded on their computer (names can differ a little in the "
                         "test page; the values must still be read on screen):\n" + "\n".join(f"- {x}" for x in steps[:40])}


def run_iteration(spec, url, out, model, variant, hints="", route: dict | None = None,
                  start: str | None = None, known: list[str] | None = None, order: str | None = None,
                  others_fn=None, on_path=None) -> tuple[dict, float, list[str]]:
    """Un essai dans le jumeau. Exploration : seuls A (départ `start`) et B (résultat attendu) sont donnés ;
    `known` = chemins déjà découverts, à NE PAS refaire."""
    exp = spec.get("expected")
    mission = spec["mission"] + GUIDE
    if route:
        mission += f"\n\n## YOUR ROUTE (imposed, follow it)\n{route['strategie']}"
    if start:
        mission += (f"\n\n## Your starting point\nYou start on « {start} ». From there, find YOUR OWN way to the result: "
                    "any order and any navigation are allowed, as long as the final table is right.")
    if known:
        mission += ("\n\n## Ways already found by other agents (find a DIFFERENT way: other order, other pages, "
                    "other navigation)\n" + "\n".join(f"- {k}" for k in known))
    if order:
        mission += f"\n\n## Order imposed for you\n{order}"
    res = run_agent(url, mission, out, model, max_steps=int(os.environ.get("DISCOVERY_MAX_STEPS", "40")),
                    init_script=VARIANTS[variant], progress_fn=lambda s: progress_text(exp, s),
                    done_guard=done_guard(exp), hints=hints, start_click=start, others_fn=others_fn, on_path=on_path)
    sc, errs = score(exp, res["state"])
    return res, sc, errs


CLASSIFY_PROMPT = """For each tool or website used in this task, say how an automation tool (n8n) can access it:
- "api": an official API or connector exists (spreadsheets, mail, CRM, cloud apps...);
- "page": no API needed, it is a public web page n8n can download and read (HTTP + HTML);
- "ecran": neither: desktop software, internal app behind a login, content drawn on screen, anti-bot pages...
  -> a computer-use agent (Holo) is required.
Use the dictionary information when given (it is authoritative). Return ONLY JSON:
{"outils": [{"nom": "...", "acces": "api|page|ecran", "raison": "a few words, in French"}]}"""


def classify_tools(spec: dict, used: list[dict]) -> dict:
    """Avant les itérations : chaque outil est-il accessible par API, par lecture de page, ou seulement à l'écran ?
    Le mode d'automatisation en découle : « n8n natif » ou « n8n + Holo »."""
    outils = (spec.get("cadrage") or {}).get("outils") or []
    # Le navigateur n'est pas un outil : on le retire, mais on garde l'information « web » (accès par HTTP)
    browsers = re.compile(r"\b(chrome|edge|firefox|safari|brave|opera|navigateur|browser)\b", re.I)
    web = any(browsers.search(o) for o in outils)
    outils = [o for o in outils if not browsers.search(o)]
    dico = "\n".join(f"- {d['name']}: {'API (' + (d.get('connector') or '') + ')' if d.get('has_api') else 'no API'}" for d in used)
    note = ("NOTE: the employee works in a WEB BROWSER: the websites above are reached over the web (HTTP); "
            "the browser itself is not a tool.\n") if web else ""
    r = hf_client().chat.completions.create(
        model=HF_MODEL, max_tokens=1200, temperature=0,
        messages=[{"role": "system", "content": CLASSIFY_PROMPT},
                  {"role": "user", "content": f"TOOLS: {', '.join(outils)}\nDICTIONARY:\n{dico or '(none)'}\n{note}TASK: {spec['mission'][:1500]}"}],
        extra_body={"reasoning_effort": "low"})
    raw = (r.choices[0].message.content or "").strip()
    raw = fenced(raw, "json") or raw[raw.find("{"): raw.rfind("}") + 1]
    res = json.loads(raw)
    res["outils"] = [o for o in res.get("outils", []) if not browsers.search(o.get("nom", ""))]
    if web:
        res["web"] = "sites utilisés dans un navigateur : accès par le web (HTTP)"
    res["mode"] = "n8n + Holo" if any(o.get("acces") == "ecran" for o in res.get("outils", [])) else "n8n natif"
    return res


def automation_iterations(spec, twin_dir: Path, session_dir: Path, sb, tid, first_it: int, used: list[dict]) -> list[dict]:
    """Les 2 itérations « automatisation » de bout en bout, choisies selon la présence d'API :
    n8n natif -> natif_html + natif_code ; n8n + Holo -> holo_par_element + holo_un_bloc. En parallèle, dans le n8n local."""
    if os.environ.get("DISCOVERY_N8N", "on") == "off":
        return []
    from concurrent.futures import ThreadPoolExecutor
    from discovery.automation import native_plan, run_automation
    n, cols = _columns(spec.get("expected"))
    rows = (spec.get("expected") or {}).get("rows") or []
    items = spec.get("items") or [str(r.get(cols[0], "")) for r in rows]
    try:
        cls = classify_tools(spec, used)
    except Exception as e:  # noqa: BLE001
        cls = {"outils": [], "mode": "n8n + Holo", "erreur": str(e)[:200]}
    native = None
    if cls["mode"] == "n8n natif":
        try:
            native = native_plan(spec, (twin_dir / "index.html").read_text(encoding="utf-8"), cols, items)
        except Exception as e:  # noqa: BLE001
            native = {"lisible": False, "erreur": str(e)[:200]}
        if native.get("lisible") is False:  # les valeurs n'existent qu'après JavaScript : la lecture de page ne suffit pas
            cls["mode"] = "n8n + Holo"
            cls["note"] = "pages non lisibles sans navigateur : Holo nécessaire"
    variants = ["natif_html", "natif_code"] if cls["mode"] == "n8n natif" else ["holo_par_element", "holo_un_bloc"]
    labels = {"natif_html": "n8n natif : lecture HTML par sélecteurs", "natif_code": "n8n natif : bloc Code qui analyse la page",
              "holo_par_element": "n8n + Holo : un bloc Holo par élément", "holo_un_bloc": "n8n + Holo : un seul bloc Holo"}

    def one(i, v):
        try:
            r = run_automation(spec, twin_dir, session_dir / "runs" / "n8n", CASSE_MODEL, cols, n, variant=v, native=native)
        except Exception as e:  # noqa: BLE001
            return {"iteration": first_it + i, "model": CASSE_MODEL, "variant": "base", "success_rate": 0.0,
                    "false_success": False, "seconds": 0, "calls": 0, "errors": [str(e)[:200]], "kind": "n8n",
                    "label": labels[v], "path": [v], "route": labels[v], "start": None}
        sc, errs = score(spec.get("expected"), r["state"])
        out = {"iteration": first_it + i, "model": CASSE_MODEL if v.startswith("holo") else "aucun (n8n natif)",
               "variant": "base", "success_rate": round(sc, 3), "false_success": r["status"] == "success" and sc < 1,
               "seconds": r["seconds"], "calls": r["holo"]["calls"], "errors": errs[:3], "start": None, "kind": "n8n",
               "label": labels[v], "path": r["nodes"], "route": " → ".join(r["nodes"][1:]), "n8n_status": r["status"],
               "mode": cls["mode"]}
        try:
            record_test(sb, tid, labels[v], {"stats": {"model": out["model"], "calls": out["calls"], "seconds": out["seconds"],
                                                       "blocked": 0},
                                             "history": [out["route"]], "summary": f"n8n {r['status']}",
                                             "claimed_success": r["status"] == "success"}, sc, errs, "automatisation")
        except Exception as e:  # noqa: BLE001
            print("essai n8n non enregistré :", e, flush=True)
        return out

    with ThreadPoolExecutor(max_workers=2) as pool:
        res = list(pool.map(lambda a: one(*a), enumerate(variants)))
    for r in res:
        r["classification"] = cls
    return res


def parallel_wave(spec, url, session_dir: Path, model: str, first_it: int, bricks: list, known: list[str],
                  r0: dict | None, sb, tid, width: int = 3) -> list[dict]:
    """width agents EN MÊME TEMPS, parcours différents : départs et ordres imposés différents, et registre partagé
    où chacun voit le parcours en cours des autres (consigne : ne pas le suivre)."""
    from concurrent.futures import ThreadPoolExecutor
    live: dict[int, list[str]] = {}
    lock = threading.Lock()
    orders = ["Process the items in the order given by the task.", "Process the items in REVERSE order (last item first).",
              "Start with the item in the middle of the list, then the others."]
    plans = []
    if r0:
        plans.append({"route": r0, "label": "chemin de l'employé", "start": None})
    # même point A pour tous (l'écran de départ du jumeau) : seuls le parcours et l'ordre diffèrent
    while len(plans) < width:
        plans.append({"route": None, "label": f"parcours {len(plans) + 1}", "start": None})

    def one(i, plan):
        it = first_it + i
        def others():
            with lock:
                return "\n".join(f"- agent {j + 1}: " + " → ".join(p) for j, p in live.items() if j != i and p)
        def on_path(p):
            with lock:
                live[i] = p
        try:
            res, sc, errs = run_iteration(spec, url, session_dir / "runs" / f"it{it}-agent{i + 1}", model, "base",
                                          route=plan["route"], start=plan["start"], known=known,
                                          order=orders[i % len(orders)], others_fn=others, on_path=on_path)
            r = summary_of(model, "base", res, sc, errs, it)
            r["path"] = res.get("path") or []
            record_test(sb, tid, plan["label"], res, sc, errs, f"exploration agent {i + 1}")
        except Exception as e:  # noqa: BLE001
            r = {"iteration": it, "model": model, "variant": "base", "success_rate": 0.0, "false_success": False,
                 "seconds": 0, "calls": 0, "errors": [str(e)[:200]], "path": []}
        r.update(start=plan["start"], label=plan["label"], route=" → ".join(r["path"]) or "(aucun chemin)")
        return r

    with ThreadPoolExecutor(max_workers=width) as pool:
        return list(pool.map(lambda a: one(*a), enumerate(plans)))


BRICKS_JS = """() => [...document.querySelectorAll('body *')]
  .filter((e) => { const r = e.getBoundingClientRect(); const t = (e.innerText || '').trim();
                   const clickable = /^(BUTTON|A)$/.test(e.tagName) || e.getAttribute('role') === 'tab' || e.onclick
                     || getComputedStyle(e).cursor === 'pointer';
                   return clickable && r.top < 140 && r.width > 0 && r.height > 0 && t && t.length < 30 && t.split(String.fromCharCode(10)).length === 1
                     && !/acheter|panier|payer|envoyer|valider|supprimer/i.test(t); })
  .map((e) => e.innerText.trim()).filter((t, i, a) => a.indexOf(t) === i)"""


def list_bricks(url: str) -> list[str]:
    """Les briques de départ possibles : les onglets / liens de navigation visibles en haut du jumeau."""
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        pg = b.new_page(viewport={"width": 1280, "height": 800})
        pg.goto(url)
        pg.wait_for_timeout(600)
        bricks = pg.evaluate(BRICKS_JS) or []
        b.close()
    return bricks[:8]


def summary_of(model, variant, res, sc, errs, it):
    return {"iteration": it, "model": model, "variant": variant, "success_rate": round(sc, 3),
            "claimed_success": res["claimed_success"], "false_success": bool(res["claimed_success"]) and sc < 1,
            "seconds": res["stats"]["seconds"], "calls": res["stats"]["calls"], "blocked": res["stats"]["blocked"],
            "done_refused": res["stats"].get("done_refused", 0), "errors": errs[:3]}


# ---------------------------------------------------------------- phase 2 : casse (3 itérations au plus)

def casse(session_dir: Path) -> None:
    """1 itération = 1 solution, l'une après l'autre (un agent seul va ~2 fois plus vite que trois en parallèle).
    L'itération 1 (chemin de l'employé, ou libre) a déjà tourné pendant la question. Chaque itération suivante part
    d'une autre brique du jumeau et connaît les chemins déjà essayés. Arrêt dès qu'un chemin atteint 100 % ou après
    DISCOVERY_ITERATIONS itérations ; puis le meilleur chemin passe le test de trafic (popup + lenteur, en parallèle)."""
    from concurrent.futures import ThreadPoolExecutor
    st = State(session_dir)
    tid = st.data["task_id"]
    spec = json.loads((session_dir / "twin" / "spec.json").read_text(encoding="utf-8"))
    sb = Supa()
    sb.update("taches", f"id=eq.{tid}", {"status": "confirmed"})
    url, srv = serve(session_dir / "twin")
    max_it = int(os.environ.get("DISCOVERY_ITERATIONS", "3"))
    results = list(st.data.get("iterations") or [])
    r0 = route_zero(session_dir)

    def one(it, start=None, known=None, variant="base", route=None, label=None):
        try:
            res, sc, errs = run_iteration(spec, url, session_dir / "runs" / f"it{it}-{variant}", CASSE_MODEL, variant,
                                          route=route, start=start, known=known)
            r = summary_of(CASSE_MODEL, variant, res, sc, errs, it)
            r["path"] = res.get("path") or []
            record_test(sb, tid, f"{label or start or 'libre'} / {variant}", res, sc, errs, f"itération {it}")
        except Exception as e:  # noqa: BLE001
            r = {"iteration": it, "model": CASSE_MODEL, "variant": variant, "success_rate": 0.0, "false_success": False,
                 "seconds": 0, "calls": 0, "errors": [str(e)[:200]], "path": []}
        r.update(start=start, label=label or (f"départ « {start} »" if start else "libre"),
                 route=" → ".join(r["path"]) or "(aucun chemin)")
        return r

    def progress(msg):
        st.set(phase="casse", iterations=results, message=msg,
               progress={"done": len(results), "total": max_it + 2})

    try:
        if not any(r["success_rate"] >= 1 for r in results) and len(results) < max_it * 2:
            progress("Nouvelle vague de 3 parcours différents")
            bricks = (st.data.get("bricks") or list_bricks(url) or [None])
            rest = [b for b in bricks if b not in {r.get("start") for r in results}] or bricks
            known = sorted({r["route"] for r in results if r.get("path")})
            results += parallel_wave(spec, url, session_dir, CASSE_MODEL, len(results) + 1, rest, known, None, sb, tid)
        best = max(results, key=lambda r: (r["success_rate"], -r["seconds"]), default=None)
        if best and best["success_rate"] >= 0.9 and best.get("kind") != "n8n":  # n8n : pas de trafic écran à tester
            progress("Test du meilleur chemin avec popup et lenteur")
            base = len(results)
            route = r0 if best.get("label") == "chemin de l'employé" else None
            with ThreadPoolExecutor(max_workers=2) as pool:
                results += list(pool.map(lambda a: one(base + a[0] + 1, start=best.get("start"), variant=a[1], route=route,
                                                       label=best.get("label")), enumerate(["popup", "lent"])))
    finally:
        srv.shutdown()
    sb.update("taches", f"id=eq.{tid}", {"status": "tested"})
    solution = propose(results)
    try:
        sb.insert("recommendations", {
            "task_id": tid, "kind": solution["kind"], "confidence": solution["confidence"], "summary": solution["texte"],
            "reasons": solution["raisons"], "model": solution.get("modele"),
            "plan": [{"position": i + 1, "item_type": "plan_step", "method": "holo", "description": c["chemin"]}
                     for i, c in enumerate(solution.get("catalogue", [])[:5])],
            "deliverable_type": "n8n_workflow" if solution["kind"] == "automate" else "video_tuto",
        })
    except Exception as e:  # noqa: BLE001
        print("recommandation non enregistrée :", e, flush=True)
    st.set(phase="done", message="Casse terminée", iterations=results, solution=solution,
           progress={"done": len(results), "total": len(results)})


def slug_route(route: dict) -> str:
    return re.sub(r"[^a-z0-9]+", "-", unicodedata.normalize("NFKD", route["nom"]).encode("ascii", "ignore").decode().lower())[:30]


def propose(results: list[dict]) -> dict:
    """Catalogue des chemins découverts (le meilleur essai de chacun), classés par réussite puis rapidité.
    La meilleure solution doit aussi tenir sous « trafic » (popup, lenteur) pour être recommandée avec confiance."""
    explo = [r for r in results if r.get("variant", "base") == "base" and r.get("path")]
    best_by: dict[str, dict] = {}
    for r in explo:
        k = r["route"]
        if k not in best_by or (r["success_rate"], -r["seconds"]) > (best_by[k]["success_rate"], -best_by[k]["seconds"]):
            best_by[k] = r
    ranked = sorted(best_by.values(), key=lambda r: (-r["success_rate"], r["seconds"]))
    model = ranked[0]["model"] if ranked else CASSE_MODEL
    catalogue = [{"chemin": f"{r.get('label') or 'libre'} : {r['route']}", "depart": r.get("start"),
                  "reussite": round(r["success_rate"] * 100),
                  "duree_s": round(r["seconds"]), "etapes": r["calls"]} for r in ranked]
    traffic = [r for r in results if r.get("variant") in ("popup", "lent")]
    tient = bool(traffic) and all(r["success_rate"] >= 0.9 for r in traffic)
    cls = next((r.get("classification") for r in results if r.get("classification")), None)
    raisons = []
    if cls:
        raisons.append(f"mode d'automatisation : {cls['mode']} ("
                       + ", ".join(f"{o['nom']} : {o['acces']}" for o in cls.get("outils", [])) + ")")
    raisons.append(f"{len(catalogue)} solution(s) différente(s) testée(s) sur {len(results)} essai(s)")
    raisons += [f"{c['reussite']} %, {c['duree_s']} s, {c['etapes']} étapes : {c['chemin']}" for c in catalogue[:3]]
    if traffic:
        raisons.append("le meilleur chemin " + ("tient" if tient else "ne tient pas toujours") + " avec popup et lenteur : "
                       + ", ".join(f"{r['variant']} {round(r['success_rate'] * 100)} %" for r in traffic))
    if ranked and ranked[0]["success_rate"] >= 0.9:
        if ranked[0].get("kind") == "n8n":
            native = (ranked[0].get("mode") == "n8n natif")
            return {"kind": "automate", "confidence": "high", "modele": model, "livrable": "n8n",
                    "texte": (f"Automatiser avec n8n natif ({ranked[0]['label']}) : aucun agent Holo nécessaire."
                              if native else
                              f"Automatiser avec n8n : des blocs Holo ({model}) lisent seulement ce qui n'a ni API ni page "
                              "lisible, l'API écrit le résultat.") + " C'est la solution la plus rapide et la plus fiable trouvée.",
                    "raisons": raisons, "catalogue": catalogue}
        return {"kind": "automate", "confidence": "high" if tient else "medium", "modele": model,
                "texte": f"Automatiser avec Holo ({model}) en suivant le meilleur chemin découvert, avec une vérification "
                         "du résultat à chaque exécution.", "raisons": raisons, "catalogue": catalogue}
    return {"kind": "accelerate", "confidence": "low", "modele": model,
            "texte": "Aucun chemin n'est encore assez fiable : Twiin propose d'accélérer la tâche (tuto + raccourcis) "
                     "et réessaiera l'automatisation après correction des points fragiles.",
            "raisons": raisons, "catalogue": catalogue}


def answer(session_dir: Path) -> None:
    """Enregistre la réponse de l'employé (écrite par le serveur dans discovery.json), puis lance la casse si c'est oui."""
    st = State(session_dir)
    ans = st.data.get("answer") or {}
    sb = Supa()
    conf = {"question": st.data.get("question"), "answer": "oui" if ans.get("ok") else "non",
            "correction": ans.get("correction") or None, "answered_at": datetime.now(timezone.utc).isoformat()}
    sb.update("taches", f"id=eq.{st.data['task_id']}", {"confirmation": conf})
    if ans.get("ok"):
        casse(session_dir)
    else:
        st.set(phase="corrected", message="L'employé a corrigé la compréhension : à reprendre avant toute casse")


def main():
    cmds = {"discover": discover, "casse": casse, "answer": answer}
    if len(sys.argv) != 3 or sys.argv[1] not in cmds:
        sys.exit(__doc__)
    session_dir = Path(sys.argv[2]).resolve()
    try:
        cmds[sys.argv[1]](session_dir)
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        State(session_dir).set(phase="error", message=str(e)[:300])
        sys.exit(1)


if __name__ == "__main__":
    main()
