"""Raccourci global ⌥⌘T → ouvre Twiin (scripts/open_twiin.sh), depuis n'importe quelle appli du Mac.

Tourne en arrière-plan (LaunchAgent installé par scripts/install_hotkey.sh). Il écoute UNIQUEMENT la combinaison
⌥⌘T : aucune autre touche n'est lue ni gardée. Le raccourci est « avalé » pour que l'appli au premier plan ne le
reçoive pas (le Finder s'en sert pour masquer sa barre d'outils).

Autorisation macOS : Réglages Système → Confidentialité et sécurité → Accessibilité → autoriser « Python ».
"""
import subprocess
import sys
from pathlib import Path

import Quartz

OPEN = Path(__file__).resolve().parent / "open_twiin.sh"
KEY_T = 17
WANT = Quartz.kCGEventFlagMaskCommand | Quartz.kCGEventFlagMaskAlternate
OTHERS = Quartz.kCGEventFlagMaskControl | Quartz.kCGEventFlagMaskShift


def on_key(proxy, etype, event, refcon):
    if etype in (Quartz.kCGEventTapDisabledByTimeout, Quartz.kCGEventTapDisabledByUserInput):
        Quartz.CGEventTapEnable(TAP, True)  # macOS coupe parfois l'écoute : on la relance
        return event
    if Quartz.CGEventGetIntegerValueField(event, Quartz.kCGKeyboardEventKeycode) != KEY_T:
        return event
    flags = Quartz.CGEventGetFlags(event)
    if (flags & WANT) == WANT and not (flags & OTHERS):
        if etype == Quartz.kCGEventKeyDown and not Quartz.CGEventGetIntegerValueField(event, Quartz.kCGKeyboardEventAutorepeat):
            subprocess.Popen(["/bin/bash", str(OPEN)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return None  # ⌥⌘T est pour Twiin
    return event


mask = Quartz.CGEventMaskBit(Quartz.kCGEventKeyDown) | Quartz.CGEventMaskBit(Quartz.kCGEventKeyUp)
TAP = Quartz.CGEventTapCreate(Quartz.kCGSessionEventTap, Quartz.kCGHeadInsertEventTap, Quartz.kCGEventTapOptionDefault,
                              mask, on_key, None)
if TAP is None:
    try:  # fait apparaître la fenêtre de macOS « Ouvrir les Réglages Système » pour autoriser Python
        from ApplicationServices import AXIsProcessTrustedWithOptions, kAXTrustedCheckOptionPrompt
        AXIsProcessTrustedWithOptions({kAXTrustedCheckOptionPrompt: True})
    except Exception:
        pass
    sys.exit("Raccourci ⌥⌘T : autorisation manquante. Réglages Système → Confidentialité et sécurité → Accessibilité "
             "→ autoriser Python, puis relancer (scripts/install_hotkey.sh).")
source = Quartz.CFMachPortCreateRunLoopSource(None, TAP, 0)
Quartz.CFRunLoopAddSource(Quartz.CFRunLoopGetCurrent(), source, Quartz.kCFRunLoopCommonModes)
Quartz.CGEventTapEnable(TAP, True)
print("Raccourci ⌥⌘T prêt : il ouvre Twiin.", flush=True)
Quartz.CFRunLoopRun()
