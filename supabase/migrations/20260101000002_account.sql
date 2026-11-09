-- ---------------------------------------------------------------------------
-- Identity layer. Spec §5.2 and §5.3.
--
-- The whole point of this schema is that it is SEPARATE from the crypto layer.
-- Nothing here can derive, unwrap, or hint at a vault key. A fully compromised
-- Google account gets an attacker a session that can list item names and see
-- that a vault exists. It does not decrypt one byte.
--
-- No SMS anywhere in this product (spec §5.3), so there is no phone column to
-- hold a number a SIM-swap could capture.
-- ---------------------------------------------------------------------------

-- Passkeys (WebAuthn), mandatory for every account.
create table account.passkeys (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  -- Base64url credential id as the authenticator reports it.
  credential_id   text not null,
  -- COSE public key, base64. A public key: no secret here.
  public_key      text not null,
  -- Signature counter, for cloned-authenticator detection.
  sign_count      bigint not null default 0,
  transports      text[] not null default '{}',
  device_label    text,
  backed_up       boolean not null default false,
  created_at      timestamptz not null default now(),
  last_used_at    timestamptz,
  constraint passkeys_credential_id_key unique (credential_id)
);

create index passkeys_user_id_idx on account.passkeys (user_id);

comment on table account.passkeys is
  'WebAuthn credentials. Public keys only; the private key never leaves the authenticator.';

-- One row per user, tracking the security posture the app enforces.
create table account.account_security (
  user_id              uuid primary key references auth.users (id) on delete cascade,
  passkey_enrolled_at  timestamptz,
  totp_enrolled_at     timestamptz,
  -- Spec §5.3: 15 minutes idle by default for the session.
  session_timeout_seconds integer not null default 900
    constraint session_timeout_range check (session_timeout_seconds between 300 and 3600),
  -- Spec §5.3: a separate, shorter timeout for the unlocked vault.
  vault_lock_timeout_seconds integer not null default 300
    constraint vault_lock_timeout_range check (vault_lock_timeout_seconds between 60 and 1800),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint vault_lock_not_longer_than_session
    check (vault_lock_timeout_seconds <= session_timeout_seconds)
);

create trigger account_security_touch
  before update on account.account_security
  for each row execute function vault.touch_updated_at();

comment on column account.account_security.vault_lock_timeout_seconds is
  'Spec §5.3: the vault relocks before the session expires, so walking away drops the master key first.';

-- ---------------------------------------------------------------------------
-- Step-up re-authentication. Spec §5.3.
--
-- A short-lived record that a fresh passkey assertion happened, consumed once by
-- the action it authorises. Not a long-lived "trusted device" flag: the point of
-- step-up is that editing the custody plan or exporting requires a touch *now*.
-- ---------------------------------------------------------------------------
create type account.step_up_purpose as enum (
  'edit_custody_plan',
  'manage_custody_point',
  'manage_executor',
  'manage_attestor',
  'initiate_death_claim',
  'attest_death_claim',
  'export_data',
  'enrol_duress_passphrase'
);

create table account.step_up_grants (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  purpose     account.step_up_purpose not null,
  passkey_id  uuid references account.passkeys (id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  consumed_at timestamptz,
  constraint step_up_window check (expires_at > created_at)
);

create index step_up_grants_lookup_idx
  on account.step_up_grants (user_id, purpose, expires_at desc)
  where consumed_at is null;

comment on table account.step_up_grants is
  'Single-use proof of a fresh passkey assertion for one privileged action.';

-- ---------------------------------------------------------------------------
-- RLS: default deny, then the narrowest policies that work.
-- ---------------------------------------------------------------------------
alter table account.passkeys enable row level security;
alter table account.account_security enable row level security;
alter table account.step_up_grants enable row level security;

-- Passkeys: a user may see and name their own, and delete one (as long as it is
-- not their last, which is enforced by trigger below, because passkeys are
-- mandatory). Registration goes through a server route that verifies the
-- attestation, so there is no client INSERT policy.
create policy passkeys_select_own on account.passkeys
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy passkeys_update_own_label on account.passkeys
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy passkeys_delete_own on account.passkeys
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- Spec §5.3: passkeys are mandatory. Removing the last one would lock the user
-- into a weaker posture than the product promises, so it is refused.
create or replace function account.forbid_last_passkey_removal()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  remaining integer;
begin
  select count(*) into remaining
    from account.passkeys
   where user_id = old.user_id
     and id <> old.id;

  if remaining = 0 then
    raise exception
      'Refusing to remove the last passkey. Register a replacement first; passkeys are required on every account.'
      using errcode = 'restrict_violation';
  end if;
  return old;
end;
$$;

create trigger passkeys_keep_at_least_one
  before delete on account.passkeys
  for each row execute function account.forbid_last_passkey_removal();

-- Account security row: readable and updatable by its owner. Created by a server
-- route on signup, so no client INSERT policy.
create policy account_security_select_own on account.account_security
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy account_security_update_own on account.account_security
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Step-up grants: the user may read their own to see what is pending. Creation
-- and consumption happen server-side after assertion verification, so there is
-- deliberately no client INSERT or UPDATE policy — a client that could mint its
-- own grant would make step-up auth decorative.
create policy step_up_select_own on account.step_up_grants
  for select to authenticated
  using (user_id = (select auth.uid()));

grant select, update (device_label) on account.passkeys to authenticated;
grant delete on account.passkeys to authenticated;
grant select, update (session_timeout_seconds, vault_lock_timeout_seconds)
  on account.account_security to authenticated;
grant select on account.step_up_grants to authenticated;
