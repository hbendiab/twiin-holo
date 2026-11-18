#!/bin/bash
# Installe le raccourci ⌥⌘T « ouvrir Twiin » : un petit programme en arrière-plan, relancé à chaque ouverture de session.
#   scripts/install_hotkey.sh            installer (ou réinstaller)
#   scripts/install_hotkey.sh --remove   désinstaller
TWIIN="$(cd "$(dirname "$0")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/com.twiin.hotkey.plist"
launchctl bootout "gui/$(id -u)/com.twiin.hotkey" 2>/dev/null
if [ "$1" = "--remove" ]; then rm -f "$PLIST"; echo "Raccourci ⌥⌘T retiré."; exit 0; fi
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.twiin.hotkey</string>
  <key>ProgramArguments</key><array><string>$TWIIN/.venv/bin/python</string><string>$TWIIN/scripts/hotkey.py</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>$TWIIN/workflows/hotkey.log</string>
  <key>StandardErrorPath</key><string>$TWIIN/workflows/hotkey.log</string>
</dict></plist>
PL
launchctl bootstrap "gui/$(id -u)" "$PLIST" && sleep 2
tail -2 "$TWIIN/workflows/hotkey.log"
echo "Installé. Si macOS le demande : Réglages Système → Confidentialité et sécurité → Accessibilité → autoriser Python."
