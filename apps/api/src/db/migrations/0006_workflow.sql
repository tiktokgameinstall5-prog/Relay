-- ===========================================================================
-- 0006_workflow.sql — the Workflow Engine schema: task + task_step (Phase 2)
--
-- The core of the product (CLAUDE.md §2): a task assigned to a team is split
-- into an ordered chain of `task_step`s, one per member, exactly one `active`
-- at a time. The active step's assignee is "who currently holds the task" — the
-- live indicator §2 requires and the relay chain §9 draws.
--
-- HAND-WRITTEN, like every migration here (see 0000's header). Run in filename
-- order by migrate.ts; every statement is idempotent so a re-run is a no-op.
-- Applied migrations are checksum-immutable — never edit this file once applied,
-- add a new numbered one.
--
-- STATUS — SENSITIVE (CLAUDE.md §12). This file adds two tenant-scoped tables,
-- their RLS policies, and the composite-FK org-consistency invariants that keep
-- a task/step from being mis-attributed across tenants at write time. It is
-- tenant-isolation logic and requires the Owner's human review before merge, in
-- addition to the §11 isolation tests (test/workflow-rls.e2e-spec.ts). Mirrors
-- 0000 (style), 0001 (RLS predicate), and 0005 (composite-FK invariants) exactly
-- so the tested path and the shipped path cannot drift.
-- ===========================================================================

-- --- Enums -----------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE task_type AS ENUM ('text', 'video', 'file');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 'scheduled' is a task whose scheduled_for is in the future: it stays off the
-- active board until the Phase 4 cron flips it to 'in_progress'. In Phase 2 the
-- service creates immediate tasks as 'in_progress'; the enum value exists now so
-- the column's domain is stable across phases.
DO $$ BEGIN
  CREATE TYPE task_status AS ENUM ('scheduled', 'in_progress', 'completed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE task_step_status AS ENUM ('pending', 'active', 'completed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- --- task ------------------------------------------------------------------
-- org_id + manager_id are the tenant keys, IDENTICAL in meaning to team.manager_id
-- (0000): the owning manager's id, so the ONE uniform RLS predicate from 0001
-- serves every role with no CASE. For a Manager→team relay that is the manager
-- themselves; for the Owner→Manager path (Phase 2b) it is the target manager.
CREATE TABLE IF NOT EXISTS task (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT,
  manager_id          uuid NOT NULL REFERENCES "user" (id) ON DELETE RESTRICT,
  -- Nullable: a task is normally bound to a team, but the schema does not force
  -- one (the Owner→member direct hand-off in a later cut has no team). MATCH
  -- SIMPLE on the composite FK below skips the org-check when this is NULL.
  team_id             uuid REFERENCES team (id) ON DELETE RESTRICT,
  name                text NOT NULL,
  type                task_type NOT NULL,
  description         text,
  -- Attribution is kept forever (§5: users soft-delete, never hard-delete), so
  -- RESTRICT here is belt-and-braces — the FK never actually fires.
  created_by_user_id  uuid NOT NULL REFERENCES "user" (id) ON DELETE RESTRICT,
  -- Up to 365 days ahead (§2). The activation cron is Phase 4; a NULL means "now".
  scheduled_for       timestamptz,
  status              task_status NOT NULL DEFAULT 'in_progress',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- --- task_step -------------------------------------------------------------
-- One row per member in the relay, ordered by step_order. manager_id is copied
-- from the parent task so a step carries its own tenant key and the RLS policy
-- needs no join to task. assigned_user_id is the member holding this step.
CREATE TABLE IF NOT EXISTS task_step (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT,
  manager_id       uuid NOT NULL REFERENCES "user" (id) ON DELETE RESTRICT,
  -- The step is wholly owned by its task: a (hypothetical) task delete takes its
  -- steps with it. CASCADE (single-col) coexists with the NO ACTION composite FK
  -- below exactly as user.team_id's SET NULL does in 0005 — the child row is gone
  -- before the deferred NO ACTION check runs, so there is nothing left to violate.
  task_id          uuid NOT NULL REFERENCES task (id) ON DELETE CASCADE,
  assigned_user_id uuid NOT NULL REFERENCES "user" (id) ON DELETE RESTRICT,
  step_order       integer NOT NULL,
  status           task_step_status NOT NULL DEFAULT 'pending',
  started_at       timestamptz,   -- stamped when the step goes 'active'
  completed_at     timestamptz,   -- stamped when it is forwarded/completed
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  -- No two steps share an order within a task.
  CONSTRAINT task_step_task_id_step_order_key UNIQUE (task_id, step_order)
);

-- --- FK anchors: UNIQUE (org_id, id) ---------------------------------------
-- Redundant with the id primary key, but a composite FK can only reference a
-- uniquely-constrained column pair (see 0005). `task` MUST have one — task_step's
-- composite FK targets it. task_step's is additive future-proofing so a later
-- phase (reports/rankings referencing a step) can pin org without a new anchor.
DO $$ BEGIN
  ALTER TABLE task ADD CONSTRAINT task_org_id_id_key UNIQUE (org_id, id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE task_step ADD CONSTRAINT task_step_org_id_id_key UNIQUE (org_id, id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- --- composite FKs: pin every cross-row reference to ONE org ---------------
-- The single-column FKs above check EXISTENCE, not org-consistency, and RLS does
-- not fill the gap (an owner's WITH CHECK reduces to org_id = current, leaving
-- manager_id/team_id/created_by unconstrained). These composite FKs to (org_id, id)
-- force each referenced row to share this row's org. They work under FORCE RLS
-- because referential-integrity checks bypass row security — the same guarantee
-- 0005 leans on. MATCH SIMPLE (the default) skips the check when team_id is NULL;
-- NEVER MATCH FULL (it would reject every teamless task). ON DELETE NO ACTION for
-- the reasons 0005 documents at length. See that file's header before touching.
DO $$ BEGIN
  ALTER TABLE task
    ADD CONSTRAINT task_org_id_manager_id_fkey
    FOREIGN KEY (org_id, manager_id) REFERENCES "user" (org_id, id)
    ON DELETE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE task
    ADD CONSTRAINT task_org_id_created_by_user_id_fkey
    FOREIGN KEY (org_id, created_by_user_id) REFERENCES "user" (org_id, id)
    ON DELETE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE task
    ADD CONSTRAINT task_org_id_team_id_fkey
    FOREIGN KEY (org_id, team_id) REFERENCES team (org_id, id)
    ON DELETE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE task_step
    ADD CONSTRAINT task_step_org_id_task_id_fkey
    FOREIGN KEY (org_id, task_id) REFERENCES task (org_id, id)
    ON DELETE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE task_step
    ADD CONSTRAINT task_step_org_id_assigned_user_id_fkey
    FOREIGN KEY (org_id, assigned_user_id) REFERENCES "user" (org_id, id)
    ON DELETE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE task_step
    ADD CONSTRAINT task_step_org_id_manager_id_fkey
    FOREIGN KEY (org_id, manager_id) REFERENCES "user" (org_id, id)
    ON DELETE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- --- indexes ---------------------------------------------------------------
CREATE INDEX IF NOT EXISTS task_org_id_idx     ON task (org_id);
CREATE INDEX IF NOT EXISTS task_manager_id_idx ON task (manager_id);
CREATE INDEX IF NOT EXISTS task_team_id_idx    ON task (team_id);
CREATE INDEX IF NOT EXISTS task_status_idx     ON task (status);

CREATE INDEX IF NOT EXISTS task_step_task_id_idx          ON task_step (task_id);
CREATE INDEX IF NOT EXISTS task_step_assigned_user_id_idx ON task_step (assigned_user_id);
CREATE INDEX IF NOT EXISTS task_step_manager_id_idx       ON task_step (manager_id);

-- Exactly one active step per task (§2: "Exactly one step is active at a time").
-- Partial unique, enforced BELOW RLS — the last-line backstop against a
-- double-forward that the write-auth WHERE clause and row lock already prevent
-- at the application layer. A concurrent second activation raises 23505.
CREATE UNIQUE INDEX IF NOT EXISTS task_step_active_key
  ON task_step (task_id) WHERE status = 'active';

-- --- row-level security ----------------------------------------------------
-- Both ENABLE and FORCE, and the SAME predicate as "user"/team in 0001 — no
-- member branch (a member's manager_id equals their manager's, so their read
-- slice is the whole team; that is the relay/leaderboard read contract §4/§9).
--
-- CONSEQUENCE, AND THE PHASE 2 WRITE-AUTH RULE: because that predicate gives a
-- member the same write-slice as their manager, RLS canNOT authorize a member's
-- forward — every teammate's step passes USING. Write authorization therefore
-- lives in the UPDATE's WHERE clause (assigned_user_id = $me AND status='active')
-- inside workflow.service.ts, NOT here and NOT in a guard. Do not add a member
-- branch to this policy to "fix" that — it would break the read contract without
-- making the write safe. See PROGRESS.md "write-authorization constraint".
ALTER TABLE task      ENABLE ROW LEVEL SECURITY;
ALTER TABLE task      FORCE  ROW LEVEL SECURITY;
ALTER TABLE task_step ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_step FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS task_tenant_isolation ON task;
CREATE POLICY task_tenant_isolation ON task
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

DROP POLICY IF EXISTS task_step_tenant_isolation ON task_step;
CREATE POLICY task_step_tenant_isolation ON task_step
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

-- --- grants ----------------------------------------------------------------
-- Runtime role gets SELECT/INSERT/UPDATE only. No DELETE: a task's lifecycle is
-- status-based (§2), and the product-wide default is soft-delete, never a hard
-- DELETE (§5). Withholding the grant makes an accidental hard-delete impossible
-- at the privilege layer, independent of any policy.
GRANT SELECT, INSERT, UPDATE ON task, task_step TO relay_app;
