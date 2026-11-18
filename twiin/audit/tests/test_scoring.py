"""Score des 5 tâches fixtures (contrats d'alternance), dont une sous le seuil « ne pas automatiser »."""
import pytest

from twiin_audit import scoring


@pytest.fixture
def fiche(exemple_v2, taches):
    return {**exemple_v2, "taches": taches}


@pytest.fixture
def opps(fiche):
    return {o["tache_id"]: o for o in scoring.opportunites(fiche)}


def test_cout_hebdo_milieu_des_tranches(opps):
    assert opps["t1"]["cout_hebdo_min"] == 13 * 22.5     # 6-20 fois × 15-30 min
    assert opps["t2"]["cout_hebdo_min"] == 13 * 10       # 6-20 × 5-15
    assert opps["t4"]["cout_hebdo_min"] == 13 * 2.5      # 6-20 × < 5
    assert opps["t5"]["cout_hebdo_min"] == 1 * 75        # 1 × > 1 h


def test_recommandations(opps):
    assert opps["t1"]["recommandation"] == "automatiser"
    assert opps["t4"]["recommandation"] == "ne_pas_automatiser"   # 32,5 min/semaine < 60
    assert opps["t5"]["recommandation"] == "simplifier_d_abord"   # potentiel 30 < 35


def test_top3_a_observer_et_tri(fiche):
    out = scoring.opportunites(fiche)
    top = [o["tache_id"] for o in out if o["a_observer"]]
    assert top == ["t1", "t2", "t3"]
    assert all(o["recommandation"] == "automatiser" for o in out if o["a_observer"])
    prios = [o["priorite"] for o in out if o["recommandation"] == "automatiser"]
    assert prios == sorted(prios, reverse=True)


def test_priorite_et_gains(opps, fiche):
    o = opps["t1"]
    assert o["priorite"] == round(o["cout_hebdo_min"] * o["potentiel"] / 100 * o["facilite"] / 100, 1)
    assert o["gain_heures_semaine"] == round(292.5 / 60, 1)
    assert o["gain_euros_an"] == round(292.5 / 60 * fiche["dirigeant"]["cout_horaire"] * 47)


def test_tranches_facilite():
    assert scoring.tranche(65) == "facile" and scoring.tranche(64.9) == "moyen"
    assert scoring.tranche(35) == "moyen" and scoring.tranche(34) == "difficile"


def test_je_ne_sais_pas_ne_chiffre_pas_au_hasard(fiche):
    fiche["taches"][0]["frequence_tranche"] = "je_ne_sais_pas"
    o = {x["tache_id"]: x for x in scoring.opportunites(fiche)}["t1"]
    assert o["cout_hebdo_min"] is None and o["recommandation"] == "a_preciser" and not o["a_observer"]


def test_exceptions_frequentes_baissent_potentiel_et_facilite(fiche):
    base = {x["tache_id"]: x for x in scoring.opportunites(fiche)}["t2"]
    fiche["taches"][1]["exceptions_transcript"] = "Ça dépend, c'est souvent au cas par cas."
    apres = {x["tache_id"]: x for x in scoring.opportunites(fiche)}["t2"]
    assert apres["potentiel"] < base["potentiel"] and apres["facilite"] < base["facilite"]


def test_plus_lourdes_pour_les_questions_5_a_7(taches):
    assert scoring.plus_lourdes(taches) == ["t1", "t2", "t3"]
