# Twiin — passation (test Supreme vs StockX)

Branche : `camil-test-amelioration` (créée depuis `main` local `15202bf`, non poussée).
`origin/main` a 49aa58f de plus : à récupérer avant une éventuelle fusion.

## Lancer l'environnement

Trois processus, chacun dans sa fenêtre Terminal :

```bash
# n8n (Node 24 requis)
cd ~/test/twiin-holo/twiin/automation/n8n-runtime && ./start.sh

# Serveur Twiin : à lancer DEPUIS recorder/ (express.static('public') est relatif au dossier de lancement)
cd ~/test/twiin-holo/twiin/recorder && PORT=3100 node server.js
```

Contrôle : `curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3100/` et `…:5678/` doivent répondre 200.
Lunchly (port 3000) est un autre projet : ne pas y toucher.

## Ce qui est en place

- **Enregistreur** (`recorder/actions.py`) : journal des clics, saisies, raccourcis et apps. Depuis le commit `ef8a01e`, il ajoute l'URL de l'onglet Chrome actif (événement `url`, et champ `url` sur chaque clic). Nécessite l'autorisation macOS « Automatisation → Google Chrome », et « Accessibilité » pour les noms d'éléments.
- **Serveur** (`recorder/server.js`) :
  - création d'un workflow à partir d'un enregistrement (`/api/n8n/create`, plan généré par Holo/HF) ;
  - lancement d'un plan existant (`/api/n8n/launch`, liste via `/api/n8n/plans`) ;
  - suivi en direct (`/api/n8n/events`).
- **Interface** (`recorder/public/`) : bouton « Lancer le workflow n8n » dans la section « Lancer une automatisation existante ».
- **Compilateur** (`automation/n8n_twiin.py`) : transforme un plan en workflow n8n, l'importe, puis l'exécute. Une écriture Sheets est bloquée si une valeur est vide (`on_problem: stop`).

## Ce qui a été vérifié

- Les routes `/api/n8n/plans` et `/api/n8n/launch` répondent correctement. Un lancement complet a tourné via la route.
- L'AppleScript qui lit l'URL Chrome renvoie bien l'URL.
- Tous les fichiers modifiés passent la vérification de syntaxe (Python et Node).

## Ce qui ne marche pas encore

1. **Prix StockX des produits roses.** La taille XL par défaut n'a pas de prix (« BID »). Il faut choisir la taille S (731 € pour le pull, 1 361 € pour le puffer). Le plan généré ne garde pas ce choix, donc Holo répond « non trouvé ». Correction prévue : refaire l'enregistrement de cette partie en choisissant S, puis regénérer le plan.
2. **Google Sheet** : aucun prix n'a été écrit lors des tests. Les formules D4:D6 du test précédent sont toujours là, à effacer à la main.
3. **Premier succès inexpliqué** : le run du 18:45 a trouvé 1 361 avec les mêmes instructions que les runs échoués. Hypothèse non vérifiée : StockX mémorise la dernière taille choisie.
4. **Trajectoires Holo** : les liens de partage renvoient « Page introuvable ». Impossible de voir à l'écran ce qu'Holo a fait.
5. **Chrome** : l'extension Claude in Chrome n'était pas connectée.

## Points à surveiller

- `automation/n8n-runtime/package-lock.json` a été régénéré par `npm install` (n8n 2.48.4). `npm install` signale 152 vulnérabilités, non traitées.
- n8n a généré une nouvelle clé de chiffrement dans `~/.n8n/config` au démarrage. Si d'anciens credentials existaient, ils ne se déchiffreront peut-être pas.
- `N8N_LOCAL_API_KEY` dans `twiin/.env` contient du texte au lieu d'une clé. Le code ne l'utilise pas.
- `workflows/skills.json` contient les skills de rejeu sauvegardés par l'application.

## Idées non implémentées

- Capture avant et après chaque clic, au lieu d'une capture périodique.
- Marqueur d'étape pendant l'enregistrement (touche ou bouton « Note »).
- Vérification du plan contre les actions enregistrées : chaque taille ou variante vue doit apparaître dans le plan.
- Message d'erreur qui indique la page et la taille lues quand une valeur est vide.
