import { Inject, Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';
import type { CurrentUser } from '../db/tenant-context';
import type { AnalyticsOverviewDto, BottlenecksResponseDto } from './dto/analytics.dto';

@Injectable()
export class AnalyticsService {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  /**
   * Aggregate operational overview metrics for caller's slice.
   */
  async getOverview(actor: CurrentUser): Promise<AnalyticsOverviewDto> {
    return await this.db.tx(async (c) => {
      // 1. Task metrics
      let taskSql: string;
      const taskParams: any[] = [];

      if (actor.role === 'owner') {
        taskSql = `
          SELECT count(*)::int AS total,
                 count(*) FILTER (WHERE status = 'completed')::int AS completed,
                 count(*) FILTER (WHERE status = 'in_progress')::int AS in_progress,
                 count(*) FILTER (WHERE status = 'scheduled')::int AS scheduled
            FROM task
        `;
      } else if (actor.role === 'manager') {
        taskSql = `
          SELECT count(*)::int AS total,
                 count(*) FILTER (WHERE status = 'completed')::int AS completed,
                 count(*) FILTER (WHERE status = 'in_progress')::int AS in_progress,
                 count(*) FILTER (WHERE status = 'scheduled')::int AS scheduled
            FROM task
           WHERE manager_id = $1
        `;
        taskParams.push(actor.userId);
      } else {
        taskSql = `
          SELECT count(*)::int AS total,
                 count(*) FILTER (WHERE status = 'completed')::int AS completed,
                 count(*) FILTER (WHERE status = 'in_progress')::int AS in_progress,
                 count(*) FILTER (WHERE status = 'scheduled')::int AS scheduled
            FROM task
           WHERE team_id = (SELECT team_id FROM "user" WHERE id = $1)
        `;
        taskParams.push(actor.userId);
      }

      const taskRes = await c.query<{
        total: number;
        completed: number;
        inProgress: number;
        scheduled: number;
      }>(taskSql, taskParams);

      const tStats = taskRes.rows[0] ?? {
        total: 0,
        completed: 0,
        inProgress: 0,
        scheduled: 0,
      };

      const total = Number(tStats.total);
      const completed = Number(tStats.completed);
      const inProgress = Number(tStats.inProgress);
      const scheduled = Number(tStats.scheduled);
      const completionRate =
        total > 0 ? Math.round((completed / total) * 1000) / 10 : 0;

      // 2. Ranking & Performer metrics
      let memberSql: string;
      const memberParams: any[] = [];

      if (actor.role === 'owner') {
        memberSql = `
          SELECT avg(ranking)::float AS avg_ranking,
                 (SELECT name FROM "user" WHERE role = 'member' AND status = 'active' ORDER BY ranking DESC, name ASC LIMIT 1) AS top_name,
                 (SELECT ranking FROM "user" WHERE role = 'member' AND status = 'active' ORDER BY ranking DESC, name ASC LIMIT 1) AS top_score
            FROM "user"
           WHERE role = 'member' AND status = 'active'
        `;
      } else if (actor.role === 'manager') {
        memberSql = `
          SELECT avg(u.ranking)::float AS avg_ranking,
                 (SELECT u2.name FROM "user" u2 JOIN team t2 ON t2.id = u2.team_id WHERE u2.role = 'member' AND u2.status = 'active' AND t2.manager_id = $1 ORDER BY u2.ranking DESC, u2.name ASC LIMIT 1) AS top_name,
                 (SELECT u2.ranking FROM "user" u2 JOIN team t2 ON t2.id = u2.team_id WHERE u2.role = 'member' AND u2.status = 'active' AND t2.manager_id = $1 ORDER BY u2.ranking DESC, u2.name ASC LIMIT 1) AS top_score
            FROM "user" u
            JOIN team t ON t.id = u.team_id
           WHERE u.role = 'member' AND u.status = 'active' AND t.manager_id = $1
        `;
        memberParams.push(actor.userId);
      } else {
        memberSql = `
          SELECT avg(u.ranking)::float AS avg_ranking,
                 (SELECT u2.name FROM "user" u2 WHERE u2.role = 'member' AND u2.status = 'active' AND u2.team_id = (SELECT team_id FROM "user" WHERE id = $1) ORDER BY u2.ranking DESC, u2.name ASC LIMIT 1) AS top_name,
                 (SELECT u2.ranking FROM "user" u2 WHERE u2.role = 'member' AND u2.status = 'active' AND u2.team_id = (SELECT team_id FROM "user" WHERE id = $1) ORDER BY u2.ranking DESC, u2.name ASC LIMIT 1) AS top_score
            FROM "user" u
           WHERE u.role = 'member' AND u.status = 'active' AND u.team_id = (SELECT team_id FROM "user" WHERE id = $1)
        `;
        memberParams.push(actor.userId);
      }

      const memberRes = await c.query<{
        avg_ranking: number | null;
        top_name: string | null;
        top_score: number | null;
      }>(memberSql, memberParams);

      const mStats = memberRes.rows[0];
      const avgRanking = mStats?.avg_ranking
        ? Math.round(Number(mStats.avg_ranking) * 10) / 10
        : 0;

      const membersCountRes = await c.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM "user" WHERE role = 'member' AND status = 'active'`,
      );
      const membersCount = Number(membersCountRes.rows[0]?.count ?? 0);

      return {
        tasks: {
          total,
          completed,
          inProgress,
          scheduled,
          completionRate,
        },
        rankings: {
          averageRanking: avgRanking,
          topPerformer: mStats?.top_name
            ? {
                name: mStats.top_name,
                score: Number(mStats.top_score ?? 0),
              }
            : null,
        },
        membersCount,
        totalTasks: total,
        completedTasks: completed,
        inProgressTasks: inProgress,
        scheduledTasks: scheduled,
        completionRate,
        averageRanking: avgRanking,
        topPerformerName: mStats?.top_name ?? undefined,
        topPerformerScore: mStats?.top_score ?? undefined,
      };
    });
  }

  /**
   * Identifies completed task steps with above-average duration.
   */
  async getBottlenecks(actor: CurrentUser): Promise<BottlenecksResponseDto> {
    return await this.db.tx(async (c) => {
      let stepSql = `
        SELECT ts.id AS step_id,
               ts.task_id,
               t.name AS task_name,
               ts.step_order,
               u.name AS member_name,
               EXTRACT(EPOCH FROM (ts.completed_at - ts.started_at))::int AS duration_seconds
          FROM task_step ts
          JOIN task t ON t.id = ts.task_id
          JOIN "user" u ON u.id = ts.assigned_user_id
         WHERE ts.status = 'completed'
           AND ts.completed_at IS NOT NULL
           AND ts.started_at IS NOT NULL
      `;
      const params: any[] = [];

      if (actor.role === 'manager') {
        stepSql += ` AND t.manager_id = $1`;
        params.push(actor.userId);
      } else if (actor.role === 'member') {
        stepSql += ` AND t.team_id = (SELECT team_id FROM "user" WHERE id = $1)`;
        params.push(actor.userId);
      }

      stepSql += ` ORDER BY duration_seconds DESC LIMIT 20`;

      const res = await c.query<{
        step_id: string;
        task_id: string;
        task_name: string;
        step_order: number;
        member_name: string;
        duration_seconds: number;
      }>(stepSql, params);

      if (res.rows.length === 0) {
        return {
          bottlenecks: [],
          averageStepDurationSeconds: 0,
        };
      }

      const totalSec = res.rows.reduce((sum, r) => sum + Number(r.duration_seconds), 0);
      const avgSec = Math.round(totalSec / res.rows.length);

      const bottlenecks = res.rows
        .filter((r) => Number(r.duration_seconds) >= avgSec)
        .map((r) => {
          const sec = Number(r.duration_seconds);
          const mins = Math.floor(sec / 60);
          const remSec = sec % 60;
          const formatted = mins > 0 ? `${mins}m ${remSec}s` : `${sec}s`;
          return {
            stepId: r.step_id,
            taskId: r.task_id,
            taskName: r.task_name,
            stepOrder: Number(r.step_order),
            memberName: r.member_name,
            durationSeconds: sec,
            durationFormatted: formatted,
          };
        });

      return {
        bottlenecks,
        averageStepDurationSeconds: avgSec,
      };
    });
  }
}
