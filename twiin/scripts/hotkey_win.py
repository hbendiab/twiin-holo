"""Raccourci global Ctrl+Alt+T → ouvre Twiin (scripts/open_twiin.ps1), depuis n'importe quelle appli de Windows.

Équivalent Windows de hotkey.py (⌥⌘T sur Mac). Il écoute UNIQUEMENT cette combinaison : aucune autre touche n'est
lue ni gardée. Lancé au démarrage de la session par scripts/install_hotkey.ps1 (raccourci dans le dossier Démarrage).
"""
import subprocess
from pathlib import Path

from pynput import keyboard

OPEN = Path(__file__).resolve().parent / "open_twiin.ps1"


def open_twiin():
    subprocess.Popen(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", str(OPEN)],
                     creationflags=0x08000000)  # CREATE_NO_WINDOW


with keyboard.GlobalHotKeys({"<ctrl>+<alt>+t": open_twiin}) as h:
    print("Raccourci Ctrl+Alt+T prêt : il ouvre Twiin.", flush=True)
    h.join()
