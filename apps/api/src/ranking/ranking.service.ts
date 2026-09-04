import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DbService } from '../db/db.service';
import type { CurrentUser } from '../db/tenant-context';
import { NotificationService } from '../notifications/notification.service';
import type {
  LeaderboardUserDto,
  RankingEventResponseDto,
  SetReporterDto,
  UpdateRankingDto,
} from './dto/ranking.dto';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class RankingService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(NotificationService)
    private readonly notifications: NotificationService,
  ) {}

  /**
   * Leaderboard view scoped to caller's tenant slice:
   *   • Owner: All active members in the organization.
   *   • Manager: Active members on their managed team(s).
   *   • Member: Teammates on the same team.
   */
  async getLeaderboard(actor: CurrentUser): Promise<LeaderboardUserDto[]> {
    return await this.db.tx(async (c) => {
      let sql: string;
      const params: any[] = [];

      if (actor.role === 'owner') {
        sql = `
          SELECT u.id, u.name, u.email, u.role, u.ranking, u.is_reporter,
                 u.team_id, t.name AS team_name
            FROM "user" u
            LEFT JOIN team t ON t.id = u.team_id
           WHERE u.role = 'member'
             AND u.status = 'active'
           ORDER BY u.ranking DESC, u.name ASC, u.id ASC
        `;
      } else if (actor.role === 'manager') {
        sql = `
          SELECT u.id, u.name, u.email, u.role, u.ranking, u.is_reporter,
                 u.team_id, t.name AS team_name
            FROM "user" u
            LEFT JOIN team t ON t.id = u.team_id
           WHERE u.role = 'member'
             AND u.status = 'active'
             AND (u.team_id IN (SELECT id FROM team WHERE manager_id = $1) OR u.id = $1)
           ORDER BY u.ranking DESC, u.name ASC, u.id ASC
        `;
        params.push(actor.userId);
      } else {
        // Member: teammates on the caller's team
        sql = `
          SELECT u.id, u.name, u.email, u.role, u.ranking, u.is_reporter,
                 u.team_id, t.name AS team_name
            FROM "user" u
            LEFT JOIN team t ON t.id = u.team_id
           WHERE u.role = 'member'
             AND u.status = 'active'
             AND u.team_id = (SELECT team_id FROM "user" WHERE id = $1)
           ORDER BY u.ranking DESC, u.name ASC, u.id ASC
        `;
        params.push(actor.userId);
      }

      const { rows } = await c.query<{
        id: string;
        name: string;
        email: string;
        role: string;
        ranking: number;
        is_reporter: boolean;
        team_id: string | null;
        team_name: string | null;
      }>(sql, params);

      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        email: r.email,
        role: r.role,
        ranking: r.ranking,
        isReporter: r.is_reporter,
        teamId: r.team_id,
        teamName: r.team_name,
      }));
    });
  }

  /**
   * Update a member's ranking, append an audit event to ranking_event,
   * and emit an in-app notification.
   */
  async updateRanking(
    targetUserId: string,
    dto: UpdateRankingDto,
    actor: CurrentUser,
  ): Promise<LeaderboardUserDto> {
    if (actor.role !== 'owner' && actor.role !== 'manager') {
      throw new ForbiddenException(
        'Only owners and managers can update member rankings.',
      );
    }
    if (!UUID_RE.test(targetUserId)) {
      throw new NotFoundException('Member not found.');
    }

    return await this.db.tx(async (c) => {
      // 1. Anti-oracle check: target user must exist within caller's slice
      let userQuery: string;
      const userParams: any[] = [targetUserId];

      if (actor.role === 'owner') {
        userQuery = `
          SELECT u.id, u.org_id, u.name, u.email, u.role, u.ranking, u.is_reporter,
                 u.team_id, t.manager_id, t.name AS team_name
            FROM "user" u
            LEFT JOIN team t ON t.id = u.team_id
           WHERE u.id = $1 AND u.role = 'member'
        `;
      } else {
        userQuery = `
          SELECT u.id, u.org_id, u.name, u.email, u.role, u.ranking, u.is_reporter,
                 u.team_id, t.manager_id, t.name AS team_name
            FROM "user" u
            JOIN team t ON t.id = u.team_id
           WHERE u.id = $1 AND u.role = 'member' AND t.manager_id = $2
        `;
        userParams.push(actor.userId);
      }

      const { rows } = await c.query<{
        id: string;
        org_id: string;
        name: string;
        email: string;
        role: string;
        ranking: number;
        is_reporter: boolean;
        team_id: string | null;
        manager_id: string | null;
        team_name: string | null;
      }>(userQuery, userParams);

      const target = rows[0];
      if (!target) {
        throw new NotFoundException('Member not found.');
      }

      const oldRanking = target.ranking;
      const newRanking = dto.ranking;
      const effectiveManagerId = target.manager_id ?? actor.userId;

      // 2. Update user.ranking
      await c.query(
        'UPDATE "user" SET ranking = $1, updated_at = now() WHERE id = $2',
        [newRanking, targetUserId],
      );

      // 3. Append to ranking_event
      const eventId = randomUUID();
      await c.query(
        `INSERT INTO ranking_event (
           id, org_id, manager_id, user_id, old_ranking, new_ranking, changed_by_user_id, reason
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          eventId,
          target.org_id,
          effectiveManagerId,
          targetUserId,
          oldRanking,
          newRanking,
          actor.userId,
          dto.reason.trim(),
        ],
      );

      // 4. In-app notification to member
      await this.notifications.createNotifications(c, [
        {
          orgId: target.org_id,
          userId: targetUserId,
          managerId: effectiveManagerId,
          type: 'ranking_changed',
          title: 'Ranking updated',
          body: `Your ranking was updated to ${newRanking} (previously ${oldRanking}): ${dto.reason.trim()}`,
          data: {
            oldRanking,
            newRanking,
            reason: dto.reason.trim(),
            changedByUserId: actor.userId,
          },
        },
      ]);

      return {
        id: target.id,
        name: target.name,
        email: target.email,
        role: target.role,
        ranking: newRanking,
        isReporter: target.is_reporter,
        teamId: target.team_id,
        teamName: target.team_name,
      };
    });
  }

  /**
   * Retrieve audit history of ranking changes for a user.
   */
  async getRankingHistory(
    targetUserId: string,
    actor: CurrentUser,
  ): Promise<RankingEventResponseDto[]> {
    if (!UUID_RE.test(targetUserId)) {
      throw new NotFoundException('Member not found.');
    }

    return await this.db.tx(async (c) => {
      // Validate target user exists in slice
      let checkQuery: string;
      const checkParams: any[] = [targetUserId];

      if (actor.role === 'owner') {
        checkQuery = `SELECT id FROM "user" WHERE id = $1 AND role = 'member'`;
      } else if (actor.role === 'manager') {
        checkQuery = `
          SELECT u.id FROM "user" u
          JOIN team t ON t.id = u.team_id
          WHERE u.id = $1 AND u.role = 'member' AND t.manager_id = $2
        `;
        checkParams.push(actor.userId);
      } else {
        // Member can only view their own ranking audit history; teammates are outside slice (anti-oracle 404)
        if (targetUserId !== actor.userId) {
          throw new NotFoundException('Member not found.');
        }
        checkQuery = `SELECT id FROM "user" WHERE id = $1 AND role = 'member'`;
      }

      const check = await c.query(checkQuery, checkParams);
      if (check.rows.length === 0) {
        throw new NotFoundException('Member not found.');
      }

      const { rows } = await c.query<{
        id: string;
        user_id: string;
        old_ranking: number;
        new_ranking: number;
        changed_by_user_id: string;
        changed_by_name: string | null;
        reason: string;
        created_at: Date;
      }>(
        `SELECT e.id, e.user_id, e.old_ranking, e.new_ranking, e.changed_by_user_id,
                u.name AS changed_by_name, e.reason, e.created_at
           FROM ranking_event e
           LEFT JOIN "user" u ON u.id = e.changed_by_user_id
          WHERE e.user_id = $1
          ORDER BY e.created_at DESC`,
        [targetUserId],
      );

      return rows.map((r) => ({
        id: r.id,
        userId: r.user_id,
        oldRanking: r.old_ranking,
        newRanking: r.new_ranking,
        changedByUserId: r.changed_by_user_id,
        changedByName: r.changed_by_name ?? undefined,
        reason: r.reason,
        createdAt: r.created_at.toISOString(),
      }));
    });
  }

  /**
   * Set designated task completion reporter status for a member.
   */
  async setReporterStatus(
    targetUserId: string,
    dto: SetReporterDto,
    actor: CurrentUser,
  ): Promise<{ id: string; isReporter: boolean }> {
    if (actor.role !== 'owner' && actor.role !== 'manager') {
      throw new ForbiddenException(
        'Only owners and managers can assign reporter roles.',
      );
    }
    if (!UUID_RE.test(targetUserId)) {
      throw new NotFoundException('Member not found.');
    }

    return await this.db.tx(async (c) => {
      let checkQuery: string;
      const checkParams: any[] = [targetUserId];

      if (actor.role === 'owner') {
        checkQuery = `SELECT id FROM "user" WHERE id = $1 AND role = 'member'`;
      } else {
        checkQuery = `
          SELECT u.id FROM "user" u
          JOIN team t ON t.id = u.team_id
          WHERE u.id = $1 AND u.role = 'member' AND t.manager_id = $2
        `;
        checkParams.push(actor.userId);
      }

      const check = await c.query(checkQuery, checkParams);
      if (check.rows.length === 0) {
        throw new NotFoundException('Member not found.');
      }

      await c.query(
        'UPDATE "user" SET is_reporter = $1, updated_at = now() WHERE id = $2',
        [dto.isReporter, targetUserId],
      );

      return { id: targetUserId, isReporter: dto.isReporter };
    });
  }
}
