-- 0009_rankings_and_reports.sql — Rankings & Reporter workflow (Phase 5)
--
-- Adds:
--   1. ranking_event — append-only history of member ranking changes with audit reasons
--   2. task_report — completion reports submitted by designated reporters
--
-- Both tables are tenant-scoped (org_id, manager_id) with ENABLE + FORCE ROW LEVEL SECURITY.

SET search_path = public, pg_temp;

-- Add ranking_changed to notification_type enum if not already present
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'ranking_changed';

-- ---------------------------------------------------------------------------
-- 1. ranking_event — append-only ranking audit history
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ranking_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  manager_id uuid NOT NULL,
  user_id uuid NOT NULL,
  old_ranking integer NOT NULL,
  new_ranking integer NOT NULL,
  changed_by_user_id uuid NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ranking_event_org_fk
    FOREIGN KEY (org_id) REFERENCES organization(id) ON DELETE RESTRICT,
  CONSTRAINT ranking_event_org_manager_fk
    FOREIGN KEY (org_id, manager_id) REFERENCES "user"(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT ranking_event_org_user_fk
    FOREIGN KEY (org_id, user_id) REFERENCES "user"(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT ranking_event_org_changer_fk
    FOREIGN KEY (org_id, changed_by_user_id) REFERENCES "user"(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT ranking_event_ranking_range
    CHECK (old_ranking >= 0 AND old_ranking <= 100 AND new_ranking >= 0 AND new_ranking <= 100),
  CONSTRAINT ranking_event_reason_non_empty
    CHECK (length(trim(reason)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_ranking_event_org_id ON ranking_event(org_id);
CREATE INDEX IF NOT EXISTS idx_ranking_event_manager_id ON ranking_event(manager_id);
CREATE INDEX IF NOT EXISTS idx_ranking_event_user_id ON ranking_event(user_id);
CREATE INDEX IF NOT EXISTS idx_ranking_event_created_at ON ranking_event(created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS ranking_event_org_id_id_key ON ranking_event(org_id, id);

-- ---------------------------------------------------------------------------
-- 2. task_report — completion reports written by reporters on completed tasks
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS task_report (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  manager_id uuid NOT NULL,
  task_id uuid NOT NULL,
  reported_by_user_id uuid NOT NULL,
  summary text NOT NULL,
  highlights text,
  blockers text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT task_report_org_fk
    FOREIGN KEY (org_id) REFERENCES organization(id) ON DELETE RESTRICT,
  CONSTRAINT task_report_org_manager_fk
    FOREIGN KEY (org_id, manager_id) REFERENCES "user"(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT task_report_org_task_fk
    FOREIGN KEY (org_id, task_id) REFERENCES task(org_id, id) ON DELETE CASCADE,
  CONSTRAINT task_report_org_reporter_fk
    FOREIGN KEY (org_id, reported_by_user_id) REFERENCES "user"(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT task_report_summary_non_empty
    CHECK (length(trim(summary)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_task_report_org_id ON task_report(org_id);
CREATE INDEX IF NOT EXISTS idx_task_report_manager_id ON task_report(manager_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_report_task_id ON task_report(task_id);
CREATE UNIQUE INDEX IF NOT EXISTS task_report_org_id_id_key ON task_report(org_id, id);

-- Ensure non-empty constraints exist if tables were previously created without them
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ranking_event_reason_non_empty'
  ) THEN
    ALTER TABLE ranking_event ADD CONSTRAINT ranking_event_reason_non_empty CHECK (length(trim(reason)) > 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'task_report_summary_non_empty'
  ) THEN
    ALTER TABLE task_report ADD CONSTRAINT task_report_summary_non_empty CHECK (length(trim(summary)) > 0);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Row-Level Security
-- ---------------------------------------------------------------------------
ALTER TABLE ranking_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE ranking_event FORCE ROW LEVEL SECURITY;

ALTER TABLE task_report ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_report FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ranking_event_tenant_isolation ON ranking_event;
CREATE POLICY ranking_event_tenant_isolation ON ranking_event
  FOR ALL
  USING (
    org_id = app_current_org_id()
    AND (app_current_role() = 'owner' OR manager_id = app_current_manager_id())
  );

DROP POLICY IF EXISTS task_report_tenant_isolation ON task_report;
CREATE POLICY task_report_tenant_isolation ON task_report
  FOR ALL
  USING (
    org_id = app_current_org_id()
    AND (app_current_role() = 'owner' OR manager_id = app_current_manager_id())
  );

-- ---------------------------------------------------------------------------
-- 4. Permissions
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT ON ranking_event TO relay_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON task_report TO relay_app;
