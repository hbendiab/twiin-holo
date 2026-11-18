#!/bin/bash
# Ouvre Twiin : démarre le serveur s'il est arrêté, puis ramène l'onglet Twiin de Chrome (ou l'ouvre).
# Lancé par le raccourci ⌥⌘T (scripts/hotkey.py) ; utilisable aussi à la main.
TWIIN="$(cd "$(dirname "$0")/.." && pwd)"
URL="http://localhost:3000/"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

if ! curl -s -o /dev/null -m 2 "$URL"; then
  cd "$TWIIN/recorder" && PORT=3000 nohup node server.js >> "$TWIIN/workflows/server.log" 2>&1 &
  for i in $(seq 1 40); do curl -s -o /dev/null -m 1 "$URL" && break; sleep 0.5; done
fi

osascript <<OSA
tell application "Google Chrome"
  activate
  set found to false
  set nw to count of windows
  repeat with w from 1 to nw
    set nt to count of tabs of window w
    repeat with i from 1 to nt
      if (URL of tab i of window w) starts with "$URL" then
        set active tab index of window w to i
        set index of window w to 1
        set found to true
        exit repeat
      end if
    end repeat
    if found then exit repeat
  end repeat
  if not found then
    if (count of windows) = 0 then make new window
    tell window 1 to make new tab with properties {URL:"$URL"}
  end if
end tell
OSA
