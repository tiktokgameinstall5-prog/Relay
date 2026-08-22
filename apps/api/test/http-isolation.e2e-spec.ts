/**
 * The HTTP-layer half of the CLAUDE.md §11 isolation gate.
 *
 * §11 requires an automated test that proves a Manager cannot reach another
 * Manager's team/tasks/reports/members by ID — "must fail (empty result or
 * 403)" — and that it never leaves CI. That proof is deliberately split into two
 * independent layers, tested independently:
 *
 *   • rls.e2e-spec.ts (34 tests) is the DATABASE layer. With no HTTP and the
 *     guards irrelevant, it proves Postgres itself returns zero rows for a
 *     cross-tenant id — so even if every application guard were removed, the data
 *     does not leak.
 *   • THIS suite is the HTTP layer. It drives the real AppModule — the global
 *     JwtAuthGuard → RolesGuard → ResourceOwnerGuard chain and the RLS-scoped
 *     service queries behind it — and proves the guards REFUSE a cross-tenant or
 *     cross-role request over the wire, with the exact status code each route
 *     promises. Two layers, so a regression in either is caught by the other.
 *
 * THE READ SURFACE, AND THE READ-BY-ID CASE §11 NAMES DIRECTLY
 *
 * Phase 1 exposed exactly one authenticated read, GET /api/me — self-only, no id
 * param, unable to address anyone else. Phase 2 adds three reads the dashboards
 * need, and they are the real §11 read surface:
 *
 *   • GET /api/auth/teams and GET /api/auth/managers are COLLECTION reads with no
 *     id param. Their isolation is that RLS narrows the collection to the
 *     caller's slice — an Owner sees their org, a Manager sees only their own
 *     team — so the gate asserts SET-EQUALITY (the exact ids returned), never a
 *     bare count, because a count cannot tell {teamA} from {teamB}.
 *   • GET /api/auth/teams/:id/members IS the classic §11 attack: log in as
 *     managerA, request managerB's team id, assert 404 — byte-identical to a team
 *     that does not exist. @OwnedResource on the route is what collapses the
 *     cross-tenant id, the cross-org id, and the malformed id into one indistinct
 *     404. See resource-owner.guard.ts (404-never-403) for why 404, not 403.
 *
 * The WRITE/provisioning routes (which name a target manager or team) and the one
 * id-addressed mutation (passcode re-issue) remain part of this gate too — the
 * id-guessing surface is now both reads and writes.
 *
 * ROUTE INVENTORY (every route the app exposes, and where its isolation is proven)
 *
 *   1. GET  /api/me                       — self-scope + claims-not-trusted   HERE
 *   2. POST /api/auth/owner/signup        — @Public; makes a NEW org, no       —
 *                                           tenant target to guess             (note)
 *   3. POST /api/auth/login               — @Public; credential-based, returns
 *                                           only the caller's own identity     auth.e2e
 *   4. POST /api/auth/refresh             — @Public; session isolation         session-refresh
 *   5. POST /api/auth/logout              — @Public; session isolation         HERE + session-refresh
 *   6. POST /api/auth/managers            — Owner-only role gate               HERE
 *   7. POST /api/auth/manager/first-login — @Public alias; credential-based    provisioning specs
 *   8. POST /api/auth/members             — cross-manager / cross-org target   HERE
 *   9. POST /api/auth/first-login         — @Public canonical; credential-based provisioning specs
 *  10. POST /api/auth/teams               — cross-manager / cross-org target   HERE
 *  11. POST /api/auth/users/:id/passcode  — id-addressed; cross-tenant + role  HERE + passcode-regeneration
 *  12. GET  /api/auth/teams               — collection read; RLS-scoped set    HERE
 *  13. GET  /api/auth/managers            — Owner-only collection read         HERE
 *  14. GET  /api/auth/teams/:id/members   — read-by-id; the literal §11 case   HERE
 *
 * The @Public credential routes (2,3,7,9) are not an id-guessing surface: they
 * carry no tenant target, and their "isolation" is possession of a secret
 * (password/passcode/refresh token), covered by auth.e2e-spec.ts,
 * session-refresh.e2e-spec.ts and the provisioning specs. This gate does not
 * re-test those; it owns the authenticated tenant-target surface and the
 * role/claims boundary.
 *
 * WHY THE STATUS CODES DIFFER — 403 vs 400 vs 404 IS ITSELF PART OF THE CONTRACT
 *
 *   403  the ACTION is refused: the caller's role may not use this route at all
 *        (RolesGuard, which runs before any target is resolved). Member → any
 *        provisioning route.
 *   400  the target manager is not resolvable in the caller's slice: a Manager
 *        naming another manager, or an Owner naming a manager RLS makes invisible
 *        (cross-org). The service's RLS-scoped `SELECT ... manager` returns zero
 *        rows → BadRequest, deliberately not a 500 and not a leak of "exists
 *        elsewhere".
 *   404  an id-addressed row is outside the caller's slice, made byte-identical
 *        to "does not exist" (ResourceOwnerGuard/ RLS). Cross-tenant passcode
 *        target, and any malformed id.
 *
 * The gate asserts the SPECIFIC code per route, because collapsing them (e.g. a
 * refactor that 403s a cross-org owner instead of 400ing, or 500s a malformed id
 * instead of 404ing) is exactly the kind of regression that reopens the oracle
 * §1 forbids.
 *
 * POSITIVE CONTROLS are interleaved throughout: a deny-everything bug would pass
 * every negative assertion here, so each route also proves the in-tenant action
 * SUCCEEDS. The gate proves isolation, not merely that the routes are broken.
 */
import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { sign } from 'jsonwebtoken';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { closePools, truncateAll, withTenant } from './helpers/db';
import { ctxFor, seedFixture, type Fixture, type SeededUser } from './helpers/seed';
import { bearer } from './helpers/token';

jest.setTimeout(30_000);

let app: INestApplication;
let http: ReturnType<typeof request>;
let fx: Fixture;

/** Monotonic per-run counter so provisioning emails are unique even inside one
 *  millisecond — the (org_id, email) unique index rejects duplicates and a
 *  collision would surface as a spurious 409. */
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
  // seedFixture() mints fresh UUIDs for every user each run, so the per-user
  // `provisioning` throttler bucket (OwnerThrottlerGuard keys on user id) is
  // empty at the start of every test — the gate can provision freely without
  // rationing against the 20/hour cap.
  fx = await seedFixture();
});

// --- helpers ---------------------------------------------------------------

/**
 * Mint an access token with ARBITRARY claims, signed with the real
 * JWT_ACCESS_SECRET so the signature is valid. This is the tool for the
 * claims-not-trusted assertions: a validly-signed token whose role/orgId/
 * managerId claims are lies. bearer()/accessTokenFor() cannot express this
 * because they derive every claim from a real SeededUser.
 */
function forgedToken(payload: {
  sub: string;
  role: 'owner' | 'manager' | 'member';
  orgId: string;
  managerId: string | null;
}): string {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) throw new Error('JWT_ACCESS_SECRET is not set. Copy .env.example to apps/api/.env.');
  return sign(payload, secret, { expiresIn: '15m' });
}

/** Provision a pending Manager through the Owner route; return its id. The
 *  passcode is emailed, never returned, and this gate never needs it — every
 *  passcode-route assertion here is about the guard boundary (404/403/200), not
 *  activation, which passcode-regeneration.e2e-spec.ts owns. */
async function provisionManager(owner: SeededUser): Promise<string> {
  const res = await http
    .post('/api/auth/managers')
    .set('Authorization', bearer(owner))
    .send({ name: 'Pending Manager', email: freshEmail('pmgr') })
    .expect(201);
  return (res.body as { id: string }).id;
}

/** Provision a pending Member. A Manager caller omits managerId (their own
 *  team); an Owner names the manager whose team the member joins. */
async function provisionMember(
  actor: SeededUser,
  opts: { managerId?: string } = {},
): Promise<string> {
  const body: { name: string; email: string; managerId?: string } = {
    name: 'Pending Member',
    email: freshEmail('pmem'),
  };
  if (opts.managerId) body.managerId = opts.managerId;
  const res = await http
    .post('/api/auth/members')
    .set('Authorization', bearer(actor))
    .send(body)
    .expect(201);
  return (res.body as { id: string }).id;
}

interface AuthBody {
  accessToken: string;
  refreshToken: string;
  user: { id: string; orgId: string; role: string; name: string; email: string };
}

/** Sign up a fresh Owner (its own new org) over HTTP; return the auth body. */
async function signupOwner(): Promise<AuthBody> {
  const res = await http
    .post('/api/auth/owner/signup')
    .send({
      organizationName: 'Acme',
      name: 'Ada Owner',
      email: freshEmail('owner'),
      password: 'CorrectHorse!9',
    })
    .expect(201);
  return res.body as AuthBody;
}

// Route shorthands. Each accepts either a SeededUser (real token via bearer())
// or a raw JWT string (the forged-claims tests) — a string is treated as a raw
// token and given the `Bearer ` scheme, so callers pass forgedToken(...) unwrapped.
// No .expect() here: each test asserts its own status.
const authHeader = (actor: SeededUser | string) =>
  typeof actor === 'string' ? `Bearer ${actor}` : bearer(actor);

const createManager = (actor: SeededUser | string, body: object) =>
  http.post('/api/auth/managers').set('Authorization', authHeader(actor)).send(body);

const createTeam = (actor: SeededUser | string, body: object) =>
  http.post('/api/auth/teams').set('Authorization', authHeader(actor)).send(body);

const createMember = (actor: SeededUser | string, body: object) =>
  http.post('/api/auth/members').set('Authorization', authHeader(actor)).send(body);

const regenerate = (actor: SeededUser | string, id: string) =>
  http.post(`/api/auth/users/${id}/passcode`).set('Authorization', authHeader(actor));

// ---------------------------------------------------------------------------

describe('§11 HTTP isolation gate', () => {
  // --- GET /api/me — self-scoped, and scope comes from the row not the token ---
  describe('GET /api/me — self-only; scope is re-derived from the row', () => {
    it('returns the caller\'s own identity, nothing else', async () => {
      const res = await http.get('/api/me').set('Authorization', bearer(fx.managerA)).expect(200);
      expect(res.body).toMatchObject({
        id: fx.managerA.id,
        orgId: fx.org1Id,
        organizationName: 'Acme',
        role: 'manager',
        // A manager's tenant key is their own id.
        managerId: fx.managerA.id,
      });
    });

    it('two different callers each get their OWN row (self-scope, not a shared read)', async () => {
      const asOwner = await http.get('/api/me').set('Authorization', bearer(fx.owner1)).expect(200);
      const asMember = await http
        .get('/api/me')
        .set('Authorization', bearer(fx.memberA1))
        .expect(200);

      expect(asOwner.body).toMatchObject({ id: fx.owner1.id, role: 'owner', managerId: null });
      expect(asMember.body).toMatchObject({
        id: fx.memberA1.id,
        role: 'member',
        // A member's key is their MANAGER's id.
        managerId: fx.managerA.id,
      });
    });

    it('a forged orgId/managerId claim does NOT move scope — /me reflects the row [gate]', async () => {
      // A validly-signed token for managerA, but claiming to belong to org2 and
      // to managerB. JwtStrategy.validate() re-reads the row and ignores every
      // claim but `sub`, so scope is managerA's real org1 identity — the forged
      // claims buy nothing. This is the HTTP proof of the property jwt.strategy.ts
      // relies on to make forging a manager_id pointless.
      const token = forgedToken({
        sub: fx.managerA.id,
        role: 'manager',
        orgId: fx.org2Id, // lie: managerA is in org1
        managerId: fx.managerB.id, // lie: managerA's key is their own id
      });
      const res = await http.get('/api/me').set('Authorization', `Bearer ${token}`).expect(200);
      expect(res.body).toMatchObject({
        id: fx.managerA.id,
        orgId: fx.org1Id, // real, from the row — NOT the forged org2
        organizationName: 'Acme', // org1, not Globex
        managerId: fx.managerA.id, // real, NOT the forged managerB
      });
      expect(res.body.orgId).not.toBe(fx.org2Id);
    });

    it('rejects a missing token (401)', async () => {
      await http.get('/api/me').expect(401);
    });
  });

  // --- GET /api/auth/teams — owner sees the org; a manager sees only their team ---
  describe('GET /api/auth/teams — RLS scopes the list; counts exclude the manager', () => {
    const ids = (body: unknown) =>
      (body as Array<{ id: string }>).map((t) => t.id).sort();

    it('an Owner sees every team in their org and no other org\'s (set equality)', async () => {
      const res = await http
        .get('/api/auth/teams')
        .set('Authorization', bearer(fx.owner1))
        .expect(200);
      expect(ids(res.body)).toEqual([fx.teamAId, fx.teamBId].sort());
      // Spelled-out negative: teamC (org2) is absent, not merely "length 2".
      expect(ids(res.body)).not.toContain(fx.teamCId);
    });

    it('owner2 sees only their own org\'s team (mirror)', async () => {
      const res = await http
        .get('/api/auth/teams')
        .set('Authorization', bearer(fx.owner2))
        .expect(200);
      expect(ids(res.body)).toEqual([fx.teamCId]);
      expect(ids(res.body)).not.toContain(fx.teamAId);
      expect(ids(res.body)).not.toContain(fx.teamBId);
    });

    it('a Manager sees EXACTLY their own team, never a sibling manager\'s (§11)', async () => {
      // Also the tripwire for `JOIN "user" m ON m.id = t.manager_id`: a manager can
      // see their OWN row (manager_id = self), so the join resolves and teamA comes
      // back. If that self-visibility ever regressed, this returns [] and fails.
      const res = await http
        .get('/api/auth/teams')
        .set('Authorization', bearer(fx.managerA))
        .expect(200);
      expect(ids(res.body)).toEqual([fx.teamAId]);
      expect(ids(res.body)).not.toContain(fx.teamBId);
    });

    it('a forged role=owner / managerId claim does NOT widen the list [gate]', async () => {
      // managerA's token, lying that they are an owner in org1. JwtStrategy re-reads
      // the row, so role stays 'manager' and scope stays teamA — the forged claims
      // buy no extra teams. RolesGuard admits 'owner' too, so this isolates the DATA
      // scope from the role gate: a would-be owner still sees only managerA's team.
      const token = forgedToken({
        sub: fx.managerA.id,
        role: 'owner',
        orgId: fx.org1Id,
        managerId: null,
      });
      const res = await http
        .get('/api/auth/teams')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(ids(res.body)).toEqual([fx.teamAId]);
      expect(ids(res.body)).not.toContain(fx.teamBId);
    });

    it('a Member is refused (403 — the action, not a hidden list)', async () => {
      await http
        .get('/api/auth/teams')
        .set('Authorization', bearer(fx.memberA1))
        .expect(403);
    });

    it('member_count counts active members and EXCLUDES the manager (teamA → 2, not 3)', async () => {
      const res = await http
        .get('/api/auth/teams')
        .set('Authorization', bearer(fx.managerA))
        .expect(200);
      const teamA = (res.body as Array<{ id: string; memberCount: number }>).find(
        (t) => t.id === fx.teamAId,
      );
      // managerA's own user.team_id points at teamA (createTeam sets it); the
      // role='member' count filter is what keeps them out of this number.
      expect(teamA?.memberCount).toBe(2);
    });

    it('pending_invite_count counts only password-less members', async () => {
      // Every fixture member has a password → 0 pending. Provision one fresh member
      // on teamA (no password set yet) and teamA reads 1 pending / 3 active members
      // while teamB stays 0 — proving the count tracks password_hash IS NULL.
      await provisionMember(fx.managerA);
      const res = await http
        .get('/api/auth/teams')
        .set('Authorization', bearer(fx.owner1))
        .expect(200);
      const rows = res.body as Array<{
        id: string;
        memberCount: number;
        pendingInviteCount: number;
      }>;
      const teamA = rows.find((t) => t.id === fx.teamAId);
      const teamB = rows.find((t) => t.id === fx.teamBId);
      expect(teamA?.pendingInviteCount).toBe(1);
      expect(teamA?.memberCount).toBe(3);
      expect(teamB?.pendingInviteCount).toBe(0);
    });

    it('a soft-deleted team is absent from the list (status filter, not just RLS)', async () => {
      // The team policy has NO status term, so RLS still shows a deleted team;
      // `WHERE t.status = 'active'` is the load-bearing filter. Soft-delete teamB
      // through the owner's own tenant context — the path a real delete will take —
      // and confirm it drops out while teamA remains.
      await withTenant(ctxFor(fx.owner1), (c) =>
        c.query("UPDATE team SET status = 'deleted', deleted_at = now() WHERE id = $1", [
          fx.teamBId,
        ]),
      );
      const res = await http
        .get('/api/auth/teams')
        .set('Authorization', bearer(fx.owner1))
        .expect(200);
      expect(ids(res.body)).toEqual([fx.teamAId]);
      expect(ids(res.body)).not.toContain(fx.teamBId);
    });
  });

  // --- GET /api/auth/teams/:id/members — the literal §11 read-by-id case ---
  describe('GET /api/auth/teams/:id/members — @OwnedResource makes a foreign id a 404', () => {
    const ids = (body: unknown) =>
      (body as Array<{ id: string }>).map((m) => m.id).sort();

    it("managerA reading managerB's team id is 404 — byte-identical to a team that does not exist", async () => {
      // The reference body for "does not exist": a well-formed uuid that is no
      // team at all. The cross-tenant guess must match it byte for byte, or it
      // has disclosed that teamB exists somewhere (resource-owner.guard.ts).
      const nonexistent = randomUUID();
      const foreign = await http
        .get(`/api/auth/teams/${fx.teamBId}/members`)
        .set('Authorization', bearer(fx.managerA))
        .expect(404);
      const absent = await http
        .get(`/api/auth/teams/${nonexistent}/members`)
        .set('Authorization', bearer(fx.managerA))
        .expect(404);
      expect(foreign.body).toEqual(absent.body);
    });

    it('a cross-org team id is the same 404 (owner1 → teamC in another org)', async () => {
      await http
        .get(`/api/auth/teams/${fx.teamCId}/members`)
        .set('Authorization', bearer(fx.owner1))
        .expect(404);
    });

    it('a malformed (non-uuid) id is 404, not a 500 that leaks "wrong shape"', async () => {
      await http
        .get('/api/auth/teams/not-a-uuid/members')
        .set('Authorization', bearer(fx.managerA))
        .expect(404);
    });

    it('managerA sees exactly their own roster {memberA1, memberA2}, not themselves', async () => {
      const res = await http
        .get(`/api/auth/teams/${fx.teamAId}/members`)
        .set('Authorization', bearer(fx.managerA))
        .expect(200);
      expect(ids(res.body)).toEqual([fx.memberA1.id, fx.memberA2.id].sort());
      // The manager's own user.team_id points at teamA; role='member' keeps them
      // out of their own roster (else every team's count is off by one).
      expect(ids(res.body)).not.toContain(fx.managerA.id);
    });

    it('an Owner reads any team in their org, and the two rosters are disjoint', async () => {
      const a = await http
        .get(`/api/auth/teams/${fx.teamAId}/members`)
        .set('Authorization', bearer(fx.owner1))
        .expect(200);
      const b = await http
        .get(`/api/auth/teams/${fx.teamBId}/members`)
        .set('Authorization', bearer(fx.owner1))
        .expect(200);
      expect(ids(a.body)).toEqual([fx.memberA1.id, fx.memberA2.id].sort());
      expect(ids(b.body)).toEqual([fx.memberB1.id, fx.memberB2.id].sort());
      const overlap = ids(a.body).filter((id) => ids(b.body).includes(id));
      expect(overlap).toEqual([]);
    });

    it('a Member is refused (403) — the roster is Owner/Manager only', async () => {
      await http
        .get(`/api/auth/teams/${fx.teamAId}/members`)
        .set('Authorization', bearer(fx.memberA1))
        .expect(403);
    });

    it('a forged role=owner claim does not widen a Manager past @OwnedResource', async () => {
      // The 'owner' claim is a lie: JwtStrategy rebuilds BOTH role and managerId
      // from managerA's row, so RolesGuard sees 'manager' (allowed) and the guard
      // probes teamB under managerA's real tenant context — still invisible → 404.
      const token = forgedToken({
        sub: fx.managerA.id,
        role: 'owner',
        orgId: fx.org1Id,
        managerId: fx.managerA.id,
      });
      await http
        .get(`/api/auth/teams/${fx.teamBId}/members`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('each row is EXACTLY the decision-#4 whitelist — no hash, no ranking/title/step', async () => {
      const res = await http
        .get(`/api/auth/teams/${fx.teamAId}/members`)
        .set('Authorization', bearer(fx.managerA))
        .expect(200);
      const rows = res.body as Array<Record<string, unknown>>;
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(Object.keys(row).sort()).toEqual([
          'createdAt',
          'email',
          'id',
          'name',
          'pendingInvite',
          'role',
          'status',
          'teamId',
        ]);
      }
    });

    it('pendingInvite tracks activation; a freshly-added member reads true', async () => {
      const pendingId = await provisionMember(fx.managerA);
      const res = await http
        .get(`/api/auth/teams/${fx.teamAId}/members`)
        .set('Authorization', bearer(fx.managerA))
        .expect(200);
      const rows = res.body as Array<{
        id: string;
        pendingInvite: boolean;
        teamId: string;
      }>;
      const pending = rows.find((m) => m.id === pendingId);
      expect(pending?.pendingInvite).toBe(true);
      expect(pending?.teamId).toBe(fx.teamAId);
      // The activated fixture members read false — the flag is real, not constant.
      const activated = rows.find((m) => m.id === fx.memberA1.id);
      expect(activated?.pendingInvite).toBe(false);
    });
  });

  // --- GET /api/auth/managers — owner-only; an org-wide view no manager may hold ---
  describe('GET /api/auth/managers — Owner-only; scoped to the org', () => {
    const ids = (body: unknown) =>
      (body as Array<{ id: string }>).map((m) => m.id).sort();

    it('an Owner sees every manager in their org — not members, not the owner, not another org', async () => {
      const res = await http
        .get('/api/auth/managers')
        .set('Authorization', bearer(fx.owner1))
        .expect(200);
      expect(ids(res.body)).toEqual([fx.managerA.id, fx.managerB.id].sort());
      // Spelled-out negatives: the list is managers only, org-scoped.
      expect(ids(res.body)).not.toContain(fx.owner1.id);
      expect(ids(res.body)).not.toContain(fx.memberA1.id);
      expect(ids(res.body)).not.toContain(fx.managerC.id);
    });

    it('owner2 sees only their own org\'s manager (mirror)', async () => {
      const res = await http
        .get('/api/auth/managers')
        .set('Authorization', bearer(fx.owner2))
        .expect(200);
      expect(ids(res.body)).toEqual([fx.managerC.id]);
      expect(ids(res.body)).not.toContain(fx.managerA.id);
      expect(ids(res.body)).not.toContain(fx.managerB.id);
    });

    it('a Manager is refused (403) — not handed a broken one-row list', async () => {
      // A manager's "user" slice is {self} ∪ {their members}; filtered to
      // role='manager' that is just themselves. Owner-only turns that misleading
      // success into a clean refusal.
      await http
        .get('/api/auth/managers')
        .set('Authorization', bearer(fx.managerA))
        .expect(403);
    });

    it('a Member is refused (403)', async () => {
      await http
        .get('/api/auth/managers')
        .set('Authorization', bearer(fx.memberA1))
        .expect(403);
    });

    it('a forged role=owner claim on a Manager\'s token is still refused (403) [gate]', async () => {
      // RolesGuard reads request.user.role, rebuilt from managerA's row ('manager');
      // the forged 'owner' claim buys nothing.
      const token = forgedToken({
        sub: fx.managerA.id,
        role: 'owner',
        orgId: fx.org1Id,
        managerId: fx.managerA.id,
      });
      await http
        .get('/api/auth/managers')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    });

    it('each row is EXACTLY the whitelist — no hash, no passcode', async () => {
      const res = await http
        .get('/api/auth/managers')
        .set('Authorization', bearer(fx.owner1))
        .expect(200);
      const rows = res.body as Array<Record<string, unknown>>;
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(Object.keys(row).sort()).toEqual([
          'createdAt',
          'email',
          'id',
          'name',
          'pendingInvite',
          'status',
          'teamId',
          'teamName',
        ]);
      }
    });

    it('pendingInvite reflects activation state and the team is resolved', async () => {
      // Fixture managers are activated (password set) and each holds a team.
      const res = await http
        .get('/api/auth/managers')
        .set('Authorization', bearer(fx.owner1))
        .expect(200);
      const activated = (
        res.body as Array<{ id: string; pendingInvite: boolean; teamId: string | null }>
      ).find((m) => m.id === fx.managerA.id);
      expect(activated?.pendingInvite).toBe(false);
      expect(activated?.teamId).toBe(fx.teamAId);

      // A freshly-provisioned manager has no password and no team yet.
      const pendingId = await provisionManager(fx.owner1);
      const res2 = await http
        .get('/api/auth/managers')
        .set('Authorization', bearer(fx.owner1))
        .expect(200);
      const pending = (
        res2.body as Array<{ id: string; pendingInvite: boolean; teamId: string | null }>
      ).find((m) => m.id === pendingId);
      expect(pending?.pendingInvite).toBe(true);
      expect(pending?.teamId).toBeNull();
    });
  });

  // --- POST /api/auth/managers — Owner-only role gate ---
  describe('POST /api/auth/managers — Owner-only', () => {
    it('an Owner provisions a manager (201, positive control)', async () => {
      await createManager(fx.owner1, { name: 'New Manager', email: freshEmail('nm') }).expect(201);
    });

    it('a Manager is refused (403 — the action, not a hidden resource)', async () => {
      await createManager(fx.managerA, { name: 'X', email: freshEmail('x') }).expect(403);
    });

    it('a Member is refused (403)', async () => {
      await createManager(fx.memberA1, { name: 'X', email: freshEmail('x') }).expect(403);
    });

    it('a forged role=owner claim on a Manager\'s token is still refused (403) [gate]', async () => {
      // The token is validly signed and claims role:'owner', but RolesGuard reads
      // request.user.role, which JwtStrategy built from managerA's row ('manager').
      // A forged role claim is worth nothing — the privilege-escalation analogue
      // of the /me claims test above.
      const token = forgedToken({
        sub: fx.managerA.id,
        role: 'owner', // lie: managerA is a manager
        orgId: fx.org1Id,
        managerId: fx.managerA.id,
      });
      await createManager(token, { name: 'X', email: freshEmail('x') }).expect(403);
    });
  });

  // --- POST /api/auth/teams — cross-tenant manager targets refused ---
  describe('POST /api/auth/teams — a team is created only for a manager in the caller\'s slice', () => {
    it('an Owner creates a team for a manager in their own org (201, positive control)', async () => {
      // A freshly-provisioned manager has no team yet, so this is a clean 201
      // (the fixture managers already hold their one active team).
      const newMgrId = await provisionManager(fx.owner1);
      await createTeam(fx.owner1, { name: 'Delivery Squad', managerId: newMgrId }).expect(201);
    });

    it('a Manager cannot create a team for ANOTHER manager in the same org (400)', async () => {
      // resolveTargetManagerId refuses a manager naming an id other than their
      // own — before any query. 400, not 403: the route is allowed to Managers,
      // it is the named target that is illegitimate.
      await createTeam(fx.managerA, { name: 'Steal', managerId: fx.managerB.id }).expect(400);
    });

    it('an Owner cannot create a team for a manager in ANOTHER org (400)', async () => {
      // owner1's RLS slice is org1, so managerC (org2) is invisible to the
      // service's `SELECT ... manager` — zero rows → 400 "No such manager in your
      // organization", never a leak that managerC exists elsewhere.
      await createTeam(fx.owner1, { name: 'Cross-org', managerId: fx.managerC.id }).expect(400);
    });

    it('a Member is refused before any target is resolved (403)', async () => {
      await createTeam(fx.memberA1, { name: 'Nope', managerId: fx.managerA.id }).expect(403);
    });

    it('an Owner omitting managerId is 400 — no cross-tenant default is guessed', async () => {
      await createTeam(fx.owner1, { name: 'No manager named' }).expect(400);
    });
  });

  // --- POST /api/auth/members — cross-tenant manager targets refused ---
  describe('POST /api/auth/members — a member joins only a manager in the caller\'s slice', () => {
    it('a Manager provisions a member on their OWN team (201, positive control)', async () => {
      await createMember(fx.managerA, { name: 'Mine', email: freshEmail('mine') }).expect(201);
    });

    it('an Owner provisions a member under a manager in their org (201, positive control)', async () => {
      await createMember(fx.owner1, {
        name: 'ForA',
        email: freshEmail('fora'),
        managerId: fx.managerA.id,
      }).expect(201);
    });

    it('a Manager cannot provision a member under ANOTHER manager (same org) (400)', async () => {
      await createMember(fx.managerA, {
        name: 'Steal',
        email: freshEmail('steal'),
        managerId: fx.managerB.id,
      }).expect(400);
    });

    it('an Owner cannot provision a member under a manager in ANOTHER org (400)', async () => {
      // The check that stops a cross-org member: without the RLS-scoped manager
      // lookup, the member's org_id (owner1's) + manager_id (managerC's) would
      // both satisfy the FK and the owner RLS branch, creating a cross-org member.
      await createMember(fx.owner1, {
        name: 'CrossOrg',
        email: freshEmail('cross'),
        managerId: fx.managerC.id,
      }).expect(400);
    });

    it('a Member is refused (403)', async () => {
      await createMember(fx.memberA1, { name: 'Nope', email: freshEmail('nope') }).expect(403);
    });
  });

  // --- POST /api/auth/users/:id/passcode — id-addressed; the one Phase-1 read-adjacent surface ---
  describe('POST /api/auth/users/:id/passcode — cross-tenant re-issue is byte-identical to nonexistent', () => {
    it('an Owner re-issues a pending manager in their org (200, positive control)', async () => {
      const pendingMgrId = await provisionManager(fx.owner1);
      await regenerate(fx.owner1, pendingMgrId).expect(200);
    });

    it('a Manager cannot re-issue ANOTHER manager\'s pending member (same org) (404)', async () => {
      // owner1 provisions a pending member on managerB's team; managerA, scoped to
      // teamA, cannot see or re-issue it → 404 (the RLS-scoped UPDATE matches zero
      // rows). This is the §11 cross-manager id-guess, at the HTTP layer.
      const memBId = await provisionMember(fx.owner1, { managerId: fx.managerB.id });
      await regenerate(fx.managerA, memBId).expect(404);
    });

    it('an Owner cannot re-issue a pending manager in ANOTHER org (404)', async () => {
      const mgr2Id = await provisionManager(fx.owner2);
      await regenerate(fx.owner1, mgr2Id).expect(404);
    });

    it('a Member is refused before the target is resolved (403, not 404)', async () => {
      // RolesGuard runs BEFORE ResourceOwnerGuard, so a Member is refused the
      // action (403) even for an in-slice target — the guard order is what makes
      // this 403 and not 404.
      const pendingMemId = await provisionMember(fx.managerA);
      await regenerate(fx.memberA1, pendingMemId).expect(403);
    });

    it('a malformed id is a 404, never a 500 (UUID checked before any DB read)', async () => {
      await regenerate(fx.owner1, 'not-a-uuid').expect(404);
    });

    it('a well-formed but nonexistent id is a 404', async () => {
      await regenerate(fx.owner1, randomUUID()).expect(404);
    });

    // The account-takeover WHERE-clause properties (an ACTIVATED account cannot be
    // re-issued; owners have no passcode flow) are proven in
    // passcode-regeneration.e2e-spec.ts, which owns that route's full behaviour.
    // This gate asserts only the tenant/role boundary.
  });

  // --- session routes — one session cannot affect another ---
  describe('POST /api/auth/logout — session isolation across users', () => {
    it('logging out one owner does not touch another owner\'s session', async () => {
      const s1 = await signupOwner();
      const s2 = await signupOwner();

      await http.post('/api/auth/logout').send({ refreshToken: s1.refreshToken }).expect(204);

      // s1 is revoked; s2 is untouched and still refreshes. logout is scoped to
      // the presented token's family and reaches no other user's lineage.
      await http.post('/api/auth/refresh').send({ refreshToken: s1.refreshToken }).expect(401);
      await http.post('/api/auth/refresh').send({ refreshToken: s2.refreshToken }).expect(200);
    });

    // The full rotation / single-use / reuse-burns-the-family / anti-oracle matrix
    // is proven in session-refresh.e2e-spec.ts. This gate asserts only that one
    // user's session lifecycle cannot reach another's.
  });
});
