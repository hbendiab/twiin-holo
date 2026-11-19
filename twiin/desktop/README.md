# Twiin pour le Mac (app de bureau)

Twiin dans une fenêtre flottante, par-dessus **toutes les applis** (Excel, Outlook, Finder…), comme Granola.

## Lancer
```bash
cd twiin/desktop
npm install          # une fois (télécharge Electron)
npm start
```
L'app démarre aussi le serveur Twiin s'il ne tourne pas (et l'arrête en quittant).

## Utiliser
- **Icône dans la barre des menus** (deux cercles, en haut à droite) : clic = afficher / masquer ; clic droit = menu
  (Enregistrer une tâche, Tout arrêter, Ouvrir dans le navigateur, Quitter).
- **⌥⌘T** depuis n'importe quelle appli : afficher / masquer la fenêtre.
- **Enregistrer une tâche** : l'écran entier est enregistré, sans sélecteur ; la fenêtre devient une **pastille** en haut
  de l'écran (chrono + Terminer) et la barre des menus affiche `● 01:23`. La tâche peut se passer dans n'importe quelle appli.
- Au Terminer : l'analyse s'affiche, puis la tâche trouvée avec **Créer l'automatisation** et **Créer la vidéo de formation**.
- **La fenêtre Twiin n'apparaît jamais dans les images enregistrées** (protection de contenu macOS).

## Autorisation macOS
Au premier enregistrement, macOS demande d'autoriser **Electron** dans *Réglages Système → Confidentialité et sécurité →
Enregistrement de l'écran et audio système*. Coche-le, puis quitte et relance l'app.

## Comment c'est fait
`main.js` (fenêtre, barre des menus, raccourci, capture), `preload.js` (pont), `loading.html`. Le contenu de la fenêtre
est le panneau de l'extension Chrome (`extension/panel.js`, `capture.js`), servi par le serveur à `/ext/desktop.html`,
avec `extension/desktop-shim.js` qui remplace les fonctions propres à Chrome.

## Capture vocale (micro)
Interrupteur **Capture vocale** en bas de la fenêtre (désactivé par défaut). Pendant l'enregistrement, le micro est capté et
envoyé au serveur Twiin du Mac, qui le transcrit **localement** (Whisper) à l'analyse : la voix ne quitte pas le Mac. Code :
`extension/voice.js` (module partagé) et `desktop/voice-permissions.js` (autorisation du micro).
- Au premier usage, macOS demande l'autorisation du **micro**. En `npm start`, la demande concerne Electron / le Terminal
  (*Réglages Système → Confidentialité et sécurité → Micro*) ; relance l'app après l'avoir accordée.
- Si l'app est un jour empaquetée, ajouter `NSMicrophoneUsageDescription` aux informations de l'app (`extendInfo` d'electron-builder).
- Si la voix locale n'est pas encore installée (installation automatique au lancement du serveur), l'interrupteur est grisé avec la raison.
