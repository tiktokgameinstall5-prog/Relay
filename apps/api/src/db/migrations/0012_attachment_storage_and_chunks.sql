-- ===========================================================================
-- 0012_attachment_storage_and_chunks.sql - Attachment Storage & Chunked Upload
--
-- Adds file_data bytea to task_attachment for resilient multi-instance storage
-- and task_attachment_chunk table for assembling chunked uploads up to 30MB.
-- ===========================================================================

-- 1. Add file_data bytea to task_attachment if not present
ALTER TABLE task_attachment ADD COLUMN IF NOT EXISTS file_data bytea;

-- 2. Chunk table for assembling uploads larger than serverless payload limits
CREATE TABLE IF NOT EXISTS task_attachment_chunk (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id uuid NOT NULL,
  chunk_index integer NOT NULL,
  data bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_attachment_chunk_upload ON task_attachment_chunk (upload_id, chunk_index);

GRANT SELECT, INSERT, UPDATE, DELETE ON task_attachment_chunk TO relay_app;
