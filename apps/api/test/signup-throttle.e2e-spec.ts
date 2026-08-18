/**
 * Signup rate-limit bite test (task #8).
 *
 * Every other e2e spec runs with SIGNUP_THROTTLE_LIMIT lifted to 1_000_000 (see
 * test/helpers/test-env.ts) so the limiter never interferes with provisioning
 * flows. This spec is the one that proves the limiter actually BITES, so it
 * boots its OWN AppModule with the limit set low, then restores the env.
 *
 * This works because env.validation.ts reads process.env at ConfigModule load
 * and a freshly-built TestingModule re-validates — so setting the variable
 * before compile() feeds the low limit into this app instance alone. The
 * contract is documented in test/helpers/test-env.ts.
 *
 * ONE test on purpose: the throttler counter is in-memory per app instance and
 * is NOT reset by truncateAll, so a second signup-based test would start with a
 * partially-consumed bucket. The single test asserts both halves of the property
 * that matter.
 *
 * Sabotage check (apply, confirm red, revert):
 *   Remove `@UseGuards(SignupThrottlerGuard)` from AuthController.signup (or let
 *   the SIGNUP_THROTTLE_LIMIT override be ignored) and the "(limit+1)th signup is
 *   refused (429)" assertion goes red — the extra signup returns 201.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { closePools, truncateAll } from './helpers/db';
import { TEST_PASSWORD } from './helpers/seed';

jest.setTimeout(30_000);

/** Low enough to exhaust in a test, high enough to show several succeed first. */
const LOW_LIMIT = 3;

let app: INestApplication;
let http: ReturnType<typeof request>;
let savedLimit: string | undefined;

let seq = 0;
const freshEmail = (label: string) => `${label}.${Date.now()}.${seq++}@acme.test`;

const signup = (email: string) =>
  http
    .post('/api/auth/owner/signup')
    .send({ organizationName: 'Acme', name: 'Ada Owner', email, password: TEST_PASSWORD });

beforeAll(async () => {
  // Override the lifted limit for THIS app only, then build it so ConfigModule
  // validates against the low value.
  savedLimit = process.env.SIGNUP_THROTTLE_LIMIT;
  process.env.SIGNUP_THROTTLE_LIMIT = String(LOW_LIMIT);

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
  // Restore the env so no later spec in this worker inherits the low limit.
  if (savedLimit === undefined) delete process.env.SIGNUP_THROTTLE_LIMIT;
  else process.env.SIGNUP_THROTTLE_LIMIT = savedLimit;

  await app.close();
  await truncateAll();
  await closePools();
});

beforeEach(async () => {
  await truncateAll();
});

describe('POST /api/auth/owner/signup — rate limit', () => {
  it('allows LIMIT signups from one IP then refuses the next (429), without throttling login', async () => {
    // The first LOW_LIMIT signups from this IP succeed.
    for (let i = 0; i < LOW_LIMIT; i++) {
      await signup(freshEmail('owner')).expect(201);
    }

    // The (limit+1)th from the same IP is refused by SignupThrottlerGuard.
    await signup(freshEmail('owner')).expect(429);

    // Login lives in a DIFFERENT named throttler bucket, so an exhausted signup
    // bucket must not touch it: a bad-credentials login is still reached and
    // returns the ordinary 401, not 429. This pins the @SkipThrottle wiring —
    // a ThrottlerGuard evaluates every registered throttler, so without the
    // per-route skips the buckets would bleed into each other.
    await http
      .post('/api/auth/login')
      .send({ email: freshEmail('nobody'), password: 'WrongHorse!9xy' })
      .expect(401);
  });
});
