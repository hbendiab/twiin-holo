#!/bin/bash
# Lance le n8n de Twiin (2.48.4) avec son Node 24 isolé, sur la base n8n habituelle (~/.n8n).
# Sauvegarde d'avant la mise à jour : ~/.n8n-sauvegarde-avant-maj-2026-11-18
DIR="$(cd "$(dirname "$0")" && pwd)"
export PATH="$DIR/bin:$PATH"
export N8N_SECURE_COOKIE=false
exec "$DIR/node_modules/.bin/n8n" "${@:-start}"
