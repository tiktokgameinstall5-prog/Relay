/**
 * RolesGuard and ResourceOwnerGuard over real HTTP, against the real database.
 *
 * The ResourceOwnerGuard block is the CLAUDE.md §11 isolation check at the HTTP
 * layer. rls.e2e-spec.ts already proves the same property with direct SQL and no
 * HTTP; this proves the guard does not undo it — that a cross-tenant id guessed
 * at a URL is indistinguishable from one that never existed.
 *
 * The member cases are not padding. Members are the role most likely to surprise
 * us in Phase 2, and one of them (a member reading a teammate) asserts a 200 that
 * looks like a leak and is not — see the note on that test.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { ProbeModule } from './helpers/probe.module';
import { closePools, truncateAll } from './helpers/db';
import { seedFixture, type Fixture } from './helpers/seed';
import { bearer } from './helpers/token';

jest.setTimeout(30_000);

let app: INestApplication;
let http: ReturnType<typeof request>;
let fx: Fixture;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule, ProbeModule],
  }).compile();
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

describe('RolesGuard', () => {
  it('admits the listed role and refuses the others', async () => {
    await http.get('/api/probe/owner-only').set('Authorization', bearer(fx.owner1)).expect(200);
    await http.get('/api/probe/owner-only').set('Authorization', bearer(fx.managerA)).expect(403);
    await http.get('/api/probe/owner-only').set('Authorization', bearer(fx.memberA1)).expect(403);
  });

  it('admits any of several listed roles', async () => {
    await http
      .get('/api/probe/owner-or-manager')
      .set('Authorization', bearer(fx.owner1))
      .expect(200);
    await http
      .get('/api/probe/owner-or-manager')
      .set('Authorization', bearer(fx.managerA))
      .expect(200);
    // Not listed, so still refused — the guard is a list, not a floor.
    await http
      .get('/api/probe/owner-or-manager')
      .set('Authorization', bearer(fx.memberA1))
      .expect(403);
  });

  it('leaves a route with no @Roles open to every authenticated role', async () => {
    for (const u of [fx.owner1, fx.managerA, fx.memberA1]) {
      await http.get('/api/probe/any-role').set('Authorization', bearer(u)).expect(200);
    }
  });

  it('answers 401 rather than 403 when unauthenticated', async () => {
    // JwtAuthGuard must run FIRST. A 403 here would mean the registration order
    // in app.module.ts regressed and RolesGuard is deciding before authentication.
    await http.get('/api/probe/owner-only').expect(401);
    await http.get('/api/probe/owner-or-manager').expect(401);
  });

  it('lets @Public() win over @Roles', async () => {
    await http.get('/api/probe/public-but-owner-only').expect(200);
  });

  it('does not take the role from the token', async () => {
    // bearer() signs the real role. The guard reads request.user, which
    // JwtStrategy.validate() rebuilt from the user row — so this 403 is decided
    // by the database, not the claim. Paired with the token-forgery coverage in
    // auth.e2e-spec.ts, which proves a forged claim is ignored.
    await http.get('/api/probe/owner-only').set('Authorization', bearer(fx.memberA1)).expect(403);
  });
});

describe('ResourceOwnerGuard — manager', () => {
  it('admits a manager to their own team', async () => {
    await http
      .get(`/api/probe/team/${fx.teamAId}`)
      .set('Authorization', bearer(fx.managerA))
      .expect(200);
  });

  it('hides another manager\'s team in the same organization', async () => {
    // The core §11 case. Same org, so nothing but the manager_id predicate
    // separates A from B.
    await http
      .get(`/api/probe/team/${fx.teamBId}`)
      .set('Authorization', bearer(fx.managerA))
      .expect(404);
  });

  it('hides a team in another organization', async () => {
    await http
      .get(`/api/probe/team/${fx.teamCId}`)
      .set('Authorization', bearer(fx.managerA))
      .expect(404);
  });

  it('hides another manager\'s member', async () => {
    await http
      .get(`/api/probe/user/${fx.memberB1.id}`)
      .set('Authorization', bearer(fx.managerA))
      .expect(404);
  });

  it('honours the declared param name', async () => {
    await http
      .get(`/api/probe/team-alt/${fx.teamAId}`)
      .set('Authorization', bearer(fx.managerA))
      .expect(200);
    await http
      .get(`/api/probe/team-alt/${fx.teamBId}`)
      .set('Authorization', bearer(fx.managerA))
      .expect(404);
  });
});

describe('ResourceOwnerGuard — owner', () => {
  it('admits an owner to every team in their organization', async () => {
    await http
      .get(`/api/probe/team/${fx.teamAId}`)
      .set('Authorization', bearer(fx.owner1))
      .expect(200);
    await http
      .get(`/api/probe/team/${fx.teamBId}`)
      .set('Authorization', bearer(fx.owner1))
      .expect(200);
  });

  it('stops the owner bypass at the organization boundary', async () => {
    // The owner bypass is the manager_id predicate only. org_id is checked
    // unconditionally and first (0001_rls.sql), so owner1 cannot reach org 2.
    await http
      .get(`/api/probe/team/${fx.teamCId}`)
      .set('Authorization', bearer(fx.owner1))
      .expect(404);
    await http
      .get(`/api/probe/user/${fx.memberC1.id}`)
      .set('Authorization', bearer(fx.owner1))
      .expect(404);
  });
});

describe('ResourceOwnerGuard — member', () => {
  it('admits a member to their own team', async () => {
    // A member's slice equals their manager's — the manager_id self-reference
    // invariant, with no role branch in the policy.
    await http
      .get(`/api/probe/team/${fx.teamAId}`)
      .set('Authorization', bearer(fx.memberA1))
      .expect(200);
  });

  it('hides another manager\'s team and another org\'s team from a member', async () => {
    await http
      .get(`/api/probe/team/${fx.teamBId}`)
      .set('Authorization', bearer(fx.memberA1))
      .expect(404);
    await http
      .get(`/api/probe/team/${fx.teamCId}`)
      .set('Authorization', bearer(fx.memberA1))
      .expect(404);
  });

  it('hides another manager\'s member from a member', async () => {
    await http
      .get(`/api/probe/user/${fx.memberB1.id}`)
      .set('Authorization', bearer(fx.memberA1))
      .expect(404);
  });

  it('admits a member to a TEAMMATE — deliberately, not a leak', async () => {
    // This 200 is the guard's actual contract: "inside your tenant slice", not
    // "belongs to you". The leaderboard (CLAUDE.md §4) and the relay chain (§9)
    // both require a member to see teammates, so narrowing this to a self-only
    // check would break both features.
    //
    // It is also exactly why passing this guard does NOT authorize a write: every
    // teammate passes it. See "Phase 2 write-authorization constraint" in
    // PROGRESS.md before adding any member-writable route.
    await http
      .get(`/api/probe/user/${fx.memberA2.id}`)
      .set('Authorization', bearer(fx.memberA1))
      .expect(200);
  });

  it('admits a member to their own manager', async () => {
    // A manager's manager_id is their own id, so they fall inside their members'
    // slice. Needed for "who currently holds this task" to render a name.
    await http
      .get(`/api/probe/user/${fx.managerA.id}`)
      .set('Authorization', bearer(fx.memberA1))
      .expect(200);
  });

  it('hides the owner from a member', async () => {
    // An owner's manager_id is NULL, which matches no member's predicate.
    await http
      .get(`/api/probe/user/${fx.owner1.id}`)
      .set('Authorization', bearer(fx.memberA1))
      .expect(404);
  });
});

describe('ResourceOwnerGuard — non-disclosure', () => {
  it('returns byte-identical responses for cross-tenant and nonexistent ids', async () => {
    // The whole point of 404-never-403. If these differ in status, body, or any
    // header a client can read, an id-guessing attacker can enumerate which rows
    // exist in other tenants — the §1 disclosure this guard exists to prevent.
    const crossTenant = await http
      .get(`/api/probe/team/${fx.teamBId}`)
      .set('Authorization', bearer(fx.managerA));
    const nonexistent = await http
      .get(`/api/probe/team/${randomUUID()}`)
      .set('Authorization', bearer(fx.managerA));

    expect(crossTenant.status).toBe(404);
    expect(nonexistent.status).toBe(404);
    expect(crossTenant.body).toEqual(nonexistent.body);
  });

  it('returns 404 for a malformed id, not 500', async () => {
    // Checked before the query. A 500 here would mean the uuid cast reached
    // Postgres and errored, which distinguishes "wrong shape" from "not yours"
    // and leaks that the id space is uuid-shaped.
    await http
      .get('/api/probe/team/not-a-uuid')
      .set('Authorization', bearer(fx.managerA))
      .expect(404);
    await http
      .get('/api/probe/team/1')
      .set('Authorization', bearer(fx.managerA))
      .expect(404);
    // SQL metacharacters in the param: rejected by shape before any query.
    await http
      .get(`/api/probe/team/${encodeURIComponent("' OR 1=1 --")}`)
      .set('Authorization', bearer(fx.managerA))
      .expect(404);
  });

  it('requires authentication before disclosing anything', async () => {
    // 401, not 404 — the resource check must not run for an anonymous caller.
    await http.get(`/api/probe/team/${fx.teamAId}`).expect(401);
  });

  it('rejects a token for a user who no longer exists', async () => {
    const token = bearer(fx.managerA);
    const teamId = fx.teamAId;
    await truncateAll();
    await http.get(`/api/probe/team/${teamId}`).set('Authorization', token).expect(401);
  });
});
