#!/usr/bin/env python3
"""Bloc Holo « web » d'une automatisation : Holo LIT une page web dans un navigateur INVISIBLE (sans fenêtre),
sans jamais prendre la souris ni le clavier de l'employé, qui continue à travailler.

    echo '{"url": "https://…", "label": "le casque Bose QC Ultra", "columns": ["site", "prix", "lien"]}' \\
        | python -m discovery.web_read

Sortie (une ligne JSON) : {"ok": true, "data": {"site": …, "prix": …, "lien": …}, "seconds": …, "calls": …}
Le lien est celui de la page réellement ouverte (lu par le navigateur, pas recopié par Holo).
"""
import json
import os
import re
import sys
import tempfile
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT.parent / ".env")
load_dotenv(ROOT / ".env")

from discovery.agent import run_agent  # noqa: E402

MODEL = os.environ.get("HOLO_WEB_MODEL") or os.environ.get("HOLO_MODEL") or "holo4-35b-a3b"


def main():
    req = json.loads(sys.stdin.read().lstrip("﻿") or "{}")  # PowerShell ajoute parfois un BOM
    url, cols = req.get("url") or "https://www.google.com", list(req.get("columns") or [])
    label = req.get("label") or "the item of the task"
    mission = (f"You are on a web page. Find and READ, exactly as displayed, these values for {label}: {', '.join(cols)}. "
               "If the page asks about cookies, refuse them. If the item is not on this page, look for it on this site "
               "(search box), but never buy, add to cart, log in or fill any form. Use note to write the values down "
               "as you read them. Then call done with summary = ONLY a JSON object with exactly these keys: "
               f"{json.dumps(cols, ensure_ascii=False)} (\"—\" if a value is really absent).")
    out = Path(tempfile.mkdtemp(prefix="twiin-web-"))
    res = run_agent(url, mission, out, MODEL, max_steps=int(req.get("max_steps") or 25))
    m = re.search(r"\{.*\}", res.get("summary") or "", re.S)
    try:
        data = json.loads(m.group(0)) if m else {}
    except ValueError:
        data = {}
    data = {c: str(data.get(c, "")) for c in cols}
    final_url = res.get("final_url")
    for c in cols:  # le lien vient du navigateur, pas de la mémoire de Holo
        if re.search(r"lien|url|link", c, re.I) and final_url:
            data[c] = final_url
    print(json.dumps({"ok": any(v and v != "—" for v in data.values()), "data": data, "seconds": res["stats"]["seconds"],
                      "calls": res["stats"]["calls"], "model": MODEL}, ensure_ascii=False))


if __name__ == "__main__":
    main()
