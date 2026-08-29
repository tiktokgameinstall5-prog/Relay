/**
 * Row-level security for Task Attachments (Phase 3), proven at the database
 * layer with no HTTP in the picture.
 *
 * Proves:
 *   1. Manager A cannot see, read by ID, or delete Manager B's attachments.
 *   2. Member A1 sees all attachments in their own team's task, but cannot see Manager B's attachments.
 *   3. Owner sees all attachments in their own org (Org 1), but cannot reach Org 2.
 *   4. Context-free (unauthenticated) queries return zero rows.
 *   5. Composite FKs reject cross-tenant references (e.g. attachment in Org 1 pointing to task/user in Org 2).
 */
import { randomUUID } from 'node:crypto';
import {
  appPool,
  closePools,
  truncateAll,
  withTenant,
  withoutTenant,
} from './helpers/db';
import { ctxFor, seedFixture, type Fixture } from './helpers/seed';

jest.setTimeout(30_000);

let fx: Fixture;

interface AttachmentFixture {
  taskAId: string;
  attachAId: string;
  taskBId: string;
  attachBId: string;
  taskCId: string;
  attachCId: string;
}

let af: AttachmentFixture;

async function seedAttachmentFixture(): Promise<AttachmentFixture> {
  const taskAId = randomUUID();
  const attachAId = randomUUID();

  await withTenant(ctxFor(fx.managerA), async (c) => {
    await c.query(
      `INSERT INTO task (id, org_id, manager_id, team_id, name, type, description, created_by_user_id, status)
       VALUES ($1, $2, $3, $4, 'Task Alpha', 'file', 'Alpha description', $5, 'in_progress')`,
      [taskAId, fx.org1Id, fx.managerA.id, fx.teamAId, fx.managerA.id],
    );

    await c.query(
      `INSERT INTO task_attachment (id, org_id, manager_id, task_id, uploaded_by_user_id, file_name, file_size, mime_type, storage_key, checksum_sha256)
       VALUES ($1, $2, $3, $4, $5, 'spec.pdf', 1024, 'application/pdf', 'key-a', 'sha-a')`,
      [attachAId, fx.org1Id, fx.managerA.id, taskAId, fx.memberA1.id],
    );
  });

  const taskBId = randomUUID();
  const attachBId = randomUUID();

  await withTenant(ctxFor(fx.managerB), async (c) => {
    await c.query(
      `INSERT INTO task (id, org_id, manager_id, team_id, name, type, description, created_by_user_id, status)
       VALUES ($1, $2, $3, $4, 'Task Beta', 'video', 'Beta video', $5, 'in_progress')`,
      [taskBId, fx.org1Id, fx.managerB.id, fx.teamBId, fx.managerB.id],
    );

    await c.query(
      `INSERT INTO task_attachment (id, org_id, manager_id, task_id, uploaded_by_user_id, file_name, file_size, mime_type, storage_key, checksum_sha256)
       VALUES ($1, $2, $3, $4, $5, 'video.mp4', 2048, 'video/mp4', 'key-b', 'sha-b')`,
      [attachBId, fx.org1Id, fx.managerB.id, taskBId, fx.managerB.id],
    );
  });

  const taskCId = randomUUID();
  const attachCId = randomUUID();

  await withTenant(ctxFor(fx.managerC), async (c) => {
    await c.query(
      `INSERT INTO task (id, org_id, manager_id, team_id, name, type, description, created_by_user_id, status)
       VALUES ($1, $2, $3, $4, 'Task Charlie', 'text', 'Charlie text', $5, 'in_progress')`,
      [taskCId, fx.org2Id, fx.managerC.id, fx.teamCId, fx.managerC.id],
    );

    await c.query(
      `INSERT INTO task_attachment (id, org_id, manager_id, task_id, uploaded_by_user_id, file_name, file_size, mime_type, storage_key, checksum_sha256)
       VALUES ($1, $2, $3, $4, $5, 'notes.txt', 512, 'text/plain', 'key-c', 'sha-c')`,
      [attachCId, fx.org2Id, fx.managerC.id, taskCId, fx.managerC.id],
    );
  });

  return { taskAId, attachAId, taskBId, attachBId, taskCId, attachCId };
}

beforeAll(async () => {
  await truncateAll();
  fx = await seedFixture();
  af = await seedAttachmentFixture();
});

afterAll(async () => {
  await closePools();
});

describe('task_attachment RLS', () => {
  it('context-free query sees 0 attachments', async () => {
    const rows = await withoutTenant(async (c) => {
      const res = await c.query('SELECT * FROM task_attachment');
      return res.rows;
    });
    expect(rows).toHaveLength(0);
  });

  it('Manager A sees Attachment A and NOT Attachment B or C', async () => {
    const rows = await withTenant(ctxFor(fx.managerA), async (c) => {
      const res = await c.query<{ id: string }>('SELECT id FROM task_attachment');
      return res.rows.map((r) => r.id);
    });
    expect(rows).toContain(af.attachAId);
    expect(rows).not.toContain(af.attachBId);
    expect(rows).not.toContain(af.attachCId);
  });

  it('Member A1 sees Attachment A (on team task) and NOT B or C', async () => {
    const rows = await withTenant(ctxFor(fx.memberA1), async (c) => {
      const res = await c.query<{ id: string }>('SELECT id FROM task_attachment');
      return res.rows.map((r) => r.id);
    });
    expect(rows).toContain(af.attachAId);
    expect(rows).not.toContain(af.attachBId);
    expect(rows).not.toContain(af.attachCId);
  });

  it('Owner 1 sees Attachments in Org 1 (A and B) but NOT Org 2 (C)', async () => {
    const rows = await withTenant(ctxFor(fx.owner1), async (c) => {
      const res = await c.query<{ id: string }>('SELECT id FROM task_attachment');
      return res.rows.map((r) => r.id);
    });
    expect(rows).toContain(af.attachAId);
    expect(rows).toContain(af.attachBId);
    expect(rows).not.toContain(af.attachCId);
  });

  it('Manager A cannot delete Attachment B by ID (0 rows affected)', async () => {
    const count = await withTenant(ctxFor(fx.managerA), async (c) => {
      const res = await c.query('DELETE FROM task_attachment WHERE id = $1', [af.attachBId]);
      return res.rowCount;
    });
    expect(count).toBe(0);
  });

  it('composite FK rejects attachment in Org 1 referencing task in Org 2', async () => {
    await expect(
      withTenant(ctxFor(fx.owner1), async (c) => {
        await c.query(
          `INSERT INTO task_attachment (org_id, manager_id, task_id, uploaded_by_user_id, file_name, file_size, mime_type, storage_key, checksum_sha256)
           VALUES ($1, $2, $3, $4, 'leak.pdf', 100, 'application/pdf', 'k', 's')`,
          [fx.org1Id, fx.managerA.id, af.taskCId, fx.managerA.id],
        );
      }),
    ).rejects.toThrow(/task_attachment_org_id_task_id_fkey/);
  });
});
