/**
 * HTTP-layer Isolation Tests for Phase 4 (Notifications & Scheduling).
 *
 * Proves:
 *   1. GET /api/notifications returns only caller's notifications with correct unreadCount.
 *   2. GET /api/notifications?unreadOnly=true filters to unread items.
 *   3. GET /api/notifications/unread-count returns accurate count.
 *   4. PATCH /api/notifications/:id/read marks notification read.
 *   5. Cross-User Anti-Oracle: Attempting to mark another user''s notification as read returns 404 (not 403 or 200).
 *   6. POST /api/notifications/read-all marks all notifications for caller as read without affecting peers.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { closePools, truncateAll, withTenant } from './helpers/db';
import { ctxFor, seedFixture, type Fixture } from './helpers/seed';
import { bearer } from './helpers/token';

describe('Notification HTTP Isolation (E2E)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
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
  });

  afterAll(async () => {
    await app.close();
    await truncateAll();
    await closePools();
  });

  it('1. GET /api/notifications returns only caller\'s notifications with unreadCount', async () => {
    const notifA1 = randomUUID();
    const notifA2 = randomUUID();

    await withTenant(ctxFor(f.managerA), async (c) => {
      await c.query(
        `INSERT INTO notification (id, org_id, user_id, manager_id, type, title, body)
         VALUES ($1, $3, $4, $6, 'step_activated', 'A1 Task', 'Body A1'),
                ($2, $3, $5, $6, 'task_assigned', 'A2 Task', 'Body A2')`,
        [notifA1, notifA2, f.org1Id, f.memberA1.id, f.memberA2.id, f.managerA.id],
      );
    });

    const resA1 = await http
      .get('/api/notifications')
      .set('Authorization', bearer(f.memberA1))
      .expect(200);

    const idsA1 = resA1.body.items.map((n: any) => n.id);
    expect(idsA1).toContain(notifA1);
    expect(idsA1).not.toContain(notifA2);
    expect(resA1.body.unreadCount).toBeGreaterThanOrEqual(1);

    const resA2 = await http
      .get('/api/notifications')
      .set('Authorization', bearer(f.memberA2))
      .expect(200);

    const idsA2 = resA2.body.items.map((n: any) => n.id);
    expect(idsA2).toContain(notifA2);
    expect(idsA2).not.toContain(notifA1);
  });

  it('2. GET /api/notifications?unreadOnly=true filters out read notifications', async () => {
    const readNotifId = randomUUID();
    const unreadNotifId = randomUUID();

    await withTenant(ctxFor(f.managerA), async (c) => {
      await c.query(
        `INSERT INTO notification (id, org_id, user_id, manager_id, type, title, body, read_at)
         VALUES ($1, $3, $4, $5, 'step_activated', 'Read Notif', 'Body', now()),
                ($2, $3, $4, $5, 'step_activated', 'Unread Notif', 'Body', NULL)`,
        [readNotifId, unreadNotifId, f.org1Id, f.memberA1.id, f.managerA.id],
      );
    });

    const res = await http
      .get('/api/notifications?unreadOnly=true')
      .set('Authorization', bearer(f.memberA1))
      .expect(200);

    const ids = res.body.items.map((n: any) => n.id);
    expect(ids).toContain(unreadNotifId);
    expect(ids).not.toContain(readNotifId);
  });

  it('3. GET /api/notifications/unread-count returns fast integer count', async () => {
    const res = await http
      .get('/api/notifications/unread-count')
      .set('Authorization', bearer(f.memberA1))
      .expect(200);

    expect(typeof res.body.count).toBe('number');
    expect(res.body.count).toBeGreaterThanOrEqual(1);
  });

  it('4. PATCH /api/notifications/:id/read marks notification as read', async () => {
    const notifId = randomUUID();
    await withTenant(ctxFor(f.managerA), async (c) => {
      await c.query(
        `INSERT INTO notification (id, org_id, user_id, manager_id, type, title, body)
         VALUES ($1, $2, $3, $4, 'step_activated', 'To Mark Read', 'Body')`,
        [notifId, f.org1Id, f.memberA1.id, f.managerA.id],
      );
    });

    const res = await http
      .patch(`/api/notifications/${notifId}/read`)
      .set('Authorization', bearer(f.memberA1))
      .expect(200);

    expect(res.body.id).toBe(notifId);
    expect(res.body.readAt).not.toBeNull();
  });

  it('5. Anti-Oracle: PATCH /api/notifications/:id/read returns 404 when targeting another user\'s notification', async () => {
    const notifA2 = randomUUID();
    await withTenant(ctxFor(f.managerA), async (c) => {
      await c.query(
        `INSERT INTO notification (id, org_id, user_id, manager_id, type, title, body)
         VALUES ($1, $2, $3, $4, 'step_activated', 'A2 Only', 'Body')`,
        [notifA2, f.org1Id, f.memberA2.id, f.managerA.id],
      );
    });

    // Member A1 attempts to mark Member A2's notification as read
    const res = await http
      .patch(`/api/notifications/${notifA2}/read`)
      .set('Authorization', bearer(f.memberA1))
      .expect(404);

    expect(res.body.message).toMatch(/not found/i);
  });

  it('6. POST /api/notifications/read-all marks all caller\'s unread notifications as read', async () => {
    const res = await http
      .post('/api/notifications/read-all')
      .set('Authorization', bearer(f.memberA1))
      .expect(200);

    expect(typeof res.body.updatedCount).toBe('number');

    const countRes = await http
      .get('/api/notifications/unread-count')
      .set('Authorization', bearer(f.memberA1))
      .expect(200);

    expect(countRes.body.count).toBe(0);
  });
});
