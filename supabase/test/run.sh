#!/bin/sh
# Builds a throwaway local database, applies every migration in order (the last
# two twice: a second run must change nothing), then runs the checks as the real
# app roles. Needs a local Postgres and to be run as root:  sh supabase/test/run.sh
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
run() { su postgres -c "$*"; }
run "dropdb --if-exists shift_test" >/dev/null
run "createdb shift_test"
run "psql -q -v ON_ERROR_STOP=1 -d shift_test -f '$HERE/00_supabase_stub.sql'" >/dev/null
for f in "$HERE"/../migrations/*.sql; do
  run "psql -q -v ON_ERROR_STOP=1 -d shift_test -c 'set client_min_messages = warning' -f '$f'" >/dev/null
done
for f in "$HERE"/../migrations/0008_*.sql "$HERE"/../migrations/0009_*.sql; do
  [ -f "$f" ] && run "psql -q -v ON_ERROR_STOP=1 -d shift_test -c 'set client_min_messages = warning' -f '$f'" >/dev/null
done
for t in "$HERE"/[a-z]*.sql; do
  run "psql -q -v ON_ERROR_STOP=1 -d shift_test -f '$t'"
done
echo "all database checks passed"
