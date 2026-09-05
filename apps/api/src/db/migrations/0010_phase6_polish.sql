-- 0010_phase6_polish.sql — Soft-delete retention, recovery, and audit log support (Phase 6)
--
-- Adds:
--   1. deleted_at timestamptz column to "user" and "team" for 30-day recovery retention.
--   2. Indexes on deleted_at for fast recovery lookups.
--   3. Deterministic ORDER BY u.created_at DESC on auth_lookup_by_email.

SET search_path = public, pg_temp;

-- ---------------------------------------------------------------------------
-- 1. Add deleted_at to "user" and "team"
-- ---------------------------------------------------------------------------
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE team ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_user_status_deleted_at ON "user"(status, deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_team_deleted_at ON team(deleted_at) WHERE deleted_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Deterministic auth_lookup_by_email (latest created user first)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS auth_lookup_by_email(text);
CREATE OR REPLACE FUNCTION auth_lookup_by_email(p_email text)
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
  ORDER BY u.created_at DESC
  LIMIT 1
$$;

-- Ensure execute grants remain pinned to relay_app only
REVOKE ALL ON FUNCTION auth_lookup_by_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_lookup_by_email(text) TO relay_app;
