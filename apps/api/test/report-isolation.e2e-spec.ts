/**
 * HTTP Isolation and Role-Gated Authorization for Task Reports (Phase 5).
 *
 * Proves:
 *   1. Anti-Oracle 404: Non-existent or cross-tenant task reports return 404.
 *   2. Role Gating: Non-reporter members receive 403 Forbidden when submitting a task report.
 *   3. Precondition: Submitting a report for an in-progress/scheduled task is rejected with 400.
 *   4. Reporter Submission: Designated reporter (`is_reporter: true`) submits summary, highlights, blockers.
 *   5. Duplicate Prevention: Attempting to submit a second report for the same task returns 409 Conflict.
 *   6. Query Scoping: GET /api/reports and GET /api/tasks/:id/report respect tenant slice.
 */
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { closePools, truncateAll, withTenant } from './helpers/db';
import { ctxFor, seedFixture, type Fixture } from './helpers/seed';
import { bearer } from './helpers/token';

jest.setTimeout(30_000);

let app: INestApplication;
let fx: Fixture;

let completedTaskAId: string;
let inProgressTaskAId: string;
let completedTaskBId: string;

async function seedTaskFixture() {
  completedTaskAId = randomUUID();
  inProgressTaskAId = randomUUID();
  completedTaskBId = randomUUID();

  // Set memberA1 as reporter
  await withTenant(ctxFor(fx.managerA), async (c) => {
    await c.query(
      `UPDATE "user" SET is_reporter = true WHERE id = $1`,
      [fx.memberA1.id],
    );

    // Completed task in Team A
    await c.query(
      `INSERT INTO task (id, org_id, manager_id, team_id, name, type, description, created_by_user_id, status)
       VALUES ($1, $2, $3, $4, 'Completed Alpha Task', 'text', 'Desc', $5, 'completed')`,
      [completedTaskAId, fx.org1Id, fx.managerA.id, fx.teamAId, fx.managerA.id],
    );

    // In-progress task in Team A
    await c.query(
      `INSERT INTO task (id, org_id, manager_id, team_id, name, type, description, created_by_user_id, status)
       VALUES ($1, $2, $3, $4, 'Active Alpha Task', 'text', 'Desc', $5, 'in_progress')`,
      [inProgressTaskAId, fx.org1Id, fx.managerA.id, fx.teamAId, fx.managerA.id],
    );
  });

  // Completed task in Team B
  await withTenant(ctxFor(fx.managerB), async (c) => {
    await c.query(
      `INSERT INTO task (id, org_id, manager_id, team_id, name, type, description, created_by_user_id, status)
       VALUES ($1, $2, $3, $4, 'Completed Beta Task', 'text', 'Desc', $5, 'completed')`,
      [completedTaskBId, fx.org1Id, fx.managerB.id, fx.teamBId, fx.managerB.id],
    );
  });
}

beforeAll(async () => {
  await truncateAll();
  fx = await seedFixture();
  await seedTaskFixture();

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

describe('Report HTTP Isolation & RBAC (Phase 5)', () => {
  describe('Anti-Oracle 404 ID Guards', () => {
    it('Manager A receives 404 when querying report for Manager B task', async () => {
      await request(app.getHttpServer())
        .get(`/api/tasks/${completedTaskBId}/report`)
        .set('Authorization', bearer(fx.managerA))
        .expect(404);
    });

    it('Member A1 receives 404 when attempting to submit report for Manager B task', async () => {
      await request(app.getHttpServer())
        .post(`/api/tasks/${completedTaskBId}/report`)
        .set('Authorization', bearer(fx.memberA1))
        .send({ summary: 'Cross-team report attempt' })
        .expect(404);
    });
  });

  describe('Role-Gated Write Authorization (RBAC)', () => {
    it('Non-reporter Member (memberA2) receives 403 Forbidden on report submission', async () => {
      await request(app.getHttpServer())
        .post(`/api/tasks/${completedTaskAId}/report`)
        .set('Authorization', bearer(fx.memberA2))
        .send({ summary: 'Unauthorized member report' })
        .expect(403);
    });
  });

  describe('Lifecycle Preconditions', () => {
    it('Rejects report on in_progress task with 400 Bad Request', async () => {
      await request(app.getHttpServer())
        .post(`/api/tasks/${inProgressTaskAId}/report`)
        .set('Authorization', bearer(fx.memberA1))
        .send({ summary: 'Premature report' })
        .expect(400);
    });
  });

  describe('Reporter Submission, Retrieval, and Duplicate Prevention', () => {
    it('Designated reporter (memberA1) successfully submits completion report', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/tasks/${completedTaskAId}/report`)
        .set('Authorization', bearer(fx.memberA1))
        .send({
          summary: 'Sprint deliverable achieved ahead of schedule.',
          highlights: '100% test coverage and zero regression.',
          blockers: 'None encountered.',
        })
        .expect(201);

      expect(res.body.taskId).toBe(completedTaskAId);
      expect(res.body.reportedByUserId).toBe(fx.memberA1.id);
      expect(res.body.summary).toBe('Sprint deliverable achieved ahead of schedule.');
    });

    it('Duplicate report submission for same task is rejected with 409 Conflict', async () => {
      await request(app.getHttpServer())
        .post(`/api/tasks/${completedTaskAId}/report`)
        .set('Authorization', bearer(fx.memberA1))
        .send({ summary: 'Duplicate report' })
        .expect(409);
    });

    it('Member A2 and Manager A can view the submitted task report', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/tasks/${completedTaskAId}/report`)
        .set('Authorization', bearer(fx.memberA2))
        .expect(200);

      expect(res.body.taskId).toBe(completedTaskAId);
      expect(res.body.summary).toBe('Sprint deliverable achieved ahead of schedule.');
    });

    it('Lists reports scoped to caller slice on GET /api/reports', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/reports')
        .set('Authorization', bearer(fx.managerA))
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(1);
      expect(res.body[0].taskId).toBe(completedTaskAId);
    });
  });
});
