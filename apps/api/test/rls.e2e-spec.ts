/**
 * Row-level security, proven at the database layer with no HTTP in the picture.
 *
 * This is the deeper half of the isolation gate (CLAUDE.md §11). The HTTP suite
 * proves the guards reject cross-tenant requests; this proves that even if every
 * guard were removed and a query shipped without a WHERE clause, Postgres itself
 * returns nothing. Two independent layers, tested independently — a single suite
 * covering only the HTTP layer would pass just as happily with RLS switched off.
 *
 * Every query here runs as relay_app, the runtime role. Running as the migrator
 * would bypass the policies and make the whole file a no-op that looks green.
 */
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

beforeAll(async () => {
  await truncateAll();
  fx = await seedFixture();
});

afterAll(async () => {
  await truncateAll();
  await closePools();
});

describe('RLS: the runtime role is correctly de-privileged', () => {
  it('connects as relay_app, not as the table owner', async () => {
    const { rows } = await appPool.query<{ current_user: string }>(
      'SELECT current_user',
    );
    expect(rows[0].current_user).toBe('relay_app');
  });

  it('does not hold superuser or BYPASSRLS', async () => {
    const { rows } = await appPool.query<{
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>(
      `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
    );
    expect(rows[0].rolsuper).toBe(false);
    expect(rows[0].rolbypassrls).toBe(false);
  });

  it('owns none of the tenant tables', async () => {
    const { rows } = await appPool.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tableowner = current_user`,
    );
    expect(rows).toHaveLength(0);
  });
});

describe('RLS: Manager A cannot reach Manager B (same organization)', () => {
  it('sees only its own team when selecting all teams', async () => {
    const teams = await withTenant(ctxFor(fx.managerA), async (c) => {
      const { rows } = await c.query<{ id: string; name: string }>(
        'SELECT id, name FROM team',
      );
      return rows;
    });

    expect(teams).toHaveLength(1);
    expect(teams[0].id).toBe(fx.teamAId);
  });

  it('gets zero rows for Team B even when asking for it by exact id', async () => {
    // The ID-guessing attack, at the layer that has to be the last line of
    // defence. An explicit primary-key lookup is the strongest form of the
    // request and it must still come back empty.
    const rows = await withTenant(ctxFor(fx.managerA), async (c) => {
      const res = await c.query('SELECT id FROM team WHERE id = $1', [fx.teamBId]);
      return res.rows;
    });
    expect(rows).toHaveLength(0);
  });

  it("gets zero rows for Manager B's member by exact id", async () => {
    const rows = await withTenant(ctxFor(fx.managerA), async (c) => {
      const res = await c.query('SELECT id, email FROM "user" WHERE id = $1', [
        fx.memberB1.id,
      ]);
      return res.rows;
    });
    expect(rows).toHaveLength(0);
  });

  it("gets zero rows for Manager B's own user row", async () => {
    const rows = await withTenant(ctxFor(fx.managerA), async (c) => {
      const res = await c.query('SELECT id FROM "user" WHERE id = $1', [fx.managerB.id]);
      return res.rows;
    });
    expect(rows).toHaveLength(0);
  });

  it('sees only its own members plus itself when selecting all users', async () => {
    const rows = await withTenant(ctxFor(fx.managerA), async (c) => {
      const res = await c.query<{ id: string }>('SELECT id FROM "user"');
      return res.rows;
    });

    const visible = new Set(rows.map((r) => r.id));
    expect(visible).toEqual(
      new Set([fx.managerA.id, fx.memberA1.id, fx.memberA2.id]),
    );
    // Spelled out separately from the set comparison: if the predicate ever
    // changes shape, this is the assertion whose failure names the actual risk.
    expect(visible.has(fx.memberB1.id)).toBe(false);
    expect(visible.has(fx.owner1.id)).toBe(false);
  });

  it("cannot UPDATE Manager B's member (zero rows affected, no error)", async () => {
    // An UPDATE filtered out by RLS reports success with rowCount 0. Asserting
    // on rowCount is what distinguishes "refused" from "quietly applied".
    const affected = await withTenant(ctxFor(fx.managerA), async (c) => {
      const res = await c.query(
        `UPDATE "user" SET role_title = 'pwned' WHERE id = $1`,
        [fx.memberB1.id],
      );
      return res.rowCount;
    });
    expect(affected).toBe(0);

    // Confirm from a context that CAN see the row that it really is unchanged.
    const title = await withTenant(ctxFor(fx.managerB), async (c) => {
      const res = await c.query<{ role_title: string }>(
        'SELECT role_title FROM "user" WHERE id = $1',
        [fx.memberB1.id],
      );
      return res.rows[0].role_title;
    });
    expect(title).toBe('Contributor');
  });

  it("cannot DELETE Manager B's member", async () => {
    const affected = await withTenant(ctxFor(fx.managerA), async (c) => {
      const res = await c.query('DELETE FROM "user" WHERE id = $1', [fx.memberB1.id]);
      return res.rowCount;
    });
    expect(affected).toBe(0);

    const stillThere = await withTenant(ctxFor(fx.managerB), async (c) => {
      const res = await c.query('SELECT id FROM "user" WHERE id = $1', [fx.memberB1.id]);
      return res.rows.length;
    });
    expect(stillThere).toBe(1);
  });

  it('cannot INSERT a member into Team B (WITH CHECK rejects it)', async () => {
    // Unlike SELECT/UPDATE, a disallowed INSERT raises rather than silently
    // doing nothing: WITH CHECK is a hard failure, which is what we want when
    // the write target is another tenant.
    await expect(
      withTenant(ctxFor(fx.managerA), async (c) => {
        await c.query(
          `INSERT INTO "user" (id, org_id, role, name, email, manager_id, team_id)
           VALUES (gen_random_uuid(), $1, 'member', 'Injected', $2, $3, $4)`,
          [fx.org1Id, 'injected@acme.test', fx.managerB.id, fx.teamBId],
        );
      }),
    ).rejects.toThrow(/row-level security/i);
  });

  it('cannot escalate by inserting a user attributed to itself in another org', async () => {
    await expect(
      withTenant(ctxFor(fx.managerA), async (c) => {
        await c.query(
          `INSERT INTO "user" (id, org_id, role, name, email, manager_id)
           VALUES (gen_random_uuid(), $1, 'member', 'CrossOrg', $2, $3)`,
          [fx.org2Id, 'crossorg@globex.test', fx.managerA.id],
        );
      }),
    ).rejects.toThrow(/row-level security/i);
  });
});

describe('RLS: Member A1 is scoped to its own manager', () => {
  it("cannot see Manager B's team or members", async () => {
    const result = await withTenant(ctxFor(fx.memberA1), async (c) => {
      const team = await c.query('SELECT id FROM team WHERE id = $1', [fx.teamBId]);
      const member = await c.query('SELECT id FROM "user" WHERE id = $1', [
        fx.memberB1.id,
      ]);
      return { teams: team.rows.length, members: member.rows.length };
    });
    expect(result).toEqual({ teams: 0, members: 0 });
  });

  it('sees the same tenant slice as its manager', async () => {
    // A Member's manager_id equals their Manager's, so the predicate yields the
    // same rows. Field-level restrictions are the app layer's job, not RLS's.
    const rows = await withTenant(ctxFor(fx.memberA1), async (c) => {
      const res = await c.query<{ id: string }>('SELECT id FROM "user"');
      return res.rows;
    });
    expect(new Set(rows.map((r) => r.id))).toEqual(
      new Set([fx.managerA.id, fx.memberA1.id, fx.memberA2.id]),
    );
  });
});

describe('RLS: Owner scope stops at the organization boundary', () => {
  it('sees every user in its own org', async () => {
    const rows = await withTenant(ctxFor(fx.owner1), async (c) => {
      const res = await c.query<{ id: string }>('SELECT id FROM "user"');
      return res.rows;
    });
    expect(new Set(rows.map((r) => r.id))).toEqual(
      new Set([
        fx.owner1.id,
        fx.managerA.id,
        fx.memberA1.id,
        fx.memberA2.id,
        fx.managerB.id,
        fx.memberB1.id,
        fx.memberB2.id,
      ]),
    );
  });

  it('sees both teams in its own org', async () => {
    const rows = await withTenant(ctxFor(fx.owner1), async (c) => {
      const res = await c.query<{ id: string }>('SELECT id FROM team');
      return res.rows;
    });
    expect(new Set(rows.map((r) => r.id))).toEqual(new Set([fx.teamAId, fx.teamBId]));
  });

  it('sees nothing belonging to the other organization', async () => {
    // The owner bypass is scoped by org_id first, so "owner" never means
    // "sees everything" — only "sees everything within one tenant".
    const result = await withTenant(ctxFor(fx.owner1), async (c) => {
      const team = await c.query('SELECT id FROM team WHERE id = $1', [fx.teamCId]);
      const user = await c.query('SELECT id FROM "user" WHERE id = $1', [
        fx.memberC1.id,
      ]);
      const org = await c.query('SELECT id FROM organization WHERE id = $1', [
        fx.org2Id,
      ]);
      return {
        teams: team.rows.length,
        users: user.rows.length,
        orgs: org.rows.length,
      };
    });
    expect(result).toEqual({ teams: 0, users: 0, orgs: 0 });
  });

  it('sees only its own organization row', async () => {
    const rows = await withTenant(ctxFor(fx.owner1), async (c) => {
      const res = await c.query<{ id: string }>('SELECT id FROM organization');
      return res.rows;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(fx.org1Id);
  });
});

describe('RLS: positive controls', () => {
  // Without these, a policy that rejected literally everything would satisfy
  // every negative case above. This is the half that keeps the suite honest.
  it('Manager A can read its own team and members', async () => {
    const result = await withTenant(ctxFor(fx.managerA), async (c) => {
      const team = await c.query<{ name: string }>(
        'SELECT name FROM team WHERE id = $1',
        [fx.teamAId],
      );
      const members = await c.query(
        `SELECT id FROM "user" WHERE role = 'member' AND team_id = $1`,
        [fx.teamAId],
      );
      return { teamName: team.rows[0]?.name, memberCount: members.rows.length };
    });
    expect(result.teamName).toBe('Team A');
    expect(result.memberCount).toBe(2);
  });

  it('Manager A can update its own member', async () => {
    const affected = await withTenant(ctxFor(fx.managerA), async (c) => {
      const res = await c.query(
        `UPDATE "user" SET role_title = 'Senior Contributor' WHERE id = $1`,
        [fx.memberA1.id],
      );
      return res.rowCount;
    });
    expect(affected).toBe(1);

    // Restore, so test order cannot affect later assertions.
    await withTenant(ctxFor(fx.managerA), async (c) => {
      await c.query(`UPDATE "user" SET role_title = 'Contributor' WHERE id = $1`, [
        fx.memberA1.id,
      ]);
    });
  });

  it('Manager B can read its own member (the row A could not touch)', async () => {
    const rows = await withTenant(ctxFor(fx.managerB), async (c) => {
      const res = await c.query<{ email: string }>(
        'SELECT email FROM "user" WHERE id = $1',
        [fx.memberB1.id],
      );
      return res.rows;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe(fx.memberB1.email);
  });
});

describe('RLS: fails closed with no tenant context', () => {
  it('returns zero rows from every tenant table when nothing is set', async () => {
    // current_setting(..., true) is NULL when unset, and comparing to NULL is
    // false, so an unauthenticated connection sees nothing rather than
    // everything. The failure mode is an empty result, not a breach.
    const counts = await withoutTenant(async (c) => {
      const users = await c.query('SELECT id FROM "user"');
      const teams = await c.query('SELECT id FROM team');
      const orgs = await c.query('SELECT id FROM organization');
      return {
        users: users.rows.length,
        teams: teams.rows.length,
        orgs: orgs.rows.length,
      };
    });
    expect(counts).toEqual({ users: 0, teams: 0, orgs: 0 });
  });

  it('rejects writes when no tenant context is set', async () => {
    await expect(
      withoutTenant(async (c) => {
        await c.query('INSERT INTO organization (id, name) VALUES ($1, $2)', [
          crypto.randomUUID(),
          'Ghost Org',
        ]);
      }),
    ).rejects.toThrow(/row-level security/i);
  });

  it('does not leak across pooled connections after a scoped transaction', async () => {
    // set_config(..., true) is transaction-local. If it were session-wide, the
    // next request to reuse this pooled connection would inherit the previous
    // tenant's context — the exact bug this design exists to prevent.
    await withTenant(ctxFor(fx.managerA), async (c) => {
      await c.query('SELECT id FROM "user"');
    });

    const leaked = await withoutTenant(async (c) => {
      const res = await c.query('SELECT id FROM "user"');
      return res.rows.length;
    });
    expect(leaked).toBe(0);
  });
});

describe('RLS: audit_log is append-only', () => {
  it('allows a manager to insert (append-only, no read-back)', async () => {
    // INSERT succeeds, but RETURNING would fail because SELECT is owner-only.
    // Production never needs the id back: audit_log is write-only for managers.
    const inserted = await withTenant(ctxFor(fx.managerA), async (c) => {
      const res = await c.query(
        `INSERT INTO audit_log (org_id, actor_user_id, action)
         VALUES ($1, $2, 'test.event')`,
        [fx.org1Id, fx.managerA.id],
      );
      return res.rowCount;
    });
    expect(inserted).toBe(1);

    // Confirm it's invisible to the manager who wrote it.
    const visible = await withTenant(ctxFor(fx.managerA), async (c) => {
      const res = await c.query('SELECT id FROM audit_log');
      return res.rows.length;
    });
    expect(visible).toBe(0);
  });

  it('lets the owner read its own org audit entries', async () => {
    const rows = await withTenant(ctxFor(fx.owner1), async (c) => {
      const res = await c.query<{ action: string }>('SELECT action FROM audit_log');
      return res.rows;
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => typeof r.action === 'string')).toBe(true);
  });

  it('denies UPDATE and DELETE to the runtime role entirely', async () => {
    // Two independent reasons this fails: no UPDATE/DELETE grant, and no
    // permissive policy for those commands. Either alone would suffice.
    await expect(
      withTenant(ctxFor(fx.owner1), async (c) => {
        await c.query(`UPDATE audit_log SET action = 'tampered'`);
      }),
    ).rejects.toThrow(/permission denied|row-level security/i);

    await expect(
      withTenant(ctxFor(fx.owner1), async (c) => {
        await c.query('DELETE FROM audit_log');
      }),
    ).rejects.toThrow(/permission denied|row-level security/i);
  });

  it('cannot write an audit entry attributed to another organization', async () => {
    await expect(
      withTenant(ctxFor(fx.managerA), async (c) => {
        await c.query(
          `INSERT INTO audit_log (org_id, actor_user_id, action)
           VALUES ($1, $2, 'cross.org')`,
          [fx.org2Id, fx.managerA.id],
        );
      }),
    ).rejects.toThrow(/row-level security/i);
  });
});

describe('schema invariants that isolation depends on', () => {
  it("enforces manager_id = id for managers", async () => {
    // If this CHECK were missing, a manager row with the wrong manager_id would
    // land in another manager's tenant slice — a data-level cross-tenant leak
    // that no amount of query scoping would catch.
    await expect(
      withTenant(ctxFor(fx.owner1), async (c) => {
        await c.query(
          `INSERT INTO "user" (id, org_id, role, name, email, manager_id)
           VALUES (gen_random_uuid(), $1, 'manager', 'Bad Manager', $2, $3)`,
          [fx.org1Id, 'bad.manager@acme.test', fx.managerB.id],
        );
      }),
    ).rejects.toThrow(/user_manager_id_invariant/);
  });

  it('enforces manager_id IS NULL for owners', async () => {
    await expect(
      withTenant(ctxFor(fx.owner1), async (c) => {
        await c.query(
          `INSERT INTO "user" (id, org_id, role, name, email, manager_id)
           VALUES (gen_random_uuid(), $1, 'owner', 'Bad Owner', $2, $3)`,
          [fx.org1Id, 'bad.owner@acme.test', fx.managerA.id],
        );
      }),
    ).rejects.toThrow(/user_manager_id_invariant/);
  });

  it('requires a non-self manager_id for members', async () => {
    const id = crypto.randomUUID();
    await expect(
      withTenant(ctxFor(fx.owner1), async (c) => {
        await c.query(
          `INSERT INTO "user" (id, org_id, role, name, email, manager_id)
           VALUES ($1, $2, 'member', 'Self Member', $3, $1)`,
          [id, fx.org1Id, 'self.member@acme.test'],
        );
      }),
    ).rejects.toThrow(/user_manager_id_invariant/);
  });

  it('allows one active team per manager and rejects a second', async () => {
    await expect(
      withTenant(ctxFor(fx.managerA), async (c) => {
        await c.query(
          'INSERT INTO team (id, org_id, manager_id, name) VALUES (gen_random_uuid(), $1, $2, $3)',
          [fx.org1Id, fx.managerA.id, 'Team A Duplicate'],
        );
      }),
    ).rejects.toThrow(/team_manager_id_active_key/);
  });

  it('treats email uniqueness as case-insensitive within an org', async () => {
    // citext, so Owner1@ACME.test collides with owner1@acme.test. Without this,
    // two accounts could differ only by case — an obvious impersonation vector.
    await expect(
      withTenant(ctxFor(fx.owner1), async (c) => {
        await c.query(
          `INSERT INTO "user" (id, org_id, role, name, email, manager_id)
           VALUES (gen_random_uuid(), $1, 'member', 'Case Clash', $2, $3)`,
          [fx.org1Id, 'Owner1@ACME.test', fx.managerA.id],
        );
      }),
    ).rejects.toThrow(/user_org_id_email_key/);
  });

  it('permits the same email address in a different organization', async () => {
    // The flip side: a global unique index would leak that an address is
    // already registered in some other tenant.
    const inserted = await withTenant(ctxFor(fx.owner2), async (c) => {
      const res = await c.query(
        `INSERT INTO "user" (id, org_id, role, name, email, manager_id)
         VALUES (gen_random_uuid(), $1, 'member', 'Same Email', $2, $3) RETURNING id`,
        [fx.org2Id, 'owner1@acme.test', fx.managerC.id],
      );
      return res.rows.length;
    });
    expect(inserted).toBe(1);
  });

  // --- Composite-FK org-consistency invariants (migration 0005) -----------
  // The single-column FKs (team_manager_id_fkey, user_manager_id_fkey,
  // user_team_id_fkey) check that the referenced id EXISTS, not that it shares
  // the org. RLS does not fill the gap: an owner's WITH CHECK reduces to
  // `org_id = app_current_org_id()`, leaving manager_id/team_id unconstrained.
  // So the dangerous row is an OWNER inserting into their OWN org (passes RLS)
  // while naming another org's manager/team. Only the composite FKs added in
  // 0005 reject it — and they can, because referential-integrity checks bypass
  // RLS (the mirror of the SECURITY DEFINER lesson in 0002/0003): the check sees
  // the cross-org row this session cannot SELECT and refuses it.
  //
  // The fixture is itself the positive control for the user-level FKs: seedFixture
  // (beforeAll) only succeeds because every member's manager_id/team_id already
  // references a same-org row under these now-applied constraints.
  describe('composite-FK tenant invariants (org-consistency)', () => {
    it('rejects a team whose manager belongs to another org', async () => {
      // org_id = owner1's own org, so the team WITH CHECK passes; managerC is in
      // org2, so only team_org_id_manager_id_fkey can stop it. status='deleted'
      // keeps the partial team_manager_id_active_key out of the way, isolating
      // the composite FK as the sole rejection cause.
      await expect(
        withTenant(ctxFor(fx.owner1), async (c) => {
          await c.query(
            `INSERT INTO team (id, org_id, manager_id, name, status)
             VALUES ($1, $2, $3, 'Cross-Org Team', 'deleted')`,
            [crypto.randomUUID(), fx.org1Id, fx.managerC.id],
          );
        }),
      ).rejects.toThrow(/team_org_id_manager_id_fkey/);
    });

    it('rejects that team via a FK violation (23503), not a row-level-security error', async () => {
      // Distinguishes "the FK did the work" from "RLS happened to block it". A
      // 42501 here would mean RLS stopped the insert and the FK was never
      // exercised — the assertion above would then be proving nothing.
      let code: string | undefined;
      let message = '';
      try {
        await withTenant(ctxFor(fx.owner1), async (c) => {
          await c.query(
            `INSERT INTO team (id, org_id, manager_id, name, status)
             VALUES ($1, $2, $3, 'Cross-Org Team 2', 'deleted')`,
            [crypto.randomUUID(), fx.org1Id, fx.managerC.id],
          );
        });
      } catch (err) {
        code = (err as { code?: string }).code;
        message = (err as Error).message;
      }
      expect(code).toBe('23503'); // foreign_key_violation, not 42501 (RLS)
      expect(message).not.toMatch(/row-level security/i);
    });

    it('accepts a team whose manager belongs to the same org (positive control)', async () => {
      // Identical to the negative case but for the manager's org — so a blanket-
      // rejecting FK would fail here. Inserted status='deleted' to stay clear of
      // team_manager_id_active_key, then removed in the same tx; the FK is checked
      // on INSERT regardless of status, so reaching the DELETE proves acceptance.
      const teamId = crypto.randomUUID();
      const affected = await withTenant(ctxFor(fx.owner1), async (c) => {
        const res = await c.query(
          `INSERT INTO team (id, org_id, manager_id, name, status)
           VALUES ($1, $2, $3, 'Same-Org Team', 'deleted')`,
          [teamId, fx.org1Id, fx.managerA.id],
        );
        await c.query('DELETE FROM team WHERE id = $1', [teamId]);
        return res.rowCount;
      });
      expect(affected).toBe(1);
    });

    it('rejects a member whose manager belongs to another org', async () => {
      // manager_id = managerC (org2). user_manager_id_invariant is satisfied
      // (non-null, != id) and the single-column FK sees managerC exists, so the
      // composite self-FK is the only constraint that rejects it.
      await expect(
        withTenant(ctxFor(fx.owner1), async (c) => {
          await c.query(
            `INSERT INTO "user" (id, org_id, role, name, email, manager_id)
             VALUES (gen_random_uuid(), $1, 'member', 'Cross-Org Managed', $2, $3)`,
            [fx.org1Id, 'xorg.managed@acme.test', fx.managerC.id],
          );
        }),
      ).rejects.toThrow(/user_org_id_manager_id_fkey/);
    });

    it("rejects a member placed on another org's team", async () => {
      // manager_id = managerA (same org, valid) isolates the failure to team_id,
      // which points at teamC in org2. user_team_id_fkey checks the team exists
      // (it does); the composite FK enforces same-org.
      await expect(
        withTenant(ctxFor(fx.owner1), async (c) => {
          await c.query(
            `INSERT INTO "user" (id, org_id, role, name, email, manager_id, team_id)
             VALUES (gen_random_uuid(), $1, 'member', 'Cross-Org Teamed', $2, $3, $4)`,
            [fx.org1Id, 'xorg.teamed@acme.test', fx.managerA.id, fx.teamCId],
          );
        }),
      ).rejects.toThrow(/user_org_id_team_id_fkey/);
    });
  });
});
