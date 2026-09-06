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
import type { ForwardStepDto } from './dto/forward-step.dto';
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

import { NotificationService, CreateNotificationInput } from '../notifications/notification.service';

@Injectable()
export class WorkflowService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(NotificationService)
    private readonly notificationService: NotificationService,
  ) {}

  private parseAndValidateScheduledFor(scheduledFor?: string): Date | null {
    if (!scheduledFor) return null;
    const parsed = new Date(scheduledFor);
    if (isNaN(parsed.getTime())) {
      throw new BadRequestException('scheduledFor must be a valid ISO-8601 date string');
    }
    const maxFuture = new Date(Date.now() + 365 * 86400 * 1000);
    if (parsed.getTime() > maxFuture.getTime()) {
      throw new BadRequestException('scheduledFor cannot be more than 365 days into the future');
    }
    return parsed;
  }

  /**
   * Manager assigns an ordered relay to their own team (CLAUDE.md §2).
   */
  async assignTeamRelay(actor: CurrentUser, dto: CreateTaskDto): Promise<TaskResponseDto> {
    if (actor.role !== 'manager') {
      throw new ForbiddenException('Only managers can assign team relay tasks via this method');
    }

    const memberIds = dto.memberIds;
    if (!memberIds || memberIds.length === 0) {
      throw new BadRequestException('At least one member must be assigned to the relay');
    }

    // Reject duplicate memberIds in the array
    if (new Set(memberIds).size !== memberIds.length) {
      throw new BadRequestException(
        'A member cannot be assigned to multiple steps in the same relay',
      );
    }

    const scheduledDate = this.parseAndValidateScheduledFor(dto.scheduledFor);
    const isScheduled = scheduledDate !== null && scheduledDate.getTime() > Date.now();
    const taskStatus: TaskStatus = isScheduled ? 'scheduled' : 'in_progress';

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
      const membersRes = await c.query<{ id: string; email: string; name: string }>(
        `SELECT id, email, name FROM "user"
          WHERE team_id = $1 AND status = 'active' AND id = ANY($2::uuid[])`,
        [teamId, memberIds],
      );
      if (membersRes.rows.length !== memberIds.length) {
        throw new BadRequestException(
          'One or more assigned member IDs do not belong to your active team',
        );
      }

      // 3. Insert parent task
      const taskId = randomUUID();
      const now = new Date();
      await c.query(
        `INSERT INTO task (
           id, org_id, manager_id, team_id, name, type, description, created_by_user_id, status, scheduled_for, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)`,
        [
          taskId,
          actor.orgId,
          actor.userId,
          teamId,
          dto.name,
          dto.type,
          dto.description ?? null,
          actor.userId,
          taskStatus,
          scheduledDate,
          now,
        ],
      );

      // 4. Insert ordered task steps
      const createdStepIds: string[] = [];
      for (let i = 0; i < memberIds.length; i++) {
        const memberId = memberIds[i];
        const stepId = randomUUID();
        createdStepIds.push(stepId);
        const isFirst = i === 0;
        const stepStatus: TaskStepStatus = !isScheduled && isFirst ? 'active' : 'pending';
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
            stepStatus,
            !isScheduled && isFirst ? now : null,
            now,
          ],
        );
      }

      // 5. In-app notifications (if task is immediate)
      if (!isScheduled) {
        const notifs: CreateNotificationInput[] = [];
        const firstMember = membersRes.rows.find((m) => m.id === memberIds[0]);
        notifs.push({
          orgId: actor.orgId,
          userId: memberIds[0],
          managerId: actor.userId,
          type: 'step_activated',
          title: `Task assigned: ${dto.name}`,
          body: `Step 1 is now with you. Please begin working on ${dto.name}.`,
          data: { taskId, stepId: createdStepIds[0], stepOrder: 1 },
          emailTo: firstMember?.email,
          emailSubject: `Task assigned: ${dto.name}`,
          emailBody: `Hi ${firstMember?.name},\n\nStep 1 of "${dto.name}" has been assigned to you.`,
        });

        for (let i = 1; i < memberIds.length; i++) {
          const mem = membersRes.rows.find((m) => m.id === memberIds[i]);
          notifs.push({
            orgId: actor.orgId,
            userId: memberIds[i],
            managerId: actor.userId,
            type: 'task_assigned',
            title: `New team task: ${dto.name}`,
            body: `You are assigned to Step ${i + 1} of ${dto.name}.`,
            data: { taskId, stepId: createdStepIds[i], stepOrder: i + 1 },
          });
        }
        await this.notificationService.createNotifications(c, notifs);
      }

      // 6. Audit log write (fire-and-forget, no RETURNING)
      await this.writeAuditLog(c, actor, 'task.created', taskId, {
        name: dto.name,
        type: dto.type,
        totalSteps: memberIds.length,
        managerId: actor.userId,
        teamId,
        scheduledFor: scheduledDate ? scheduledDate.toISOString() : null,
      });

      return await this.fetchTaskById(c, taskId);
    });
  }

  /**
   * Owner assigns a task across the organization (CLAUDE.md §2).
   * Modes: Owner -> Team, Owner -> Manager, Owner -> Member.
   */
  async assignOwnerTask(actor: CurrentUser, dto: CreateTaskDto): Promise<TaskResponseDto> {
    if (actor.role !== 'owner') {
      throw new ForbiddenException('Only owners can call assignOwnerTask');
    }

    const targetsProvided = [dto.teamId, dto.targetManagerId, dto.targetMemberId].filter(
      Boolean,
    ).length;
    if (targetsProvided !== 1) {
      throw new BadRequestException(
        'Must specify exactly one target: teamId, targetManagerId, or targetMemberId',
      );
    }

    const scheduledDate = this.parseAndValidateScheduledFor(dto.scheduledFor);
    const isScheduled = scheduledDate !== null && scheduledDate.getTime() > Date.now();
    const taskStatus: TaskStatus = isScheduled ? 'scheduled' : 'in_progress';

    return await this.db.tx(async (c) => {
      const now = new Date();
      const taskId = randomUUID();

      // Mode A: Owner -> Team
      if (dto.teamId) {
        const teamRes = await c.query<{ id: string; manager_id: string }>(
          `SELECT id, manager_id FROM team WHERE id = $1 AND org_id = $2 AND status = 'active'`,
          [dto.teamId, actor.orgId],
        );
        if (teamRes.rows.length === 0) {
          throw new BadRequestException('Target team not found in your organization');
        }
        const team = teamRes.rows[0];

        let memberIds: string[] = [];
        if (dto.memberIds && dto.memberIds.length > 0) {
          if (new Set(dto.memberIds).size !== dto.memberIds.length) {
            throw new BadRequestException(
              'A member cannot be assigned to multiple steps in the same relay',
            );
          }
          const membersRes = await c.query<{ id: string }>(
            `SELECT id FROM "user" WHERE team_id = $1 AND status = 'active' AND id = ANY($2::uuid[])`,
            [team.id, dto.memberIds],
          );
          if (membersRes.rows.length !== dto.memberIds.length) {
            throw new BadRequestException('One or more assigned member IDs do not belong to the target team');
          }
          memberIds = dto.memberIds;
        } else {
          // Default to all active members of the team
          const allMembers = await c.query<{ id: string }>(
            `SELECT id FROM "user" WHERE team_id = $1 AND status = 'active' ORDER BY ranking ASC, created_at ASC`,
            [team.id],
          );
          if (allMembers.rows.length > 0) {
            memberIds = allMembers.rows.map((m) => m.id);
          } else {
            // Team has no members yet -> assign step 1 to the manager
            memberIds = [team.manager_id];
          }
        }

        await c.query(
          `INSERT INTO task (
             id, org_id, manager_id, team_id, name, type, description, created_by_user_id, status, scheduled_for, created_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)`,
          [
            taskId,
            actor.orgId,
            team.manager_id,
            team.id,
            dto.name,
            dto.type,
            dto.description ?? null,
            actor.userId,
            taskStatus,
            scheduledDate,
            now,
          ],
        );

        for (let i = 0; i < memberIds.length; i++) {
          const isFirst = i === 0;
          const stepStatus: TaskStepStatus = !isScheduled && isFirst ? 'active' : 'pending';
          await c.query(
            `INSERT INTO task_step (
               id, org_id, manager_id, task_id, assigned_user_id, step_order, status, started_at, created_at, updated_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)`,
            [
              randomUUID(),
              actor.orgId,
              team.manager_id,
              taskId,
              memberIds[i],
              i + 1,
              stepStatus,
              !isScheduled && isFirst ? now : null,
              now,
            ],
          );
        }

        if (!isScheduled) {
          const notifs: CreateNotificationInput[] = [];
          notifs.push({
            orgId: actor.orgId,
            userId: team.manager_id,
            managerId: team.manager_id,
            type: 'task_assigned',
            title: `Task assigned: ${dto.name}`,
            body: `Owner assigned task "${dto.name}" to your team.`,
            data: { taskId },
          });
          if (memberIds.length > 0 && memberIds[0] !== team.manager_id) {
            notifs.push({
              orgId: actor.orgId,
              userId: memberIds[0],
              managerId: team.manager_id,
              type: 'step_activated',
              title: `Task assigned: ${dto.name}`,
              body: `Step 1 is now with you. Please begin working on ${dto.name}.`,
              data: { taskId },
            });
          }
          await this.notificationService.createNotifications(c, notifs);
        }

        await this.writeAuditLog(c, actor, 'task.created', taskId, {
          name: dto.name,
          type: dto.type,
          targetType: 'team',
          teamId: team.id,
          managerId: team.manager_id,
          totalSteps: memberIds.length,
          scheduledFor: scheduledDate ? scheduledDate.toISOString() : null,
        });

        return await this.fetchTaskById(c, taskId);
      }

      // Mode B: Owner -> Manager
      if (dto.targetManagerId) {
        const mgrRes = await c.query<{ id: string }>(
          `SELECT id FROM "user" WHERE id = $1 AND org_id = $2 AND role = 'manager' AND status = 'active'`,
          [dto.targetManagerId, actor.orgId],
        );
        if (mgrRes.rows.length === 0) {
          throw new BadRequestException('Target manager not found in your organization');
        }

        await c.query(
          `INSERT INTO task (
             id, org_id, manager_id, team_id, name, type, description, created_by_user_id, status, scheduled_for, created_at, updated_at
           ) VALUES ($1, $2, $3, NULL, $4, $5, $6, $7, $8, $9, $10, $10)`,
          [
            taskId,
            actor.orgId,
            dto.targetManagerId,
            dto.name,
            dto.type,
            dto.description ?? null,
            actor.userId,
            taskStatus,
            scheduledDate,
            now,
          ],
        );

        const stepStatus: TaskStepStatus = !isScheduled ? 'active' : 'pending';
        await c.query(
          `INSERT INTO task_step (
             id, org_id, manager_id, task_id, assigned_user_id, step_order, status, started_at, created_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, 1, $6, $7, $8, $8)`,
          [
            randomUUID(),
            actor.orgId,
            dto.targetManagerId,
            taskId,
            dto.targetManagerId,
            stepStatus,
            !isScheduled ? now : null,
            now,
          ],
        );

        if (!isScheduled) {
          await this.notificationService.createNotifications(c, [
            {
              orgId: actor.orgId,
              userId: dto.targetManagerId,
              managerId: dto.targetManagerId,
              type: 'step_activated',
              title: `Task assigned: ${dto.name}`,
              body: `Owner assigned task "${dto.name}" to you. Please begin working on it.`,
              data: { taskId },
            },
          ]);
        }

        await this.writeAuditLog(c, actor, 'task.created', taskId, {
          name: dto.name,
          type: dto.type,
          targetType: 'manager',
          targetManagerId: dto.targetManagerId,
          totalSteps: 1,
          scheduledFor: scheduledDate ? scheduledDate.toISOString() : null,
        });

        return await this.fetchTaskById(c, taskId);
      }

      // Mode C: Owner -> Member
      if (dto.targetMemberId) {
        const memRes = await c.query<{ id: string; manager_id: string; team_id: string | null }>(
          `SELECT id, manager_id, team_id FROM "user" WHERE id = $1 AND org_id = $2 AND role = 'member' AND status = 'active'`,
          [dto.targetMemberId, actor.orgId],
        );
        if (memRes.rows.length === 0) {
          throw new BadRequestException('Target member not found in your organization');
        }
        const member = memRes.rows[0];
        if (!member.manager_id) {
          throw new BadRequestException('Target member is not assigned to a manager');
        }

        await c.query(
          `INSERT INTO task (
             id, org_id, manager_id, team_id, name, type, description, created_by_user_id, status, scheduled_for, created_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)`,
          [
            taskId,
            actor.orgId,
            member.manager_id,
            member.team_id,
            dto.name,
            dto.type,
            dto.description ?? null,
            actor.userId,
            taskStatus,
            scheduledDate,
            now,
          ],
        );

        const stepStatus: TaskStepStatus = !isScheduled ? 'active' : 'pending';
        await c.query(
          `INSERT INTO task_step (
             id, org_id, manager_id, task_id, assigned_user_id, step_order, status, started_at, created_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, 1, $6, $7, $8, $8)`,
          [
            randomUUID(),
            actor.orgId,
            member.manager_id,
            taskId,
            member.id,
            stepStatus,
            !isScheduled ? now : null,
            now,
          ],
        );

        if (!isScheduled) {
          await this.notificationService.createNotifications(c, [
            {
              orgId: actor.orgId,
              userId: member.id,
              managerId: member.manager_id,
              type: 'step_activated',
              title: `Task assigned: ${dto.name}`,
              body: `Owner assigned task "${dto.name}" to you. Please begin working on it.`,
              data: { taskId },
            },
          ]);
        }

        await this.writeAuditLog(c, actor, 'task.created', taskId, {
          name: dto.name,
          type: dto.type,
          targetType: 'member',
          targetMemberId: member.id,
          managerId: member.manager_id,
          teamId: member.team_id,
          totalSteps: 1,
          scheduledFor: scheduledDate ? scheduledDate.toISOString() : null,
        });

        return await this.fetchTaskById(c, taskId);
      }

      throw new BadRequestException('Must specify teamId, targetManagerId, or targetMemberId');
    });
  }

  /**
   * Action: forward active step sequentially or perform a peer hand-off (CLAUDE.md §2).
   */
  async forwardStep(
    actor: CurrentUser,
    taskId: string,
    dto?: ForwardStepDto,
  ): Promise<TaskResponseDto> {
    return await this.db.tx(async (c) => {
      // 1. Verify task exists in tenant slice
      const taskRes = await c.query<TaskDbRow>(
        `SELECT id, org_id, manager_id, team_id, status FROM task WHERE id = $1`,
        [taskId],
      );
      if (taskRes.rows.length === 0) {
        throw new NotFoundException();
      }
      const task = taskRes.rows[0];
      if (task.status === 'completed') {
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

      // 3. Branch: Peer Hand-Off vs Sequential Forward
      if (dto?.targetUserId) {
        if (dto.targetUserId === actor.userId) {
          throw new BadRequestException('Cannot hand off task to yourself');
        }

        // Validate target user is a member belonging to the same manager/team slice
        const targetRes = await c.query<{ id: string; manager_id: string; role: string }>(
          `SELECT id, manager_id, role FROM "user" WHERE id = $1 AND org_id = $2 AND status = 'active'`,
          [dto.targetUserId, actor.orgId],
        );
        if (targetRes.rows.length === 0) {
          throw new BadRequestException('Target user is not in the same team');
        }
        const targetUser = targetRes.rows[0];
        if (targetUser.role !== 'member' || targetUser.manager_id !== task.manager_id) {
          throw new BadRequestException('Target user must be a member of the same team');
        }

        // Check if target is already in future pending steps
        const pendingTargetRes = await c.query<{ id: string; step_order: number }>(
          `SELECT id, step_order FROM task_step
            WHERE task_id = $1 AND assigned_user_id = $2 AND status = 'pending'`,
          [taskId, dto.targetUserId],
        );

        if (pendingTargetRes.rows.length > 0) {
          const pendingTarget = pendingTargetRes.rows[0];
          if (pendingTarget.step_order === completedStepOrder + 1) {
            // Target is already the immediate next step -> standard activate
            await c.query(
              `UPDATE task_step SET status = 'active', started_at = $1, updated_at = $1 WHERE id = $2`,
              [now, pendingTarget.id],
            );
            await this.writeAuditLog(c, actor, 'task_step.forwarded', taskId, {
              completedStepOrder,
              nextStepOrder: pendingTarget.step_order,
              targetUserId: dto.targetUserId,
            });
          } else {
            // Target is at a later step (m > completedStepOrder + 1) -> Deduplicate & Promote
            // Negate target row's step_order to -(completedStepOrder + 1) and mark active
            await c.query(
              `UPDATE task_step
                  SET step_order = $1, status = 'active', started_at = $2, updated_at = $2
                WHERE id = $3`,
              [-(completedStepOrder + 1), now, pendingTarget.id],
            );

            // Shift intervening steps between completedStepOrder and old step
            await c.query(
              `UPDATE task_step
                  SET step_order = - (step_order + 1)
                WHERE task_id = $1 AND step_order > $2 AND step_order < $3`,
              [taskId, completedStepOrder, pendingTarget.step_order],
            );

            // Restore all negative step orders to positive in a single statement
            await c.query(
              `UPDATE task_step
                  SET step_order = -step_order, updated_at = $1
                WHERE task_id = $2 AND step_order < 0`,
              [now, taskId],
            );

            await this.writeAuditLog(c, actor, 'task_step.handed_off', taskId, {
              completedStepOrder,
              targetUserId: dto.targetUserId,
              promotedFromLaterStep: true,
              oldStepOrder: pendingTarget.step_order,
            });
          }
        } else {
          // Target is not in pending steps -> Splice in
          await c.query(
            `UPDATE task_step
                SET step_order = -step_order
              WHERE task_id = $1 AND step_order > $2`,
            [taskId, completedStepOrder],
          );
          await c.query(
            `UPDATE task_step
                SET step_order = (-step_order) + 1, updated_at = $1
              WHERE task_id = $2 AND step_order < 0`,
            [now, taskId],
          );

          await c.query(
            `INSERT INTO task_step (
               id, org_id, manager_id, task_id, assigned_user_id, step_order, status, started_at, created_at, updated_at
             ) VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, $7, $7)`,
            [
              randomUUID(),
              actor.orgId,
              task.manager_id,
              taskId,
              dto.targetUserId,
              completedStepOrder + 1,
              now,
            ],
          );

          await this.writeAuditLog(c, actor, 'task_step.handed_off', taskId, {
            completedStepOrder,
            targetUserId: dto.targetUserId,
            promotedFromLaterStep: false,
          });
        }
      } else {
        // Sequential progression
        const nextStepRes = await c.query<{ id: string }>(
          `SELECT id FROM task_step WHERE task_id = $1 AND step_order = $2`,
          [taskId, completedStepOrder + 1],
        );

        if (nextStepRes.rows.length > 0) {
          const nextStepId = nextStepRes.rows[0].id;
          await c.query(
            `UPDATE task_step
                SET status = 'active', started_at = $1, updated_at = $1
              WHERE id = $2`,
            [now, nextStepId],
          );

          // Notify next step assignee
          const nextAssigneeRes = await c.query<{ assigned_user_id: string; assigned_email: string; assigned_name: string; task_name: string }>(
            `SELECT s.assigned_user_id, u.email as assigned_email, u.name as assigned_name, t.name as task_name
               FROM task_step s
               JOIN "user" u ON u.id = s.assigned_user_id
               JOIN task t ON t.id = s.task_id
              WHERE s.id = $1`,
            [nextStepId],
          );
          if (nextAssigneeRes.rows.length > 0) {
            const row = nextAssigneeRes.rows[0];
            await this.notificationService.createNotifications(c, [{
              orgId: actor.orgId,
              userId: row.assigned_user_id,
              managerId: task.manager_id,
              type: 'step_activated',
              title: `Step forwarded to you: ${row.task_name}`,
              body: `Step ${completedStepOrder + 1} is now with you. Please continue the relay.`,
              data: { taskId, stepId: nextStepId, stepOrder: completedStepOrder + 1 },
              emailTo: row.assigned_email,
              emailSubject: `Step forwarded to you: ${row.task_name}`,
              emailBody: `Hi ${row.assigned_name},\n\nStep ${completedStepOrder + 1} of "${row.task_name}" has been forwarded to you.`,
            }]);
          }

          await this.writeAuditLog(c, actor, 'task_step.forwarded', taskId, {
            completedStepOrder,
            nextStepOrder: completedStepOrder + 1,
          });
        } else {
          // Final step completed
          await c.query(
            `UPDATE task
                SET status = 'completed', updated_at = $1
              WHERE id = $2`,
            [now, taskId],
          );

          // Gather notifications for team, manager, and owner
          const taskDetailRes = await c.query<{ name: string }>(`SELECT name FROM task WHERE id = $1`, [taskId]);
          const taskName = taskDetailRes.rows[0]?.name ?? 'Task';

          const teamMembers = await c.query<{ id: string }>(
            `SELECT id FROM "user" WHERE org_id = $1 AND (manager_id = $2 OR id = $2) AND status = 'active'`,
            [actor.orgId, task.manager_id],
          );
          const owners = await c.query<{ id: string }>(
            `SELECT id FROM "user" WHERE org_id = $1 AND role = 'owner' AND status = 'active'`,
            [actor.orgId],
          );

          const recipientIds = new Set<string>();
          teamMembers.rows.forEach((m) => recipientIds.add(m.id));
          owners.rows.forEach((o) => recipientIds.add(o.id));

          const completionNotifs = Array.from(recipientIds).map((userId) => ({
            orgId: actor.orgId,
            userId,
            managerId: task.manager_id,
            type: 'task_completed' as const,
            title: `Task completed: ${taskName}`,
            body: `All steps for ${taskName} have been completed successfully.`,
            data: { taskId },
          }));

          await this.notificationService.createNotifications(c, completionNotifs);

          // Phase 5: Prompt designated reporters for completion report
          const reporters = await c.query<{ id: string }>(
            `SELECT id FROM "user"
              WHERE org_id = $1 AND is_reporter = true AND status = 'active'
                AND (team_id = $2 OR role IN ('owner', 'manager'))`,
            [actor.orgId, task.team_id],
          );
          if (reporters.rows.length > 0) {
            const reporterNotifs = reporters.rows.map((r) => ({
              orgId: actor.orgId,
              userId: r.id,
              managerId: task.manager_id,
              type: 'reporter_prompt' as const,
              title: `Task report required: ${taskName}`,
              body: `Task "${taskName}" has completed. Please submit the final completion report.`,
              data: { taskId },
            }));
            await this.notificationService.createNotifications(c, reporterNotifs);
          }

          await this.writeAuditLog(c, actor, 'task.completed', taskId, {
            completedStepOrder,
          });
        }
      }

      return await this.fetchTaskById(c, taskId);
    });
  }

  /**
   * List tasks accessible to the caller's tenant slice.
   */
  async listTasks(): Promise<TaskResponseDto[]> {
    return await this.db.tx(async (c) => {
      // 1. Eagerly activate any due scheduled tasks across this tenant
      await c.query(
        `UPDATE task
            SET status = 'in_progress', updated_at = NOW()
          WHERE status = 'scheduled' AND scheduled_for <= NOW()`,
      );
      await c.query(
        `UPDATE task_step
            SET status = 'active', started_at = NOW(), updated_at = NOW()
          WHERE id IN (
            SELECT s.id FROM task_step s
            JOIN task t ON t.id = s.task_id
            WHERE t.status = 'in_progress' AND s.step_order = 1 AND s.status = 'pending'
          )`,
      );

      // 2. Fetch tasks. Owner sees scheduled tasks; team members and managers only see active/completed tasks.
      const tasksRes = await c.query<TaskDbRow>(
        `SELECT t.id, t.org_id, t.manager_id, t.team_id, t.name, t.type, t.description,
                t.created_by_user_id, COALESCE(u.name, 'Owner') AS created_by_name, t.status, t.scheduled_for,
                t.created_at, t.updated_at
           FROM task t
           LEFT JOIN "user" u ON u.id = t.created_by_user_id
          WHERE (app_current_role() = 'owner' OR t.status != 'scheduled')
          ORDER BY t.created_at DESC`,
      );

      if (tasksRes.rows.length === 0) {
        return [];
      }

      const stepsRes = await c.query<StepDbRow>(
        `SELECT s.id, s.task_id, s.assigned_user_id, COALESCE(u.name, 'Unassigned') AS assigned_user_name,
                u.email AS assigned_user_email, u.role_title,
                s.step_order, s.status, s.started_at, s.completed_at
           FROM task_step s
           LEFT JOIN "user" u ON u.id = s.assigned_user_id
          WHERE s.task_id = ANY($1::uuid[])
          ORDER BY s.task_id, s.step_order ASC`,
        [tasksRes.rows.map((t) => t.id)],
      );

      const stepsByTaskId = new Map<string, StepDbRow[]>();
      for (const step of stepsRes.rows) {
        const list = stepsByTaskId.get(step.task_id) ?? [];
        list.push(step);
        stepsByTaskId.set(step.task_id, list);
      }

      return tasksRes.rows.map((task) =>
        this.assembleTaskResponse(task, stepsByTaskId.get(task.id) ?? []),
      );
    });
  }

  /**
   * Get single task by ID.
   */
  async getTask(taskId: string): Promise<TaskResponseDto> {
    return await this.db.tx(async (c) => {
      return await this.fetchTaskById(c, taskId);
    });
  }

  private async fetchTaskById(c: PoolClient, taskId: string): Promise<TaskResponseDto> {
    const taskRes = await c.query<TaskDbRow>(
      `SELECT t.id, t.org_id, t.manager_id, t.team_id, t.name, t.type, t.description,
              t.created_by_user_id, COALESCE(u.name, 'Owner') AS created_by_name, t.status, t.scheduled_for,
              t.created_at, t.updated_at
         FROM task t
         LEFT JOIN "user" u ON u.id = t.created_by_user_id
        WHERE t.id = $1
          AND (app_current_role() = 'owner' OR t.status != 'scheduled')`,
      [taskId],
    );
    if (taskRes.rows.length === 0) {
      throw new NotFoundException();
    }

    const stepsRes = await c.query<StepDbRow>(
      `SELECT s.id, s.task_id, s.assigned_user_id, COALESCE(u.name, 'Unassigned') AS assigned_user_name,
              u.email AS assigned_user_email, u.role_title,
              s.step_order, s.status, s.started_at, s.completed_at
         FROM task_step s
         LEFT JOIN "user" u ON u.id = s.assigned_user_id
        WHERE s.task_id = $1
        ORDER BY s.step_order ASC`,
      [taskId],
    );

    return this.assembleTaskResponse(taskRes.rows[0], stepsRes.rows);
  }

  private assembleTaskResponse(task: TaskDbRow, steps: StepDbRow[]): TaskResponseDto {
    const completedSteps = steps.filter((s) => s.status === 'completed').length;
    const activeStep = steps.find((s) => s.status === 'active');

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
      if (s.started_at) {
        const endTime = s.completed_at ? new Date(s.completed_at).getTime() : Date.now();
        const startTime = new Date(s.started_at).getTime();
        durationSeconds = Math.max(0, Math.floor((endTime - startTime) / 1000));
      }

      return {
        id: s.id,
        taskId: s.task_id,
        stepOrder: s.step_order,
        status: s.status,
        assignedUserId: s.assigned_user_id,
        assignedUserName: s.assigned_user_name,
        assignedUserEmail: s.assigned_user_email,
        roleTitle: s.role_title,
        startedAt: s.started_at ? s.started_at.toISOString() : null,
        completedAt: s.completed_at ? s.completed_at.toISOString() : null,
        durationSeconds,
      };
    });

    return {
      id: task.id,
      orgId: task.org_id,
      managerId: task.manager_id,
      teamId: task.team_id,
      name: task.name,
      type: task.type,
      description: task.description,
      createdByUserId: task.created_by_user_id,
      createdByName: task.created_by_name,
      status: task.status,
      totalSteps: steps.length,
      completedSteps,
      currentStepOrder: activeStep ? activeStep.step_order : null,
      currentAssignee,
      scheduledFor: task.scheduled_for ? task.scheduled_for.toISOString() : null,
      createdAt: task.created_at.toISOString(),
      updatedAt: task.updated_at.toISOString(),
      steps: stepDtos,
    };
  }

  private async writeAuditLog(
    c: PoolClient,
    actor: CurrentUser,
    action: string,
    targetId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await c.query(
      `INSERT INTO audit_log (org_id, actor_user_id, action, target_type, target_id, metadata)
       VALUES ($1, $2, $3, 'task', $4, $5)`,
      [actor.orgId, actor.userId, action, targetId, JSON.stringify(metadata)],
    );
  }
}
