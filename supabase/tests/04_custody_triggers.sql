-- ---------------------------------------------------------------------------
-- The custody-cycle triggers. Spec §4.3 and §4.4.
--
-- These exist because the dashboard's "verified and intact" claim has to be true.
-- If `last_verified_at` can drift from the check history, or if the plan can
-- change without invalidating the printed Executor Letter, the product's central
-- trust signal becomes a lie that nobody notices for years.
-- ---------------------------------------------------------------------------
begin;
select plan(15);

select tests.clear_authentication();

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000d00d', 'cycle@example.test');
insert into account.account_security (user_id) values ('00000000-0000-4000-8000-00000000d00d');
insert into vault.vaults (id, owner_id, label) values
  ('00000000-0000-4000-8000-00000000cccc', '00000000-0000-4000-8000-00000000d00d', 'Cycle vault');
insert into custody.plans (vault_id, mode, passphrase_word_count, part_count, letter_last_generated_at)
  values ('00000000-0000-4000-8000-00000000cccc', 'redundancy', 12, 1, now());

-- Adding a custody point must invalidate the printed letter immediately.
select is(
  (select letter_last_generated_at >= plan_last_modified_at from custody.plans
    where vault_id = '00000000-0000-4000-8000-00000000cccc'),
  true,
  'the letter starts out current'
);

insert into custody.points
  (id, vault_id, point_type, holding, detail_wrapped_dek_iv, detail_wrapped_dek, detail_iv, detail)
values
  ('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-00000000cccc',
   'institution', 'full_copy', decode(repeat('11', 12), 'hex'), decode(repeat('12', 48), 'hex'),
   decode(repeat('13', 12), 'hex'), decode(repeat('14', 64), 'hex'));

select is(
  (select plan_last_modified_at > letter_last_generated_at from custody.plans
    where vault_id = '00000000-0000-4000-8000-00000000cccc'),
  true,
  'adding a custody point invalidates the Executor Letter (spec §4.4)'
);

-- And so must changing one, and removing one.
select custody.record_letter_generated('00000000-0000-4000-8000-00000000cccc');
update custody.points set point_type = 'person'
  where id = '00000000-0000-4000-8000-00000000e001';
select is(
  (select plan_last_modified_at > letter_last_generated_at from custody.plans
    where vault_id = '00000000-0000-4000-8000-00000000cccc'),
  true,
  'editing a custody point invalidates the Executor Letter'
);

select custody.record_letter_generated('00000000-0000-4000-8000-00000000cccc');
insert into custody.points
  (id, vault_id, point_type, holding, detail_wrapped_dek_iv, detail_wrapped_dek, detail_iv, detail)
values
  ('00000000-0000-4000-8000-00000000e002', '00000000-0000-4000-8000-00000000cccc',
   'location', 'full_copy', decode(repeat('21', 12), 'hex'), decode(repeat('22', 48), 'hex'),
   decode(repeat('23', 12), 'hex'), decode(repeat('24', 64), 'hex'));
delete from custody.points where id = '00000000-0000-4000-8000-00000000e002';
select is(
  (select plan_last_modified_at > letter_last_generated_at from custody.plans
    where vault_id = '00000000-0000-4000-8000-00000000cccc'),
  true,
  'removing a custody point invalidates the Executor Letter'
);

-- =========================================================================
-- Verification cycle. Spec §4.3.
-- =========================================================================
select is(
  (select last_verified_at from custody.points where id = '00000000-0000-4000-8000-00000000e001'),
  null,
  'a new custody point has never been verified'
);

insert into custody.checks (point_id, vault_id, outcome, checked_at)
  values ('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-00000000cccc',
          'intact', '2026-03-01T00:00:00Z');

select is(
  (select last_verified_at from custody.points where id = '00000000-0000-4000-8000-00000000e001'),
  '2026-03-01T00:00:00Z'::timestamptz,
  'an "intact" check sets last_verified_at from the check history'
);

-- An out-of-order check must not move the date backwards.
insert into custody.checks (point_id, vault_id, outcome, checked_at)
  values ('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-00000000cccc',
          'intact', '2025-01-01T00:00:00Z');
select is(
  (select last_verified_at from custody.points where id = '00000000-0000-4000-8000-00000000e001'),
  '2026-03-01T00:00:00Z'::timestamptz,
  'a backdated check does not make a point look staler than it is'
);

-- A check that is NOT "intact" must not count as a verification. "I went to the
-- bank and the box was empty" is the opposite of a verification.
insert into custody.checks (point_id, vault_id, outcome, checked_at)
  values ('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-00000000cccc',
          'missing', '2026-09-01T00:00:00Z');
select is(
  (select last_verified_at from custody.points where id = '00000000-0000-4000-8000-00000000e001'),
  '2026-03-01T00:00:00Z'::timestamptz,
  'a "missing" outcome does not count as a verification'
);

insert into custody.checks (point_id, vault_id, outcome, checked_at)
  values ('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-00000000cccc',
          'unreachable', '2026-10-01T00:00:00Z');
select is(
  (select last_verified_at from custody.points where id = '00000000-0000-4000-8000-00000000e001'),
  '2026-03-01T00:00:00Z'::timestamptz,
  'an "unreachable" outcome does not count as a verification either'
);

-- record_letter_generated must be the only way the timestamp moves, and it must
-- refuse a vault with no plan rather than silently doing nothing.
select throws_like(
  $$ select custody.record_letter_generated('00000000-0000-4000-8000-00000000ffff') $$,
  '%No custody plan for vault%',
  'stamping a letter for a vault with no custody plan is an error, not a no-op'
);

select custody.record_letter_generated('00000000-0000-4000-8000-00000000cccc');
select is(
  (select letter_last_generated_at > plan_last_modified_at from custody.plans
    where vault_id = '00000000-0000-4000-8000-00000000cccc'),
  true,
  'regenerating the letter after the last plan change clears the drift warning'
);

-- And a routine verification must not undo that, or the warning becomes noise.
insert into custody.checks (point_id, vault_id, outcome, checked_at)
  values ('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-00000000cccc',
          'intact', '2026-11-01T00:00:00Z');
select is(
  (select letter_last_generated_at > plan_last_modified_at from custody.plans
    where vault_id = '00000000-0000-4000-8000-00000000cccc'),
  true,
  'verifying a custody point does NOT invalidate the Executor Letter'
);
select is(
  (select last_verified_at from custody.points where id = '00000000-0000-4000-8000-00000000e001'),
  '2026-11-01T00:00:00Z'::timestamptz,
  '...but it does refresh the verification date'
);

select throws_like(
  $$ insert into custody.checks (point_id, vault_id, outcome)
     values ('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-00000000cccc', 'probably fine') $$,
  '%check_outcome_known%',
  'a check outcome outside the known set is rejected'
);

-- The verification history is evidence, so it cannot be edited after the fact.
select throws_ok(
  $$ update custody.checks set outcome = 'intact' where outcome = 'missing' $$,
  'Table custody.checks is append-only; UPDATE is not permitted.',
  'a recorded check cannot be rewritten'
);

select * from finish();
rollback;
