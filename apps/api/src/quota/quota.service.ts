import { Inject, Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';
import type { CurrentUser } from '../db/tenant-context';
import type { QuotaUsageDto } from './dto/quota.dto';

@Injectable()
export class QuotaService {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  async getQuotas(actor: CurrentUser): Promise<QuotaUsageDto> {
    return await this.db.tx(async (c) => {
      // 1. Teams count
      const teamsRes = await c.query<{ count: string }>(
        `SELECT count(*)::text as count FROM team WHERE org_id = $1 AND status = 'active'`,
        [actor.orgId],
      );
      const teamsCount = parseInt(teamsRes.rows[0]?.count ?? '0', 10);

      // 2. Members count
      const membersRes = await c.query<{ count: string }>(
        `SELECT count(*)::text as count FROM "user" WHERE org_id = $1 AND role = 'member' AND status = 'active'`,
        [actor.orgId],
      );
      const membersCount = parseInt(membersRes.rows[0]?.count ?? '0', 10);

      // 3. Active tasks count
      const tasksRes = await c.query<{ count: string }>(
        `SELECT count(*)::text as count FROM task WHERE org_id = $1 AND status IN ('scheduled', 'in_progress')`,
        [actor.orgId],
      );
      const activeTasksCount = parseInt(tasksRes.rows[0]?.count ?? '0', 10);

      return {
        teams: {
          current: teamsCount,
          limit: 20,
        },
        members: {
          current: membersCount,
          limit: 100,
        },
        activeTasks: {
          current: activeTasksCount,
          limit: 500,
        },
      };
    });
  }
}
