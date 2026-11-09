#!/usr/bin/env bash
# Apply the migrations and run the pgTAP suite against a throwaway database.
#
# Prefers `supabase test db` when the Supabase CLI and Docker are available,
# since that is the environment production actually runs on. Falls back to a
# plain PostgreSQL instance plus scripts/local-auth-harness.sql, which is what
# CI uses — it needs no Docker and still exercises every policy.
set -euo pipefail

PGHOST="${PGHOST:-/tmp}"
PGPORT="${PGPORT:-5433}"
PGUSER="${PGUSER:-postgres}"
DB="${DB:-civ_test_$$}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PGHOST PGPORT PGUSER

# Use the Supabase CLI only when there is actually a Supabase project to run —
# the binary alone is not enough, and a runner that happens to have it installed
# would otherwise fail here rather than falling back.
if [ -f "$ROOT/supabase/config.toml" ] \
  && command -v supabase >/dev/null 2>&1 \
  && docker info >/dev/null 2>&1; then
  echo "==> Supabase CLI and project config detected; running 'supabase test db'"
  cd "$ROOT"
  exec supabase test db
fi

echo "==> Falling back to plain PostgreSQL at $PGHOST:$PGPORT (db: $DB)"
psql -q -U "$PGUSER" -d postgres -c "drop database if exists \"$DB\";"
psql -q -U "$PGUSER" -d postgres -c "create database \"$DB\";"
trap 'psql -q -U "$PGUSER" -d postgres -c "drop database if exists \"$DB\";" >/dev/null 2>&1 || true' EXIT

# pgcrypto/pgtap and the auth stand-in have to exist before the migrations run,
# but tests.create_user references account.account_security, which the migrations
# create. So the harness is applied in two passes, either side of the migrations.
psql -q -v ON_ERROR_STOP=1 -U "$PGUSER" -d "$DB" <<'SQL'
create extension if not exists pgcrypto;
create extension if not exists pgtap;
create schema if not exists auth;
create schema if not exists tests;
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text unique);
create or replace function auth.uid() returns uuid language sql stable as $fn$
  select nullif(coalesce(current_setting('request.jwt.claim.sub', true),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid;
$fn$;
do $do$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end $do$;
grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to authenticated, service_role;
SQL

echo "==> Applying migrations"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "    $(basename "$f")"
  psql -q -v ON_ERROR_STOP=1 -U "$PGUSER" -d "$DB" -f "$f"
done

echo "==> Installing test helpers"
psql -q -v ON_ERROR_STOP=1 -U "$PGUSER" -d "$DB" -f "$ROOT/scripts/local-auth-harness.sql"

echo "==> Running pgTAP suite"
status=0
total=0
failed=0
for f in "$ROOT"/supabase/tests/*.sql; do
  name="$(basename "$f")"
  out="$(psql -qtA -v ON_ERROR_STOP=1 -U "$PGUSER" -d "$DB" -f "$f" 2>&1)" || status=1
  file_total="$(grep -cE '^(ok|not ok) ' <<<"$out" || true)"
  file_failed="$(grep -cE '^not ok ' <<<"$out" || true)"
  total=$((total + file_total))
  failed=$((failed + file_failed))
  if [ "$file_failed" -gt 0 ] || grep -qE '^(ERROR|psql:)' <<<"$out"; then
    status=1
    printf '  %-28s %s\n' "$name" "FAIL ($file_failed/$file_total)"
    grep -E '^(not ok |# |ERROR|psql:)' <<<"$out" | sed 's/^/      /'
  else
    printf '  %-28s %s\n' "$name" "ok ($file_total assertions)"
  fi
done

echo
if [ "$status" -eq 0 ]; then
  echo "==> $total database assertions passed"
else
  echo "==> $failed of $total database assertions FAILED"
fi
exit "$status"
