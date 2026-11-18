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
| | 🎤 **Capture vocale** (interrupteur, désactivé par défaut) : la voix est enregistrée par le navigateur, puis transcrite **sur le Mac** par Whisper (`faster-whisper`, modèle `small`) à la fin, avec des horodatages calés sur les captures ; les passages sont ajoutés au journal envoyé au modèle (`🎤 the user says: « … »`). L'audio reste dans le dossier de session (non publié) | `recorder/transcribe.py`, `recorder/voice.js`, `/api/audio` |
| **Analyser** | Copie fidèle de la tâche (modèle Qwen via Hugging Face) | `recorder/server.js` (`/api/generate-workflows`) |
| | 💡 Améliorer mon process : bilan chiffré + conseils pour l'employé | `/api/process-advice` |
| | 🧭 Accélérer ou automatiser ? : verdict + outils avec / sans API (registre `../capture/backend/app/known_tools.json`) | `/api/verdict` |
| **Agir** | ⚙️ Préparer pour Holo puis ▶ Rejouer sur mon Mac (une session Holo par étape, multi-écrans, garde-fous) | `scripts/run_live.py`, `twiin/clients/holo/` |
| | ⚡ Créer l'automatisation n8n : plan → compilation → import dans n8n → test une fois (inactive) | `automation/n8n_twiin.py`, `/api/n8n/create` |
| | 🎬 Tuto vidéo (lancé à la main pour l'instant) : captures du rejeu + voix ElevenLabs + Remotion | `tuto/build_tuto.py`, `tuto/video/` |

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

La transcription vocale télécharge le modèle Whisper `small` (~500 Mo) au premier usage : lance une fois `recorder/transcribe.py` sur un audio, ou fais un premier enregistrement vocal court, avant une démo. `av` est limité à `<16` (au-delà, faster-whisper ne lit plus l'audio). Tests : `.venv/bin/python -m unittest recorder/test_voice.py -v` (macOS : utilise `say` et ffmpeg).

n8n 2.48 (exige Node 24) : voir `automation/n8n-runtime/start.sh` (Node 24 isolé copié dans `automation/n8n-runtime/bin/`).

## Lancer

```bash
(cd recorder && PORT=3000 node server.js)          # page Twiin : http://localhost:3000
automation/n8n-runtime/start.sh                    # n8n : http://localhost:5678 (pour les automatisations)
```

Autorisations macOS pour VS Code ou le Terminal : Enregistrement de l'écran, Accessibilité, Surveillance de l'entrée.
