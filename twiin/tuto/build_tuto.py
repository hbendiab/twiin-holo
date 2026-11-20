#!/usr/bin/env python3
"""Construit les données d'un TUTO VIDÉO Twiin, à partir d'un rejeu de Holo OU de l'enregistrement de l'employé.

    .venv/bin/python tuto/build_tuto.py workflows/runs/<rejeu>-local.json [--name veille-loreal] [--advice advice.json]
    .venv/bin/python tuto/build_tuto.py --session workflows/sessions/<date> --workflow tache.json --name ma-tache

Mode « enregistrement » (bouton « Créer le tuto vidéo » de la page Twiin) : les images viennent de l'enregistrement
de l'employé (pas de crédit H, Holo ne prend pas la souris). Le modèle relie chaque étape à son moment dans le journal
d'actions ; on garde les images de ce moment, avec la position des clics.

1. récupère chez H, pour chaque étape du rejeu (une session par étape), les captures d'écran et les actions de Holo
   (clic avec sa position, saisie, raccourci) ;
2. choisit quelques images par étape (avant chaque clic ou saisie) ;
3. fait écrire la voix off en français (courte : le forfait gratuit ElevenLabs est de 10 000 caractères/mois) ;
4. la fait dire par une des 5 voix françaises de VOIX_TUTO (tirée du nom du tuto, modèle multilingue, qualité studio) ;
5. écrit tout dans tuto/remotion/public/tutos/<nom>/ + un props.json pour la composition Remotion « TwiinTuto ».
"""
import argparse
import json
import os
import re
import shutil
import sys
from pathlib import Path

import requests
from dotenv import dotenv_values
from mutagen.mp3 import MP3

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from twiin.clients.holo.holo_agent import HoloAgent  # noqa: E402

ENV = dotenv_values(ROOT / ".env")
ENV.update({k: v for k, v in os.environ.items() if k in ("HF_TOKEN", "ELEVENLABS_API_KEY", "HAI_API_KEY", "HF_BASE_URL",
                                                         "ELEVENLABS_BASE_URL", "HAI_BASE_URL", "TWIIN_RELAIS") and v})  # relais Twiin
HF_BASE = ENV.get("HF_BASE_URL") or "https://router.huggingface.co/v1"
ELEVEN_BASE = (ENV.get("ELEVENLABS_BASE_URL") or "https://api.elevenlabs.io").rstrip("/")
REMOTION_PUBLIC = ROOT / "tuto" / "video" / "public" / "tutos"
FPS = 30
MAX_SHOTS_PER_STEP = 2  # une image par étape, deux au plus : une vidéo calme, qui montre ce que dit la voix
NARRATION_MAX_CHARS = 1500  # garde de la marge sur le quota gratuit ElevenLabs


def clean(s):
    return (s or "").strip().strip(".").strip()


def session_events(client, sid):
    out, page = [], 1
    while True:
        p = client.sessions.list_session_events(id=sid, page=page, size=100, sort="timestamp")
        items = list(p.items or [])
        out += [e.dict() for e in items]
        if len(items) < 100:
            return out
        page += 1


def describe(tool, args):
    if tool in ("click_desktop", "double_click_desktop", "click", "left_click"):
        return f"clic sur {args.get('element') or 'un élément'}"
    if tool in ("write_desktop", "type_desktop", "write"):
        return f"saisie « {str(args.get('content', ''))[:40]} »"
    if tool in ("hotkey_desktop", "hotkey"):
        return "raccourci " + "+".join(args.get("keys", []))
    if tool.startswith("scroll"):
        return "défilement"
    return tool.replace("_desktop", "")


def shots_for_session(client, sid):
    """Liste (url_image, action, clic_normalisé) dans l'ordre : chaque action avec la capture vue juste avant."""
    last_img, shots = None, []
    for e in session_events(client, sid):
        data = e.get("data") or {}
        if data.get("kind") == "observation_event" and (data.get("image") or {}).get("source"):
            last_img = data["image"]["source"]
        elif data.get("kind") == "tool_result" and last_img:
            req = data.get("tool_req") or {}
            tool, args = req.get("tool_name", ""), req.get("args") or {}
            if tool in ("answer", "wait_desktop", "screenshot_desktop"):
                continue
            click = None
            if "x" in args and "y" in args and isinstance(args["x"], (int, float)):
                x, y = float(args["x"]), float(args["y"])
                click = {"x": x if x <= 1 else None, "y": y if y <= 1 else None}
                if click["x"] is None:
                    click = None
            shots.append({"url": last_img, "action": describe(tool, args), "click": click, "kind": tool})
    if last_img:
        shots.append({"url": last_img, "action": "résultat", "click": None, "kind": "final"})
    return shots


def pick(shots, n):
    """Garde surtout les clics et saisies, répartis sur l'étape, + l'image finale."""
    useful = [s for s in shots if s["kind"] != "final" and ("click" in s["kind"] or "write" in s["kind"])] or shots[:-1]
    if len(useful) > n - 1:
        step = len(useful) / (n - 1)
        useful = [useful[int(i * step)] for i in range(n - 1)]
    final = [s for s in shots if s["kind"] == "final"][-1:]
    seen, out = set(), []
    for s in useful + final:
        if s["url"] not in seen:
            seen.add(s["url"])
            out.append(s)
    return out


def write_narration(task_name, steps, answers, advice):
    """Texte de la voix off (français, tutoiement), via le modèle d'analyse d'ImproveMe (texte seul)."""
    from openai import OpenAI
    client = OpenAI(base_url=HF_BASE, api_key=ENV["HF_TOKEN"])
    tips = "\n".join(f"- {r.get('title')}: {r.get('suggestion')}" for r in (advice or {}).get("recommendations", []))
    prompt = (
        "Tu écris la voix off d'un tuto vidéo qui montre à un salarié comment faire sa tâche plus vite. "
        "Tutoiement, phrases courtes et naturelles, à l'oral. Total de TOUS les textes : moins de "
        f"{NARRATION_MAX_CHARS} caractères. Pour chaque étape : un titre court (≤ 40 caractères), une narration "
        "(≤ 220 caractères) qui dit quoi faire en nommant ce qu'on voit à l'écran (bouton, menu, champ), et une astuce (≤ 90 caractères) qui fait gagner du temps si elle existe.\n\n"
        f"Tâche : {task_name}\nÉtapes :\n" + "\n".join(f"{i}. {s}" for i, s in enumerate(steps, 1)) +
        "\n\nCe que l'employé a fait à chaque étape (ce que montre l'image) :\n" +
        "\n".join(f"{i}. {clean(a)[:300]}" for i, a in enumerate(answers, 1)) +
        (f"\n\nAstuces d'amélioration déjà identifiées :\n{tips}" if tips else "") +
        '\n\nRéponds UNIQUEMENT en JSON, sans guillemets droits dans les textes (utilise « ») : '
        '{"title":"titre du tuto","intro":"≤ 140 caractères","steps":[{"title":"","narration":"","tip":""}],'
        '"outro":"≤ 140 caractères"}'
    )
    # Le modèle renvoie parfois une réponse vide ou tronquée : 3 essais, puis un texte de secours tiré des étapes,
    # pour que la vidéo sorte toujours.
    for attempt in range(3):
        try:
            # Pas de raisonnement : sinon le modèle « réfléchit » jusqu'à la limite et ne renvoie aucun texte
            r = client.chat.completions.create(model=ENV.get("HF_MODEL") or "Qwen/Qwen3.8-27B", max_tokens=6000, temperature=0.3,
                                               reasoning_effort="none", messages=[{"role": "user", "content": prompt}])
            raw = re.sub(r"<think>.*?</think>", "", r.choices[0].message.content or "", flags=re.S)
            raw = raw[raw.find("{"): raw.rfind("}") + 1]
            if not raw:
                u = r.usage
                raise ValueError(f"réponse vide (fin : {r.choices[0].finish_reason}, raisonnement : "
                                 f"{getattr(u.completion_tokens_details, 'reasoning_tokens', '?') if u else '?'} jetons)")
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                from json_repair import repair_json  # secours
                data = json.loads(repair_json(raw) or "{}")
            if len(data.get("steps", [])) == len(steps):
                return data
            print(f"voix off : {len(data.get('steps', []))} étapes au lieu de {len(steps)}, nouvel essai", flush=True)
        except Exception as e:  # noqa: BLE001
            print(f"voix off : essai {attempt + 1} raté ({e}), nouvel essai", flush=True)
    print("voix off : texte de secours tiré des étapes", flush=True)
    short = lambda t, n: t if len(t) <= n else t[: n - 1].rsplit(" ", 1)[0] + "…"
    return {"title": short(task_name, 60), "intro": short(f"Voici comment faire : {task_name}.", 140),
            "steps": [{"title": short(s, 40), "narration": short(s, 220), "tip": ""} for s in steps],
            "outro": "Et voilà, à toi de jouer."}


# Voix françaises natives (bibliothèque ElevenLabs, qualité studio). Chaque tuto en reçoit une, toujours la même
# pour un même tuto (tirée de son nom) : la voix ne change pas au milieu d'une vidéo, et les tutos varient entre eux.
VOIX_TUTO = {
    "Jeanne": "txtf1EDouKke753vN8SL",   # jeune femme parisienne, narration pédagogique
    "Claire": "6vTyAgAT8PncODBcLjRf",   # femme, chaleureuse et posée
    "Lucie": "YxrwjAKoUKULGd0g8K9Y",    # femme, ton de conseillère, empathique
    "Nicolas": "aQROLel5sQbj1vuIVi6B",  # homme, narrateur parisien
    "Léo": "AfbuxQ9DVtS4azaxN1W7",      # homme, rassurant et dynamique
}


def voix_pour(nom_tuto):
    # ELEVENLABS_TUTO_VOICE_ID (facultatif) : une voix unique pour tous les tutos, ex. une voix du forfait gratuit
    if ENV.get("ELEVENLABS_TUTO_VOICE_ID", "").strip():
        return "Voix imposée", ENV["ELEVENLABS_TUTO_VOICE_ID"].strip()
    import hashlib
    noms = list(VOIX_TUTO)
    nom = noms[int(hashlib.sha1(nom_tuto.encode()).hexdigest(), 16) % len(noms)]
    return nom, VOIX_TUTO[nom]


# Iris et Ilo racontent le tuto à tour de rôle (mêmes voix et réglages que dans le SaaS, recorder/server.js JUMEAUX)
JUMEAUX = {
    "iris": ("O31r762Gb3WFygrEOGh0", {"stability": 0.4, "similarity_boost": 0.8, "style": 0.5, "use_speaker_boost": True}),
    "ilo": ("IHngRooVccHyPqB4uQkG", {"stability": 0.6, "similarity_boost": 0.8, "style": 0.15, "use_speaker_boost": False}),
}


def tts(text, out: Path, vid, reglages=None):
    corps = {"text": text, "model_id": "eleven_multilingual_v2", **({"voice_settings": reglages} if reglages else {})}
    r = requests.post(f"{ELEVEN_BASE}/v1/text-to-speech/{vid}?output_format=mp3_44100_192",
                      headers={"xi-api-key": ENV["ELEVENLABS_API_KEY"].strip(), "Content-Type": "application/json"},
                      json=corps, timeout=120)
    if not r.ok:
        raise SystemExit(f"ElevenLabs : {r.status_code} {r.text[:200]}")
    out.write_bytes(r.content)
    return MP3(out).info.length


def load_session(session: Path):
    """Images (dans l'ordre) + journal d'actions + début de l'enregistrement d'une session de la page Twiin."""
    frames, started = [], None
    if (session / "frames.jsonl").exists():
        frames = [json.loads(l) for l in (session / "frames.jsonl").read_text().splitlines() if l.strip()]
    elif (session / "frames.json").exists():
        d = json.loads((session / "frames.json").read_text())
        frames, started = d.get("frames", []), d.get("startedAt")
    meta = session / "session.json"
    if meta.exists():
        started = json.loads(meta.read_text()).get("startedAt") or started
    actions = []
    if (session / "actions.jsonl").exists():
        actions = [json.loads(l) for l in (session / "actions.jsonl").read_text().splitlines() if l.strip()]
    started = (started or 0) / 1000 or (actions[0]["ts"] if actions else 0)
    return sorted(frames, key=lambda f: f.get("seconds", 0)), actions, started


def action_line(e, t0):
    what = {"click": f"clic sur {e.get('element') or 'un élément'}", "typing": f"saisie ({e.get('keys', '?')} frappes) dans {e.get('element') or 'un champ'}",
            "shortcut": f"raccourci {e.get('keys')}", "key": f"touche {e.get('keys')}",
            "app": f"{e.get('app')} au premier plan — {e.get('window') or ''}"}.get(e["type"])
    return f"t+{e['ts'] - t0:.1f}s · écran {e.get('display', '?')} · {e.get('app') or ''} · {what}" if what else None


def map_steps_to_time(steps, actions, frames, t0):
    """Le modèle relie chaque étape à son moment dans l'enregistrement (début et fin, en secondes)."""
    from openai import OpenAI
    client = OpenAI(base_url=HF_BASE, api_key=ENV["HF_TOKEN"])
    log = "\n".join(x for x in (action_line(e, t0) for e in actions) if x)
    imgs = "\n".join(f"image {i}: t+{f.get('seconds', 0)}s écran {f.get('screen', 1)}" for i, f in enumerate(frames))
    prompt = ("Voici les étapes d'une tâche et le journal horodaté de l'enregistrement où l'employé l'a faite. Pour chaque "
              "étape, donne le moment où elle est faite (début et fin, en secondes depuis le début). Les étapes sont dans "
              "l'ordre ; les moments aussi.\n\nÉTAPES\n" + "\n".join(f"{i}. {s}" for i, s in enumerate(steps, 1)) +
              f"\n\nJOURNAL\n{log or '(vide)'}\n\nIMAGES GARDÉES\n{imgs}\n\n"
              'Réponds UNIQUEMENT en JSON : {"steps":[{"start":0,"end":0}]} avec exactement une entrée par étape.')
    spans = []
    for attempt in range(2):  # le modèle renvoie parfois une réponse vide : un second essai, puis le découpage de secours
        try:
            r = client.chat.completions.create(model=ENV.get("HF_MODEL") or "Qwen/Qwen3.8-27B", max_tokens=12000, temperature=0,
                                               reasoning_effort="low", messages=[{"role": "user", "content": prompt}])
            raw = re.sub(r"<think>.*?</think>", "", r.choices[0].message.content or "", flags=re.S)
            raw = raw[raw.find("{"): raw.rfind("}") + 1]
            try:
                spans = json.loads(raw).get("steps", [])
            except json.JSONDecodeError:
                from json_repair import repair_json
                spans = json.loads(repair_json(raw) or "{}").get("steps", [])
        except Exception as e:
            print(f"(correspondance étapes ↔ images : essai {attempt + 1} raté, {e})", flush=True)
        if len(spans) == len(steps):
            break
    if len(spans) != len(steps):  # secours : on découpe l'enregistrement en parts égales
        print("(correspondance étapes ↔ images : découpage en parts égales)", flush=True)
        end = frames[-1].get("seconds", 0) if frames else 0
        spans = [{"start": end * i / len(steps), "end": end * (i + 1) / len(steps)} for i in range(len(steps))]
    return spans


def shots_from_recording(session: Path, steps, out_dir: Path, name: str):
    """Pour chaque étape : jusqu'à MAX_SHOTS_PER_STEP images de ce moment, avec la position du clic qui suit."""
    import base64
    from PIL import Image
    frames, actions, t0 = load_session(session)
    if not frames:
        raise SystemExit("Cet enregistrement n'a pas d'images.")
    displays = {d["id"]: d for e in actions if e.get("type") == "start" for d in e.get("displays", [])}
    spans = map_steps_to_time(steps, actions, frames, t0)
    per_step = []
    ft = lambda f: t0 + f.get("seconds", 0)  # moment de l'image (secondes, horloge du journal)
    disp_of = lambda f: int(m.group(1)) if (m := re.match(r"screen:(\d+):", f.get("screen_label") or "")) else None

    def click_in(f, e):
        d = displays.get(e.get("display"))
        if not d or (disp_of(f) is not None and e.get("display") != disp_of(f)):
            return None
        return {"x": max(0, min(1, (e["x"] - d["x"]) / d["w"])), "y": max(0, min(1, (e["y"] - d["y"]) / d["h"]))}

    for n, (step, span) in enumerate(zip(steps, spans), 1):
        a, b = float(span.get("start", 0)), float(span.get("end", 0))
        inside = [f for f in frames if a - 0.5 <= f.get("seconds", 0) <= b + 1.5]
        if not inside:
            inside = [min(frames, key=lambda f: abs(f.get("seconds", 0) - (a + b) / 2))]
        evs = [e for e in actions if t0 + a - 0.5 <= e.get("ts", 0) <= t0 + b + 1.5 and e.get("type") in ("click", "typing", "shortcut", "key")]
        clicks = [e for e in evs if e["type"] == "click"]
        typed = any(e["type"] != "click" for e in evs)
        # Images retenues : celle qui montre l'action dont parle la voix off
        #  - un clic : l'écran juste avant le clic (on voit où cliquer), avec le cercle sur l'endroit ;
        #  - une saisie, un raccourci, ou rien : l'écran à la fin de l'étape (on voit le résultat).
        chosen = []
        if clicks:
            c = clicks[0]
            before = [f for f in frames if ft(f) <= c["ts"] + 0.3 and (disp_of(f) is None or disp_of(f) == c.get("display"))]
            f1 = before[-1] if before else inside[0]
            chosen.append((f1, click_in(f1, c), f"clic sur {c.get('element') or 'un élément'}"))
        if typed or not clicks:
            last = inside[-1]
            if not chosen or last is not chosen[0][0]:
                chosen.append((last, None, "résultat"))
        chosen = chosen[:MAX_SHOTS_PER_STEP]
        shots = []
        for i, (f, click, action) in enumerate(chosen, 1):
            data = (f.get("ocrUrl") or f.get("dataUrl") or "").split(",", 1)[-1]
            if not data:
                continue
            dest = out_dir / f"etape{n}_{i}.jpg"
            dest.write_bytes(base64.b64decode(data))
            with Image.open(dest) as im:
                w, h = im.size
            shots.append({"src": f"tutos/{name}/{dest.name}", "w": w, "h": h, "click": click, "action": action})
        # Ce que l'employé a vraiment fait pendant l'étape : la voix off décrit ce qu'on voit à l'image
        faits = "; ".join(x for x in (action_line(e, t0) for e in evs[:5]) if x)
        per_step.append({"step": step, "answer": faits, "shots": shots})
        print(f"étape {n} : t+{a:.0f}-{b:.0f}s, {len(shots)} image(s) ({', '.join(s['action'] for s in shots)})", flush=True)
    return per_step


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("run", type=Path, nargs="?", help="journal du rejeu (workflows/runs/<date>-local.json)")
    ap.add_argument("--session", type=Path, help="dossier d'un enregistrement de la page Twiin (mode « enregistrement »)")
    ap.add_argument("--workflow", type=Path, help="JSON {name, steps} de la tâche (avec --session)")
    ap.add_argument("--name", default="tuto")
    ap.add_argument("--advice", type=Path, help="JSON des conseils « Améliorer mon process » (facultatif)")
    ap.add_argument("--no-voice", action="store_true", help="ne pas appeler ElevenLabs (durées estimées)")
    a = ap.parse_args()

    out_dir = REMOTION_PUBLIC / a.name
    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True)

    if a.session:  # mode « enregistrement » : images de l'employé, pas de Holo
        wf = json.loads(a.workflow.read_text())
        per_step = shots_from_recording(a.session, wf["steps"], out_dir, a.name)
        run = {"workflow": wf.get("name") or a.name}
    else:
        per_step = shots_from_holo_run(a, out_dir)
        run = json.loads(a.run.read_text())
    finish(a, run, per_step, out_dir)


def shots_from_holo_run(a, out_dir):
    run = json.loads(a.run.read_text())
    steps_done = [s for s in run["steps"] if s.get("status") in ("idle", "completed")]
    if len(run["sessions"]) != len(steps_done):
        print(f"(attention : {len(run['sessions'])} session(s) pour {len(steps_done)} étape(s) réussie(s))")
    client = HoloAgent().client
    key = ENV["HAI_API_KEY"].strip()
    per_step = []
    for n, (sid, st) in enumerate(zip(run["sessions"], steps_done), 1):
        shots = pick(shots_for_session(client, sid), MAX_SHOTS_PER_STEP)
        for k, s in enumerate(shots, 1):
            f = out_dir / f"etape{n}_{k}.jpg"
            u = s["url"]
            if ENV.get("TWIIN_RELAIS") and re.match(r"https://[a-z0-9.-]+\.hcompany\.ai/", u):  # images Holo via le relais
                u = ENV["TWIIN_RELAIS"].rstrip("/") + "/hai/" + u[len("https://"):]
            f.write_bytes(requests.get(u, headers={"Authorization": f"Bearer {key}"}, timeout=60).content)
            s["src"] = f"tutos/{a.name}/{f.name}"
            from PIL import Image
            with Image.open(f) as im:
                s["w"], s["h"] = im.size
        per_step.append({"step": st["step"], "answer": st.get("answer") or "", "shots": shots})
        print(f"étape {n} : {len(shots)} image(s)")
    return per_step


def finish(a, run, per_step, out_dir):
    advice = json.loads(a.advice.read_text()) if a.advice else None
    nar = write_narration(run.get("workflow", a.name), [p["step"] for p in per_step], [p["answer"] for p in per_step], advice)
    chars = len(nar.get("intro", "")) + len(nar.get("outro", "")) + sum(len(s["narration"]) + len(s.get("tip", "")) for s in nar["steps"])
    print(f"voix off : {chars} caractères")
    voix_nom, voix_id = voix_pour(a.name)
    print(f"voix off : {voix_nom}", flush=True)

    impose = bool(ENV.get("ELEVENLABS_TUTO_VOICE_ID", "").strip())  # une voix imposée : pas d'alternance

    def voice(text, name, qui="iris"):
        if a.no_voice or not text:
            return None, max(2.5, len(text) / 14)
        f = out_dir / f"{name}.mp3"
        vid, reglages = (voix_id, None) if impose else JUMEAUX[qui]
        return f"tutos/{a.name}/{f.name}", tts(text, f, vid, reglages)

    intro_audio, intro_s = voice(nar.get("intro", ""), "intro", "iris")
    outro_audio, outro_s = voice(nar.get("outro", ""), "outro", "ilo")
    scenes = []
    for n, (p, s) in enumerate(zip(per_step, nar["steps"]), 1):
        text = s["narration"] + (f" Astuce : {s['tip']}" if s.get("tip") else "")
        qui = "iris" if n % 2 else "ilo"
        audio, secs = voice(text, f"etape{n}", qui)
        scenes.append({
            "title": s["title"], "narration": s["narration"], "tip": s.get("tip", ""), "audio": audio, "qui": qui,
            "durationInFrames": int((secs + 1.2) * FPS),
            "shots": [{"src": x["src"], "w": x["w"], "h": x["h"], "click": x["click"], "action": x["action"]} for x in p["shots"]],
        })
    props = {
        "title": nar.get("title") or run.get("workflow", a.name), "intro": nar.get("intro", ""), "outro": nar.get("outro", ""),
        "introAudio": intro_audio, "introFrames": int((intro_s + 1.5) * FPS),
        "outroAudio": outro_audio, "outroFrames": int((outro_s + 1.5) * FPS), "scenes": scenes,
    }
    (out_dir / "props.json").write_text(json.dumps(props, ensure_ascii=False, indent=2))
    total = (props["introFrames"] + props["outroFrames"] + sum(s["durationInFrames"] for s in scenes)) / FPS
    print(f"→ {out_dir / 'props.json'} · vidéo ≈ {total:.0f} s")


if __name__ == "__main__":
    main()
