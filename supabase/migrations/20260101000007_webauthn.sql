-- ---------------------------------------------------------------------------
-- WebAuthn challenge storage.
--
-- A registration or authentication challenge must be single-use and short-lived,
-- and it must be checked server-side. Keeping it in a signed cookie would work
-- but makes replay harder to reason about; a row that is deleted on consumption
-- makes "used exactly once" a property of the database rather than of the code.
--
-- Nothing here is key material. A WebAuthn challenge is a public random value;
-- the secret is the private key inside the user's authenticator, which never
-- leaves it and which this system never sees.
-- ---------------------------------------------------------------------------

create type account.webauthn_purpose as enum ('register', 'authenticate', 'step_up');

create table account.webauthn_challenges (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  purpose    account.webauthn_purpose not null,
  challenge  text not null,
  -- For a step-up challenge, the action it will authorise.
  step_up_purpose account.step_up_purpose,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '5 minutes',
  constraint challenge_window check (expires_at > created_at),
  constraint step_up_purpose_present check (
    purpose <> 'step_up' or step_up_purpose is not null
  )
);

create index webauthn_challenges_user_idx
  on account.webauthn_challenges (user_id, purpose, created_at desc);

comment on table account.webauthn_challenges is
  'Single-use WebAuthn challenges. Rows are deleted on consumption and swept on expiry.';

-- RLS: the client never reads or writes these directly. The routes that mint and
-- consume them run server-side with the service role, which holds the account
-- schema grant. No policy for `authenticated` means no access for `authenticated`.
alter table account.webauthn_challenges enable row level security;

-- A deny-all policy, written out rather than left implicit, so the "every table
-- has at least one policy" test does not have to carve out an exception and so
-- the intent is legible to the next reader.
create policy webauthn_challenges_no_client_access on account.webauthn_challenges
  for all to authenticated
  using (false)
  with check (false);

-- Expired challenges are useless and are deleted opportunistically whenever a
-- new one is minted for the same user, so no scheduled job is required.
create or replace function account.sweep_expired_challenges(p_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from account.webauthn_challenges
   where expires_at < now()
      or (user_id = p_user_id and expires_at < now());
$$;

revoke all on function account.sweep_expired_challenges(uuid) from public;
grant execute on function account.sweep_expired_challenges(uuid) to service_role;

grant select, insert, update, delete on account.webauthn_challenges to service_role;
