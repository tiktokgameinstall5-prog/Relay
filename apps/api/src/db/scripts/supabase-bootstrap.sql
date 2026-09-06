-- ===========================================================================
-- Supabase Bootstrap for Relay
-- Run this ONCE in your Supabase project's SQL Editor:
-- (Supabase Dashboard -> Project -> SQL Editor -> New Query -> Run)
--
-- Replace 'SET_YOUR_APP_PASSWORD_HERE' with a strong random password.
-- ===========================================================================

-- 1. Create the application runtime role (NOBYPASSRLS enforces Relay's tenant isolation)
DO $$ BEGIN
  CREATE ROLE relay_app WITH LOGIN PASSWORD 'SET_YOUR_APP_PASSWORD_HERE' NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
EXCEPTION WHEN duplicate_object THEN
  ALTER ROLE relay_app WITH PASSWORD 'SET_YOUR_APP_PASSWORD_HERE' NOBYPASSRLS;
END $$;

-- 2. Grant database connection and public schema access
GRANT CONNECT ON DATABASE postgres TO relay_app;
GRANT USAGE, CREATE ON SCHEMA public TO relay_app;

-- 3. Configure default privileges so tables created during migrations are accessible
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO relay_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO relay_app;

-- 4. Enable citext extension (required by Relay for case-insensitive email matching)
CREATE EXTENSION IF NOT EXISTS citext;
