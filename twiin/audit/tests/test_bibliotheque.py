"""Le temps 2 ne propose que des applis issues du temps 1 ou de la bibliothèque : jamais de suggestion inventée."""
from twiin_audit import bibliotheque as bib


def test_q1_seulement_des_applis_metier_observees(exemple_v2):
    q1 = bib.outils_q1(exemple_v2)
    observees = {a["id"] for a in exemple_v2["applications"] if a["filtre_metier"]["est_metier"]}
    assert q1 and {o["application_id"] for o in q1} <= observees
    assert "spotify" not in {o["application_id"] for o in q1}            # non métier : jamais proposée
    assert all(o["coche"] for o in q1)                                     # cochées par défaut
    jours = [o["usage"].get("jours_utilises_30") or 0 for o in q1]
    assert jours == sorted(jours, reverse=True)                            # les plus utilisées d'abord


def test_q2_seulement_des_taches_de_la_bibliotheque(exemple_v2):
    lib = bib.charger_bibliotheque()
    ids_lib = {t["id"] for t in lib["taches"]}
    q2 = bib.taches_q2(exemple_v2, lib)
    assert q2 and {t["suggestion_id"] for t in q2} <= ids_lib
    assert "sco_contrats_alternance" in {t["suggestion_id"] for t in q2}
    assert len(q2) <= bib.MAX_TACHES_Q2


def test_q2_par_role_ou_par_applis_detectees():
    lib = bib.charger_bibliotheque()
    par_role = bib.taches_q2({"poste": {"role_metier": "Comptable"}, "applications": []}, lib)
    assert par_role and all(t["raison"] == "role" for t in par_role)
    par_applis = bib.taches_q2({"poste": {"role_metier": "Pilote de ligne"}, "applications": [{"id": "hubspot"}]}, lib)
    assert par_applis and all("hubspot" in t["applis_detectees"] for t in par_applis)
    rien = bib.taches_q2({"poste": {"role_metier": "Pilote de ligne"}, "applications": [{"id": "inconnu"}]}, lib)
    assert rien == []


def test_toujours_autre_et_je_ne_sais_pas(exemple_v2):
    q = bib.questions_temps2(exemple_v2)
    assert q["q1_outils"]["ajout_libre"] and q["q2_taches"]["autre"] and q["q2_taches"]["je_ne_sais_pas"]
    for k in ("q3_frequence", "q4_duree", "q6_declencheur"):
        assert "je_ne_sais_pas" in q[k]["options"]


def test_role_reconnu_avec_variantes():
    lib = bib.charger_bibliotheque()
    assert bib.role_id("Assistante de direction", lib) == "assistant_direction"
    assert bib.role_id("Chargée des relations entreprises", lib) == "scolarite"
    assert bib.role_id("Astronaute", lib) is None


def test_bibliotheque_bien_formee():
    lib = bib.charger_bibliotheque()
    ids = [t["id"] for t in lib["taches"]]
    assert len(ids) == len(set(ids))
    for t in lib["taches"]:
        assert set(t["roles"]) <= set(lib["roles"]) and t["applis"]
    for r in lib["roles"]:
        assert sum(r in t["roles"] for t in lib["taches"]) >= 8
