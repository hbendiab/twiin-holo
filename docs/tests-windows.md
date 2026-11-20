# Tests Windows à faire (Lucas, 18-19/11)

Avant tout : http://localhost:3000 dans Chrome, Ctrl+F5, connecté avec ton compte. Si le serveur ne répond pas :
`powershell -ExecutionPolicy Bypass -File C:\Users\fouqu\Projects\twiin-holo\twiin\scripts\open_twiin.ps1`

## 1. Audit du poste (bouton « Refaire le scan »)
1. Étape **Audit** → « Les logiciels de ton poste » → coche « Classer mes applis par utilisation » → **Refaire le scan**.
2. Attendu : ~40 outils en quelques secondes (sur ton PC : 39, dont 10 connus et 5 avec API) ; la sphère de logos se remplit.
3. Sous Windows, « utilisation » = **dernière ouverture** de l'appli (Windows ne garde pas le nombre de jours).
4. Vérifier dans **Back** → section scan : la liste complète.

## 2. Raccourci Ctrl+Alt+T (ouvre Twiin de n'importe où)
1. Dans PowerShell : `powershell -ExecutionPolicy Bypass -File C:\Users\fouqu\Projects\twiin-holo\twiin\scripts\install_hotkey.ps1`
2. Ferme l'onglet Twiin, puis appuie sur **Ctrl+Alt+T** depuis n'importe quelle appli : Chrome s'ouvre sur Twiin (et le serveur
   démarre s'il était arrêté).
3. Pour l'enlever : supprimer « Twiin (Ctrl+Alt+T) » dans le dossier Démarrage (Win+R → `shell:startup`).

## 3. Rejeu de Holo sur ton PC (il prend la souris et le clavier)
Test sans risque, sur le Bloc-notes :
1. Page **Back** → « Tester et casser · test par Holo » → choisis une tâche, puis **remplace les étapes** par :
   ```
   Press the Windows key, type Notepad, then press Enter to open Notepad.
   In Notepad, type: Test du rejeu Twiin sous Windows
   Stop there. Do not save the file and do not close Notepad.
   ```
2. **Tester avec Holo**, puis ne touche à rien. Arrêt d'urgence : bouton **Arrêter Holo** (ou double Échap).
3. Attendu : le Bloc-notes s'ouvre et le texte s'écrit ; le suivi s'affiche dans la page. Ferme ensuite le Bloc-notes sans enregistrer.
4. Si deux écrans : lance le Bloc-notes sur le 2e écran et vérifie que Holo le suit (multi-écrans).

## 4. Automatisation « Comparatif casques audio »
1. **Mes automatisations** : elle doit apparaître (inactive). Ouvrir dans n8n : http://localhost:5678/workflow/twiincomparatifc
2. **Lancer maintenant** : ses blocs Holo lisent Google Shopping et remplissent Excel **sur ton PC** (Holo prend la main) ;
   ouvre ton fichier Excel « Comparatif » avant.
3. Programmer : choisir une fréquence / heure (8 h, 9 h…) et vérifier qu'elle passe « active ».

## 5. Tuto vidéo
Pré-requis (une fois) :
```
cd C:\Users\fouqu\Projects\twiin-holo\twiin\tuto\video
npm install
```
Et dans ton `.env` : `ELEVENLABS_API_KEY=` (+ `ELEVENLABS_VOICE_ID=` facultatif) pour la voix off ; sans clé, la vidéo
n'a pas de voix. Puis, étape **Reco** → option « accélérer » → **Créer le tuto vidéo** → la vidéo s'affiche dans la page et
dans **Mes vidéos**.

## 6. Découverte (le parcours complet, à refaire sur un 2e cas)
Enregistre une autre tâche (ex. facture vers un tableur, ou une appli de bureau sans API) → question → Oui → page Reco →
solution. Dans **Back** → « Environnement de test et casse » : vérifier le mode choisi (n8n natif / n8n + Holo) et les essais.

Remonter ce qui coince avec l'heure : je lis les journaux du serveur.
