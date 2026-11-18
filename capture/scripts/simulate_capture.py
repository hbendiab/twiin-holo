#!/usr/bin/env python3
"""Simule une capture Twiin (sans Chrome ni micro) pour tester le pipeline de bout en bout.

Scénario : l'employé ouvre la facture INV-001 reçue dans Gmail, puis la saisit en brouillon
dans comptarex (le faux logiciel de compta sans API). Les événements ont le même format que
ceux de l'extension ; les captures sont des images générées.

    python capture/scripts/simulate_capture.py                 # backend sur http://localhost:8000
    python capture/scripts/simulate_capture.py --backend http://localhost:8000 --site http://127.0.0.1:8042

Données fictives uniquement. Aucune dépendance hors bibliothèque standard (Pillow optionnel pour les images).
"""
import argparse
import base64
import io
import json
import time
import urllib.request
import uuid


def shot(text: str) -> str | None:
    try:
        from PIL import Image, ImageDraw
    except ImportError:
        return None
    im = Image.new("RGB", (640, 400), (212, 208, 200))
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, 640, 24], fill=(10, 36, 106))
    d.text((8, 6), "Simulation Twiin", fill="white")
    d.text((20, 60), text, fill="black")
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=70)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def ev(t, kind, url, title, shot_text=None, **kw):
    e = {"id": uuid.uuid4().hex[:12], "t": t, "kind": kind, "url": url, "title": title, "tab_id": 1, **kw}
    if shot_text:
        s = shot(shot_text)
        if s:
            e["screenshot"] = s
    return e


def field(name, label, tag="input", type_="text"):
    return {"tag": tag, "type": type_, "name": name, "label": label, "selector": f"{tag}[name='{name}']"}


def build(site: str) -> dict:
    gmail = "https://mail.google.com/mail/u/0/#inbox"
    fac = f"{site}/factures/nouvelle"
    events = [
        ev(0.0, "start", gmail, "Boîte de réception - Gmail", "Gmail : boîte de réception", open_tabs=[gmail]),
        ev(2.0, "click", gmail, "Gmail", "Gmail : mail Papeterie Martin, PJ INV-001.pdf",
           target={"tag": "span", "text": "Facture INV-001 - Papeterie Martin", "selector": "tr.zA span.bog"}, x=400, y=210),
        ev(6.0, "navigation", f"{site}/login", "QONTA Cabinet - Connexion", "comptarex : écran de connexion"),
        ev(8.0, "input", f"{site}/login", "QONTA Cabinet - Connexion", target=field("password", "Mot de passe", type_="password"),
           value="••••••", sensitive=True),
        ev(9.0, "click", f"{site}/login", "QONTA Cabinet - Connexion", "comptarex : bouton Connexion",
           target={"tag": "button", "type": "submit", "text": "Connexion", "selector": "form button[type=submit]"}, x=300, y=260),
        ev(9.8, "navigation", f"{site}/dossiers", "QONTA Cabinet - Dossiers"),
        ev(12.0, "click", f"{site}/dossiers", "QONTA Cabinet - Dossiers", "comptarex : liste des 14 dossiers",
           target={"tag": "a", "text": "00417 ATELIER DORN SAS", "href": f"{site}/dossiers/00417/ouvrir", "selector": "a[href$='00417/ouvrir']"}, x=120, y=140),
        ev(12.6, "navigation", f"{site}/bureau", "QONTA Cabinet - Bureau"),
        ev(15.0, "click", f"{site}/bureau", "QONTA Cabinet - Bureau", "comptarex : bureau, menu Saisie",
           target={"tag": "a", "text": "Nouvelle facture", "href": fac, "selector": "a[href$='/factures/nouvelle']"}, x=90, y=180),
        ev(15.5, "navigation", fac, "QONTA Cabinet - Facture fournisseur"),
        ev(19.0, "input", fac, "Facture fournisseur", "comptarex : formulaire facture vide",
           target={**field("fournisseur", "Fournisseur"), "id": "fournisseur"}, value="Papeterie Martin SARL"),
        ev(22.0, "input", fac, "Facture fournisseur", target=field("reference", "Référence fournisseur"), value="PM-2026-0412"),
        ev(25.0, "input", fac, "Facture fournisseur", target=field("date", "Date de facture"), value="02/10/2026"),
        ev(29.0, "input", fac, "Facture fournisseur", target=field("libelle", "Libellé"), value="Fournitures de bureau"),
        ev(31.0, "input", fac, "Facture fournisseur", target=field("quantite", "Quantité"), value="1"),
        ev(33.0, "input", fac, "Facture fournisseur", target=field("prix_unitaire", "Prix unitaire HT"), value="249,00"),
        ev(35.0, "input", fac, "Facture fournisseur", target=field("taxe", "Taxe", tag="select"), value="TVA 20 %"),
        ev(38.0, "click", fac, "Facture fournisseur", "comptarex : formulaire rempli, total 298,80",
           target={"tag": "button", "type": "submit", "name": "action", "text": "Enregistrer le brouillon",
                   "selector": "button[name=action][value=brouillon]"}, x=420, y=560),
        ev(38.7, "navigation", f"{site}/factures/1", "QONTA Cabinet - Facture n° 1 (brouillon)"),
        ev(40.0, "page_loaded", f"{site}/factures/1", "Facture n° 1 (brouillon)", "comptarex : facture enregistrée en brouillon"),
    ]
    meta = {"title": "Saisir une facture fournisseur (INV-001)",
            "goal": "Saisir la facture fournisseur reçue par e-mail dans le logiciel de compta, en brouillon, "
                    "pour le dossier 00417 ATELIER DORN SAS, sans la valider.",
            "started_at": time.strftime("%Y-%m-%dT%H:%M:%S"), "duration_s": 41, "simulated": True}
    return {"meta": meta, "events": events}


def post_import(backend: str, bundle: dict) -> dict:
    boundary = uuid.uuid4().hex
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"events_file\"; filename=\"bundle.json\"\r\n"
            f"Content-Type: application/json\r\n\r\n").encode() + json.dumps(bundle).encode() + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(f"{backend}/recordings/import", data=body, method="POST",
                                 headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--backend", default="http://localhost:8000")
    ap.add_argument("--site", default="http://127.0.0.1:8042", help="URL de comptarex")
    a = ap.parse_args()
    res = post_import(a.backend, build(a.site.rstrip("/")))
    rec = res["id"]
    for _ in range(30):
        with urllib.request.urlopen(f"{a.backend}/recordings/{rec}") as r:
            st = json.loads(r.read())["status"]
        if st.get("status") in ("ready", "error"):
            break
        time.sleep(1)
    print(json.dumps(st, ensure_ascii=False))
    print(f"Viewer : {a.backend}/viewer/{rec}")


if __name__ == "__main__":
    main()
