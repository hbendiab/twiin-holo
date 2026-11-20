#!/usr/bin/env python3
"""Prépare les deux scénarios de démonstration « Holo + n8n pendant que l'employé travaille » et les importe dans n8n.

    python demo/build_demo.py            -> données de test, plans, import dans n8n (inactifs)
    python demo/build_demo.py --reset    -> remet les données à zéro pour rejouer (feuille Excel vide, factures à saisir)

Scénario 1 « Facture » : une facture PDF reçue → Holo la saisit dans QONTA (logiciel web sans API), navigateur invisible,
  → vérification champ par champ → mail de confirmation à l'employé.
Scénario 2 « Prix » : le même casque relevé sur 3 boutiques → 3 lignes dans un classeur Excel → mail récapitulatif.
Tout est fictif : les 3 boutiques sont des pages locales (recorder/public/demo/), les factures viennent de QONTA.
"""
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
DOCS = Path.home() / "Documents" / "Twiin demo"
INBOX = DOCS / "Factures reçues"
XLSX = DOCS / "Veille prix casque.xlsx"
QONTA_PDFS = ROOT.parent.parent / "comptarex" / "data" / "inbox"
PLANS = Path(__file__).resolve().parent / "plans"
BASE = "http://127.0.0.1:3000/demo"
SOURCES_DONE = ROOT / "workflows" / "runs" / "sources_saisies.json"


def reset(pdfs=("INV-008.pdf", "INV-009.pdf", "INV-010.pdf")):  # INV-002/003/005/006/007 sont déjà saisies dans QONTA (doublon sinon)
    from openpyxl import Workbook
    INBOX.mkdir(parents=True, exist_ok=True)
    for f in INBOX.glob("*.pdf"):
        f.unlink()
    for name in pdfs:
        src = QONTA_PDFS / name
        if src.exists():
            shutil.copy(src, INBOX / name)
    wb = Workbook()
    ws = wb.active
    ws.title = "Prix"
    ws.append(["site", "prix", "lien"])
    wb.save(XLSX)
    try:
        SOURCES_DONE.unlink()
    except OSError:
        pass
    print("données remises à zéro :", len(list(INBOX.glob('*.pdf'))), "facture(s) à saisir,", XLSX.name, "vide")


def plan_facture():
    return {"id": "twiindemofacture", "name": "Démo · Facture PDF saisie dans QONTA", "schedule_cron": None, "blocks": [
        {"type": "source_read", "name": "Lire la facture reçue (PDF)", "folder": str(INBOX).replace("\\", "/"), "pattern": "INV",
         "columns": ["Fournisseur", "Référence fournisseur", "Date de facture"],
         "line_columns": ["Libellé", "Quantité", "Prix unitaire HT", "TVA"]},
        {"type": "holo_fill", "name": "Saisir dans QONTA (Holo, invisible)", "url": "http://127.0.0.1:8042/factures/nouvelle",
         "label": "la facture fournisseur"},
        {"type": "gmail_send", "name": "Prévenir l'employé par mail", "subject": "Twiin : ta facture est dans QONTA",
         "message": (
             "={{ (() => { const f = $('Saisir dans QONTA (Holo, invisible)').first().json, d = $('Lire la facture reçue (PDF)').first().json.data;"
             " if (!d) return 'Aucune nouvelle facture à saisir.';"
             " if (f.ok) return 'La facture ' + (d['Référence fournisseur'] || '') + ' de ' + (d.Fournisseur || '') + ' est saisie en brouillon dans QONTA,'"
             " + ' et chaque champ a été vérifié (' + Math.round(f.seconds || 0) + ' s). Tu n\\'as rien eu à faire : tu pouvais continuer à travailler.';"
             " return 'La saisie de la facture ' + (d['Référence fournisseur'] || '') + ' a besoin de ton regard : '"
             " + JSON.stringify((f.check && (f.check.missing || f.check.page_errors)) || f.error || 'erreur inconnue'); })() }}")},
    ]}


def plan_prix():
    shops = [("AudioMax", "shop-a"), ("SonoShop", "shop-b"), ("HiFi Direct", "shop-c")]
    blocks = [{"type": "holo_web", "name": f"Lire le prix chez {n}", "url": f"{BASE}/{p}.html",
               "label": "le casque audio Aurora X2 (nom de la boutique, prix actuel)", "columns": ["site", "prix", "lien"]} for n, p in shops]
    blocks += [
        {"type": "rows_from", "name": "Préparer les lignes", "sources": [b["name"] for b in blocks]},
        {"type": "excel_append", "name": "Écrire dans Veille prix casque.xlsx", "workbook": "Veille prix casque",
         "path": str(XLSX).replace("\\", "/")},
        {"type": "gmail_send", "name": "Envoyer le récapitulatif par mail", "subject": "Twiin : prix du casque Aurora X2 relevés",
         "message": ("={{ 'Prix relevés sur ' + $('Préparer les lignes').first().json.rows.length + ' boutiques :<br>'"
                     " + $('Préparer les lignes').first().json.rows.map((r) => r.site + ' : ' + r.prix).join('<br>')"
                     " + '<br><br>' + ($('Écrire dans Veille prix casque.xlsx').first().json.added || 0) + ' ligne(s) ajoutée(s) dans le classeur Excel.'"
                     " + ' Tu pouvais continuer à travailler pendant ce temps.' }}")},
    ]
    return {"id": "twiindemoprix", "name": "Démo · Prix du casque sur 3 boutiques", "schedule_cron": None, "blocks": blocks}


def main():
    reset()
    if "--reset" in sys.argv:
        return
    from automation import n8n_twiin as N
    PLANS.mkdir(parents=True, exist_ok=True)
    for plan in (plan_facture(), plan_prix()):
        (PLANS / f"{plan['id']}.json").write_text(json.dumps(plan, ensure_ascii=False, indent=2), encoding="utf-8")
        wf = N.compile_plan(dict(plan))
        N.import_workflow(wf)
        print("importé dans n8n :", wf["name"], f"({wf['id']}) — {len(wf['nodes'])} blocs")


if __name__ == "__main__":
    main()
