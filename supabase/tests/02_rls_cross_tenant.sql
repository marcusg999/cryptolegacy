-- ---------------------------------------------------------------------------
-- Spec §5.5: "Every policy gets a test proving the negative case: a different
-- user cannot read this row."
--
-- Two users, each with a vault, each with every kind of child row. For every
-- table, Bob must see Alice's row count as zero and must fail to write into her
-- vault. This is the file that would have caught the bug.
-- ---------------------------------------------------------------------------
begin;
select plan(30);

-- Fixtures, created as superuser so RLS does not interfere with setup.
select tests.clear_authentication();

-- Fixed UUIDs rather than a lookup table: a temporary table would need its own
-- grants once the test switches to the `authenticated` role, which is noise.

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000a11c', 'alice@example.test'),
  ('00000000-0000-4000-8000-00000000b0b1', 'bob@example.test');
insert into account.account_security (user_id) values
  ('00000000-0000-4000-8000-00000000a11c'),
  ('00000000-0000-4000-8000-00000000b0b1');

insert into vault.vaults (id, owner_id, label) values
  ('00000000-0000-4000-8000-00000000a1a1', '00000000-0000-4000-8000-00000000a11c', 'Alice personal'),
  ('00000000-0000-4000-8000-00000000b1b1', '00000000-0000-4000-8000-00000000b0b1',   'Bob personal');

insert into vault.vault_keys
  (vault_id, kind, kdf_profile_id, kdf_salt, wrapped_vmk_iv, wrapped_vmk, sentinel_iv, sentinel)
values
  ('00000000-0000-4000-8000-00000000a1a1', 'primary', 1,
   decode(repeat('a1', 16), 'hex'), decode(repeat('a2', 12), 'hex'),
   decode(repeat('a3', 48), 'hex'), decode(repeat('a4', 12), 'hex'),
   decode(repeat('a5', 34), 'hex')),
  ('00000000-0000-4000-8000-00000000b1b1', 'primary', 1,
   decode(repeat('b1', 16), 'hex'), decode(repeat('b2', 12), 'hex'),
   decode(repeat('b3', 48), 'hex'), decode(repeat('b4', 12), 'hex'),
   decode(repeat('b5', 34), 'hex'));

insert into vault.items
  (id, vault_id, kind, name, wrapped_dek_iv, wrapped_dek, content_iv, content)
values
  ('00000000-0000-4000-8000-0000000a17e1', '00000000-0000-4000-8000-00000000a1a1',
   'text', 'Alice wallet notes', decode(repeat('c1', 12), 'hex'), decode(repeat('c2', 48), 'hex'),
   decode(repeat('c3', 12), 'hex'), decode(repeat('c4', 64), 'hex')),
  ('00000000-0000-4000-8000-0000000b17e1', '00000000-0000-4000-8000-00000000b1b1',
   'text', 'Bob wallet notes', decode(repeat('d1', 12), 'hex'), decode(repeat('d2', 48), 'hex'),
   decode(repeat('d3', 12), 'hex'), decode(repeat('d4', 64), 'hex'));

insert into custody.plans (vault_id, mode, passphrase_word_count, part_count) values
  ('00000000-0000-4000-8000-00000000a1a1', 'redundancy', 12, 1),
  ('00000000-0000-4000-8000-00000000b1b1', 'redundancy', 12, 1);

insert into custody.points
  (id, vault_id, point_type, holding, detail_wrapped_dek_iv, detail_wrapped_dek, detail_iv, detail)
values
  ('00000000-0000-4000-8000-0000000a9017', '00000000-0000-4000-8000-00000000a1a1',
   'institution', 'full_copy', decode(repeat('e1', 12), 'hex'), decode(repeat('e2', 48), 'hex'),
   decode(repeat('e3', 12), 'hex'), decode(repeat('e4', 64), 'hex')),
  ('00000000-0000-4000-8000-0000000b9017', '00000000-0000-4000-8000-00000000b1b1',
   'person', 'full_copy', decode(repeat('f1', 12), 'hex'), decode(repeat('f2', 48), 'hex'),
   decode(repeat('f3', 12), 'hex'), decode(repeat('f4', 64), 'hex'));

insert into custody.checks (point_id, vault_id, outcome) values
  ('00000000-0000-4000-8000-0000000a9017', '00000000-0000-4000-8000-00000000a1a1', 'intact'),
  ('00000000-0000-4000-8000-0000000b9017', '00000000-0000-4000-8000-00000000b1b1', 'intact');

insert into vault.audit_log (vault_id, actor_id, action) values
  ('00000000-0000-4000-8000-00000000a1a1', '00000000-0000-4000-8000-00000000a11c', 'vault.created'),
  ('00000000-0000-4000-8000-00000000b1b1', '00000000-0000-4000-8000-00000000b0b1',   'vault.created');

insert into account.passkeys (user_id, credential_id, public_key) values
  ('00000000-0000-4000-8000-00000000a11c', 'cred-alice-1', 'pk-alice-1'),
  ('00000000-0000-4000-8000-00000000b0b1',   'cred-bob-1',   'pk-bob-1');

-- =========================================================================
-- Alice sees her own rows.
-- =========================================================================
select tests.authenticate_as('00000000-0000-4000-8000-00000000a11c');

select is((select count(*) from vault.vaults)::int, 1, 'Alice sees exactly her own vault');
select is((select count(*) from vault.vault_keys)::int, 1, 'Alice sees exactly her own key record');
select is((select count(*) from vault.items)::int, 1, 'Alice sees exactly her own items');
select is((select count(*) from custody.plans)::int, 1, 'Alice sees exactly her own custody plan');
select is((select count(*) from custody.points)::int, 1, 'Alice sees exactly her own custody points');
select is((select count(*) from custody.checks)::int, 1, 'Alice sees exactly her own custody checks');
select is((select count(*) from vault.audit_log)::int, 1, 'Alice sees exactly her own audit entries');
select is((select count(*) from account.passkeys)::int, 1, 'Alice sees exactly her own passkeys');
select is((select count(*) from account.account_security)::int, 1, 'Alice sees exactly her own security row');

-- =========================================================================
-- THE NEGATIVE CASES. Bob must not read a single row of Alice's.
-- =========================================================================
select tests.authenticate_as('00000000-0000-4000-8000-00000000b0b1');

select is(
  (select count(*) from vault.vaults where id = '00000000-0000-4000-8000-00000000a1a1')::int,
  0, 'Bob cannot read Alice''s vault'
);
select is(
  (select count(*) from vault.vault_keys where vault_id = '00000000-0000-4000-8000-00000000a1a1')::int,
  0, 'Bob cannot read Alice''s wrapped master key'
);
select is(
  (select count(*) from vault.items where vault_id = '00000000-0000-4000-8000-00000000a1a1')::int,
  0, 'Bob cannot read Alice''s items'
);
select is(
  (select count(*) from custody.plans where vault_id = '00000000-0000-4000-8000-00000000a1a1')::int,
  0, 'Bob cannot read Alice''s custody plan'
);
select is(
  (select count(*) from custody.points where vault_id = '00000000-0000-4000-8000-00000000a1a1')::int,
  0, 'Bob cannot read Alice''s custody points'
);
select is(
  (select count(*) from custody.checks where vault_id = '00000000-0000-4000-8000-00000000a1a1')::int,
  0, 'Bob cannot read Alice''s custody verification history'
);
select is(
  (select count(*) from vault.audit_log where vault_id = '00000000-0000-4000-8000-00000000a1a1')::int,
  0, 'Bob cannot read Alice''s audit log'
);
select is(
  (select count(*) from account.passkeys where user_id = '00000000-0000-4000-8000-00000000a11c')::int,
  0, 'Bob cannot read Alice''s passkeys'
);
select is(
  (select count(*) from account.account_security where user_id = '00000000-0000-4000-8000-00000000a11c')::int,
  0, 'Bob cannot read Alice''s security settings'
);

-- Writes into Alice's vault must fail, not silently no-op.
select throws_ok(
  $$ insert into vault.items (vault_id, kind, name, wrapped_dek_iv, wrapped_dek, content_iv, content)
     values ('00000000-0000-4000-8000-00000000a1a1', 'text', 'injected',
             decode(repeat('11', 12), 'hex'), decode(repeat('12', 48), 'hex'),
             decode(repeat('13', 12), 'hex'), decode(repeat('14', 32), 'hex')) $$,
  '42501',
  'new row violates row-level security policy for table "items"',
  'Bob cannot insert an item into Alice''s vault'
);

select throws_ok(
  $$ insert into custody.points
       (vault_id, point_type, holding, detail_wrapped_dek_iv, detail_wrapped_dek, detail_iv, detail)
     values ('00000000-0000-4000-8000-00000000a1a1', 'person', 'full_copy',
             decode(repeat('21', 12), 'hex'), decode(repeat('22', 48), 'hex'),
             decode(repeat('23', 12), 'hex'), decode(repeat('24', 32), 'hex')) $$,
  '42501',
  'new row violates row-level security policy for table "points"',
  'Bob cannot add a custody point to Alice''s vault'
);

select throws_ok(
  $$ insert into vault.vaults (owner_id, label) values
     ('00000000-0000-4000-8000-00000000a11c', 'Vault I do not own') $$,
  '42501',
  'new row violates row-level security policy for table "vaults"',
  'Bob cannot create a vault owned by Alice'
);

-- An UPDATE that cannot see the row affects nothing, which is the correct
-- behaviour but must be asserted so a future policy change cannot loosen it.
select lives_ok(
  $$ update vault.items set name = 'hijacked'
      where id = '00000000-0000-4000-8000-0000000a17e1' $$,
  'Bob''s update of Alice''s item runs without error'
);
select tests.clear_authentication();
select is(
  (select name from vault.items where id = '00000000-0000-4000-8000-0000000a17e1'),
  'Alice wallet notes',
  '...and changed nothing'
);

select tests.authenticate_as('00000000-0000-4000-8000-00000000b0b1');
select lives_ok(
  $$ delete from vault.items where id = '00000000-0000-4000-8000-0000000a17e1' $$,
  'Bob''s delete of Alice''s item runs without error'
);
select tests.clear_authentication();
select is(
  (select count(*) from vault.items where id = '00000000-0000-4000-8000-0000000a17e1')::int,
  1,
  '...and deleted nothing'
);

-- The preceding block cleared authentication in order to verify the row was
-- untouched, so sign back in before asserting anything about a user's access.
select tests.authenticate_as('00000000-0000-4000-8000-00000000b0b1');

-- WebAuthn challenges are minted and consumed server-side only. A client that
-- could read or write them could replay one, which would make the passkey a
-- formality.
-- Denial lands at the table-privilege level: `authenticated` was never granted
-- anything on this table, so it cannot even read it. The deny-all RLS policy on
-- top is belt and braces — it states the intent in a place a reader of the
-- policies will see, and it survives someone adding a grant carelessly.
select throws_ok(
  $$ select count(*) from account.webauthn_challenges $$,
  '42501',
  'permission denied for table webauthn_challenges',
  'a signed-in user cannot read any WebAuthn challenge, including their own'
);
select throws_ok(
  $$ insert into account.webauthn_challenges (user_id, purpose, challenge)
     values ('00000000-0000-4000-8000-00000000b0b1', 'register', 'forged') $$,
  '42501',
  'permission denied for table webauthn_challenges',
  'a signed-in user cannot mint their own WebAuthn challenge'
);

-- =========================================================================
-- An unauthenticated caller sees nothing at all.
-- =========================================================================
select tests.authenticate_as_anon();
-- Denial lands at the SCHEMA level, not the table level: anon was never granted
-- USAGE on vault or custody at all, so it cannot even name the tables. That is
-- stronger than a table-level denial and is asserted as such, so a future
-- migration that hands anon schema usage fails here.
select throws_ok(
  $$ select count(*) from vault.vaults $$,
  '42501',
  'permission denied for schema vault',
  'anon cannot even reach the vault schema'
);
select throws_ok(
  $$ select count(*) from custody.points $$,
  '42501',
  'permission denied for schema custody',
  'anon cannot even reach the custody schema'
);
select lives_ok(
  $$ select count(*) from legal.state_requirements $$,
  'anon may query the legal library (which is empty until attorney-reviewed)'
);

select * from finish();
rollback;
