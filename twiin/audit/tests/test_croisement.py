"""Les 3 alertes de croisement se déclenchent sur des fixtures dédiées, et seulement là."""
from twiin_audit import alertes


def app(i, jours=None, freq=None, minutes=None, metier=True):
    usage = {k: v for k, v in {"jours_utilises_30": jours, "frequence": freq, "minutes_semaine": minutes}.items() if v is not None}
    return {"id": i, "nom": i.title(), "usage": usage, "filtre_metier": {"est_metier": metier}}


def tache(i, apps, f="2-5", d="15-30"):
    return {"id": i, "libelle": f"Tâche {i}", "applis_ids": apps, "frequence_tranche": f, "duree_tranche": d}


def types(fiche):
    return sorted(a["type"] for a in alertes(fiche))


def test_outil_non_observe():
    fiche = {"applications": [app("crm", jours=0)], "taches": [tache("t", ["crm", "absent"])]}
    out = alertes(fiche)
    assert {(a["type"], a["application_id"]) for a in out} == {("outil_non_observe", "crm"), ("outil_non_observe", "absent")}


def test_usage_inconnu_ne_declenche_rien():
    fiche = {"applications": [app("crm")], "taches": [tache("t", ["crm"])]}
    assert alertes(fiche) == []


def test_tache_cachee_possible():
    fiche = {"applications": [app("teams", jours=15), app("spotify", jours=30, metier=False), app("crm", jours=12)],
             "taches": [tache("t", ["crm"])]}
    out = alertes(fiche)
    assert [(a["type"], a["application_id"]) for a in out] == [("tache_cachee_possible", "teams")]


def test_tache_cachee_par_frequence_quotidienne():
    fiche = {"applications": [app("drive", freq="quotidien")], "taches": []}
    assert types(fiche) == ["tache_cachee_possible"]


def test_surestimation_possible():
    # 2-5 fois × 15-30 min = 78,75 min déclarées, pour 30 min observées
    fiche = {"applications": [app("excel", jours=10, minutes=30)], "taches": [tache("t", ["excel"])]}
    assert types(fiche) == ["surestimation_possible"]


def test_pas_de_surestimation_si_coherent():
    fiche = {"applications": [app("excel", jours=10, minutes=300)], "taches": [tache("t", ["excel"])]}
    assert alertes(fiche) == []


def test_pas_de_tache_cachee_pour_un_outil_decoche():
    a = app("slack", jours=20)
    a["confirmee_par_employe"] = False
    assert alertes({"applications": [a], "taches": []}) == []
