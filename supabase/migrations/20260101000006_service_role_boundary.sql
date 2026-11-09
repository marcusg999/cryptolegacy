-- ---------------------------------------------------------------------------
-- What the service role may and may not touch.
--
-- Spec §5 threat model: "one of our engineers is malicious". The service-role
-- key is the key that engineer would reach for, and it carries BYPASSRLS — so no
-- row-level policy restrains it. The only thing that does is not granting it the
-- privilege in the first place.
--
-- So the boundary is drawn here, explicitly, rather than left to whatever
-- defaults happen to apply:
--
--   account  — GRANTED. Server routes must verify WebAuthn registrations and
--              create the security row at signup. No key material lives here.
--   legal    — GRANTED. Legal-operations content publishing is a privileged,
--              server-side task by design (spec §2.3).
--   vault    — NOT GRANTED. The server has no reason to read a single byte of
--              vault ciphertext. All vault I/O happens in the browser under the
--              user's own JWT, through RLS. Withholding this grant means an
--              exfiltrated service-role key does not even reach the ciphertext,
--              let alone the plaintext.
--   custody  — NOT GRANTED, for the same reason.
--
-- If a future feature appears to need service-role access to vault or custody,
-- that is a design smell worth arguing about before the grant is added: it
-- almost certainly means work is being done on the server that belongs in the
-- client, where the keys are.
-- ---------------------------------------------------------------------------

grant usage on schema account to service_role;
grant select, insert, update, delete on all tables in schema account to service_role;
alter default privileges in schema account
  grant select, insert, update, delete on tables to service_role;

grant usage on schema legal to service_role;
grant select, insert, update, delete on all tables in schema legal to service_role;
alter default privileges in schema legal
  grant select, insert, update, delete on tables to service_role;

-- Stated as explicit revokes so the intent survives a future `grant all on all
-- tables in schema ... to service_role` applied carelessly: this migration being
-- re-read is the warning.
revoke all on schema vault from service_role;
revoke all on schema custody from service_role;
revoke all on all tables in schema vault from service_role;
revoke all on all tables in schema custody from service_role;

comment on schema vault is
  'Encrypted vault contents and audit log. Ciphertext only. service_role is deliberately NOT granted access.';
comment on schema custody is
  'Custody plan metadata and verification cycle. service_role is deliberately NOT granted access.';
