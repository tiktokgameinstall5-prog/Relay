-- ===========================================================================
-- 0013_user_owner_read_policy.sql — allow users to read owner in same org
--
-- Allows managers and members within an organization to see the organization's
-- owner row (name, email) so task attribution, relay steps, and owner-assigned
-- tasks resolve without being filtered out by RLS.
-- ===========================================================================

DROP POLICY IF EXISTS user_tenant_isolation ON "user";
CREATE POLICY user_tenant_isolation ON "user"
  FOR ALL
  USING (
    org_id = app_current_org_id()
    AND (
      app_current_role() = 'owner'
      OR manager_id = app_current_manager_id()
      OR role = 'owner'
    )
  )
  WITH CHECK (
    org_id = app_current_org_id()
    AND (
      app_current_role() = 'owner'
      OR manager_id = app_current_manager_id()
    )
  );
