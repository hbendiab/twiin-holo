#!/usr/bin/env python3
"""Bloc « lire la source » d'une automatisation de saisie : prend le document à saisir (facture PDF, texte…) le plus
récent dans un dossier du poste, en extrait les champs demandés, sans Holo et sans ouvrir de fenêtre.

    echo '{"columns": ["Fournisseur", "Montant HT"], "folder": "", "pattern": "facture"}' | python -m discovery.source_read

- folder vide : Téléchargements, Documents, Bureau (et leurs équivalents OneDrive).
- Un document déjà saisi n'est pas repris (liste locale workflows/runs/sources_saisies.json) ; "path" force un fichier.
Sortie : {"ok": true, "file": …, "data": {"Fournisseur": …, …}} ou {"ok": true, "data": null, "info": "rien de nouveau"}.
Le texte du document reste sur le poste ; seuls les champs demandés sont extraits (modèle de langue, comme l'analyse).
"""
import json
import sys
from pathlib import Path

from discovery.discovery import HF_MODEL, ROOT, fenced, hf_client

DONE = ROOT / "workflows" / "runs" / "sources_saisies.json"
EXT = {".pdf", ".txt", ".md", ".csv", ".eml"}


def roots(folder: str) -> list[Path]:
    if folder:
        return [Path(folder).expanduser()]
    h = Path.home()
    return [p for p in (h / "Downloads", h / "Téléchargements", h / "Documents", h / "Desktop", h / "Bureau",
                        h / "OneDrive" / "Documents", h / "OneDrive" / "Bureau") if p.exists()]


def text_of(p: Path) -> str:
    if p.suffix.lower() == ".pdf":
        from pypdf import PdfReader
        return "\n".join((pg.extract_text() or "") for pg in PdfReader(str(p)).pages[:10])
    return p.read_text(encoding="utf-8", errors="replace")


def pick(req: dict, done: set) -> Path | None:
    if req.get("path"):
        return Path(req["path"])
    pat = (req.get("pattern") or "").lower()
    hits = []
    for r in roots(req.get("folder") or ""):
        for p in r.glob("*"):  # pas de recherche récursive : les dossiers de dépôt sont « plats »
            if p.is_file() and p.suffix.lower() in EXT and pat in p.name.lower() and str(p) not in done:
                hits.append(p)
    return max(hits, key=lambda p: p.stat().st_mtime) if hits else None


def main():
    req = json.loads(sys.stdin.read().lstrip("﻿") or "{}")
    cols = list(req.get("columns") or [])
    line_cols = list(req.get("line_columns") or [])  # lignes d'un tableau (ex. lignes de facture), une entrée par ligne
    try:
        done = set(json.loads(DONE.read_text(encoding="utf-8")))
    except (OSError, ValueError):
        done = set()
    p = pick(req, done)
    if not p or not p.exists():
        print(json.dumps({"ok": True, "data": None, "info": "aucun nouveau document à saisir"}, ensure_ascii=False))
        return
    txt = text_of(p)[:12000]
    if not txt.strip():
        print(json.dumps({"ok": False, "file": str(p), "error": "document illisible (scan sans texte)"}, ensure_ascii=False))
        return
    r = hf_client().chat.completions.create(
        model=HF_MODEL, max_tokens=1200, temperature=0,
        messages=[{"role": "system", "content": "Extract fields from a business document. Return ONLY a JSON object with "
                   f"exactly these keys: {json.dumps(cols, ensure_ascii=False)}. Copy each value exactly as written in the "
                   "document (numbers with their decimals, no currency sign unless it is part of the field). \"\" if absent."
                   + (f" Add the key \"lignes\": one object per table row of the document, with exactly the keys "
                      f"{json.dumps(line_cols, ensure_ascii=False)}." if line_cols else "")},
                  {"role": "user", "content": txt}],
        extra_body={"reasoning_effort": "low"})
    raw = (r.choices[0].message.content or "").strip()
    raw = fenced(raw, "json") or raw[raw.find("{"): raw.rfind("}") + 1]
    try:
        data = json.loads(raw)
    except ValueError:
        data = {}
    lignes = [{c: str(r.get(c, "")) for c in line_cols} for r in (data.get("lignes") or []) if isinstance(r, dict)]
    data = {c: str(data.get(c, "")) for c in cols}
    if line_cols:
        data["lignes"] = lignes
    if req.get("mark", True) and any(data.values()):
        DONE.parent.mkdir(parents=True, exist_ok=True)
        DONE.write_text(json.dumps(sorted(done | {str(p)}), ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({"ok": any(data.values()), "file": str(p), "data": data}, ensure_ascii=False))


if __name__ == "__main__":
    main()
