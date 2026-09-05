/**
 * Soft-Delete Safety, 30-Day Recovery, and Passcode Reset Tests (Phase 6).
 *
 * Proves:
 *   1. Active Step Member Deactivation Guard (CLAUDE.md §5):
 *      - Cannot deactivate member who holds active task steps (409 Conflict).
 *      - Soft deactivates once active step is completed (200 OK, deleted_at stamped).
 *   2. Manager Impact & Cascading Soft-Delete:
 *      - Pre-deletion impact returns member & task dependencies.
 *      - DELETE cascades soft-delete to manager, team, and members.
 *      - GET /api/auth/managers/deleted lists deleted manager in 30-day queue.
 *      - POST /api/auth/managers/:id/restore restores manager, team, and members.
 *   3. Anti-Oracle Passcode Reset:
 *      - POST /api/auth/passcode/request-reset returns identical 200 for unknown and existing accounts.
 *   4. Quotas:
 *      - GET /api/quotas returns tenant resource counts and limits.
 */
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { closePools, truncateAll, withTenant } from './helpers/db';
import { seedFixture, type Fixture } from './helpers/seed';
import { bearer } from './helpers/token';

jest.setTimeout(30_000);

let app: INestApplication;
let fx: Fixture;

beforeAll(async () => {
  await truncateAll();
  fx = await seedFixture();

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  await app.init();
});

afterAll(async () => {
  await app.close();
  await closePools();
});

describe('Phase 6: Polish & Hardening', () => {
  describe('Member Deactivation Safety (Active Steps Guard)', () => {
    let taskId: string;
    let stepId: string;

    beforeEach(async () => {
      taskId = randomUUID();
      stepId = randomUUID();

      // Ensure clean step state for memberA1 before creating new active step
      await withTenant({ orgId: fx.org1Id, role: 'manager', managerId: fx.managerA.id }, async (c) => {
        await c.query(
          `UPDATE task_step SET status = 'completed' WHERE assigned_user_id = $1 AND status = 'active'`,
          [fx.memberA1.id],
        );

        await c.query(
          `INSERT INTO task (id, org_id, manager_id, team_id, name, type, status, created_by_user_id)
           VALUES ($1, $2, $3, $4, 'Safety Test Task', 'text', 'in_progress', $3)`,
          [taskId, fx.org1Id, fx.managerA.id, fx.teamAId],
        );

        await c.query(
          `INSERT INTO task_step (id, org_id, manager_id, task_id, step_order, assigned_user_id, status)
           VALUES ($1, $2, $3, $4, 1, $5, 'active')`,
          [stepId, fx.org1Id, fx.managerA.id, taskId, fx.memberA1.id],
        );
      });
    });

    it('blocks deactivating member holding active task steps with 409 Conflict', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/auth/members/${fx.memberA1.id}`)
        .set('Authorization', bearer(fx.managerA))
        .expect(409);

      expect(res.body.message).toContain('Cannot deactivate member with active task steps');
    });

    it('blocks cross-manager member deactivation with 404 Not Found (RLS hidden target)', async () => {
      await request(app.getHttpServer())
        .delete(`/api/auth/members/${fx.memberA1.id}`)
        .set('Authorization', bearer(fx.managerB))
        .expect(404);
    });

    it('allows deactivating member after active step is completed', async () => {
      // Mark the active step as completed
      await withTenant({ orgId: fx.org1Id, role: 'manager', managerId: fx.managerA.id }, async (c) => {
        await c.query(
          `UPDATE task_step SET status = 'completed' WHERE id = $1`,
          [stepId],
        );
      });

      // Now deactivation should succeed
      await request(app.getHttpServer())
        .delete(`/api/auth/members/${fx.memberA1.id}`)
        .set('Authorization', bearer(fx.managerA))
        .expect(200);

      // Verify member row is inactive and deleted_at is stamped
      const memberRow = await withTenant(
        { orgId: fx.org1Id, role: 'owner', managerId: null },
        async (c) => {
          const r = await c.query<{ status: string; deleted_at: Date | null }>(
            `SELECT status, deleted_at FROM "user" WHERE id = $1`,
            [fx.memberA1.id],
          );
          return r.rows[0];
        },
      );

      expect(memberRow.status).toBe('inactive');
      expect(memberRow.deleted_at).not.toBeNull();
    });
  });

  describe('Manager Impact, Cascading Soft-Delete, and 30-Day Recovery', () => {
    it('returns manager pre-deletion impact analysis', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/auth/managers/${fx.managerB.id}/impact`)
        .set('Authorization', bearer(fx.owner1))
        .expect(200);

      expect(res.body).toHaveProperty('memberCount');
      expect(res.body).toHaveProperty('activeTaskCount');
      expect(res.body).toHaveProperty('teamName');
      expect(res.body.memberCount).toBeGreaterThanOrEqual(1);
    });

    it('deleteManager is rejected when a team member holds an active step', async () => {
      const taskBId = randomUUID();
      const stepBId = randomUUID();

      // Create an active task and active step assigned to memberB1 (under managerB)
      await withTenant({ orgId: fx.org1Id, role: 'manager', managerId: fx.managerB.id }, async (c) => {
        await c.query(
          `INSERT INTO task (id, org_id, manager_id, team_id, name, type, status, created_by_user_id)
           VALUES ($1, $2, $3, $4, 'Active Member Task', 'text', 'in_progress', $3)`,
          [taskBId, fx.org1Id, fx.managerB.id, fx.teamBId],
        );

        await c.query(
          `INSERT INTO task_step (id, org_id, manager_id, task_id, step_order, assigned_user_id, status)
           VALUES ($1, $2, $3, $4, 1, $5, 'active')`,
          [stepBId, fx.org1Id, fx.managerB.id, taskBId, fx.memberB1.id],
        );
      });

      // Owner attempts to delete managerB while memberB1 holds an active step -> 409 Conflict
      const res = await request(app.getHttpServer())
        .delete(`/api/auth/managers/${fx.managerB.id}`)
        .set('Authorization', bearer(fx.owner1))
        .expect(409);

      expect(res.body.message).toContain('Cannot delete manager while team members hold active task steps');
      expect(res.body.message).toContain('Active Member Task');

      // Complete the active step so subsequent cascading soft-delete tests succeed
      await withTenant({ orgId: fx.org1Id, role: 'manager', managerId: fx.managerB.id }, async (c) => {
        await c.query(
          `UPDATE task_step SET status = 'completed' WHERE id = $1`,
          [stepBId],
        );
      });
    });

    it('cascades soft-delete to manager, team, and members', async () => {
      // Delete managerB
      await request(app.getHttpServer())
        .delete(`/api/auth/managers/${fx.managerB.id}`)
        .set('Authorization', bearer(fx.owner1))
        .expect(200);

      // Verify managerB is inactive and deleted_at is set
      const state = await withTenant(
        { orgId: fx.org1Id, role: 'owner', managerId: null },
        async (c) => {
          const mgr = await c.query('SELECT status, deleted_at FROM "user" WHERE id = $1', [fx.managerB.id]);
          const tm = await c.query('SELECT status, deleted_at FROM team WHERE manager_id = $1', [fx.managerB.id]);
          const mems = await c.query('SELECT status, deleted_at FROM "user" WHERE manager_id = $1 AND role = \'member\'', [fx.managerB.id]);
          return { mgr: mgr.rows[0], tm: tm.rows[0], mems: mems.rows };
        },
      );

      expect(state.mgr.status).toBe('inactive');
      expect(state.mgr.deleted_at).not.toBeNull();
      expect(state.tm.status).toBe('deleted');
      expect(state.tm.deleted_at).not.toBeNull();
      expect(state.mems.every((m: any) => m.status === 'inactive' && m.deleted_at !== null)).toBe(true);
    });

    it('lists soft-deleted managers in recently deleted queue', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/auth/managers/deleted')
        .set('Authorization', bearer(fx.owner1))
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      const deletedManagerIds = res.body.map((m: any) => m.id);
      expect(deletedManagerIds).toContain(fx.managerB.id);
      const mgrB = res.body.find((m: any) => m.id === fx.managerB.id);
      expect(mgrB.expiresInDays).toBe(30);
    });

    it('restores soft-deleted manager, team, and members with 1-click restore', async () => {
      await request(app.getHttpServer())
        .post(`/api/auth/managers/${fx.managerB.id}/restore`)
        .set('Authorization', bearer(fx.owner1))
        .expect(200);

      // Verify managerB, team, and members are active and deleted_at is NULL
      const state = await withTenant(
        { orgId: fx.org1Id, role: 'owner', managerId: null },
        async (c) => {
          const mgr = await c.query('SELECT status, deleted_at FROM "user" WHERE id = $1', [fx.managerB.id]);
          const tm = await c.query('SELECT status, deleted_at FROM team WHERE manager_id = $1', [fx.managerB.id]);
          const mems = await c.query('SELECT status, deleted_at FROM "user" WHERE manager_id = $1 AND role = \'member\'', [fx.managerB.id]);
          return { mgr: mgr.rows[0], tm: tm.rows[0], mems: mems.rows };
        },
      );

      expect(state.mgr.status).toBe('active');
      expect(state.mgr.deleted_at).toBeNull();
      expect(state.tm.status).toBe('active');
      expect(state.tm.deleted_at).toBeNull();
      expect(state.mems.every((m: any) => m.status === 'active' && m.deleted_at === null)).toBe(true);
    });
  });

  describe('Self-Service Passcode Recovery (Forgot Passcode)', () => {
    it('returns identical 200 message for non-existent email', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/passcode/request-reset')
        .send({ email: 'unknown-nonexistent@relay.test' })
        .expect(200);

      expect(res.body.message).toContain('If an eligible account exists with that email');
    });

    it('returns identical 200 message and resets passcode for valid member account', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/passcode/request-reset')
        .send({ email: fx.memberB2.email })
        .expect(200);

      expect(res.body.message).toContain('If an eligible account exists with that email');

      // Verify passcode_expires_at is set in the future
      const row = await withTenant(
        { orgId: fx.org1Id, role: 'owner', managerId: null },
        async (c) => {
          const r = await c.query('SELECT passcode_hash, passcode_expires_at FROM "user" WHERE id = $1', [fx.memberB2.id]);
          return r.rows[0];
        },
      );

      expect(row.passcode_hash).not.toBeNull();
      expect(new Date(row.passcode_expires_at).getTime()).toBeGreaterThan(Date.now());
    });

    it('revokes existing refresh-token sessions when a passcode reset is requested (compromised account safety)', async () => {
      // 1. Seed an active refresh token for memberB1
      const tokenId = randomUUID();
      await withTenant({ orgId: fx.org1Id, role: 'owner', managerId: null }, async (c) => {
        await c.query(
          `INSERT INTO refresh_token (id, user_id, token_hash, family_id, expires_at)
           VALUES ($1, $2, 'dummy_token_hash', $1, now() + interval '30 days')`,
          [tokenId, fx.memberB1.id],
        );
      });

      // 2. Trigger passcode reset for memberB1
      await request(app.getHttpServer())
        .post('/api/auth/passcode/request-reset')
        .send({ email: fx.memberB1.email })
        .expect(200);

      // 3. Verify the existing refresh token has been revoked
      const tokenRow = await withTenant(
        { orgId: fx.org1Id, role: 'owner', managerId: null },
        async (c) => {
          const r = await c.query<{ revoked_at: Date | null }>(
            'SELECT revoked_at FROM refresh_token WHERE id = $1',
            [tokenId],
          );
          return r.rows[0];
        },
      );

      expect(tokenRow.revoked_at).not.toBeNull();
    });

    it('rate-limits excessive reset attempts on one account with 429 Too Many Requests', async () => {
      const email = 'throttle.reset@relay.test';
      const statuses: number[] = [];

      for (let i = 0; i < 6; i++) {
        const res = await request(app.getHttpServer())
          .post('/api/auth/passcode/request-reset')
          .send({ email });
        statuses.push(res.status);
      }

      // First 5 attempts succeed (LOGIN_THROTTLE_LIMIT = 5), 6th attempt is throttled (429)
      expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
      expect(statuses[5]).toBe(429);
    });
  });

  describe('Organization Quotas', () => {
    it('returns tenant resource quotas and usage', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/quotas')
        .set('Authorization', bearer(fx.owner1))
        .expect(200);

      expect(res.body).toHaveProperty('teams');
      expect(res.body).toHaveProperty('members');
      expect(res.body).toHaveProperty('activeTasks');
      expect(res.body.teams).toHaveProperty('current');
      expect(res.body.teams).toHaveProperty('limit');
      expect(res.body.members).toHaveProperty('current');
      expect(res.body.members).toHaveProperty('limit');
    });

    it('rejects manager with 403 Forbidden', async () => {
      await request(app.getHttpServer())
        .get('/api/quotas')
        .set('Authorization', bearer(fx.managerA))
        .expect(403);
    });

    it('rejects member with 403 Forbidden', async () => {
      await request(app.getHttpServer())
        .get('/api/quotas')
        .set('Authorization', bearer(fx.memberA2))
        .expect(403);
    });
  });
});
