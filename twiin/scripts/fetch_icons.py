"""Récupère les logos des outils affichés par la page Twiin (journal, étapes, verdict, n8n).

- Applications du Mac : icône extraite de l'application installée (rien ne passe par Internet).
- Sites web (LinkedIn, Google Sheets, n8n, Holo…) : icône téléchargée UNE fois, puis gardée sur le Mac.

Sortie : recorder/public/icons/<clé>.png + recorder/public/icons/icons.json (libellé, alias pour reconnaître l'outil
dans le texte, fichier). Le dossier est exclu de git : il reflète les applications installées sur CE Mac.

    .venv/bin/python scripts/fetch_icons.py
"""
from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

from AppKit import NSBitmapImageRep, NSPNGFileType, NSWorkspace
from Foundation import NSMakeRect, NSSize

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "recorder" / "public" / "icons"
REGISTRY = ROOT.parent / "capture" / "backend" / "app" / "known_tools.json"
SIZE = 96  # affiché en 20-28 px : 96 px reste net sur un écran Retina

APP_DIRS = [Path("/Applications"), Path("/Applications/Utilities"), Path("/System/Applications"),
            Path("/System/Applications/Utilities"), Path.home() / "Applications"]
VENDORS = ("Microsoft ", "Google ", "Adobe ", "Apple ")
# Noms trop courants pour être reconnus seuls dans une phrase (« taper des notes ») : seul le nom complet compte.
GENERIC = {"notes", "mail", "photos", "music", "messages", "calendar", "preview", "reminders", "books", "news", "home",
           "maps", "clock", "weather", "calculator", "shortcuts", "stocks", "podcasts", "tv", "contacts", "finder",
           "pages", "numbers", "keynote", "freeform", "passwords", "phone", "journal", "games", "image playground"}

# Sites web utiles à Twiin : clé, libellé, alias, URL de l'icône (logo officiel ou icône du site).
WEB = [
    ("linkedin", "LinkedIn", ["LinkedIn"], "https://www.google.com/s2/favicons?domain=linkedin.com&sz=128"),
    ("google-sheets", "Google Sheets", ["Google Sheets", "Sheets", "Google Sheet", "feuille Google"],
     "https://www.gstatic.com/images/branding/product/2x/sheets_2020q4_48dp.png"),
    ("google-docs", "Google Docs", ["Google Docs"], "https://www.gstatic.com/images/branding/product/2x/docs_2020q4_48dp.png"),
    ("google-drive", "Google Drive", ["Google Drive", "Drive"], "https://www.gstatic.com/images/branding/product/2x/drive_2020q4_48dp.png"),
    ("gmail", "Gmail", ["Gmail"], "https://www.gstatic.com/images/branding/product/2x/gmail_2020q4_48dp.png"),
    ("google-calendar", "Google Agenda", ["Google Agenda", "Google Calendar"],
     "https://www.gstatic.com/images/branding/product/2x/calendar_2020q4_48dp.png"),
    ("google-flights", "Google Flights", ["Google Flights"], "https://www.google.com/s2/favicons?domain=google.com/travel/flights&sz=128"),
    ("kayak", "Kayak", ["Kayak", "KAYAK"], "https://www.google.com/s2/favicons?domain=kayak.fr&sz=128"),
    ("notion", "Notion", ["Notion"], "https://www.google.com/s2/favicons?domain=notion.so&sz=128"),
    ("slack", "Slack", ["Slack"], "https://www.google.com/s2/favicons?domain=slack.com&sz=128"),
    ("n8n", "n8n", ["n8n"], "https://www.google.com/s2/favicons?domain=n8n.io&sz=128"),
    ("holo", "Holo", ["Holo", "H Company"], "https://www.google.com/s2/favicons?domain=hcompany.ai&sz=128"),
    ("elevenlabs", "ElevenLabs", ["ElevenLabs"], "https://www.google.com/s2/favicons?domain=elevenlabs.io&sz=128"),
    ("hugging-face", "Hugging Face", ["Hugging Face"], "https://www.google.com/s2/favicons?domain=huggingface.co&sz=128"),
    ("github", "GitHub", ["GitHub"], "https://www.google.com/s2/favicons?domain=github.com&sz=128"),
    ("youtube", "YouTube", ["YouTube"], "https://www.google.com/s2/favicons?domain=youtube.com&sz=128"),
    ("comptarex", "comptarex", ["comptarex", "Comptarex"], None),  # notre faux logiciel : pas de logo
]


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def save_app_icon(app: Path, dest: Path) -> bool:
    image = NSWorkspace.sharedWorkspace().iconForFile_(str(app))
    if image is None:
        return False
    image.setSize_(NSSize(SIZE, SIZE))
    rep = NSBitmapImageRep.alloc().initWithBitmapDataPlanes_pixelsWide_pixelsHigh_bitsPerSample_samplesPerPixel_hasAlpha_isPlanar_colorSpaceName_bytesPerRow_bitsPerPixel_(
        None, SIZE, SIZE, 8, 4, True, False, "NSCalibratedRGBColorSpace", 0, 0)
    from AppKit import NSGraphicsContext
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.setCurrentContext_(NSGraphicsContext.graphicsContextWithBitmapImageRep_(rep))
    pad = SIZE * 0.1  # les icônes macOS ont ~10 % de marge transparente : on la rogne pour qu'elles tiennent la taille
    image.drawInRect_(NSMakeRect(-pad, -pad, SIZE + 2 * pad, SIZE + 2 * pad))
    NSGraphicsContext.restoreGraphicsState()
    data = rep.representationUsingType_properties_(NSPNGFileType, None)
    return bool(data and data.writeToFile_atomically_(str(dest), True))


def aliases_for(name: str) -> list[str]:
    names = [name]
    for v in VENDORS:
        if name.startswith(v):
            short = name[len(v):]
            if short.lower() not in GENERIC:
                names.append(short)
    return names


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    entries: list[dict] = []

    # 1. Applications installées
    seen: set[str] = set()
    for d in APP_DIRS:
        if not d.exists():
            continue
        for app in sorted(d.glob("*.app")):
            name = app.stem
            key = slug(name)
            if key in seen:
                continue
            if save_app_icon(app, OUT / f"{key}.png"):
                seen.add(key)
                entries.append({"key": key, "label": name, "aliases": aliases_for(name), "file": f"{key}.png", "kind": "app"})
    print(f"Applications : {len(seen)} icône(s)")

    # 2. Sites web (un seul téléchargement, gardé ensuite)
    web_ok = 0
    for key, label, aliases, url in WEB:
        if key in seen or url is None:
            continue
        dest = OUT / f"{key}.png"
        if not dest.exists():
            # curl utilise les certificats du Mac (le Python du projet n'a pas toujours les siens)
            r = subprocess.run(["curl", "-sfL", "--max-time", "10", "-A", "twiin-icons/1.0", "-o", str(dest), url])
            if r.returncode != 0 or not dest.exists() or dest.stat().st_size < 100:
                dest.unlink(missing_ok=True)
                print(f"  {label} : échec du téléchargement")  # pas de réseau : on garde la liste sans ce logo
                continue
        seen.add(key)
        web_ok += 1
        entries.append({"key": key, "label": label, "aliases": aliases, "file": f"{key}.png", "kind": "web"})
    print(f"Sites web : {web_ok} icône(s)")

    # 3. Alias de l'audit (identifiants d'application, ex. com.microsoft.Excel) vers l'icône déjà trouvée
    try:
        tools = json.loads(REGISTRY.read_text())["tools"]
        by_key = {e["key"]: e for e in entries}
        for t in tools:
            for a in t.get("apps", []):
                for e in by_key.values():
                    if e["kind"] == "app" and a.lower().rstrip(".").endswith(e["label"].split()[-1].lower()) and a not in e["aliases"]:
                        if a.startswith("com.") or a == e["label"]:
                            e["aliases"].append(a)
    except Exception:
        pass

    # Les noms les plus longs d'abord : « Microsoft Excel » gagne sur « Excel », « Google Sheets » sur « Sheets ».
    entries.sort(key=lambda e: -max(len(a) for a in e["aliases"]))
    (OUT / "icons.json").write_text(json.dumps({"icons": entries}, ensure_ascii=False, indent=1) + "\n")
    print(f"→ {OUT / 'icons.json'} ({len(entries)} outils)")


if __name__ == "__main__":
    main()
