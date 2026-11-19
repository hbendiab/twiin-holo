#!/usr/bin/env python3
"""Bloc « écrire dans Excel » d'une automatisation : ajoute des lignes dans un classeur .xlsx du poste, sans Holo et
sans ouvrir Excel (lecture/écriture du fichier). Les colonnes sont reconnues par leur en-tête (1re ligne).

    echo '{"path": "C:/Users/…/Comparatif.xlsx", "rows": [{"site": "…", "prix": "…"}]}' | python -m discovery.excel_write

Sortie : {"ok": true, "added": 3, "path": …} ; si le fichier est ouvert dans Excel, il est verrouillé :
{"ok": false, "error": "fichier ouvert dans Excel : ferme-le puis relance"}.
"""
import json
import sys
import unicodedata
from pathlib import Path


def norm(s) -> str:
    return " ".join(unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower().split())


def find_workbook(name: str) -> Path | None:
    """Le classeur le plus récent qui porte ce nom, dans Documents, Bureau, Téléchargements et OneDrive."""
    home = Path.home()
    roots = [home / "Documents", home / "Desktop", home / "Downloads", home / "OneDrive", home / "OneDrive" / "Documents",
             home / "OneDrive" / "Bureau", home / "Bureau"]
    stem = Path(name).stem.lower()
    hits = []
    for r in roots:
        if r.exists():
            hits += [p for p in r.rglob("*.xlsx") if p.stem.lower() == stem and not p.name.startswith("~$")]
    return max(hits, key=lambda p: p.stat().st_mtime) if hits else None


def main():
    from openpyxl import load_workbook
    req = json.loads(sys.stdin.read().lstrip("\ufeff") or "{}")
    path = Path(req["path"]) if req.get("path") else find_workbook(req.get("name") or "")
    if not path or not path.exists():
        print(json.dumps({"ok": False, "error": f"classeur introuvable : {req.get('path') or req.get('name')}"}, ensure_ascii=False))
        return
    rows = [r for r in (req.get("rows") or []) if isinstance(r, dict)]
    try:
        wb = load_workbook(path)
        ws = wb[req["sheet"]] if req.get("sheet") in wb.sheetnames else wb.active
        headers = [c.value for c in ws[1]]
        cols = {norm(h): i for i, h in enumerate(headers) if h}
        last = max((i for i, row in enumerate(ws.iter_rows(values_only=True), 1) if any(v not in (None, "") for v in row)),
                   default=1)
        for k, row in enumerate(rows, 1):
            for key, val in row.items():
                j = cols.get(norm(key))
                if j is not None:
                    ws.cell(row=last + k, column=j + 1, value=val)
        wb.save(path)
        print(json.dumps({"ok": True, "added": len(rows), "path": str(path)}, ensure_ascii=False))
    except PermissionError:
        print(json.dumps({"ok": False, "error": "fichier ouvert dans Excel : ferme-le puis relance", "path": str(path)},
                         ensure_ascii=False))


if __name__ == "__main__":
    main()
