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
DEV_MODEL = os.environ.get("DISCOVERY_DEV_MODEL", "holo3-1-35b-a3b")
CASSE_MODELS = [m.strip() for m in os.environ.get("DISCOVERY_CASSE_MODELS", "holo3-1-35b-a3b,holo4-35b-a3b").split(",") if m.strip()]
MAX_IMAGES = 6

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

TWIN_PROMPT = """You prepare an INTERNAL test environment (a "twin") for a task an employee recorded on their computer.
The employee will NEVER see the twin. It is used to replay and stress-test automations safely, without touching
their real software or data.

You receive: the task steps found by a previous analysis, a few screenshots of the recording, and documentation
about the software involved. Produce TWO blocks, in this order, and nothing else:

```json
{
 "cadrage": {
   "probleme": "one sentence, in French, from the employee's point of view: what they do and why it costs time",
   "etapes": ["3 to 5 short steps in French, as the employee would describe them"],
   "outils": ["software / websites used"],
   "objectif": "accélérer | automatiser, with a few words",
   "doutes": ["0 to 3 things to confirm with the employee, in French"]
 },
 "mission": "English instruction for a computer-use agent working INSIDE THE TWIN, as the employee would ask a colleague: the goal and where to look, ending with 'then call done'. Do NOT give the values to copy: the agent must READ them in the twin pages (that is what we test). Never ask to buy, send, pay, validate or delete.",
 "expected": {"rows": [{"<column>": "<exact expected value>"}]},
 "fidelite": "low | medium | high : how close the twin is to the real tools, given what the screenshots show"
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

    def set(self, **kw):
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
    st = State(session_dir)
    st.set(phase="upload", message="Envoi de la tâche dans la base", started_at=time.time())
    frames = load_frames(session_dir)
    cand = json.loads((ROOT / "workflows" / "candidates.json").read_text(encoding="utf-8")).get("workflows", [{}])[0]
    steps = cand.get("steps", [])
    sb = Supa()

    # 1. logiciels reconnus dans la tâche (nom du dictionnaire présent dans les étapes)
    dico = sb.select("dictionnaire", "select=id,name,has_api,connector,docs,screens")
    text = " ".join(steps + [cand.get("summary", ""), cand.get("name", "")]).lower()
    used = [d for d in dico if d["name"].lower() in text]

    # 2. la tâche + ses captures dans Supabase
    started, ended = (frames[0].get("timestamp"), frames[-1].get("timestamp")) if frames else (None, None)
    old = sb.select("taches", f"select=id&source_session_id=eq.{session_dir.name}")
    if old:  # nouvelle découverte du même enregistrement : on repart de zéro sur la même tâche
        sb._req("DELETE", f"/rest/v1/taches?id=eq.{old[0]['id']}")
    task = sb.insert("taches", {
        "company_id": sb.company_id, "title": cand.get("name") or "Tâche enregistrée", "summary": cand.get("summary"),
        "context": cand.get("general_intent"), "status": "processing", "software_ids": [d["id"] for d in used],
        "steps": [{"position": i + 1, "instruction": s} for i, s in enumerate(steps)],
        "source_session_id": session_dir.name, "started_at": started, "ended_at": ended,
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=30)).isoformat(),
        "stats": {"frames": len(frames)},
    })
    tid = task["id"]
    st.set(task_id=tid, message=f"Tâche {tid} créée, envoi de {len(frames)} captures")
    shots = []
    for f in frames:
        b = base64.b64decode(f["dataUrl"].split(",", 1)[1])
        p = f"{sb.company_id}/{tid}/frame-{int(f.get('index', 0)):04d}.jpg"
        try:
            sb.upload("task-captures", p, b, "image/jpeg")
            shots.append({"storage_path": p, "screen_index": int(f.get("screen", 1)) - 1, "at_ms": int(f.get("seconds", 0)) * 1000})
        except Exception as e:  # noqa: BLE001
            print("capture non envoyée :", e, flush=True)
    sb.update("taches", f"id=eq.{tid}", {"screenshots": shots})

    # 3. fiche de cadrage + mission + jumeau (modèle de vision)
    st.set(phase="twin", message="Construction de l'environnement de test (jumeau)")
    pick = frames[:: max(1, len(frames) // MAX_IMAGES)][:MAX_IMAGES]
    docs = "\n".join(f"- {d['name']} ({'API ' + (d['connector'] or '') if d['has_api'] else 'pas d API'}) : "
                     + " | ".join((x.get("title", "") + " : " + x.get("excerpt", "")[:300]) for x in (d.get("docs") or [])[:2])
                     for d in used) or "(aucun logiciel du dictionnaire reconnu)"
    content = [{"type": "text", "text": f"TASK: {cand.get('name', '')}\nSUMMARY: {cand.get('summary', '')}\nSTEPS:\n"
                + "\n".join(f"{i + 1}. {s}" for i, s in enumerate(steps)) + f"\n\nSOFTWARE (dictionnaire):\n{docs}"}]
    for f in pick:
        content += [{"type": "text", "text": f"Screenshot t+{f.get('seconds', '?')}s"},
                    {"type": "image_url", "image_url": {"url": f["dataUrl"]}}]
    t0 = time.time()
    resp = hf_client().chat.completions.create(
        model=HF_MODEL, max_tokens=16000, temperature=0.2,
        messages=[{"role": "system", "content": TWIN_PROMPT}, {"role": "user", "content": content}],
        extra_body={"reasoning_effort": os.environ.get("HF_REASONING_EFFORT", "low")})
    raw = resp.choices[0].message.content or ""
    spec_txt, html = fenced(raw, "json"), fenced(raw, "html")
    if not spec_txt or not html:
        (session_dir / "twin_raw.txt").write_text(raw, encoding="utf-8")
        raise RuntimeError("le modèle n'a pas rendu la fiche et le jumeau attendus (voir twin_raw.txt)")
    spec = json.loads(spec_txt)
    twin_dir = session_dir / "twin"
    twin_dir.mkdir(exist_ok=True)
    (twin_dir / "index.html").write_text(html, encoding="utf-8")
    (twin_dir / "spec.json").write_text(json.dumps(spec, ensure_ascii=False, indent=1), encoding="utf-8")
    hf_cost = getattr(resp.usage, "cost", None) if resp.usage else None
    st.set(message=f"Jumeau construit en {time.time() - t0:.0f} s", twin_cost_usd=hf_cost)

    # 4. test « dev » : le jumeau est-il rejouable ?
    st.set(phase="dev_test", message=f"Test de l'environnement par Holo ({DEV_MODEL})")
    url, srv = serve(twin_dir)
    try:
        res = run_agent(url, spec["mission"], session_dir / "runs" / "dev", DEV_MODEL, max_steps=int(os.environ.get("DISCOVERY_MAX_STEPS", "30")))
    finally:
        srv.shutdown()
    sc, errs = score(spec.get("expected"), res["state"])
    record_test(sb, tid, "base", res, sc, errs, "dev")
    dev = {"model": DEV_MODEL, "success_rate": round(sc, 3), "claimed_success": res["claimed_success"],
           "seconds": res["stats"]["seconds"], "calls": res["stats"]["calls"], "errors": errs}

    # 5. question à l'employé
    question = {"titre": "Ai-je bien compris votre problème ?", **spec["cadrage"]}
    sb.update("taches", f"id=eq.{tid}", {"status": "analysed",
                                          "twin": {"fidelite": spec.get("fidelite"), "mission": spec["mission"],
                                                   "expected": spec.get("expected"), "dev_test": dev, "hf_cost_usd": hf_cost},
                                          "confirmation": {"question": question, "asked_at": datetime.now(timezone.utc).isoformat()}})
    st.set(phase="awaiting_confirmation", message="Question posée à l'employé", question=question, dev_test=dev,
           fidelite=spec.get("fidelite"))


# ---------------------------------------------------------------- phase 2 : casse

def casse(session_dir: Path) -> None:
    st = State(session_dir)
    tid = st.data["task_id"]
    spec = json.loads((session_dir / "twin" / "spec.json").read_text(encoding="utf-8"))
    sb = Supa()
    sb.update("taches", f"id=eq.{tid}", {"status": "confirmed"})
    results = []
    url, srv = serve(session_dir / "twin")
    try:
        for model in CASSE_MODELS:
            for name, script in VARIANTS.items():
                st.set(phase="casse", message=f"Casse : variante {name} avec {model}", casse=results)
                try:
                    res = run_agent(url, spec["mission"], session_dir / "runs" / f"casse-{model}-{name}", model,
                                    max_steps=int(os.environ.get("DISCOVERY_MAX_STEPS", "30")), init_script=script)
                except Exception as e:  # noqa: BLE001
                    results.append({"model": model, "variant": name, "error": str(e)[:200]})
                    continue
                sc, errs = score(spec.get("expected"), res["state"])
                record_test(sb, tid, name, res, sc, errs, "casse")
                results.append({"model": model, "variant": name, "success_rate": round(sc, 3),
                                "claimed_success": res["claimed_success"],
                                "false_success": bool(res["claimed_success"]) and sc < 1,
                                "seconds": res["stats"]["seconds"], "calls": res["stats"]["calls"],
                                "blocked": res["stats"]["blocked"], "errors": errs[:3]})
    finally:
        srv.shutdown()
    sb.update("taches", f"id=eq.{tid}", {"status": "tested"})
    solution = propose(results)
    try:
        sb.insert("recommendations", {
            "task_id": tid, "kind": solution["kind"], "confidence": solution["confidence"], "summary": solution["texte"],
            "reasons": solution["raisons"], "model": solution.get("modele"),
            "plan": [{"position": 1, "item_type": "plan_step", "method": "holo" if solution["kind"] == "automate" else "manual",
                      "description": solution["texte"]}],
            "deliverable_type": "n8n_workflow" if solution["kind"] == "automate" else "video_tuto",
        })
    except Exception as e:  # noqa: BLE001
        print("recommandation non enregistrée :", e, flush=True)
    st.set(phase="done", message="Casse terminée", casse=results, solution=solution)


def propose(results: list[dict]) -> dict:
    """Choisit la solution à partir des essais : le modèle le plus fiable sous perturbations, sinon accélérer (tuto)."""
    by_model: dict[str, list[dict]] = {}
    for r in results:
        if "success_rate" in r:
            by_model.setdefault(r["model"], []).append(r)
    ranking = []
    for m, rs in by_model.items():
        avg = sum(r["success_rate"] for r in rs) / len(rs)
        full = sum(1 for r in rs if r["success_rate"] >= 1)
        faux = sum(1 for r in rs if r["false_success"])
        secs = sum(r["seconds"] for r in rs) / len(rs)
        ranking.append({"modele": m, "moyenne": round(avg, 3), "reussites": full, "essais": len(rs), "faux_reussis": faux,
                        "duree_moy_s": round(secs), "gratuit": m == "holo3-1-35b-a3b"})
    ranking.sort(key=lambda r: (-r["moyenne"], r["faux_reussis"], not r["gratuit"], r["duree_moy_s"]))
    if not ranking:
        return {"kind": "accelerate", "confidence": "low", "texte": "Aucun essai exploitable : Twiin propose un tuto pour accélérer la tâche.",
                "raisons": ["les essais automatiques ont échoué"], "classement": []}
    best = ranking[0]
    fragile = [r["variant"] for r in results if r.get("model") == best["modele"] and r.get("success_rate", 0) < 1]
    raisons = [f"{best['reussites']}/{best['essais']} essais parfaits avec {best['modele']} (moyenne {round(best['moyenne'] * 100)} %)",
               f"durée moyenne {best['duree_moy_s']} s par exécution"]
    if fragile:
        raisons.append("fragile face à : " + ", ".join(fragile))
    if best["faux_reussis"]:
        raisons.append(f"{best['faux_reussis']} faux « réussi » : une vérification automatique est indispensable")
    if best["moyenne"] >= 0.9 and best["reussites"] >= max(1, best["essais"] - 1):
        return {"kind": "automate", "confidence": "high" if not fragile else "medium", "modele": best["modele"],
                "texte": f"Automatiser la tâche avec Holo ({best['modele']}{', gratuit' if best['gratuit'] else ''}) "
                         "et une vérification du résultat à chaque exécution.", "raisons": raisons, "classement": ranking}
    return {"kind": "accelerate", "confidence": "medium" if best["moyenne"] >= 0.6 else "low", "modele": best["modele"],
            "texte": "L'automatisation n'est pas encore assez fiable : Twiin propose d'accélérer la tâche (tuto + raccourcis) "
                     "et de réessayer l'automatisation après correction des points fragiles.",
            "raisons": raisons, "classement": ranking}


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
