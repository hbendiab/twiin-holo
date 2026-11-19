# Brief Claude Code — Twiin, brique Audit (v1 hackathon)

## Contexte
Twiin est un produit pour PME/TPE : il observe un process métier, crée un jumeau des applis traversées, teste le process sur ce jumeau et ne certifie la carte du process qu'après un seuil de tests réussis.
Ce brief couvre uniquement la **brique Audit** : produire une fiche JSON qui liste les applis d'un poste, dit lesquelles sont métier, si elles ont une API, et quelle stratégie de duplication appliquer.

Le format de sortie est **fixé** : `fiche-audit.schema.json` (JSON Schema). Un exemple valide est dans `fiche-audit.exemple.json`. Toute sortie doit valider ce schéma.

## Objectif de la v1
Une commande `twiin audit` qui génère `out/fiche-audit.json` valide sur le Mac de démo, plus un dossier `specs/` contenant les docs/specs API récupérées.

## Architecture attendue (Python recommandé)
```
twiin_audit/
  collect/          # Brique 1 — inventaire (code pur, pas d'IA)
    installed.py    # macOS : /Applications + ~/Applications, lire Info.plist (CFBundleIdentifier, nom, version)
    downloads.py    # ~/Downloads : .dmg, .pkg, .exe, .zip d'installeurs
    browser.py      # Historique Chrome (copie du fichier History SQLite) -> domaines agrégés + fréquence
  filter/           # Filtre « appli métier ou non »
    denylist.yaml   # liste d'exclusion
    catalog.yaml    # catalogue d'applis connues -> catégorie
    classify.py     # orchestration des 3 couches
  api/              # Brique 2 — détection d'API
    catalog_lookup.py  # APIs.guru + catalog.yaml
    web_agent.py       # agent LLM + recherche web pour les cas inconnus
    fetch_specs.py     # télécharge la spec OpenAPI/Swagger si dispo -> specs/<id>.yaml
  report/
    build.py        # assemble la fiche + calcule `resume` + valide le schéma
  cli.py
tests/
```

## Brique 1 — Inventaire (code, pas d'agent)
- Logiciels installés : lire chaque `Info.plist` ; ignorer les apps sans bundle ID.
- Téléchargements : repérer les installeurs, les rapprocher des applis installées.
- Historique navigateur : **copier** le fichier SQLite (Chrome le verrouille), extraire uniquement les **domaines**, compter les visites sur 30 jours, déduire `frequence`.
- **Confidentialité (obligatoire)** : ne jamais stocker d'URL complète ni de titre de page ; garder uniquement les domaines qui passent le filtre métier ; identifiant de poste pseudonymisé. Respecter `consentement.sources_autorisees`.
- Dédupliquer : une même appli détectée par plusieurs sources = une seule entrée avec plusieurs `sources_detection`.

## Filtre « appli métier ou non » — 3 couches, de la moins chère à la plus chère
1. **Liste d'exclusion** (`denylist.yaml`) : bundle IDs `com.apple.*` système, pilotes, utilitaires, navigateurs, loisirs (Spotify, Steam, Netflix…), réseaux sociaux grand public. → `est_metier: false`, `methode: liste_exclusion`, confiance 0.99.
2. **Catalogue** (`catalog.yaml`) : applis métier connues (Pennylane, Qonto, PayFit, HubSpot, Salesforce, Google Workspace, Microsoft 365, Notion, DocuSign, Yousign, Sage, Cegid, Odoo…) → catégorie + confiance 0.95.
3. **LLM** pour le reste : envoyer **seulement** nom + éditeur + bundle ID/domaine (pas de données utilisateur). Réponse structurée : `{est_metier, categorie, confiance, justification}`.
- Si `confiance < 0.7` → `a_valider: true` (validation humaine dans le front).
- Commencer avec ~50 entrées dans chaque YAML, enrichir au fil des tests.

## Brique 2 — Détection d'API et récupération des docs
Uniquement pour les applis `est_metier: true`. Les autres → `api.disponibilite: non_recherchee`.
1. **Catalogue** : chercher dans APIs.guru (`https://api.apis.guru/v2/list.json`) et dans `catalog.yaml`.
2. **Agent web** si absent : chercher « <nom> API documentation » / « <nom> developer », classer `publique | partenaire | payante_entreprise | aucune | inconnue`, renseigner `doc_url`, `authentification`, `sources` (URLs réellement consultées — aucune URL inventée).
3. **Specs** : si une spec OpenAPI/Swagger existe, la télécharger dans `specs/<id>.yaml` et renseigner `spec_locale`. Sinon, seulement `doc_url`.
- Stratégie de duplication : spec OpenAPI dispo → `mock_api` ; API sans spec → `hybride` ; `aucune` → `computer_use` ; non métier → `hors_perimetre`.
- Mettre en cache les résultats par `id` d'appli pour ne pas relancer l'agent.

## Tests à écrire en premier
- La fiche d'exemple valide le schéma.
- `resume` est cohérent avec `applications` (compteurs recalculés).
- Le module navigateur ne sort jamais d'URL complète (test sur un faux fichier History).
- Le filtre classe correctement un jeu de 20 applis étiquetées à la main (Spotify, Réglages, Pennylane, Google Drive, un outil inconnu…).
- Une appli non métier n'a jamais de recherche d'API déclenchée.

## Hors périmètre v1
Windows, Firefox/Safari, génération des mocks, computer use, front. Le front pourra démarrer en parallèle sur `fiche-audit.exemple.json`.

## Ordre de travail suggéré
1. Validation du schéma + tests → 2. Inventaire macOS → 3. Filtre couches 1-2 → 4. Catalogue API → 5. Agent LLM (filtre couche 3 + recherche API) → 6. Téléchargement des specs → 7. CLI + rapport.
