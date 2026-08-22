import { Inject, Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';

/**
 * Read side of the directory — the list endpoints the dashboards read back
 * (teams, managers, a team's roster). The counterpart to the create routes on
 * AuthController / ManagerController / TeamController.
 *
 * Modeled on MeService (me.service.ts:40-85), and it shares that file's three
 * rules on purpose, because they are what keep a read safe:
 *   1. Ambient context via db.tx() — never withTenant(...). The caller's tenant
 *      slice is already on the request (TenantContextInterceptor), and every
 *      query below is scoped by RLS, not by a WHERE the service could forget.
 *      One query serves both roles: RLS narrows a Manager to their own team and
 *      widens an Owner to the whole org, with no role branch in the SQL.
 *   2. An explicit snake→camel whitelist map, never `return row` / spread. A
 *      column added to the table later cannot leak by default — it has to be
 *      named here to appear in a response.
 *   3. No writeAudit. Reads are not audited (MeService does not either); an
 *      audit INSERT here would also need the SAVEPOINT dance the write paths use.
 */
export interface TeamListRow {
  id: string;
  name: string;
  managerId: string;
  managerName: string;
  managerEmail: string;
  /** Active members on the team, NOT counting the manager (see the SQL note). */
  memberCount: number;
  /** Active members whose invite is unactivated (password_hash IS NULL). */
  pendingInviteCount: number;
  createdAt: Date;
}

@Injectable()
export class DirectoryService {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  /**
   * Teams in the caller's slice. Owner → every team in the org; Manager → their
   * own team only. RLS does the scoping; the query is identical for both.
   *
   * Two predicates are load-bearing, not cosmetic:
   *   • `WHERE t.status = 'active'` — the team RLS policy has NO status term, so
   *     a soft-deleted team is still visible to RLS. Without this filter a
   *     deleted team would appear in the list. Asserted in the §11 gate.
   *   • `u.role = 'member'` inside the count FILTER — createTeam sets the
   *     manager's own `user.team_id` to their team (auth.service.ts), so a plain
   *     `team_id = t.id` count would include the manager and inflate every team
   *     by one. Asserted (teamA → 2, not 3).
   *
   * COUNT() returns a bigint, which node-pg surfaces as a string over the wire —
   * hence the `string` row type and `Number(...)` in the map.
   */
  async listTeams(): Promise<TeamListRow[]> {
    const rows = await this.db.tx(async (c) => {
      const result = await c.query<{
        id: string;
        name: string;
        manager_id: string;
        manager_name: string;
        manager_email: string;
        member_count: string;
        pending_invite_count: string;
        created_at: Date;
      }>(
        `SELECT t.id, t.name, t.manager_id,
                m.name AS manager_name, m.email AS manager_email, t.created_at,
                COUNT(u.id) FILTER (
                  WHERE u.role = 'member' AND u.status = 'active'
                ) AS member_count,
                COUNT(u.id) FILTER (
                  WHERE u.role = 'member' AND u.status = 'active'
                        AND u.password_hash IS NULL
                ) AS pending_invite_count
           FROM team t
           JOIN "user" m ON m.id = t.manager_id
           LEFT JOIN "user" u ON u.team_id = t.id
          WHERE t.status = 'active'
          GROUP BY t.id, t.name, t.manager_id, m.name, m.email, t.created_at
          ORDER BY t.name ASC, t.id ASC`,
      );
      return result.rows;
    });

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      managerId: r.manager_id,
      managerName: r.manager_name,
      managerEmail: r.manager_email,
      memberCount: Number(r.member_count),
      pendingInviteCount: Number(r.pending_invite_count),
      createdAt: r.created_at,
    }));
  }
}
