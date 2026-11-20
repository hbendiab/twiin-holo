#!/usr/bin/env python3
"""OCR local des captures, version WINDOWS (moteur de reconnaissance de texte intégré à Windows, Windows.Media.Ocr).

Même contrat que ocr.py (macOS) ; rien ne sort du PC. Appelé par server.js :
    stdin  : [{"index": 0, "dataUrl": "data:image/jpeg;base64,..."}, ...]
    stdout : [{"index": 0, "lines": [{"text": "10 déc.", "conf": 1.0, "box": [x, y, w, h]}, ...]}, ...]
Boîte normalisée 0-1, origine en haut à gauche ; lignes triées de haut en bas puis de gauche à droite.
Le moteur Windows ne donne pas de score de confiance : conf vaut 1.0.
Langue : français si le pack de langue est installé sur Windows, sinon anglais.

Test manuel :  ..\\..\\.venv\\Scripts\\python ocr_win.py --file capture.png
"""
import base64
import io
import json
import sys

import winocr
from PIL import Image

LANGS = ["fr", "en"]


def ocr_image(img: Image.Image) -> list[dict]:
    w, h = img.size
    res = None
    for lang in LANGS:
        try:
            res = winocr.recognize_pil_sync(img.convert("RGB"), lang)
            break
        except Exception:  # noqa: BLE001 — pack de langue absent : on essaie la suivante
            continue
    lines = []
    for ln in (res or {}).get("lines", []):
        rects = [wd["bounding_rect"] for wd in ln.get("words", [])]
        if not rects or not ln.get("text", "").strip():
            continue
        x0 = min(r["x"] for r in rects)
        y0 = min(r["y"] for r in rects)
        x1 = max(r["x"] + r["width"] for r in rects)
        y1 = max(r["y"] + r["height"] for r in rects)
        lines.append({"text": ln["text"], "conf": 1.0,
                      "box": [round(x0 / w, 4), round(y0 / h, 4), round((x1 - x0) / w, 4), round((y1 - y0) / h, 4)]})
    lines.sort(key=lambda l: (round(l["box"][1], 2), l["box"][0]))
    return lines


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    if len(sys.argv) == 3 and sys.argv[1] == "--file":
        print(json.dumps(ocr_image(Image.open(sys.argv[2])), ensure_ascii=False, indent=1))
        return
    frames = json.loads(sys.stdin.read() or "[]")
    out = []
    for f in frames:
        try:
            raw = base64.b64decode(f["dataUrl"].split(",", 1)[1])
            out.append({"index": f["index"], "lines": ocr_image(Image.open(io.BytesIO(raw)))})
        except Exception:  # noqa: BLE001
            out.append({"index": f.get("index"), "lines": []})
    print(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main()
