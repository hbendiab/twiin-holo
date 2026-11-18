#!/usr/bin/env python3
"""Rejoue un workflow approuvé avec Holo en affichant le lien de suivi EN DIRECT dès le début.

Rejeu par Holo (une session multi-tours, une étape par message, arrêt à la
première étape en échec), mais le lien H pour regarder la session est affiché et ouvert tout de suite.

    .venv/bin/python scripts/run_live.py <workflow-id> --remote   # navigateur cloud de H
    .venv/bin/python scripts/run_live.py <workflow-id>            # sur ce Mac (Accessibilité + Enregistrement de l'écran)
"""
import argparse
import json
import signal
import threading
import time
import webbrowser
from datetime import datetime
from pathlib import Path

from twiin.clients.holo.holo_agent import HoloAgent
from twiin.workflows import get_workflow

OK = {"idle", "completed"}
RUNS = Path(__file__).resolve().parents[1] / "workflows" / "runs"
EVENTS = None  # fichier .jsonl de progression, lu en direct par la page ImproveMe (--events)


def ev(kind, **data):
    """Une ligne de progression pour la page ImproveMe (en plus de l'affichage dans le terminal)."""
    if EVENTS:
        with open(EVENTS, "a", encoding="utf-8") as f:
            f.write(json.dumps({"t": round(time.time(), 2), "type": kind, **data}, ensure_ascii=False) + "\n")


def _stop_requested(*_):
    raise KeyboardInterrupt  # bouton « Arrêter » de la page : on sort proprement (la session H est annulée)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("workflow_id")
    ap.add_argument("--remote", action="store_true", help="navigateur cloud de H au lieu de ce Mac")
    ap.add_argument("--no-open", action="store_true")
    ap.add_argument("--steps", help="ne rejouer que ces étapes, ex. « 3 » ou « 2,3 » (numéros à partir de 1)")
    ap.add_argument("--stall", type=int, default=90, help="secondes sans activité avant de considérer la session bloquée")
    ap.add_argument("--max-restarts", type=int, default=2, help="reprises automatiques maximum")
    ap.add_argument("--events", help="fichier .jsonl où écrire la progression (lu par la page ImproveMe)")
    a = ap.parse_args()
    global EVENTS
    EVENTS = a.events
    signal.signal(signal.SIGTERM, _stop_requested)

    wf = get_workflow(a.workflow_id)
    if a.steps:
        keep = [int(x) for x in a.steps.split(",") if x.strip()]
        wf.steps = [wf.steps[k - 1] for k in keep]
        print(f"(étapes rejouées : {keep})", flush=True)
    agent = HoloAgent()
    mode = "cloud H" if a.remote else "ce Mac"
    print(f"▶ {wf.name} — {len(wf.steps)} étapes, sur {mode}", flush=True)
    ev("start", name=wf.name, steps=wf.steps, mode=mode)

    first = wf.steps[0]
    switches: list[str] = []
    if not a.remote:
        # Mode local : plusieurs écrans (la capture suit la fenêtre au premier plan) + pas de commandes ni fichiers.
        from twiin.clients.holo import guards, multiscreen
        multiscreen.enable()
        guards.enable()

        def _switch(i, n, b):
            msg = f"🖥  Holo regarde l'écran {i}/{n} ({int(b[2])}×{int(b[3])})"
            switches.append(msg)
            print(msg, flush=True)
            ev("screen", index=i, count=n, width=int(b[2]), height=int(b[3]))

        multiscreen.on_switch(_switch)
        print(f"🖥  {len(multiscreen.displays())} écran(s) détecté(s) · commandes et fichiers bloqués · double Échap = arrêt", flush=True)

        # Arrêt d'urgence : deux appuis sur Échap en moins d'une seconde coupent tout, souris et clavier rendus.
        def _emergency():
            import os as _os
            from pynput import keyboard as _kb
            last = [0.0]

            def on_press(key):
                if key == _kb.Key.esc:
                    now = time.time()
                    if now - last[0] < 1.0:
                        print("⛔ Double Échap : rejeu arrêté par l'utilisateur", flush=True)
                        ev("end", ok=False, status="arrêté (double Échap)")
                        _os._exit(130)
                    last[0] = now
            _kb.Listener(on_press=on_press, daemon=True).start()
        try:
            _emergency()
        except Exception as e:  # noqa: BLE001
            print(f"(arrêt d'urgence indisponible : {e})", flush=True)
        first = ("Rules for this whole task: work ONLY through what is visible on screen, with the mouse and keyboard. "
                 "Do not run terminal commands and do not read or write files. If the app you need is not visible, "
                 "bring it to the front (Dock or Cmd+Tab on Mac, taskbar or Alt+Tab on Windows). Never report a result you did not "
                 "see on screen during this task. Ignore the « Twiin » page (localhost:3000) if it is open in a browser: "
                 "it is not part of the task, never click on it, never type in its address bar and never close it. "
                 "To visit a website, FIRST open a NEW browser tab (Ctrl+T on Windows, Cmd+T on Mac) and work in that new tab.\n\nTask: " + first)

    t0 = time.time()
    client = agent.client
    rules = first[: first.index("Task: ")] if "Task: " in first else ""

    def open_session(message):
        sess = agent.start(message, local=not a.remote)
        sid_ = getattr(sess, "id", None) or getattr(sess, "session_id", None)
        try:
            u = client.sessions.share_session(id=sid_).share_url
            if u and u.startswith("/"):  # H renvoie un lien relatif : la page de suivi est sur platform.hcompany.ai
                u = "https://platform.hcompany.ai" + u
            print(f"👀 Suivre en direct : {u}", flush=True)
            ev("session", url=u)
            if not a.no_open and not sids:
                webbrowser.open(u)
        except Exception as e:  # noqa: BLE001
            u = None
            print(f"(lien de suivi indisponible : {e})", flush=True)
        sids.append(sid_)
        urls.append(u)
        return sess, sid_

    def tokens(sid_):
        try:
            u = client.sessions.get_session_status(id=sid_).usage_per_model or []
            return sum((m.input_tokens or 0) + (m.output_tokens or 0) for m in u)
        except Exception:  # noqa: BLE001
            return None

    def wait_started(sid_, before, timeout=30):
        """Après l'envoi d'une étape : attendre que Holo travaille VRAIMENT dessus (sinon on relit la réponse précédente)."""
        t = time.time()
        while time.time() - t < timeout:
            try:
                if client.sessions.get_session_status(id=sid_).status == "running":
                    return True
            except Exception:  # noqa: BLE001
                pass
            if (tk := tokens(sid_)) is not None and before is not None and tk > before:
                return True
            time.sleep(1)
        return False

    def wait_step(sess, sid_):
        """Attend la fin de l'étape ; renvoie None si la session est bloquée (plus aucun token consommé)."""
        box = {}

        def _run():
            try:
                box["res"] = sess.wait_for_completion()
            except Exception as e:  # noqa: BLE001
                box["err"] = e

        th = threading.Thread(target=_run, daemon=True)
        th.start()
        last, last_change = tokens(sid_), time.time()
        while th.is_alive():
            th.join(10)
            tk = tokens(sid_)
            if tk is not None and tk != last:
                last, last_change = tk, time.time()
            elif time.time() - last_change > a.stall:
                return None
        if "err" in box:
            raise box["err"]
        return box["res"]

    sids, urls = [], []
    log = {"workflow": wf.id, "mode": mode, "sessions": sids, "share_urls": urls, "steps": [], "restarts": 0}
    status = "ok"
    done: list[str] = []
    sid = None
    try:
        if a.remote:
            # Cloud : chaque nouvelle session repart d'un navigateur vierge -> UNE session, toutes les étapes numérotées.
            numbered = "\n".join(f"{n}. {st}" for n, st in enumerate(wf.steps, 1))
            print(f"\n[1 session] {len(wf.steps)} étapes envoyées ensemble", flush=True)
            ev("step_start", index=1, total=1, step=f"{len(wf.steps)} étapes envoyées ensemble")
            session, sid = open_session("Do the following steps in order, then report what you did and the values you read:\n" + numbered)
            ts = time.time()
            res = wait_step(session, sid)
            if res is None:
                status = "bloqué (session cloud sans activité)"
            else:
                r = agent.to_result(res, cancel=True)
                print(f"   → [{r.status}] en {round(time.time() - ts)} s : {r.answer or '(pas de réponse)'}", flush=True)
                ev("step_end", index=1, status=r.status, ok=r.status in OK, answer=r.answer, seconds=round(time.time() - ts))
                log["steps"].append({"step": "all", "status": r.status, "answer": r.answer, "seconds": round(time.time() - ts)})
                if r.status not in OK:
                    status = "échec"
        else:
            # Ce Mac : UNE SESSION PAR ÉTAPE. L'ordinateur garde son état d'une étape à l'autre ; chaque session rappelle
            # les étapes déjà faites. Pas de décalage d'un tour (cf. messages multiples dans une session), reprise simple.
            i = 0
            while i < len(wf.steps):
                step = wf.steps[i]
                print(f"\n[{i + 1}/{len(wf.steps)}] {step}", flush=True)
                ev("step_start", index=i + 1, total=len(wf.steps), step=step)
                context = ("Context: this is one step of a longer task. These steps were ALREADY DONE on this computer, "
                           "do not redo them: " + " | ".join(done) + "\nThe screen shows the current state.\n\n") if done else ""
                ts = time.time()
                session, sid = open_session(rules + context + "Task (do ONLY this step, then answer what you did): " + step)
                res = wait_step(session, sid)
                if res is None:
                    print(f"   ⚠️  plus aucune activité depuis {a.stall} s : session bloquée", flush=True)
                    ev("stalled", index=i + 1, seconds=a.stall)
                    try:
                        client.sessions.cancel_session(id=sid)
                    except Exception:  # noqa: BLE001
                        pass
                    log["steps"].append({"step": step, "status": "stalled", "seconds": round(time.time() - ts)})
                    if log["restarts"] >= a.max_restarts:
                        status = f"bloqué à l'étape {i + 1} (après {log['restarts']} reprise(s))"
                        break
                    log["restarts"] += 1
                    print(f"   ↻ reprise n°{log['restarts']} de l'étape {i + 1}", flush=True)
                    ev("restart", index=i + 1, count=log["restarts"])
                    continue
                r = agent.to_result(res, cancel=True)
                dur = round(time.time() - ts)
                print(f"   → [{r.status}] en {dur} s : {r.answer or '(pas de réponse)'}", flush=True)
                ev("step_end", index=i + 1, status=r.status, ok=r.status in OK, answer=r.answer, seconds=dur)
                log["steps"].append({"step": step, "status": r.status, "answer": r.answer, "seconds": dur})
                if r.status not in OK:
                    status = f"arrêt à l'étape {i + 1}"
                    break
                done.append(step)
                i += 1
    except KeyboardInterrupt:
        status = "arrêté à ta demande"
        print("■ arrêt demandé", flush=True)
    except Exception as e:  # noqa: BLE001
        status = f"erreur : {e}"
    finally:
        if sid:
            try:
                client.sessions.cancel_session(id=sid)
            except Exception:  # noqa: BLE001
                pass
    log.update(status=status, seconds=round(time.time() - t0), screen_switches=switches)
    if not a.remote:
        from twiin.clients.holo import guards
        log["blocked_actions"] = guards.blocked
        if guards.blocked:
            print(f"🛑 {len(guards.blocked)} action(s) refusée(s) par Twiin : " + " ; ".join(guards.blocked), flush=True)
    usage = {}
    for sid_ in sids:  # coût réel, tel que mesuré par H, toutes sessions confondues
        try:
            for m in client.sessions.get_session_status(id=sid_).usage_per_model or []:
                u = usage.setdefault(m.name, {"input_tokens": 0, "output_tokens": 0})
                u["input_tokens"] += m.input_tokens or 0
                u["output_tokens"] += m.output_tokens or 0
        except Exception:  # noqa: BLE001
            pass
    log["usage"] = usage
    ev("end", status=status, ok=status == "ok", seconds=round(time.time() - t0), usage=usage,
       blocked=log.get("blocked_actions", []), restarts=log.get("restarts", 0))
    if usage:
        print("💶 " + ", ".join(f"{k} : {v['input_tokens']} tokens entrée / {v['output_tokens']} sortie" for k, v in usage.items()), flush=True)
    RUNS.mkdir(parents=True, exist_ok=True)
    out = RUNS / f"{datetime.now():%Y%m%d-%H%M%S}-{'cloud' if a.remote else 'local'}.json"
    out.write_text(json.dumps(log, ensure_ascii=False, indent=2))
    print(f"\n■ {status} — {log['seconds']} s au total · journal : {out}", flush=True)


if __name__ == "__main__":
    main()
