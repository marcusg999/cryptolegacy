-- ---------------------------------------------------------------------------
-- Vault data. Spec §5.1, §5.5.
--
-- Read the column comments as the answer to "what does an attacker holding a
-- full dump of this database get?" Ciphertext, IVs, salts, cost parameters, byte
-- counts, timestamps, and item names the user chose. No passphrase, no verifier,
-- no plaintext content, and no custodian identities (those live encrypted, in
-- the custody schema's detail blobs).
-- ---------------------------------------------------------------------------

create type vault.vault_status as enum (
  'active',
  -- Spec §6.3: the owner responded to a claim, so the vault is sealed pending review.
  'locked_by_owner_veto',
  -- Spec §6: a verified death claim has completed and executor access is granted.
  'released_to_executor'
);

create table vault.vaults (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users (id) on delete restrict,
  -- Plaintext. Spec §5.2: a locked session sees names and dates, never content.
  label         text not null
    constraint vaults_label_length check (char_length(label) between 1 and 120),
  status        vault.vault_status not null default 'active',
  -- Spec §8: multiple vaults per user, so purpose is worth recording.
  purpose       text
    constraint vaults_purpose_length check (purpose is null or char_length(purpose) <= 400),
  -- Spec §6.1: 30 days default, minimum 14, user-configurable upward only.
  waiting_period_days integer not null default 30
    constraint waiting_period_minimum check (waiting_period_days >= 14),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index vaults_owner_idx on vault.vaults (owner_id);

create trigger vaults_touch
  before update on vault.vaults
  for each row execute function vault.touch_updated_at();

comment on column vault.vaults.label is
  'PLAINTEXT and server-visible. The UI warns against putting anything sensitive here.';
comment on column vault.vaults.owner_id is
  'ON DELETE RESTRICT: deleting an auth user must never silently orphan or destroy a vault.';

-- ---------------------------------------------------------------------------
-- Ownership helper.
--
-- SECURITY DEFINER so it can read vault.vaults without recursing through that
-- table's own RLS policies. `stable` so the planner calls it once per statement
-- rather than once per row. The explicit empty search_path is not optional: a
-- SECURITY DEFINER function with a mutable search_path is a privilege-escalation
-- hole, because a caller can shadow `vaults` with their own table.
-- ---------------------------------------------------------------------------
create or replace function vault.owns_vault(p_vault_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from vault.vaults v
     where v.id = p_vault_id
       and v.owner_id = (select auth.uid())
  );
$$;

comment on function vault.owns_vault(uuid) is
  'True when the current JWT subject owns the vault. Used by every child-table RLS policy.';

revoke all on function vault.owns_vault(uuid) from public;
grant execute on function vault.owns_vault(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Key records. One primary, optionally one duress.
--
-- THERE IS NO PASSWORD RESET (spec §3.1). That is enforced here, not only in the
-- UI: there is no UPDATE policy on this table and a trigger refuses to change
-- any cryptographic column. A support engineer with database access cannot
-- re-wrap a vault under a new passphrase, because doing so requires the old
-- passphrase to unwrap the master key, and nothing in this system has it.
-- ---------------------------------------------------------------------------
create type vault.key_kind as enum ('primary', 'duress');

create table vault.vault_keys (
  id              uuid primary key default gen_random_uuid(),
  vault_id        uuid not null references vault.vaults (id) on delete cascade,
  kind            vault.key_kind not null default 'primary',
  -- Argon2id cost profile id, resolved client-side against KDF_PROFILES.
  kdf_profile_id  smallint not null
    constraint kdf_profile_known check (kdf_profile_id > 0),
  kdf_salt        bytea not null
    constraint kdf_salt_length check (octet_length(kdf_salt) = 16),
  -- Vault Master Key wrapped by Argon2id(passphrase). Offline-attackable by
  -- anyone holding this row; what defends it is 155+ bits of passphrase entropy,
  -- not secrecy of the blob. See SECURITY.md.
  wrapped_vmk_iv  bytea not null
    constraint wrapped_vmk_iv_length check (octet_length(wrapped_vmk_iv) = 12),
  wrapped_vmk     bytea not null
    constraint wrapped_vmk_length check (octet_length(wrapped_vmk) = 48),
  -- Known-plaintext blob proving a passphrase is right, client-side.
  sentinel_iv     bytea not null
    constraint sentinel_iv_length check (octet_length(sentinel_iv) = 12),
  sentinel        bytea not null
    constraint sentinel_length check (octet_length(sentinel) between 17 and 128),
  envelope_version smallint not null default 1,
  created_at      timestamptz not null default now()
);

-- Exactly one primary key record per vault.
create unique index vault_keys_one_primary_idx
  on vault.vault_keys (vault_id)
  where kind = 'primary';

-- At most one duress key record per vault.
create unique index vault_keys_one_duress_idx
  on vault.vault_keys (vault_id)
  where kind = 'duress';

create index vault_keys_vault_idx on vault.vault_keys (vault_id);

comment on table vault.vault_keys is
  'Append-only. No password reset exists or can exist: see the trigger below and spec §3.1.';
comment on column vault.vault_keys.wrapped_vmk is
  '32-byte master key + 16-byte GCM tag = 48 bytes, sealed under the passphrase-derived key.';

create or replace function vault.forbid_key_rewrap()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.kdf_salt       is distinct from old.kdf_salt
  or new.kdf_profile_id is distinct from old.kdf_profile_id
  or new.wrapped_vmk    is distinct from old.wrapped_vmk
  or new.wrapped_vmk_iv is distinct from old.wrapped_vmk_iv
  or new.sentinel       is distinct from old.sentinel
  or new.sentinel_iv    is distinct from old.sentinel_iv
  or new.kind           is distinct from old.kind
  or new.vault_id       is distinct from old.vault_id
  then
    raise exception
      'Vault key records are immutable. There is no password reset, by design (spec §3.1).'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger vault_keys_immutable
  before update on vault.vault_keys
  for each row execute function vault.forbid_key_rewrap();

-- ---------------------------------------------------------------------------
-- Vault items.
-- ---------------------------------------------------------------------------
create type vault.item_kind as enum (
  'text',
  'document',
  'video',
  'audio',
  'custody_plan',
  'asset_inventory'
);

-- Spec §6.2: staged disclosure order. Stored per item so the release flow does
-- not have to infer it from the kind.
create type vault.disclosure_stage as enum (
  'messages',              -- 1. personal messages and letters
  'inventory_education',   -- 2. what exists, what it is, how to use it
  'legal_documents',       -- 3. legal documents and probate packet
  'wallet_access'          -- 4. wallet access instructions — last
);

create table vault.items (
  id              uuid primary key default gen_random_uuid(),
  vault_id        uuid not null references vault.vaults (id) on delete cascade,
  kind            vault.item_kind not null,
  disclosure_stage vault.disclosure_stage not null default 'inventory_education',
  -- Plaintext metadata, per spec §5.2.
  name            text not null
    constraint items_name_length check (char_length(name) between 1 and 200),
  plaintext_bytes bigint not null default 0
    constraint items_bytes_nonnegative check (plaintext_bytes >= 0),
  -- Envelope: per-item DEK wrapped by the vault master key.
  wrapped_dek_iv  bytea not null
    constraint wrapped_dek_iv_length check (octet_length(wrapped_dek_iv) = 12),
  wrapped_dek     bytea not null
    constraint wrapped_dek_length check (octet_length(wrapped_dek) = 48),
  -- Inline payload for text and small documents. Large media goes to Storage
  -- instead (build-order step 5), addressed by storage_path.
  content_iv      bytea
    constraint content_iv_length check (content_iv is null or octet_length(content_iv) = 12),
  content         bytea
    constraint content_size check (content is null or octet_length(content) <= 1048576),
  storage_path    text,
  chunk_count     integer not null default 1
    constraint chunk_count_positive check (chunk_count >= 1),
  envelope_version smallint not null default 1,
  version         integer not null default 1,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  -- Exactly one storage location: inline or Storage, never both, never neither.
  constraint items_one_payload_location check (
    (content is not null and content_iv is not null and storage_path is null)
    or (content is null and content_iv is null and storage_path is not null)
  )
);

create index items_vault_idx on vault.items (vault_id) where deleted_at is null;
create index items_stage_idx on vault.items (vault_id, disclosure_stage) where deleted_at is null;

create trigger items_touch
  before update on vault.items
  for each row execute function vault.touch_updated_at();

comment on column vault.items.name is
  'PLAINTEXT. Spec §5.2 makes names visible to a locked session; the UI warns accordingly.';
comment on constraint items_one_payload_location on vault.items is
  'A row with neither payload is a silently empty item; a row with both is ambiguous on read.';

-- Spec §8: version history on everything. Wills get amended, wallets migrate.
create table vault.item_versions (
  id              uuid primary key default gen_random_uuid(),
  item_id         uuid not null references vault.items (id) on delete cascade,
  version         integer not null,
  name            text not null,
  plaintext_bytes bigint not null default 0,
  wrapped_dek_iv  bytea not null,
  wrapped_dek     bytea not null,
  content_iv      bytea,
  content         bytea,
  storage_path    text,
  envelope_version smallint not null default 1,
  archived_at     timestamptz not null default now(),
  constraint item_versions_unique unique (item_id, version)
);

create index item_versions_item_idx on vault.item_versions (item_id, version desc);

-- History must not be rewritable, or it is not history.
create trigger item_versions_append_only
  before update or delete on vault.item_versions
  for each row execute function vault.forbid_mutation();

-- ---------------------------------------------------------------------------
-- Audit log. Spec §5.3: immutable, user-visible, exportable for probate.
-- ---------------------------------------------------------------------------
create table vault.audit_log (
  id          bigint generated always as identity primary key,
  vault_id    uuid references vault.vaults (id) on delete restrict,
  actor_id    uuid references auth.users (id) on delete set null,
  action      text not null
    constraint audit_action_length check (char_length(action) between 1 and 120),
  target_type text,
  target_id   text,
  -- Metadata only. A trigger below refuses anything that looks like content.
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index audit_log_vault_idx on vault.audit_log (vault_id, created_at desc);
create index audit_log_actor_idx on vault.audit_log (actor_id, created_at desc);

comment on table vault.audit_log is
  'Append-only by trigger, which binds every role including service_role. Spec §5.3.';

create trigger audit_log_append_only
  before update or delete on vault.audit_log
  for each row execute function vault.forbid_mutation();

-- Spec §11: no plaintext user content in logs or telemetry, ever. The audit log
-- is the most likely place for that rule to erode, one well-meaning debug field
-- at a time, so the database refuses the keys outright.
create or replace function vault.reject_content_in_audit_metadata()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  forbidden text[] := array[
    'passphrase', 'phrase', 'password', 'secret', 'seed', 'mnemonic',
    'content', 'plaintext', 'body', 'text', 'note', 'notes', 'key', 'private_key',
    'label', 'custodian', 'address', 'location'
  ];
  k text;
begin
  foreach k in array forbidden loop
    if new.metadata ? k then
      raise exception
        'Audit metadata may not contain the key %. Audit records carry identifiers and counts, never user content (spec §11).', k
        using errcode = 'check_violation';
    end if;
  end loop;

  if pg_column_size(new.metadata) > 4096 then
    raise exception 'Audit metadata is limited to 4 KB; a larger payload is content, not metadata.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger audit_log_metadata_is_metadata
  before insert on vault.audit_log
  for each row execute function vault.reject_content_in_audit_metadata();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table vault.vaults enable row level security;
alter table vault.vault_keys enable row level security;
alter table vault.items enable row level security;
alter table vault.item_versions enable row level security;
alter table vault.audit_log enable row level security;

create policy vaults_select_own on vault.vaults
  for select to authenticated
  using (owner_id = (select auth.uid()));

create policy vaults_insert_own on vault.vaults
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy vaults_update_own on vault.vaults
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy vaults_delete_own on vault.vaults
  for delete to authenticated
  using (owner_id = (select auth.uid()) and status = 'active');

-- Key records: read and create, never update (no reset), never delete for a
-- primary — deleting it would destroy the vault while leaving the ciphertext,
-- which is a footgun rather than a feature.
create policy vault_keys_select_own on vault.vault_keys
  for select to authenticated
  using (vault.owns_vault(vault_id));

create policy vault_keys_insert_own on vault.vault_keys
  for insert to authenticated
  with check (vault.owns_vault(vault_id));

create policy vault_keys_delete_duress_only on vault.vault_keys
  for delete to authenticated
  using (vault.owns_vault(vault_id) and kind = 'duress');

create policy items_select_own on vault.items
  for select to authenticated
  using (vault.owns_vault(vault_id));

create policy items_insert_own on vault.items
  for insert to authenticated
  with check (vault.owns_vault(vault_id));

create policy items_update_own on vault.items
  for update to authenticated
  using (vault.owns_vault(vault_id))
  with check (vault.owns_vault(vault_id));

create policy items_delete_own on vault.items
  for delete to authenticated
  using (vault.owns_vault(vault_id));

create policy item_versions_select_own on vault.item_versions
  for select to authenticated
  using (
    exists (
      select 1 from vault.items i
       where i.id = item_versions.item_id
         and vault.owns_vault(i.vault_id)
    )
  );

create policy item_versions_insert_own on vault.item_versions
  for insert to authenticated
  with check (
    exists (
      select 1 from vault.items i
       where i.id = item_versions.item_id
         and vault.owns_vault(i.vault_id)
    )
  );

-- The user can read their whole audit trail (spec §5.3: visible to the user,
-- exportable for probate) and append to it. Nobody can change it.
create policy audit_log_select_own on vault.audit_log
  for select to authenticated
  using (
    actor_id = (select auth.uid())
    or (vault_id is not null and vault.owns_vault(vault_id))
  );

create policy audit_log_insert_own on vault.audit_log
  for insert to authenticated
  with check (
    actor_id = (select auth.uid())
    and (vault_id is null or vault.owns_vault(vault_id))
  );

grant select, insert, update, delete on vault.vaults to authenticated;
grant select, insert, delete on vault.vault_keys to authenticated;
grant select, insert, update, delete on vault.items to authenticated;
grant select, insert on vault.item_versions to authenticated;
grant select, insert on vault.audit_log to authenticated;
grant usage on sequence vault.audit_log_id_seq to authenticated;
