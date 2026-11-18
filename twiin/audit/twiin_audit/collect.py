"""Temps 1 · audit passif : construit applications[] de la fiche v2 à partir de sources locales, sans effort de l'employé.

Sources (chacune seulement si elle est autorisée dans consentement.sources_autorisees) :
- logiciel_installe     : le scan du poste (capture/scripts/audit_poste.py), avec les jours d'utilisation si l'employé
                          a accepté le classement par utilisation ;
- historique_navigateur : l'historique de Chrome, copié puis lu en mémoire. On n'en garde QUE les domaines présents
                          dans data/catalogue_applis.yaml (outils métier connus), avec un nombre de jours de visite sur 30.
                          Aucune URL, aucun titre de page, aucun domaine inconnu n'est conservé.
Filtre métier (brief) : couche 1 liste d'exclusion, couche 2 catalogue. La couche 3 (LLM) n'est pas branchée : une appli
inconnue est gardée comme métier « à valider » (confiance 0,5), et c'est l'employé qui confirme à la question 1.
"""
from __future__ import annotations

import re
import shutil
import sqlite3
import tempfile
import unicodedata
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlsplit

import yaml

CATALOGUE_PATH = Path(__file__).resolve().parents[1] / "data" / "catalogue_applis.yaml"
CHROME_DIR = Path.home() / "Library" / "Application Support" / "Google" / "Chrome"
API_OUI = {"publique", "partenaire", "payante_entreprise"}
JOURS = 30


def _plain(text: str | None) -> str:
    t = unicodedata.normalize("NFKD", (text or "").lower())
    return "".join(c for c in t if not unicodedata.combining(c)).strip()


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", _plain(text)).strip("-") or "appli"


def charger_catalogue(path: Path = CATALOGUE_PATH) -> dict:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def frequence(jours: int | None) -> str:
    """Fréquence d'usage à partir des jours d'utilisation sur 30."""
    if jours is None:
        return "inconnu"
    return "quotidien" if jours >= 12 else "hebdomadaire" if jours >= 3 else "rare"


class Catalogue:
    def __init__(self, data: dict | None = None):
        data = data or charger_catalogue()
        self.exclusion = data.get("exclusion", [])
        self.applis = data.get("applis", [])
        self.par_id = {a["id"]: a for a in self.applis}

    def par_nom(self, nom: str, bundle: str = "") -> tuple[str, dict] | None:
        n, b = _plain(nom), (bundle or "").lower()
        for e in self.exclusion:
            if n in [_plain(x) for x in e.get("noms", [])]:
                return "exclusion", e
        for a in self.applis:
            if n in [_plain(x) for x in a.get("noms", [])] or n == _plain(a["nom"]):
                return "catalogue", a
            if b and any(b.startswith(x) for x in a.get("bundles", [])):
                return "catalogue", a
        return None

    def par_domaine(self, host: str) -> dict | None:
        h = (host or "").lower().removeprefix("www.")
        for a in self.applis:
            for d in a.get("domaines", []):
                if h == d or h.endswith("." + d):
                    return a
        return None


def application(entree: dict | None, *, id_: str, nom: str, type_: str, source: str, jours: int | None,
                methode: str, technique: str = "", version: str = "") -> dict:
    """Une entrée applications[] conforme au schéma v2."""
    if methode == "liste_exclusion":
        fm = {"est_metier": False, "categorie": entree.get("categorie", "autre"), "methode": "liste_exclusion", "confiance": 0.99,
              "justification": "Liste d'exclusion (navigateur, loisir ou utilitaire)", "a_valider": False}
        api = {"disponibilite": "non_recherchee", "confiance": 1.0}
        strat = "hors_perimetre"
    elif methode == "catalogue":
        fm = {"est_metier": True, "categorie": entree.get("categorie", "autre"), "methode": "catalogue", "confiance": 0.95,
              "justification": "Appli métier du catalogue Twiin", "a_valider": False}
        api = {"disponibilite": entree.get("api", "inconnue"), "methode": "catalogue", "confiance": 0.9}
        strat = "mock_api" if api["disponibilite"] in API_OUI else "computer_use" if api["disponibilite"] == "aucune" else "hybride"
    else:  # inconnue du catalogue : gardée, à confirmer par l'employé (Q1)
        fm = {"est_metier": True, "categorie": "autre", "methode": "catalogue", "confiance": 0.5,
              "justification": "Absente du catalogue : à confirmer par l'employé", "a_valider": True}
        api = {"disponibilite": "inconnue", "confiance": 0.3}
        strat = "hybride"
    app = {"id": id_, "nom": nom, "type": type_, "sources_detection": [source], "filtre_metier": fm, "api": api,
           "duplication": {"strategie": strat, "dans_process_observe": False, "statut": "a_faire" if fm["est_metier"] else "non_applicable"},
           "usage": {"frequence": frequence(jours)} | ({"jours_utilises_30": jours} if jours is not None else {})}
    if entree and entree.get("editeur"):
        app["editeur"] = entree["editeur"]
    if technique:
        app["identifiant_technique"] = technique
    if version:
        app["version"] = version
    return app


def depuis_scan(scan: dict, cat: Catalogue | None = None) -> list[dict]:
    """applications[] à partir du scan du poste (audit_poste.py). Les outils en ligne de commande sont ignorés ici."""
    cat = cat or Catalogue()
    out = []
    for tool in scan.get("tools", []):
        for c in tool.get("components", []):
            if c.get("via"):  # installé en ligne de commande
                continue
            nom, bundle = c.get("name", ""), c.get("bundle_id", "")
            if re.search(r"helper|handler|uninstall|updater|team render|c4dpy|commandline|crash|launcher|agent$", nom, re.I):
                continue
            hit = cat.par_nom(nom, bundle)
            jours = c.get("usage_days") if isinstance(c.get("usage_days"), int) else None
            if hit and hit[0] == "exclusion":
                out.append(application(hit[1], id_=hit[1]["id"], nom=hit[1]["nom"], type_="desktop", source="logiciel_installe",
                                       jours=jours, methode="liste_exclusion", technique=bundle, version=c.get("version", "")))
            elif hit:
                out.append(application(hit[1], id_=hit[1]["id"], nom=hit[1]["nom"], type_="desktop", source="logiciel_installe",
                                       jours=jours, methode="catalogue", technique=bundle, version=c.get("version", "")))
            else:
                out.append(application(None, id_=slug(nom), nom=nom, type_="desktop", source="logiciel_installe",
                                       jours=jours, methode="inconnue", technique=bundle, version=c.get("version", "")))
    return out


def domaines_chrome(chrome_dir: Path = CHROME_DIR, jours: int = JOURS, now: datetime | None = None) -> dict[str, set[str]]:
    """Domaines visités dans Chrome (tous les profils) → jours de visite. Rien d'autre ne sort de cette fonction."""
    now = now or datetime.now(timezone.utc)
    debut = now - timedelta(days=jours)
    epoch = datetime(1601, 1, 1, tzinfo=timezone.utc)  # horloge de Chrome : microsecondes depuis 1601
    seuil = int((debut - epoch).total_seconds() * 1_000_000)
    vus: dict[str, set[str]] = {}
    for hist in sorted(chrome_dir.glob("*/History")):
        with tempfile.TemporaryDirectory() as tmp:  # Chrome verrouille le fichier : on lit une copie, effacée aussitôt
            copie = Path(tmp) / "History"
            try:
                shutil.copy2(hist, copie)
                con = sqlite3.connect(f"file:{copie}?mode=ro", uri=True)
                rows = con.execute("SELECT urls.url, visits.visit_time FROM visits JOIN urls ON urls.id = visits.url "
                                   "WHERE visits.visit_time > ?", (seuil,)).fetchall()
                con.close()
            except (OSError, sqlite3.Error):
                continue
        for url, t in rows:
            host = (urlsplit(url).hostname or "").lower()
            if not host:
                continue
            jour = (epoch + timedelta(microseconds=t)).date().isoformat()
            vus.setdefault(host, set()).add(jour)
        del rows
    return vus


def depuis_navigateur(domaines: dict[str, set[str]], cat: Catalogue | None = None) -> list[dict]:
    """applications[] des outils web métier : seuls les domaines du catalogue sont gardés (filtre de confidentialité)."""
    cat = cat or Catalogue()
    jours_par_app: dict[str, set[str]] = {}
    for host, jours in domaines.items():
        a = cat.par_domaine(host)
        if a:
            jours_par_app.setdefault(a["id"], set()).update(jours)
    return [application(cat.par_id[i], id_=i, nom=cat.par_id[i]["nom"], type_="saas_web", source="historique_navigateur",
                        jours=len(j), methode="catalogue", technique=cat.par_id[i].get("domaines", [""])[0])
            for i, j in jours_par_app.items()]


def fusionner(*listes: list[dict]) -> list[dict]:
    """Une même appli vue par plusieurs sources = une seule entrée (sources réunies, le plus grand nombre de jours)."""
    par_id: dict[str, dict] = {}
    for liste in listes:
        for a in liste:
            if a["id"] not in par_id:
                par_id[a["id"]] = a
                continue
            b = par_id[a["id"]]
            b["sources_detection"] = list(dict.fromkeys(b["sources_detection"] + a["sources_detection"]))
            ja, jb = (a.get("usage") or {}).get("jours_utilises_30"), (b.get("usage") or {}).get("jours_utilises_30")
            if ja is not None and (jb is None or ja > jb):
                b["usage"] = a["usage"]
    return list(par_id.values())


def resume(applications: list[dict]) -> dict:
    metier = [a for a in applications if a["filtre_metier"]["est_metier"]]
    disp = [a["api"]["disponibilite"] for a in metier]
    return {"nb_detectees": len(applications), "nb_metier": len(metier),
            "nb_avec_api": sum(d in API_OUI for d in disp), "nb_sans_api": disp.count("aucune"),
            "nb_api_inconnue": disp.count("inconnue"), "nb_a_valider": sum(bool(a["filtre_metier"].get("a_valider")) for a in applications)}
