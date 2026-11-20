"""Masque des zones d'images, en local (rien ne sort de l'ordinateur), avant tout envoi pour analyse.

    stdin  : [{"index": 0, "dataUrl": "data:image/jpeg;base64,...", "ocrUrl": "...", "boxes": [[x, y, w, h], ...]}, ...]
             (boîtes normalisées 0-1, origine en haut à gauche, comme l'OCR de ocr.py / ocr_win.py)
    stdout : [{"index": 0, "dataUrl": "...", "ocrUrl": "..."}, ...]

Chaque zone est recouverte d'un pavé gris foncé, un peu plus large que le texte : l'information est détruite dans
l'image elle-même (pas un simple flou réversible). Mac et Windows (Pillow seulement).
"""
import base64
import io
import json
import sys

from PIL import Image, ImageDraw

PAD = 0.006  # marge autour du texte (en part de la largeur / hauteur de l'image)


def mask(data_url: str, boxes: list) -> str:
    if not data_url or "," not in data_url or not boxes:
        return data_url
    head, b64 = data_url.split(",", 1)
    img = Image.open(io.BytesIO(base64.b64decode(b64))).convert("RGB")
    w, h = img.size
    draw = ImageDraw.Draw(img)
    for x, y, bw, bh in boxes:
        x0, y0 = max(0, (x - PAD) * w), max(0, (y - PAD) * h)
        x1, y1 = min(w, (x + bw + PAD) * w), min(h, (y + bh + PAD) * h)
        draw.rounded_rectangle([x0, y0, x1, y1], radius=max(2, int((y1 - y0) / 4)), fill=(38, 41, 48))
    out = io.BytesIO()
    img.save(out, format="JPEG", quality=85)
    return "data:image/jpeg;base64," + base64.b64encode(out.getvalue()).decode()


def main():
    frames = json.load(sys.stdin)
    out = []
    for f in frames:
        boxes = f.get("boxes") or []
        out.append({"index": f.get("index"), "dataUrl": mask(f.get("dataUrl", ""), boxes),
                    "ocrUrl": mask(f.get("ocrUrl", ""), boxes) if f.get("ocrUrl") else None})
    json.dump(out, sys.stdout)


if __name__ == "__main__":
    main()
