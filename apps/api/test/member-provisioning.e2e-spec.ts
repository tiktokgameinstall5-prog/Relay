/**
 * Team creation and member provisioning over real HTTP, plus the role-neutral
 * first-login path exercised as a MEMBER (task #7).
 *
 * Three sabotage checks pin the security properties that could regress silently
 * (each run before commit: apply the break, confirm the named test goes red,
 * revert):
 *
 *   #A  first-login role generalisation — the UPDATE's `role IN ('manager',
 *       'member')`. Narrow it back to `role = 'manager'` and a member can no
 *       longer activate: "member activates via first-login (200)" goes red.
 *   #B  RolesGuard on the new routes — `@Roles('owner','manager')`. Remove it
 *       and a member can provision members/teams: the "refuses memberA1 (403)"
 *       cases go red (201).
 *   #C  cross-org manager guard in createTeam — the RLS-scoped `SELECT id FROM
 *       "user" ... role='manager'`. It is the ONLY guard on the target manager
 *       there (the team INSERT's WITH CHECK passes the owner branch). Two paired
 *       tests pin its removal, because the outcome depends on the target:
 *         - target manager in another org WITH an active team → removal is masked
 *           into a 409 by the partial unique index team_manager_id_active_key
 *           (enforced below RLS, so it sees across orgs). "…a manager in another
 *           org (400)" goes red as a 409.
 *         - target manager in another org with NO team → the unmasked breach: a
 *           201 creating an org1 team owned by an org2 manager. "…a TEAMLESS
 *           manager in another org" goes red as a 201, and its leaked-team
 *           assertion fires. This is the genuine cross-org breach.
 *
 * (createMember has the same manager lookup, but there it is defence-in-depth:
 * the active-team lookup is a second RLS-scoped guard, so removing the first
 * turns the cross-org case into a 409 rather than a 201. The createTeam guard is
 * the one whose removal actually breaches, so that is where #C lives.)
 */
import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { closePools, truncateAll, withTenant } from './helpers/db';
import { seedFixture, type Fixture, type SeededUser } from './helpers/seed';
import { bearer } from './helpers/token';

jest.setTimeout(30_000);

let app: INestApplication;
let http: ReturnType<typeof request>;
let fx: Fixture;

/** Monotonic per-run counter so provisioned emails are unique even within one
 *  millisecond — keeps the email+IP login throttler bucket distinct per test. */
let seq = 0;
const freshEmail = (label: string) => `${label}.${Date.now()}.${seq++}@acme.test`;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  await app.init();
  http = request(app.getHttpServer());
});

afterAll(async () => {
  await app.close();
  await truncateAll();
  await closePools();
});

beforeEach(async () => {
  await truncateAll();
  fx = await seedFixture();
});

// --- helpers ---------------------------------------------------------------

/**
 * Provision a fresh Manager (no team yet) through the real Owner route and
 * return a SeededUser shaped so `bearer()` can mint a token for it. Defaults to
 * owner1/org1; pass owner2/org2 to seed a teamless manager in the other org (the
 * genuine cross-org breach subject).
 *
 * A provisioned-but-not-activated manager has `password_hash IS NULL`, which
 * blocks password login — but NOT JWT auth: JwtStrategy re-reads the row and
 * only checks `status = 'active'`, which a freshly provisioned manager is. So a
 * minted token authenticates them, which is exactly what lets us test "a manager
 * creates their own team" without a login round trip. Their tenant key is their
 * own id (the manager_id self-reference), so managerId = id.
 */
async function provisionTeamlessManager(
  owner: SeededUser = fx.owner1,
  orgId: string = fx.org1Id,
): Promise<SeededUser> {
  const email = freshEmail('mgr');
  const res = await http
    .post('/api/auth/managers')
    .set('Authorization', bearer(owner))
    .send({ name: 'Fresh Manager', email })
    .expect(201);

  return {
    id: res.body.id,
    email,
    role: 'manager',
    orgId,
    managerId: res.body.id,
    teamId: null,
  };
}

/**
 * Provision a Member while capturing the console mailer's output.
 *
 * The plaintext passcode exists in exactly one place — the invite email — so
 * reading the log is the only way a test can learn it, and that is what makes
 * "never in the body" / "never in the URL" real: they compare against the actual
 * secret, not the literal string "passcode". Mirrors the manager spec.
 */
async function provisionMemberCapturingMail(
  actor: SeededUser,
  body: { name: string; email: string; managerId?: string },
): Promise<{ res: request.Response; mail: string; passcode: string }> {
  const captured: string[] = [];
  const spy = jest
    .spyOn(Logger.prototype, 'log')
    .mockImplementation((message: unknown) => {
      captured.push(String(message));
    });

  try {
    const res = await http
      .post('/api/auth/members')
      .set('Authorization', bearer(actor))
      .send(body)
      .expect(201);

    const mail = captured.find((m) => m.includes('MAIL (console driver)')) ?? '';
    const match = mail.match(/Your passcode: (\S+)/);
    if (!match) {
      throw new Error(`No passcode found in captured mail. Captured:\n${captured.join('\n')}`);
    }
    return { res, mail, passcode: match[1] };
  } finally {
    spy.mockRestore();
  }
}

// --- teams -----------------------------------------------------------------

describe('POST /api/auth/teams', () => {
  it('lets an Owner create a team for a named teamless manager (201) and sets team membership', async () => {
    const mgr = await provisionTeamlessManager();

    const res = await http
      .post('/api/auth/teams')
      .set('Authorization', bearer(fx.owner1))
      .send({ name: 'Design', managerId: mgr.id })
      .expect(201);

    expect(res.body).toMatchObject({
      name: 'Design',
      managerId: mgr.id,
      status: 'active',
    });
    expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/);

    // The manager is made a member of their own team, matching the fixtures and
    // the dashboards that read team membership.
    const row = await withTenant(
      { orgId: fx.org1Id, role: 'owner', managerId: null },
      async (c) => {
        const { rows } = await c.query<{ team_id: string }>(
          'SELECT team_id FROM "user" WHERE id = $1',
          [mgr.id],
        );
        return rows[0];
      },
    );
    expect(row.team_id).toBe(res.body.id);
  });

  it('refuses a second active team for the same manager (409)', async () => {
    const mgr = await provisionTeamlessManager();

    await http
      .post('/api/auth/teams')
      .set('Authorization', bearer(fx.owner1))
      .send({ name: 'First', managerId: mgr.id })
      .expect(201);

    await http
      .post('/api/auth/teams')
      .set('Authorization', bearer(fx.owner1))
      .send({ name: 'Second', managerId: mgr.id })
      .expect(409);
  });

  it('lets a Manager create their own team (201, managerId ignored → self)', async () => {
    const mgr = await provisionTeamlessManager();

    const res = await http
      .post('/api/auth/teams')
      .set('Authorization', bearer(mgr))
      .send({ name: 'My Team' })
      .expect(201);

    expect(res.body.managerId).toBe(mgr.id);
  });

  it('refuses a Manager a second own team (409)', async () => {
    const mgr = await provisionTeamlessManager();

    await http
      .post('/api/auth/teams')
      .set('Authorization', bearer(mgr))
      .send({ name: 'One' })
      .expect(201);

    await http
      .post('/api/auth/teams')
      .set('Authorization', bearer(mgr))
      .send({ name: 'Two' })
      .expect(409);
  });

  it('refuses a Manager naming another manager (400)', async () => {
    // managerA names managerB. Rejected in resolveTargetManagerId before any DB
    // work: a manager can only ever create under their own id.
    await http
      .post('/api/auth/teams')
      .set('Authorization', bearer(fx.managerA))
      .send({ name: 'Poach', managerId: fx.managerB.id })
      .expect(400);
  });

  it('refuses an Owner who omits managerId (400)', async () => {
    // An Owner has no team of their own, so there is no sensible default.
    await http
      .post('/api/auth/teams')
      .set('Authorization', bearer(fx.owner1))
      .send({ name: 'Orphan' })
      .expect(400);
  });

  // SABOTAGE CHECK #B: remove @Roles('owner','manager') → this returns 201.
  it('refuses memberA1 (403)', async () => {
    await http
      .post('/api/auth/teams')
      .set('Authorization', bearer(fx.memberA1))
      .send({ name: 'Nope', managerId: fx.memberA1.id })
      .expect(403);
  });

  it('refuses unauthenticated (401, not 403 — guard order)', async () => {
    await http.post('/api/auth/teams').send({ name: 'Nope' }).expect(401);
  });

  // SABOTAGE CHECK #C (masked-breach half): remove the RLS-scoped manager lookup
  // in createTeam and this goes red — but as a 409, not a 201. managerC already
  // has an active team, so the INSERT trips team_manager_id_active_key (a partial
  // unique index enforced below RLS, so it sees across orgs) before any breach
  // lands. The unmasked 201 breach is the TEAMLESS companion test below.
  it('refuses an Owner creating a team for a manager in another org (400)', async () => {
    await http
      .post('/api/auth/teams')
      .set('Authorization', bearer(fx.owner1))
      .send({ name: 'Cross', managerId: fx.managerC.id })
      .expect(400);

    // And nothing was created — no org1 team points at the org2 manager.
    const leaked = await withTenant(
      { orgId: fx.org1Id, role: 'owner', managerId: null },
      async (c) => {
        const { rows } = await c.query(
          'SELECT id FROM team WHERE manager_id = $1',
          [fx.managerC.id],
        );
        return rows;
      },
    );
    expect(leaked).toHaveLength(0);
  });

  // SABOTAGE CHECK #C (unmasked-breach half): the target is a TEAMLESS manager in
  // another org, so the unique index does not fire. Removing the createTeam guard
  // lets this INSERT succeed — a 201 creating an org1 team (org_id = owner1's) owned
  // by an org2 manager, the genuine cross-org breach. The guard turns it into a 400
  // (the row is invisible under RLS, so createTeam reports "no such manager").
  it('refuses an Owner creating a team for a TEAMLESS manager in another org (400, not a 201 breach)', async () => {
    const foreignMgr = await provisionTeamlessManager(fx.owner2, fx.org2Id);

    await http
      .post('/api/auth/teams')
      .set('Authorization', bearer(fx.owner1))
      .send({ name: 'CrossFresh', managerId: foreignMgr.id })
      .expect(400);

    // Belt and braces: no org1 team was created for the org2 manager. This is the
    // assertion that fails on the 201 path if the 400 expectation were ever relaxed.
    const leaked = await withTenant(
      { orgId: fx.org1Id, role: 'owner', managerId: null },
      async (c) => {
        const { rows } = await c.query(
          'SELECT id FROM team WHERE manager_id = $1',
          [foreignMgr.id],
        );
        return rows;
      },
    );
    expect(leaked).toHaveLength(0);
  });
});

// --- members ---------------------------------------------------------------

describe('POST /api/auth/members', () => {
  it('lets an Owner add a member to a named manager\'s team (201) and stores the row correctly', async () => {
    const email = freshEmail('member');
    const res = await http
      .post('/api/auth/members')
      .set('Authorization', bearer(fx.owner1))
      .send({ name: 'New Member', email, managerId: fx.managerA.id })
      .expect(201);

    expect(res.body).toMatchObject({
      role: 'member',
      status: 'active',
      email,
      teamId: fx.teamAId,
    });
    expect(res.body.passcodeExpiresAt).toBeTruthy();

    const row = await withTenant(
      { orgId: fx.org1Id, role: 'owner', managerId: null },
      async (c) => {
        const { rows } = await c.query<{
          role: string;
          manager_id: string;
          team_id: string;
          password_hash: string | null;
          passcode_hash: string | null;
        }>(
          'SELECT role, manager_id, team_id, password_hash, passcode_hash FROM "user" WHERE id = $1',
          [res.body.id],
        );
        return rows[0];
      },
    );

    expect(row.role).toBe('member');
    expect(row.manager_id).toBe(fx.managerA.id);
    expect(row.team_id).toBe(fx.teamAId);
    expect(row.password_hash).toBeNull();
    // Passcode is bcrypt-hashed at rest, never plaintext or a fast digest.
    expect(row.passcode_hash).toMatch(/^\$2[aby]\$/);
  });

  it('lets a Manager add a member to their own team (201, team resolved to theirs)', async () => {
    const email = freshEmail('member');
    const res = await http
      .post('/api/auth/members')
      .set('Authorization', bearer(fx.managerA))
      .send({ name: 'A Member', email })
      .expect(201);

    expect(res.body.teamId).toBe(fx.teamAId);
  });

  it('refuses a Manager naming another manager (400)', async () => {
    await http
      .post('/api/auth/members')
      .set('Authorization', bearer(fx.managerA))
      .send({ name: 'Poach', email: freshEmail('member'), managerId: fx.managerB.id })
      .expect(400);
  });

  it('refuses an Owner targeting a manager with no team yet (409)', async () => {
    const mgr = await provisionTeamlessManager();

    await http
      .post('/api/auth/members')
      .set('Authorization', bearer(fx.owner1))
      .send({ name: 'Too Early', email: freshEmail('member'), managerId: mgr.id })
      .expect(409);
  });

  // SABOTAGE CHECK #B: remove @Roles('owner','manager') → this returns 201.
  it('refuses memberA1 (403)', async () => {
    await http
      .post('/api/auth/members')
      .set('Authorization', bearer(fx.memberA1))
      .send({ name: 'Nope', email: freshEmail('member') })
      .expect(403);
  });

  it('refuses unauthenticated (401, not 403 — guard order)', async () => {
    await http
      .post('/api/auth/members')
      .send({ name: 'Nope', email: freshEmail('member') })
      .expect(401);
  });

  it('rejects a duplicate email in the same org (409)', async () => {
    const email = freshEmail('member');
    await http
      .post('/api/auth/members')
      .set('Authorization', bearer(fx.managerA))
      .send({ name: 'First', email })
      .expect(201);

    await http
      .post('/api/auth/members')
      .set('Authorization', bearer(fx.managerA))
      .send({ name: 'Second', email })
      .expect(409);
  });

  // Cross-org guard on createMember. Here the manager lookup is defence-in-depth
  // (the active-team lookup is a second RLS-scoped guard), so the observable
  // outcome is a clean 400 either way — but never a created cross-org member.
  it('refuses an Owner adding a member to a manager in another org (400)', async () => {
    await http
      .post('/api/auth/members')
      .set('Authorization', bearer(fx.owner1))
      .send({ name: 'Cross', email: freshEmail('member'), managerId: fx.managerC.id })
      .expect(400);
  });

  it('never returns the plaintext passcode in the response body', async () => {
    const { res, passcode } = await provisionMemberCapturingMail(fx.managerA, {
      name: 'Check Response',
      email: freshEmail('member'),
    });

    expect(JSON.stringify(res.body)).not.toContain(passcode);
    expect(res.body).not.toHaveProperty('passcode');
  });

  it('emails the passcode as text but never in the invite URL', async () => {
    const { mail, passcode } = await provisionMemberCapturingMail(fx.managerA, {
      name: 'Check Mail',
      email: freshEmail('member'),
    });

    expect(mail).toContain(passcode);

    const url = mail.match(/https?:\/\/\S+/)?.[0] ?? '';
    expect(url).toBeTruthy();
    expect(url).toContain('/invite?email=');
    expect(url).not.toContain(passcode);
  });

  it('records member.provisioned with no passcode/hash in metadata', async () => {
    const email = freshEmail('member');
    const res = await http
      .post('/api/auth/members')
      .set('Authorization', bearer(fx.managerA))
      .send({ name: 'Audit Check', email })
      .expect(201);

    const auditRow = await withTenant(
      { orgId: fx.org1Id, role: 'owner', managerId: null },
      async (c) => {
        const { rows } = await c.query<{ action: string; metadata: unknown }>(
          'SELECT action, metadata FROM audit_log WHERE target_id = $1',
          [res.body.id],
        );
        return rows[0];
      },
    );

    expect(auditRow.action).toBe('member.provisioned');
    const meta = JSON.stringify(auditRow.metadata);
    expect(meta).not.toMatch(/passcode/i);
    expect(meta).not.toMatch(/\$2[aby]\$/);
  });
});

// --- role-neutral first-login, exercised as a member ------------------------

describe('POST /api/auth/first-login (member activation)', () => {
  const NEW_PASSWORD = 'MemberSecurePass123!';

  /** Provision a member on managerA's team and return {email, passcode}. */
  async function provisionMember(): Promise<{ email: string; passcode: string; id: string }> {
    const email = freshEmail('activate');
    const { res, passcode } = await provisionMemberCapturingMail(fx.managerA, {
      name: 'To Activate',
      email,
    });
    return { email, passcode, id: res.body.id };
  }

  // SABOTAGE CHECK #A: narrow the UPDATE's `role IN ('manager','member')` back to
  // `role = 'manager'` → the member's activation UPDATE hits 0 rows → 401.
  it('activates a member via the canonical route (200) and /me shows their slice', async () => {
    const { email, passcode, id } = await provisionMember();

    const res = await http
      .post('/api/auth/first-login')
      .send({ email, passcode, newPassword: NEW_PASSWORD })
      .expect(200);

    expect(res.body.user.role).toBe('member');
    expect(res.body.user.email).toBe(email);
    expect(res.body.accessToken).toBeTruthy();

    const me = await http
      .get('/api/me')
      .set('Authorization', `Bearer ${res.body.accessToken}`)
      .expect(200);
    expect(me.body.role).toBe('member');
    expect(me.body.orgId).toBe(fx.org1Id);
    expect(me.body.teamId).toBe(fx.teamAId);
    expect(me.body.managerId).toBe(fx.managerA.id);
    expect(me.body.id).toBe(id);
  });

  it('also activates a member through the deprecated manager/first-login alias (200)', async () => {
    const { email, passcode } = await provisionMember();

    const res = await http
      .post('/api/auth/manager/first-login')
      .send({ email, passcode, newPassword: NEW_PASSWORD })
      .expect(200);

    expect(res.body.user.role).toBe('member');
  });

  it('lets the activated member sign in through the common password route', async () => {
    const { email, passcode } = await provisionMember();

    await http
      .post('/api/auth/first-login')
      .send({ email, passcode, newPassword: NEW_PASSWORD })
      .expect(200);

    const login = await http
      .post('/api/auth/login')
      .send({ email, password: NEW_PASSWORD })
      .expect(200);
    expect(login.body.user.role).toBe('member');
  });

  it('refuses replay of a consumed passcode (401, indistinguishable from wrong)', async () => {
    const { email, passcode } = await provisionMember();

    await http
      .post('/api/auth/first-login')
      .send({ email, passcode, newPassword: NEW_PASSWORD })
      .expect(200);

    const replay = await http
      .post('/api/auth/first-login')
      .send({ email, passcode, newPassword: 'AnotherPassword123!' })
      .expect(401);

    const wrong = await http
      .post('/api/auth/first-login')
      .send({ email, passcode: 'WRNGXYZ99', newPassword: NEW_PASSWORD })
      .expect(401);

    expect(replay.body).toEqual(wrong.body);
  });

  /**
   * The single-use property is enforced by the UPDATE's WHERE clause, not the JS
   * guard — two concurrent requests with the same valid passcode both pass the JS
   * checks and race to the UPDATE; only one may win. Mirrors the manager spec's
   * race test, which is what actually catches dropping `passcode_used_at IS NULL`
   * from the WHERE (the sequential replay above does not — the JS guard short-
   * circuits it).
   */
  it('lets only one of two concurrent identical requests win (the race)', async () => {
    const { email, passcode } = await provisionMember();

    const [a, b] = await Promise.all([
      http
        .post('/api/auth/first-login')
        .send({ email, passcode, newPassword: NEW_PASSWORD }),
      http
        .post('/api/auth/first-login')
        .send({ email, passcode, newPassword: 'RacingPassword123!' }),
    ]);

    expect([a.status, b.status].sort()).toEqual([200, 401]);
  });

  it('records member.first_login in audit_log', async () => {
    const { email, passcode, id } = await provisionMember();

    await http
      .post('/api/auth/first-login')
      .send({ email, passcode, newPassword: NEW_PASSWORD })
      .expect(200);

    const auditRow = await withTenant(
      { orgId: fx.org1Id, role: 'owner', managerId: null },
      async (c) => {
        const { rows } = await c.query<{ action: string }>(
          'SELECT action FROM audit_log WHERE target_id = $1 AND action = $2',
          [id, 'member.first_login'],
        );
        return rows[0];
      },
    );

    expect(auditRow.action).toBe('member.first_login');
  });
});
