/**
 * The HTTP-layer isolation gate and workflow execution proof (CLAUDE.md §11).
 *
 * Covers:
 *   1. Task creation (POST /api/tasks):
 *      - Manager assignment to own team.
 *      - Owner assignment to a whole Team, to a Manager, or to a specific Member.
 *      - Rejection of duplicate memberIds ([A1, A2, A1] -> 400).
 *      - Cross-tenant / cross-team member rejection.
 *      - Member creation rejection (403).
 *   2. Collection read (GET /api/tasks): RLS-scoped collection sets for Owner, Manager, Member.
 *   3. Read-by-ID (GET /api/tasks/:id): Uniform 404 on cross-tenant / cross-org ID guessing.
 *   4. Forward action (POST /api/tasks/:id/forward): Step progression, active assignee enforcement,
 *      task completion auto-flip.
 *   5. Member -> Member Peer Hand-off:
 *      - Early redirect to a later-scheduled peer (deduplication & promotion).
 *      - Hand-off to an unscheduled peer in the same team.
 *      - Rejection of self hand-off (400) and cross-team hand-off (400).
 *      - Rejection of non-assignee hand-off (403).
 *   6. Write-authorization enforcement & sabotage resistance.
 *   7. Concurrent forward & hand-off race condition tests (atomicity proof).
 *   8. Audit log traceability (task.created, task_step.forwarded, task_step.handed_off, task.completed).
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import { hash } from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { closePools, truncateAll, withTenant } from './helpers/db';
import { ctxFor, seedFixture, TEST_PASSWORD, type Fixture, type SeededUser } from './helpers/seed';
import { bearer } from './helpers/token';

jest.setTimeout(30_000);

let app: INestApplication;
let http: ReturnType<typeof request>;
let fx: Fixture;

async function seedExtraMember(
  manager: SeededUser,
  teamId: string,
  label: string,
): Promise<SeededUser> {
  const memberId = randomUUID();
  const email = `member.${label.toLowerCase()}@${manager.orgId.slice(0, 8)}.test`;
  const passwordHash = await hash(TEST_PASSWORD, 4);

  return await withTenant({ orgId: manager.orgId, role: 'owner', managerId: null }, async (c) => {
    await c.query(
      `INSERT INTO "user"
         (id, org_id, role, name, email, password_hash, manager_id, team_id, role_title)
       VALUES ($1, $2, 'member', $3, $4, $5, $6, $7, $8)`,
      [memberId, manager.orgId, `Member ${label}`, email, passwordHash, manager.id, teamId, 'Contributor'],
    );
    return {
      id: memberId,
      email,
      role: 'member',
      orgId: manager.orgId,
      managerId: manager.id,
      teamId,
    };
  });
}

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

  it('rejects duplicate memberIds in a single relay ([A1, A2, A1]) with 400', async () => {
    const res = await http
      .post('/api/tasks')
      .set('Authorization', bearer(fx.managerA))
      .send({
        name: 'Duplicate Relay Task',
        type: 'text',
        memberIds: [fx.memberA1.id, fx.memberA2.id, fx.memberA1.id],
      })
      .expect(400);

    expect(res.body.message).toMatch(/cannot be assigned to multiple steps/i);
  });

  it('allows Owner 1 to assign a task to Team A (Owner -> Team)', async () => {
    const res = await http
      .post('/api/tasks')
      .set('Authorization', bearer(fx.owner1))
      .send({
        name: 'Owner Team Task',
        type: 'text',
        teamId: fx.teamAId,
        memberIds: [fx.memberA1.id, fx.memberA2.id],
      })
      .expect(201);

    expect(res.body).toMatchObject({
      name: 'Owner Team Task',
      teamId: fx.teamAId,
      status: 'in_progress',
      totalSteps: 2,
      currentStepOrder: 1,
      currentAssignee: { id: fx.memberA1.id },
    });
  });

  it('allows Owner 1 to assign a task directly to Manager A (Owner -> Manager)', async () => {
    const res = await http
      .post('/api/tasks')
      .set('Authorization', bearer(fx.owner1))
      .send({
        name: 'Owner Manager Direct Task',
        type: 'file',
        targetManagerId: fx.managerA.id,
      })
      .expect(201);

    expect(res.body).toMatchObject({
      name: 'Owner Manager Direct Task',
      status: 'in_progress',
      totalSteps: 1,
      currentStepOrder: 1,
      currentAssignee: { id: fx.managerA.id },
    });
    expect(res.body.steps).toHaveLength(1);
    expect(res.body.steps[0]).toMatchObject({
      assignedUserId: fx.managerA.id,
      stepOrder: 1,
      status: 'active',
    });
  });

  it('allows Owner 1 to assign a task directly to Member A1 (Owner -> Member)', async () => {
    const res = await http
      .post('/api/tasks')
      .set('Authorization', bearer(fx.owner1))
      .send({
        name: 'Owner Member Direct Task',
        type: 'text',
        targetMemberId: fx.memberA1.id,
      })
      .expect(201);

    expect(res.body).toMatchObject({
      name: 'Owner Member Direct Task',
      teamId: fx.teamAId,
      status: 'in_progress',
      totalSteps: 1,
      currentStepOrder: 1,
      currentAssignee: { id: fx.memberA1.id },
    });
    expect(res.body.steps[0]).toMatchObject({
      assignedUserId: fx.memberA1.id,
      stepOrder: 1,
      status: 'active',
    });
  });

  it('rejects Owner 1 assigning to Team C / Org 2 with 400', async () => {
    const res = await http
      .post('/api/tasks')
      .set('Authorization', bearer(fx.owner1))
      .send({
        name: 'Cross Org Team Task',
        type: 'text',
        teamId: fx.teamCId,
      })
      .expect(400);

    expect(res.body.message).toMatch(/target team not found/i);
  });

  it('rejects Owner 1 assigning to Manager C / Org 2 with 400', async () => {
    const res = await http
      .post('/api/tasks')
      .set('Authorization', bearer(fx.owner1))
      .send({
        name: 'Cross Org Manager Task',
        type: 'text',
        targetManagerId: fx.managerC.id,
      })
      .expect(400);

    expect(res.body.message).toMatch(/target manager not found/i);
  });

  it('rejects Owner 1 assigning to Member C1 / Org 2 with 400', async () => {
    const res = await http
      .post('/api/tasks')
      .set('Authorization', bearer(fx.owner1))
      .send({
        name: 'Cross Org Member Task',
        type: 'text',
        targetMemberId: fx.memberC1.id,
      })
      .expect(400);

    expect(res.body.message).toMatch(/target member not found/i);
  });

  it('rejects Owner specifying multiple targets together (teamId + targetManagerId) with 400', async () => {
    const res = await http
      .post('/api/tasks')
      .set('Authorization', bearer(fx.owner1))
      .send({
        name: 'Multiple Targets Task',
        type: 'text',
        teamId: fx.teamAId,
        targetManagerId: fx.managerA.id,
      })
      .expect(400);

    expect(res.body.message).toMatch(/must specify exactly one target/i);
  });

  it('rejects Owner specifying no targets with 400', async () => {
    const res = await http
      .post('/api/tasks')
      .set('Authorization', bearer(fx.owner1))
      .send({
        name: 'No Target Task',
        type: 'text',
      })
      .expect(400);

    expect(res.body.message).toMatch(/must specify exactly one target/i);
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

describe('POST /api/tasks/:id/forward — Sequential Forward, Peer Hand-Off & Deduplication', () => {
  let task3StepId: string;
  let memberA3: SeededUser;

  beforeEach(async () => {
    memberA3 = await seedExtraMember(fx.managerA, fx.teamAId, 'A3');

    // 3-step relay: Member A1 -> Member A2 -> Member A3
    const res = await http
      .post('/api/tasks')
      .set('Authorization', bearer(fx.managerA))
      .send({
        name: 'Relay Workflow 3-Step',
        type: 'text',
        memberIds: [fx.memberA1.id, fx.memberA2.id, memberA3.id],
      })
      .expect(201);
    task3StepId = res.body.id;
  });

  it('allows active assignee (Member A1) to sequentially forward Step 1 -> Step 2', async () => {
    const res = await http
      .post(`/api/tasks/${task3StepId}/forward`)
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

  it('peer hand-off: active Member A1 hands off early to Member A3 (scheduled at Step 3) with deduplication', async () => {
    const res = await http
      .post(`/api/tasks/${task3StepId}/forward`)
      .set('Authorization', bearer(fx.memberA1))
      .send({ targetUserId: memberA3.id })
      .expect(200);

    expect(res.body.status).toBe('in_progress');
    expect(res.body.completedSteps).toBe(1);
    expect(res.body.totalSteps).toBe(3);
    expect(res.body.currentStepOrder).toBe(2);
    expect(res.body.currentAssignee.id).toBe(memberA3.id);

    // Step 1: Member A1 completed
    expect(res.body.steps[0]).toMatchObject({
      stepOrder: 1,
      assignedUserId: fx.memberA1.id,
      status: 'completed',
    });
    // Step 2: Member A3 active (promoted from later step)
    expect(res.body.steps[1]).toMatchObject({
      stepOrder: 2,
      assignedUserId: memberA3.id,
      status: 'active',
    });
    expect(res.body.steps[1].startedAt).toBeTruthy();
    // Step 3: Member A2 pending (shifted down from step 2)
    expect(res.body.steps[2]).toMatchObject({
      stepOrder: 3,
      assignedUserId: fx.memberA2.id,
      status: 'pending',
    });

    // Zero duplicate step 4 for A3
    expect(res.body.steps).toHaveLength(3);
  });

  it('peer hand-off: active Member A1 hands off to a new teammate -> splices step', async () => {
    // 2-step task: A1 -> A2
    const taskRes = await http
      .post('/api/tasks')
      .set('Authorization', bearer(fx.managerA))
      .send({
        name: '2-Step Task',
        type: 'text',
        memberIds: [fx.memberA1.id, fx.memberA2.id],
      })
      .expect(201);
    const taskId = taskRes.body.id;

    // Member A1 hands off to Member A3 (who was not in the original 2-step chain)
    const handoffRes = await http
      .post(`/api/tasks/${taskId}/forward`)
      .set('Authorization', bearer(fx.memberA1))
      .send({ targetUserId: memberA3.id })
      .expect(200);

    expect(handoffRes.body.totalSteps).toBe(3);
    expect(handoffRes.body.completedSteps).toBe(1);
    expect(handoffRes.body.currentStepOrder).toBe(2);
    expect(handoffRes.body.currentAssignee.id).toBe(memberA3.id);

    expect(handoffRes.body.steps[0]).toMatchObject({
      stepOrder: 1,
      assignedUserId: fx.memberA1.id,
      status: 'completed',
    });
    expect(handoffRes.body.steps[1]).toMatchObject({
      stepOrder: 2,
      assignedUserId: memberA3.id,
      status: 'active',
    });
    expect(handoffRes.body.steps[2]).toMatchObject({
      stepOrder: 3,
      assignedUserId: fx.memberA2.id,
      status: 'pending',
    });
  });

  it('rejects self hand-off (A1 -> A1) with 400 Bad Request', async () => {
    const res = await http
      .post(`/api/tasks/${task3StepId}/forward`)
      .set('Authorization', bearer(fx.memberA1))
      .send({ targetUserId: fx.memberA1.id })
      .expect(400);

    expect(res.body.message).toMatch(/cannot hand off.*to yourself/i);
  });

  it('rejects Member A1 trying to hand off to Manager A with 400 Bad Request', async () => {
    const res = await http
      .post(`/api/tasks/${task3StepId}/forward`)
      .set('Authorization', bearer(fx.memberA1))
      .send({ targetUserId: fx.managerA.id })
      .expect(400);

    expect(res.body.message).toMatch(/target user must be a member/i);
  });

  it('rejects cross-team hand-off (A1 -> B1) with 400 Bad Request', async () => {
    const res = await http
      .post(`/api/tasks/${task3StepId}/forward`)
      .set('Authorization', bearer(fx.memberA1))
      .send({ targetUserId: fx.memberB1.id })
      .expect(400);

    expect(res.body.message).toMatch(/target user is not in the same team/i);
  });

  it('rejects Member A2 trying to hand off while Step 1 is active with 403', async () => {
    const res = await http
      .post(`/api/tasks/${task3StepId}/forward`)
      .set('Authorization', bearer(fx.memberA2))
      .send({ targetUserId: memberA3.id })
      .expect(403);

    expect(res.body.message).toMatch(/only the member currently holding the active step/i);
  });

  it('rejects Member B1 (other team) trying to forward Task A with 404 (uniform @OwnedResource)', async () => {
    await http
      .post(`/api/tasks/${task3StepId}/forward`)
      .set('Authorization', bearer(fx.memberB1))
      .expect(404);
  });

  it('completes the entire task when all steps are finished', async () => {
    // 1. Member A1 forwards Step 1
    await http
      .post(`/api/tasks/${task3StepId}/forward`)
      .set('Authorization', bearer(fx.memberA1))
      .expect(200);

    // 2. Member A2 forwards Step 2
    await http
      .post(`/api/tasks/${task3StepId}/forward`)
      .set('Authorization', bearer(fx.memberA2))
      .expect(200);

    // 3. Member A3 forwards Step 3 (final)
    const finalRes = await http
      .post(`/api/tasks/${task3StepId}/forward`)
      .set('Authorization', bearer(memberA3))
      .expect(200);

    expect(finalRes.body.status).toBe('completed');
    expect(finalRes.body.completedSteps).toBe(3);
    expect(finalRes.body.currentStepOrder).toBeNull();
    expect(finalRes.body.currentAssignee).toBeNull();
    expect(finalRes.body.steps[2].status).toBe('completed');

    // 4. Trying to forward again returns 409 Conflict
    await http
      .post(`/api/tasks/${task3StepId}/forward`)
      .set('Authorization', bearer(memberA3))
      .expect(409);
  });
});

describe('Concurrent Forward Race & Audit Log Traceability', () => {
  it('concurrent forward race: only one forward succeeds, second fails cleanly with 403', async () => {
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

  it('records distinct audit_log events: task.created, task_step.forwarded, task_step.handed_off, task.completed', async () => {
    const memberA3 = await seedExtraMember(fx.managerA, fx.teamAId, 'A3Audit');

    // 1. Manager A creates task
    const createRes = await http
      .post('/api/tasks')
      .set('Authorization', bearer(fx.managerA))
      .send({
        name: 'Audit Trace Task',
        type: 'text',
        memberIds: [fx.memberA1.id, fx.memberA2.id, memberA3.id],
      })
      .expect(201);
    const taskId = createRes.body.id;

    // 2. Member A1 peer hands off to Member A3
    await http
      .post(`/api/tasks/${taskId}/forward`)
      .set('Authorization', bearer(fx.memberA1))
      .send({ targetUserId: memberA3.id })
      .expect(200);

    // 3. Member A3 forwards sequentially to Member A2
    await http
      .post(`/api/tasks/${taskId}/forward`)
      .set('Authorization', bearer(memberA3))
      .expect(200);

    // 4. Member A2 completes final step
    await http
      .post(`/api/tasks/${taskId}/forward`)
      .set('Authorization', bearer(fx.memberA2))
      .expect(200);

    // 5. Query audit_log via Owner tenant context
    const ownerCtx = ctxFor(fx.owner1);
    await withTenant(ownerCtx, async (c) => {
      const logs = await c.query<{ action: string; actor_user_id: string; target_id: string }>(
        `SELECT action, actor_user_id, target_id FROM audit_log WHERE target_id = $1 ORDER BY created_at ASC`,
        [taskId],
      );

      const actions = logs.rows.map((r) => r.action);
      expect(actions).toContain('task.created');
      expect(actions).toContain('task_step.handed_off');
      expect(actions).toContain('task_step.forwarded');
      expect(actions).toContain('task.completed');

      // Verify actors recorded correctly
      const creationLog = logs.rows.find((r) => r.action === 'task.created');
      expect(creationLog?.actor_user_id).toBe(fx.managerA.id);

      const handoffLog = logs.rows.find((r) => r.action === 'task_step.handed_off');
      expect(handoffLog?.actor_user_id).toBe(fx.memberA1.id);

      const forwardLog = logs.rows.find((r) => r.action === 'task_step.forwarded');
      expect(forwardLog?.actor_user_id).toBe(memberA3.id);

      const completeLog = logs.rows.find((r) => r.action === 'task.completed');
      expect(completeLog?.actor_user_id).toBe(fx.memberA2.id);
    });
  });
});
