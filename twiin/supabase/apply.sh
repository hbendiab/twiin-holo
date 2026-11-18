#!/bin/bash
# Crée (ou met à jour) les tables de Twiin dans le projet Supabase : applique supabase/migrations/*.sql.
# Il faut SUPABASE_DB_URL dans twiin/.env (Tableau de bord Supabase → Connect → « Session pooler »).
cd "$(dirname "$0")/.." || exit 1
DB_URL="$(grep -E '^SUPABASE_DB_URL=' .env | head -1 | cut -d= -f2-)"
if [ -z "$DB_URL" ]; then echo "SUPABASE_DB_URL manquant dans twiin/.env"; exit 1; fi
npx --yes supabase@latest db push --db-url "$DB_URL" --include-all
