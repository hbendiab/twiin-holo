# Branche `feat/decouverte-env-test` : ce qui a été fait

Ce document est écrit pour l'équipe **et pour vos assistants IA** (Claude, etc.). Il explique ce que contient cette
branche, comment c'est organisé, comment le lancer, et les règles à respecter. Le document d'architecture complet est
[`docs/architecture.html`](architecture.html) (stack, étapes, version finale).

Auteur : Lucas (avec Claude). Base : `main` de Hanine (parcours 3 étapes, audit vocal, Back, tutos) fusionné dedans,
**sans casser son parcours** : sans clés Holo / Supabase, la page se comporte exactement comme sur `main`.

---

## 1. En une phrase

Après l'enregistrement d'une tâche, Twiin **vérifie qu'il a compris** (une seule question à l'employé :
« Ai-je bien compris votre problème ? »), **construit une copie de la tâche** (un « jumeau » : un faux logiciel en HTML,
sans données réelles), **essaie 5 façons de la faire** dessus avec Holo et n8n, puis **recommande** : accélérer
(conseils seulement) ou automatiser (workflow n8n testé, livré en un clic).

## 2. Le parcours (ce que voit l'employé)

1. **Audit du poste** (page de Hanine) : logiciels installés et utilisés, Mac et Windows.
2. **Enregistrer** une tâche (écran + OCR + journal de clics).
3. **Question** : Twiin résume ce qu'il a compris (problème, étapes, outils, **résultat attendu** sous forme de tableau
   avec les vraies valeurs lues à l'écran) et demande « Ai-je bien compris ? ». Rien d'autre n'est montré avant le « Oui ».
4. **Reco** : un bandeau montre l'avancement des essais (non bloquant), puis l'encart de solution s'affiche dans la page :
   - **Automatiser** : bouton « Créer cette automatisation » → workflow n8n importé (inactif) dans « Mes automatisations ».
   - **Accélérer** : conseils et tuto seulement, **aucune trace d'automatisation** (l'option est masquée).
5. **Mes automatisations** : lancer, **Arrêter**, planifier finement (jours, heure, minutes), voir les échecs avec leur cause.
6. **Mise en service** (DSI) : les autorisations à donner une fois par éditeur, déduites des audits des postes.

## 3. Le moteur de découverte (`twiin/discovery/`)

| Fichier | Rôle |
|---|---|
| `discovery.py` | Orchestration : cadrage (la question, ~4 à 30 s), jumeau (HTML généré par Qwen), classement des outils (api / page / écran), 5 itérations, notation, recommandation (`propose`), écriture Supabase |
| `agent.py` | Boucle Holo dans un navigateur **invisible** (Playwright headless) : outils `click`, `type_text`, `scroll`, `press_key`, `wait`, `note` (mémoire de travail), `done` ; « fini » refusé tant que le résultat est incomplet ; listes de suggestions et listes déroulantes gérées pour tout site ; clics « valider / payer / envoyer / supprimer » bloqués |
| `automation.py` | Itérations « automatisation » : workflows n8n testés contre l'API simulée du jumeau |
| `build_automation.py` | Construit le plan n8n livré à partir de la solution gagnante ; choisit seul le modèle : **lecture web → Excel** ou **document → saisie web** |
| `web_read.py` | Bloc « Holo lit une page web » (navigateur invisible) |
| `source_read.py` | Bloc « lire le document à saisir » (PDF via pypdf, lignes de tableau, destinataire) |
| `web_fill.py` | Bloc « Holo saisit dans un logiciel web sans API » : connexion par le coffre local (Holo ne voit jamais le mot de passe), enregistrement en brouillon, **contrôle champ par champ** + messages d'erreur du logiciel |
| `excel_write.py` | Écrit des lignes dans un classeur Excel du poste par le fichier (openpyxl), sans ouvrir Excel |
| `supa.py` | Accès Supabase (tables `taches`, `tests`, `recommendations`, …) |

**Les 5 itérations** (règle fixée) : 3 « conseil » (3 agents Holo en parallèle, même point de départ, jamais le même
parcours, registre partagé en direct ; le chemin n°0 vient du journal d'actions de l'employé) + 2 « automatisation »
décidées d'avance selon la présence d'API : **n8n natif** (2 variantes n8n) ou **n8n + Holo** (2 variantes Holo).

**Notation** : chaque essai est comparé au résultat attendu **validé par l'employé** dans la question (texte tolérant à la
mise en forme, nombres stricts). Au moins 90 % → automatiser ; sinon → accélérer.

## 4. Le serveur (`twiin/recorder/server.js`)

Routes ajoutées (toutes locales) :
- Découverte : `/api/discovery`, `/api/discovery/answer`, `/api/discovery/internal`, `/api/reanalyze` (avec `{session}`).
- Automatisations : `/api/automations/from-discovery`, `/:id/stop`, `/:id/schedule`, `/:id/retry`, `/api/stop-all`.
- Ponts n8n → poste (jeton `TWIIN_LOCAL_TOKEN`, appel local uniquement) : `/api/holo/web`, `/api/excel/write`,
  `/api/source/read`, `/api/holo/fill`.
- `/api/setup` (Mise en service).

Interrupteur **temporaire** `DISCOVERY=off` : la découverte est active par défaut ; l'interrupteur sera **supprimé au rendu final**.

## 5. Mac et Windows

Le même code détecte le système. Équivalents Windows : `actions_win.py` (pynput + UI Automation), `ocr_win.py` (winocr),
audit par le registre, multi-écrans Win32, raccourci `install_hotkey.ps1`, aucune console qui s'ouvre (`windowsHide`),
arrêt complet des processus (`taskkill /T /F`), `PYTHONUTF8=1`. Python est trouvé dans `twiin/.venv` ou `../.venv`
(`bin` ou `Scripts`). Vérifier un poste : `python scripts/doctor.py` (n'affiche aucun secret).
Détails : [`portabilite-mac-windows.md`](portabilite-mac-windows.md), [`tests-windows.md`](tests-windows.md).

## 6. Supabase

Un seul projet, **tables fusionnées** (équipe : `dictionnaire`, `taches`, `tests`, `recommendations` ; page :
`profiles`, `audits`, `tutos`, `automations`, `automation_runs`, `back_log`), validé par Hanine. Migration idempotente :
`twiin/supabase/migrations/20261118120000_twiin_init.sql`. Isolation par entreprise (RLS sur `company_id`).
Seuls du texte et des chiffres y vont ; les captures restent sur le poste.

## 7. Lancer

```bash
cd twiin
python -m venv .venv && .venv/bin/pip install -e .      # Windows : .venv\Scripts\pip install -e .
cp .env.example .env                                     # remplir HF_TOKEN, HAI_API_KEY, SUPABASE_*
cd recorder && npm install && node server.js             # http://localhost:3000
n8n start                                                # pour les itérations et automatisations n8n (port 5678)
```

Terrain de test « facture » : QONTA (`comptarex/`), faux logiciel comptable sans API, `uv run comptarex-web` → port 8042.
Pour une saisie automatique dans un logiciel qui demande une connexion, mettre ses identifiants dans le coffre local
`twiin/workflows/runs/.coffre.json` (`{"hôte": {"login": "…", "password": "…"}}`, hors git).

## 8. Résultats mesurés

| Cas | Résultat |
|---|---|
| Cas 4 (comparatif casques) | plusieurs parcours à 100 % ; n8n natif 93 % en 2,5 s ; automatisation sans gêner l'employé de bout en bout en 51 s |
| Cas 1 (facture QONTA, jumeau) | 57-71 % → **100 %** après la gestion des champs à suggestions |
| Facture réelle dans QONTA | PDF INV-002 lu puis saisi en brouillon par Holo invisible en **79 s**, toutes les valeurs exactes (contrôle champ par champ) |
| Windows | rejeu Holo dans le Bloc-notes en 75 s ; audit : 39 outils détectés |

## 9. Règles à respecter (pour vous et vos assistants)

- **Aucun secret dans le dépôt** : clés dans `.env` (ignoré), mots de passe dans le coffre local (ignoré).
- **Ne pas casser le parcours de Hanine** : sans clés, la page doit rester identique à `main`.
- **L'employé ne configure rien** ; Holo (computer use) seulement là où il n'y a ni API ni page lisible.
- **Les automatisations ne prennent jamais l'écran** : navigateur invisible, bouton Arrêter, double Échap.
- **Pas de fenêtre surgissante** : tout s'affiche dans la page.
- Avant le rendu final : retirer l'interrupteur `DISCOVERY`.

## 10. Reste à faire

- Test de la branche sur Mac (Hanine).
- Parcours complet « facture » depuis la page (enregistrement → automatisation n8n de saisie exécutée).
- Comparaison holo3 / holo4 ; page « Suivi des tests ».
- Version cloud (voir l'architecture) : workers jetables, n8n par entreprise, coffre de secrets côté serveur, SSO.
