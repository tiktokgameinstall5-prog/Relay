/**
 * Workflow and Scheduler E2E tests for Phase 4 (Scheduling & Notifications).
 *
 * Proves:
 *   1. Creating a task with future scheduled_for creates task with status=''scheduled'' and step 1 status=''pending''.
 *   2. Rejects scheduled_for > 365 days into the future.
 *   3. Scheduler runTick() flips due scheduled tasks to ''in_progress'', activates step 1, and creates notifications.
 *   4. Scheduler runTick() is idempotent (subsequent runs do not double-activate).
 *   5. Future scheduled tasks remain ''scheduled'' until their due date.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { SchedulerService } from '../src/scheduler/scheduler.service';
import { NotificationService } from '../src/notifications/notification.service';
import { DbService } from '../src/db/db.service';
import { closePools, truncateAll, withTenant } from './helpers/db';
import { ctxFor, seedFixture, type Fixture } from './helpers/seed';
import { bearer } from './helpers/token';

describe('Task Scheduling & Workflow Integration (E2E)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let scheduler: SchedulerService;
  let notifService: NotificationService;
  let db: DbService;
  let f: Fixture;

  beforeAll(async () => {
    f = await seedFixture();

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    http = request(app.getHttpServer());

    scheduler = app.get(SchedulerService);
    notifService = app.get(NotificationService);
    db = app.get(DbService);
  });

  afterAll(async () => {
    await app.close();
    await truncateAll();
    await closePools();
  });

  it('1. Creating a task with future scheduled_for creates task as "scheduled" and step 1 as "pending"', async () => {
    const futureDate = new Date(Date.now() + 86400 * 1000 * 7).toISOString(); // 7 days in future

    const res = await http
      .post('/api/tasks')
      .set('Authorization', bearer(f.managerA))
      .send({
        name: 'Future Scheduled Video Task',
        type: 'video',
        description: 'Scheduled for next week',
        memberIds: [f.memberA1.id, f.memberA2.id],
        scheduledFor: futureDate,
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('scheduled');
    expect(res.body.scheduledFor).toBe(futureDate);
    expect(res.body.currentStepOrder).toBeNull(); // No active step yet
    expect(res.body.steps[0].status).toBe('pending');
    expect(res.body.steps[0].startedAt).toBeNull();
    expect(res.body.steps[1].status).toBe('pending');
  });

  it('2. Rejects scheduled_for greater than 365 days into the future', async () => {
    const wayTooFuture = new Date(Date.now() + 86400 * 1000 * 400).toISOString(); // 400 days

    const res = await http
      .post('/api/tasks')
      .set('Authorization', bearer(f.managerA))
      .send({
        name: 'Too Far Future Task',
        type: 'text',
        memberIds: [f.memberA1.id],
        scheduledFor: wayTooFuture,
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/365 days/i);
  });

  it('3. Scheduler activation transitions due task to "in_progress", activates step 1, and creates notifications', async () => {
    // 1. Create a task that was scheduled in the past (due now)
    const pastDate = new Date(Date.now() - 3600 * 1000).toISOString(); // 1 hr ago

    const createRes = await http
      .post('/api/tasks')
      .set('Authorization', bearer(f.managerA))
      .send({
        name: 'Due Scheduled Reel',
        type: 'video',
        memberIds: [f.memberA1.id, f.memberA2.id],
        scheduledFor: pastDate,
      });

    expect(createRes.status).toBe(201);
    const taskId = createRes.body.id;

    // Manually ensure status='scheduled' and step 1 is pending in DB to test scheduler transition
    await withTenant(ctxFor(f.managerA), async (c) => {
      await c.query(`UPDATE task SET status = 'scheduled', scheduled_for = $1 WHERE id = $2`, [pastDate, taskId]);
      await c.query(`UPDATE task_step SET status = 'pending', started_at = NULL WHERE task_id = $1`, [taskId]);
    });

    // 2. Trigger Scheduler Tick
    const { activatedCount } = await scheduler.runTick();
    expect(activatedCount).toBeGreaterThanOrEqual(1);

    // 3. Verify task is now in_progress and step 1 is active
    const taskRes = await http
      .get(`/api/tasks/${taskId}`)
      .set('Authorization', bearer(f.managerA));

    expect(taskRes.status).toBe(200);
    expect(taskRes.body.status).toBe('in_progress');
    expect(taskRes.body.currentStepOrder).toBe(1);
    expect(taskRes.body.steps[0].status).toBe('active');
    expect(taskRes.body.steps[0].startedAt).not.toBeNull();
    expect(taskRes.body.steps[1].status).toBe('pending');

    // 4. Verify in-app notifications created for Member A1 (assignee)
    const notifRes = await http
      .get('/api/notifications')
      .set('Authorization', bearer(f.memberA1));

    expect(notifRes.status).toBe(200);
    expect(notifRes.body.items.length).toBeGreaterThan(0);
    const activeNotif = notifRes.body.items.find((n: any) => n.data?.taskId === taskId);
    expect(activeNotif).toBeDefined();
    expect(activeNotif.type).toBe('step_activated');
  });

  it('4. Scheduler runTick() is idempotent and does not double-activate', async () => {
    // Run tick again
    const { activatedCount } = await scheduler.runTick();
    expect(activatedCount).toBe(0);
  });

  it('5. Atomic CAS defense: activateSingleTask returns false when called on an already-activated task', async () => {
    // Read an already activated (in_progress) task
    const tasks = await withTenant(ctxFor(f.managerA), async (c) => {
      const { rows } = await c.query(
        `SELECT id, org_id, manager_id, created_by_user_id, name FROM task WHERE status = 'in_progress' LIMIT 1`,
      );
      return rows;
    });
    expect(tasks.length).toBeGreaterThan(0);
    const candidate = tasks[0];

    // Attempting activation on this task (which is already in_progress) must return false due to status = 'scheduled' condition
    const activated = await (scheduler as any).activateSingleTask(candidate);
    expect(activated).toBe(false);
  });
});
