import { Inject, Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';
import type { CurrentUser } from '../db/tenant-context';
import type { AuditLogItemDto, AuditLogListResponseDto, AuditLogQueryDto } from './dto/audit.dto';

@Injectable()
export class AuditService {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  /**
   * Retrieves paginated audit log records for the organization.
   * Scoped strictly to the caller's tenant org_id and enforced by RLS (Owner-only).
   */
  async getAuditLogs(
    actor: CurrentUser,
    query: AuditLogQueryDto,
  ): Promise<AuditLogListResponseDto> {
    return await this.db.tx(async (c) => {
      const conditions: string[] = ['a.org_id = $1'];
      const params: any[] = [actor.orgId];
      let paramIdx = 2;

      if (query.action && query.action.trim()) {
        conditions.push(`a.action = $${paramIdx++}`);
        params.push(query.action.trim());
      }

      if (query.actorId) {
        conditions.push(`a.actor_user_id = $${paramIdx++}`);
        params.push(query.actorId);
      }

      if (query.startDate) {
        conditions.push(`a.created_at >= $${paramIdx++}::timestamptz`);
        params.push(query.startDate);
      }

      if (query.endDate) {
        conditions.push(`a.created_at <= $${paramIdx++}::timestamptz`);
        params.push(query.endDate);
      }

      const whereClause = conditions.join(' AND ');

      // Total count
      const countRes = await c.query<{ total: string }>(
        `SELECT count(*)::text as total FROM audit_log a WHERE ${whereClause}`,
        params,
      );
      const total = parseInt(countRes.rows[0]?.total ?? '0', 10);

      // Pagination
      const page = query.page && query.page > 0 ? query.page : 1;
      const limit = query.limit && query.limit > 0 ? query.limit : 20;
      const offset = (page - 1) * limit;

      const listParams = [...params, limit, offset];
      const itemsRes = await c.query<{
        id: string;
        org_id: string;
        actor_user_id: string | null;
        actor_name: string | null;
        action: string;
        target_type: string | null;
        target_id: string | null;
        metadata: Record<string, unknown> | null;
        created_at: Date;
      }>(
        `SELECT a.id, a.org_id, a.actor_user_id, u.name as actor_name,
                a.action, a.target_type, a.target_id, a.metadata, a.created_at
           FROM audit_log a
           LEFT JOIN "user" u ON u.id = a.actor_user_id
          WHERE ${whereClause}
          ORDER BY a.created_at DESC
          LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
        listParams,
      );

      const items: AuditLogItemDto[] = itemsRes.rows.map((row) => ({
        id: row.id,
        orgId: row.org_id,
        userId: row.actor_user_id,
        userName: row.actor_name,
        action: row.action,
        entityType: row.target_type,
        entityId: row.target_id,
        metadata: row.metadata,
        ipAddress: (row.metadata?.ipAddress as string) || null,
        createdAt: row.created_at.toISOString(),
      }));

      return {
        items,
        total,
        page,
        limit,
      };
    });
  }
}
