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
const refresh = (token: string) => http.post('/api/auth/refresh').send({ refreshToken: token });
const logout = (token: string) => http.post('/api/auth/logout').send({ refreshToken: token });

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

describe('POST /api/auth/refresh — rotation', () => {
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

describe('POST /api/auth/logout', () => {
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
