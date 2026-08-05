/**
 * TenantContextInterceptor over real HTTP, against the real database.
 *
 * What is actually at stake: services now call db.tx() with no context argument,
 * so the context has to be genuinely ambient and genuinely per-request. Two ways
 * that can go wrong, both silent:
 *
 *   1. No scope reaches the handler at all, so every tx() throws. Caught by the
 *      "handler sees the scope" tests — verified by sabotage (removing the scope
 *      fails 10 of these 14). What they do NOT catch is the interceptor being
 *      rewritten to subscribe outside the scope, because Nest 11 binds the async
 *      context itself; see tenant-context.interceptor.ts's header.
 *   2. The scope leaks between requests on a reused pooled connection. Symptom:
 *      request N+1 reads request N's tenant — a cross-tenant data leak that no
 *      single-request test would notice. Caught by the sequential-requests test,
 *      the HTTP-level analogue of rls.e2e-spec.ts's connection-reuse test.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
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

/** Mirrors main.ts, plus the test-only probe routes. */
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

describe('scope establishment', () => {
  it('gives the handler the caller\'s context', async () => {
    const res = await http
      .get('/api/probe/scope')
      .set('Authorization', bearer(fx.managerA))
      .expect(200);

    // Null if no scope reached the handler at all. It does NOT distinguish the
    // interceptor's explicit-subscribe form from the naive one — Nest 11 binds
    // the async context itself, so both work. See the interceptor's header.
    expect(res.body.scope).toEqual({
      orgId: fx.org1Id,
      role: 'manager',
      managerId: fx.managerA.id,
    });
  });

  it('derives the context from the database row, not the token', async () => {
    // bearer() signs managerId into the payload, but JwtStrategy ignores it and
    // re-reads the row. An owner's manager_id is NULL — if the token were
    // trusted this would still be whatever was signed.
    const res = await http
      .get('/api/probe/scope')
      .set('Authorization', bearer(fx.owner1))
      .expect(200);

    expect(res.body.scope).toEqual({
      orgId: fx.org1Id,
      role: 'owner',
      managerId: null,
    });
  });

  it('reaches Postgres as the three session variables', async () => {
    const res = await http
      .get('/api/probe/db-scope')
      .set('Authorization', bearer(fx.memberA1))
      .expect(200);

    expect(res.body).toEqual({
      org_id: fx.org1Id,
      role: 'member',
      // A member's tenant key is their manager's id (CLAUDE.md §1).
      manager_id: fx.managerA.id,
    });
  });

  it('survives across two separate tx() calls in one request', async () => {
    const res = await http
      .get('/api/probe/db-scope-twice')
      .set('Authorization', bearer(fx.managerB))
      .expect(200);

    expect(res.body).toEqual({ first: fx.org1Id, second: fx.org1Id });
  });
});

describe('per-request isolation', () => {
  it('does not leak one request\'s scope into the next', async () => {
    // Sequential and deliberately so: a leak through a reused pooled connection
    // needs the second request to run after the first has released it.
    const a = await http
      .get('/api/probe/db-scope')
      .set('Authorization', bearer(fx.managerA))
      .expect(200);
    const c = await http
      .get('/api/probe/db-scope')
      .set('Authorization', bearer(fx.managerC))
      .expect(200);

    expect(a.body.manager_id).toBe(fx.managerA.id);
    expect(c.body.manager_id).toBe(fx.managerC.id);
    // Different organizations entirely — org2 must not inherit org1.
    expect(c.body.org_id).toBe(fx.org2Id);
    expect(c.body.org_id).not.toBe(a.body.org_id);
  });

  it('keeps concurrent requests from different tenants separate', async () => {
    // AsyncLocalStorage's actual job. In-flight overlap is where a module-level
    // "current context" variable would pass every other test and fail this one.
    const [a, b, c] = await Promise.all([
      http.get('/api/probe/db-scope').set('Authorization', bearer(fx.managerA)),
      http.get('/api/probe/db-scope').set('Authorization', bearer(fx.managerB)),
      http.get('/api/probe/db-scope').set('Authorization', bearer(fx.managerC)),
    ]);

    expect(a.body.manager_id).toBe(fx.managerA.id);
    expect(b.body.manager_id).toBe(fx.managerB.id);
    expect(c.body.manager_id).toBe(fx.managerC.id);
  });

  it('scopes the rows a manager can see to their own team', async () => {
    // The CLAUDE.md §11 check, through the interceptor rather than direct SQL:
    // managerA's slice is exactly {managerA, memberA1, memberA2}.
    const res = await http
      .get('/api/probe/visible-users')
      .set('Authorization', bearer(fx.managerA))
      .expect(200);

    expect(new Set(res.body.ids)).toEqual(
      new Set([fx.managerA.id, fx.memberA1.id, fx.memberA2.id]),
    );
    for (const hidden of [fx.owner1, fx.managerB, fx.memberB1, fx.managerC, fx.memberC1]) {
      expect(res.body.ids).not.toContain(hidden.id);
    }
  });

  it('scopes an owner to their own organization', async () => {
    const res = await http
      .get('/api/probe/visible-users')
      .set('Authorization', bearer(fx.owner1))
      .expect(200);

    // Every org-1 user, and nothing from org 2 — the owner bypass is the
    // manager_id predicate, not the org_id one.
    expect(new Set(res.body.ids)).toEqual(
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
    for (const hidden of [fx.owner2, fx.managerC, fx.memberC1]) {
      expect(res.body.ids).not.toContain(hidden.id);
    }
  });
});

describe('routes with no authenticated user', () => {
  it('establishes no scope on a @Public() route', async () => {
    const res = await http.get('/api/probe/public-scope').expect(200);
    expect(res.body.scope).toBeNull();
  });

  it('makes db.tx() throw there rather than query context-free', async () => {
    // Fail loud, not open. A context-free query would return zero rows under
    // FORCE RLS, which a handler could easily read as "no data" instead of
    // "misconfigured".
    await http.get('/api/probe/public-tx').expect(500);
  });

  it('still rejects an unauthenticated call to a protected route', async () => {
    // The interceptor must not have made anything reachable that was not before.
    await http.get('/api/probe/scope').expect(401);
    await http.get('/api/probe/db-scope').expect(401);
  });

  it('still rejects a token for a user who no longer exists', async () => {
    const token = bearer(fx.memberA1);
    await truncateAll();
    await http.get('/api/probe/scope').set('Authorization', token).expect(401);
  });
});

describe('/me after the db.tx() refactor', () => {
  it('returns the caller\'s own row', async () => {
    const res = await http
      .get('/api/me')
      .set('Authorization', bearer(fx.memberA1))
      .expect(200);

    expect(res.body).toMatchObject({
      id: fx.memberA1.id,
      orgId: fx.org1Id,
      role: 'member',
      email: fx.memberA1.email,
      managerId: fx.managerA.id,
      teamId: fx.teamAId,
    });
  });

  it('still leaks no password or passcode hash', async () => {
    const res = await http
      .get('/api/me')
      .set('Authorization', bearer(fx.owner1))
      .expect(200);

    expect(res.body).not.toHaveProperty('password_hash');
    expect(res.body).not.toHaveProperty('passwordHash');
    expect(JSON.stringify(res.body)).not.toContain('$2');
  });
});
