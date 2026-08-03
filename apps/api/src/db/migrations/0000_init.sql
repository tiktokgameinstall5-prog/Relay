-- ===========================================================================
-- 0000_init.sql — extensions, enums, tables, constraints, indexes
--
-- Migrations here are HAND-WRITTEN, not produced by `drizzle-kit generate`.
-- RLS policies, the two-role grant model, circular foreign keys, and
-- SECURITY DEFINER functions all need precision that a generator would
-- clobber on the next run. `schema.ts` is the query-builder's view of these
-- tables; this file is the source of truth for the database.
--
-- Run in filename order by src/db/scripts/migrate.ts. Every statement must be
-- idempotent so re-running is a no-op.
-- ===========================================================================

-- citext gives case-insensitive email uniqueness without LOWER() everywhere.
-- Trusted extension since PG13, so the database owner can create it without
-- being superuser.
CREATE EXTENSION IF NOT EXISTS citext;

-- --- Enums -----------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('owner', 'manager', 'member');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE user_status AS ENUM ('active', 'inactive');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE team_status AS ENUM ('active', 'deleted');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- --- organization ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS organization (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- --- team ------------------------------------------------------------------
-- manager_id FK is added at the bottom of this file: team.manager_id -> user.id
-- and user.team_id -> team.id are mutually circular, so one side must wait.
CREATE TABLE IF NOT EXISTS team (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT,
  manager_id  uuid NOT NULL,
  name        text NOT NULL,
  status      team_status NOT NULL DEFAULT 'active',
  deleted_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- --- user ------------------------------------------------------------------
-- One table for all three roles, discriminated by `role` (spec §4).
CREATE TABLE IF NOT EXISTS "user" (
  id                   uuid PRIMARY KEY,
  org_id               uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT,
  role                 user_role NOT NULL,
  name                 text NOT NULL,
  email                citext NOT NULL,

  -- Owners sign up with a password. Managers/Members are issued a single-use
  -- passcode and may set a password on first login, which clears passcode_*.
  password_hash        text,
  passcode_hash        text,
  passcode_expires_at  timestamptz,
  passcode_used_at     timestamptz,          -- non-null => consumed

  -- The tenant key. See the invariant CHECK below.
  manager_id           uuid REFERENCES "user" (id) ON DELETE RESTRICT,
  team_id              uuid REFERENCES team (id) ON DELETE SET NULL,

  role_title           text,
  workflow_step        integer,
  ranking              integer NOT NULL DEFAULT 50,
  is_reporter          boolean NOT NULL DEFAULT false,
  status               user_status NOT NULL DEFAULT 'active',
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  -- The manager_id self-reference is load-bearing: every tenant-scoped query
  -- and every RLS policy relies on it. Encoding it as a CHECK makes the
  -- invariant self-enforcing instead of a convention someone can forget.
  CONSTRAINT user_manager_id_invariant CHECK (
    (role = 'owner'   AND manager_id IS NULL) OR
    (role = 'manager' AND manager_id = id) OR
    (role = 'member'  AND manager_id IS NOT NULL AND manager_id <> id)
  ),
  CONSTRAINT user_ranking_range CHECK (ranking >= 0 AND ranking <= 100),
  -- A passcode cannot be marked used without ever having existed.
  CONSTRAINT user_passcode_coherent CHECK (
    passcode_used_at IS NULL OR passcode_hash IS NOT NULL
  )
);

-- --- refresh_token ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS refresh_token (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  token_hash  text NOT NULL,
  family_id   uuid NOT NULL,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- --- audit_log -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid REFERENCES organization (id) ON DELETE RESTRICT,
  actor_user_id  uuid REFERENCES "user" (id) ON DELETE SET NULL,
  action         text NOT NULL,
  target_type    text,
  target_id      uuid,
  metadata       jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- --- deferred circular FK: team.manager_id -> user.id ----------------------
DO $$ BEGIN
  ALTER TABLE team
    ADD CONSTRAINT team_manager_id_fkey
    FOREIGN KEY (manager_id) REFERENCES "user" (id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- --- indexes ---------------------------------------------------------------
CREATE INDEX IF NOT EXISTS user_org_id_idx      ON "user" (org_id);
CREATE INDEX IF NOT EXISTS user_manager_id_idx  ON "user" (manager_id);
CREATE INDEX IF NOT EXISTS user_team_id_idx     ON "user" (team_id);

-- Email is unique per organization, not globally. A global unique constraint
-- would reject a signup because the address exists in a different tenant,
-- leaking that another org has that user.
CREATE UNIQUE INDEX IF NOT EXISTS user_org_id_email_key ON "user" (org_id, email);

CREATE INDEX IF NOT EXISTS team_org_id_idx ON team (org_id);

-- One ACTIVE team per manager. Partial rather than plain unique: a
-- soft-deleted team must not block creating a replacement (spec §9.2).
CREATE UNIQUE INDEX IF NOT EXISTS team_manager_id_active_key
  ON team (manager_id) WHERE status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS refresh_token_hash_key      ON refresh_token (token_hash);
CREATE INDEX        IF NOT EXISTS refresh_token_user_id_idx   ON refresh_token (user_id);
CREATE INDEX        IF NOT EXISTS refresh_token_family_id_idx ON refresh_token (family_id);

CREATE INDEX IF NOT EXISTS audit_log_org_id_idx        ON audit_log (org_id);
CREATE INDEX IF NOT EXISTS audit_log_actor_user_id_idx ON audit_log (actor_user_id);
CREATE INDEX IF NOT EXISTS audit_log_created_at_idx    ON audit_log (created_at);
