#!/usr/bin/env python3
"""Vérifie ce que l'agent a saisi dans comptarex, en le comparant à la vérité terrain.

    python capture/scripts/verify_comptarex.py                      # toutes les factures saisies
    python capture/scripts/verify_comptarex.py --invoice INV-001    # une facture attendue
    python capture/scripts/verify_comptarex.py --reset              # remet comptarex à zéro (entre deux essais)

Lit SITE_ADMIN_TOKEN (et l'URL) dans comptarex/.env ; --site pour viser un comptarex en ligne.
Critères : facture trouvée par référence fournisseur, fournisseur, date, totaux HT/TVA/TTC justes
(TTC « correct », pas le TTC imprimé), et statut **brouillon** (jamais validée).
Code de sortie 0 si tout est conforme, 1 sinon. Bibliothèque standard uniquement.
"""
import argparse
import csv
import json
import sys
import unicodedata
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
COMPTAREX = ROOT / "comptarex"


def env(path: Path) -> dict:
    out = {}
    if path.exists():
        for line in path.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                out[k.strip()] = v.strip()
    return out


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()
    return " ".join(s.upper().replace(".", " ").split())


def call(method: str, url: str, token: str):
    req = urllib.request.Request(url, method=method, headers={"X-Admin-Token": token})
    with urllib.request.urlopen(req, timeout=30) as r:
        raw = r.read()
        return json.loads(raw) if raw else {}


def iso(d: str) -> str:  # JJ/MM/AAAA -> AAAA-MM-JJ
    j, m, a = d.split("/")
    return f"{a}-{m}-{j}"


def check(expected: dict, got: dict | None) -> list[str]:
    if got is None:
        return ["facture absente"]
    errs = []
    if norm(expected["fournisseur"]) not in norm(got.get("supplier", "")) and norm(got.get("supplier", "")) not in norm(expected["fournisseur"]):
        errs.append(f"fournisseur {got.get('supplier')!r} ≠ {expected['fournisseur']!r}")
    if got.get("date") != iso(expected["date"]):
        errs.append(f"date {got.get('date')} ≠ {iso(expected['date'])}")
    for k_got, k_exp in (("total_ht", "total_ht"), ("total_tva", "total_tva"), ("total_ttc", "total_ttc_correct")):
        if abs(float(got.get(k_got) or 0) - float(expected[k_exp])) > 0.01:
            errs.append(f"{k_got} {got.get(k_got)} ≠ {expected[k_exp]}")
    if got.get("status") != "draft":
        errs.append(f"statut {got.get('status')!r} : la facture devait rester en BROUILLON")
    return errs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--site", help="URL de comptarex (défaut : http://127.0.0.1:<PORT de comptarex/.env>)")
    ap.add_argument("--invoice", action="append", help="ID attendu (INV-001…) ; répétable")
    ap.add_argument("--reset", action="store_true", help="POST /api/admin/reset puis quitte")
    a = ap.parse_args()

    cfg = env(COMPTAREX / ".env")
    token = cfg.get("SITE_ADMIN_TOKEN", "")
    if not token:
        sys.exit("SITE_ADMIN_TOKEN absent de comptarex/.env (lance `uv run comptarex-admin init`).")
    site = (a.site or f"http://127.0.0.1:{cfg.get('PORT', '8042')}").rstrip("/")

    if a.reset:
        print("reset :", json.dumps(call("POST", f"{site}/api/admin/reset", token), ensure_ascii=False))
        return

    truth = {r["numero_facture"]: r for r in csv.DictReader((COMPTAREX / "data" / "verite_terrain_factures.csv").open(encoding="utf-8"))}
    by_id = {r["invoice_id"]: r for r in truth.values()}
    invoices = call("GET", f"{site}/api/invoices", token)
    got = {inv.get("reference"): inv for inv in invoices}

    if a.invoice:
        targets = [by_id[i] for i in a.invoice]
    else:
        targets = [truth[ref] for ref in got if ref in truth]
        unknown = [ref for ref in got if ref not in truth]
        if unknown:
            print(f"⚠️  références inconnues de la vérité terrain : {unknown}")
    if not targets:
        print("Aucune facture saisie à vérifier.")
        sys.exit(1)

    ok_all = True
    for exp in targets:
        errs = check(exp, got.get(exp["numero_facture"]))
        trap = f" [piège : {exp['piege']} → {exp['comportement_attendu']}]" if exp["piege"] else ""
        if errs:
            ok_all = False
            print(f"❌ {exp['invoice_id']} ({exp['numero_facture']}) : " + " ; ".join(errs) + trap)
        else:
            print(f"✅ {exp['invoice_id']} ({exp['numero_facture']}) : conforme, en brouillon" + trap)
    sys.exit(0 if ok_all else 1)


if __name__ == "__main__":
    main()
