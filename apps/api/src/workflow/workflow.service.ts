import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { DbService } from '../db/db.service';
import type { CurrentUser } from '../db/tenant-context';
import type { CreateTaskDto } from './dto/create-task.dto';
import type {
  TaskAssigneeDto,
  TaskResponseDto,
  TaskStepResponseDto,
} from './dto/task-response.dto';
import type { TaskStatus, TaskStepStatus, TaskType } from '../db/schema';

interface TaskDbRow {
  id: string;
  org_id: string;
  manager_id: string;
  team_id: string | null;
  name: string;
  type: TaskType;
  description: string | null;
  created_by_user_id: string;
  created_by_name: string;
  status: TaskStatus;
  scheduled_for: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface StepDbRow {
  id: string;
  task_id: string;
  assigned_user_id: string;
  assigned_user_name: string;
  assigned_user_email: string;
  role_title: string | null;
  step_order: number;
  status: TaskStepStatus;
  started_at: Date | null;
  completed_at: Date | null;
}

@Injectable()
export class WorkflowService {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  /**
   * Manager assigns an ordered relay to their own team (CLAUDE.md §2).
   *
   * 1. Resolves manager's active team.
   * 2. Validates that all memberIds belong to this manager's active team.
   * 3. Creates parent `task` with `team_id` populated, status 'in_progress'.
   * 4. Creates sequential `task_step` rows with Step 1 'active' (started_at = now()).
   */
  async assignTeamRelay(actor: CurrentUser, dto: CreateTaskDto): Promise<TaskResponseDto> {
    if (actor.role !== 'manager') {
      throw new ForbiddenException('Only managers can assign team relay tasks in this cut');
    }

    return await this.db.tx(async (c) => {
      // 1. Resolve manager's active team
      const teamRes = await c.query<{ id: string }>(
        `SELECT id FROM team WHERE manager_id = $1 AND status = 'active' LIMIT 1`,
        [actor.userId],
      );
      if (teamRes.rows.length === 0) {
        throw new BadRequestException('Manager has no active team');
      }
      const teamId = teamRes.rows[0].id;

      // 2. Validate memberIds: deduplicated count must match memberIds found in this team
      const uniqueMemberIds = Array.from(new Set(dto.memberIds));
      const membersRes = await c.query<{ id: string }>(
        `SELECT id FROM "user"
          WHERE team_id = $1 AND status = 'active' AND id = ANY($2::uuid[])`,
        [teamId, uniqueMemberIds],
      );
      if (membersRes.rows.length !== uniqueMemberIds.length) {
        throw new BadRequestException(
          'One or more assigned member IDs do not belong to your active team',
        );
      }

      // 3. Insert parent task
      const taskId = randomUUID();
      const now = new Date();
      await c.query(
        `INSERT INTO task (
           id, org_id, manager_id, team_id, name, type, description, created_by_user_id, status, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'in_progress', $9, $9)`,
        [
          taskId,
          actor.orgId,
          actor.userId,
          teamId,
          dto.name,
          dto.type,
          dto.description ?? null,
          actor.userId,
          now,
        ],
      );

      // 4. Insert ordered task steps
      for (let i = 0; i < dto.memberIds.length; i++) {
        const memberId = dto.memberIds[i];
        const stepId = randomUUID();
        const isFirst = i === 0;
        await c.query(
          `INSERT INTO task_step (
             id, org_id, manager_id, task_id, assigned_user_id, step_order, status, started_at, created_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)`,
          [
            stepId,
            actor.orgId,
            actor.userId,
            taskId,
            memberId,
            i + 1,
            isFirst ? 'active' : 'pending',
            isFirst ? now : null,
            now,
          ],
        );
      }

      return await this.fetchTaskById(c, taskId);
    });
  }

  /**
   * Action: only the member holding the active step can forward it (CLAUDE.md §2).
   *
   * Write authorization is enforced directly inside the UPDATE WHERE clause:
   *   UPDATE task_step SET status = 'completed', completed_at = now()
   *    WHERE task_id = $1 AND status = 'active' AND assigned_user_id = $2
   *
   * This guarantees check-then-act race immunity and atomicity.
   */
  async forwardStep(actor: CurrentUser, taskId: string): Promise<TaskResponseDto> {
    return await this.db.tx(async (c) => {
      // 1. Verify task exists in tenant slice
      const taskRes = await c.query<{ id: string; status: TaskStatus }>(
        `SELECT id, status FROM task WHERE id = $1`,
        [taskId],
      );
      if (taskRes.rows.length === 0) {
        throw new NotFoundException();
      }
      const t = taskRes.rows[0];
      if (t.status === 'completed') {
        throw new ConflictException('Task is already completed');
      }

      // 2. Atomic write-authorized step completion
      const now = new Date();
      const updateRes = await c.query<{ id: string; step_order: number }>(
        `UPDATE task_step
            SET status = 'completed', completed_at = $1, updated_at = $1
          WHERE task_id = $2 AND status = 'active' AND assigned_user_id = $3
          RETURNING id, step_order`,
        [now, taskId, actor.userId],
      );

      if (updateRes.rowCount === 0) {
        // Find why: is there an active step assigned to someone else, or no active step?
        const activeRes = await c.query<{ id: string; assigned_user_id: string }>(
          `SELECT id, assigned_user_id FROM task_step WHERE task_id = $1 AND status = 'active'`,
          [taskId],
        );
        if (activeRes.rows.length > 0) {
          throw new ForbiddenException(
            'Only the member currently holding the active step can forward it',
          );
        }
        throw new ConflictException('Task has no active step to forward');
      }

      const completedStepOrder = updateRes.rows[0].step_order;

      // 3. Find next step in chain
      const nextStepRes = await c.query<{ id: string }>(
        `SELECT id FROM task_step WHERE task_id = $1 AND step_order = $2`,
        [taskId, completedStepOrder + 1],
      );

      if (nextStepRes.rows.length > 0) {
        // Activate next step
        await c.query(
          `UPDATE task_step
              SET status = 'active', started_at = $1, updated_at = $1
            WHERE id = $2`,
          [now, nextStepRes.rows[0].id],
        );
      } else {
        // Final step completed: parent task flips to completed!
        await c.query(
          `UPDATE task
              SET status = 'completed', updated_at = $1
            WHERE id = $2`,
          [now, taskId],
        );
      }

      return await this.fetchTaskById(c, taskId);
    });
  }

  /**
   * List tasks accessible to the caller's tenant slice.
   * Owner → all tasks in org; Manager → own team tasks; Member → own team tasks.
   * Scoped by RLS.
   */
  async listTasks(): Promise<TaskResponseDto[]> {
    return await this.db.tx(async (c) => {
      const tasksRes = await c.query<TaskDbRow>(
        `SELECT t.id, t.org_id, t.manager_id, t.team_id, t.name, t.type, t.description,
                t.created_by_user_id, u.name AS created_by_name, t.status, t.scheduled_for,
                t.created_at, t.updated_at
           FROM task t
           JOIN "user" u ON u.id = t.created_by_user_id
          ORDER BY t.created_at DESC`,
      );

      if (tasksRes.rows.length === 0) {
        return [];
      }

      const stepsRes = await c.query<StepDbRow>(
        `SELECT s.id, s.task_id, s.assigned_user_id, u.name AS assigned_user_name,
                u.email AS assigned_user_email, u.role_title,
                s.step_order, s.status, s.started_at, s.completed_at
           FROM task_step s
           JOIN "user" u ON u.id = s.assigned_user_id
          ORDER BY s.task_id, s.step_order ASC`,
      );

      const stepsByTaskId = new Map<string, StepDbRow[]>();
      for (const step of stepsRes.rows) {
        const list = stepsByTaskId.get(step.task_id) ?? [];
        list.push(step);
        stepsByTaskId.set(step.task_id, list);
      }

      return tasksRes.rows.map((t) => this.assembleTaskDto(t, stepsByTaskId.get(t.id) ?? []));
    });
  }

  /**
   * Get a single task by ID within the caller's tenant slice.
   */
  async getTask(taskId: string): Promise<TaskResponseDto> {
    return await this.db.tx(async (c) => {
      return await this.fetchTaskById(c, taskId);
    });
  }

  // --- Internal helpers ----------------------------------------------------

  private async fetchTaskById(c: PoolClient, taskId: string): Promise<TaskResponseDto> {
    const taskRes = await c.query<TaskDbRow>(
      `SELECT t.id, t.org_id, t.manager_id, t.team_id, t.name, t.type, t.description,
              t.created_by_user_id, u.name AS created_by_name, t.status, t.scheduled_for,
              t.created_at, t.updated_at
         FROM task t
         JOIN "user" u ON u.id = t.created_by_user_id
        WHERE t.id = $1`,
      [taskId],
    );

    if (taskRes.rows.length === 0) {
      throw new NotFoundException();
    }

    const stepsRes = await c.query<StepDbRow>(
      `SELECT s.id, s.task_id, s.assigned_user_id, u.name AS assigned_user_name,
              u.email AS assigned_user_email, u.role_title,
              s.step_order, s.status, s.started_at, s.completed_at
         FROM task_step s
         JOIN "user" u ON u.id = s.assigned_user_id
        WHERE s.task_id = $1
        ORDER BY s.step_order ASC`,
      [taskId],
    );

    return this.assembleTaskDto(taskRes.rows[0], stepsRes.rows);
  }

  private assembleTaskDto(t: TaskDbRow, steps: StepDbRow[]): TaskResponseDto {
    const activeStep = steps.find((s) => s.status === 'active');
    const completedCount = steps.filter((s) => s.status === 'completed').length;

    let currentAssignee: TaskAssigneeDto | null = null;
    if (activeStep) {
      currentAssignee = {
        id: activeStep.assigned_user_id,
        name: activeStep.assigned_user_name,
        email: activeStep.assigned_user_email,
        roleTitle: activeStep.role_title,
      };
    }

    const stepDtos: TaskStepResponseDto[] = steps.map((s) => {
      let durationSeconds: number | null = null;
      if (s.started_at && s.completed_at) {
        durationSeconds = Math.max(
          0,
          Math.round((s.completed_at.getTime() - s.started_at.getTime()) / 1000),
        );
      } else if (s.status === 'active' && s.started_at) {
        durationSeconds = Math.max(
          0,
          Math.round((Date.now() - s.started_at.getTime()) / 1000),
        );
      }

      return {
        id: s.id,
        taskId: s.task_id,
        assignedUserId: s.assigned_user_id,
        assignedUserName: s.assigned_user_name,
        stepOrder: s.step_order,
        status: s.status,
        startedAt: s.started_at ? s.started_at.toISOString() : null,
        completedAt: s.completed_at ? s.completed_at.toISOString() : null,
        durationSeconds,
      };
    });

    return {
      id: t.id,
      orgId: t.org_id,
      managerId: t.manager_id,
      teamId: t.team_id,
      name: t.name,
      type: t.type,
      description: t.description,
      createdByUserId: t.created_by_user_id,
      createdByName: t.created_by_name,
      status: t.status,
      scheduledFor: t.scheduled_for ? t.scheduled_for.toISOString() : null,
      createdAt: t.created_at.toISOString(),
      updatedAt: t.updated_at.toISOString(),
      currentStepOrder: activeStep ? activeStep.step_order : null,
      totalSteps: steps.length,
      completedSteps: completedCount,
      currentAssignee,
      steps: stepDtos,
    };
  }
}
