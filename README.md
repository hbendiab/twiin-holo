# Twiin — Hackathon Build The Future, Team 10

**Twiin observe une tâche que l'employé fait une fois sur son ordinateur, la comprend, puis lui propose soit de l'accélérer
(conseils + tuto vidéo), soit de l'automatiser (n8n + agent Holo pour les logiciels sans API).**

```
 OBSERVER ─────────► ANALYSER ─────────────────► AGIR
 (enregistrement      (étapes fidèles, conseils,    🎬 tuto vidéo (Remotion + voix ElevenLabs)
  multi-écrans,        verdict accélérer /           ⚡ automatisation n8n (+ Holo pour les outils sans API)
  OCR, journal)        automatiser)                  🙋 « Fais-le à ma place » (à venir)
```

## Démarrage rapide (équipe) : lancer Twiin sur ton Mac

Twiin tourne **sur ton Mac**, pas en ligne : il filme ton écran, lit le texte avec l'OCR de macOS et note tes clics.
Il ne se déploie donc pas sur Railway, Vercel ou un serveur. Il faut un Mac, **Chrome** (Safari ne partage qu'un écran),
Node 20 ou plus et Python 3.10 ou plus.

```bash
git clone https://github.com/hbendiab/twiin-holo.git
cd twiin-holo/twiin

# 1. Python (OCR local, journal des clics, Holo)
python3 -m venv .venv
.venv/bin/pip install -e .

# 2. Clés : copie le modèle, puis mets TA clé Hugging Face dans HF_TOKEN (https://huggingface.co/settings/tokens)
cp .env.example .env

# 3. Logos des outils (facultatif, extraits des applications de ton Mac)
.venv/bin/python scripts/fetch_icons.py

# 4. La page Twiin
cd recorder
npm install
PORT=3000 node server.js
```

Puis ouvre **http://localhost:3000** dans Chrome. Pour voir le parcours sans rien enregistrer : http://localhost:3000/#exemple.
Les 3 étapes du parcours employé ont chacune leur page : `/#audit`, `/#enregistrer`, `/#reco` ; et trois pages à part :
**Mes vidéos** (`/videos.html`), **Mes automatisations** (`/automatisations.html`) et **Back** (`/back.html`, réservé à
l'équipe : coûts, modèles, journaux, scans complets, et l'outil « Tester et casser » par Holo, en préparation par Lucas).

Composants React (sphère de logos de l'audit) : projet Vite + React + Tailwind à la structure shadcn dans
`twiin/recorder/ui/`, compilé dans `twiin/recorder/public/ui/`. Pour les modifier : `cd twiin/recorder/ui && npm install && npm run build`.

**Raccourci ⌥⌘T** (facultatif) : `scripts/install_hotkey.sh` (depuis `twiin/`). Ensuite, ⌥⌘T depuis n'importe quelle appli
démarre le serveur s'il est arrêté et ouvre Twiin dans Chrome. macOS demande d'autoriser *Python* dans *Accessibilité*.
Pour le retirer : `scripts/install_hotkey.sh --remove`.

**Autorisations macOS** (Réglages Système → Confidentialité et sécurité) : *Enregistrement de l'écran* pour Chrome ;
*Accessibilité* et *Surveillance de l'entrée* pour le Terminal (ou VS Code) qui lance le serveur, sinon le journal des
clics reste vide. Relance le serveur après les avoir accordées.

Seul `HF_TOKEN` est obligatoire. `HAI_API_KEY` (Holo, ton propre compte H) sert à l'outil « Tester et casser » du Back
(test par Holo) ; `ELEVENLABS_API_KEY` sert aux tutos vidéo ; n8n n'est utile que pour « Créer l'automatisation ».

## Les briques (dossier par dossier)

| Dossier | Rôle | État |
|---|---|---|
| [`twiin/`](twiin/) | **Le cœur actuel de Twiin** : page d'enregistrement multi-écrans (OCR local + journal d'actions), analyse fidèle, 💡 conseils, 🧭 verdict, ⚙️ préparation et ▶ rejeu par Holo sur le Mac, ⚡ automatisation n8n, 🎬 tuto vidéo. Basé sur le dépôt [ImproveMe](https://github.com/zach2940/improveme) de zach2940, très modifié | ✅ actif |
| [`capture/`](capture/) | **Observer v1** (Chrome seulement) : extension + serveur, `session.json`/`skill.md`, **audit des outils** (`audit.json`) et son registre `known_tools.json` (utilisé aussi par le verdict), audit du poste, vérification comptarex. Repris de Show Me Once | 🟡 première version, en partie remplacée par `improveme/` |
| [`live/`](live/) | **Twiin Live** : Holo 3.1 (gratuit, API Modèles) saisit une facture dans comptarex sous tes yeux, avec page de suivi et vérification | 🟡 a besoin de comptarex (hors dépôt) |
| `comptarex/` | **Faux logiciel de comptabilité** (sans API pour saisir) : terrain de la démo « facture ». Repris de [Show Me Once](https://github.com/Jean-Christophe972/show-me-once-hackathon-h). **Pas dans ce dépôt** (retiré le 18/11) : il reste sur le Mac de démo, Twiin n'en a pas besoin | 📦 hors dépôt |
| [`docs/`](docs/) | Brief de la brique Observer | — |
| [`archives/`](archives/) | Premier test de Holo (16/11), plus utilisé | 📦 archivé |

## Lancer Twiin (ports)

| Service | Commande (depuis la racine) | Adresse |
|---|---|---|
| **Page Twiin** (enregistrer, analyser, rejouer, automatiser) | `cd twiin/recorder && PORT=3000 node server.js` | http://localhost:3000 |
| comptarex (démo facture, Mac de démo seulement) | `cd comptarex && uv run comptarex-web` | http://127.0.0.1:8042 |
| n8n 2.48 (automatisations) | `twiin/automation/n8n-runtime/start.sh` | http://localhost:5678 |
| Studio Remotion (aperçu des tutos) | `cd twiin/tuto/video && npx remotion studio --port 3010` | http://localhost:3010 |
| Observer v1 (Chrome) | `cd capture/backend && ../../.venv/bin/uvicorn app.main:app --port 8000` | http://localhost:8000 |
| Twiin Live | `.venv/bin/python live/live_agent.py --invoice INV-002 --reset` | http://localhost:8100 |

Commandes utiles de la brique principale (`twiin/`) :

```bash
cd twiin
.venv/bin/python scripts/run_live.py <workflow-id>            # rejeu par Holo sur le Mac (une session par étape)
.venv/bin/python automation/n8n_twiin.py automation/plans/veille-loreal.json   # créer + importer + tester une automatisation n8n
.venv/bin/python tuto/build_tuto.py workflows/runs/<rejeu>-local.json --name <nom>   # données d'un tuto vidéo
```

**Où travaille Holo dans une automatisation n8n.** Chaque bloc Holo a un réglage `env` :
- `cloud` : navigateur hébergé chez H. L'employé continue à utiliser son Mac pendant que l'automatisation tourne. Pour les
  sites web publics (LinkedIn, portails…). Un site qui demande une connexion passe par le coffre d'identifiants de H
  (`HAI_VAULT_ID`), jamais par un mot de passe dans les étapes.
- `mac` : ce Mac, avec la vraie souris. Obligatoire pour un logiciel installé (OneNote, Excel bureau…) ou un site local
  (`127.0.0.1`, comptarex), que le cloud ne peut pas atteindre.
- Sans réglage, le serveur Twiin choisit tout seul (`holoEnv()` dans `recorder/server.js`).

**Autorisations macOS** pour VS Code (ou le Terminal) : Enregistrement de l'écran, Accessibilité, Surveillance de l'entrée.

## Secrets et données personnelles

- **Secrets** : uniquement dans les fichiers `.env` (racine, `capture/backend/`, `twiin/`), **jamais publiés**.
  Chaque dossier a un `.env.example` qui liste les variables sans valeur.
- **Données personnelles** (captures de l'écran, journaux d'actions, enregistrements, voix, rejeux) : restent sur le Mac,
  exclues de git — `twiin/workflows/sessions|runs/`, `twiin/tuto/video/public/tutos/`, `live/runs/`, `capture/backend/data/`.
- **Automatisations n8n générées** (`twiin/automation/workflows/`) : exclues, elles contiennent le jeton du pont n8n → Holo.
- Points RGPD à traiter avant un usage en entreprise : voir la discussion du 17/11 (envoi d'images à Hugging Face, liens de
  partage des sessions H, durée de conservation, information des salariés).

## Ce qui reste à faire

- 🙋 « Fais-le à ma place » (valeurs variables → nouvelle exécution par Holo).
- Bouton 🎬 « Créer le tuto vidéo » branché de bout en bout (aujourd'hui lancé à la main).
- Automatisation n8n du cas « facture comptarex ».
- Nettoyage niveau B (doublons, données) ; regrouper dans `twiin/` ce qui reste utile de `capture/` et `live/`.

## Crédits

Show Me Once (Jean-Christophe Dorn et équipe) pour `capture/` et comptarex (hors dépôt) ; ImproveMe (zach2940) pour la base de
`twiin/` ; H Company (Holo), Hugging Face, ElevenLabs, n8n, Remotion.
