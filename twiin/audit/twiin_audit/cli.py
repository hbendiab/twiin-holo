"""Ligne de commande de la brique Audit v2, appelée par le serveur de la page Twiin (JSON en entrée et en sortie).

    python -m twiin_audit.cli outils --scan scan.json [--navigateur]    temps 1 : applications[] + resume
    python -m twiin_audit.cli questions < fiche.json                    temps 2 : questions pré-remplies
    python -m twiin_audit.cli lourdes < taches.json                     les 3 tâches les plus lourdes (Q5 à Q7)
    python -m twiin_audit.cli resultat < fiche.json                     temps 3 : alertes + opportunités, fiche validée
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import jsonschema

from . import collect
from .bibliotheque import questions_temps2
from .croisement import alertes
from .scoring import opportunites, plus_lourdes

SCHEMA = Path(__file__).resolve().parents[1] / "schemas" / "fiche-audit.schema.json"


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    o = sub.add_parser("outils")
    o.add_argument("--scan", type=Path, required=True)
    o.add_argument("--navigateur", action="store_true", help="ajouter les outils web métier vus dans Chrome (domaines seulement)")
    sub.add_parser("questions")
    sub.add_parser("lourdes")
    sub.add_parser("resultat")
    a = ap.parse_args(argv)

    if a.cmd == "outils":
        cat = collect.Catalogue()
        apps = collect.depuis_scan(json.loads(a.scan.read_text()), cat)
        if a.navigateur:
            apps = collect.fusionner(apps, collect.depuis_navigateur(collect.domaines_chrome(), cat))
        out = {"applications": apps, "resume": collect.resume(apps)}
    elif a.cmd == "questions":
        out = questions_temps2(json.load(sys.stdin))
    elif a.cmd == "lourdes":
        out = plus_lourdes(json.load(sys.stdin))
    else:
        fiche = json.load(sys.stdin)
        fiche["version_schema"] = "2.0"
        fiche["alertes"] = alertes(fiche)
        fiche["opportunites"] = opportunites(fiche)
        erreurs = [f"{'/'.join(map(str, e.path))} : {e.message}"
                   for e in jsonschema.Draft202012Validator(json.loads(SCHEMA.read_text())).iter_errors(fiche)]
        out = {"fiche": fiche, "erreurs_schema": erreurs[:20]}
    json.dump(out, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
