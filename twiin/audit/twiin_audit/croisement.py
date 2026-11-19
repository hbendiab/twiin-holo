"""Temps 3 · croisement de ce que l'employé DÉCLARE (taches[]) avec ce que l'audit passif a OBSERVÉ (applications[].usage).

Trois alertes :
- outil_non_observe       : une tâche déclarée utilise un outil jamais observé en 30 jours (absent de l'audit, ou 0 jour
                            d'utilisation). Si l'usage de l'outil est inconnu, on ne conclut pas.
- tache_cachee_possible   : une appli métier très utilisée (quotidienne, ou ≥ SEUIL_JOURS_TRES_UTILISEE jours sur 30)
                            n'est rattachée à aucune tâche → question de relance possible. Jamais pour un outil que
                            l'employé a décoché à la question 1 (« ne sert pas à mon travail »).
- surestimation_possible  : le temps déclaré (fréquence × durée, toutes tâches de l'outil) dépasse le temps d'usage observé
                            de l'outil par semaine. Seulement si ce temps observé est connu (usage.minutes_semaine).
"""
from __future__ import annotations

from .scoring import cout_hebdo

SEUIL_JOURS_TRES_UTILISEE = 8


def _nom(app: dict | None, app_id: str) -> str:
    return (app or {}).get("nom") or app_id


def alertes(fiche: dict) -> list[dict]:
    apps = {a["id"]: a for a in fiche.get("applications", [])}
    taches = fiche.get("taches", [])
    out: list[dict] = []

    # 1. outil déclaré mais jamais observé
    for t in taches:
        for app_id in dict.fromkeys(t.get("applis_ids") or []):
            a = apps.get(app_id)
            usage = (a or {}).get("usage") or {}
            if a is None or usage.get("jours_utilises_30") == 0:
                out.append({"type": "outil_non_observe", "tache_id": t["id"], "application_id": app_id,
                            "message": f"« {t['libelle']} » utilise {_nom(a, app_id)}, qui n'a pas été observé ces 30 derniers jours."})

    # 2. appli métier très utilisée, rattachée à aucune tâche
    utilisees = {i for t in taches for i in (t.get("applis_ids") or [])}
    for a in apps.values():
        if not (a.get("filtre_metier") or {}).get("est_metier") or a["id"] in utilisees:
            continue
        if a.get("confirmee_par_employe") is False:  # l'employé a dit (Q1) que l'outil ne sert pas à son travail
            continue
        usage = a.get("usage") or {}
        if usage.get("frequence") == "quotidien" or (usage.get("jours_utilises_30") or 0) >= SEUIL_JOURS_TRES_UTILISEE:
            out.append({"type": "tache_cachee_possible", "application_id": a["id"],
                        "message": f"{a['nom']} est très utilisé mais n'apparaît dans aucune tâche : à quoi vous sert-il ?"})

    # 3. temps déclaré > temps observé
    declare: dict[str, float] = {}
    for t in taches:
        c = cout_hebdo(t)
        if c is None:
            continue
        for app_id in dict.fromkeys(t.get("applis_ids") or []):
            declare[app_id] = declare.get(app_id, 0) + c
    for app_id, minutes in declare.items():
        observe = ((apps.get(app_id) or {}).get("usage") or {}).get("minutes_semaine")
        if observe is not None and minutes > observe:
            out.append({"type": "surestimation_possible", "application_id": app_id,
                        "message": f"{round(minutes)} min/semaine déclarées sur {_nom(apps.get(app_id), app_id)}, "
                                   f"pour {round(observe)} min/semaine observées."})
    return out
