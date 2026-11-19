#!/usr/bin/env python3
"""Journal d'actions de l'enregistreur, version WINDOWS (même format que actions.py pour macOS).

Lancé par server.js au clic sur « Enregistrer ma tâche », arrêté à la fin. Une ligne JSON par action :

    {"ts": ..., "type": "click",    "x": 812, "y": 455, "app": "chrome.exe", "window": "Comparatif - Excel",
     "element": "bouton « Enregistrer »", "button": "left"}
    {"ts": ..., "type": "typing",   "app": "EXCEL.EXE", "element": "...", "until": ..., "keys": 7}
    {"ts": ..., "type": "shortcut", "app": "EXCEL.EXE", "keys": "⌃S"}
    {"ts": ..., "type": "key",      "app": "...", "keys": "Entrée", "element": "..."}
    {"ts": ..., "type": "app",      "app": "EXCEL.EXE", "window": "Comparatif - Excel"}

Mêmes règles de confiance que sur Mac :
  - AUCUNE touche tapée n'est enregistrée : seulement qu'il y a eu de la saisie, où, combien de temps, combien de frappes.
    Seuls les raccourcis avec Ctrl ou Win sont notés (« ⌃S », « ⌃V »), parce que ce sont des actions.
  - Dans un champ mot de passe, rien n'est noté sur la saisie, sauf « champ protégé ».
  - On ne lit pas la valeur des champs : uniquement le type et le libellé de l'élément cliqué (API d'accessibilité
    de Windows, UI Automation).
  - Tout reste sur ce PC (workflows/sessions/<enregistrement>/, ignoré par git).

Test manuel :  ..\\..\\.venv\\Scripts\\python actions_win.py --out actions.jsonl   (Ctrl+C pour arrêter)
"""
import argparse
import ctypes
import json
import signal
import sys
import threading
import time

import psutil
import uiautomation as uia
from pynput import keyboard, mouse

user32 = ctypes.windll.user32
OUT = None
LOCK = threading.Lock()
STRUCTURE_KEYS = {keyboard.Key.enter: "Entrée", keyboard.Key.tab: "Tab", keyboard.Key.esc: "Échap"}
KIND = {"ButtonControl": "bouton", "HyperlinkControl": "lien", "EditControl": "champ", "ComboBoxControl": "liste",
        "ListItemControl": "élément de liste", "MenuItemControl": "menu", "TabItemControl": "onglet",
        "DataItemControl": "cellule", "CheckBoxControl": "case", "RadioButtonControl": "option",
        "DocumentControl": "document", "TextControl": "texte", "TreeItemControl": "élément"}


def emit(ev: dict):
    ev = {"ts": round(time.time(), 2), **ev}
    line = json.dumps(ev, ensure_ascii=False)
    with LOCK:
        if OUT:
            OUT.write(line + "\n")
            OUT.flush()
    print(line, flush=True)


def foreground() -> tuple[str, str]:
    hwnd = user32.GetForegroundWindow()
    n = user32.GetWindowTextLengthW(hwnd)
    buf = ctypes.create_unicode_buffer(n + 1)
    user32.GetWindowTextW(hwnd, buf, n + 1)
    pid = ctypes.c_ulong()
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    try:
        app = psutil.Process(pid.value).name()
    except Exception:  # noqa: BLE001
        app = "?"
    return app, buf.value


def describe(ctrl) -> tuple[str, bool]:
    """« bouton « Enregistrer » » et si c'est un champ mot de passe. Jamais la valeur du champ."""
    try:
        kind = KIND.get(ctrl.ControlTypeName, ctrl.LocalizedControlType or "élément")
        name = " ".join((ctrl.Name or "").split())[:60]
        try:
            secret = bool(ctrl.GetPropertyValue(uia.PropertyId.IsPasswordProperty))
        except Exception:  # noqa: BLE001
            secret = False
        return (f"{kind} « {name} »" if name else kind), secret
    except Exception:  # noqa: BLE001
        return "élément", False


class Typing:
    """Regroupe les frappes en un seul événement « typing » (sans jamais garder les touches)."""
    def __init__(self):
        self.block = None

    def key(self, app, element, secret):
        now = time.time()
        b = self.block
        if b and b["app"] == app and b["element"] == element and now - b["until"] < 4:
            b["until"], b["keys"] = now, b["keys"] + 1
        else:
            self.flush()
            self.block = {"ts": now, "until": now, "keys": 1, "app": app, "element": element, "secret": secret}

    def flush(self):
        b, self.block = self.block, None
        if not b:
            return
        if b["secret"]:
            emit({"type": "typing", "app": b["app"], "element": "champ protégé", "until": round(b["until"], 2)})
        else:
            emit({"type": "typing", "app": b["app"], "element": b["element"], "until": round(b["until"], 2), "keys": b["keys"]})


TYPING = Typing()
FOCUS = {"element": "le champ actif", "secret": False}
MODS = set()


def on_click(x, y, button, pressed):
    if not pressed:
        return
    TYPING.flush()
    app, win = foreground()
    try:
        with uia.UIAutomationInitializerInThread():
            element, secret = describe(uia.ControlFromPoint(x, y))
    except Exception:  # noqa: BLE001
        element, secret = "élément", False
    FOCUS.update(element=element, secret=secret)
    emit({"type": "click", "x": int(x), "y": int(y), "app": app, "window": win[:120], "element": element,
          "button": "right" if button == mouse.Button.right else "left"})


def on_press(key):
    if key in (keyboard.Key.ctrl_l, keyboard.Key.ctrl_r, keyboard.Key.cmd, keyboard.Key.cmd_r):
        MODS.add("ctrl" if "ctrl" in str(key) else "win")
        return
    app, _ = foreground()
    if MODS:
        TYPING.flush()
        name = getattr(key, "char", None) or str(key).replace("Key.", "")
        if name and len(name) == 1 and ord(name) < 32:  # Ctrl+lettre arrive comme caractère de contrôle
            name = chr(ord(name) + 64)
        emit({"type": "shortcut", "app": app, "keys": ("⌃" if "ctrl" in MODS else "⊞") + str(name).upper()})
        return
    if key in STRUCTURE_KEYS:
        TYPING.flush()
        emit({"type": "key", "app": app, "keys": STRUCTURE_KEYS[key], "element": FOCUS["element"]})
        return
    TYPING.key(app, FOCUS["element"], FOCUS["secret"])


def on_release(key):
    if key in (keyboard.Key.ctrl_l, keyboard.Key.ctrl_r):
        MODS.discard("ctrl")
    elif key in (keyboard.Key.cmd, keyboard.Key.cmd_r):
        MODS.discard("win")


def watch_apps(stop: threading.Event):
    last = None
    while not stop.is_set():
        cur = foreground()
        if cur != last and cur[1]:
            TYPING.flush()
            emit({"type": "app", "app": cur[0], "window": cur[1][:120]})
            last = cur
        stop.wait(0.5)


def main():
    global OUT
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    OUT = open(a.out, "a", encoding="utf-8")
    stop = threading.Event()
    emit({"type": "start", "clicks_and_keys": True, "accessibility": True, "platform": "windows"})
    ml = mouse.Listener(on_click=on_click)
    kl = keyboard.Listener(on_press=on_press, on_release=on_release)
    ml.start()
    kl.start()
    threading.Thread(target=watch_apps, args=(stop,), daemon=True).start()

    def finish(*_):
        stop.set()
        TYPING.flush()
        emit({"type": "stop"})
        ml.stop()
        kl.stop()
        OUT.close()
        sys.exit(0)
    signal.signal(signal.SIGTERM, finish)
    signal.signal(signal.SIGINT, finish)
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        finish()


if __name__ == "__main__":
    main()
