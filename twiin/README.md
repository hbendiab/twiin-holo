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
| | 🎤 **Capture vocale** (interrupteur, désactivé par défaut) : la voix est enregistrée par le navigateur, puis transcrite à la fin, avec des horodatages calés sur les captures, par le **moteur choisi par la DSI** : **sur le poste** (Whisper, `faster-whisper`, modèle `small`, par défaut) ou **dans le cloud** (ElevenLabs Scribe) ; voir « Voix : le choix de la DSI » ci-dessous ; les passages sont ajoutés au journal envoyé au modèle (`🎤 the user says: « … »`). L'audio reste dans le dossier de session (non publié) | `recorder/transcribe.py`, `recorder/voice.js`, `recorder/voice_engine.js`, `/api/audio` |
| **Analyser** | Copie fidèle de la tâche (modèle Qwen via Hugging Face) | `recorder/server.js` (`/api/generate-workflows`) |
| | 💡 Améliorer mon process : bilan chiffré + conseils pour l'employé | `/api/process-advice` |
| | 🧭 Accélérer ou automatiser ? : verdict + outils avec / sans API (registre `../capture/backend/app/known_tools.json`) | `/api/verdict` |
| **Agir** | ⚙️ Préparer pour Holo puis ▶ Rejouer sur mon Mac (une session Holo par étape, multi-écrans, garde-fous) | `scripts/run_live.py`, `twiin/clients/holo/` |
| | ⚡ Créer l'automatisation n8n : plan → compilation → import dans n8n → test une fois (inactive) | `automation/n8n_twiin.py`, `/api/n8n/create` |
| | 🎬 Tuto vidéo (lancé à la main pour l'instant) : captures du rejeu + voix ElevenLabs + Remotion | `tuto/build_tuto.py`, `tuto/video/` |

## Voix : le choix de la DSI

La transcription de la voix peut se faire de deux façons. **Ce choix revient à la DSI de l'entreprise qui déploie Twiin** : il dépend de sa politique de confidentialité (RGPD) et de son parc d'ordinateurs.

| | **Local** (par défaut) | **Cloud** |
|---|---|---|
| Moteur | Whisper (`faster-whisper`, modèle `small`) sur le poste de l'employé | ElevenLabs Scribe (`scribe_v2`) |
| Confidentialité | **L'audio ne quitte pas le poste** ; seul le texte est envoyé au modèle d'analyse | **L'audio est envoyé à un tiers (ElevenLabs)** pour être transcrit |
| Installation | Petite installation par poste : Python 3.10+, `faster-whisper` + `av<16`, modèle ~460 Mo (bouton « Installer la transcription locale » dans la page) | Aucune : une clé `ELEVENLABS_API_KEY` dans `.env` |
| Limites | Premier usage : téléchargement du modèle (réseau) ; transcription plus lente sur un vieux Mac | Service payant (crédits ElevenLabs), réseau nécessaire à chaque enregistrement |

**Où se règle le moteur** : par le serveur, pour tous ses utilisateurs. `VOICE_ENGINE=local|cloud` dans `.env` (défaut `local`), ou le sélecteur « Transcription : ◉ Sur ton Mac ○ Cloud » de la page (visible quand la capture vocale est active), qui l'enregistre dans `workflows/voice_settings.json` (non publié) et prend le dessus sur `.env`. En attendant les rôles (Supabase), toute personne qui ouvre la page **sur l'ordinateur du serveur** peut le changer ; les autres postes ne le peuvent pas (les requêtes d'une autre page web sont refusées aussi). Ne pas exposer le serveur par un tunnel ou un proxy local (ngrok, cloudflared) : tout le trafic y paraîtrait venir de l'ordinateur local. Quand le cloud est choisi, la page l'écrit : « ta voix est envoyée à ElevenLabs ».

Changer de moteur puis **Réanalyser** retranscrit l'enregistrement avec le nouveau moteur (le texte est gardé dans `voice.json` avec le nom du moteur).

**Installer la transcription locale** : le bouton de la page installe `faster-whisper` et `av<16` dans `.venv` (ou, s'il n'y en a pas, dans `workflows/voice-venv`, créé pour l'occasion) puis télécharge le modèle, avec l'avancement affiché ; recharger la page ne l'interrompt pas. Ligne de commande équivalente : `.venv/bin/pip install -e .` (le modèle se télécharge alors au premier usage). Sans cette installation ni clé cloud, la voix est simplement indisponible (le reste de Twiin marche).

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

Le modèle Whisper `small` (~460 Mo) du moteur local se télécharge au premier usage (ou par le bouton d'installation de la page) : lance une fois `recorder/transcribe.py` sur un audio, ou fais un premier enregistrement vocal court, avant une démo. `av` est limité à `<16` (au-delà, faster-whisper ne lit plus l'audio). Tests : `.venv/bin/python -m unittest recorder/test_voice.py -v` (macOS : utilise `say` et ffmpeg).

n8n 2.48 (exige Node 24) : voir `automation/n8n-runtime/start.sh` (Node 24 isolé copié dans `automation/n8n-runtime/bin/`).

## Lancer

```bash
(cd recorder && PORT=3000 node server.js)          # page Twiin : http://localhost:3000
automation/n8n-runtime/start.sh                    # n8n : http://localhost:5678 (pour les automatisations)
```

Autorisations macOS pour VS Code ou le Terminal : Enregistrement de l'écran, Accessibilité, Surveillance de l'entrée.
