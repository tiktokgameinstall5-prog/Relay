-- 0011_ranking_event_member_isolation.sql — Defense-in-depth: branch ranking_event RLS by role
--
-- Tightens ranking_event_tenant_isolation:
--   Owners: full org visibility
--   Managers: full team visibility (manager_id = app_current_manager_id())
--   Members: strictly own ranking audit events (user_id = app_current_user_id())
--
-- This guarantees at the database engine level that a Member session cannot read
-- a teammate's ranking change history (reasons, old/new values, changed_by) via raw SQL,
-- complementing the application-level anti-oracle 404 guard in RankingService.

SET search_path = public, pg_temp;

DROP POLICY IF EXISTS ranking_event_tenant_isolation ON ranking_event;
CREATE POLICY ranking_event_tenant_isolation ON ranking_event
  FOR ALL
  USING (
    org_id = app_current_org_id()
    AND (
      app_current_role() = 'owner'
      OR (app_current_role() = 'manager' AND manager_id = app_current_manager_id())
      OR (app_current_role() = 'member' AND user_id = app_current_user_id())
    )
  );
