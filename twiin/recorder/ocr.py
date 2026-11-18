#!/usr/bin/env python3
"""OCR local des captures, avec le moteur de reconnaissance de texte intégré à macOS (framework Vision).

Rien ne sort du Mac. Appelé par server.js :
    stdin  : [{"index": 0, "dataUrl": "data:image/jpeg;base64,..."}, ...]
    stdout : [{"index": 0, "lines": [{"text": "10 déc.", "conf": 0.98, "box": [x, y, w, h]}, ...]}, ...]
La boîte est normalisée 0-1, origine en haut à gauche. Les lignes sont triées de haut en bas, puis de gauche à droite.

Test manuel :  ../.venv/bin/python ocr.py --file capture.png
"""
import base64
import json
import sys

import Quartz
import Vision
from Foundation import NSData

LANGUAGES = ["fr-FR", "en-US"]


def cgimage_from_bytes(raw: bytes):
    src = Quartz.CGImageSourceCreateWithData(NSData.dataWithBytes_length_(raw, len(raw)), None)
    return Quartz.CGImageSourceCreateImageAtIndex(src, 0, None) if src else None


def ocr_bytes(raw: bytes) -> list[dict]:
    img = cgimage_from_bytes(raw)
    if img is None:
        return []
    req = Vision.VNRecognizeTextRequest.alloc().init()
    req.setRecognitionLevel_(Vision.VNRequestTextRecognitionLevelAccurate)
    req.setRecognitionLanguages_(LANGUAGES)
    req.setUsesLanguageCorrection_(True)
    handler = Vision.VNImageRequestHandler.alloc().initWithCGImage_options_(img, None)
    ok, _err = handler.performRequests_error_([req], None)
    if not ok:
        return []
    lines = []
    for obs in req.results() or []:
        cand = obs.topCandidates_(1)
        if not cand:
            continue
        c = cand[0]
        bb = obs.boundingBox()  # origine en bas à gauche, normalisée
        x, y, w, h = bb.origin.x, bb.origin.y, bb.size.width, bb.size.height
        lines.append({"text": str(c.string()), "conf": round(float(c.confidence()), 2),
                      "box": [round(x, 4), round(1 - y - h, 4), round(w, 4), round(h, 4)]})
    lines.sort(key=lambda l: (round(l["box"][1] * 50), l["box"][0]))  # par bandes de ~2 % de hauteur
    return lines


def main():
    if len(sys.argv) == 3 and sys.argv[1] == "--file":
        for l in ocr_bytes(open(sys.argv[2], "rb").read()):
            print(f"{l['conf']:.2f}  {l['text']}")
        return
    frames = json.load(sys.stdin)
    out = []
    for f in frames:
        data = f.get("dataUrl", "")
        raw = base64.b64decode(data.split(",", 1)[1]) if "," in data else b""
        out.append({"index": f.get("index"), "lines": ocr_bytes(raw) if raw else []})
    json.dump(out, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
