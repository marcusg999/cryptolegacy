-- ---------------------------------------------------------------------------
-- Spec §5.5: "Row Level Security on every table, default deny, no exceptions."
--
-- This file proves the structural property — that no table was added without
-- RLS, and that no table is readable by an anonymous caller — rather than
-- checking a hand-maintained list. A new table with RLS forgotten fails here
-- automatically, which is the only version of this test that stays true.
-- ---------------------------------------------------------------------------
begin;
select plan(9);

-- Every table in our four schemas has RLS enabled.
select is_empty(
  $$ select n.nspname || '.' || c.relname
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('account', 'vault', 'custody', 'legal')
        and c.relkind = 'r'
        and not c.relrowsecurity $$,
  'every table in account/vault/custody/legal has row level security enabled'
);

-- Every table has at least one policy. RLS with no policies denies everything,
-- which is safe but means a table nobody can use; that is a bug worth catching.
select is_empty(
  $$ select n.nspname || '.' || c.relname
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('account', 'vault', 'custody', 'legal')
        and c.relkind = 'r'
        and not exists (select 1 from pg_policy p where p.polrelid = c.oid) $$,
  'every table has at least one RLS policy'
);

-- PUBLIC must hold no privileges on any of our tables.
select is_empty(
  $$ select table_schema || '.' || table_name || ':' || privilege_type
       from information_schema.role_table_grants
      where grantee = 'PUBLIC'
        and table_schema in ('account', 'vault', 'custody', 'legal') $$,
  'PUBLIC has no table privileges in any application schema'
);

-- anon may read the published legal library and nothing else.
select is_empty(
  $$ select table_schema || '.' || table_name || ':' || privilege_type
       from information_schema.role_table_grants
      where grantee = 'anon'
        and table_schema in ('account', 'vault', 'custody') $$,
  'anon has no privileges on account, vault or custody'
);

select isnt_empty(
  $$ select 1 from information_schema.role_table_grants
      where grantee = 'anon' and table_schema = 'legal' and privilege_type = 'SELECT' $$,
  'anon may read the legal content library'
);

-- `authenticated` must never be able to write the legal library.
select is_empty(
  $$ select privilege_type
       from information_schema.role_table_grants
      where grantee = 'authenticated'
        and table_schema = 'legal'
        and privilege_type in ('INSERT', 'UPDATE', 'DELETE') $$,
  'authenticated cannot write the legal content library'
);

-- The ownership helper must be SECURITY DEFINER with a pinned search_path.
-- A SECURITY DEFINER function with a mutable search_path is a privilege
-- escalation hole, so this is checked rather than assumed.
select is(
  (select prosecdef from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'vault' and p.proname = 'owns_vault'),
  true,
  'vault.owns_vault is SECURITY DEFINER'
);

-- Checked across every function we define, not just the one, so a future helper
-- cannot be added without the pin. An unpinned search_path on a SECURITY
-- DEFINER function lets a caller shadow `vaults` with a table of their own.
select is_empty(
  $$ select n.nspname || '.' || p.proname
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('account', 'vault', 'custody', 'legal')
        and not exists (
          select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg
           where cfg ~ '^search_path=' and cfg ~ '""|^search_path=$'
        ) $$,
  'every function in our schemas pins an empty search_path'
);

-- No policy may grant access without checking who is asking. A policy of
-- `using (true)` would pass the "has a policy" check above while exposing
-- everything, which is precisely the mistake this catches.
--
-- An outright `using (false)` deny-all is allowed, because it grants nothing at
-- all — it is stricter than an identity check, not looser.
select is_empty(
  $$ select n.nspname || '.' || c.relname || ':' || p.polname
       from pg_policy p
       join pg_class c on c.oid = p.polrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('account', 'vault', 'custody')
        and pg_get_expr(coalesce(p.polqual, p.polwithcheck), p.polrelid) !~ 'auth\.uid|owns_vault'
        and pg_get_expr(coalesce(p.polqual, p.polwithcheck), p.polrelid) !~ '^\(?false\)?$' $$,
  'no policy in account/vault/custody grants access without checking the caller identity'
);

select * from finish();
rollback;
