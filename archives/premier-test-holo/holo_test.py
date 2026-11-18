#!/usr/bin/env python3
"""
holo_test.py — Premier test de la solution Holo (H Company) en local.

Envoie une capture d'écran + une question au modèle Holo, et affiche :
  1) ce que le modèle "voit" à l'écran (description),
  2) OÙ il cliquerait (coordonnées x, y via l'outil `click`),
  3) une image annotée avec le point de clic (suffixe _holo.png).

Modèle par défaut : holo3-1-35b-a3b  -> GRATUIT, 10 requêtes/minute, sans carte bancaire.

Usage :
    python holo_test.py <image.png> "Clique sur le bouton Se connecter"
    python holo_test.py screenshots/screen.png            # question par défaut
    python holo_test.py image.png "..." --describe-only    # pas d'appel d'outil
    python holo_test.py image.png "..." --model holo4-27b  # modèle payant (consomme des crédits)

La clé API est lue depuis la variable d'environnement HAI_API_KEY (voir .env).
"""

import argparse
import base64
import json
import mimetypes
import os
import sys

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass  # dotenv optionnel : la clé peut venir de l'environnement directement

try:
    from openai import OpenAI
except ImportError:
    sys.exit("❌ Le paquet 'openai' n'est pas installé.\n"
             "   Lance d'abord :  pip install -r requirements.txt")

BASE_URL = "https://api.hcompany.ai/v1/"
DEFAULT_MODEL = "holo3-1-35b-a3b"  # gratuit
DEFAULT_QUESTION = "Décris ce qui est affiché à l'écran, puis indique l'élément le plus important sur lequel cliquer."

# Outil "click" : Holo renvoie les coordonnées du point à cliquer.
CLICK_TOOL = [{
    "type": "function",
    "function": {
        "name": "click",
        "description": "Clique à la position (x, y) en pixels dans l'image.",
        "parameters": {
            "type": "object",
            "properties": {
                "x": {"type": "integer", "description": "Position horizontale en pixels"},
                "y": {"type": "integer", "description": "Position verticale en pixels"},
            },
            "required": ["x", "y"],
        },
    },
}]


def image_size(path: str):
    """Renvoie (largeur, hauteur) de l'image, ou None si Pillow absent."""
    try:
        from PIL import Image
        with Image.open(path) as im:
            return im.size
    except Exception:  # noqa: BLE001
        return None


def encode_image(path: str) -> str:
    """Transforme un fichier image local en data URI base64."""
    if not os.path.isfile(path):
        sys.exit(f"❌ Image introuvable : {path}")
    mime, _ = mimetypes.guess_type(path)
    if mime not in ("image/png", "image/jpeg", "image/webp"):
        mime = "image/png"
    with open(path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("utf-8")
    return f"data:{mime};base64,{b64}"


def make_client() -> "OpenAI":
    key = os.environ.get("HAI_API_KEY")
    if not key:
        sys.exit(
            "❌ Clé API manquante.\n"
            "   1) Crée une clé : https://platform.hcompany.ai/settings/api-keys\n"
            "   2) cp .env.example .env\n"
            "   3) Colle la clé dans .env (HAI_API_KEY=hk-...)\n"
        )
    if key.strip() in ("", "hk-...", "hk-xxx"):
        sys.exit("❌ HAI_API_KEY semble être un placeholder. Mets ta vraie clé dans .env.")
    return OpenAI(base_url=BASE_URL, api_key=key)


def call_holo(client, model, data_uri, question, with_tool):
    content = [
        {"type": "image_url", "image_url": {"url": data_uri}},
        {"type": "text", "text": question},
    ]
    kwargs = dict(model=model, messages=[{"role": "user", "content": content}])
    if with_tool:
        kwargs["tools"] = CLICK_TOOL
        kwargs["tool_choice"] = {"type": "function", "function": {"name": "click"}}
    try:
        return client.chat.completions.create(**kwargs)
    except Exception as e:  # noqa: BLE001 — on veut un message lisible pour l'utilisateur
        msg = str(e)
        if "429" in msg or "rate" in msg.lower():
            sys.exit("⏳ Limite de débit atteinte (free tier = 10 req/min). Attends ~1 minute et relance.")
        if "401" in msg or "auth" in msg.lower():
            sys.exit("🔑 Clé API refusée. Vérifie HAI_API_KEY dans .env.")
        sys.exit(f"❌ Erreur lors de l'appel à Holo : {msg}")


def annotate(image_path, x, y):
    """Dessine un repère au point (x, y) et enregistre une copie _holo.png."""
    try:
        from PIL import Image, ImageDraw
    except ImportError:
        print("ℹ️  Pillow non installé : pas d'image annotée (pip install pillow).")
        return None
    img = Image.open(image_path).convert("RGB")
    draw = ImageDraw.Draw(img)
    r = max(12, img.width // 80)
    draw.ellipse([x - r, y - r, x + r, y + r], outline=(255, 0, 0), width=4)
    draw.line([x - r * 2, y, x + r * 2, y], fill=(255, 0, 0), width=2)
    draw.line([x, y - r * 2, x, y + r * 2], fill=(255, 0, 0), width=2)
    out = os.path.splitext(image_path)[0] + "_holo.png"
    img.save(out)
    return out


def main():
    p = argparse.ArgumentParser(description="Test local de Holo (H Company).")
    p.add_argument("image", help="Chemin de la capture d'écran (png/jpg/webp)")
    p.add_argument("question", nargs="?", default=DEFAULT_QUESTION, help="Instruction / question")
    p.add_argument("--model", default=DEFAULT_MODEL, help=f"Modèle (défaut : {DEFAULT_MODEL})")
    p.add_argument("--describe-only", action="store_true", help="Description seule, sans coordonnées de clic")
    args = p.parse_args()

    client = make_client()
    data_uri = encode_image(args.image)

    print(f"🖼️  Image    : {args.image}")
    print(f"🤖 Modèle   : {args.model}")
    print(f"❓ Question : {args.question}\n")

    # 1) Description en langage naturel
    print("─" * 60)
    print("1) Ce que Holo voit à l'écran")
    print("─" * 60)
    desc = call_holo(client, args.model, data_uri, args.question, with_tool=False)
    text = desc.choices[0].message.content or "(réponse vide)"
    print(text.strip() + "\n")

    if args.describe_only:
        return

    # 2) Coordonnées du clic (appel d'outil forcé)
    print("─" * 60)
    print("2) Où Holo cliquerait  (outil click)")
    print("─" * 60)
    resp = call_holo(client, args.model, data_uri, args.question, with_tool=True)
    calls = resp.choices[0].message.tool_calls or []
    if not calls:
        print("Holo n'a pas renvoyé de clic. Réponse texte :")
        print((resp.choices[0].message.content or "").strip())
        return
    try:
        pos = json.loads(calls[0].function.arguments)
        x, y = int(pos["x"]), int(pos["y"])
    except (KeyError, ValueError, json.JSONDecodeError):
        print("Arguments reçus (format inattendu) :", calls[0].function.arguments)
        return

    # Holo renvoie des coordonnées NORMALISÉES sur 0–1000 (pas des pixels bruts).
    # On les reconvertit vers la résolution réelle de l'image.
    size = image_size(args.image)
    if size:
        w, h = size
        px, py = round(x / 1000 * w), round(y / 1000 * h)
        print(f"👉 Clic Holo (normalisé /1000) : x={x}, y={y}")
        print(f"   → en pixels sur {w}x{h} : x={px}, y={py}")
    else:
        px, py = x, y
        print(f"👉 Clic Holo : x={x}, y={y}  (Pillow absent : pas de conversion pixels)")
    out = annotate(args.image, px, py)
    if out:
        print(f"🖌️  Image annotée : {out}")


if __name__ == "__main__":
    main()
