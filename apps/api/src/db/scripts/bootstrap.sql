-- ===========================================================================
-- bootstrap.sql — create the database and the two roles. Run ONCE per server,
-- as a superuser, before the first migration:
--
--   psql -h localhost -U postgres -d postgres \
--     -v migrator_password="'...'" -v app_password="'...'" \
--     -f apps/api/src/db/scripts/bootstrap.sql
--
-- This is deliberately NOT part of migrate.ts. Creating roles needs superuser,
-- and the migration runner connects as relay_migrator — which by design cannot
-- create roles. Keeping the privileged step separate means the routine path
-- (db:migrate) never needs superuser credentials.
--
-- Idempotent: safe to re-run. Re-running resets both role passwords, which is
-- also how you rotate them.
-- ===========================================================================

-- --- roles -----------------------------------------------------------------
-- relay_migrator owns the schema and runs DDL. Never used by the API.
DO $$ BEGIN
  CREATE ROLE relay_migrator LOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- relay_app is the runtime role. The attributes below are all defaults, but
-- they are spelled out because they are the security contract of this role:
-- no superuser, no DDL, no role creation, and -- critically -- NOBYPASSRLS.
-- A future ALTER that grants any of these silently disables tenant isolation.
ALTER ROLE relay_migrator NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS NOREPLICATION;

DO $$ BEGIN
  CREATE ROLE relay_app LOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER ROLE relay_app NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS NOREPLICATION;

ALTER ROLE relay_migrator PASSWORD :migrator_password;
ALTER ROLE relay_app      PASSWORD :app_password;

-- --- database --------------------------------------------------------------
-- Owned by the migrator so it can run DDL and create the citext extension
-- (trusted since PG13, so database owner is sufficient -- no superuser needed).
-- CREATE DATABASE cannot run inside a transaction or a DO block, and has no
-- IF NOT EXISTS, so \gexec conditionally executes it instead.
SELECT format('CREATE DATABASE relay OWNER relay_migrator')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'relay')
\gexec

-- Only our two roles may connect. Without this, every role on the server
-- (including any future one) inherits CONNECT from PUBLIC.
REVOKE ALL ON DATABASE relay FROM PUBLIC;
GRANT CONNECT ON DATABASE relay TO relay_migrator, relay_app;
