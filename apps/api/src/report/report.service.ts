import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DbService } from '../db/db.service';
import type { CurrentUser } from '../db/tenant-context';
import type {
  CreateTaskReportDto,
  TaskReportResponseDto,
} from './dto/report.dto';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class ReportService {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  /**
   * Submit a task completion report.
   * Role-gated: Owners, Managers, or Members with `is_reporter === true`.
   */
  async createReport(
    taskId: string,
    dto: CreateTaskReportDto,
    actor: CurrentUser,
  ): Promise<TaskReportResponseDto> {
    if (!UUID_RE.test(taskId)) {
      throw new NotFoundException('Task not found.');
    }

    return await this.db.tx(async (c) => {
      // 1. Role-Gated Reporter Authorization
      if (actor.role === 'member') {
        const userRes = await c.query<{ is_reporter: boolean }>(
          'SELECT is_reporter FROM "user" WHERE id = $1',
          [actor.userId],
        );
        if (!userRes.rows[0]?.is_reporter) {
          throw new ForbiddenException(
            'Only designated reporters, managers, or owners can submit task reports.',
          );
        }
      }

      // 2. Anti-Oracle & Task Scoping Check
      let taskSql: string;
      const taskParams: any[] = [taskId];

      if (actor.role === 'owner') {
        taskSql = `SELECT id, org_id, manager_id, name, status FROM task WHERE id = $1`;
      } else if (actor.role === 'manager') {
        taskSql = `SELECT id, org_id, manager_id, name, status FROM task WHERE id = $1 AND manager_id = $2`;
        taskParams.push(actor.userId);
      } else {
        taskSql = `
          SELECT t.id, t.org_id, t.manager_id, t.name, t.status
            FROM task t
           WHERE t.id = $1
             AND t.team_id = (SELECT team_id FROM "user" WHERE id = $2)
        `;
        taskParams.push(actor.userId);
      }

      const taskRes = await c.query<{
        id: string;
        org_id: string;
        manager_id: string;
        name: string;
        status: string;
      }>(taskSql, taskParams);

      const task = taskRes.rows[0];
      if (!task) {
        throw new NotFoundException('Task not found.');
      }

      // 3. Lifecycle Precondition: Completed tasks only
      if (task.status !== 'completed') {
        throw new BadRequestException(
          'Cannot submit report for incomplete task.',
        );
      }

      // 4. Duplicate Check
      const existing = await c.query<{ id: string }>(
        'SELECT id FROM task_report WHERE task_id = $1',
        [taskId],
      );
      if (existing.rows.length > 0) {
        throw new ConflictException('Report already exists for this task.');
      }

      // 5. Insert Report
      const reportId = randomUUID();
      const insertSql = `
        INSERT INTO task_report (
          id, org_id, manager_id, task_id, reported_by_user_id, summary, highlights, blockers, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id, task_id, reported_by_user_id, summary, highlights, blockers, metadata, created_at, updated_at
      `;
      const { rows } = await c.query<{
        id: string;
        task_id: string;
        reported_by_user_id: string;
        summary: string;
        highlights: string | null;
        blockers: string | null;
        metadata: Record<string, unknown> | null;
        created_at: Date;
        updated_at: Date;
      }>(insertSql, [
        reportId,
        task.org_id,
        task.manager_id,
        taskId,
        actor.userId,
        dto.summary.trim(),
        dto.highlights?.trim() || null,
        dto.blockers?.trim() || null,
        dto.metadata ? JSON.stringify(dto.metadata) : null,
      ]);

      const rep = rows[0]!;

      // Fetch reporter name
      const author = await c.query<{ name: string }>(
        'SELECT name FROM "user" WHERE id = $1',
        [actor.userId],
      );

      return {
        id: rep.id,
        taskId: rep.task_id,
        taskName: task.name,
        reportedByUserId: rep.reported_by_user_id,
        reportedByName: author.rows[0]?.name,
        summary: rep.summary,
        highlights: rep.highlights ?? undefined,
        blockers: rep.blockers ?? undefined,
        metadata: rep.metadata ?? undefined,
        createdAt: rep.created_at.toISOString(),
        updatedAt: rep.updated_at.toISOString(),
      };
    });
  }

  /**
   * Retrieve report for a specific task.
   */
  async getReportByTaskId(
    taskId: string,
    actor: CurrentUser,
  ): Promise<TaskReportResponseDto> {
    if (!UUID_RE.test(taskId)) {
      throw new NotFoundException('Task not found.');
    }

    return await this.db.tx(async (c) => {
      // Validate task exists in caller's slice
      let taskCheckSql: string;
      const taskCheckParams: any[] = [taskId];

      if (actor.role === 'owner') {
        taskCheckSql = `SELECT id FROM task WHERE id = $1`;
      } else if (actor.role === 'manager') {
        taskCheckSql = `SELECT id FROM task WHERE id = $1 AND manager_id = $2`;
        taskCheckParams.push(actor.userId);
      } else {
        taskCheckSql = `
          SELECT t.id FROM task t
          WHERE t.id = $1 AND t.team_id = (SELECT team_id FROM "user" WHERE id = $2)
        `;
        taskCheckParams.push(actor.userId);
      }

      const taskCheck = await c.query(taskCheckSql, taskCheckParams);
      if (taskCheck.rows.length === 0) {
        throw new NotFoundException('Task not found.');
      }

      const { rows } = await c.query<{
        id: string;
        task_id: string;
        task_name: string;
        reported_by_user_id: string;
        reported_by_name: string | null;
        summary: string;
        highlights: string | null;
        blockers: string | null;
        metadata: Record<string, unknown> | null;
        created_at: Date;
        updated_at: Date;
      }>(
        `SELECT r.id, r.task_id, t.name AS task_name, r.reported_by_user_id,
                u.name AS reported_by_name, r.summary, r.highlights, r.blockers,
                r.metadata, r.created_at, r.updated_at
           FROM task_report r
           JOIN task t ON t.id = r.task_id
           LEFT JOIN "user" u ON u.id = r.reported_by_user_id
          WHERE r.task_id = $1`,
        [taskId],
      );

      const report = rows[0];
      if (!report) {
        throw new NotFoundException('Report not found for this task.');
      }

      return {
        id: report.id,
        taskId: report.task_id,
        taskName: report.task_name,
        reportedByUserId: report.reported_by_user_id,
        reportedByName: report.reported_by_name ?? undefined,
        summary: report.summary,
        highlights: report.highlights ?? undefined,
        blockers: report.blockers ?? undefined,
        metadata: report.metadata ?? undefined,
        createdAt: report.created_at.toISOString(),
        updatedAt: report.updated_at.toISOString(),
      };
    });
  }

  /**
   * List task reports within caller's tenant slice.
   */
  async listReports(actor: CurrentUser): Promise<TaskReportResponseDto[]> {
    return await this.db.tx(async (c) => {
      let sql: string;
      const params: any[] = [];

      if (actor.role === 'owner') {
        sql = `
          SELECT r.id, r.task_id, t.name AS task_name, r.reported_by_user_id,
                 u.name AS reported_by_name, r.summary, r.highlights, r.blockers,
                 r.metadata, r.created_at, r.updated_at
            FROM task_report r
            JOIN task t ON t.id = r.task_id
            LEFT JOIN "user" u ON u.id = r.reported_by_user_id
           ORDER BY r.created_at DESC
        `;
      } else if (actor.role === 'manager') {
        sql = `
          SELECT r.id, r.task_id, t.name AS task_name, r.reported_by_user_id,
                 u.name AS reported_by_name, r.summary, r.highlights, r.blockers,
                 r.metadata, r.created_at, r.updated_at
            FROM task_report r
            JOIN task t ON t.id = r.task_id
            LEFT JOIN "user" u ON u.id = r.reported_by_user_id
           WHERE r.manager_id = $1
           ORDER BY r.created_at DESC
        `;
        params.push(actor.userId);
      } else {
        sql = `
          SELECT r.id, r.task_id, t.name AS task_name, r.reported_by_user_id,
                 u.name AS reported_by_name, r.summary, r.highlights, r.blockers,
                 r.metadata, r.created_at, r.updated_at
            FROM task_report r
            JOIN task t ON t.id = r.task_id
            LEFT JOIN "user" u ON u.id = r.reported_by_user_id
           WHERE t.team_id = (SELECT team_id FROM "user" WHERE id = $1)
           ORDER BY r.created_at DESC
        `;
        params.push(actor.userId);
      }

      const { rows } = await c.query<{
        id: string;
        task_id: string;
        task_name: string;
        reported_by_user_id: string;
        reported_by_name: string | null;
        summary: string;
        highlights: string | null;
        blockers: string | null;
        metadata: Record<string, unknown> | null;
        created_at: Date;
        updated_at: Date;
      }>(sql, params);

      return rows.map((r) => ({
        id: r.id,
        taskId: r.task_id,
        taskName: r.task_name,
        reportedByUserId: r.reported_by_user_id,
        reportedByName: r.reported_by_name ?? undefined,
        summary: r.summary,
        highlights: r.highlights ?? undefined,
        blockers: r.blockers ?? undefined,
        metadata: r.metadata ?? undefined,
        createdAt: r.created_at.toISOString(),
        updatedAt: r.updated_at.toISOString(),
      }));
    });
  }
}
