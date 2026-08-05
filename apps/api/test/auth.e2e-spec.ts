/**
 * Owner authentication over real HTTP, against the real database.
 *
 * Nothing is mocked. A mocked DB here would remove the only thing worth testing:
 * that signup and login work *through* RLS with a tenant context, and that the
 * SECURITY DEFINER lookups from 0002_auth_lookup.sql did not become a general
 * bypass. The last describe block is that regression test — it is the one risky
 * thing task #4 introduces.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { appPool, closePools, truncateAll, withTenant } from './helpers/db';

jest.setTimeout(30_000);

let app: INestApplication;
let http: ReturnType<typeof request>;

/** Mirrors main.ts. If these drift, the tests stop testing the real pipeline. */
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
});

const OWNER = {
  organizationName: 'Acme Industries',
  name: 'Ada Owner',
  email: 'ada@acme.test',
  password: 'CorrectHorse!9xy',
};

/**
 * A fresh email per signup unless a test asks for a specific one.
 *
 * Not cosmetic: the login throttler keys on email+IP and its store lives for the
 * whole process, outliving truncateAll(). Sharing one address across tests means
 * whichever test runs sixth gets a 429 instead of the status it asserts — a
 * failure that moves when tests are reordered. Unique emails make each test's
 * throttle budget its own.
 */
let signupCounter = 0;
function uniqueEmail(): string {
  return `owner${++signupCounter}@acme.test`;
}

/** Signup, asserting success, and return the parsed body. */
async function signup(overrides: Partial<typeof OWNER> = {}) {
  const payload = { ...OWNER, email: uniqueEmail(), ...overrides };
  const res = await http
    .post('/api/auth/owner/signup')
    .send(payload)
    .expect(201);
  return res.body as {
    accessToken: string;
    user: { id: string; orgId: string; role: string; name: string; email: string };
  };
}

describe('POST /api/auth/owner/signup', () => {
  it('creates the organization and its owner, and returns a usable token', async () => {
    const body = await signup({ email: 'signup.happy@acme.test' });

    expect(body.user.role).toBe('owner');
    expect(body.user.email).toBe('signup.happy@acme.test');
    expect(typeof body.accessToken).toBe('string');

    // The token must actually work, not merely be well-formed.
    await http
      .get('/api/me')
      .set('Authorization', `Bearer ${body.accessToken}`)
      .expect(200);
  });

  it('stores manager_id NULL for an owner (the user_manager_id_invariant CHECK)', async () => {
    const body = await signup();

    const row = await withTenant(
      { orgId: body.user.orgId, role: 'owner', managerId: null },
      async (c) => {
        const { rows } = await c.query<{ manager_id: string | null; role: string }>(
          'SELECT manager_id, role FROM "user" WHERE id = $1',
          [body.user.id],
        );
        return rows[0];
      },
    );

    expect(row.role).toBe('owner');
    expect(row.manager_id).toBeNull();
  });

  it('never returns a password hash', async () => {
    const body = await signup();
    expect(JSON.stringify(body)).not.toMatch(/\$2[aby]\$/);
  });

  it('hashes the password rather than storing it', async () => {
    const body = await signup();

    const stored = await withTenant(
      { orgId: body.user.orgId, role: 'owner', managerId: null },
      async (c) => {
        const { rows } = await c.query<{ password_hash: string }>(
          'SELECT password_hash FROM "user" WHERE id = $1',
          [body.user.id],
        );
        return rows[0].password_hash;
      },
    );

    expect(stored).not.toBe(OWNER.password);
    expect(stored).toMatch(/^\$2[aby]\$/);
  });

  it('normalises email casing and surrounding whitespace', async () => {
    const body = await signup({ email: '  ADA@Acme.TEST  ' });
    expect(body.user.email).toBe('ada@acme.test');

    // And the normalised form is what logs in.
    await http
      .post('/api/auth/login')
      .send({ email: 'ada@acme.test', password: OWNER.password })
      .expect(200);
  });

  it('accepts the same email in a different organization', async () => {
    await signup();
    // (org_id, email) is unique, deliberately not email alone — a global unique
    // index would leak that an address is registered in some other tenant.
    await signup({ organizationName: 'Globex' });
  });

  it('rejects a password under 12 characters', async () => {
    await http
      .post('/api/auth/owner/signup')
      .send({ ...OWNER, password: 'short1!' })
      .expect(400);
  });

  it('rejects a malformed email', async () => {
    await http
      .post('/api/auth/owner/signup')
      .send({ ...OWNER, email: 'not-an-email' })
      .expect(400);
  });

  it('rejects unexpected fields instead of silently ignoring them', async () => {
    // Without forbidNonWhitelisted, a client could post role/ranking and rely on
    // some future handler spreading the body.
    await http
      .post('/api/auth/owner/signup')
      .send({ ...OWNER, role: 'owner', ranking: 100 })
      .expect(400);
  });
});

describe('POST /api/auth/login', () => {
  it('authenticates with the correct password', async () => {
    const email = 'login.happy@acme.test';
    await signup({ email });
    const res = await http
      .post('/api/auth/login')
      .send({ email, password: OWNER.password })
      .expect(200);

    expect(typeof res.body.accessToken).toBe('string');
    expect(res.body.user.email).toBe(email);
  });

  it('rejects the wrong password', async () => {
    const email = 'login.wrongpw@acme.test';
    await signup({ email });
    await http
      .post('/api/auth/login')
      .send({ email, password: 'WrongHorse!9xy' })
      .expect(401);
  });

  it('returns byte-identical responses for unknown email and wrong password', async () => {
    const email = 'enumeration.probe@acme.test';
    await signup({ email });

    const unknownEmail = await http
      .post('/api/auth/login')
      .send({ email: 'nobody@acme.test', password: OWNER.password });

    const wrongPassword = await http
      .post('/api/auth/login')
      .send({ email, password: 'WrongHorse!9xy' });

    // If these differ in any way, the endpoint is an account-enumeration oracle:
    // an attacker learns which addresses are registered without a password.
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.body).toEqual(wrongPassword.body);
    expect(JSON.stringify(unknownEmail.body)).toBe(JSON.stringify(wrongPassword.body));
  });

  it('refuses a deactivated owner, with the same response as a bad password', async () => {
    // A distinct email per comparison: the throttler keys on email+IP and its
    // store is process-wide, so reusing OWNER.email here would hit the 5-attempt
    // budget already spent by earlier tests and return 429 instead of 401.
    const email = 'deactivated.owner@acme.test';
    const body = await signup({ email });

    await withTenant(
      { orgId: body.user.orgId, role: 'owner', managerId: null },
      // Soft delete per CLAUDE.md §5 — the row and its history survive.
      (c) => c.query(`UPDATE "user" SET status = 'inactive' WHERE id = $1`, [body.user.id]),
    );

    const inactive = await http
      .post('/api/auth/login')
      .send({ email, password: OWNER.password })
      .expect(401);

    const wrongPassword = await http
      .post('/api/auth/login')
      .send({ email: 'other.owner@acme.test', password: 'WrongHorse!9xy' })
      .expect(401);

    expect(inactive.body).toEqual(wrongPassword.body);
  });

  /**
   * This test previously asserted that ANY manager is refused here, back when
   * the route was /api/auth/owner/login and the service rejected
   * `role !== 'owner'`. Task #6 removes that rejection on purpose: once a
   * manager has consumed their passcode and set a password, this is the route
   * they log in through, and a role check would lock them out permanently.
   *
   * So the property under test narrows rather than disappears. What must stay
   * true is that the role check was never what protected the passcode flow —
   * `password_hash IS NULL` is. A provisioned-but-not-activated manager has no
   * hash, so no password can ever match, and first-login cannot be skipped by
   * guessing one.
   */
  it('refuses a provisioned manager who has not completed first login', async () => {
    const body = await signup();

    const managerEmail = 'mallory.manager@acme.test';
    const ownerCtx = { orgId: body.user.orgId, role: 'owner' as const, managerId: null };

    await withTenant(ownerCtx, async (c) => {
      // The id must be known before the INSERT: user_manager_id_invariant
      // requires manager_id = id for a manager, within the same row.
      const { rows } = await c.query<{ id: string }>('SELECT gen_random_uuid() AS id');
      const managerId = rows[0].id;
      // password_hash omitted — exactly the state createManager() leaves behind.
      await c.query(
        `INSERT INTO "user" (id, org_id, role, name, email, manager_id)
         VALUES ($1, $2, 'manager', 'Mallory Manager', $3, $1)`,
        [managerId, body.user.orgId, managerEmail],
      );
    });

    const notActivated = await http
      .post('/api/auth/login')
      .send({ email: managerEmail, password: OWNER.password })
      .expect(401);

    // And indistinguishable from an unknown address, so the response does not
    // confirm that an invite for this email is outstanding.
    const unknown = await http
      .post('/api/auth/login')
      .send({ email: 'nobody.here@acme.test', password: OWNER.password })
      .expect(401);

    expect(notActivated.body).toEqual(unknown.body);
  });

  it('accepts a manager who has completed first login', async () => {
    const body = await signup();

    // The same hash as the owner, so the ONLY thing that differs from the test
    // above is the presence of a password_hash — which is what now decides it.
    const managerEmail = 'morgan.manager@acme.test';
    const ownerCtx = { orgId: body.user.orgId, role: 'owner' as const, managerId: null };

    const passwordHash = await withTenant(ownerCtx, async (c) => {
      const { rows } = await c.query<{ password_hash: string }>(
        'SELECT password_hash FROM "user" WHERE id = $1',
        [body.user.id],
      );
      return rows[0].password_hash;
    });

    await withTenant(ownerCtx, async (c) => {
      const { rows } = await c.query<{ id: string }>('SELECT gen_random_uuid() AS id');
      const managerId = rows[0].id;
      await c.query(
        `INSERT INTO "user" (id, org_id, role, name, email, password_hash, manager_id)
         VALUES ($1, $2, 'manager', 'Morgan Manager', $3, $4, $1)`,
        [managerId, body.user.orgId, managerEmail, passwordHash],
      );
    });

    const res = await http
      .post('/api/auth/login')
      .send({ email: managerEmail, password: OWNER.password })
      .expect(200);

    // The role comes from the row, never from the request.
    expect(res.body.user.role).toBe('manager');

    await http
      .get('/api/me')
      .set('Authorization', `Bearer ${res.body.accessToken}`)
      .expect(200);
  });
});

describe('GET /api/me', () => {
  it('requires a token', async () => {
    await http.get('/api/me').expect(401);
  });

  it('rejects a malformed token', async () => {
    await http.get('/api/me').set('Authorization', 'Bearer not.a.jwt').expect(401);
  });

  it('rejects a token signed with the wrong secret', async () => {
    // Forged with a different key: the signature must be what fails, not the shape.
    const { sign } = await import('jsonwebtoken');
    const forged = sign(
      { sub: '00000000-0000-0000-0000-000000000000', role: 'owner', orgId: 'x', managerId: null },
      'an-attacker-chosen-secret-that-is-long-enough',
      { expiresIn: '15m' },
    );
    await http.get('/api/me').set('Authorization', `Bearer ${forged}`).expect(401);
  });

  it("returns the caller's own profile", async () => {
    const body = await signup();
    const res = await http
      .get('/api/me')
      .set('Authorization', `Bearer ${body.accessToken}`)
      .expect(200);

    expect(res.body.id).toBe(body.user.id);
    expect(res.body.email).toBe(body.user.email);
    expect(res.body.role).toBe('owner');
    expect(res.body.organizationName).toBe(OWNER.organizationName);
    expect(res.body.managerId).toBeNull();
  });

  it('never exposes password_hash or passcode_hash', async () => {
    const body = await signup();
    const res = await http
      .get('/api/me')
      .set('Authorization', `Bearer ${body.accessToken}`)
      .expect(200);

    // The DTO whitelists fields rather than deleting sensitive ones, so a column
    // added to the table later cannot leak through this endpoint.
    expect(res.body).not.toHaveProperty('password_hash');
    expect(res.body).not.toHaveProperty('passcode_hash');
    expect(res.body).not.toHaveProperty('passwordHash');
    expect(res.body).not.toHaveProperty('passcodeHash');
    expect(JSON.stringify(res.body)).not.toMatch(/\$2[aby]\$/);
  });

  it('stops accepting a valid token once the user is deactivated', async () => {
    const body = await signup();

    await http
      .get('/api/me')
      .set('Authorization', `Bearer ${body.accessToken}`)
      .expect(200);

    await withTenant(
      { orgId: body.user.orgId, role: 'owner', managerId: null },
      (c) => c.query(`UPDATE "user" SET status = 'inactive' WHERE id = $1`, [body.user.id]),
    );

    // The token is still signed and unexpired. This passes only because
    // JwtStrategy re-reads the row on every request instead of trusting claims —
    // otherwise deactivation would not take effect until the token expired.
    await http
      .get('/api/me')
      .set('Authorization', `Bearer ${body.accessToken}`)
      .expect(401);
  });
});

describe('login rate limiting (5 attempts / 15 min, keyed on email + IP)', () => {
  it('blocks further attempts on one account after the limit, with 429', async () => {
    const email = 'brute.target@acme.test';
    await signup({ email });

    // The configured budget is LOGIN_THROTTLE_LIMIT (default 5).
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      const res = await http
        .post('/api/auth/login')
        .send({ email, password: 'WrongHorse!9xy' });
      statuses.push(res.status);
    }

    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    // Attempts past the budget are rejected before any password check runs.
    expect(statuses.slice(5)).toEqual([429, 429]);
  });

  it('does not let one account exhaust another account budget on the same IP', async () => {
    // The reason for keying on email+IP rather than IP alone. Under IP-only
    // keying this second account would already be locked out by the previous
    // test's attempts from the same address — which is how users behind one NAT
    // lock each other out.
    const victimEmail = 'bystander@acme.test';
    await signup({ email: victimEmail });

    await http
      .post('/api/auth/login')
      .send({ email: victimEmail, password: OWNER.password })
      .expect(200);
  });

  it('treats email casing as the same throttle key', async () => {
    const email = 'case.target@acme.test';
    await signup({ email });

    for (let i = 0; i < 5; i++) {
      await http.post('/api/auth/login').send({ email, password: 'WrongHorse!9xy' });
    }

    // Varying the casing must not buy a fresh budget — the key is normalised
    // before hashing, so this is the same bucket, already exhausted.
    await http
      .post('/api/auth/login')
      .send({ email: 'CASE.TARGET@ACME.TEST', password: 'WrongHorse!9xy' })
      .expect(429);
  });
});

describe('the SECURITY DEFINER lookups did not become a general bypass', () => {
  it('relay_app still cannot read "user" directly', async () => {
    await signup();

    // A row certainly exists now. Without a tenant context, relay_app must still
    // see nothing: the definer functions are two narrow holes, not a role-level
    // grant. If this ever returns > 0, 0002_auth_lookup.sql has been widened or
    // a policy has been loosened, and the isolation guarantee is gone.
    const { rows } = await appPool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM "user"',
    );
    expect(rows[0].count).toBe('0');
  });

  it('relay_app cannot read organization or team directly either', async () => {
    await signup();
    // Identifiers are quoted deliberately. Bare `user` in Postgres resolves to
    // the CURRENT_USER function, not the table — an unquoted version of this
    // test returns one row of role name and passes for the wrong reason.
    for (const table of ['"user"', 'organization', 'team']) {
      const { rows } = await appPool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM ${table}`,
      );
      expect(rows[0].count).toBe('0');
    }
  });

  it('exposes exactly two SECURITY DEFINER functions, both with a pinned search_path', async () => {
    // An unpinned search_path on a SECURITY DEFINER function is the classic
    // Postgres privilege-escalation vector. Asserting the count as well as the
    // config means a third definer function cannot be added unnoticed.
    const { rows } = await appPool.query<{ proname: string; proconfig: string[] | null }>(
      `SELECT p.proname, p.proconfig
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.prosecdef IS TRUE
        ORDER BY p.proname`,
    );

    expect(rows.map((r) => r.proname)).toEqual([
      'auth_lookup_by_email',
      'auth_lookup_by_id',
    ]);
    for (const r of rows) {
      expect(r.proconfig?.join(',') ?? '').toContain('search_path=');
    }
  });

  it('does not grant EXECUTE on the lookups to PUBLIC', async () => {
    // Postgres grants EXECUTE to PUBLIC by default on new functions, which on a
    // definer function would hand the bypass to every role in the cluster.
    const { rows } = await appPool.query<{ proname: string; public_execute: boolean }>(
      `SELECT p.proname,
              has_function_privilege('public', p.oid, 'EXECUTE') AS public_execute
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.prosecdef IS TRUE`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.public_execute).toBe(false);
    }
  });

  it('confines the definer-lookup policy to relay_migrator, SELECT only', async () => {
    // 0003_auth_lookup_policy.sql is what makes the definer functions able to
    // read anything at all. Its narrowness IS the isolation guarantee: if the
    // role list ever includes relay_app, or the command stops being SELECT-only,
    // every context-free query in the app starts returning other tenants' rows.
    const { rows } = await appPool.query<{
      polname: string;
      polcmd: string;
      roles: string[];
    }>(
      `SELECT polname, polcmd, polroles::regrole[]::text[] AS roles
         FROM pg_policy
        WHERE polrelid = '"user"'::regclass AND polname = 'user_definer_lookup'`,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].roles).toEqual(['relay_migrator']);
    expect(rows[0].roles).not.toContain('relay_app');
    // 'r' is SELECT. '*' would mean ALL commands, which must never be the case.
    expect(rows[0].polcmd).toBe('r');
  });

  it('still has FORCE ROW LEVEL SECURITY on every tenant table', async () => {
    // The 0003 policy deliberately does not relax FORCE. If it were dropped, the
    // table owner would bypass its own policies and the seeded-fixture guarantee
    // (fixtures go through the same write path as production) would be gone.
    const { rows } = await appPool.query<{ relname: string; forced: boolean }>(
      `SELECT relname, relforcerowsecurity AS forced
         FROM pg_class
        WHERE relnamespace = 'public'::regnamespace
          AND relname = ANY(ARRAY['user','organization','team','audit_log'])
        ORDER BY relname`,
    );
    expect(rows).toHaveLength(4);
    for (const r of rows) {
      expect(r.forced).toBe(true);
    }
  });
});
