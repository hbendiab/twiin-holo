# Extension Chrome Twiin

Twiin sur toutes les pages : enregistrer une tâche, créer, lancer et programmer ses automatisations, tout arrêter.
Elle ne parle qu'au serveur Twiin de ton Mac (`http://localhost:3000`) : rien ne part ailleurs.

## Installer (2 min)
1. Lance Twiin (`cd twiin/recorder && node server.js`, ou ⌥⌘T).
2. Chrome → `chrome://extensions` → active **Mode développeur** (en haut à droite).
3. **Charger l'extension non empaquetée** → choisis le dossier `twiin/extension`.
4. Épingle l'icône Twiin (pièce de puzzle → punaise).

## Ce qu'elle fait : tout dans le panneau latéral
Clic sur l'icône Twiin (ou ⌥⇧T) : le **panneau Twiin** s'ouvre à droite et reste ouvert quand on change d'onglet.
1. **Enregistrer une tâche** : sélecteur d'écran de Chrome, puis capture dans le panneau (chrono, images gardées,
   *+ Ajouter un écran*, *Terminer et analyser*, *Annuler*). On travaille où on veut, on revient au panneau pour finir.
2. **Analyse** : étapes cochées en direct (envoi, lecture du texte sur le Mac, analyse, mise en forme).
3. **Tâche trouvée** : nom, résumé, étapes ; **Créer l'automatisation** (plan, blocs testés un à un, puis *Lancer* /
   *Programmer*) et **Créer la vidéo de formation** (avancement, puis la vidéo lisible et téléchargeable dans le panneau).
4. **Automatisations** : lancer, programmer à un créneau, fréquence, résultat ; celles du site ouvert en tête.
   **Vidéos de formation** : les dernières.

Aussi : la **bulle** sur chaque page (ce qui tourne + Arrêter, rappel 15 min avant un lancement, raccourcis), le **badge**
de l'icône (`REC`, `●`, heure du prochain lancement), le **clic droit** *Enregistrer une tâche avec Twiin*, les raccourcis
⌥⇧R (enregistrer / terminer) et ⌥⇧X (tout arrêter), modifiables dans `chrome://extensions/shortcuts`.

**Ne ferme pas le panneau pendant un enregistrement** : c'est lui qui capture (Chrome ne donne l'écran choisi qu'à la page
qui l'a demandé). S'il est fermé, l'enregistrement est perdu et une notification le dit.

## Vie privée
L'adresse des pages n'est jamais envoyée : seul le nom du site sert, dans le navigateur, à trier les automatisations.
Le jeton de connexion (comptes activés) est lu dans l'onglet Twiin et gardé en mémoire de session seulement.
Les images ne partent que vers le serveur Twiin du Mac (puis, comme depuis la page, vers l'analyse).
