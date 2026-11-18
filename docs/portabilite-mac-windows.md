# Twiin sur Mac et sur Windows

Règle : **on garde tout le code Mac** ; sous Windows, Twiin choisit tout seul l'équivalent Windows (`sys.platform` en
Python, `process.platform` dans le serveur). État au 18/11/2026.

| Fonction | Mac (code d'origine) | Windows (équivalent) | État Windows |
|---|---|---|---|
| OCR des captures | `recorder/ocr.py` (Vision) | `recorder/ocr_win.py` (OCR intégré de Windows, winocr) | ✅ testé (cas 4 : 3 993 lignes) |
| Journal d'actions | `recorder/actions.py` (Quartz + Accessibilité) | `recorder/actions_win.py` (pynput + UI Automation) | ✅ testé (cas 4 : 97 actions) |
| Choix du script | — | `server.js` : `IS_WIN`, `OCR_SCRIPT`, `ACTIONS_SCRIPT` | ✅ |
| Python du projet | `twiin/.venv/bin/python` | `.venv\Scripts\python.exe` (cherché aussi à la racine) | ✅ |
| Encodage | UTF-8 natif | `PYTHONUTF8=1` posé par le serveur pour tous les scripts | ✅ |
| Fenêtres au premier plan (`osascript`) | AppleScript (Chrome au premier plan, masquer VS Code) | ignoré (`spawnMac`) | ✅ sans effet, sans erreur |
| Fenêtres de console | — | tout est lancé avec `windowsHide` | ✅ |
| Démarrage de n8n | `automation/n8n-runtime/start.sh` (Node 24 isolé) | `n8n start` global, sinon `npx n8n@2.48.5 start` | ✅ |
| Import d'un workflow n8n | `n8n import:workflow` | `n8n.cmd` trouvé via `shutil.which` ; clé/jeton repris de n8ncli | ✅ testé (automatisation du cas 4) |
| Audit du poste | `capture/scripts/audit_poste.py` : /Applications + Spotlight (jours d'utilisation) | même script : registre « Applications installées » + UserAssist (dernière ouverture) | ✅ testé (39 outils) — Windows ne donne que la dernière ouverture, pas le nombre de jours |
| Icônes des applis | `scripts/fetch_icons.py` (AppKit) | même script : icône extraite de l'exe par Windows (System.Drawing) | ✅ testé (28 applis + 16 sites) |
| Rejeu de Holo sur le poste, multi-écrans | `twiin/clients/holo/multiscreen.py` (Quartz) | même fichier : écrans, fenêtre active et souris via l'API Windows, capture PIL, DPI réel | ✅ écrans et capture testés ; rejeu complet à tester |
| Raccourci pour ouvrir Twiin | ⌥⌘T : `hotkey.py`, `install_hotkey.sh`, `open_twiin.sh` | Ctrl+Alt+T : `hotkey_win.py`, `install_hotkey.ps1`, `open_twiin.ps1` | 🟡 écrit, pas encore installé |
| Textes des prompts et de la page | « sur ton Mac », raccourcis ⌘ | « sur ton ordinateur », ⌘ / Ctrl | ✅ |
| Audit du poste par Holo (Finder) | `capture/scripts/audit_poste_holo.py` (Finder, screencapture) | — | ⏳ à faire (Explorateur Windows) |
| Autorisations | Enregistrement de l'écran, Accessibilité, Surveillance de l'entrée | aucune autorisation spéciale | ✅ |

Vérifier un poste : `python scripts/doctor.py` (depuis `twiin/`, avec le Python du venv).
