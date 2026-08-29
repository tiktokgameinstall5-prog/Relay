-- ===========================================================================
-- 0007_attachments.sql — Content Types & File/Video Attachments (Phase 3)
--
-- Implements task attachments for files and master videos (CLAUDE.md §3).
-- Files/videos are stored in object storage / local filesystem, while metadata,
-- checksums, and tenant references are stored in task_attachment.
--
-- STATUS — SENSITIVE (CLAUDE.md §12). Tenant-scoped table with FORCE ROW LEVEL
-- SECURITY, standard tenant predicate, and composite FK invariants.
-- ===========================================================================

-- --- task_attachment -------------------------------------------------------
CREATE TABLE IF NOT EXISTS task_attachment (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES organization (id) ON DELETE RESTRICT,
  manager_id          uuid NOT NULL REFERENCES "user" (id) ON DELETE RESTRICT,
  task_id             uuid NOT NULL REFERENCES task (id) ON DELETE CASCADE,
  uploaded_by_user_id uuid NOT NULL REFERENCES "user" (id) ON DELETE RESTRICT,
  file_name           text NOT NULL,
  file_size           bigint NOT NULL,
  mime_type           text NOT NULL,
  storage_key         text NOT NULL,
  checksum_sha256     text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- --- FK anchor: UNIQUE (org_id, id) ----------------------------------------
DO $$ BEGIN
  ALTER TABLE task_attachment ADD CONSTRAINT task_attachment_org_id_id_key UNIQUE (org_id, id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- --- composite FKs: pin every cross-row reference to ONE org ---------------
DO $$ BEGIN
  ALTER TABLE task_attachment
    ADD CONSTRAINT task_attachment_org_id_manager_id_fkey
    FOREIGN KEY (org_id, manager_id) REFERENCES "user" (org_id, id)
    ON DELETE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE task_attachment
    ADD CONSTRAINT task_attachment_org_id_task_id_fkey
    FOREIGN KEY (org_id, task_id) REFERENCES task (org_id, id)
    ON DELETE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE task_attachment
    ADD CONSTRAINT task_attachment_org_id_uploaded_by_user_id_fkey
    FOREIGN KEY (org_id, uploaded_by_user_id) REFERENCES "user" (org_id, id)
    ON DELETE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- --- indexes ---------------------------------------------------------------
CREATE INDEX IF NOT EXISTS task_attachment_org_id_idx              ON task_attachment (org_id);
CREATE INDEX IF NOT EXISTS task_attachment_manager_id_idx          ON task_attachment (manager_id);
CREATE INDEX IF NOT EXISTS task_attachment_task_id_idx             ON task_attachment (task_id);
CREATE INDEX IF NOT EXISTS task_attachment_uploaded_by_user_id_idx ON task_attachment (uploaded_by_user_id);

-- --- row-level security ----------------------------------------------------
ALTER TABLE task_attachment ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_attachment FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS task_attachment_tenant_isolation ON task_attachment;
CREATE POLICY task_attachment_tenant_isolation ON task_attachment
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
GRANT SELECT, INSERT, UPDATE, DELETE ON task_attachment TO relay_app;
