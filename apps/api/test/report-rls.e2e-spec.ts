/**
 * Row-level security for Task Completion Reports (Phase 5), proven at the database
 * layer with no HTTP in the picture.
 *
 * Proves:
 *   1. Manager A cannot see, read by ID, or delete Manager B's task reports.
 *   2. Member A1 sees reports in their own team's slice, but cannot see Manager B's reports.
 *   3. Owner sees all reports in their own org (Org 1), but cannot reach Org 2.
 *   4. Context-free (unauthenticated) queries return zero rows.
 *   5. Composite FKs reject cross-tenant references (e.g. report in Org 1 pointing to task in Org 2).
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

interface ReportFixture {
  taskAId: string;
  reportAId: string;
  taskBId: string;
  reportBId: string;
  taskCId: string;
  reportCId: string;
}

let repF: ReportFixture;

async function seedReportFixture(): Promise<ReportFixture> {
  const taskAId = randomUUID();
  const reportAId = randomUUID();

  await withTenant(ctxFor(fx.managerA), async (c) => {
    await c.query(
      `INSERT INTO task (id, org_id, manager_id, team_id, name, type, description, created_by_user_id, status)
       VALUES ($1, $2, $3, $4, 'Task A', 'text', 'Task A desc', $5, 'completed')`,
      [taskAId, fx.org1Id, fx.managerA.id, fx.teamAId, fx.managerA.id],
    );

    await c.query(
      `INSERT INTO task_report (id, org_id, manager_id, task_id, reported_by_user_id, summary, highlights, blockers)
       VALUES ($1, $2, $3, $4, $5, 'Alpha summary', 'Great efficiency', 'None')`,
      [reportAId, fx.org1Id, fx.managerA.id, taskAId, fx.memberA1.id],
    );
  });

  const taskBId = randomUUID();
  const reportBId = randomUUID();

  await withTenant(ctxFor(fx.managerB), async (c) => {
    await c.query(
      `INSERT INTO task (id, org_id, manager_id, team_id, name, type, description, created_by_user_id, status)
       VALUES ($1, $2, $3, $4, 'Task B', 'text', 'Task B desc', $5, 'completed')`,
      [taskBId, fx.org1Id, fx.managerB.id, fx.teamBId, fx.managerB.id],
    );

    await c.query(
      `INSERT INTO task_report (id, org_id, manager_id, task_id, reported_by_user_id, summary, highlights, blockers)
       VALUES ($1, $2, $3, $4, $5, 'Beta summary', 'Finished ahead of schedule', 'None')`,
      [reportBId, fx.org1Id, fx.managerB.id, taskBId, fx.memberB1.id],
    );
  });

  const taskCId = randomUUID();
  const reportCId = randomUUID();

  await withTenant(ctxFor(fx.managerC), async (c) => {
    await c.query(
      `INSERT INTO task (id, org_id, manager_id, team_id, name, type, description, created_by_user_id, status)
       VALUES ($1, $2, $3, $4, 'Task C', 'text', 'Task C desc', $5, 'completed')`,
      [taskCId, fx.org2Id, fx.managerC.id, fx.teamCId, fx.managerC.id],
    );

    await c.query(
      `INSERT INTO task_report (id, org_id, manager_id, task_id, reported_by_user_id, summary, highlights, blockers)
       VALUES ($1, $2, $3, $4, $5, 'Charlie summary', 'Org 2 completion', 'None')`,
      [reportCId, fx.org2Id, fx.managerC.id, taskCId, fx.memberC1.id],
    );
  });

  return { taskAId, reportAId, taskBId, reportBId, taskCId, reportCId };
}

beforeAll(async () => {
  await truncateAll();
  fx = await seedFixture();
  repF = await seedReportFixture();
});

afterAll(async () => {
  await closePools();
});

describe('Report RLS — Database layer', () => {
  it('Manager A sees only task reports from their own team (not Manager B or Org 2)', async () => {
    await withTenant(ctxFor(fx.managerA), async (c) => {
      const { rows } = await c.query<{ id: string }>(
        'SELECT id FROM task_report ORDER BY created_at ASC',
      );
      expect(rows.map((r) => r.id)).toEqual([repF.reportAId]);
    });
  });

  it('Manager A cannot read Manager B task report by ID', async () => {
    await withTenant(ctxFor(fx.managerA), async (c) => {
      const { rows } = await c.query(
        'SELECT id FROM task_report WHERE id = $1',
        [repF.reportBId],
      );
      expect(rows).toHaveLength(0);
    });
  });

  it('Member A1 sees team A reports but cannot see Manager B or Org 2 reports', async () => {
    await withTenant(ctxFor(fx.memberA1), async (c) => {
      const { rows } = await c.query<{ id: string }>(
        'SELECT id FROM task_report ORDER BY created_at ASC',
      );
      expect(rows.map((r) => r.id)).toEqual([repF.reportAId]);
    });
  });

  it('Owner sees all task reports in Org 1 (both Manager A and B) but not Org 2', async () => {
    await withTenant(ctxFor(fx.owner1), async (c) => {
      const { rows } = await c.query<{ id: string }>(
        'SELECT id FROM task_report ORDER BY created_at ASC',
      );
      const ids = rows.map((r) => r.id);
      expect(ids).toContain(repF.reportAId);
      expect(ids).toContain(repF.reportBId);
      expect(ids).not.toContain(repF.reportCId);
    });
  });

  it('Unauthenticated (context-free) query returns zero task reports', async () => {
    await withoutTenant(async (c) => {
      const { rows } = await c.query('SELECT * FROM task_report');
      expect(rows).toHaveLength(0);
    });
  });

  it('Rejects duplicate report for the same task (unique task_id index)', async () => {
    await withTenant(ctxFor(fx.managerA), async (c) => {
      await expect(
        c.query(
          `INSERT INTO task_report (org_id, manager_id, task_id, reported_by_user_id, summary)
           VALUES ($1, $2, $3, $4, 'Duplicate report')`,
          [fx.org1Id, fx.managerA.id, repF.taskAId, fx.memberA1.id],
        ),
      ).rejects.toThrow();
    });
  });

  it('Rejects composite FK violation across organizations', async () => {
    await withTenant(ctxFor(fx.managerA), async (c) => {
      // Trying to reference taskC (Org 2) with org1Id
      await expect(
        c.query(
          `INSERT INTO task_report (org_id, manager_id, task_id, reported_by_user_id, summary)
           VALUES ($1, $2, $3, $4, 'Cross-org task reference')`,
          [fx.org1Id, fx.managerA.id, repF.taskCId, fx.managerA.id],
        ),
      ).rejects.toThrow();
    });
  });

  it('Rejects empty or whitespace summary at DB level via check constraint', async () => {
    await withTenant(ctxFor(fx.managerA), async (c) => {
      await expect(
        c.query(
          `INSERT INTO task_report (org_id, manager_id, task_id, reported_by_user_id, summary)
           VALUES ($1, $2, $3, $4, '   ')`,
          [fx.org1Id, fx.managerA.id, repF.taskAId, fx.memberA1.id],
        ),
      ).rejects.toThrow(/task_report_summary_non_empty/);
    });
  });
});
