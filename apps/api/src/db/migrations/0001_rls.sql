-- ===========================================================================
-- 0001_rls.sql — row-level security, the second isolation layer
--
-- The app-layer guards are the first layer. This file exists so that a
-- forgotten WHERE clause anywhere in the codebase fails CLOSED instead of
-- leaking another tenant's rows.
--
-- Three session variables drive every policy. They are set transaction-locally
-- by TenantTransactionInterceptor on each authenticated request:
--
--   app.current_org_id      the caller's organization
--   app.current_role        'owner' | 'manager' | 'member'
--   app.current_manager_id  NULL for owner, self for manager, manager for member
--
-- current_setting(..., true) returns NULL when a variable is unset, and every
-- comparison against NULL is false. So an unauthenticated or misconfigured
-- connection sees ZERO rows rather than everything. That default is the whole
-- point: the failure mode is an empty result, not a breach.
-- ===========================================================================

-- Helper accessors. STABLE + explicit search_path so a policy can never be
-- redirected at a shadowed function.
CREATE OR REPLACE FUNCTION app_current_org_id() RETURNS uuid
  LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS
$$ SELECT nullif(current_setting('app.current_org_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app_current_role() RETURNS text
  LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS
$$ SELECT nullif(current_setting('app.current_role', true), '') $$;

CREATE OR REPLACE FUNCTION app_current_manager_id() RETURNS uuid
  LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS
$$ SELECT nullif(current_setting('app.current_manager_id', true), '')::uuid $$;

-- Every tenant-scoped table gets both ENABLE and FORCE. Without FORCE, the
-- table owner silently bypasses its own policies -- which would make the
-- isolation test pass while proving nothing if migrations and runtime ever
-- shared a role.
ALTER TABLE organization  ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization  FORCE  ROW LEVEL SECURITY;
ALTER TABLE "user"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user"        FORCE  ROW LEVEL SECURITY;
ALTER TABLE team          ENABLE ROW LEVEL SECURITY;
ALTER TABLE team          FORCE  ROW LEVEL SECURITY;
ALTER TABLE audit_log     ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log     FORCE  ROW LEVEL SECURITY;

-- --- organization ----------------------------------------------------------
-- A caller only ever sees their own org row. Owner included: cross-org
-- visibility is not a feature of any role.
DROP POLICY IF EXISTS organization_tenant_isolation ON organization;
CREATE POLICY organization_tenant_isolation ON organization
  FOR ALL
  USING (id = app_current_org_id())
  WITH CHECK (id = app_current_org_id());

-- --- user ------------------------------------------------------------------
-- org_id is checked FIRST and unconditionally, so even the owner bypass below
-- cannot reach outside the caller's organization.
DROP POLICY IF EXISTS user_tenant_isolation ON "user";
CREATE POLICY user_tenant_isolation ON "user"
  FOR ALL
  USING (
    org_id = app_current_org_id()
    AND (
      app_current_role() = 'owner'
      OR manager_id = app_current_manager_id()
    )
  )
  WITH CHECK (
    org_id = app_current_org_id()
    AND (
      app_current_role() = 'owner'
      OR manager_id = app_current_manager_id()
    )
  );

-- --- team ------------------------------------------------------------------
DROP POLICY IF EXISTS team_tenant_isolation ON team;
CREATE POLICY team_tenant_isolation ON team
  FOR ALL
  USING (
    org_id = app_current_org_id()
    AND (
      app_current_role() = 'owner'
      OR manager_id = app_current_manager_id()
    )
  )
  WITH CHECK (
    org_id = app_current_org_id()
    AND (
      app_current_role() = 'owner'
      OR manager_id = app_current_manager_id()
    )
  );

-- --- audit_log -------------------------------------------------------------
-- Append-only by policy: SELECT is owner-only (managers do not get an org-wide
-- activity feed), INSERT is allowed in-org, and there is deliberately no
-- UPDATE or DELETE policy, so the log is immutable to the runtime role even
-- though it holds ordinary DML grants (spec §8.1: "timestamped and immutable").
--
-- CONSEQUENCE FOR CALLERS: a non-owner INSERT must not use RETURNING. RETURNING
-- performs an implicit SELECT, which the owner-only policy below rejects, so
-- `INSERT ... RETURNING id` as a manager fails with a row-level security error
-- even though the INSERT itself is permitted. Audit writes are fire-and-forget;
-- nothing needs the generated id back.
DROP POLICY IF EXISTS audit_log_select ON audit_log;
CREATE POLICY audit_log_select ON audit_log
  FOR SELECT
  USING (org_id = app_current_org_id() AND app_current_role() = 'owner');

DROP POLICY IF EXISTS audit_log_insert ON audit_log;
CREATE POLICY audit_log_insert ON audit_log
  FOR INSERT
  WITH CHECK (org_id = app_current_org_id());

-- --- refresh_token: deliberately NO row-level security ---------------------
-- Rows are found only by the SHA-256 of a token the client presents, and the
-- raw token is never stored. There is no tenant predicate that could be
-- expressed here -- "only if you already know the hash" is not something RLS
-- can encode -- and /auth/refresh runs before any tenant context exists.
-- Confidentiality rests on the hash being unguessable and on the raw value
-- never touching the database. Documented rather than silently omitted.

-- --- grants ----------------------------------------------------------------
-- relay_app is the runtime role and MUST NOT own these tables; an owner
-- bypasses RLS unless FORCE is set, and we do not want to depend on FORCE
-- alone. It gets DML only -- no DDL, no TRUNCATE, no BYPASSRLS attribute.
GRANT USAGE ON SCHEMA public TO relay_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON organization, "user", team, refresh_token TO relay_app;
-- audit_log: no DELETE, no UPDATE. Immutability enforced by grant as well as
-- by the absent policies above -- two independent reasons it cannot be rewritten.
GRANT SELECT, INSERT ON audit_log TO relay_app;
GRANT EXECUTE ON FUNCTION app_current_org_id()     TO relay_app;
GRANT EXECUTE ON FUNCTION app_current_role()       TO relay_app;
GRANT EXECUTE ON FUNCTION app_current_manager_id() TO relay_app;

-- Migration bookkeeping table lives outside RLS; only the migrator touches it.
REVOKE ALL ON SCHEMA information_schema FROM relay_app;
