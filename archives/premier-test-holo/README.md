# Archives : premier test de Holo (16/11/2026)

Ces fichiers sont le tout premier essai du projet, avant Twiin. Ils ne servent plus aux briques actuelles.
Pour les relancer, depuis ce dossier : `../../.venv/bin/python holo_test.py …` (la clé `HAI_API_KEY` est lue dans le `.env` de la racine du projet).

## Test local de Holo (H Company)

Premier pas du projet **Twiin** (hackathon H Company) : appeler le modèle **Holo 3.1**
en local pour voir comment il « lit » une capture d'écran et dit **où cliquer**.

On reste sur le **modèle gratuit** `holo3-1-35b-a3b` (10 requêtes/min, sans carte bancaire).

---

## 1. Installer (une seule fois)

Dans un terminal, depuis ce dossier :

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## 2. Mettre ta clé API

1. Crée une clé sur **https://platform.hcompany.ai/settings/api-keys** (commence par `hk-...`).
2. Copie le modèle d'environnement et colle ta clé dedans :

```bash
cp .env.example .env
```

Puis ouvre `.env` et renseigne `HAI_API_KEY=hk-...`
👉 Le fichier `.env` n'est **jamais** envoyé sur GitHub (il est dans `.gitignore`).

## 3. Lancer un test

Prends une capture d'écran, puis demande à Holo où cliquer :

```bash
# active l'environnement si besoin : source .venv/bin/activate

python capture.py                       # capture tout l'écran -> screenshots/screen.png
python holo_test.py screenshots/screen.png "Clique sur le bouton Se connecter"
```

Tu obtiens :
1. **Ce que Holo voit** (description de l'écran) ;
2. **Les coordonnées du clic** `x, y` ;
3. Une **image annotée** `screenshots/screen_holo.png` avec le point de clic entouré.

### Options utiles

```bash
python capture.py select                # capture une zone à la souris
python holo_test.py image.png "..." --describe-only   # description seule
python holo_test.py image.png "..." --model holo4-27b # modèle payant (consomme des crédits)
```

---

## Fichiers

| Fichier            | Rôle                                                        |
|--------------------|-------------------------------------------------------------|
| `holo_test.py`     | Envoie image + question à Holo, affiche description + clic   |
| `capture.py`       | Prend une capture d'écran macOS dans `screenshots/`         |
| `.env.example`     | Modèle pour ta clé API (à copier en `.env`)                 |
| `requirements.txt` | Dépendances Python (`openai`, `python-dotenv`, `pillow`)    |

## Rappels

- **Coordonnées** : Holo renvoie des positions **normalisées sur 0–1000**, pas en pixels. Le script les reconvertit automatiquement vers la taille réelle de l'image (`x/1000 * largeur`, `y/1000 * hauteur`).
- **Gratuit** : `holo3-1-35b-a3b`, **10 req/min**. Si tu vois « 429 / rate limit », attends ~1 min.
- API **compatible OpenAI** : base `https://api.hcompany.ai/v1/`, auth `Bearer $HAI_API_KEY`.
- Aucune donnée ni clé n'est partagée en dehors de ta machine et de l'API H.

## Suite (plus tard, pour la démo Twiin)

- Boucle d'agent : capture → Holo → clic réel → nouvelle capture (pilotage du navigateur).
- Déploiement web (Vercel + GitHub) d'une interface Twiin.
