"""La fiche v2 d'exemple valide le schéma v2 ; une fiche v1 reste valide (compatibilité)."""
import jsonschema
import pytest

from twiin_audit import alertes, opportunites


def test_exemple_v2_valide(schema, exemple_v2):
    jsonschema.validate(exemple_v2, schema)
    assert exemple_v2["version_schema"] == "2.0"


def test_fiche_v1_toujours_valide(schema, exemple_v1):
    jsonschema.validate(exemple_v1, schema)


def test_resume_coherent(exemple_v2):
    apps = exemple_v2["applications"]
    metier = [a for a in apps if a["filtre_metier"]["est_metier"]]
    disp = [a["api"]["disponibilite"] for a in metier]
    r = exemple_v2["resume"]
    assert r["nb_detectees"] == len(apps)
    assert r["nb_metier"] == len(metier)
    assert r["nb_avec_api"] == sum(d in ("publique", "partenaire", "payante_entreprise") for d in disp)
    assert r["nb_sans_api"] == disp.count("aucune")


def test_exemple_a_jour_avec_le_calcul(exemple_v2):
    """Les opportunités et alertes de l'exemple sont exactement celles que le code calcule."""
    assert exemple_v2["opportunites"] == opportunites(exemple_v2)
    assert exemple_v2["alertes"] == alertes(exemple_v2)


@pytest.mark.parametrize("champ,valeur", [("frequence_tranche", "3"), ("duree_tranche", "2h"), ("declencheur", "telepathie")])
def test_valeurs_hors_liste_refusees(schema, exemple_v2, champ, valeur):
    exemple_v2["taches"][0][champ] = valeur
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(exemple_v2, schema)
