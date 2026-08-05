-- ===========================================================================
-- 0004_passcode_lookup.sql — widen auth_lookup_by_email for passcode login
--
-- WHY THIS FILE EXISTS
--
-- Manager/Member first-login (task #6) authenticates with a passcode rather
-- than a password. auth_lookup_by_email (0002_auth_lookup.sql:57-75) returns
-- no passcode columns, and Postgres cannot `CREATE OR REPLACE` a function with
-- a changed `RETURNS TABLE` column list — the only way forward is `DROP` then
-- recreate with the wider signature.
--
-- Applied migrations are checksum-immutable (migrate.ts throws on any edit,
-- even a comment-only one), so this cannot be done by editing 0002. This is a
-- new numbered file that drops and recreates.
--
-- WHAT IS WIDENED AND WHY
--
-- Three columns added: passcode_hash, passcode_expires_at, passcode_used_at.
--
-- All three are within "what authentication needs" (the 0002 standing editing
-- rule) because passcode login IS authentication, and the hash must reach Node
-- so bcrypt.compare can run unconditionally — including when no user is found,
-- against a dummy hash. Comparing in SQL would reintroduce the timing oracle
-- 0002 exists to avoid: an unknown email would skip the compare and respond
-- measurably faster than a wrong passcode, turning response time alone into an
-- account-enumeration oracle.
--
-- WHAT STAYS THE SAME
--
-- Everything else from 0002 is carried forward verbatim:
--   * SECURITY DEFINER + SET search_path (an unpinned path is the classic
--     Postgres privilege-escalation vector)
--   * STABLE, the citext cast, LIMIT 1
--   * Ownership: relay_migrator, so the user_definer_lookup policy from
--     0003_auth_lookup_policy.sql still applies (dropping the function does NOT
--     drop that policy — it lives on the table)
--   * Grants: REVOKE ALL FROM PUBLIC, then GRANT EXECUTE TO relay_app
--
-- auth_lookup_by_id is untouched: nothing on the per-request revalidation path
-- needs passcode columns.
--
-- STANDING EDITING RULES (restated from 0002, still in force)
--
--   * Never add an INSERT/UPDATE/DELETE definer function here. Writes go
--     through the normal RLS path with a tenant context set.
--   * Never widen the returned column list beyond what authentication needs.
--   * Never drop `SET search_path`. A SECURITY DEFINER function without a
--     pinned search_path can be pointed at an attacker-controlled table of the
--     same name — it is the classic Postgres privilege-escalation vector.
-- ===========================================================================

DROP FUNCTION IF EXISTS auth_lookup_by_email(text);

CREATE FUNCTION auth_lookup_by_email(p_email text)
  RETURNS TABLE (
    id                    uuid,
    org_id                uuid,
    role                  user_role,
    manager_id            uuid,
    password_hash         text,
    status                user_status,
    passcode_hash         text,
    passcode_expires_at   timestamptz,
    passcode_used_at      timestamptz
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  SELECT u.id, u.org_id, u.role, u.manager_id, u.password_hash, u.status,
         u.passcode_hash, u.passcode_expires_at, u.passcode_used_at
  FROM "user" u
  WHERE u.email = p_email::citext
  LIMIT 1
$$;

-- Narrow the blast radius: relay_app can call this, and nothing else.
REVOKE ALL ON FUNCTION auth_lookup_by_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_lookup_by_email(text) TO relay_app;
