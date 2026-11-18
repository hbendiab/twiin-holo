#!/usr/bin/env python3
"""
capture.py — Prend une capture d'écran macOS pour la tester avec Holo.

Usage :
    python capture.py                 # tout l'écran -> screenshots/screen.png
    python capture.py select          # sélection à la souris (zone)
    python capture.py mon_nom.png     # nom de fichier personnalisé

Puis :
    python holo_test.py screenshots/screen.png "Clique sur ..."
"""
import os
import subprocess
import sys

os.makedirs("screenshots", exist_ok=True)

args = sys.argv[1:]
interactive = "select" in args
name = next((a for a in args if a.endswith(".png")), "screen.png")
path = os.path.join("screenshots", name)

cmd = ["screencapture", "-x"]          # -x : pas de son
if interactive:
    cmd.append("-i")                   # sélection d'une zone à la souris
cmd.append(path)

subprocess.run(cmd, check=True)
if os.path.isfile(path):
    print(f"✅ Capture enregistrée : {path}")
else:
    print("⚠️  Capture annulée (aucun fichier créé).")
