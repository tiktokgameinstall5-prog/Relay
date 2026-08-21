-- ===========================================================================
-- 0005_tenant_fk_invariants.sql — composite foreign keys that pin every
--   cross-row tenant reference to a SINGLE organization
--
-- THE GAP THIS CLOSES  (finding F1 / "Sabotage-C")
--
-- The existing foreign keys check EXISTENCE, not org-consistency:
--
--   team_manager_id_fkey   team.manager_id -> "user"(id)   -- any user, any org
--   user_manager_id_fkey   "user".manager_id -> "user"(id) -- any user, any org
--   user_team_id_fkey      "user".team_id -> team(id)      -- any team, any org
--
-- And RLS does not fill the gap. An owner's WITH CHECK predicate on team/user
-- (0001_rls.sql) reduces to `org_id = app_current_org_id()` — the org_id is
-- pinned, but manager_id and team_id are left entirely unconstrained for an
-- owner. So an Owner (or any future bug on a create path) can commit:
--
--   * a team in THEIR org whose manager_id is ANOTHER org's user, or
--   * a member in THEIR org whose manager_id / team_id points into another org.
--
-- Such a row passes RLS (its own org_id is correct) and passes the existing FKs
-- (the referenced id does exist — just in the wrong tenant). It then sits in a
-- tenant slice it does not belong to. No query scoping downstream can undo a
-- row that is mis-attributed at write time. This migration makes the database
-- reject it.
--
-- THE MECHANISM
--
-- A composite FK to (org_id, id) forces the referenced row to share the
-- referencing row's org_id. Postgres requires the referenced column pair to
-- carry a UNIQUE (or PK) constraint, so we first add UNIQUE (org_id, id) to both
-- "user" and team. Those are logically redundant with the id primary key, but
-- mandatory as an FK target — Postgres will not reference an arbitrary column
-- pair, only a uniquely-constrained one.
--
-- THE LINCHPIN: REFERENTIAL-INTEGRITY CHECKS BYPASS RLS
--
-- This is what makes the FK work at all under FORCE ROW LEVEL SECURITY, and it
-- is the MIRROR IMAGE of the lesson recorded in 0002/0003:
--
--   0002/0003:  SECURITY DEFINER does NOT see through FORCE RLS — the policy is
--               evaluated for the table owner too, so a definer function with no
--               tenant context matches nothing.
--   here:       Referential-integrity checks (FK, UNIQUE, PK) ALWAYS bypass row
--               security — a documented Postgres guarantee. So even though the
--               inserting relay_app session cannot SEE another org's user/team
--               through RLS, the FK check still validates against ALL rows and
--               correctly rejects the cross-org reference.
--
-- The docs' "covert channel" caveat applies but leaks nothing new here: a failed
-- insert only tells the caller "that manager/team is not valid in your org",
-- which is exactly the 400 the service already returns. It does not reveal any
-- attribute of the other tenant's row.
--
-- WHY MATCH SIMPLE (the default), NEVER MATCH FULL
--
-- org_id is NOT NULL on both tables, but manager_id and team_id are nullable —
-- NULL manager_id is the NORMAL state for an owner, and NULL team_id for any
-- teamless user. Under MATCH SIMPLE, a partially-NULL key (org_id set, other
-- column NULL) skips the check — precisely what we want for owners/teamless
-- users. MATCH FULL would instead REJECT every owner and every teamless user,
-- because it forbids the mixed NULL/non-NULL case. Do not "tighten" these to
-- MATCH FULL.
--
-- WHY ADDITIVE, AND WHY ON DELETE NO ACTION
--
-- The existing single-column FKs are kept: they own the delete behaviour the
-- schema was designed and tested around (manager_id RESTRICT, team_id SET NULL).
-- Replacing them would mean dropping constraints by their auto-generated names,
-- with a silent no-op if a name were guessed wrong — an unacceptable risk for an
-- isolation invariant. The composite FKs therefore use ON DELETE NO ACTION:
--
--   * NO ACTION cannot be SET NULL here anyway — a composite SET NULL would try
--     to NULL org_id too, which is NOT NULL, and fail.
--   * NO ACTION is deferred to end-of-statement, so it coexists with the
--     existing user_team_id_fkey SET NULL: on a team delete, team_id is nulled
--     first, and the composite check then sees a NULL key and skips it (MATCH
--     SIMPLE) — no conflict.
--
-- VALIDATION
--
-- Plain validating ADD: existing rows are same-org by construction (every write
-- path sets org_id from the caller's own context), so validation passes. If a
-- pre-existing cross-org row somehow existed, failing the migration loudly is
-- the correct outcome for a security invariant. For a LARGE production table,
-- split each FK into `ADD CONSTRAINT ... NOT VALID` + a later
-- `VALIDATE CONSTRAINT` to avoid holding ACCESS EXCLUSIVE during the scan;
-- enforcement on new writes begins the moment the constraint exists either way.
--
-- STATUS
--
-- This is tenant-isolation logic. Per CLAUDE.md §12 it requires human review
-- before it is applied — do not run it unreviewed. Its DB-layer proof lives in
-- test/tenant-fk-invariants.e2e-spec.ts (gated behind RUN_0005_TESTS until this
-- migration is applied). Every statement is idempotent (DO / duplicate_object),
-- matching 0000_init.sql, so a manual re-run is a no-op.
-- ===========================================================================

-- --- FK targets: UNIQUE (org_id, id) --------------------------------------
-- Redundant with the id primary key, but a composite FK can only reference a
-- uniquely-constrained column pair. These are the targets for the FKs below.
DO $$ BEGIN
  ALTER TABLE "user" ADD CONSTRAINT user_org_id_id_key UNIQUE (org_id, id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE team ADD CONSTRAINT team_org_id_id_key UNIQUE (org_id, id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- --- team.(org_id, manager_id) -> "user".(org_id, id) ----------------------
-- A team's manager must be a user in the SAME org. manager_id is NOT NULL, so
-- this is always checked (the MATCH SIMPLE skip never applies to team).
DO $$ BEGIN
  ALTER TABLE team
    ADD CONSTRAINT team_org_id_manager_id_fkey
    FOREIGN KEY (org_id, manager_id) REFERENCES "user" (org_id, id)
    ON DELETE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- --- "user".(org_id, manager_id) -> "user".(org_id, id) --------------------
-- Self-referential: a member's manager must be a user in the same org. NULL for
-- owners (skipped, MATCH SIMPLE); manager_id = id for managers (satisfied by the
-- row itself). Complements user_manager_id_invariant, which fixes the SHAPE of
-- manager_id per role but not the ORG of the referenced manager.
DO $$ BEGIN
  ALTER TABLE "user"
    ADD CONSTRAINT user_org_id_manager_id_fkey
    FOREIGN KEY (org_id, manager_id) REFERENCES "user" (org_id, id)
    ON DELETE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- --- "user".(org_id, team_id) -> team.(org_id, id) -------------------------
-- A user's team must be in the same org. NULL team_id (teamless user) is skipped
-- (MATCH SIMPLE). NO ACTION rather than SET NULL: SET NULL would also null the
-- NOT NULL org_id; the existing user_team_id_fkey already handles nulling
-- team_id on a team delete, and this check then sees the NULL key and skips.
DO $$ BEGIN
  ALTER TABLE "user"
    ADD CONSTRAINT user_org_id_team_id_fkey
    FOREIGN KEY (org_id, team_id) REFERENCES team (org_id, id)
    ON DELETE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
