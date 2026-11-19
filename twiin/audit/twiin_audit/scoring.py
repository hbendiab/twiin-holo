"""Temps 3 · score des tâches déclarées (v1, pondérations à calibrer).

Pour chaque tâche de la fiche (`taches[]`), on calcule une opportunité (`opportunites[]`) :

    cout_hebdo_min = fréquence par semaine (milieu de la tranche) × durée en minutes (milieu de la tranche)
    potentiel      = moyenne de 3 critères 0-100 (inférés des questions 5 à 7)
                     · données structurées      : recopie d'un outil à l'autre, déclencheur « document reçu » ou « mail »
                     · peu de variantes         : la réponse à « que se passe-t-il quand ça ne se passe pas comme d'habitude ? »
                     · peu de décisions humaines : déclencheur « demande d'un collègue », mots de jugement dans la Q7
    facilite       = moyenne de 3 critères 0-100, + bonus recopie
                     · nombre d'applis traversées (moins = mieux)
                     · part des applis de la tâche qui ont une API
                     · stabilité du process (même critère que « peu de variantes »)
                     · bonus +10 si l'employé recopie d'un outil à l'autre (cible idéale pour le computer use), plafonné à 100
    tranche        = facile ≥ 65 · moyen 35-65 · difficile < 35   (logique UiPath Automation Hub)
    priorite       = cout_hebdo_min × potentiel/100 × facilite/100

Règle « ne pas automatiser » :
    cout_hebdo_min < 60 min/semaine  → « ne_pas_automatiser » (le gain ne vaut pas l'effort)
    sinon potentiel < 35             → « simplifier_d_abord » (process trop variable ou trop subjectif)
    fréquence ou durée inconnue      → « a_preciser » (on ne chiffre pas au hasard)
    sinon                            → « automatiser »

Top 3 : les 3 premières tâches « automatiser » par priorité sont marquées `a_observer`.
Gains : gain_heures_semaine = cout_hebdo_min / 60 ; gain_euros_an = cout_hebdo_min / 60 × cout_horaire × 47 semaines.
Toutes les constantes sont ci-dessous : les ajuster ici, et seulement ici.
"""
from __future__ import annotations

import unicodedata

# ── Milieux de tranche ────────────────────────────────────────────────────────────────────────────────────────────
FREQUENCE_MILIEU = {"1": 1.0, "2-5": 3.5, "6-20": 13.0, "20+": 25.0}            # fois par semaine (« 20+ » : 25 retenu)
DUREE_MILIEU = {"<5": 2.5, "5-15": 10.0, "15-30": 22.5, "30-60": 45.0, ">60": 75.0}  # minutes (« > 1 h » : 75 retenu)

# ── Seuils ────────────────────────────────────────────────────────────────────────────────────────────────────────
SEUIL_COUT_MIN = 60          # en dessous : ne pas automatiser
SEUIL_POTENTIEL = 35         # en dessous : simplifier d'abord
TRANCHE_FACILE = 65
TRANCHE_MOYEN = 35
SEMAINES_PAR_AN = 47
COUT_HORAIRE_DEFAUT = 35.0
TOP_A_OBSERVER = 3

# ── Pondérations des critères (v1) ────────────────────────────────────────────────────────────────────────────────
STRUCTURE = {"recopie_oui": 85, "recopie_non": 45, "recopie_inconnu": 55, "bonus_entree_document": 10}
VARIANTES = {"aucune": 80, "frequentes": 25, "decrites": 55}
DECISIONS = {"base": 75, "demande_collegue": 55, "malus_jugement": 35}
NB_APPLIS = {0: 50, 1: 100, 2: 80, 3: 60, 4: 40}   # 5 applis et plus : 20
NB_APPLIS_PLUS = 20
API_INCONNUE = 50                                   # aucune appli renseignée pour la tâche
BONUS_RECOPIE_FACILITE = 10
API_OUI = {"publique", "partenaire", "payante_entreprise"}

# Mots qui signalent un process qui varie souvent, ou des décisions humaines (Q7, après mise en minuscules sans accents)
MOTS_AUCUNE_EXCEPTION = ["rien", "jamais", "pas d'exception", "toujours pareil", "toujours la meme chose", "ca se passe bien"]
MOTS_VARIANTES = ["souvent", "a chaque fois", "toujours different", "ca depend", "beaucoup de cas", "plein de cas",
                  "ca varie", "chaque dossier est different", "jamais pareil", "au cas par cas"]
MOTS_JUGEMENT = ["je decide", "j'evalue", "je juge", "au cas par cas", "selon", "ca depend", "je valide", "validation",
                 "arbitr", "je verifie si", "il faut choisir"]


def _plain(text: str | None) -> str:
    t = unicodedata.normalize("NFKD", (text or "").lower())
    return "".join(c for c in t if not unicodedata.combining(c)).strip()


def cout_hebdo(tache: dict) -> float | None:
    f = FREQUENCE_MILIEU.get(tache.get("frequence_tranche") or "")
    d = DUREE_MILIEU.get(tache.get("duree_tranche") or "")
    return None if f is None or d is None else round(f * d, 1)


def score_variantes(transcript: str | None) -> int:
    """Peu de variantes / process stable (0-100), d'après la réponse libre à la Q7."""
    t = _plain(transcript)
    if not t or t in ("je ne sais pas", "aucune idee") or any(m in t for m in MOTS_AUCUNE_EXCEPTION) and not any(m in t for m in MOTS_VARIANTES):
        return VARIANTES["aucune"]
    if any(m in t for m in MOTS_VARIANTES):
        return VARIANTES["frequentes"]
    return VARIANTES["decrites"]


def score_structure(tache: dict) -> int:
    r = tache.get("recopie")
    s = STRUCTURE["recopie_oui"] if r is True else STRUCTURE["recopie_non"] if r is False else STRUCTURE["recopie_inconnu"]
    if tache.get("declencheur") in ("document_recu", "mail"):
        s += STRUCTURE["bonus_entree_document"]
    return min(100, s)


def score_decisions(tache: dict) -> int:
    s = DECISIONS["demande_collegue"] if tache.get("declencheur") == "demande_collegue" else DECISIONS["base"]
    if any(m in _plain(tache.get("exceptions_transcript")) for m in MOTS_JUGEMENT):
        s -= DECISIONS["malus_jugement"]
    return max(0, s)


def potentiel(tache: dict) -> tuple[int, dict]:
    d = {"donnees_structurees": score_structure(tache), "peu_de_variantes": score_variantes(tache.get("exceptions_transcript")),
         "peu_de_decisions": score_decisions(tache)}
    return round(sum(d.values()) / 3), d


def facilite(tache: dict, applications: dict[str, dict]) -> tuple[int, dict]:
    ids = list(dict.fromkeys(tache.get("applis_ids") or []))
    n = len(ids)
    nb = NB_APPLIS.get(n, NB_APPLIS_PLUS)
    known = [applications[i] for i in ids if i in applications]
    part_api = round(100 * sum((a.get("api") or {}).get("disponibilite") in API_OUI for a in known) / len(known)) if known else API_INCONNUE
    stabilite = score_variantes(tache.get("exceptions_transcript"))
    bonus = BONUS_RECOPIE_FACILITE if tache.get("recopie") is True else 0
    d = {"nb_applis": nb, "part_api": part_api, "stabilite": stabilite, "bonus_recopie": bonus}
    return min(100, round((nb + part_api + stabilite) / 3) + bonus), d


def tranche(f: float) -> str:
    return "facile" if f >= TRANCHE_FACILE else "moyen" if f >= TRANCHE_MOYEN else "difficile"


def recommandation(cout: float | None, pot: float) -> str:
    if cout is None:
        return "a_preciser"
    if cout < SEUIL_COUT_MIN:
        return "ne_pas_automatiser"
    if pot < SEUIL_POTENTIEL:
        return "simplifier_d_abord"
    return "automatiser"


def opportunites(fiche: dict) -> list[dict]:
    """Calcule opportunites[] pour toutes les tâches de la fiche, triées par priorité, top 3 marqués a_observer."""
    apps = {a["id"]: a for a in fiche.get("applications", [])}
    cout_horaire = float((fiche.get("dirigeant") or {}).get("cout_horaire") or COUT_HORAIRE_DEFAUT)
    out = []
    for t in fiche.get("taches", []):
        cout = cout_hebdo(t)
        pot, dpot = potentiel(t)
        fac, dfac = facilite(t, apps)
        prio = round((cout or 0) * pot / 100 * fac / 100, 1)
        out.append({
            "tache_id": t["id"], "cout_hebdo_min": cout, "potentiel": pot, "facilite": fac, "tranche_facilite": tranche(fac),
            "priorite": prio, "recommandation": recommandation(cout, pot), "a_observer": False,
            "gain_heures_semaine": None if cout is None else round(cout / 60, 1),
            "gain_euros_an": None if cout is None else round(cout / 60 * cout_horaire * SEMAINES_PAR_AN),
            "detail": {"potentiel": dpot, "facilite": dfac},
        })
    out.sort(key=lambda o: (o["recommandation"] != "automatiser", -o["priorite"]))
    for o in [o for o in out if o["recommandation"] == "automatiser"][:TOP_A_OBSERVER]:
        o["a_observer"] = True
    return out


def plus_lourdes(taches: list[dict], n: int = TOP_A_OBSERVER) -> list[str]:
    """Les n tâches les plus lourdes (fréquence × durée) : les questions 5 à 7 ne portent que sur elles."""
    chiffrees = [(cout_hebdo(t), t["id"]) for t in taches]
    return [i for c, i in sorted((x for x in chiffrees if x[0] is not None), key=lambda x: -x[0])[:n]]


__all__ = ["opportunites", "cout_hebdo", "potentiel", "facilite", "tranche", "recommandation", "plus_lourdes"]
