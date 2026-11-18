"""Temps 2 · questions pré-remplies à partir de DONNÉES RÉELLES uniquement (jamais d'un LLM qui invente) :
- Q1 (outils) : les applis métier observées au temps 1, les plus utilisées d'abord ;
- Q2 (tâches) : la bibliothèque data/taches_par_role.yaml, filtrée par le rôle OU par les applis détectées.
Chaque question garde une option « Autre » / « Je ne sais pas ».
"""
from __future__ import annotations

import unicodedata
from pathlib import Path

import yaml

LIB_PATH = Path(__file__).resolve().parents[1] / "data" / "taches_par_role.yaml"
MAX_OUTILS_Q1 = 12
MAX_TACHES_Q2 = 12   # au-delà, la liste devient une corvée : l'employé a toujours « Autre (dicter) »
FREQ_RANG = {"quotidien": 0, "hebdomadaire": 1, "rare": 2, "inconnu": 3}


def charger_bibliotheque(path: Path = LIB_PATH) -> dict:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def _plain(text: str | None) -> str:
    t = unicodedata.normalize("NFKD", (text or "").lower())
    return "".join(c for c in t if not unicodedata.combining(c)).strip()


def role_id(role_metier: str | None, lib: dict) -> str | None:
    """Le rôle de la bibliothèque qui correspond au rôle déclaré (« Assistante de direction » → assistant_direction)."""
    r = _plain(role_metier)
    if not r:
        return None
    for rid, info in lib["roles"].items():
        noms = [_plain(info["libelle"])] + [_plain(a) for a in info.get("alias", [])]
        if r in noms or any(n and n in r for n in noms):
            return rid
    return None


def outils_q1(fiche: dict, n: int = MAX_OUTILS_Q1) -> list[dict]:
    """Q1 : seulement des applis métier observées au temps 1, les plus utilisées d'abord, cochées par défaut."""
    apps = [a for a in fiche.get("applications", []) if (a.get("filtre_metier") or {}).get("est_metier")]
    def rang(a):
        u = a.get("usage") or {}
        return (-(u.get("jours_utilises_30") or 0), FREQ_RANG.get(u.get("frequence") or "inconnu", 3), a["nom"].lower())
    return [{"application_id": a["id"], "nom": a["nom"], "coche": True, "usage": a.get("usage") or {}} for a in sorted(apps, key=rang)[:n]]


def taches_q2(fiche: dict, lib: dict | None = None) -> list[dict]:
    """Q2 : tâches de la bibliothèque dont le rôle correspond, ou dont au moins une appli a été détectée au temps 1."""
    lib = lib or charger_bibliotheque()
    rid = role_id((fiche.get("poste") or {}).get("role_metier"), lib)
    detectees = {a["id"] for a in fiche.get("applications", [])}
    out = []
    for t in lib["taches"]:
        par_role = rid is not None and rid in t.get("roles", [])
        apps_vues = [a for a in t.get("applis", []) if a in detectees]
        if par_role or apps_vues:
            out.append({"suggestion_id": t["id"], "libelle": t["libelle"], "raison": "role" if par_role else "applis_detectees",
                        "applis_typiques": t.get("applis", []), "applis_detectees": apps_vues})
    # d'abord les tâches du rôle qui utilisent des applis vues, puis le rôle seul, puis les applis seules (les plus
    # d'applis vues d'abord) ; ordre de la bibliothèque à égalité
    out.sort(key=lambda x: (x["raison"] != "role", not x["applis_detectees"], -len(x["applis_detectees"])))
    return out[:MAX_TACHES_Q2]


def questions_temps2(fiche: dict, lib: dict | None = None) -> dict:
    """Les questions du temps 2, pré-remplies. Les options « Autre » et « Je ne sais pas » sont toujours là."""
    lib = lib or charger_bibliotheque()
    return {
        "temps_estime_min": 7,
        "q1_outils": {"question": "Voici les outils que tu utilises le plus. Lesquels servent à ton travail ?",
                      "options": outils_q1(fiche), "ajout_libre": True},
        "q2_taches": {"question": "Quelles tâches fais-tu au moins une fois par semaine ?",
                      "options": taches_q2(fiche, lib), "autre": "dicter", "je_ne_sais_pas": True},
        "q3_frequence": {"question": "Combien de fois par semaine ?", "options": ["1", "2-5", "6-20", "20+", "je_ne_sais_pas"]},
        "q4_duree": {"question": "Combien de temps à chaque fois ?", "options": ["<5", "5-15", "15-30", "30-60", ">60", "je_ne_sais_pas"]},
        "q5_outils_tache": {"question": "Quels outils ouvres-tu pour cette tâche ? Recopies-tu des infos de l'un à l'autre ?",
                            "options": "q1_outils", "recopie": [True, False, None]},
        "q6_declencheur": {"question": "Qu'est-ce qui la déclenche ?",
                           "options": ["mail", "date", "demande_collegue", "document_recu", "autre", "je_ne_sais_pas"]},
        "q7_exceptions": {"question": "Que se passe-t-il quand ça ne se passe pas comme d'habitude ?", "voix_libre": True, "facultatif": True},
        "q8_deleguer": {"question": "Si tu pouvais déléguer une seule tâche demain, laquelle ?", "options": "taches_cochees", "je_ne_sais_pas": True},
        "q3_a_q7_sur": "les 3 tâches les plus lourdes (fréquence × durée)",
    }
