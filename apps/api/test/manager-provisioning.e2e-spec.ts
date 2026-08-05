/**
 * Manager provisioning and first-login over real HTTP.
 *
 * Task #6's authentication surface. Five sabotage checks pin the security
 * properties that could regress silently (checked before commit).
 */
import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { hash } from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { closePools, truncateAll, withTenant } from './helpers/db';
import { seedFixture, type Fixture } from './helpers/seed';
import { bearer } from './helpers/token';

jest.setTimeout(30_000);

let app: INestApplication;
let http: ReturnType<typeof request>;
let fx: Fixture;

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

describe('POST /api/auth/managers', () => {
  it('allows owner1 to provision (201)', async () => {
    const res = await http
      .post('/api/auth/managers')
      .set('Authorization', bearer(fx.owner1))
      .send({ name: 'New Manager', email: 'new.mgr@acme.test' })
      .expect(201);

    expect(res.body).toMatchObject({
      role: 'manager',
      status: 'active',
      email: 'new.mgr@acme.test',
    });
    expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.passcodeExpiresAt).toBeTruthy();
  });

  // SABOTAGE CHECK #4: remove @Roles('owner') → these must fail
  it('refuses managerA (403)', async () => {
    await http
      .post('/api/auth/managers')
      .set('Authorization', bearer(fx.managerA))
      .send({ name: 'Another', email: 'another@acme.test' })
      .expect(403);
  });

  it('refuses memberA1 (403)', async () => {
    await http
      .post('/api/auth/managers')
      .set('Authorization', bearer(fx.memberA1))
      .send({ name: 'Another', email: 'another@acme.test' })
      .expect(403);
  });

  it('refuses unauthenticated (401, not 403 — guard order)', async () => {
    await http
      .post('/api/auth/managers')
      .send({ name: 'Another', email: 'another@acme.test' })
      .expect(401);
  });

  it('rejects duplicate email in same org (409)', async () => {
    const email = 'dup@acme.test';
    await http
      .post('/api/auth/managers')
      .set('Authorization', bearer(fx.owner1))
      .send({ name: 'First', email })
      .expect(201);

    await http
      .post('/api/auth/managers')
      .set('Authorization', bearer(fx.owner1))
      .send({ name: 'Second', email })
      .expect(409);
  });

  it('allows same email in different org (201)', async () => {
    const email = 'cross@example.test';
    const res1 = await http
      .post('/api/auth/managers')
      .set('Authorization', bearer(fx.owner1))
      .send({ name: 'Mgr Org1', email })
      .expect(201);

    const res2 = await http
      .post('/api/auth/managers')
      .set('Authorization', bearer(fx.owner2))
      .send({ name: 'Mgr Org2', email })
      .expect(201);

    expect(res1.body.id).not.toBe(res2.body.id);
  });
});

/**
 * Provision a manager while capturing the console mailer's output.
 *
 * The plaintext passcode exists in exactly one place — the invite email — so
 * reading the log is the only way a test can learn it. That is what makes the
 * "never in the response body" and "never in the URL" assertions real: they
 * compare against the actual secret, not against the string "passcode".
 */
async function provisionCapturingMail(
  actor: Parameters<typeof bearer>[0],
  body: { name: string; email: string },
): Promise<{ res: request.Response; mail: string; passcode: string }> {
  const captured: string[] = [];
  const spy = jest
    .spyOn(Logger.prototype, 'log')
    .mockImplementation((message: unknown) => {
      captured.push(String(message));
    });

  try {
    const res = await http
      .post('/api/auth/managers')
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

describe('provisioned row and audit', () => {
  it('has role=manager, manager_id=id, password_hash IS NULL, passcode_hash present', async () => {
    const res = await http
      .post('/api/auth/managers')
      .set('Authorization', bearer(fx.owner1))
      .send({ name: 'Check Row', email: 'check.row@acme.test' })
      .expect(201);

    const row = await withTenant(
      { orgId: fx.org1Id, role: 'owner', managerId: null },
      async (c) => {
        const { rows } = await c.query<{
          role: string;
          manager_id: string;
          password_hash: string | null;
          passcode_hash: string | null;
        }>(
          'SELECT role, manager_id, password_hash, passcode_hash FROM "user" WHERE id = $1',
          [res.body.id],
        );
        return rows[0];
      },
    );

    expect(row.role).toBe('manager');
    expect(row.manager_id).toBe(res.body.id);
    expect(row.password_hash).toBeNull();
    // SABOTAGE CHECK #3: SHA-256 instead of bcrypt → this must fail
    expect(row.passcode_hash).toMatch(/^\$2[aby]\$/);
  });

  // SABOTAGE CHECK #2: return the passcode in the 201 body → this must fail.
  // Compares against the REAL passcode read from the mailer, so it cannot be
  // satisfied by merely renaming the field.
  it('never returns the plaintext passcode in the response body', async () => {
    const { res, passcode } = await provisionCapturingMail(fx.owner1, {
      name: 'Check Response',
      email: 'check.resp@acme.test',
    });

    expect(JSON.stringify(res.body)).not.toContain(passcode);
    expect(res.body).not.toHaveProperty('passcode');
  });

  // SABOTAGE CHECK #5: put the passcode in the invite URL → this must fail.
  it('emails the passcode as text but never in the invite URL', async () => {
    const { mail, passcode } = await provisionCapturingMail(fx.owner1, {
      name: 'Check Mail',
      email: 'check.mail@acme.test',
    });

    // The body carries it (that is the delivery mechanism)...
    expect(mail).toContain(passcode);

    // ...but the URL must not. URLs leak via Referer, history, and proxy logs.
    const url = mail.match(/https?:\/\/\S+/)?.[0] ?? '';
    expect(url).toBeTruthy();
    expect(url).toContain('/invite?email=');
    expect(url).not.toContain(passcode);
  });

  it('records manager.provisioned with no passcode/hash in metadata', async () => {
    const res = await http
      .post('/api/auth/managers')
      .set('Authorization', bearer(fx.owner1))
      .send({ name: 'Audit Check', email: 'audit.check@acme.test' })
      .expect(201);

    const auditRow = await withTenant(
      { orgId: fx.org1Id, role: 'owner', managerId: null },
      async (c) => {
        const { rows } = await c.query<{ action: string; metadata: any }>(
          'SELECT action, metadata FROM audit_log WHERE target_id = $1',
          [res.body.id],
        );
        return rows[0];
      },
    );

    expect(auditRow.action).toBe('manager.provisioned');
    const meta = JSON.stringify(auditRow.metadata);
    expect(meta).not.toMatch(/passcode/i);
    expect(meta).not.toMatch(/\$2[aby]\$/);
  });
});

describe('POST /api/auth/manager/first-login', () => {
  let managerId: string;
  let managerEmail: string;
  const PASSCODE = 'K7M2XQ9P4B'; // matches PASSCODE_ALPHABET
  const NEW_PASSWORD = 'NewSecurePassword123!';

  beforeEach(async () => {
    managerEmail = `seeded.${Date.now()}@acme.test`;
    const passcodeHash = await hash(PASSCODE, 10);
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);

    managerId = await withTenant(
      { orgId: fx.org1Id, role: 'owner', managerId: null },
      async (c) => {
        const { rows } = await c.query<{ id: string }>('SELECT gen_random_uuid() AS id');
        const id = rows[0].id;
        await c.query(
          `INSERT INTO "user" (id, org_id, role, name, email, manager_id, passcode_hash, passcode_expires_at)
           VALUES ($1, $2, 'manager', 'Seeded Manager', $3, $1, $4, $5)`,
          [id, fx.org1Id, managerEmail, passcodeHash, expiresAt],
        );
        return id;
      },
    );
  });

  it('consumes passcode, sets password, returns working token (200)', async () => {
    const res = await http
      .post('/api/auth/manager/first-login')
      .send({ email: managerEmail, passcode: PASSCODE, newPassword: NEW_PASSWORD })
      .expect(200);

    expect(res.body.user.role).toBe('manager');
    expect(res.body.user.email).toBe(managerEmail);
    expect(res.body.accessToken).toBeTruthy();

    await http
      .get('/api/me')
      .set('Authorization', `Bearer ${res.body.accessToken}`)
      .expect(200);
  });

  // SABOTAGE CHECK #1: drop passcode_used_at IS NULL from WHERE → this must fail
  it('refuses replay (401, single-use)', async () => {
    await http
      .post('/api/auth/manager/first-login')
      .send({ email: managerEmail, passcode: PASSCODE, newPassword: NEW_PASSWORD })
      .expect(200);

    const replay = await http
      .post('/api/auth/manager/first-login')
      .send({ email: managerEmail, passcode: PASSCODE, newPassword: 'AnotherPassword123!' })
      .expect(401);

    const wrong = await http
      .post('/api/auth/manager/first-login')
      .send({ email: managerEmail, passcode: 'WRNGXYZ99', newPassword: NEW_PASSWORD })
      .expect(401);

    expect(replay.body).toEqual(wrong.body);
  });

  /**
   * SABOTAGE CHECK #1 (the real one): drop `passcode_used_at IS NULL` from the
   * UPDATE's WHERE clause and this must fail.
   *
   * The sequential replay test above does NOT catch that — the JS guard
   * `row.passcode_used_at !== null` rejects the second request before the query
   * runs, so removing the SQL condition leaves it green. Sabotaging the WHERE
   * clause and watching every test still pass is how that was found.
   *
   * Concurrency is what the WHERE clause is actually for: two requests carrying
   * the same valid passcode both read `passcode_used_at IS NULL`, both pass every
   * JS check, and race to the UPDATE. Only one may win.
   */
  it('lets only one of two concurrent identical requests win (the race)', async () => {
    const [a, b] = await Promise.all([
      http
        .post('/api/auth/manager/first-login')
        .send({ email: managerEmail, passcode: PASSCODE, newPassword: NEW_PASSWORD }),
      http
        .post('/api/auth/manager/first-login')
        .send({ email: managerEmail, passcode: PASSCODE, newPassword: 'RacingPassword123!' }),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 401]);

    // And exactly one password took effect — the winner's, whichever that was.
    const winner = a.status === 200 ? NEW_PASSWORD : 'RacingPassword123!';
    const loser = a.status === 200 ? 'RacingPassword123!' : NEW_PASSWORD;

    await http
      .post('/api/auth/login')
      .send({ email: managerEmail, password: winner })
      .expect(200);
    await http
      .post('/api/auth/login')
      .send({ email: managerEmail, password: loser })
      .expect(401);
  });

  it('refuses wrong passcode (401)', async () => {
    await http
      .post('/api/auth/manager/first-login')
      .send({ email: managerEmail, passcode: 'WRNGXYZ99', newPassword: NEW_PASSWORD })
      .expect(401);
  });

  it('refuses unknown email (401, indistinguishable)', async () => {
    const unknown = await http
      .post('/api/auth/manager/first-login')
      .send({ email: 'nobody@acme.test', passcode: PASSCODE, newPassword: NEW_PASSWORD })
      .expect(401);

    const wrong = await http
      .post('/api/auth/manager/first-login')
      .send({ email: managerEmail, passcode: 'WRNGXYZ99', newPassword: NEW_PASSWORD })
      .expect(401);

    expect(unknown.body).toEqual(wrong.body);
  });

  it('refuses expired passcode (401)', async () => {
    await withTenant(
      { orgId: fx.org1Id, role: 'owner', managerId: null },
      (c) =>
        c.query(
          'UPDATE "user" SET passcode_expires_at = now() - interval \'1 hour\' WHERE id = $1',
          [managerId],
        ),
    );

    await http
      .post('/api/auth/manager/first-login')
      .send({ email: managerEmail, passcode: PASSCODE, newPassword: NEW_PASSWORD })
      .expect(401);
  });

  it('refuses if already activated (has password_hash)', async () => {
    const existingHash = await hash('AlreadySet123!', 10);
    await withTenant(
      { orgId: fx.org1Id, role: 'owner', managerId: null },
      (c) => c.query('UPDATE "user" SET password_hash = $2 WHERE id = $1', [managerId, existingHash]),
    );

    await http
      .post('/api/auth/manager/first-login')
      .send({ email: managerEmail, passcode: PASSCODE, newPassword: NEW_PASSWORD })
      .expect(401);
  });

  it('records manager.first_login in audit_log', async () => {
    await http
      .post('/api/auth/manager/first-login')
      .send({ email: managerEmail, passcode: PASSCODE, newPassword: NEW_PASSWORD })
      .expect(200);

    const auditRow = await withTenant(
      { orgId: fx.org1Id, role: 'owner', managerId: null },
      async (c) => {
        const { rows } = await c.query<{ action: string }>(
          'SELECT action FROM audit_log WHERE target_id = $1 AND action = $2',
          [managerId, 'manager.first_login'],
        );
        return rows[0];
      },
    );

    expect(auditRow.action).toBe('manager.first_login');
  });

  it('allows login through common password route after activation', async () => {
    await http
      .post('/api/auth/manager/first-login')
      .send({ email: managerEmail, passcode: PASSCODE, newPassword: NEW_PASSWORD })
      .expect(200);

    const loginRes = await http
      .post('/api/auth/login')
      .send({ email: managerEmail, password: NEW_PASSWORD })
      .expect(200);

    expect(loginRes.body.user.role).toBe('manager');
  });

  it('validates newPassword minimum length (400 before credential check)', async () => {
    await http
      .post('/api/auth/manager/first-login')
      .send({ email: managerEmail, passcode: PASSCODE, newPassword: 'short' })
      .expect(400);
  });
});

/**
 * The full round trip with no hand-seeded fixture: provision through the real
 * route, take the passcode from the real invite email, and activate with it.
 *
 * The seeded tests above pin individual rejection branches; this one proves the
 * generated passcode and the verification path actually agree — a mismatch in
 * alphabet, length, or hashing would pass every test above and fail here.
 */
describe('provision → email → first-login round trip', () => {
  it('activates using the passcode from the invite email', async () => {
    const email = 'roundtrip@acme.test';
    const { passcode } = await provisionCapturingMail(fx.owner1, {
      name: 'Round Trip',
      email,
    });

    const res = await http
      .post('/api/auth/manager/first-login')
      .send({ email, passcode, newPassword: 'RoundTripPassword123!' })
      .expect(200);

    expect(res.body.user.role).toBe('manager');

    // And the token is scoped to org1 — a manager sees only their own slice.
    const me = await http
      .get('/api/me')
      .set('Authorization', `Bearer ${res.body.accessToken}`)
      .expect(200);
    expect(me.body.orgId).toBe(fx.org1Id);
    expect(me.body.role).toBe('manager');
  });
});
