# Twiin — brique OBSERVER (Audit + Capture)

L'employé fait sa tâche **une fois** en parlant. Twiin en tire :
1. une **procédure** réutilisable : `session.json` + `skill.md`, relue et corrigée par l'employé dans le viewer ;
2. un **audit des outils** : `audit.json`, chaque app vue taguée *connu* (API/connecteur) ou *inconnu* (jumeau par captures d'écran).

Périmètre MVP : un seul process, la **saisie d'une facture fournisseur** dans `comptarex` (faux logiciel de compta sans API).

> Repris de [Show Me Once](https://github.com/Jean-Christophe972/show-me-once-hackathon-h) (Jean-Christophe Dorn), dossier `chargebacks/chrome_cast/`.
> Ajouts Twiin : module Audit, édition du `skill.md` dans le viewer, règle « s'arrêter au brouillon », réécriture d'URL locale → publique, scripts de simulation et de vérification.

```
extension/   Extension Chrome MV3 : écran + micro + événements DOM, une capture par clic, mots de passe/OTP masqués
backend/     FastAPI : stockage, transcription Gladia, timeline (merge.py), audit (audit.py), skill.md, envoi à H
scripts/     simulate_capture.py · verify_comptarex.py · import_to_h.py
```

## 1. Lancer (3 terminaux, depuis la racine `twiin-holo/`)

```bash
# A. Le jumeau de démo (comptarex) — http://127.0.0.1:8042
cd comptarex && uv sync && uv run comptarex-admin init && uv run comptarex-web
#   identifiants de connexion : comptarex/.env (SITE_LOGIN / SITE_PASSWORD)

# B. Le backend Observer — http://localhost:8000
cd capture/backend && cp .env.example .env    # renseigner HAI_API_KEY et GLADIA_API_KEY
../../.venv/bin/pip install -r requirements.txt
../../.venv/bin/uvicorn app.main:app --reload --port 8000
curl localhost:8000/health                    # {"gladia": true, "hcompany": true}

# C. (pour H uniquement) un tunnel public vers comptarex
cloudflared tunnel --url http://127.0.0.1:8042
```

> macOS : si `uv run comptarex-web` répond `No module named 'comptarex'`, lancer
> `chflags nohidden comptarex/.venv/lib/python*/site-packages/_editable_impl_comptarex.pth`.

## 2. Capturer une saisie de facture

1. `chrome://extensions` → Mode développeur → **Charger l'extension non empaquetée** → dossier `capture/extension/`.
2. Popup **Twiin** → **● Nouvel enregistrement** → *Choisir l'écran et démarrer* → **Écran entier** + micro.
3. Dans comptarex : connexion → dossier **00417 ATELIER DORN SAS** → *Factures à traiter* → INV-001 → *Saisir* →
   remplir fournisseur, référence, date, lignes → **Enregistrer le brouillon** (jamais *Valider*). En parlant.
4. **■ Arrêter et envoyer** → lien *Ouvrir la timeline* (`/viewer/<id>`).
5. Dans le viewer : vérifier l'**Audit des outils**, relire/corriger le **skill.md** puis *Enregistrer mes corrections*.

Sans Chrome ni micro (test du pipeline) : `.venv/bin/python capture/scripts/simulate_capture.py`.

## 3. Sorties (`capture/backend/data/recordings/<id>/`)

| Fichier | Contenu |
|---|---|
| `session.json` | `twiin/session@1` : goal, apps, start_url, transcript, `steps[]` (`t/action/url/app/target/value/result_url/screenshot/narration`), résumé de l'audit |
| `skill.md` | procédure pour l'agent H (avec les règles de sécurité Twiin). Version générée gardée dans `skill.generated.md` |
| `audit.json` | `[{app, type: connu|inconnu, api: oui|non, connector, screenshots: [...]}]` (+ name, category, twin_strategy, steps, login_seen) |
| `audit/<hôte>/*.jpg` | captures des apps **inconnues**, conservées pour reconstruire leur interface dans le jumeau |
| `video.webm`, `audio.webm`, `screenshots/`, `events.json`, `transcript.json` | matière brute |

Le registre des outils connus est un simple JSON : [backend/app/known_tools.json](backend/app/known_tools.json) (Google Workspace, Microsoft 365, Odoo, Sage, Pennylane, QuickBooks, Xero, Cegid, SAP, NetSuite, Qonto, Stripe, Shopify, Salesforce, HubSpot, Notion, Slack). Ajouter un outil = ajouter une entrée.

**Audit du poste** (macOS) : `.venv/bin/python capture/scripts/audit_poste.py --print` liste les outils installés (applications, outils en ligne de commande, extensions VS Code/Cursor/Chrome) avec le même registre et le même format, dans `capture/backend/data/audit_poste/<date>/audit_poste.{json,md}`. Il ne lit que des métadonnées (nom, version, bundle id, catégorie déclarée), jamais les fichiers ni l'historique. Les apps de catégorie perso (jeux, divertissement…) et les apps système d'Apple sont exclues. Les outils web ne sont pas devinés : c'est l'audit d'une capture qui les trouve.

**Audit du poste par Holo (computer use)** : `.venv/bin/python capture/scripts/audit_poste_holo.py`. Le script ouvre une fenêtre Finder sur Applications. Holo regarde chaque capture de cette fenêtre, lit les noms d'apps et choisit l'action suivante : page suivante, ouvrir un sous-dossier, revenir, terminer. Ce que Holo a lu est ensuite **contrôlé contre les noms réels** sur le disque : il invente des noms quand l'écran est vide ou illisible. Résultat dans `capture/backend/data/audit_poste_holo/<date>/` (audit.json, audit.md, pages/).

Pour le lancer :
- donner à VS Code ou au Terminal l'autorisation « Enregistrement de l'écran » ;
- n'avoir aucune fenêtre Finder en plein écran, sinon le Finder ouvre un onglet au lieu d'une fenêtre.

**Règle de confiance** : l'audit d'une capture lit seulement les noms d'hôtes des pages vues pendant la capture que l'employé a lui-même lancée, et réutilise ses captures. Rien d'autre (ni fichiers, ni activité hors capture).

## 4. Rejouer avec un agent H et vérifier

1. Tunnel lancé (étape 1.C) → dans `capture/backend/.env` :
   `TWIIN_URL_REWRITE=http://127.0.0.1:8042=https://<xxx>.trycloudflare.com`, puis redémarrer le backend.
2. Connexion de l'agent à comptarex, **sans identifiant dans le prompt** :
   - **profil navigateur** (`HAI_USE_DEFAULT_PROFILE=true`, défaut) : au 1er run, ouvrir l'Agent View et se connecter soi-même ; les cookies sont gardés ;
   - ou **vault** (`HAI_VAULT_ID`) : item avec `urls` = domaine du tunnel, `username`, `password` (comptarex n'a pas de 2FA).
3. Viewer → **＋ Créer l'agent dans H** puis **▶ Lancer maintenant** (instructions ex. : « Saisis la facture INV-002 en brouillon »).
4. Vérifier, puis remettre à zéro entre deux essais :
   ```bash
   .venv/bin/python capture/scripts/verify_comptarex.py --invoice INV-002   # compare GET /api/invoices à la vérité terrain
   .venv/bin/python capture/scripts/verify_comptarex.py --reset             # POST /api/admin/reset
   ```
   Critère : facture présente, fournisseur/date/totaux justes (TTC *correct*, pas le TTC imprimé), statut **brouillon**.

## 5. Sécurité

- Secrets uniquement dans `.env` (ignorés par git) ; `.env.example` fournis sans valeur.
- Données **fictives** uniquement (factures comptarex).
- L'agent s'arrête au **brouillon** : règle écrite dans `skill.md`, dans les instructions de l'agent H et rappelée à chaque run.
- Mots de passe / OTP / CB masqués dans le navigateur au moment de la capture.
- `TWIIN_API_KEY` (header `X-Twiin-Key`) protège les routes d'écriture si le backend est exposé.

## API ajoutée par Twiin

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/recordings/{id}/audit.json` | inventaire des plateformes |
| PUT | `/recordings/{id}/skill.md` | `{"body": "..."}` enregistre la version corrigée ; `{"body": null}` revient à la version générée |

Les autres routes (upload, viewer, export et envoi vers H) sont celles de Show Me Once, voir `backend/app/main.py`.
