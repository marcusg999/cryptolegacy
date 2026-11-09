-- ---------------------------------------------------------------------------
-- Schemas and shared helpers.
--
-- Spec §5.5 asks for separate schemas for vault data, custody/attestation data,
-- and the legal content library. `account` is a fourth, for passkey and
-- step-up-auth state that belongs to the identity layer rather than the vault.
--
-- The separation is not cosmetic: it lets grants be made per schema, so a future
-- read-only attorney role (spec §8) or an analytics role can be given the legal
-- library and nothing else, and it keeps `anon`/`authenticated` default
-- privileges from leaking across domains.
-- ---------------------------------------------------------------------------

create schema if not exists account;
create schema if not exists vault;
create schema if not exists custody;
create schema if not exists legal;

comment on schema account is 'Identity-layer state: passkeys, step-up auth. Never key material.';
comment on schema vault is 'Encrypted vault contents and audit log. Ciphertext only.';
comment on schema custody is 'Custody plan metadata and verification cycle. Identities stay encrypted in the vault.';
comment on schema legal is 'Attorney-reviewed, versioned, citation-bearing legal content. Read-only to users.';

-- Default deny everywhere. Nothing is readable until a policy says so, and no
-- role gets table privileges it was not explicitly granted.
revoke all on schema account, vault, custody, legal from public;
grant usage on schema account, vault, custody, legal to authenticated;
grant usage on schema legal to anon;

alter default privileges in schema account revoke all on tables from public;
alter default privileges in schema vault revoke all on tables from public;
alter default privileges in schema custody revoke all on tables from public;
alter default privileges in schema legal revoke all on tables from public;

-- NOTE: the vault-ownership helper used by every child table's RLS policy lives
-- in the vault migration, not here. PostgreSQL validates a SQL function body at
-- creation time (`check_function_bodies`), so a function selecting from
-- vault.vaults cannot be created before that table exists. Keeping the helper
-- next to the table it reads is also the honest place for it.

-- `updated_at` maintenance, so the column cannot drift from reality.
create or replace function vault.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Append-only enforcement.
--
-- RLS is not enough for the audit log. RLS is bypassed by the table owner and by
-- the service role, which is exactly the actor an audit log has to be able to
-- resist (spec §5: "one of our engineers is malicious"). A trigger runs for
-- everyone, so it is the real control. Dropping the trigger is itself a
-- privileged DDL action that leaves a trace in the database logs.
-- ---------------------------------------------------------------------------
create or replace function vault.forbid_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception
    'Table %.% is append-only; % is not permitted.',
    tg_table_schema, tg_table_name, tg_op
    using errcode = 'restrict_violation';
end;
$$;

comment on function vault.forbid_mutation() is
  'Raises on UPDATE/DELETE. Applies to every role including service_role, unlike RLS.';
