/**
 * Row-level security for the Workflow Engine (Phase 2), proven at the database
 * layer with no HTTP in the picture.
 *
 * This is the DB-layer half of the §11 isolation gate for `task` and `task_step`.
 * Proves:
 *   1. Manager A cannot see, read by ID, or update Manager B's tasks or task steps.
 *   2. Member A1 sees all steps in their own team's task (including teammate Member A2's
 *      step — the relay-chain read contract §9), but cannot see Manager B's tasks/steps.
 *   3. Owner sees all tasks/steps in their own org (Org 1), but cannot reach Org 2.
 *   4. Context-free (unauthenticated) queries return zero rows.
 *   5. Composite FKs reject cross-tenant references (e.g. task in Org 1 pointing to user/team in Org 2).
 *   6. Partial unique index enforces exactly ONE active step per task at the DB layer.
 *   7. Privilege layer: relay_app has no DELETE grant on task or task_step.
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

interface WorkflowFixture {
  taskAId: string;
  stepA1Id: string;
  stepA2Id: string;
  taskBId: string;
  stepB1Id: string;
  stepB2Id: string;
  taskCId: string;
  stepC1Id: string;
}

let wf: WorkflowFixture;

async function seedWorkflowFixture(): Promise<WorkflowFixture> {
  // Seed Task A + steps (Org 1, Manager A, Team A)
  const taskAId = randomUUID();
  const stepA1Id = randomUUID();
  const stepA2Id = randomUUID();

  await withTenant(ctxFor(fx.managerA), async (c) => {
    await c.query(
      `INSERT INTO task (id, org_id, manager_id, team_id, name, type, description, created_by_user_id, status)
       VALUES ($1, $2, $3, $4, 'Task Alpha', 'text', 'Alpha description', $5, 'in_progress')`,
      [taskAId, fx.org1Id, fx.managerA.id, fx.teamAId, fx.managerA.id],
    );

    await c.query(
      `INSERT INTO task_step (id, org_id, manager_id, task_id, assigned_user_id, step_order, status, started_at)
       VALUES ($1, $2, $3, $4, $5, 1, 'active', now())`,
      [stepA1Id, fx.org1Id, fx.managerA.id, taskAId, fx.memberA1.id],
    );

    await c.query(
      `INSERT INTO task_step (id, org_id, manager_id, task_id, assigned_user_id, step_order, status)
       VALUES ($1, $2, $3, $4, $5, 2, 'pending')`,
      [stepA2Id, fx.org1Id, fx.managerA.id, taskAId, fx.memberA2.id],
    );
  });

  // Seed Task B + steps (Org 1, Manager B, Team B)
  const taskBId = randomUUID();
  const stepB1Id = randomUUID();
  const stepB2Id = randomUUID();

  await withTenant(ctxFor(fx.managerB), async (c) => {
    await c.query(
      `INSERT INTO task (id, org_id, manager_id, team_id, name, type, description, created_by_user_id, status)
       VALUES ($1, $2, $3, $4, 'Task Beta', 'video', 'Beta description', $5, 'in_progress')`,
      [taskBId, fx.org1Id, fx.managerB.id, fx.teamBId, fx.managerB.id],
    );

    await c.query(
      `INSERT INTO task_step (id, org_id, manager_id, task_id, assigned_user_id, step_order, status, started_at)
       VALUES ($1, $2, $3, $4, $5, 1, 'active', now())`,
      [stepB1Id, fx.org1Id, fx.managerB.id, taskBId, fx.memberB1.id],
    );

    await c.query(
      `INSERT INTO task_step (id, org_id, manager_id, task_id, assigned_user_id, step_order, status)
       VALUES ($1, $2, $3, $4, $5, 2, 'pending')`,
      [stepB2Id, fx.org1Id, fx.managerB.id, taskBId, fx.memberB2.id],
    );
  });

  // Seed Task C + step (Org 2, Manager C, Team C)
  const taskCId = randomUUID();
  const stepC1Id = randomUUID();

  await withTenant(ctxFor(fx.managerC), async (c) => {
    await c.query(
      `INSERT INTO task (id, org_id, manager_id, team_id, name, type, description, created_by_user_id, status)
       VALUES ($1, $2, $3, $4, 'Task Gamma', 'file', 'Gamma description', $5, 'in_progress')`,
      [taskCId, fx.org2Id, fx.managerC.id, fx.teamCId, fx.managerC.id],
    );

    await c.query(
      `INSERT INTO task_step (id, org_id, manager_id, task_id, assigned_user_id, step_order, status, started_at)
       VALUES ($1, $2, $3, $4, $5, 1, 'active', now())`,
      [stepC1Id, fx.org2Id, fx.managerC.id, taskCId, fx.memberC1.id],
    );
  });

  return { taskAId, stepA1Id, stepA2Id, taskBId, stepB1Id, stepB2Id, taskCId, stepC1Id };
}

beforeAll(async () => {
  await truncateAll();
  fx = await seedFixture();
  wf = await seedWorkflowFixture();
});

afterAll(async () => {
  await truncateAll();
  await closePools();
});

describe('Workflow RLS: Manager isolation (same org)', () => {
  it('sees only its own tasks when selecting all tasks', async () => {
    const tasks = await withTenant(ctxFor(fx.managerA), async (c) => {
      const { rows } = await c.query<{ id: string; name: string }>('SELECT id, name FROM task');
      return rows;
    });

    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe(wf.taskAId);
    expect(tasks[0].name).toBe('Task Alpha');
  });

  it('gets zero rows for Task B when querying by exact id', async () => {
    const rows = await withTenant(ctxFor(fx.managerA), async (c) => {
      const res = await c.query('SELECT id FROM task WHERE id = $1', [wf.taskBId]);
      return res.rows;
    });
    expect(rows).toHaveLength(0);
  });

  it('sees only its own task_steps when selecting all task_steps', async () => {
    const steps = await withTenant(ctxFor(fx.managerA), async (c) => {
      const { rows } = await c.query<{ id: string; taskId: string }>(
        'SELECT id, task_id AS "taskId" FROM task_step',
      );
      return rows;
    });

    expect(steps).toHaveLength(2);
    expect(steps.map((s) => s.id).sort()).toEqual([wf.stepA1Id, wf.stepA2Id].sort());
  });

  it('gets zero rows for Task B steps by exact id', async () => {
    const rows = await withTenant(ctxFor(fx.managerA), async (c) => {
      const res = await c.query('SELECT id FROM task_step WHERE id = $1', [wf.stepB1Id]);
      return res.rows;
    });
    expect(rows).toHaveLength(0);
  });

  it('affects zero rows when trying to UPDATE Manager B task', async () => {
    const result = await withTenant(ctxFor(fx.managerA), async (c) => {
      return await c.query("UPDATE task SET name = 'Attacked' WHERE id = $1", [wf.taskBId]);
    });
    expect(result.rowCount).toBe(0);
  });

  it('affects zero rows when trying to UPDATE Manager B task_step', async () => {
    const result = await withTenant(ctxFor(fx.managerA), async (c) => {
      return await c.query("UPDATE task_step SET status = 'completed' WHERE id = $1", [
        wf.stepB1Id,
      ]);
    });
    expect(result.rowCount).toBe(0);
  });

  it('rejects INSERT of a task with manager_id = Manager B under Manager A context', async () => {
    await expect(
      withTenant(ctxFor(fx.managerA), async (c) => {
        await c.query(
          `INSERT INTO task (id, org_id, manager_id, team_id, name, type, created_by_user_id, status)
           VALUES ($1, $2, $3, $4, 'Injected', 'text', $5, 'in_progress')`,
          [randomUUID(), fx.org1Id, fx.managerB.id, fx.teamBId, fx.managerA.id],
        );
      }),
    ).rejects.toThrow(/violates row-level security policy/);
  });
});

describe('Workflow RLS: Member read slice & teammate visibility', () => {
  it("sees own team's task", async () => {
    const tasks = await withTenant(ctxFor(fx.memberA1), async (c) => {
      const { rows } = await c.query<{ id: string }>('SELECT id FROM task');
      return rows;
    });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe(wf.taskAId);
  });

  it('sees BOTH Step 1 (self) and Step 2 (teammate Member A2) in the relay chain', async () => {
    // CLAUDE.md §2 + §9: members must see the whole relay chain for their team's tasks
    const steps = await withTenant(ctxFor(fx.memberA1), async (c) => {
      const { rows } = await c.query<{ id: string; assignedUserId: string }>(
        'SELECT id, assigned_user_id AS "assignedUserId" FROM task_step WHERE task_id = $1 ORDER BY step_order',
        [wf.taskAId],
      );
      return rows;
    });
    expect(steps).toHaveLength(2);
    expect(steps[0].id).toBe(wf.stepA1Id);
    expect(steps[0].assignedUserId).toBe(fx.memberA1.id);
    expect(steps[1].id).toBe(wf.stepA2Id);
    expect(steps[1].assignedUserId).toBe(fx.memberA2.id);
  });

  it('gets zero rows for Manager B tasks or steps', async () => {
    const taskRows = await withTenant(ctxFor(fx.memberA1), async (c) => {
      const res = await c.query('SELECT id FROM task WHERE id = $1', [wf.taskBId]);
      return res.rows;
    });
    expect(taskRows).toHaveLength(0);

    const stepRows = await withTenant(ctxFor(fx.memberA1), async (c) => {
      const res = await c.query('SELECT id FROM task_step WHERE id = $1', [wf.stepB1Id]);
      return res.rows;
    });
    expect(stepRows).toHaveLength(0);
  });
});

describe('Workflow RLS: Owner visibility (full org-wide)', () => {
  it('sees all tasks across all managers in Org 1', async () => {
    const tasks = await withTenant(ctxFor(fx.owner1), async (c) => {
      const { rows } = await c.query<{ id: string }>('SELECT id FROM task ORDER BY name');
      return rows;
    });
    expect(tasks).toHaveLength(2);
    expect(tasks.map((t) => t.id).sort()).toEqual([wf.taskAId, wf.taskBId].sort());
  });

  it('sees all steps across all managers in Org 1', async () => {
    const steps = await withTenant(ctxFor(fx.owner1), async (c) => {
      const { rows } = await c.query<{ id: string }>('SELECT id FROM task_step');
      return rows;
    });
    expect(steps).toHaveLength(4);
  });

  it('gets zero rows for Org 2 tasks or steps (cross-org boundary)', async () => {
    const taskRows = await withTenant(ctxFor(fx.owner1), async (c) => {
      const res = await c.query('SELECT id FROM task WHERE id = $1', [wf.taskCId]);
      return res.rows;
    });
    expect(taskRows).toHaveLength(0);

    const stepRows = await withTenant(ctxFor(fx.owner1), async (c) => {
      const res = await c.query('SELECT id FROM task_step WHERE id = $1', [wf.stepC1Id]);
      return res.rows;
    });
    expect(stepRows).toHaveLength(0);
  });
});

describe('Workflow RLS: Context-free queries', () => {
  it('returns zero rows for task when no tenant context is set', async () => {
    const rows = await withoutTenant(async (c) => {
      const res = await c.query('SELECT id FROM task');
      return res.rows;
    });
    expect(rows).toHaveLength(0);
  });

  it('returns zero rows for task_step when no tenant context is set', async () => {
    const rows = await withoutTenant(async (c) => {
      const res = await c.query('SELECT id FROM task_step');
      return res.rows;
    });
    expect(rows).toHaveLength(0);
  });

  it('rejects INSERT on task without tenant context', async () => {
    await expect(
      withoutTenant(async (c) => {
        await c.query(
          `INSERT INTO task (id, org_id, manager_id, team_id, name, type, created_by_user_id)
           VALUES ($1, $2, $3, $4, 'Anon Task', 'text', $5)`,
          [randomUUID(), fx.org1Id, fx.managerA.id, fx.teamAId, fx.owner1.id],
        );
      }),
    ).rejects.toThrow(/violates row-level security policy/);
  });
});

describe('Workflow DB: Composite FK cross-tenant invariants', () => {
  it('rejects task with manager_id from a different org (task_org_id_manager_id_fkey)', async () => {
    await expect(
      withTenant(ctxFor(fx.owner1), async (c) => {
        await c.query(
          `INSERT INTO task (id, org_id, manager_id, team_id, name, type, created_by_user_id)
           VALUES ($1, $2, $3, $4, 'Cross Org Task', 'text', $5)`,
          [randomUUID(), fx.org1Id, fx.managerC.id, null, fx.owner1.id],
        );
      }),
    ).rejects.toThrow(/task_org_id_manager_id_fkey/);
  });

  it('rejects task with team_id from a different org (task_org_id_team_id_fkey)', async () => {
    await expect(
      withTenant(ctxFor(fx.owner1), async (c) => {
        await c.query(
          `INSERT INTO task (id, org_id, manager_id, team_id, name, type, created_by_user_id)
           VALUES ($1, $2, $3, $4, 'Cross Team Task', 'text', $5)`,
          [randomUUID(), fx.org1Id, fx.managerA.id, fx.teamCId, fx.owner1.id],
        );
      }),
    ).rejects.toThrow(/task_org_id_team_id_fkey/);
  });

  it('rejects task with created_by_user_id from a different org (task_org_id_created_by_user_id_fkey)', async () => {
    await expect(
      withTenant(ctxFor(fx.owner1), async (c) => {
        await c.query(
          `INSERT INTO task (id, org_id, manager_id, team_id, name, type, created_by_user_id)
           VALUES ($1, $2, $3, $4, 'Cross Creator Task', 'text', $5)`,
          [randomUUID(), fx.org1Id, fx.managerA.id, fx.teamAId, fx.owner2.id],
        );
      }),
    ).rejects.toThrow(/task_org_id_created_by_user_id_fkey/);
  });

  it('rejects task_step referencing a task from a different org (task_step_org_id_task_id_fkey)', async () => {
    await expect(
      withTenant(ctxFor(fx.owner1), async (c) => {
        await c.query(
          `INSERT INTO task_step (id, org_id, manager_id, task_id, assigned_user_id, step_order, status)
           VALUES ($1, $2, $3, $4, $5, 99, 'pending')`,
          [randomUUID(), fx.org1Id, fx.managerA.id, wf.taskCId, fx.memberA1.id],
        );
      }),
    ).rejects.toThrow(/task_step_org_id_task_id_fkey/);
  });

  it('rejects task_step with assigned_user_id from a different org (task_step_org_id_assigned_user_id_fkey)', async () => {
    await expect(
      withTenant(ctxFor(fx.owner1), async (c) => {
        await c.query(
          `INSERT INTO task_step (id, org_id, manager_id, task_id, assigned_user_id, step_order, status)
           VALUES ($1, $2, $3, $4, $5, 99, 'pending')`,
          [randomUUID(), fx.org1Id, fx.managerA.id, wf.taskAId, fx.memberC1.id],
        );
      }),
    ).rejects.toThrow(/task_step_org_id_assigned_user_id_fkey/);
  });
});

describe('Workflow DB: Single active step invariant (task_step_active_key)', () => {
  it('rejects inserting a second active step for the same task with 23505', async () => {
    await expect(
      withTenant(ctxFor(fx.managerA), async (c) => {
        await c.query(
          `INSERT INTO task_step (id, org_id, manager_id, task_id, assigned_user_id, step_order, status, started_at)
           VALUES ($1, $2, $3, $4, $5, 3, 'active', now())`,
          [randomUUID(), fx.org1Id, fx.managerA.id, wf.taskAId, fx.memberA2.id],
        );
      }),
    ).rejects.toThrow(/task_step_active_key|duplicate key/);
  });

  it('rejects updating a pending step to active when another step is already active', async () => {
    await expect(
      withTenant(ctxFor(fx.managerA), async (c) => {
        await c.query("UPDATE task_step SET status = 'active' WHERE id = $1", [wf.stepA2Id]);
      }),
    ).rejects.toThrow(/task_step_active_key|duplicate key/);
  });
});

describe('Workflow DB: Privilege layer restrictions', () => {
  it('forbids DELETE on task for relay_app', async () => {
    await expect(
      withTenant(ctxFor(fx.owner1), async (c) => {
        await c.query('DELETE FROM task WHERE id = $1', [wf.taskAId]);
      }),
    ).rejects.toThrow(/permission denied for table task/);
  });

  it('forbids DELETE on task_step for relay_app', async () => {
    await expect(
      withTenant(ctxFor(fx.owner1), async (c) => {
        await c.query('DELETE FROM task_step WHERE id = $1', [wf.stepA1Id]);
      }),
    ).rejects.toThrow(/permission denied for table task_step/);
  });
});
