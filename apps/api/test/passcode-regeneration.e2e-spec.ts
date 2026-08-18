/**
 * Passcode regeneration over real HTTP (task #8) — CLAUDE.md §1, passcodes are
 * "regenerable by the issuer".
 *
 * The route re-issues the single-use passcode for a not-yet-activated invite and
 * re-sends the email. It is role-neutral (Owner or Manager, targeting a pending
 * Manager or Member) and defends two properties that could regress silently:
 *
 *   ISOLATION — a caller can only re-issue for a target inside their own tenant
 *   slice. Enforced in two server-side layers: @OwnedResource 404s a cross-tenant
 *   id before the handler runs, and the UPDATE is RLS-scoped on top of that. A
 *   cross-manager, cross-org, wrong-role, or nonexistent target all collapse to
 *   one identical 404 — the caller cannot probe another account's existence.
 *
 *   NO ACCOUNT TAKEOVER — the UPDATE's WHERE clause (`password_hash IS NULL AND
 *   passcode_used_at IS NULL AND role IN ('manager','member') AND status =
 *   'active'`), NOT the guard, is what confines this to a live invite. Without
 *   it, regenerating a passcode for an already-activated user and then running
 *   first-login would reset their password.
 *
 * Three sabotage checks (each: apply the break, confirm the named test goes red,
 * revert):
 *
 *   #A  the WHERE predicates that confine re-issue to a live invite. NOTE: over the
 *       reachable manager/member state space `password_hash IS NULL` and
 *       `passcode_used_at IS NULL` are EQUIVALENT — first-login stamps both in one
 *       atomic UPDATE — so dropping just one leaves the other blocking and the test
 *       stays green (404). Dropping BOTH is the effective sabotage: "refuses an
 *       already-activated manager/member (404)" then goes red (200 + an invite mail
 *       is sent). They are kept as belt-and-braces; and first-login itself re-checks
 *       `password_hash IS NULL`, a second independent takeover barrier, so even a
 *       wrongly re-issued passcode cannot reset an activated account. (Verified
 *       2026-08-17; see PROGRESS.md task #8 findings.)
 *   #B  @Roles('owner','manager') on the route. Remove it and a Member can
 *       re-issue: "a Member is refused before the guard runs (403)" goes red (404
 *       or 200 instead of 403 — the RolesGuard-before-ResourceOwnerGuard order is
 *       what makes it 403, not 404).
 *   #C  @OwnedResource({ table: 'user' }) on the route. Its cross-tenant role is
 *       REDUNDANT with RLS here: regeneratePasscode runs under db.tx() (tenant-
 *       scoped), so a cross-org or cross-team target is filtered to zero rows and
 *       404s whether or not the guard is present — removing it leaves every
 *       isolation test below green. What removing it DOES break is "a malformed id
 *       is a 404": the guard's UUID check is what stops a non-UUID id reaching the
 *       UPDATE, so without it that case is a 500, not a 404. So on this route the
 *       guard's observable job is the pre-DB UUID/existence 404 (plus defence-in-
 *       depth if RLS were ever misconfigured), NOT the tenant boundary — RLS owns
 *       that. (Verified 2026-08-17; see PROGRESS.md task #8 findings.)
 */
import { randomUUID } from 'node:crypto';
import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { closePools, truncateAll } from './helpers/db';
import { seedFixture, TEST_PASSWORD, type Fixture, type SeededUser } from './helpers/seed';
import { bearer } from './helpers/token';

jest.setTimeout(30_000);

let app: INestApplication;
let http: ReturnType<typeof request>;
let fx: Fixture;

let seq = 0;
const freshEmail = (label: string) => `${label}.${Date.now()}.${seq++}@acme.test`;

/** A permanent password an activated account sets at first-login. ≥12 chars. */
const ACTIVATION_PW = 'FreshActivate!9';

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
 * Run `fn` while capturing the console mailer's output and extract the passcode.
 * The plaintext passcode exists in exactly one place — the invite email — so
 * reading the log is the only way a test learns it, which is what makes the
 * "never in the body" assertion compare against the real secret. Mirrors the
 * provisioning specs.
 */
async function captureMail<T>(fn: () => Promise<T>): Promise<{ result: T; passcode: string }> {
  const captured: string[] = [];
  const spy = jest
    .spyOn(Logger.prototype, 'log')
    .mockImplementation((message: unknown) => {
      captured.push(String(message));
    });
  try {
    const result = await fn();
    const mail = captured.find((m) => m.includes('MAIL (console driver)')) ?? '';
    const match = mail.match(/Your passcode: (\S+)/);
    if (!match) {
      throw new Error(`No passcode found in captured mail. Captured:\n${captured.join('\n')}`);
    }
    return { result, passcode: match[1] };
  } finally {
    spy.mockRestore();
  }
}

/** Run `fn` and assert NO invite email was sent — the proof that a refused
 *  regeneration never hands an attacker a fresh passcode. */
async function expectNoMail<T>(fn: () => Promise<T>): Promise<T> {
  const captured: string[] = [];
  const spy = jest
    .spyOn(Logger.prototype, 'log')
    .mockImplementation((message: unknown) => {
      captured.push(String(message));
    });
  try {
    const result = await fn();
    expect(captured.some((m) => m.includes('MAIL (console driver)'))).toBe(false);
    return result;
  } finally {
    spy.mockRestore();
  }
}

/** Provision a pending Manager through the Owner route; return its id + passcode. */
async function provisionManager(
  owner: SeededUser,
  email: string = freshEmail('pmgr'),
): Promise<{ id: string; email: string; passcode: string }> {
  const { result, passcode } = await captureMail(() =>
    http
      .post('/api/auth/managers')
      .set('Authorization', bearer(owner))
      .send({ name: 'Pending Manager', email })
      .expect(201),
  );
  return { id: (result.body as { id: string }).id, email, passcode };
}

/** Provision a pending Member; a Manager caller omits managerId (their own
 *  team), an Owner names the manager whose team the member joins. */
async function provisionMember(
  actor: SeededUser,
  opts: { email?: string; managerId?: string } = {},
): Promise<{ id: string; email: string; passcode: string }> {
  const email = opts.email ?? freshEmail('pmem');
  const body: { name: string; email: string; managerId?: string } = {
    name: 'Pending Member',
    email,
  };
  if (opts.managerId) body.managerId = opts.managerId;
  const { result, passcode } = await captureMail(() =>
    http
      .post('/api/auth/members')
      .set('Authorization', bearer(actor))
      .send(body)
      .expect(201),
  );
  return { id: (result.body as { id: string }).id, email, passcode };
}

const regenerate = (actor: SeededUser, id: string) =>
  http.post(`/api/auth/users/${id}/passcode`).set('Authorization', bearer(actor));

const firstLogin = (email: string, passcode: string, newPassword: string) =>
  http.post('/api/auth/first-login').send({ email, passcode, newPassword });

const login = (email: string, password: string) =>
  http.post('/api/auth/login').send({ email, password });

// --- happy path -------------------------------------------------------------

describe('POST /api/auth/users/:id/passcode — re-issue', () => {
  it('Owner regenerates a pending Manager: old passcode dies, new one activates (200)', async () => {
    const mgr = await provisionManager(fx.owner1);

    const { result: res, passcode: fresh } = await captureMail(() =>
      regenerate(fx.owner1, mgr.id).expect(200),
    );

    expect(res.body).toMatchObject({
      id: mgr.id,
      email: mgr.email,
      role: 'manager',
      inviteEmailSent: true,
    });
    expect(new Date(res.body.passcodeExpiresAt).getTime()).toBeGreaterThan(Date.now());
    // The passcode is emailed, never returned — assert against the real secret.
    expect(JSON.stringify(res.body)).not.toContain(fresh);
    expect(fresh).not.toBe(mgr.passcode);

    // The original passcode is now dead; the freshly-issued one activates.
    await firstLogin(mgr.email, mgr.passcode, ACTIVATION_PW).expect(401);
    await firstLogin(mgr.email, fresh, ACTIVATION_PW).expect(200);
  });

  it('Manager regenerates their OWN pending Member (200)', async () => {
    // managerA (fixture, has a password + teamA) provisions a member on their team.
    const mem = await provisionMember(fx.managerA);

    const { passcode: fresh } = await captureMail(() =>
      regenerate(fx.managerA, mem.id).expect(200),
    );

    await firstLogin(mem.email, mem.passcode, ACTIVATION_PW).expect(401);
    await firstLogin(mem.email, fresh, ACTIVATION_PW).expect(200);
  });

  it('Owner in org2 can re-issue a pending Manager in org2 (positive control)', async () => {
    const mgr2 = await provisionManager(fx.owner2);
    await regenerate(fx.owner2, mgr2.id).expect(200);
  });
});

// --- isolation --------------------------------------------------------------

describe('isolation — cross-tenant targets collapse to 404', () => {
  it('a Manager cannot re-issue another manager\'s pending member (same org)', async () => {
    // owner1 provisions a pending member under managerB's team.
    const memB = await provisionMember(fx.owner1, { managerId: fx.managerB.id });
    // managerA reaching managerB's member: RLS scopes A to A's own team, so the
    // row is invisible → 404, and no mail. RLS is the enforcement here; the
    // @OwnedResource guard is redundant for the cross-tenant case (see header #C).
    await expectNoMail(() => regenerate(fx.managerA, memB.id).expect(404));
  });

  it('a Manager cannot re-issue a pending member in another org', async () => {
    const memC = await provisionMember(fx.owner2, { managerId: fx.managerC.id });
    await regenerate(fx.managerA, memC.id).expect(404);
  });

  it('a Manager cannot re-issue a peer manager', async () => {
    // managerB is active-with-password, but it is also outside managerA's slice —
    // 404 either way, and the caller cannot tell which reason applied.
    await regenerate(fx.managerA, fx.managerB.id).expect(404);
  });

  it('an Owner cannot re-issue across organizations (404)', async () => {
    const mgr2 = await provisionManager(fx.owner2);
    // owner1's slice is org1. Both layers refuse the org2 target, but RLS is what
    // determines the 404: regeneratePasscode's db.tx() UPDATE runs in owner1's org
    // context, so the org2 row is filtered out → zero rows → 404, with or without
    // @OwnedResource (verified — see header #C). No mail.
    await expectNoMail(() => regenerate(fx.owner1, mgr2.id).expect(404));
  });
});

// --- account-takeover prevention -------------------------------------------

describe('account-takeover prevention — an activated account is not re-issuable', () => {
  it('refuses an already-activated manager (404) and leaves the password intact [sabotage #A]', async () => {
    const mgr = await provisionManager(fx.owner1);
    // Activate: consume the passcode, set a permanent password.
    await firstLogin(mgr.email, mgr.passcode, ACTIVATION_PW).expect(200);

    // The takeover attempt: re-issue on an active account. Refused, no mail sent.
    // The refusal comes from the WHERE predicates as a pair (`password_hash IS
    // NULL AND passcode_used_at IS NULL`); over the reachable state space either
    // alone suffices, so both must be dropped to turn this red — see header #A.
    await expectNoMail(() => regenerate(fx.owner1, mgr.id).expect(404));

    // The chosen password is untouched — the account was never reset.
    await login(mgr.email, ACTIVATION_PW).expect(200);
  });

  it('refuses an already-activated member (404) and leaves the password intact', async () => {
    const mem = await provisionMember(fx.managerA);
    await firstLogin(mem.email, mem.passcode, ACTIVATION_PW).expect(200);

    await expectNoMail(() => regenerate(fx.owner1, mem.id).expect(404));

    await login(mem.email, ACTIVATION_PW).expect(200);
  });

  it('refuses an Owner target (no passcode flow for owners)', async () => {
    // Owners have no passcode flow; the role allow-list excludes them.
    await regenerate(fx.owner1, fx.owner1.id).expect(404);
  });

  it('refuses an active fixture manager (has a password already)', async () => {
    // managerA is in owner1's slice, so this is not an isolation 404 — it is the
    // WHERE clause refusing an activated account.
    await expectNoMail(() => regenerate(fx.owner1, fx.managerA.id).expect(404));
  });
});

// --- role gating & malformed ------------------------------------------------

describe('role gating & malformed input', () => {
  it('a Member is refused before the guard runs (403, not 404) [sabotage #B]', async () => {
    const mem = await provisionMember(fx.managerA);
    // memberA1 (fixture member) is blocked by RolesGuard, which runs BEFORE
    // ResourceOwnerGuard — so even a legitimate in-slice target is a 403, not a
    // 404. If this were 404, the guard order (and thus the reasoning) would be wrong.
    await regenerate(fx.memberA1, mem.id).expect(403);
  });

  it('rejects an unauthenticated caller (401)', async () => {
    const mem = await provisionMember(fx.managerA);
    await http.post(`/api/auth/users/${mem.id}/passcode`).expect(401);
  });

  it('a malformed id is a 404 (UUID checked before any DB read) [sabotage #C]', async () => {
    // This is the assertion @OwnedResource actually protects on this route: its
    // UUID check rejects a non-UUID id with a 404 before the handler runs. Remove
    // the guard and 'not-a-uuid' reaches the UPDATE, where Postgres raises invalid
    // uuid syntax → 500 (verified). The guard's cross-tenant role, by contrast, is
    // redundant with RLS (see header #C).
    await regenerate(fx.owner1, 'not-a-uuid').expect(404);
  });

  it('a well-formed but nonexistent id is a 404', async () => {
    await regenerate(fx.owner1, randomUUID()).expect(404);
  });
});
