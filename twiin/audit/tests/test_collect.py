"""Temps 1 : inventaire. Le module navigateur ne sort jamais d'URL ; filtre métier couches 1 et 2 ; dédoublonnage."""
import json
import sqlite3
from datetime import datetime, timedelta, timezone

from twiin_audit import collect

EPOCH = datetime(1601, 1, 1, tzinfo=timezone.utc)


def faux_historique(dossier, visites):
    profil = dossier / "Default"
    profil.mkdir(parents=True)
    con = sqlite3.connect(profil / "History")
    con.execute("CREATE TABLE urls (id INTEGER PRIMARY KEY, url TEXT, title TEXT)")
    con.execute("CREATE TABLE visits (id INTEGER PRIMARY KEY, url INTEGER, visit_time INTEGER)")
    for i, (url, quand) in enumerate(visites, 1):
        con.execute("INSERT INTO urls VALUES (?, ?, ?)", (i, url, "Titre privé de la page"))
        con.execute("INSERT INTO visits VALUES (?, ?, ?)", (i, i, int((quand - EPOCH).total_seconds() * 1e6)))
    con.commit()
    con.close()


def test_navigateur_ne_sort_jamais_d_url_ni_de_titre(tmp_path):
    now = datetime(2026, 11, 18, 12, tzinfo=timezone.utc)
    faux_historique(tmp_path, [
        ("https://mail.google.com/mail/u/0/#inbox/SECRET123", now - timedelta(days=1)),
        ("https://mail.google.com/mail/u/0/#inbox/AUTRE", now - timedelta(days=2)),
        ("https://www.linkedin.com/in/une-personne-privee/", now - timedelta(days=3)),
        ("https://mon-medecin.example.org/rdv?patient=42", now - timedelta(days=1)),   # domaine inconnu : jamais gardé
        ("https://mail.google.com/vieux", now - timedelta(days=45)),                   # hors des 30 jours
    ])
    domaines = collect.domaines_chrome(tmp_path, now=now)
    apps = collect.depuis_navigateur(domaines)
    texte = json.dumps(apps)
    for interdit in ("SECRET123", "une-personne-privee", "medecin", "patient", "Titre privé", "http", "/mail/"):
        assert interdit not in texte
    par_id = {a["id"]: a for a in apps}
    assert set(par_id) == {"gmail", "linkedin"}
    assert par_id["gmail"]["usage"]["jours_utilises_30"] == 2
    assert par_id["gmail"]["sources_detection"] == ["historique_navigateur"]


def scan(*composants):
    return {"tools": [{"components": [dict(c) for c in composants]}]}


def test_filtre_metier_couches_1_et_2():
    apps = {a["id"]: a for a in collect.depuis_scan(scan(
        {"name": "Microsoft Excel", "bundle_id": "com.microsoft.Excel", "usage_days": 18},
        {"name": "Spotify", "bundle_id": "com.spotify.client"},
        {"name": "Google Chrome", "bundle_id": "com.google.Chrome"},
        {"name": "OutilMaison", "bundle_id": "fr.pme.outil"},
        {"name": "Microsoft AutoUpdate Helper", "bundle_id": "com.microsoft.autoupdate"},
    ))}
    assert apps["excel"]["filtre_metier"]["methode"] == "catalogue" and apps["excel"]["usage"]["frequence"] == "quotidien"
    assert apps["spotify"]["filtre_metier"]["est_metier"] is False
    assert apps["spotify"]["api"]["disponibilite"] == "non_recherchee"                  # jamais de recherche d'API
    assert apps["google-chrome"]["filtre_metier"]["methode"] == "liste_exclusion"
    assert apps["outilmaison"]["filtre_metier"]["a_valider"] is True                   # inconnu : à confirmer par l'employé
    assert not any("helper" in i for i in apps)


def test_une_appli_vue_deux_fois_est_dedoublonnee():
    bureau = collect.depuis_scan(scan({"name": "Microsoft Outlook", "bundle_id": "com.microsoft.Outlook", "usage_days": 5}))
    web = collect.depuis_navigateur({"outlook.office.com": {"2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04",
                                                           "2026-11-05", "2026-11-06", "2026-11-07"}})
    apps = collect.fusionner(bureau, web)
    assert len(apps) == 1
    assert apps[0]["sources_detection"] == ["logiciel_installe", "historique_navigateur"]
    assert apps[0]["usage"]["jours_utilises_30"] == 7


def test_resume_recalcule():
    apps = collect.depuis_scan(scan({"name": "Microsoft Excel"}, {"name": "Spotify"}, {"name": "OutilMaison"}))
    r = collect.resume(apps)
    assert (r["nb_detectees"], r["nb_metier"], r["nb_avec_api"], r["nb_api_inconnue"], r["nb_a_valider"]) == (3, 2, 1, 1, 1)
