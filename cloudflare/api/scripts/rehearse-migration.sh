#!/usr/bin/env bash
# Rehearsal of the data move PostgreSQL -> D1, entirely local (CI):
#  1. a throwaway PostgreSQL gets the backend migrations and sample rows,
#  2. every table is exported as JSON with psql,
#  3. scripts/pg-to-d1.mjs turns the rows into SQL for D1,
#  4. a local D1 gets the full schema (build/full/init.sql), the rows, and
#     then the wallet guards of the probe,
#  5. scripts/verify-import.mjs checks counts and values.
# Needs PGHOST/PGUSER/PGPASSWORD/PGDATABASE and build/full/init.sql
# (npm run schema:full). Nothing here talks to Cloudflare or production.
set -euo pipefail
cd "$(dirname "$0")/.."

out=build/rehearsal
rm -rf "$out" && mkdir -p "$out/export"

for f in ../../backend/prisma/migrations/*/migration.sql; do
  psql -v ON_ERROR_STOP=1 -q -f "$f"
done
psql -v ON_ERROR_STOP=1 -q -f scripts/fixtures/pg-seed.sql

tables=$(node --input-type=module -e '
  import { parseSchema } from "./scripts/schema-lib.mjs";
  console.log([...parseSchema().models.keys()].join(" "));')
for t in $tables; do
  psql -v ON_ERROR_STOP=1 -At -c "SELECT coalesce(json_agg(t), '[]'::json) FROM \"$t\" t" > "$out/export/$t.json"
done

node scripts/pg-to-d1.mjs "$out/export" "$out/import.sql"

d1() { npx wrangler d1 execute viewzo-probe --local --persist-to "$out/state" "$@" > /dev/null; }
d1 --file build/full/init.sql
d1 --file "$out/import.sql"
d1 --file migrations/0002_wallet_guards.sql

node scripts/verify-import.mjs "$out"
