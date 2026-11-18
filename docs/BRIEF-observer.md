# Twiin — Brief de build : brique OBSERVER (Audit + Capture)

> Brief d'origine (résumé). Implémentation : [capture/README.md](../capture/README.md).

## Objectif
Transformer **une démonstration d'un employé** (il fait sa tâche une fois en parlant) en une **procédure réutilisable**
(`session.json` + `skill.md` pour un agent H) + un **inventaire des outils** qu'il utilise (`audit.json`).
Périmètre MVP (démo jeudi) : un seul process, la **saisie d'une facture fournisseur**.

## Réutilisé de Show Me Once (github.com/Jean-Christophe972/show-me-once-hackathon-h)
- `chargebacks/chrome_cast/extension/` → `capture/extension/` (capteur)
- `chargebacks/chrome_cast/backend/app/{merge,gladia,hcompany,main}.py` → `capture/backend/app/`
- `chargebacks/chrome_cast/scripts/import_to_h.py` → `capture/scripts/`
- `comptarex/` → `comptarex/` (jumeau de démo + API de vérif `GET /api/invoices`, `POST /api/admin/reset`, `data/verite_terrain_factures.csv`)

## Construit pour Twiin
- **Audit** : `apps_sequence` → registre d'outils connus (`known_tools.json`) → `audit.json`
  `[{app, type: connu|inconnu, api: oui|non, connector, screenshots}]` ; captures des apps inconnues gardées dans `audit/<hôte>/`.
  Règle de confiance : liste des outils seulement, déclenché par l'employé, jamais en silence.
  Plus tard (hors démo) : inventaire de tout le poste.
- Viewer : carte Audit + `skill.md` éditable (inspiration Holo Forge : l'humain corrige avant de lancer).

## Règles H / Gladia
- Clés dans `capture/backend/.env` : `HAI_API_KEY`, `GLADIA_API_KEY` ; `GET /health` vérifie.
- Tâche dans `messages` (pas `instructions`) ; images base64 ≤ 8 et ≤ 5 Mo ; pas de vidéo.
- Connexion : profil navigateur (`HAI_USE_DEFAULT_PROFILE=true`) ou vault (`HAI_VAULT_ID`). Jamais d'identifiant dans un prompt.

## Sécurité (non négociable)
Aucun secret dans le repo · données de test uniquement · l'agent s'arrête au brouillon (« Enregistrer le brouillon », jamais « Valider ») · mots de passe/OTP masqués à la capture.

## Définition de « terminé »
- [ ] Une capture d'une saisie de facture produit `session.json` + `skill.md` relisibles dans le viewer.
- [ ] `audit.json` liste les apps vues, chacune taguée connu/inconnu + API oui/non.
- [ ] Une app inconnue voit ses captures d'écran conservées pour le jumeau.
- [ ] Un agent H relance la tâche sur comptarex depuis le `skill.md`, s'arrête au brouillon, et le résultat est vérifié via l'API de comptarex.
- [ ] Aucun secret commité ; `.env` ignoré ; données de test seulement.
