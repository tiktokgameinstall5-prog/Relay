/**
 * Row-level security for Rankings and Ranking Events (Phase 5), proven at the database
 * layer with no HTTP in the picture.
 *
 * Proves:
 *   1. Manager A cannot see, read by ID, or access Manager B's ranking events.
 *   2. Member A1 sees only their own ranking events; Member A2 cannot see Member A1's events (role-branched RLS).
 *   3. Owner sees all ranking events in their own org (Org 1), but cannot reach Org 2.
 *   4. Context-free (unauthenticated) queries return zero rows.
 *   5. Composite FKs reject cross-tenant references (e.g. ranking_event in Org 1 pointing to user in Org 2).
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

interface RankingFixture {
  eventAId: string;
  eventBId: string;
  eventCId: string;
}

let rf: RankingFixture;

async function seedRankingFixture(): Promise<RankingFixture> {
  const eventAId = randomUUID();

  await withTenant(ctxFor(fx.managerA), async (c) => {
    await c.query(
      `INSERT INTO ranking_event (id, org_id, manager_id, user_id, old_ranking, new_ranking, changed_by_user_id, reason)
       VALUES ($1, $2, $3, $4, 50, 75, $5, 'Promoted for stellar delivery')`,
      [eventAId, fx.org1Id, fx.managerA.id, fx.memberA1.id, fx.managerA.id],
    );
  });

  const eventBId = randomUUID();

  await withTenant(ctxFor(fx.managerB), async (c) => {
    await c.query(
      `INSERT INTO ranking_event (id, org_id, manager_id, user_id, old_ranking, new_ranking, changed_by_user_id, reason)
       VALUES ($1, $2, $3, $4, 50, 80, $5, 'Consistently fast relay hand-offs')`,
      [eventBId, fx.org1Id, fx.managerB.id, fx.memberB1.id, fx.managerB.id],
    );
  });

  const eventCId = randomUUID();

  await withTenant(ctxFor(fx.managerC), async (c) => {
    await c.query(
      `INSERT INTO ranking_event (id, org_id, manager_id, user_id, old_ranking, new_ranking, changed_by_user_id, reason)
       VALUES ($1, $2, $3, $4, 50, 90, $5, 'Org 2 top performer')`,
      [eventCId, fx.org2Id, fx.managerC.id, fx.memberC1.id, fx.managerC.id],
    );
  });

  return { eventAId, eventBId, eventCId };
}

beforeAll(async () => {
  await truncateAll();
  fx = await seedFixture();
  rf = await seedRankingFixture();
});

afterAll(async () => {
  await closePools();
});

describe('Ranking RLS — Database layer', () => {
  it('Manager A sees only ranking events from their own team (not Manager B or Org 2)', async () => {
    await withTenant(ctxFor(fx.managerA), async (c) => {
      const { rows } = await c.query<{ id: string }>(
        'SELECT id FROM ranking_event ORDER BY created_at ASC',
      );
      expect(rows.map((r) => r.id)).toEqual([rf.eventAId]);
    });
  });

  it('Manager A cannot read Manager B ranking event by ID', async () => {
    await withTenant(ctxFor(fx.managerA), async (c) => {
      const { rows } = await c.query(
        'SELECT id FROM ranking_event WHERE id = $1',
        [rf.eventBId],
      );
      expect(rows).toHaveLength(0);
    });
  });

  it('Member A1 sees only their own ranking events (not other teams or orgs)', async () => {
    await withTenant(ctxFor(fx.memberA1), async (c) => {
      const { rows } = await c.query<{ id: string }>(
        'SELECT id FROM ranking_event ORDER BY created_at ASC',
      );
      expect(rows.map((r) => r.id)).toEqual([rf.eventAId]);
    });
  });

  it('Member A2 cannot see Member A1 ranking events on the same team (role-branched RLS isolation)', async () => {
    await withTenant(ctxFor(fx.memberA2), async (c) => {
      const { rows } = await c.query<{ id: string }>(
        'SELECT id FROM ranking_event WHERE id = $1',
        [rf.eventAId],
      );
      expect(rows).toHaveLength(0);
    });
  });

  it('Owner sees all ranking events in Org 1 (both Manager A and B) but not Org 2', async () => {
    await withTenant(ctxFor(fx.owner1), async (c) => {
      const { rows } = await c.query<{ id: string }>(
        'SELECT id FROM ranking_event ORDER BY created_at ASC',
      );
      const ids = rows.map((r) => r.id);
      expect(ids).toContain(rf.eventAId);
      expect(ids).toContain(rf.eventBId);
      expect(ids).not.toContain(rf.eventCId);
    });
  });

  it('Unauthenticated (context-free) query returns zero ranking events', async () => {
    await withoutTenant(async (c) => {
      const { rows } = await c.query('SELECT * FROM ranking_event');
      expect(rows).toHaveLength(0);
    });
  });

  it('Rejects ranking event with ranking outside 0..100 range', async () => {
    await withTenant(ctxFor(fx.managerA), async (c) => {
      await expect(
        c.query(
          `INSERT INTO ranking_event (org_id, manager_id, user_id, old_ranking, new_ranking, changed_by_user_id, reason)
           VALUES ($1, $2, $3, 50, 150, $4, 'Invalid score')`,
          [fx.org1Id, fx.managerA.id, fx.memberA1.id, fx.managerA.id],
        ),
      ).rejects.toThrow();
    });
  });

  it('Rejects composite FK violation across organizations', async () => {
    await withTenant(ctxFor(fx.managerA), async (c) => {
      // Trying to reference memberC1 (Org 2) with org1Id
      await expect(
        c.query(
          `INSERT INTO ranking_event (org_id, manager_id, user_id, old_ranking, new_ranking, changed_by_user_id, reason)
           VALUES ($1, $2, $3, 50, 60, $4, 'Cross-org user reference')`,
          [fx.org1Id, fx.managerA.id, fx.memberC1.id, fx.managerA.id],
        ),
      ).rejects.toThrow();
    });
  });

  it('Rejects empty or whitespace reason at DB level via check constraint', async () => {
    await withTenant(ctxFor(fx.managerA), async (c) => {
      await expect(
        c.query(
          `INSERT INTO ranking_event (org_id, manager_id, user_id, old_ranking, new_ranking, changed_by_user_id, reason)
           VALUES ($1, $2, $3, 50, 60, $4, '   ')`,
          [fx.org1Id, fx.managerA.id, fx.memberA1.id, fx.managerA.id],
        ),
      ).rejects.toThrow(/ranking_event_reason_non_empty/);
    });
  });
});
