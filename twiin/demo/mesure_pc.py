#!/usr/bin/env python3
"""Mesure, sur le PC (Windows), ce que fait une automatisation Holo à l'écran de l'employé.

    python demo/mesure_pc.py <id de l'automatisation n8n> [--no-run]

Lance l'automatisation par le serveur Twiin, puis toutes les 250 ms note : les fenêtres visibles, la fenêtre au premier
plan et la position du curseur. Rapport final : durée du run, nouvelles fenêtres apparues, changements de fenêtre au
premier plan, déplacements du curseur, fenêtres de navigateur (Chromium) visibles. Aucune capture d'écran, aucun contenu :
seulement des titres de fenêtres et des nombres. Windows uniquement (API Win32 via ctypes).
"""
import ctypes
import json
import sys
import time
import urllib.request
from ctypes import wintypes

U = ctypes.windll.user32
SERVER = "http://127.0.0.1:3000"


def visible_windows():
    out = {}

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def cb(h, _):
        if U.IsWindowVisible(h) and not U.IsIconic(h):
            n = U.GetWindowTextLengthW(h)
            if n:
                buf = ctypes.create_unicode_buffer(n + 1)
                U.GetWindowTextW(h, buf, n + 1)
                out[h] = buf.value
        return True
    U.EnumWindows(cb, 0)
    return out


def title_of(h):
    n = U.GetWindowTextLengthW(h)
    buf = ctypes.create_unicode_buffer(n + 1)
    U.GetWindowTextW(h, buf, n + 1)
    return buf.value


def cursor():
    p = wintypes.POINT()
    U.GetCursorPos(ctypes.byref(p))
    return p.x, p.y


def call(path, method="GET"):
    req = urllib.request.Request(SERVER + path, method=method, data=b"" if method == "POST" else None)
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read() or b"{}")


def running(aid):
    try:
        return next((a.get("running") for a in call("/api/automations")["automations"] if a["id"] == aid), False)
    except OSError:
        return False


def main():
    aid = sys.argv[1]
    base = visible_windows()
    fg0 = U.GetForegroundWindow()
    seen_new, fg_changes, moves, samples = {}, [], 0, 0
    last_fg, last_cur = fg0, cursor()
    t0 = time.time()
    if "--no-run" not in sys.argv:
        call(f"/api/automations/{aid}/run", "POST")
    time.sleep(3)  # le temps que le run démarre
    while time.time() - t0 < 600:
        samples += 1
        now = visible_windows()
        for h, t in now.items():
            if h not in base and h not in seen_new:
                seen_new[h] = t
        fg = U.GetForegroundWindow()
        if fg != last_fg:
            fg_changes.append({"t": round(time.time() - t0, 1), "vers": title_of(fg)[:60]})
            last_fg = fg
        cur = cursor()
        if cur != last_cur:
            moves += 1
            last_cur = cur
        if samples > 12 and not running(aid):
            break
        time.sleep(0.25)
    dur = round(time.time() - t0, 1)
    browser_wins = [t for t in seen_new.values() if any(k in t.lower() for k in ("chrom", "headless", "playwright", "holo"))]
    print(json.dumps({"durée_s": dur, "échantillons": samples, "nouvelles_fenêtres_visibles": list(seen_new.values()),
                      "fenêtres_de_navigateur_ouvertes_par_holo": browser_wins, "changements_de_premier_plan": fg_changes,
                      "mouvements_de_curseur_observés": moves}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
