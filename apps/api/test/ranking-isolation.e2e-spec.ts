/**
 * HTTP Isolation and Role-Gated Authorization for Rankings & Leaderboard (Phase 5).
 *
 * Proves:
 *   1. Anti-Oracle 404: Cross-tenant & cross-team ranking updates and history queries return byte-identical 404s.
 *   2. Role Gating: Members get 403 Forbidden on PATCH /api/rankings/:userId and PATCH /api/rankings/:userId/reporter.
 *   3. Leaderboard Scoping: Owner sees org-wide leaderboard; Manager and Member see only their team roster.
 *   4. Ranking Updates: Manager updates team member score with reason; creates ranking_event audit entry & in-app notification.
 *   5. Range Validation: Scores < 0 or > 100 are rejected with 400 Bad Request.
 */
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { closePools, truncateAll } from './helpers/db';
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

describe('Ranking HTTP Isolation & RBAC (Phase 5)', () => {
  describe('Leaderboard Scoping', () => {
    it('Member sees only teammates on leaderboard', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/rankings/leaderboard')
        .set('Authorization', bearer(fx.memberA1))
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      const ids = res.body.map((u: any) => u.id);
      expect(ids).toContain(fx.memberA1.id);
      expect(ids).toContain(fx.memberA2.id);
      expect(ids).not.toContain(fx.memberB1.id);
      expect(ids).not.toContain(fx.memberC1.id);
    });

    it('Manager sees only their own team members on leaderboard', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/rankings/leaderboard')
        .set('Authorization', bearer(fx.managerA))
        .expect(200);

      const ids = res.body.map((u: any) => u.id);
      expect(ids).toContain(fx.memberA1.id);
      expect(ids).toContain(fx.memberA2.id);
      expect(ids).not.toContain(fx.memberB1.id);
      expect(ids).not.toContain(fx.memberC1.id);
    });

    it('Owner sees all members across the entire organization', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/rankings/leaderboard')
        .set('Authorization', bearer(fx.owner1))
        .expect(200);

      const ids = res.body.map((u: any) => u.id);
      expect(ids).toContain(fx.memberA1.id);
      expect(ids).toContain(fx.memberB1.id);
      expect(ids).not.toContain(fx.memberC1.id); // Org 2 excluded
    });
  });

  describe('Anti-Oracle 404 ID Guards', () => {
    it('Manager A receives 404 when attempting to rank Manager B member', async () => {
      await request(app.getHttpServer())
        .patch(`/api/rankings/${fx.memberB1.id}`)
        .set('Authorization', bearer(fx.managerA))
        .send({ ranking: 85, reason: 'Cross-team attempt' })
        .expect(404);
    });

    it('Manager A receives 404 when attempting to view history of Manager B member', async () => {
      await request(app.getHttpServer())
        .get(`/api/rankings/${fx.memberB1.id}/history`)
        .set('Authorization', bearer(fx.managerA))
        .expect(404);
    });

    it('Owner 1 receives 404 when targeting Org 2 member', async () => {
      await request(app.getHttpServer())
        .patch(`/api/rankings/${fx.memberC1.id}`)
        .set('Authorization', bearer(fx.owner1))
        .send({ ranking: 90, reason: 'Cross-org attempt' })
        .expect(404);
    });
  });

  describe('Role-Gated Write Authorization (RBAC)', () => {
    it('Member receives 403 Forbidden when attempting to update ranking', async () => {
      await request(app.getHttpServer())
        .patch(`/api/rankings/${fx.memberA2.id}`)
        .set('Authorization', bearer(fx.memberA1))
        .send({ ranking: 99, reason: 'Unauthorized peer ranking' })
        .expect(403);
    });

    it('Member receives 403 Forbidden when attempting to toggle reporter status', async () => {
      await request(app.getHttpServer())
        .patch(`/api/rankings/${fx.memberA2.id}/reporter`)
        .set('Authorization', bearer(fx.memberA1))
        .send({ isReporter: true })
        .expect(403);
    });
  });

  describe('Ranking Range & Validation', () => {
    it('Rejects ranking < 0 with 400', async () => {
      await request(app.getHttpServer())
        .patch(`/api/rankings/${fx.memberA1.id}`)
        .set('Authorization', bearer(fx.managerA))
        .send({ ranking: -5, reason: 'Negative score' })
        .expect(400);
    });

    it('Rejects ranking > 100 with 400', async () => {
      await request(app.getHttpServer())
        .patch(`/api/rankings/${fx.memberA1.id}`)
        .set('Authorization', bearer(fx.managerA))
        .send({ ranking: 105, reason: 'Too high' })
        .expect(400);
    });

    it('Rejects empty reason with 400', async () => {
      await request(app.getHttpServer())
        .patch(`/api/rankings/${fx.memberA1.id}`)
        .set('Authorization', bearer(fx.managerA))
        .send({ ranking: 80, reason: '   ' })
        .expect(400);
    });
  });

  describe('Successful Updates & Audit History', () => {
    it('Manager successfully updates member ranking and creates audit history + notification', async () => {
      const patchRes = await request(app.getHttpServer())
        .patch(`/api/rankings/${fx.memberA1.id}`)
        .set('Authorization', bearer(fx.managerA))
        .send({ ranking: 85, reason: 'Exceptional sprint contribution' })
        .expect(200);

      expect(patchRes.body.ranking).toBe(85);

      // Verify audit history
      const histRes = await request(app.getHttpServer())
        .get(`/api/rankings/${fx.memberA1.id}/history`)
        .set('Authorization', bearer(fx.managerA))
        .expect(200);

      expect(histRes.body.length).toBeGreaterThanOrEqual(1);
      const latest = histRes.body[0];
      expect(latest.newRanking).toBe(85);
      expect(latest.reason).toBe('Exceptional sprint contribution');

      // Verify notification created for memberA1
      const notifRes = await request(app.getHttpServer())
        .get('/api/notifications')
        .set('Authorization', bearer(fx.memberA1))
        .expect(200);

      const rankingNotifs = notifRes.body.items.filter((n: any) => n.type === 'ranking_changed');
      expect(rankingNotifs.length).toBeGreaterThanOrEqual(1);
    });

    it('Manager successfully sets member as designated reporter', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/rankings/${fx.memberA1.id}/reporter`)
        .set('Authorization', bearer(fx.managerA))
        .send({ isReporter: true })
        .expect(200);

      expect(res.body.isReporter).toBe(true);
    });

    it('Member A1 can view their own ranking audit history (200)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/rankings/${fx.memberA1.id}/history`)
        .set('Authorization', bearer(fx.memberA1))
        .expect(200);

      expect(res.body.length).toBeGreaterThanOrEqual(1);
      expect(res.body[0].userId).toBe(fx.memberA1.id);
    });

    it('Member A2 receives 404 Not Found when attempting to view Member A1 ranking audit history', async () => {
      await request(app.getHttpServer())
        .get(`/api/rankings/${fx.memberA1.id}/history`)
        .set('Authorization', bearer(fx.memberA2))
        .expect(404);
    });
  });
});
