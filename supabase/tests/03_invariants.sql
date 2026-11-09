-- ---------------------------------------------------------------------------
-- The invariants that are promises to the user rather than mere data hygiene.
--
-- Each of these corresponds to a sentence in the spec that would quietly become
-- false if someone changed the schema without noticing. They are enforced by
-- triggers and constraints — not by application code — because the application
-- is not the only thing that talks to this database.
-- ---------------------------------------------------------------------------
begin;
select plan(26);

select tests.clear_authentication();

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000c0de', 'owner@example.test');
insert into account.account_security (user_id) values ('00000000-0000-4000-8000-00000000c0de');

insert into vault.vaults (id, owner_id, label) values
  ('00000000-0000-4000-8000-0000000001a1', '00000000-0000-4000-8000-00000000c0de', 'Test vault');

insert into vault.vault_keys
  (id, vault_id, kind, kdf_profile_id, kdf_salt, wrapped_vmk_iv, wrapped_vmk, sentinel_iv, sentinel)
values
  ('00000000-0000-4000-8000-0000000002a2', '00000000-0000-4000-8000-0000000001a1', 'primary', 1,
   decode(repeat('a1', 16), 'hex'), decode(repeat('a2', 12), 'hex'),
   decode(repeat('a3', 48), 'hex'), decode(repeat('a4', 12), 'hex'),
   decode(repeat('a5', 34), 'hex'));

-- =========================================================================
-- Spec §3.1: there is no password reset. There cannot be one.
--
-- These run as `postgres`, the table owner, which bypasses RLS entirely. That is
-- the point: the immutability of a key record is enforced by a trigger, so it
-- holds for the one role that no policy can restrain.
-- =========================================================================
select throws_ok(
  $$ update vault.vault_keys
        set wrapped_vmk = decode(repeat('ff', 48), 'hex')
      where id = '00000000-0000-4000-8000-0000000002a2' $$,
  'Vault key records are immutable. There is no password reset, by design (spec §3.1).',
  'the wrapped master key cannot be replaced'
);

select throws_ok(
  $$ update vault.vault_keys set kdf_salt = decode(repeat('ff', 16), 'hex')
      where id = '00000000-0000-4000-8000-0000000002a2' $$,
  'Vault key records are immutable. There is no password reset, by design (spec §3.1).',
  'the KDF salt cannot be changed'
);

select throws_ok(
  $$ update vault.vault_keys set sentinel = decode(repeat('ff', 34), 'hex')
      where id = '00000000-0000-4000-8000-0000000002a2' $$,
  'Vault key records are immutable. There is no password reset, by design (spec §3.1).',
  'the sentinel cannot be changed'
);

select throws_ok(
  $$ update vault.vault_keys set kind = 'duress'
      where id = '00000000-0000-4000-8000-0000000002a2' $$,
  'Vault key records are immutable. There is no password reset, by design (spec §3.1).',
  'a primary key record cannot be relabelled as duress'
);

-- The service role carries BYPASSRLS, so no policy restrains it. What restrains
-- it is that the grant was never made (see migration 0006). Asserted here
-- because a careless `grant all ... to service_role` would otherwise hand an
-- exfiltrated server key the entire ciphertext corpus.
select is_empty(
  $$ select table_schema || '.' || table_name || ':' || privilege_type
       from information_schema.role_table_grants
      where grantee = 'service_role'
        and table_schema in ('vault', 'custody') $$,
  'service_role has no privileges on the vault or custody schemas at all'
);
select throws_ok(
  $$ set local role service_role;
     update vault.vault_keys set wrapped_vmk = decode(repeat('ff', 48), 'hex')
      where id = '00000000-0000-4000-8000-0000000002a2' $$,
  '42501',
  'permission denied for schema vault',
  'service_role cannot even reach vault.vault_keys to attempt a re-wrap'
);
select tests.clear_authentication();
select isnt_empty(
  $$ select 1 from information_schema.role_table_grants
      where grantee = 'service_role' and table_schema = 'account' $$,
  'service_role does keep the account-schema access the passkey routes need'
);

-- One primary and at most one duress key per vault.
select throws_ok(
  $$ insert into vault.vault_keys
       (vault_id, kind, kdf_profile_id, kdf_salt, wrapped_vmk_iv, wrapped_vmk, sentinel_iv, sentinel)
     values ('00000000-0000-4000-8000-0000000001a1', 'primary', 1,
             decode(repeat('b1', 16), 'hex'), decode(repeat('b2', 12), 'hex'),
             decode(repeat('b3', 48), 'hex'), decode(repeat('b4', 12), 'hex'),
             decode(repeat('b5', 34), 'hex')) $$,
  '23505',
  'duplicate key value violates unique constraint "vault_keys_one_primary_idx"',
  'a vault cannot have two primary key records'
);

select lives_ok(
  $$ insert into vault.vault_keys
       (vault_id, kind, kdf_profile_id, kdf_salt, wrapped_vmk_iv, wrapped_vmk, sentinel_iv, sentinel)
     values ('00000000-0000-4000-8000-0000000001a1', 'duress', 1,
             decode(repeat('c1', 16), 'hex'), decode(repeat('c2', 12), 'hex'),
             decode(repeat('c3', 48), 'hex'), decode(repeat('c4', 12), 'hex'),
             decode(repeat('c5', 34), 'hex')) $$,
  'a vault may have one duress key record'
);

select throws_ok(
  $$ insert into vault.vault_keys
       (vault_id, kind, kdf_profile_id, kdf_salt, wrapped_vmk_iv, wrapped_vmk, sentinel_iv, sentinel)
     values ('00000000-0000-4000-8000-0000000001a1', 'duress', 1,
             decode(repeat('d1', 16), 'hex'), decode(repeat('d2', 12), 'hex'),
             decode(repeat('d3', 48), 'hex'), decode(repeat('d4', 12), 'hex'),
             decode(repeat('d5', 34), 'hex')) $$,
  '23505',
  'duplicate key value violates unique constraint "vault_keys_one_duress_idx"',
  'a vault cannot have two duress key records'
);

-- Crypto field lengths are fixed by the format, so a malformed row cannot land.
select throws_like(
  $$ insert into vault.vault_keys
       (vault_id, kind, kdf_profile_id, kdf_salt, wrapped_vmk_iv, wrapped_vmk, sentinel_iv, sentinel)
     values ('00000000-0000-4000-8000-0000000001a1', 'primary', 1,
             decode(repeat('e1', 8), 'hex'), decode(repeat('e2', 12), 'hex'),
             decode(repeat('e3', 48), 'hex'), decode(repeat('e4', 12), 'hex'),
             decode(repeat('e5', 34), 'hex')) $$,
  '%kdf_salt_length%',
  'a KDF salt of the wrong length is rejected'
);

select throws_like(
  $$ insert into vault.items
       (vault_id, kind, name, wrapped_dek_iv, wrapped_dek, content_iv, content)
     values ('00000000-0000-4000-8000-0000000001a1', 'text', 'bad iv',
             decode(repeat('f1', 16), 'hex'), decode(repeat('f2', 48), 'hex'),
             decode(repeat('f3', 12), 'hex'), decode(repeat('f4', 32), 'hex')) $$,
  '%wrapped_dek_iv_length%',
  'a GCM IV that is not 96 bits is rejected'
);

-- =========================================================================
-- Items: exactly one payload location.
-- =========================================================================
select throws_like(
  $$ insert into vault.items (vault_id, kind, name, wrapped_dek_iv, wrapped_dek)
     values ('00000000-0000-4000-8000-0000000001a1', 'text', 'no payload',
             decode(repeat('11', 12), 'hex'), decode(repeat('12', 48), 'hex')) $$,
  '%items_one_payload_location%',
  'an item with neither inline content nor a storage path is rejected'
);

select throws_like(
  $$ insert into vault.items
       (vault_id, kind, name, wrapped_dek_iv, wrapped_dek, content_iv, content, storage_path)
     values ('00000000-0000-4000-8000-0000000001a1', 'text', 'both payloads',
             decode(repeat('21', 12), 'hex'), decode(repeat('22', 48), 'hex'),
             decode(repeat('23', 12), 'hex'), decode(repeat('24', 32), 'hex'), 'vault/x') $$,
  '%items_one_payload_location%',
  'an item with both inline content and a storage path is rejected'
);

-- =========================================================================
-- Spec §5.3 and §11: the audit log is immutable and carries no user content.
-- =========================================================================
insert into vault.audit_log (id, vault_id, actor_id, action)
  overriding system value
  values (9001, '00000000-0000-4000-8000-0000000001a1',
          '00000000-0000-4000-8000-00000000c0de', 'vault.unlocked');

select throws_ok(
  $$ update vault.audit_log set action = 'nothing happened' where id = 9001 $$,
  'Table vault.audit_log is append-only; UPDATE is not permitted.',
  'audit entries cannot be rewritten'
);

select throws_ok(
  $$ delete from vault.audit_log where id = 9001 $$,
  'Table vault.audit_log is append-only; DELETE is not permitted.',
  'audit entries cannot be deleted'
);


select throws_like(
  $$ insert into vault.audit_log (vault_id, actor_id, action, metadata)
     values ('00000000-0000-4000-8000-0000000001a1', '00000000-0000-4000-8000-00000000c0de',
             'debug', '{"passphrase": "witch collapse practice"}'::jsonb) $$,
  '%may not contain the key passphrase%',
  'audit metadata cannot carry a passphrase field'
);

select throws_like(
  $$ insert into vault.audit_log (vault_id, actor_id, action, metadata)
     values ('00000000-0000-4000-8000-0000000001a1', '00000000-0000-4000-8000-00000000c0de',
             'debug', '{"content": "the seed is in the safe"}'::jsonb) $$,
  '%may not contain the key content%',
  'audit metadata cannot carry item content'
);

select throws_like(
  $$ insert into vault.audit_log (vault_id, actor_id, action, metadata)
     values ('00000000-0000-4000-8000-0000000001a1', '00000000-0000-4000-8000-00000000c0de',
             'debug', '{"custodian": "my sister Elena"}'::jsonb) $$,
  '%may not contain the key custodian%',
  'audit metadata cannot carry a custodian identity'
);

select lives_ok(
  $$ insert into vault.audit_log (vault_id, actor_id, action, metadata)
     values ('00000000-0000-4000-8000-0000000001a1', '00000000-0000-4000-8000-00000000c0de',
             'custody.point.verified', '{"point_id": "abc", "outcome": "intact", "count": 3}'::jsonb) $$,
  'audit metadata may carry identifiers, outcomes and counts'
);

-- =========================================================================
-- Custody constraints. Spec §4.
-- =========================================================================
insert into custody.plans (vault_id, mode, passphrase_word_count, part_count)
  values ('00000000-0000-4000-8000-0000000001a1', 'split', 15, 3);

select throws_like(
  $$ insert into custody.points
       (vault_id, point_type, holding, part_index,
        detail_wrapped_dek_iv, detail_wrapped_dek, detail_iv, detail)
     values ('00000000-0000-4000-8000-0000000001a1', 'person', 'split_part', null,
             decode(repeat('31', 12), 'hex'), decode(repeat('32', 48), 'hex'),
             decode(repeat('33', 12), 'hex'), decode(repeat('34', 32), 'hex')) $$,
  '%part_index_matches_holding%',
  'a part-holding custody point must carry a part number'
);

select throws_like(
  $$ insert into custody.points
       (vault_id, point_type, holding, part_index,
        detail_wrapped_dek_iv, detail_wrapped_dek, detail_iv, detail)
     values ('00000000-0000-4000-8000-0000000001a1', 'person', 'full_copy', 2,
             decode(repeat('41', 12), 'hex'), decode(repeat('42', 48), 'hex'),
             decode(repeat('43', 12), 'hex'), decode(repeat('44', 32), 'hex')) $$,
  '%part_index_matches_holding%',
  'a full-copy custody point must not carry a part number'
);

select throws_like(
  $$ update custody.plans set part_count = 40, passphrase_word_count = 12
      where vault_id = '00000000-0000-4000-8000-0000000001a1' $$,
  '%parts_fit_in_phrase%',
  'a plan cannot have more parts than the passphrase has words'
);

select throws_like(
  $$ update custody.plans set verification_interval_months = 24
      where vault_id = '00000000-0000-4000-8000-0000000001a1' $$,
  '%verification_interval_allowed%',
  'the verification interval is limited to quarterly, half-yearly or annual'
);

-- Spec §6.1: the waiting period has a floor of 14 days and is configurable upward.
select throws_like(
  $$ update vault.vaults set waiting_period_days = 7
      where id = '00000000-0000-4000-8000-0000000001a1' $$,
  '%waiting_period_minimum%',
  'the death-claim waiting period cannot be set below 14 days'
);
select lives_ok(
  $$ update vault.vaults set waiting_period_days = 90
      where id = '00000000-0000-4000-8000-0000000001a1' $$,
  'the waiting period may be raised'
);

select * from finish();
rollback;
