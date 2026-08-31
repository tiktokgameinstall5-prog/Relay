import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { DbService } from '../db/db.service';
import type { TenantContext } from '../db/tenant-context';
import { NotificationService } from '../notifications/notification.service';

export interface DueTaskCandidate {
  id: string;
  org_id: string;
  manager_id: string;
  created_by_user_id: string;
  name: string;
}

@Injectable()
export class SchedulerService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(SchedulerService.name);
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;

  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(NotificationService)
    private readonly notificationService: NotificationService,
  ) {}

  onApplicationBootstrap() {
    if (
      process.env.NODE_ENV === 'test' ||
      process.env.JEST_WORKER_ID !== undefined ||
      process.env.SCHEDULER_DISABLED === 'true'
    ) {
      return;
    }
    // Periodic background tick every 15 seconds
    this.timer = setInterval(() => {
      this.runTick().catch((err) =>
        this.logger.error('Background scheduler tick failed:', err),
      );
    }, 15000);
    if (this.timer && typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Public tick method with re-entrancy protection.
   * Usable both by timer in prod/dev and synchronously in tests.
   */
  async runTick(): Promise<{ activatedCount: number }> {
    if (this.isProcessing) {
      return { activatedCount: 0 };
    }

    this.isProcessing = true;
    try {
      return await this.processDueScheduledTasks();
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Discovers and activates due scheduled tasks across all tenants.
   */
  async processDueScheduledTasks(): Promise<{ activatedCount: number }> {
    // 1. Cross-org read via SECURITY DEFINER function
    const dueTasks = await this.db.withoutTenant(async (c) => {
      const { rows } = await c.query<DueTaskCandidate>(
        'SELECT id, org_id, manager_id, created_by_user_id, name FROM get_due_scheduled_tasks(50)',
      );
      return rows;
    });

    if (dueTasks.length === 0) {
      return { activatedCount: 0 };
    }

    let activatedCount = 0;

    // 2. Iterate and process each task inside its OWN isolated tenant transaction
    for (const task of dueTasks) {
      try {
        const activated = await this.activateSingleTask(task);
        if (activated) activatedCount++;
      } catch (err) {
        // A failure on one tenant''s task never halts processing for other tenants
        this.logger.error(
          `Failed to activate scheduled task ${task.id} in org ${task.org_id}:`,
          err,
        );
      }
    }

    return { activatedCount };
  }

  private async activateSingleTask(dueTask: DueTaskCandidate): Promise<boolean> {
    const ctx: TenantContext = {
      orgId: dueTask.org_id,
      role: 'manager',
      managerId: dueTask.manager_id,
      userId: dueTask.created_by_user_id,
    };

    return await this.db.withTenant(ctx, async (c) => {
      const now = new Date();

      // 1. Atomic conditional update (primary CAS concurrency defense)
      const taskRes = await c.query<{ id: string; name: string }>(
        `UPDATE task
            SET status = 'in_progress',
                updated_at = $1
          WHERE id = $2
            AND status = 'scheduled'
          RETURNING id, name`,
        [now, dueTask.id],
      );

      // If already activated by another instance or transaction, skip cleanly
      if (taskRes.rows.length === 0) {
        return false;
      }

      // 2. Flip step 1 to 'active'
      const stepRes = await c.query<{
        id: string;
        assigned_user_id: string;
        assigned_email: string;
        assigned_name: string;
      }>(
        `UPDATE task_step s
            SET status = 'active',
                started_at = $1,
                updated_at = $1
           FROM "user" u
          WHERE s.task_id = $2
            AND s.step_order = 1
            AND s.assigned_user_id = u.id
          RETURNING s.id, s.assigned_user_id, u.email as assigned_email, u.name as assigned_name`,
        [now, dueTask.id],
      );

      const activeStep = stepRes.rows[0];

      // 3. Gather team members to notify
      const teamMembers = await c.query<{ id: string }>(
        `SELECT id FROM "user"
          WHERE org_id = $1 AND manager_id = $2 AND status = 'active'`,
        [dueTask.org_id, dueTask.manager_id],
      );

      // 4. Batch in-app notifications
      const notifications = teamMembers.rows.map((member) => {
        const isAssignee = member.id === activeStep?.assigned_user_id;
        return {
          orgId: dueTask.org_id,
          userId: member.id,
          managerId: dueTask.manager_id,
          type: (isAssignee ? 'step_activated' : 'task_scheduled_live') as any,
          title: isAssignee
            ? `Your scheduled task is now active: ${dueTask.name}`
            : `Scheduled task started: ${dueTask.name}`,
          body: isAssignee
            ? `Step 1 is now with you. Please begin working on ${dueTask.name}.`
            : `Task ${dueTask.name} has gone live on your team's board.`,
          data: { taskId: dueTask.id, stepId: activeStep?.id },
          emailTo: isAssignee ? activeStep?.assigned_email : undefined,
          emailSubject: isAssignee
            ? `Active Task: ${dueTask.name}`
            : undefined,
          emailBody: isAssignee
            ? `Hi ${activeStep?.assigned_name},\n\nScheduled task "${dueTask.name}" is now live and waiting on you for Step 1.`
            : undefined,
        };
      });

      await this.notificationService.createNotifications(c, notifications);

      // 5. Write audit log entry (matching standard schema)
      await c.query(
        `INSERT INTO audit_log (org_id, actor_user_id, action, target_type, target_id, metadata, created_at)
         VALUES ($1, $2, 'task.scheduled_activated', 'task', $3, $4, $5)`,
        [
          dueTask.org_id,
          dueTask.created_by_user_id,
          dueTask.id,
          JSON.stringify({
            name: dueTask.name,
            activeStepId: activeStep?.id,
          }),
          now,
        ],
      );

      return true;
    });
  }
}
