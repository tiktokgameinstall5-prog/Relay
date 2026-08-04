-- ===========================================================================
-- 0002_auth_lookup.sql — pre-authentication user lookup
--
-- THE PROBLEM THIS SOLVES
--
-- Login must find a user row by email BEFORE any tenant context exists — the
-- tenant context is derived from that very row. But every tenant table has
-- FORCE ROW LEVEL SECURITY, and neither runtime role can read them unscoped:
--
--   relay_app      context-free SELECT on "user"  ->  0 rows
--   relay_migrator context-free SELECT on "user"  ->  0 rows  (FORCE hits the
--                                                             owner too)
--
-- Both roles are NOBYPASSRLS, deliberately. So without something like this
-- file, /auth/*/login cannot be implemented at all.
--
-- THE FIX, AND WHY IT IS NARROW
--
-- Two SECURITY DEFINER functions. They execute with the privileges of their
-- OWNER (relay_migrator), so they see through RLS; relay_app gets EXECUTE and
-- nothing else — no table grant, no BYPASSRLS attribute. The bypass is
-- therefore exactly two functions wide, each returning a fixed column list for
-- a single row, rather than a role-level hole that applies to every query in
-- the codebase forever.
--
-- Verified when this was designed: relay_app can call these, and relay_app
-- still gets 0 rows from `SELECT count(*) FROM "user"`. test/auth.e2e-spec.ts
-- keeps asserting that second half, so a future widening of this file fails a
-- test rather than passing silently.
--
-- RULES FOR ANYONE EDITING THIS FILE
--
--   * Never add an INSERT/UPDATE/DELETE definer function here. Writes go
--     through the normal RLS path with a tenant context set.
--   * Never widen the returned column list beyond what authentication needs.
--   * Never drop `SET search_path`. A SECURITY DEFINER function without a
--     pinned search_path can be pointed at an attacker-controlled table of the
--     same name — it is the classic Postgres privilege-escalation vector.
-- ===========================================================================

-- --- lookup by email: the login path ---------------------------------------
-- Returns password_hash rather than verifying the password in SQL, so the
-- service can run bcrypt.compare unconditionally — including when no user was
-- found, against a dummy hash. Comparing here would let the caller distinguish
-- "no such email" from "wrong password" by response time alone.
--
-- Returns `status` rather than filtering on it for the same reason: how an
-- inactive account responds is a policy decision that belongs in the service,
-- where it is explicit and covered by a test.
--
-- LIMIT 1: email is unique per organization, not globally (see
-- user_org_id_email_key), because a global unique index would leak that an
-- address is already registered in some other tenant. Owner login is
-- org-agnostic, so in the rare case one address exists in two orgs this
-- returns one deterministic row. Manager/Member logins (task #6) are reached
-- through an org-scoped invite, so they are unaffected.
CREATE OR REPLACE FUNCTION auth_lookup_by_email(p_email text)
  RETURNS TABLE (
    id             uuid,
    org_id         uuid,
    role           user_role,
    manager_id     uuid,
    password_hash  text,
    status         user_status
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  SELECT u.id, u.org_id, u.role, u.manager_id, u.password_hash, u.status
  FROM "user" u
  WHERE u.email = p_email::citext
  LIMIT 1
$$;

-- --- lookup by id: the per-request revalidation path ------------------------
-- JwtStrategy.validate() calls this on every authenticated request instead of
-- trusting the token's claims blindly, so deactivating a user takes effect
-- immediately rather than whenever their access token happens to expire.
--
-- Deliberately does NOT return password_hash: nothing on this path needs it.
CREATE OR REPLACE FUNCTION auth_lookup_by_id(p_user_id uuid)
  RETURNS TABLE (
    id          uuid,
    org_id      uuid,
    role        user_role,
    manager_id  uuid,
    status      user_status
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  SELECT u.id, u.org_id, u.role, u.manager_id, u.status
  FROM "user" u
  WHERE u.id = p_user_id
$$;

-- --- grants ----------------------------------------------------------------
-- Postgres grants EXECUTE to PUBLIC by default on new functions, which on a
-- SECURITY DEFINER function means every role in the cluster inherits the
-- bypass. Revoke first, then grant to exactly one role.
REVOKE ALL ON FUNCTION auth_lookup_by_email(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_lookup_by_id(uuid)    FROM PUBLIC;

GRANT EXECUTE ON FUNCTION auth_lookup_by_email(text) TO relay_app;
GRANT EXECUTE ON FUNCTION auth_lookup_by_id(uuid)    TO relay_app;
