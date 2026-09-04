/**
 * DB-layer Row-Level Security and invariant proofs for Phase 4 (Notifications & Scheduling).
 *
 * Proves:
 *   1. Context-free SELECT on `notification` returns 0 rows (FORCE RLS fails closed).
 *   2. User Isolation: A user only sees their own notifications (not teammate''s, manager''s, or peer''s).
 *   3. Owner Inbox Isolation: Owner''s notification inbox only shows Owner''s notifications.
 *   4. Cross-Org Isolation: Org 2 users cannot see Org 1 notifications.
 *   5. Write Isolation: User cannot mark another user''s notification as read (0 rows affected).
 *   6. Invariants: Composite foreign key rejects cross-tenant user assignment.
 *   7. get_due_scheduled_tasks() discovers due tasks across orgs and ignores future tasks.
 */
import { randomUUID } from 'node:crypto';
import { appPool, migratorPool, withTenant } from './helpers/db';
import { ctxFor, seedFixture, type Fixture } from './helpers/seed';

describe('Notification RLS and Invariants (DB Layer)', () => {
  let f: Fixture;

  beforeAll(async () => {
    f = await seedFixture();
  });

  afterAll(async () => {
    await appPool.end();
    await migratorPool.end();
  });

  it('1. Context-free SELECT on notification returns 0 rows (FORCE RLS fails closed)', async () => {
    const notifId = randomUUID();
    // Seed within tenant context as Manager A
    await withTenant(ctxFor(f.managerA), async (c) => {
      await c.query(
        `INSERT INTO notification (id, org_id, user_id, manager_id, type, title, body)
         VALUES ($1, $2, $3, $4, 'task_assigned', 'Task Assigned', 'Test Body')`,
        [notifId, f.org1Id, f.memberA1.id, f.managerA.id],
      );
    });

    // Query as relay_app with no context
    const res = await appPool.query('SELECT * FROM notification WHERE id = $1', [notifId]);
    expect(res.rows).toHaveLength(0);
  });

  it('2. User Isolation: Member A1 sees only their own notifications, not Member A2 or Manager A', async () => {
    const nA1 = randomUUID();
    const nA2 = randomUUID();
    const nMgr = randomUUID();
    const nOwner = randomUUID();

    // Insert notifications for multiple roles in Org 1
    await withTenant(ctxFor(f.managerA), async (c) => {
      await c.query(
        `INSERT INTO notification (id, org_id, user_id, manager_id, type, title, body)
         VALUES ($1, $4, $5, $7, 'step_activated', 'A1 Step', 'Body A1'),
                ($2, $4, $6, $7, 'step_activated', 'A2 Step', 'Body A2'),
                ($3, $4, $7, $7, 'task_completed', 'Mgr Update', 'Body Mgr')`,
        [nA1, nA2, nMgr, f.org1Id, f.memberA1.id, f.memberA2.id, f.managerA.id],
      );
    });

    await withTenant(ctxFor(f.owner1), async (c) => {
      await c.query(
        `INSERT INTO notification (id, org_id, user_id, manager_id, type, title, body)
         VALUES ($1, $2, $3, NULL, 'task_completed', 'Owner Update', 'Body Owner')`,
        [nOwner, f.org1Id, f.owner1.id],
      );
    });

    // Query as Member A1
    const resA1 = await withTenant(ctxFor(f.memberA1), async (c) => {
      const { rows } = await c.query<{ id: string }>('SELECT id FROM notification');
      return rows.map((r) => r.id);
    });
    expect(resA1).toContain(nA1);
    expect(resA1).not.toContain(nA2);
    expect(resA1).not.toContain(nMgr);
    expect(resA1).not.toContain(nOwner);

    // Query as Member A2
    const resA2 = await withTenant(ctxFor(f.memberA2), async (c) => {
      const { rows } = await c.query<{ id: string }>('SELECT id FROM notification');
      return rows.map((r) => r.id);
    });
    expect(resA2).toContain(nA2);
    expect(resA2).not.toContain(nA1);

    // Query as Manager A
    const resMgr = await withTenant(ctxFor(f.managerA), async (c) => {
      const { rows } = await c.query<{ id: string }>('SELECT id FROM notification');
      return rows.map((r) => r.id);
    });
    expect(resMgr).toContain(nMgr);
    expect(resMgr).not.toContain(nA1);
    expect(resMgr).not.toContain(nA2);

    // Query as Owner 1 (personal inbox isolation)
    const resOwner = await withTenant(ctxFor(f.owner1), async (c) => {
      const { rows } = await c.query<{ id: string }>('SELECT id FROM notification');
      return rows.map((r) => r.id);
    });
    expect(resOwner).toContain(nOwner);
    expect(resOwner).not.toContain(nA1);
    expect(resOwner).not.toContain(nA2);
    expect(resOwner).not.toContain(nMgr);
  });

  it('3. Cross-Org Isolation: Org 2 users cannot see Org 1 notifications', async () => {
    const notifOrg1 = randomUUID();
    await withTenant(ctxFor(f.managerA), async (c) => {
      await c.query(
        `INSERT INTO notification (id, org_id, user_id, manager_id, type, title, body)
         VALUES ($1, $2, $3, $4, 'task_assigned', 'Org1 Task', 'Body')`,
        [notifOrg1, f.org1Id, f.memberA1.id, f.managerA.id],
      );
    });

    const resOrg2 = await withTenant(ctxFor(f.memberC1), async (c) => {
      const { rows } = await c.query<{ id: string }>('SELECT id FROM notification WHERE id = $1', [notifOrg1]);
      return rows;
    });
    expect(resOrg2).toHaveLength(0);
  });

  it('4. Write Isolation: Member A2 cannot mark Member A1 notification as read', async () => {
    const notifId = randomUUID();
    await withTenant(ctxFor(f.managerA), async (c) => {
      await c.query(
        `INSERT INTO notification (id, org_id, user_id, manager_id, type, title, body)
         VALUES ($1, $2, $3, $4, 'step_activated', 'A1 Task', 'Body')`,
        [notifId, f.org1Id, f.memberA1.id, f.managerA.id],
      );
    });

    // Member A2 tries to update Member A1's notification
    const updateA2 = await withTenant(ctxFor(f.memberA2), async (c) => {
      const res = await c.query('UPDATE notification SET read_at = now() WHERE id = $1', [notifId]);
      return res.rowCount;
    });
    expect(updateA2).toBe(0);

    // Member A1 updates their own notification
    const updateA1 = await withTenant(ctxFor(f.memberA1), async (c) => {
      const res = await c.query('UPDATE notification SET read_at = now() WHERE id = $1', [notifId]);
      return res.rowCount;
    });
    expect(updateA1).toBe(1);
  });

  it('5. Invariants: Composite FK rejects inserting notification with cross-tenant user', async () => {
    await expect(
      withTenant(ctxFor(f.owner1), async (c) => {
        await c.query(
          `INSERT INTO notification (org_id, user_id, type, title, body)
           VALUES ($1, $2, 'task_assigned', 'Invalid Cross Tenant', 'Body')`,
          [f.org1Id, f.memberC1.id], // memberC1 belongs to org2!
        );
      }),
    ).rejects.toThrow(/violates foreign key constraint/);
  });

  it('6. get_due_scheduled_tasks() discovers due tasks across orgs and ignores future tasks', async () => {
    const pastTaskOrg1 = randomUUID();
    const pastTaskOrg2 = randomUUID();
    const futureTaskOrg1 = randomUUID();

    const past = new Date(Date.now() - 3600 * 1000);
    const future = new Date(Date.now() + 86400 * 1000 * 10);

    await withTenant(ctxFor(f.managerA), async (c) => {
      await c.query(
        `INSERT INTO task (id, org_id, manager_id, name, type, created_by_user_id, status, scheduled_for)
         VALUES ($1, $2, $3, 'Past Task Org 1', 'text', $3, 'scheduled', $4),
                ($5, $2, $3, 'Future Task Org 1', 'text', $3, 'scheduled', $6)`,
        [pastTaskOrg1, f.org1Id, f.managerA.id, past, futureTaskOrg1, future],
      );
    });

    await withTenant(ctxFor(f.managerC), async (c) => {
      await c.query(
        `INSERT INTO task (id, org_id, manager_id, name, type, created_by_user_id, status, scheduled_for)
         VALUES ($1, $2, $3, 'Past Task Org 2', 'text', $3, 'scheduled', $4)`,
        [pastTaskOrg2, f.org2Id, f.managerC.id, past],
      );
    });

    // Call definer function as relay_app with NO tenant context
    const res = await appPool.query<{ id: string }>(
      'SELECT id FROM get_due_scheduled_tasks(50)',
    );
    const returnedIds = res.rows.map((r) => r.id);

    expect(returnedIds).toContain(pastTaskOrg1);
    expect(returnedIds).toContain(pastTaskOrg2);
    expect(returnedIds).not.toContain(futureTaskOrg1);
  });
});
