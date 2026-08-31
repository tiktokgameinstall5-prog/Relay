-- ===========================================================================
-- 0008_notifications.sql — In-app notifications & Scheduled tasks
-- Phase 4 of Relay Platform.
-- ===========================================================================

-- 1. Helper accessor for current user ID
CREATE OR REPLACE FUNCTION app_current_user_id() RETURNS uuid
  LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS
$$ SELECT nullif(current_setting('app.current_user_id', true), '')::uuid $$;

-- 2. Notification Type Enum
DO $$ BEGIN
  CREATE TYPE notification_type AS ENUM (
    'task_assigned',
    'step_activated',
    'task_completed',
    'task_scheduled_live',
    'reporter_prompt'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 3. Notification Table
CREATE TABLE IF NOT EXISTS notification (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organization(id),
  user_id uuid NOT NULL,
  manager_id uuid,
  type notification_type NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_user_fk
    FOREIGN KEY (org_id, user_id)
    REFERENCES "user"(org_id, id),
  CONSTRAINT notification_manager_fk
    FOREIGN KEY (org_id, manager_id)
    REFERENCES "user"(org_id, id)
);

-- Index for personal inboxes: recipient's unread / recent notifications
CREATE INDEX IF NOT EXISTS idx_notification_user_created
  ON notification(org_id, user_id, read_at, created_at DESC);

-- 4. Row-Level Security
ALTER TABLE notification ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification FORCE ROW LEVEL SECURITY;

-- Select: Personal inbox only (Owner sees ONLY their own notifications too)
DROP POLICY IF EXISTS notification_select_policy ON notification;
CREATE POLICY notification_select_policy ON notification
  FOR SELECT
  USING (
    org_id = app_current_org_id()
    AND user_id = app_current_user_id()
  );

-- Insert: Workflow and managers can create notifications for members in their slice / org
DROP POLICY IF EXISTS notification_insert_policy ON notification;
CREATE POLICY notification_insert_policy ON notification
  FOR INSERT
  WITH CHECK (
    org_id = app_current_org_id()
    AND (
      app_current_role() = 'owner'
      OR manager_id = app_current_manager_id()
      OR manager_id IS NULL
    )
  );

-- Update: Only the recipient can mark their notification as read
DROP POLICY IF EXISTS notification_update_policy ON notification;
CREATE POLICY notification_update_policy ON notification
  FOR UPDATE
  USING (
    org_id = app_current_org_id()
    AND user_id = app_current_user_id()
  )
  WITH CHECK (
    org_id = app_current_org_id()
    AND user_id = app_current_user_id()
  );

-- Delete: Only the recipient can dismiss/delete their notification
DROP POLICY IF EXISTS notification_delete_policy ON notification;
CREATE POLICY notification_delete_policy ON notification
  FOR DELETE
  USING (
    org_id = app_current_org_id()
    AND user_id = app_current_user_id()
  );

-- 5. Definer Lookup Policy on Task for the scheduler discovery function
-- (matching 0003_auth_lookup_policy.sql for SECURITY DEFINER)
DROP POLICY IF EXISTS task_definer_lookup ON task;
CREATE POLICY task_definer_lookup ON task
  FOR SELECT
  TO relay_migrator
  USING (true);

-- 6. Definer Function: Get Due Scheduled Tasks
DROP FUNCTION IF EXISTS get_due_scheduled_tasks(integer);
CREATE OR REPLACE FUNCTION get_due_scheduled_tasks(batch_limit integer DEFAULT 50)
RETURNS TABLE (
  id uuid,
  org_id uuid,
  manager_id uuid,
  created_by_user_id uuid,
  name text,
  scheduled_for timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT t.id, t.org_id, t.manager_id, t.created_by_user_id, t.name, t.scheduled_for
  FROM task t
  WHERE t.status = 'scheduled'
    AND t.scheduled_for <= now()
  ORDER BY t.scheduled_for ASC
  LIMIT batch_limit;
$$;

REVOKE ALL ON FUNCTION get_due_scheduled_tasks(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_due_scheduled_tasks(integer) TO relay_app;

-- Grant DML permissions on notification table to application role
GRANT SELECT, INSERT, UPDATE, DELETE ON notification TO relay_app;
