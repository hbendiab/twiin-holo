# Twiin Live — regarder l'agent travailler en direct

Un agent **Holo** (modèle gratuit `holo3-1-35b-a3b`) saisit une facture fournisseur dans **comptarex** (le faux logiciel de compta).
Tu vois **tout** en même temps :

- une **fenêtre Chromium** s'ouvre : c'est le navigateur de l'agent, il le pilote (un point rouge montre où il clique) ;
- la **page de suivi** http://localhost:8100 affiche chaque étape au moment où elle arrive.

## Le cycle, répété à chaque étape

| | Ce qui se passe |
|---|---|
| 📸 **Capture** | le script prend une photo de l'écran du navigateur |
| 🧠 **Réflexion** | la photo + la mission + l'historique partent à Holo |
| 🎯 **Décision** | Holo répond par **une** action (cliquer, écrire, choisir dans une liste, touche, défiler, terminer) et **sa raison**. La cible rouge montre où il vise |
| ▶️ **Action** | le script exécute l'action dans la vraie fenêtre |
| ➡️ **Page** | si l'adresse change, c'est une nouvelle page |

Garde-fous Twiin, visibles dans la page en 🛑 :
- un clic sur *Valider / Payer / Envoyer / Supprimer* est **bloqué** : l'agent s'arrête au **brouillon** ;
- s'il dit « fini » alors qu'un message d'erreur est affiché, il est **renvoyé corriger** ;
- à la fin, une **vérification indépendante** (API de comptarex comparée à la vérité terrain) dit ✅ ou ❌ : on ne croit pas l'agent sur parole.

La connexion est faite par le script avec `comptarex/.env` (comme un coffre-fort) : **l'agent ne voit jamais le mot de passe**.

## Lancer

Prérequis : comptarex tourne (`cd comptarex && uv run comptarex-web`) et `HAI_API_KEY` est dans le `.env` de la racine.

```bash
.venv/bin/pip install -r live/requirements.txt && .venv/bin/python -m playwright install chromium   # une fois

.venv/bin/python live/live_agent.py --invoice INV-002 --reset     # remet comptarex à zéro puis saisit INV-002
.venv/bin/python live/live_agent.py --invoice INV-009             # le piège : TTC imprimé faux
.venv/bin/python live/live_agent.py --skill capture/backend/data/recordings/<id>/skill.md   # avec la procédure capturée
```

Compter **2 à 3 minutes** par facture : le modèle gratuit est limité à 10 requêtes/minute, donc une étape toutes les ~6 s.
C'est aussi ce qui laisse le temps de suivre.

## Rejouer un run (sans réseau, sans appel à Holo)

Chaque run est gardé dans `live/runs/<date>/` (captures, cibles, `events.json`). Pour une démo sûre :

```bash
.venv/bin/python live/live_agent.py --replay live/runs/20261117-152008            # au rythme réel
.venv/bin/python live/live_agent.py --replay live/runs/20261117-152008 --speed 3  # 3 fois plus vite
```

`live/runs/20261117-152008` = INV-003 (2 lignes, TVA 5,5 % et 20 %), saisie en brouillon et vérifiée ✅.

## Lien avec le reste de Twiin

- **Observer** ([capture/](../capture/)) : l'employé montre la tâche une fois → `skill.md`.
- **Live** (ici) : un agent rejoue la tâche, sous tes yeux, dans le jumeau.
- Les agents **H Agents API** (bouton « Lancer » du viewer Observer) tournent dans le cloud de H : on les regarde via le lien *Agent View* fourni par H.

## Expérience : n'envoyer à Holo que la zone d'intérêt (`--vision focus`)

Idée : au lieu de tout l'écran, envoyer seulement la fenêtre de travail du champ actif (+ le dernier point d'action).
Plein écran à chaque nouvelle page, après une erreur, ou si l'agent appelle `full_view`. Le cadre bleu dans la page de suivi montre la zone envoyée.

Mesures sur INV-002 (17/11/2026, `holo3-1-35b-a3b`, `live/runs/*/stats.json`) :

| Mode | Résultat | Appels | Tokens / appel | Latence Holo / appel | Durée |
|---|---|---|---|---|---|
| `full` | ✅ brouillon vérifié | 24 | 2 786 | 1,98 s | 156 s |
| `focus` (essai 1) | ❌ bloqué | 30 (max) | 2 326 (−17 %) | 1,99 s | 194 s |
| `focus` (essai 2, corrigé) | ❌ bloqué à la 2ᵉ ligne | 30 (max) | 2 498 (−10 %) | 1,88 s | 198 s |

Conclusions :
- l'image ne pèse qu'environ un tiers des tokens ; le reste est du texte (mission, historique, description des outils) ;
- la latence ne baisse pas, et la durée totale est surtout fixée par la limite gratuite (une étape toutes les 6,5 s) : le levier pour aller plus vite est de **faire moins d'étapes** ;
- en perdant le contexte, l'agent se trompe plus souvent → `full` reste le mode par défaut.
