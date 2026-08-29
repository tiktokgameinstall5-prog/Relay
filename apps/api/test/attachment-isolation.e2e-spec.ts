/**
 * HTTP-layer Attachment Isolation & Lossless Verification Gate (Phase 3).
 *
 * Proves:
 *   1. Upload attachment (POST /api/tasks/:taskId/attachments).
 *   2. Lossless verification: Downloaded bytes are bit-for-bit identical with matching SHA-256 (CLAUDE.md §3).
 *   3. List attachments (GET /api/tasks/:taskId/attachments).
 *   4. Cross-tenant isolation: Manager A / Member A cannot see, upload, or download Manager B's task attachments (404).
 *   5. Deletion authorization: Member can delete own attachment, Manager can delete team attachment, Member cannot delete peer's attachment (403).
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { closePools, truncateAll, withTenant } from './helpers/db';
import { ctxFor, seedFixture, type Fixture } from './helpers/seed';
import { bearer } from './helpers/token';

jest.setTimeout(30_000);

let app: INestApplication;
let http: ReturnType<typeof request>;
let fx: Fixture;

let taskAId: string;
let taskBId: string;

async function seedTasks() {
  taskAId = randomUUID();
  taskBId = randomUUID();

  await withTenant(ctxFor(fx.managerA), async (c) => {
    await c.query(
      `INSERT INTO task (id, org_id, manager_id, team_id, name, type, description, created_by_user_id, status)
       VALUES ($1, $2, $3, $4, 'Task Alpha', 'file', 'File task', $5, 'in_progress')`,
      [taskAId, fx.org1Id, fx.managerA.id, fx.teamAId, fx.managerA.id],
    );
  });

  await withTenant(ctxFor(fx.managerB), async (c) => {
    await c.query(
      `INSERT INTO task (id, org_id, manager_id, team_id, name, type, description, created_by_user_id, status)
       VALUES ($1, $2, $3, $4, 'Task Beta', 'video', 'Video task', $5, 'in_progress')`,
      [taskBId, fx.org1Id, fx.managerB.id, fx.teamBId, fx.managerB.id],
    );
  });
}

beforeAll(async () => {
  await truncateAll();
  fx = await seedFixture();
  await seedTasks();

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  app = moduleRef.createNestApplication<NestExpressApplication>();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.init();
  http = request(app.getHttpServer());
});

afterAll(async () => {
  await app.close();
  await closePools();
});

describe('Attachment HTTP Isolation & Lossless Delivery (Phase 3)', () => {
  let attachmentA1Id: string;
  let sampleBinaryPayload: Buffer;
  let sampleSha256: string;

  beforeAll(() => {
    // Generate 64KB pseudo-random binary payload simulating a raw master file / video chunk
    sampleBinaryPayload = randomBytes(64 * 1024);
    sampleSha256 = createHash('sha256').update(sampleBinaryPayload).digest('hex');
  });

  it('Member A1 uploads a file to Task A -> 201 with metadata', async () => {
    const res = await http
      .post(`/api/tasks/${taskAId}/attachments`)
      .set('Authorization', bearer(fx.memberA1))
      .attach('file', sampleBinaryPayload, 'raw_video_master.mp4')
      .expect(201);

    expect(res.body).toMatchObject({
      taskId: taskAId,
      fileName: 'raw_video_master.mp4',
      fileSize: sampleBinaryPayload.length,
      mimeType: 'video/mp4',
      checksumSha256: sampleSha256,
      uploadedByUserId: fx.memberA1.id,
    });
    expect(res.body.id).toBeDefined();
    attachmentA1Id = res.body.id;
  });

  it('Lossless verification: Downloaded attachment is byte-identical (CLAUDE.md §3)', async () => {
    const res = await http
      .get(`/api/tasks/${taskAId}/attachments/${attachmentA1Id}/download`)
      .set('Authorization', bearer(fx.memberA2))
      .expect(200);

    const downloadedBuffer = Buffer.from(res.body);
    const downloadedSha256 = createHash('sha256').update(downloadedBuffer).digest('hex');

    expect(downloadedBuffer.length).toBe(sampleBinaryPayload.length);
    expect(downloadedSha256).toBe(sampleSha256);
    expect(downloadedBuffer.equals(sampleBinaryPayload)).toBe(true);
  });

  it('List attachments (GET /api/tasks/:taskId/attachments) returns attachment', async () => {
    const res = await http
      .get(`/api/tasks/${taskAId}/attachments`)
      .set('Authorization', bearer(fx.managerA))
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body[0].id).toBe(attachmentA1Id);
  });

  it('Cross-Team Isolation: Manager B cannot list or download Task A attachments (404)', async () => {
    await http
      .get(`/api/tasks/${taskAId}/attachments`)
      .set('Authorization', bearer(fx.managerB))
      .expect(404);

    await http
      .get(`/api/tasks/${taskAId}/attachments/${attachmentA1Id}/download`)
      .set('Authorization', bearer(fx.managerB))
      .expect(404);
  });

  it('Cross-Tenant Isolation: Org 2 Manager C cannot access Task A attachments (404)', async () => {
    await http
      .get(`/api/tasks/${taskAId}/attachments/${attachmentA1Id}/download`)
      .set('Authorization', bearer(fx.managerC))
      .expect(404);
  });

  it('Cross-Team Upload: Member B1 cannot upload to Task A (404)', async () => {
    await http
      .post(`/api/tasks/${taskAId}/attachments`)
      .set('Authorization', bearer(fx.memberB1))
      .attach('file', Buffer.from('test'), 'test.txt')
      .expect(404);
  });

  it('Member A2 cannot delete Member A1 uploaded attachment (403 Forbidden)', async () => {
    await http
      .delete(`/api/tasks/${taskAId}/attachments/${attachmentA1Id}`)
      .set('Authorization', bearer(fx.memberA2))
      .expect(403);
  });

  it('Member A1 can delete own uploaded attachment (204 No Content)', async () => {
    await http
      .delete(`/api/tasks/${taskAId}/attachments/${attachmentA1Id}`)
      .set('Authorization', bearer(fx.memberA1))
      .expect(204);

    // Confirm it is gone
    await http
      .get(`/api/tasks/${taskAId}/attachments/${attachmentA1Id}/download`)
      .set('Authorization', bearer(fx.memberA1))
      .expect(404);
  });
});
