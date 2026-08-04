import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { type CurrentUser, tenantContextOf, type UserRole } from '../db/tenant-context';

export interface MeResponse {
  id: string;
  orgId: string;
  organizationName: string;
  role: UserRole;
  name: string;
  email: string;
  managerId: string | null;
  teamId: string | null;
  roleTitle: string | null;
  workflowStep: number | null;
  ranking: number;
  isReporter: boolean;
}

@Injectable()
export class MeService {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  /**
   * Read the caller's own row through the tenant context.
   *
   * Note that this goes through withTenant even though the row belongs to the
   * caller and lookupById() could have returned it context-free. That is the
   * point: the definer lookups are a pre-auth exception, and using one here
   * would normalise reaching for them once a context is available. This is also
   * the only place in the request path where the ordinary RLS route is exercised
   * end-to-end, so if the tenant context were built wrongly, /me breaks loudly.
   */
  async getProfile(user: CurrentUser): Promise<MeResponse> {
    const row = await this.db.withTenant(tenantContextOf(user), async (c) => {
      const { rows } = await c.query<{
        id: string;
        org_id: string;
        organization_name: string;
        role: UserRole;
        name: string;
        email: string;
        manager_id: string | null;
        team_id: string | null;
        role_title: string | null;
        workflow_step: number | null;
        ranking: number;
        is_reporter: boolean;
      }>(
        `SELECT u.id, u.org_id, o.name AS organization_name, u.role, u.name, u.email,
                u.manager_id, u.team_id, u.role_title, u.workflow_step, u.ranking,
                u.is_reporter
         FROM "user" u
         JOIN organization o ON o.id = u.org_id
         WHERE u.id = $1`,
        [user.userId],
      );
      return rows[0];
    });

    // Unreachable in normal operation — JwtStrategy just confirmed this user is
    // active. Reaching it means the context derived from the row cannot see the
    // row, which is an isolation defect worth surfacing rather than papering over.
    if (!row) throw new NotFoundException('User not found.');

    return {
      id: row.id,
      orgId: row.org_id,
      organizationName: row.organization_name,
      role: row.role,
      name: row.name,
      email: row.email,
      managerId: row.manager_id,
      teamId: row.team_id,
      roleTitle: row.role_title,
      workflowStep: row.workflow_step,
      ranking: row.ranking,
      isReporter: row.is_reporter,
    };
  }
}
