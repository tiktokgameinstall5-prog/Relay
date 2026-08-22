/**
 * Refresh-token rotation and logout over real HTTP (task #8).
 *
 * The invariant under test is rotation-on-use with family-wide revocation on
 * reuse (AuthService.refresh / .logout). Each refresh token is single-use: the
 * moment it is presented it is revoked and a successor is minted in the same
 * family. A token seen twice has only two explanations — a client retry or a
 * stolen copy used in parallel — and since the server cannot tell which, it
 * burns the whole family and forces a fresh login. Every failure (unknown,
 * expired, reused, deactivated user) is one identical 401, the same anti-oracle
 * discipline the login path holds.
 *
 * Four sabotage checks pin the properties that could regress silently (each run
 * before commit: apply the break, confirm the named test goes red, revert):
 *
 *   #A  single-use rotation — the `UPDATE refresh_token SET revoked_at = now()
 *       WHERE id = $1` on the normal path (auth.service.ts refresh()). Remove it
 *       and the presented token is never revoked: "a rotated token cannot be
 *       replayed" goes red (the second refresh returns 200 instead of 401).
 *   #B  reuse burns the family — the `UPDATE ... WHERE family_id = $1 AND
 *       revoked_at IS NULL` in the revoked-token branch. Drop just that UPDATE
 *       (keep the `return null`) and reuse still 401s but no longer kills the
 *       live successor: "replaying a spent token revokes the whole family" goes
 *       red (the successor still refreshes).
 *   #C  FOR UPDATE serialisation — the `FOR UPDATE` on the token lookup. It is
 *       genuinely load-bearing under multi-connection concurrency: an 8-way
 *       concurrent burst with FOR UPDATE removed DEADLOCKS (each tx grabs the row
 *       lock via `UPDATE ... WHERE id`, then the reuse branch contends on `WHERE
 *       family_id`). But the two-request test below does NOT go red when it is
 *       removed — in a single-process runInBand run the two Promise.all refreshes
 *       serialise by timing (the first tx commits before the second's SELECT, so
 *       the second reads revoked_at already set and takes the reuse path via the
 *       committed row, not the lock). So this test pins the END-STATE invariant
 *       (exactly one success, family burned), not the lock itself; FOR UPDATE has
 *       no deterministic single-process regression guard and is retained as
 *       correctness-under-concurrency defence. (Verified 2026-08-17; see the task
 *       #8 findings in PROGRESS.md.)
 *   #D  anti-oracle 401 — invalidRefreshToken()'s single message. Give any one
 *       failure branch (unknown / expired / reuse / deactivated) a distinct
 *       status or body and "every refresh failure is one identical 401" goes red.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { REFRESH_COOKIE } from '../src/auth/cookie';
import { closePools, migratorPool, truncateAll, withTenant } from './helpers/db';
import { TEST_PASSWORD } from './helpers/seed';

jest.setTimeout(30_000);

let app: INestApplication;
let http: ReturnType<typeof request>;

/** Monotonic per-run counter so signup emails are unique even within one
 *  millisecond — each signup makes its own org, but a distinct address keeps
 *  the intent obvious and side-steps the per-(org,email) unique index. */
let seq = 0;
const freshEmail = (label: string) => `${label}.${Date.now()}.${seq++}@acme.test`;

/** The server stores only sha256(token); the raw value is returned once. To
 *  seed an EXPIRED row we must store the same digest the server would. */
const sha256Hex = (input: string) => createHash('sha256').update(input).digest('hex');

interface AuthBody {
  accessToken: string;
  refreshToken: string;
  user: { id: string; orgId: string; role: string; name: string; email: string };
}

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

// --- helpers ---------------------------------------------------------------

/** Sign up a fresh Owner and return the AuthResult body (with its refresh token). */
async function signupOwner(): Promise<AuthBody> {
  const email = freshEmail('owner');
  const res = await http
    .post('/api/auth/owner/signup')
    .send({ organizationName: 'Acme', name: 'Ada Owner', email, password: TEST_PASSWORD })
    .expect(201);
  return res.body as AuthBody;
}

/** The supertest request objects, deliberately WITHOUT `.expect()` so callers
 *  choose whether to assert a status or inspect it (the concurrent case needs
 *  the latter). */
const refresh = (token: string) => http.post('/api/auth/session/refresh').send({ refreshToken: token });
const logout = (token: string) => http.post('/api/auth/session/logout').send({ refreshToken: token });

/** Set-Cookie as a string[] — supertest types it as string, but it is an array
 *  at runtime, so narrow defensively. */
const setCookieHeaders = (res: request.Response): string[] => {
  const raw = res.headers['set-cookie'] as string[] | string | undefined;
  return Array.isArray(raw) ? raw : raw ? [raw] : [];
};
/** The relay_rt Set-Cookie line, if the response set one. */
const refreshSetCookie = (res: request.Response): string | undefined =>
  setCookieHeaders(res).find((c) => c.startsWith(`${REFRESH_COOKIE}=`));
/** The token value carried in the relay_rt Set-Cookie (decoded). Throws if absent. */
const cookieToken = (res: request.Response): string => {
  const line = refreshSetCookie(res);
  if (!line) throw new Error('response set no relay_rt cookie');
  const value = line.slice(`${REFRESH_COOKIE}=`.length).split(';')[0] ?? '';
  return decodeURIComponent(value);
};

/** Soft-deactivate a user through the owner's own RLS context, exactly as the
 *  product will (CLAUDE.md §5 soft delete). FORCE RLS blocks a context-free
 *  write, so this cannot go through the migrator. */
async function deactivate(userId: string, orgId: string): Promise<void> {
  await withTenant({ orgId, role: 'owner', managerId: null }, async (c) => {
    const res = await c.query(`UPDATE "user" SET status = 'inactive' WHERE id = $1`, [userId]);
    if (res.rowCount !== 1) throw new Error(`deactivate touched ${res.rowCount} rows`);
  });
}

// --- rotation ---------------------------------------------------------------

describe('POST /api/auth/session/refresh — rotation', () => {
  it('exchanges a valid token for a fresh access token and a NEW refresh token', async () => {
    const s = await signupOwner();

    const res = await refresh(s.refreshToken).expect(200);
    const body = res.body as AuthBody;

    expect(typeof body.accessToken).toBe('string');
    expect(body.accessToken.length).toBeGreaterThan(0);
    // The access token is a freshly re-signed JWT (three segments). It is NOT
    // asserted to differ from signup's: a JWT's iat/exp have one-second
    // resolution, so a refresh in the same wall-clock second re-signs identical
    // claims and yields a byte-identical string. That is correct — the
    // security-critical rotation is on the opaque refresh token (asserted
    // below). What must hold for the access token is that it actually
    // authenticates, so spend it on a protected route.
    expect(body.accessToken.split('.')).toHaveLength(3);
    const meRes = await http
      .get('/api/me')
      .set('Authorization', `Bearer ${body.accessToken}`)
      .expect(200);
    expect(meRes.body).toMatchObject({ id: s.user.id, role: 'owner' });
    // Rotation: the returned refresh token is a fresh one, never the presented value.
    expect(typeof body.refreshToken).toBe('string');
    expect(body.refreshToken).not.toBe(s.refreshToken);
    // Identity is re-derived from the row, so it matches the signed-up owner.
    expect(body.user).toMatchObject({ id: s.user.id, role: 'owner', email: s.user.email });
  });

  it('lets the chain continue: each successor refreshes to the next', async () => {
    const s = await signupOwner();

    const r1 = (await refresh(s.refreshToken).expect(200)).body as AuthBody;
    const r2 = (await refresh(r1.refreshToken).expect(200)).body as AuthBody;
    const r3 = (await refresh(r2.refreshToken).expect(200)).body as AuthBody;

    // Every link is distinct — a real rotation, not the same token echoed back.
    const tokens = [s.refreshToken, r1.refreshToken, r2.refreshToken, r3.refreshToken];
    expect(new Set(tokens).size).toBe(4);
  });

  it('a rotated token cannot be replayed (single-use) [sabotage #A]', async () => {
    const s = await signupOwner();

    await refresh(s.refreshToken).expect(200);
    // The same token again: it was revoked the instant it rotated.
    await refresh(s.refreshToken).expect(401);
  });

  it('replaying a spent token revokes the whole family (theft response) [sabotage #B]', async () => {
    const s = await signupOwner();

    const r1 = (await refresh(s.refreshToken).expect(200)).body as AuthBody;
    // Replay the parent. Reuse-detection treats this as compromise.
    await refresh(s.refreshToken).expect(401);
    // ...and the still-live successor is collateral: the family is burned, so the
    // legitimate client is forced back through login too.
    await refresh(r1.refreshToken).expect(401);
  });

  it('two concurrent refreshes of one token yield exactly one success [sabotage #C]', async () => {
    const s = await signupOwner();

    const [a, b] = await Promise.all([refresh(s.refreshToken), refresh(s.refreshToken)]);
    const statuses = [a.status, b.status].sort();
    // Exactly one rotates (200); the other takes the reuse path (401). NOTE: in a
    // single-process test the two serialise by timing, so this pins the end-state
    // invariant, not the FOR UPDATE lock specifically — see the header (#C).
    expect(statuses).toEqual([200, 401]);

    // The reuse path burned the family, so even the winner's successor is dead.
    const winner = (a.status === 200 ? a : b).body as AuthBody;
    await refresh(winner.refreshToken).expect(401);
  });

  it('rejects an unknown / garbage token with 401', async () => {
    await refresh('not-a-real-token').expect(401);
    await refresh(randomBytes(32).toString('base64url')).expect(401);
  });

  it('rejects an expired token with 401', async () => {
    const s = await signupOwner();
    const raw = randomBytes(32).toString('base64url');
    // refresh_token has no RLS, so the migrator can seed a row directly. Stored
    // as the same sha256 the server computes, with an expiry already in the past.
    await migratorPool.query(
      `INSERT INTO refresh_token (user_id, token_hash, family_id, expires_at)
       VALUES ($1, $2, $3, now() - interval '1 day')`,
      [s.user.id, sha256Hex(raw), randomUUID()],
    );
    await refresh(raw).expect(401);
  });

  it('refuses a since-deactivated user, even with a valid token', async () => {
    const s = await signupOwner();
    await deactivate(s.user.id, s.user.orgId);
    await refresh(s.refreshToken).expect(401);
  });

  it('every refresh failure is one identical 401 — no oracle [sabotage #D]', async () => {
    // Unknown token.
    const unknown = await refresh(randomBytes(32).toString('base64url')).expect(401);

    // Expired token for a real user.
    const s = await signupOwner();
    const raw = randomBytes(32).toString('base64url');
    await migratorPool.query(
      `INSERT INTO refresh_token (user_id, token_hash, family_id, expires_at)
       VALUES ($1, $2, $3, now() - interval '1 day')`,
      [s.user.id, sha256Hex(raw), randomUUID()],
    );
    const expired = await refresh(raw).expect(401);

    // Reused (revoked) token.
    const s2 = await signupOwner();
    await refresh(s2.refreshToken).expect(200);
    const reused = await refresh(s2.refreshToken).expect(401);

    // Byte-identical bodies: same statusCode, same message, same error.
    expect(expired.body).toEqual(unknown.body);
    expect(reused.body).toEqual(unknown.body);
    // And it is not the login message — a refresh failure says "sign in again".
    expect(unknown.body.message).toBe('Session expired. Please sign in again.');
  });
});

// --- logout -----------------------------------------------------------------

describe('POST /api/auth/session/logout', () => {
  it('revokes the presented token (204); it can no longer refresh', async () => {
    const s = await signupOwner();

    await logout(s.refreshToken).expect(204);
    await refresh(s.refreshToken).expect(401);
  });

  it('revokes the WHOLE family, not just the presented link', async () => {
    const s = await signupOwner();
    const r1 = (await refresh(s.refreshToken).expect(200)).body as AuthBody;

    // Log out with the live successor.
    await logout(r1.refreshToken).expect(204);
    await refresh(r1.refreshToken).expect(401);
  });

  it('logging out with a STALE (already-rotated) token still kills the live successor', async () => {
    const s = await signupOwner();
    const r1 = (await refresh(s.refreshToken).expect(200)).body as AuthBody;

    // s.refreshToken is already revoked by rotation, but logout resolves the
    // family through its hash and revokes every still-live token in it.
    await logout(s.refreshToken).expect(204);
    await refresh(r1.refreshToken).expect(401);
  });

  it('is idempotent for unknown, garbage, and already-revoked tokens (204)', async () => {
    await logout('garbage').expect(204);
    await logout(randomBytes(32).toString('base64url')).expect(204);

    const s = await signupOwner();
    await logout(s.refreshToken).expect(204);
    // Second logout of the same (now revoked) token: still 204, no error.
    await logout(s.refreshToken).expect(204);
  });

  it('does not touch another user\'s session (family scoping)', async () => {
    const s1 = await signupOwner();
    const s2 = await signupOwner();

    await logout(s1.refreshToken).expect(204);
    // s2's family is untouched — it still refreshes.
    await refresh(s2.refreshToken).expect(200);
  });
});

// --- httpOnly cookie transport ----------------------------------------------

/**
 * The browser half of the session transport (auth/cookie.ts). The token is set
 * as an HttpOnly cookie so the page's JS cannot read it (XSS cannot exfiltrate)
 * yet an F5 keeps the session; the same token is still returned in the body for
 * the cookie-less Flutter client (CLAUDE.md §6). These tests pin the attributes
 * that make the cookie safe, the read-from-cookie fallback on refresh, and that
 * logout both revokes and clears.
 *
 * The body's refreshToken equals the cookie's value (asserted first), so the
 * later tests reuse signupOwner()'s body token AS the cookie value rather than
 * scraping headers on every setup.
 */
describe('httpOnly refresh cookie', () => {
  it('signup sets an HttpOnly, Secure, SameSite=Lax cookie scoped to /api/auth/session', async () => {
    const email = freshEmail('owner');
    const res = await http
      .post('/api/auth/owner/signup')
      .send({ organizationName: 'Acme', name: 'Ada Owner', email, password: TEST_PASSWORD })
      .expect(201);

    const cookie = refreshSetCookie(res);
    expect(cookie).toBeDefined();
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    // The session sub-namespace — the tightest path covering both /session/refresh
    // and /session/logout, and NOT the broad /api/auth namespace.
    expect(cookie).toContain('Path=/api/auth/session;');
    expect(cookie).not.toMatch(/Path=\/api\/auth;/);
    // A positive Max-Age so the browser persists it across a reload.
    const maxAge = cookie?.match(/Max-Age=(\d+)/);
    expect(maxAge).not.toBeNull();
    expect(Number(maxAge?.[1])).toBeGreaterThan(0);
    // The cookie carries exactly the body's refresh token.
    expect(cookieToken(res)).toBe((res.body as AuthBody).refreshToken);
  });

  it('login sets the same cookie', async () => {
    const s = await signupOwner();
    const res = await http
      .post('/api/auth/login')
      .send({ email: s.user.email, password: TEST_PASSWORD })
      .expect(200);

    const cookie = refreshSetCookie(res);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Path=/api/auth/session;');
    expect(cookieToken(res)).toBe((res.body as AuthBody).refreshToken);
  });

  it('refreshes from the cookie alone, with no token in the body, and rotates it', async () => {
    const s = await signupOwner();

    // Body carries no refreshToken; the handler falls back to the cookie.
    const res = await http
      .post('/api/auth/session/refresh')
      .set('Cookie', `${REFRESH_COOKIE}=${s.refreshToken}`)
      .send({})
      .expect(200);
    const body = res.body as AuthBody;

    // Rotated: fresh token in both the body and the new cookie.
    expect(body.refreshToken).not.toBe(s.refreshToken);
    expect(cookieToken(res)).toBe(body.refreshToken);

    // The access token minted this way actually authenticates.
    await http
      .get('/api/me')
      .set('Authorization', `Bearer ${body.accessToken}`)
      .expect(200);

    // The presented cookie token is now spent — replaying it is the uniform 401.
    await http
      .post('/api/auth/session/refresh')
      .set('Cookie', `${REFRESH_COOKIE}=${s.refreshToken}`)
      .send({})
      .expect(401);
  });

  it('still accepts the token in the body (mobile path) and sets the cookie there too', async () => {
    const s = await signupOwner();

    const res = await refresh(s.refreshToken).expect(200);
    const body = res.body as AuthBody;
    // Additive: the body path rotates as before AND now also sets the cookie.
    expect(cookieToken(res)).toBe(body.refreshToken);
  });

  it('logout via the cookie clears the cookie and revokes the session', async () => {
    const s = await signupOwner();

    const res = await http
      .post('/api/auth/session/logout')
      .set('Cookie', `${REFRESH_COOKIE}=${s.refreshToken}`)
      .expect(204);

    // Cleared: empty value, same path so the browser drops the original.
    const cleared = refreshSetCookie(res);
    expect(cleared).toBeDefined();
    expect(cleared).toMatch(/^relay_rt=;/);
    expect(cleared).toContain('Path=/api/auth/session');

    // And it is genuinely revoked server-side, not merely cleared client-side.
    await refresh(s.refreshToken).expect(401);
  });

  it('logout with neither a body token nor a cookie still 204s and clears the cookie', async () => {
    // A browser that lost its cookie can still "sign out": nothing to revoke, but
    // the clear must still be sent.
    const res = await http.post('/api/auth/session/logout').send({}).expect(204);
    expect(refreshSetCookie(res)).toMatch(/^relay_rt=;/);
  });
});
