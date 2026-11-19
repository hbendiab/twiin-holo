#!/usr/bin/env python3
"""Journal d'actions de l'enregistreur (macOS) : ce que l'utilisateur FAIT, pendant l'enregistrement uniquement.

Lancé par server.js au clic sur « Start recording », arrêté au clic sur « Stop ». Écrit une ligne JSON par action
dans le fichier donné (et sur la sortie standard) :

    {"ts": 1763415605.12, "type": "click",  "display": 2, "x": 2105, "y": 488, "app": "Microsoft Excel",
     "window": "veille_entreprises.xlsx", "element": "cellule « E4 »", "button": "left"}
    {"ts": ..., "type": "typing",   "app": "Microsoft Excel", "element": "...", "until": ..., "keys": 7}
    {"ts": ..., "type": "shortcut", "app": "Microsoft Excel", "keys": "⌘S"}
    {"ts": ..., "type": "app",      "display": 2, "app": "Microsoft OneNote", "window": "Veille concurrence"}

Règles de confiance :
  - AUCUNE touche tapée n'est enregistrée : seulement qu'il y a eu de la saisie, où, combien de temps et combien
    de frappes. Seuls les raccourcis avec ⌘ ou ⌃ sont notés (« ⌘S », « ⌘V »), parce que ce sont des actions.
  - Dans un champ mot de passe, rien n'est noté sur la saisie, sauf « champ protégé ».
  - On ne lit pas la valeur des champs ni le contenu des documents : uniquement le rôle et le libellé de l'élément
    cliqué (« bouton « Enregistrer » », « lien « H Company » »). Les valeurs viennent de l'OCR des captures.
  - Tout reste sur ce Mac ; le fichier est dans workflows/sessions/<enregistrement>/ (ignoré par git).

Permissions macOS pour l'app qui lance l'enregistreur (VS Code, Terminal…) :
  - Surveillance de l'entrée (clics et clavier) ; Accessibilité (libellé de l'élément cliqué).
  - Automatisation → Google Chrome (URL de l'onglet actif, ex. « ?size=S ») : sans elle, pas d'URL dans le journal.
Sans « Surveillance de l'entrée », le journal note quand même les changements d'app et de fenêtre.

Test manuel :  ../.venv/bin/python actions.py --out /tmp/actions.jsonl   (Ctrl+C pour arrêter)
"""
import argparse
import json
import signal
import subprocess
import sys
import time

import Quartz
from ApplicationServices import (
    AXIsProcessTrusted,
    AXUIElementCopyAttributeValue,
    AXUIElementCopyElementAtPosition,
    AXUIElementCreateSystemWide,
)

TYPING_IDLE_S = 1.5        # une rafale de frappe se termine après 1,5 s sans touche
# Touches de STRUCTURE (aucun texte) : elles font passer d'un champ à l'autre, valident ou annulent. On les note
# comme des actions, car elles comptent pour rejouer la tâche (ex. Entrée pour quitter le titre d'une page OneNote).
STRUCTURE_KEYS = {36: "Entrée", 76: "Entrée", 48: "Tab", 53: "Échap"}
POLL_S = 0.5               # changement d'app / de fenêtre vérifié deux fois par seconde
URL_POLL_S = 1.5           # URL de l'onglet Chrome relue au plus toutes les 1,5 s (osascript coûte ~0,1 s)
CHROME = "Google Chrome"
CHROME_URL_SCRIPT = 'tell application "Google Chrome" to get URL of active tab of front window'
IGNORED_OWNERS = {"Window Server", "Dock", "SystemUIServer", "Control Center", "Centre de contrôle",
                  "Notification Center", "Centre de notifications"}
ROLE_FR = {"AXButton": "bouton", "AXLink": "lien", "AXTextField": "champ", "AXTextArea": "zone de texte",
           "AXCell": "cellule", "AXMenuItem": "menu", "AXMenuBarItem": "menu", "AXCheckBox": "case à cocher",
           "AXRadioButton": "bouton radio", "AXPopUpButton": "liste", "AXComboBox": "liste", "AXTab": "onglet",
           "AXRadioGroup": "onglets", "AXStaticText": "texte", "AXImage": "image", "AXRow": "ligne",
           "AXWebArea": "page web", "AXHeading": "titre", "AXSearchField": "champ de recherche",
           "AXSecureTextField": "champ protégé", "AXTable": "tableau", "AXOutline": "liste", "AXGroup": "zone"}

out_file = None
system_wide = AXUIElementCreateSystemWide()
state = {"app": None, "window": None, "burst": None, "running": True, "tap": None, "url": None, "url_at": 0.0,
         "paused": False}


def chrome_url():
    """URL de l'onglet actif de Chrome (ex. « …/puffer-jacket-pink?size=S »), ou None. Jamais bloquant longtemps."""
    try:
        r = subprocess.run(["osascript", "-e", CHROME_URL_SCRIPT], capture_output=True, text=True, timeout=1.5)
        return (r.stdout.strip() or None) if r.returncode == 0 else None
    except Exception:  # noqa: BLE001  (Chrome fermé, permission Automation refusée, délai dépassé)
        return None


def emit(ev: dict):
    ts = ev.pop("_ts", None)
    ev = {"ts": round(ts if ts is not None else time.time(), 2), **ev}
    line = json.dumps(ev, ensure_ascii=False)
    print(line, flush=True)
    if out_file:
        out_file.write(line + "\n")
        out_file.flush()


def displays():
    ids = Quartz.CGGetActiveDisplayList(16, None, None)[1]
    return [(i, Quartz.CGDisplayBounds(i)) for i in ids]


def display_of(x, y):
    for n, (did, b) in enumerate(displays(), 1):
        if b.origin.x <= x < b.origin.x + b.size.width and b.origin.y <= y < b.origin.y + b.size.height:
            return int(did)
    return None


def front_window():
    """(app, titre, display) de la fenêtre au premier plan, relu à chaque appel (jamais figé)."""
    wins = Quartz.CGWindowListCopyWindowInfo(
        Quartz.kCGWindowListOptionOnScreenOnly | Quartz.kCGWindowListExcludeDesktopElements, Quartz.kCGNullWindowID)
    for w in wins or []:
        if w.get("kCGWindowLayer", 0) != 0 or w.get("kCGWindowOwnerName") in IGNORED_OWNERS:
            continue
        b = w.get("kCGWindowBounds", {})
        if b.get("Width", 0) >= 300 and b.get("Height", 0) >= 200:
            cx, cy = b["X"] + b["Width"] / 2, b["Y"] + b["Height"] / 2
            return w.get("kCGWindowOwnerName"), (w.get("kCGWindowName") or "")[:120], display_of(cx, cy)
    return None, None, None


def ax_attr(el, name):
    err, val = AXUIElementCopyAttributeValue(el, name, None)
    return val if err == 0 else None


def describe_element(el):
    """« bouton « Enregistrer » » : rôle + libellé, jamais la valeur d'un champ."""
    if el is None:
        return None, False
    role = ax_attr(el, "AXRole") or ""
    if role == "AXSecureTextField":
        return "champ protégé", True
    label = ""
    for attr in ("AXTitle", "AXDescription", "AXHelp", "AXIdentifier"):
        v = ax_attr(el, attr)
        if v and isinstance(v, str) and v.strip():
            label = v.strip()
            break
    if not label and role in ("AXStaticText", "AXCell", "AXHeading", "AXLink"):
        v = ax_attr(el, "AXValue")  # texte d'un libellé, d'un lien ou d'une cellule : utile pour suivre l'action
        if isinstance(v, str):
            label = v.strip()
    name = ROLE_FR.get(role, role.replace("AX", "").lower() or "élément")
    label = " ".join(label.split())[:80]
    return (f"{name} « {label} »" if label else name), False


def element_at(x, y):
    err, el = AXUIElementCopyElementAtPosition(system_wide, float(x), float(y), None)
    return el if err == 0 else None


def focused_element():
    return ax_attr(system_wide, "AXFocusedUIElement")


def flush_burst(force=False):
    b = state["burst"]
    if b and (force or time.time() - b["last"] > TYPING_IDLE_S):
        if not b["secure"]:
            emit({"type": "typing", "app": b["app"], "display": b["display"], "element": b["element"],
                  "until": round(b["last"], 2), "keys": b["keys"], "_ts": b["start"]})
        else:
            emit({"type": "typing", "app": b["app"], "display": b["display"], "element": "champ protégé",
                  "until": round(b["last"], 2), "_ts": b["start"]})
        state["burst"] = None


def on_event(proxy, etype, event, refcon):
    try:
        if etype in (Quartz.kCGEventTapDisabledByTimeout, Quartz.kCGEventTapDisabledByUserInput):
            if state["tap"] is not None:
                Quartz.CGEventTapEnable(state["tap"], True)
            return event
        if state["paused"]:
            return event  # pause : rien n'est noté pendant la pause (ni clic, ni touche)
        if etype in (Quartz.kCGEventLeftMouseDown, Quartz.kCGEventRightMouseDown):
            flush_burst(force=True)
            p = Quartz.CGEventGetLocation(event)
            app, win, _ = front_window()
            element, _secure = describe_element(element_at(p.x, p.y))
            emit({"type": "click", "button": "left" if etype == Quartz.kCGEventLeftMouseDown else "right",
                  "display": display_of(p.x, p.y), "x": int(p.x), "y": int(p.y),
                  "app": app, "window": win, "element": element,
                  "url": state["url"] if app == CHROME else None,
                  "double": Quartz.CGEventGetIntegerValueField(event, Quartz.kCGMouseEventClickState) >= 2})
        elif etype == Quartz.kCGEventKeyDown:
            flags = Quartz.CGEventGetFlags(event)
            cmd = bool(flags & Quartz.kCGEventFlagMaskCommand)
            ctrl = bool(flags & Quartz.kCGEventFlagMaskControl)
            if cmd or ctrl:
                # raccourci : on note la combinaison (« ⌘S »), car c'est une action, pas du texte
                flush_burst(force=True)
                _n, chars = Quartz.CGEventKeyboardGetUnicodeString(event, 4, None, None)
                key = (chars or "?").upper()
                if not key.isprintable() or key.strip() == "":
                    key = f"touche {Quartz.CGEventGetIntegerValueField(event, Quartz.kCGKeyboardEventKeycode)}"
                app, _w, disp = front_window()
                emit({"type": "shortcut", "app": app, "display": disp, "keys": ("⌘" if cmd else "") + ("⌃" if ctrl else "") + key})
            elif Quartz.CGEventGetIntegerValueField(event, Quartz.kCGKeyboardEventKeycode) in STRUCTURE_KEYS:
                flush_burst(force=True)  # la saisie en cours s'arrête là : on la note avant la touche
                code = Quartz.CGEventGetIntegerValueField(event, Quartz.kCGKeyboardEventKeycode)
                app, _w, disp = front_window()
                element, secure = describe_element(focused_element())
                emit({"type": "key", "app": app, "display": disp, "keys": STRUCTURE_KEYS[code],
                      "element": "champ protégé" if secure else element})
            else:
                now = time.time()
                b = state["burst"]
                if b is None:
                    app, _w, disp = front_window()
                    element, secure = describe_element(focused_element())
                    state["burst"] = {"start": round(now, 2), "last": now, "keys": 1, "app": app, "display": disp,
                                      "element": element, "secure": secure}
                else:
                    b["last"] = now
                    b["keys"] += 1
    except Exception as e:  # noqa: BLE001  (une erreur ne doit jamais couper l'écoute)
        print(json.dumps({"type": "error", "message": str(e)[:200]}), file=sys.stderr, flush=True)
    return event


def poll(timer, info):
    if state["paused"]:
        return
    flush_burst()
    app, win, disp = front_window()
    if app and (app != state["app"] or win != state["window"]):
        state["app"], state["window"] = app, win
        emit({"type": "app", "app": app, "window": win, "display": disp})
    # l'URL de Chrome est un signal fort (ex. « ?size=S » : la taille choisie). On en garde la trace dans le journal :
    # un événement « url » à chaque changement, et l'URL courante est recopiée dans chaque clic.
    if app == CHROME:
        if time.time() - state["url_at"] >= URL_POLL_S:
            state["url_at"] = time.time()
            url = chrome_url()
            if url != state["url"]:
                state["url"] = url
                emit({"type": "url", "app": app, "window": win, "url": url})
    elif state["url"] is not None:
        state["url"] = None


def main():
    global out_file
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", help="fichier .jsonl où écrire le journal")
    a = ap.parse_args()
    if a.out:
        out_file = open(a.out, "a", encoding="utf-8")

    def stop(*_):
        state["running"] = False

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    def toggle_pause(*_):
        # SIGUSR1 : pause / reprise du journal (envoyé par le serveur Twiin)
        if not state["paused"]:
            flush_burst(force=True)  # la saisie en cours est notée avant la pause
        state["paused"] = not state["paused"]
        emit({"type": "pause" if state["paused"] else "reprise"})

    signal.signal(signal.SIGUSR1, toggle_pause)

    mask = (Quartz.CGEventMaskBit(Quartz.kCGEventLeftMouseDown) | Quartz.CGEventMaskBit(Quartz.kCGEventRightMouseDown)
            | Quartz.CGEventMaskBit(Quartz.kCGEventKeyDown))
    tap = Quartz.CGEventTapCreate(Quartz.kCGSessionEventTap, Quartz.kCGHeadInsertEventTap,
                                  Quartz.kCGEventTapOptionListenOnly, mask, on_event, None)
    state["tap"] = tap
    emit({"type": "start", "clicks_and_keys": tap is not None, "accessibility": bool(AXIsProcessTrusted()),
          "displays": [{"id": int(d), "x": b.origin.x, "y": b.origin.y, "w": b.size.width, "h": b.size.height}
                       for d, b in displays()]})
    loop = Quartz.CFRunLoopGetCurrent()
    if tap is not None:
        src = Quartz.CFMachPortCreateRunLoopSource(None, tap, 0)
        Quartz.CFRunLoopAddSource(loop, src, Quartz.kCFRunLoopCommonModes)
        Quartz.CGEventTapEnable(tap, True)
    timer = Quartz.CFRunLoopTimerCreate(None, Quartz.CFAbsoluteTimeGetCurrent() + POLL_S, POLL_S, 0, 0, poll, None)
    Quartz.CFRunLoopAddTimer(loop, timer, Quartz.kCFRunLoopCommonModes)
    # les signaux Python ne sont traités qu'entre deux tours de boucle : on tourne par tranches de 0,25 s
    while state["running"]:
        Quartz.CFRunLoopRunInMode(Quartz.kCFRunLoopDefaultMode, 0.25, False)
    flush_burst(force=True)
    emit({"type": "stop"})


if __name__ == "__main__":
    main()
