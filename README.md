# Twiin — Hackathon Build The Future, Team 10

**Twiin observe une tâche que l'employé fait une fois sur son ordinateur, la comprend, puis lui propose soit de l'accélérer
(conseils + tuto vidéo), soit de l'automatiser (n8n + agent Holo pour les logiciels sans API).**

```
 OBSERVER ─────────► ANALYSER ─────────────────► AGIR
 (enregistrement      (étapes fidèles, conseils,    🎬 tuto vidéo (Remotion + voix ElevenLabs)
  multi-écrans,        verdict accélérer /           ⚡ automatisation n8n (+ Holo pour les outils sans API)
  OCR, journal)        automatiser)                  🙋 « Fais-le à ma place » (à venir)
```

## Les briques (dossier par dossier)

| Dossier | Rôle | État |
|---|---|---|
| [`twiin/`](twiin/) | **Le cœur actuel de Twiin** : page d'enregistrement multi-écrans (OCR local + journal d'actions), analyse fidèle, 💡 conseils, 🧭 verdict, ⚙️ préparation et ▶ rejeu par Holo sur le Mac, ⚡ automatisation n8n, 🎬 tuto vidéo. Basé sur le dépôt [ImproveMe](https://github.com/zach2940/improveme) de zach2940, très modifié | ✅ actif |
| [`capture/`](capture/) | **Observer v1** (Chrome seulement) : extension + serveur, `session.json`/`skill.md`, **audit des outils** (`audit.json`) et son registre `known_tools.json` (utilisé aussi par le verdict), audit du poste, vérification comptarex. Repris de Show Me Once | 🟡 première version, en partie remplacée par `improveme/` |
| [`live/`](live/) | **Twiin Live** : Holo 3.1 (gratuit, API Modèles) saisit une facture dans comptarex sous tes yeux, avec page de suivi et vérification | 🟡 fonctionne, pas encore relié à la page Twiin |
| [`comptarex/`](comptarex/) | **Faux logiciel de comptabilité** (sans API pour saisir) : terrain de démo, données fictives, vérité terrain. Repris de Show Me Once | ✅ démo « facture » |
| [`docs/`](docs/) | Brief de la brique Observer | — |
| [`archives/`](archives/) | Premier test de Holo (16/11), plus utilisé | 📦 archivé |

## Lancer Twiin (ports)

| Service | Commande (depuis la racine) | Adresse |
|---|---|---|
| **Page Twiin** (enregistrer, analyser, rejouer, automatiser) | `cd twiin/recorder && PORT=3000 node server.js` | http://localhost:3000 |
| comptarex (démo facture) | `cd comptarex && uv run comptarex-web` | http://127.0.0.1:8042 |
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

**Autorisations macOS** pour VS Code (ou le Terminal) : Enregistrement de l'écran, Accessibilité, Surveillance de l'entrée.

## Secrets et données personnelles

- **Secrets** : uniquement dans les fichiers `.env` (racine, `capture/backend/`, `comptarex/`, `twiin/`), **jamais publiés**.
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

Show Me Once (Jean-Christophe Dorn et équipe) pour `capture/` et `comptarex/` ; ImproveMe (zach2940) pour la base de
`twiin/` ; H Company (Holo), Hugging Face, ElevenLabs, n8n, Remotion.
