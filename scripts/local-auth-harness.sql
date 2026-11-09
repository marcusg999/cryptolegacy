-- ---------------------------------------------------------------------------
-- A minimal stand-in for the parts of Supabase our migrations depend on, so the
-- schema and its RLS policies can be exercised against a plain PostgreSQL 16
-- instance in CI, with no Docker and no Supabase CLI.
--
-- This file is NOT a migration and is never applied to a real database. It
-- recreates only what Supabase itself provides: the `auth` schema, an
-- `auth.users` table, `auth.uid()` reading the request JWT claims from a GUC,
-- and the three roles. If Supabase changes any of these, the pgTAP suite will
-- start disagreeing with production — which is the point of keeping the stand-in
-- this small and this explicit.
-- ---------------------------------------------------------------------------

create extension if not exists pgcrypto;
create extension if not exists pgtap;

create schema if not exists auth;
create schema if not exists tests;

create table if not exists auth.users (
  id    uuid primary key default gen_random_uuid(),
  email text unique
);

-- Supabase's auth.uid() reads the `sub` claim out of request.jwt.claims.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ),
    ''
  )::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    current_setting('request.jwt.claim.role', true),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'),
    'anon'
  );
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to authenticated, service_role;
grant anon, authenticated, service_role to postgres;

-- Test helper: become a signed-in user.
create or replace function tests.authenticate_as(p_user_id uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
    true
  );
end;
$$;

create or replace function tests.authenticate_as_anon()
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
end;
$$;

create or replace function tests.clear_authentication()
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- Create a user and return its id.
create or replace function tests.create_user(p_email text)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  insert into auth.users (email) values (p_email) returning id into v_id;
  insert into account.account_security (user_id) values (v_id);
  return v_id;
end;
$$;

-- The helpers have to remain callable after `set role authenticated`, otherwise a
-- test cannot switch back to another identity mid-file.
grant usage on schema tests to anon, authenticated, service_role;
grant execute on all functions in schema tests to anon, authenticated, service_role;
