/**
 * The HTTP-layer isolation gate and workflow execution proof (CLAUDE.md §11).
 *
 * Covers:
 *   1. Task creation (POST /api/tasks): Role gating (Manager only in this cut),
 *      cross-tenant / cross-team member rejection.
 *   2. Collection read (GET /api/tasks): RLS-scoped collection sets for Owner, Manager, Member.
 *   3. Read-by-ID (GET /api/tasks/:id): Uniform 404 on cross-tenant / cross-org ID guessing.
 *   4. Forward action (POST /api/tasks/:id/forward): Step progression, active assignee enforcement,
 *      task completion auto-flip.
 *   5. Write-authorization enforcement & sabotage resistance.
 *   6. Concurrent forward race condition test (atomicity proof).
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { closePools, truncateAll, withTenant } from './helpers/db';
import { ctxFor, seedFixture, type Fixture } from './helpers/seed';
import { bearer } from './helpers/token';

jest.setTimeout(30_000);

let app: INestApplication;
let http: ReturnType<typeof request>;
let fx: Fixture;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  await app.init();
  http = request(app.getHttpServer());
});

afterAll(async () => {
  await app.close();
  await truncateAll();
  await closePools();
});

beforeEach(async () => {
  await truncateAll();
  fx = await seedFixture();
});

describe('POST /api/tasks — Creation & Relay Assembly', () => {
  it('allows Manager A to assign a 2-step relay to their team', async () => {
    const res = await http
      .post('/api/tasks')
      .set('Authorization', bearer(fx.managerA))
      .send({
        name: 'Brand Video',
        type: 'video',
        description: 'Create launch video',
        memberIds: [fx.memberA1.id, fx.memberA2.id],
      })
      .expect(201);

    expect(res.body).toMatchObject({
      name: 'Brand Video',
      type: 'video',
      description: 'Create launch video',
      status: 'in_progress',
      totalSteps: 2,
      completedSteps: 0,
      currentStepOrder: 1,
      currentAssignee: {
        id: fx.memberA1.id,
        name: expect.any(String),
      },
    });
    expect(res.body.steps).toHaveLength(2);
    expect(res.body.steps[0]).toMatchObject({
      assignedUserId: fx.memberA1.id,
      stepOrder: 1,
      status: 'active',
    });
    expect(res.body.steps[0].startedAt).toBeTruthy();
    expect(res.body.steps[1]).toMatchObject({
      assignedUserId: fx.memberA2.id,
      stepOrder: 2,
      status: 'pending',
    });
    expect(res.body.steps[1].startedAt).toBeNull();
  });

  it('rejects Owner with 403 Forbidden (Manager only for this cut)', async () => {
    await http
      .post('/api/tasks')
      .set('Authorization', bearer(fx.owner1))
      .send({
        name: 'Owner Task',
        type: 'text',
        memberIds: [fx.memberA1.id],
      })
      .expect(403);
  });

  it('rejects Member with 403 Forbidden', async () => {
    await http
      .post('/api/tasks')
      .set('Authorization', bearer(fx.memberA1))
      .send({
        name: 'Member Task',
        type: 'text',
        memberIds: [fx.memberA2.id],
      })
      .expect(403);
  });

  it('rejects unauthenticated request with 401', async () => {
    await http
      .post('/api/tasks')
      .send({
        name: 'Anon Task',
        type: 'text',
        memberIds: [fx.memberA1.id],
      })
      .expect(401);
  });

  it('rejects Manager A naming Member B1 (cross-manager, same org) with 400', async () => {
    const res = await http
      .post('/api/tasks')
      .set('Authorization', bearer(fx.managerA))
      .send({
        name: 'Cross Team Task',
        type: 'text',
        memberIds: [fx.memberA1.id, fx.memberB1.id],
      })
      .expect(400);

    expect(res.body.message).toMatch(/do not belong to your active team/i);
  });

  it('rejects Manager A naming Member C1 (cross-org) with 400', async () => {
    const res = await http
      .post('/api/tasks')
      .set('Authorization', bearer(fx.managerA))
      .send({
        name: 'Cross Org Task',
        type: 'text',
        memberIds: [fx.memberC1.id],
      })
      .expect(400);

    expect(res.body.message).toMatch(/do not belong to your active team/i);
  });
});

describe('GET /api/tasks & GET /api/tasks/:id — Isolation Gates (§11)', () => {
  let taskAId: string;
  let taskBId: string;

  beforeEach(async () => {
    // Seed Task A via Manager A
    const resA = await http
      .post('/api/tasks')
      .set('Authorization', bearer(fx.managerA))
      .send({
        name: 'Task Alpha',
        type: 'text',
        memberIds: [fx.memberA1.id, fx.memberA2.id],
      })
      .expect(201);
    taskAId = resA.body.id;

    // Seed Task B via Manager B
    const resB = await http
      .post('/api/tasks')
      .set('Authorization', bearer(fx.managerB))
      .send({
        name: 'Task Beta',
        type: 'file',
        memberIds: [fx.memberB1.id],
      })
      .expect(201);
    taskBId = resB.body.id;
  });

  it('Manager A list returns ONLY Task A', async () => {
    const res = await http
      .get('/api/tasks')
      .set('Authorization', bearer(fx.managerA))
      .expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(taskAId);
  });

  it('Member A1 list returns ONLY Task A', async () => {
    const res = await http
      .get('/api/tasks')
      .set('Authorization', bearer(fx.memberA1))
      .expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(taskAId);
  });

  it('Owner 1 list returns BOTH Task A and Task B', async () => {
    const res = await http
      .get('/api/tasks')
      .set('Authorization', bearer(fx.owner1))
      .expect(200);

    expect(res.body).toHaveLength(2);
    expect(res.body.map((t: { id: string }) => t.id).sort()).toEqual([taskAId, taskBId].sort());
  });

  it('Owner 2 / Manager C list returns empty (cross-org isolation)', async () => {
    const resOwner2 = await http
      .get('/api/tasks')
      .set('Authorization', bearer(fx.owner2))
      .expect(200);
    expect(resOwner2.body).toHaveLength(0);

    const resManagerC = await http
      .get('/api/tasks')
      .set('Authorization', bearer(fx.managerC))
      .expect(200);
    expect(resManagerC.body).toHaveLength(0);
  });

  it('Manager A reads Task A by ID -> 200 OK', async () => {
    const res = await http
      .get(`/api/tasks/${taskAId}`)
      .set('Authorization', bearer(fx.managerA))
      .expect(200);
    expect(res.body.id).toBe(taskAId);
    expect(res.body.steps).toHaveLength(2);
  });

  it('Manager A reads Task B by ID -> 404 (the classic §11 ID guessing gate)', async () => {
    await http
      .get(`/api/tasks/${taskBId}`)
      .set('Authorization', bearer(fx.managerA))
      .expect(404);
  });

  it('Member A1 reads Task B by ID -> 404', async () => {
    await http
      .get(`/api/tasks/${taskBId}`)
      .set('Authorization', bearer(fx.memberA1))
      .expect(404);
  });

  it('Non-existent UUID -> 404 (indistinguishable from cross-tenant guess)', async () => {
    await http
      .get(`/api/tasks/${randomUUID()}`)
      .set('Authorization', bearer(fx.managerA))
      .expect(404);
  });

  it('Malformed UUID -> 404', async () => {
    await http
      .get('/api/tasks/not-a-uuid')
      .set('Authorization', bearer(fx.managerA))
      .expect(404);
  });
});

describe('POST /api/tasks/:id/forward — Step Progression & Write Authorization', () => {
  let taskId: string;

  beforeEach(async () => {
    const res = await http
      .post('/api/tasks')
      .set('Authorization', bearer(fx.managerA))
      .send({
        name: 'Relay Workflow',
        type: 'text',
        memberIds: [fx.memberA1.id, fx.memberA2.id],
      })
      .expect(201);
    taskId = res.body.id;
  });

  it('allows active assignee (Member A1) to forward Step 1 -> advances to Step 2', async () => {
    const res = await http
      .post(`/api/tasks/${taskId}/forward`)
      .set('Authorization', bearer(fx.memberA1))
      .expect(200);

    expect(res.body.status).toBe('in_progress');
    expect(res.body.completedSteps).toBe(1);
    expect(res.body.currentStepOrder).toBe(2);
    expect(res.body.currentAssignee.id).toBe(fx.memberA2.id);

    expect(res.body.steps[0].status).toBe('completed');
    expect(res.body.steps[0].completedAt).toBeTruthy();
    expect(res.body.steps[1].status).toBe('active');
    expect(res.body.steps[1].startedAt).toBeTruthy();
  });

  it('rejects Member A2 trying to forward while Step 1 is active (assigned to A1) with 403', async () => {
    const res = await http
      .post(`/api/tasks/${taskId}/forward`)
      .set('Authorization', bearer(fx.memberA2))
      .expect(403);

    expect(res.body.message).toMatch(/only the member currently holding the active step/i);
  });

  it('rejects Manager A trying to forward a step assigned to a member with 403', async () => {
    const res = await http
      .post(`/api/tasks/${taskId}/forward`)
      .set('Authorization', bearer(fx.managerA))
      .expect(403);

    expect(res.body.message).toMatch(/only the member currently holding the active step/i);
  });

  it('rejects Member B1 (other team) trying to forward Task A with 404 (uniform @OwnedResource)', async () => {
    await http
      .post(`/api/tasks/${taskId}/forward`)
      .set('Authorization', bearer(fx.memberB1))
      .expect(404);
  });

  it('completes the entire task when the final step (Step 2) is forwarded', async () => {
    // 1. Member A1 forwards Step 1
    await http
      .post(`/api/tasks/${taskId}/forward`)
      .set('Authorization', bearer(fx.memberA1))
      .expect(200);

    // 2. Member A2 forwards Step 2 (final step)
    const finalRes = await http
      .post(`/api/tasks/${taskId}/forward`)
      .set('Authorization', bearer(fx.memberA2))
      .expect(200);

    expect(finalRes.body.status).toBe('completed');
    expect(finalRes.body.completedSteps).toBe(2);
    expect(finalRes.body.currentStepOrder).toBeNull();
    expect(finalRes.body.currentAssignee).toBeNull();
    expect(finalRes.body.steps[1].status).toBe('completed');
    expect(finalRes.body.steps[1].completedAt).toBeTruthy();

    // 3. Trying to forward again returns 409 Conflict
    await http
      .post(`/api/tasks/${taskId}/forward`)
      .set('Authorization', bearer(fx.memberA2))
      .expect(409);
  });
});

describe('Concurrent Forward Race & Write-Auth Sabotage Test', () => {
  it('concurrent forward race: only one forward succeeds, second fails cleanly', async () => {
    const res = await http
      .post('/api/tasks')
      .set('Authorization', bearer(fx.managerA))
      .send({
        name: 'Race Task',
        type: 'text',
        memberIds: [fx.memberA1.id, fx.memberA2.id],
      })
      .expect(201);
    const taskId = res.body.id;

    // Issue two simultaneous forwards from Member A1 for Step 1
    const [req1, req2] = await Promise.all([
      http.post(`/api/tasks/${taskId}/forward`).set('Authorization', bearer(fx.memberA1)),
      http.post(`/api/tasks/${taskId}/forward`).set('Authorization', bearer(fx.memberA1)),
    ]);

    const winner = req1.status === 200 ? req1 : req2;
    const loser = req1.status === 200 ? req2 : req1;

    // Exactly one 200 OK with RETURNING task payload
    expect(winner.status).toBe(200);
    expect(winner.body).toMatchObject({
      id: taskId,
      status: 'in_progress',
      completedSteps: 1,
      currentStepOrder: 2,
      currentAssignee: { id: fx.memberA2.id },
    });
    expect(winner.body.steps[0].status).toBe('completed');
    expect(winner.body.steps[1].status).toBe('active');

    // Exactly one 403 Forbidden with clean business rejection (not 500, not double-applied)
    expect(loser.status).toBe(403);
    expect(loser.body.message).toMatch(/only the member currently holding the active step/i);

    // Verify task state in database is cleanly at Step 2
    const verifyRes = await http
      .get(`/api/tasks/${taskId}`)
      .set('Authorization', bearer(fx.memberA1))
      .expect(200);

    expect(verifyRes.body.currentStepOrder).toBe(2);
    expect(verifyRes.body.completedSteps).toBe(1);
    expect(verifyRes.body.currentAssignee.id).toBe(fx.memberA2.id);
  });
});
