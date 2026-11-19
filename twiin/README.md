# Twiin — brique principale (dossier `twiin/`)

C'est ici que vit l'interface Twiin (http://localhost:3000) et tout ce qu'elle déclenche.
Base d'origine : [ImproveMe](https://github.com/zach2940/improveme) de zach2940 (enregistreur + rejeu Holo), dont seuls
l'enregistreur, la connexion à Holo et le stockage des workflows ont été gardés, puis très étendus pour Twiin.

## Ce que fait la page Twiin

| Étape | Bouton / action | Fichiers |
|---|---|---|
| **Observer** | Start recording, « + Ajouter un écran » (multi-écrans), Stop | `recorder/public/app.js`, `recorder/server.js` |
| | OCR local des captures (rien ne sort du Mac) | `recorder/ocr.py` |
| | Journal d'actions : clics, saisies (jamais les touches), raccourcis, Entrée/Tab, changements d'app | `recorder/actions.py` |
| | 🎤 **Capture vocale** (interrupteur, désactivé par défaut) : la voix est enregistrée par le navigateur, puis transcrite à la fin, avec des horodatages calés sur les captures, **sur le poste** par Whisper (`faster-whisper`, modèle `small`) ; voir « Voix : transcription 100 % locale » ci-dessous ; les passages sont ajoutés au journal envoyé au modèle (`🎤 the user says: « … »`). L'audio reste dans le dossier de session (non publié) | `recorder/transcribe.py`, `recorder/voice.js`, `/api/audio` |
| **Analyser** | Copie fidèle de la tâche (modèle Qwen via Hugging Face) | `recorder/server.js` (`/api/generate-workflows`) |
| | 💡 Améliorer mon process : bilan chiffré + conseils pour l'employé | `/api/process-advice` |
| | 🧭 Accélérer ou automatiser ? : verdict + outils avec / sans API (registre `../capture/backend/app/known_tools.json`) | `/api/verdict` |
| **Agir** | ⚙️ Préparer pour Holo puis ▶ Rejouer sur mon Mac (une session Holo par étape, multi-écrans, garde-fous) | `scripts/run_live.py`, `twiin/clients/holo/` |
| | ⚡ Créer l'automatisation n8n : plan → compilation → import dans n8n → test une fois (inactive) | `automation/n8n_twiin.py`, `/api/n8n/create` |
| | 🎬 Tuto vidéo (lancé à la main pour l'instant) : captures du rejeu + voix ElevenLabs + Remotion | `tuto/build_tuto.py`, `tuto/video/` |

## Voix : transcription 100 % locale

La voix est transcrite **sur le poste de l'employé** par Whisper (`faster-whisper`, modèle `small`) : **l'audio ne quitte jamais le poste**, seul le texte est envoyé au modèle d'analyse. Il n'y a pas de moteur cloud.

**Installation automatique** : au lancement du serveur, si `faster-whisper` ou le modèle (~460 Mo, téléchargé depuis Hugging Face, aucune donnée envoyée) manquent, ils s'installent seuls en arrière-plan, dans `.venv` (ou, s'il n'y en a pas, dans `workflows/voice-venv`, créé pour l'occasion). Il faut Python 3.10+ et du réseau, une seule fois. Pendant l'installation, la page grise « Capture vocale » et affiche l'avancement ; s'il y a un échec (pas de réseau…), elle explique pourquoi et propose « Réessayer l'installation » (un seul essai automatique par lancement). `VOICE_AUTO_INSTALL=0` dans `.env` coupe l'installation automatique. Les routes d'installation n'acceptent que ta propre page sur l'ordinateur du serveur (pas une autre page web), et ne doivent pas être exposées par un tunnel (ngrok, cloudflared).

Alternative en ligne de commande : `.venv/bin/pip install -e .` (le modèle se télécharge alors au premier usage).

## Arborescence

```
recorder/          page Twiin (public/) + serveur Express (server.js) + OCR (ocr.py) + journal d'actions (actions.py)
twiin/             package Python : connexion à Holo (holo_agent.py), garde-fous (guards.py), multi-écrans (multiscreen.py),
                   stockage des workflows (workflows.py)
scripts/run_live.py   rejeu d'un workflow par Holo, avec progression (lue par la page)
automation/        n8n : générateur (n8n_twiin.py), plans (plans/), n8n 2.48 isolé (n8n-runtime/), espace n8ncli (n8n-cli/),
                   retour d'expérience sur n8ncli
tuto/              tutos vidéo : construction des données (build_tuto.py) + projet Remotion (video/)
workflows/         skills.json (workflows approuvés) ; sessions/, runs/, last_run*.json = données locales, non publiées
```

## Installation

```bash
python3 -m venv .venv && .venv/bin/pip install -e .     # package Python
cd recorder && npm install && cd ..                     # page Twiin
cd tuto/video && npm install && cd ../..                # Remotion (tutos)
cp .env.example .env                                    # puis remplir les clés (voir les commentaires)
```

Le modèle Whisper `small` (~460 Mo) s'installe automatiquement au lancement du serveur (voir ci-dessous) : lance une fois `recorder/transcribe.py` sur un audio, ou fais un premier enregistrement vocal court, avant une démo. `av` est limité à `<16` (au-delà, faster-whisper ne lit plus l'audio). Tests : `.venv/bin/python -m unittest recorder/test_voice.py -v` (macOS : utilise `say` et ffmpeg).

n8n 2.48 (exige Node 24) : voir `automation/n8n-runtime/start.sh` (Node 24 isolé copié dans `automation/n8n-runtime/bin/`).

## Lancer

```bash
(cd recorder && PORT=3000 node server.js)          # page Twiin : http://localhost:3000
automation/n8n-runtime/start.sh                    # n8n : http://localhost:5678 (pour les automatisations)
```

Autorisations macOS pour VS Code ou le Terminal : Enregistrement de l'écran, Accessibilité, Surveillance de l'entrée.
