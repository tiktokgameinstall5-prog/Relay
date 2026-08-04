# Build Progress — Relay

Update this file at the end of every session, and re-read it at the start of the next one
(along with CLAUDE.md). This file — not the chat history — is the record of what's done.

## Current phase
Phase 1 — Auth & Tenancy (in progress — Owner signup/login/JWT done, provisioning not started)

## Phase checklist

- [ ] Phase 1 — Auth & Tenancy
  - [x] Postgres provisioned, two-role security model (`relay_migrator` / `relay_app`)
  - [x] Schema: organization, user, team, refresh_token, audit_log
  - [x] Row-level security policies on every tenant-scoped table (ENABLE + FORCE)
  - [x] DB-layer isolation proof — 34 tests, Manager A cannot reach Manager B
  - [x] Owner self-signup + org creation
  - [x] JWT strategy + `/me` (TenantContext type, DbService.withTenant, JwtAuthGuard)
  - [x] Login rate limiting (email+IP, 5 / 15 min)
  - [ ] TenantContext interceptor + remaining two guards (RolesGuard, ResourceOwnerGuard)
  - [ ] Manager provisioning (Owner-only, passcode/invite)
  - [ ] Member provisioning (Manager/Owner, scoped to team)
  - [ ] HTTP-layer isolation test (the §11 gate — DB layer alone is only half)
- [ ] Phase 2 — Workflow Engine (core)
  - [ ] task_step chain model
  - [ ] forward / complete actions
  - [ ] live "who currently holds this task" status
- [ ] Phase 3 — Content
  - [ ] text / file / video attachments
  - [ ] lossless download verified
- [ ] Phase 4 — Scheduling & Notifications
- [ ] Phase 5 — Rankings & Reporter workflow, time-tracking analytics
- [ ] Phase 6 — Polish (audit log views, quotas, 2FA, mobile pass)

## Production hardening TODO (must be resolved before launch)

Items accepted as trade-offs **only because of dev-environment constraints**. None of these
are permanent design decisions. Each must be closed before the first production deploy.

### 1. Replace the `relay_migrator` auth-lookup policy with a dedicated definer role

**Status:** open. **Blocks:** production launch. **Owner:** needs human review (CLAUDE.md §12).

`0003_auth_lookup_policy.sql` grants `relay_migrator` a `SELECT`-only RLS policy on `"user"`
so the pre-auth login lookup can read a row before any tenant context exists. This works and
is scoped three ways (one role, one command, one table), but it is **not the tightest design
available.**

**The tighter design:** a dedicated `NOLOGIN` role holding `BYPASSRLS` that owns *only*
`auth_lookup_by_email` and `auth_lookup_by_id`. That confines the bypass to those two function
calls instead of extending it to anyone holding `relay_migrator` credentials, and lets `0003`
be dropped entirely.

**Is superuser available in production to do this? Yes — on every hosting option considered:**

| Target | Superuser? | Can create a `BYPASSRLS` role? |
|---|---|---|
| Self-hosted Postgres (VM/Docker) | Yes, real `postgres` superuser | Yes, directly |
| AWS RDS / Aurora | No real superuser (`rdsadmin` is AWS-only) | Yes — `rds_superuser` can set `BYPASSRLS` on PG 16+ |
| Azure Database for PostgreSQL | No | Yes on PG 16+; **no** on PG 15 and below (`azure_pg_admin` cannot grant it) |
| Managed (Supabase / Neon / etc.) | Varies | Verify per provider before committing |

Two facts make this straightforwardly achievable:

- **PostgreSQL 16 relaxed the rule.** Through PG 15, creating a `BYPASSRLS` role required true
  superuser. From PG 16, any role that *itself* holds `BYPASSRLS` plus `CREATEROLE` can grant
  it. We target PG 17, so a managed provider's admin role is sufficient — real superuser is
  not required.
- **The privileged step already exists.** `bootstrap.sql` is already documented as
  "run ONCE per server, as a superuser" and already creates both roles. Adding the definer role
  there introduces no new privileged step and no new operational burden — it extends a file
  that is already run with elevated rights.

**Why it wasn't done locally:** not impossibility — a missing credential. The local PG 17.10
server *does* have a `postgres` superuser role; we do not have its password in this
environment. Probed and confirmed as `relay_migrator`:
`rolsuper=false, rolcreaterole=false, rolbypassrls=false`, and
`CREATE ROLE ... NOLOGIN BYPASSRLS` → `permission denied to create role`.

**Definition of done:** definer role added to `bootstrap.sql`; function ownership transferred
to it; `0003` policy dropped in a new migration (never by editing `0003`); `db:check` extended
to assert the definer role is `NOLOGIN` and owns nothing but those two functions; the existing
`auth.e2e-spec.ts` regression block still green (it already pins that the definer lookups did
not become a general bypass).

### 2. `.env` secrets are dev-generated

`JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` and both role passwords were generated locally.
Production needs freshly generated secrets from a secret manager, never carried over from dev.

## Log

<!-- Add one entry per session, most recent on top -->

### 2026-08-04

**Owner auth: signup, login, JWT strategy, `/me`** — Phase 1 build-order item 1.

**What was built:**

- `src/config/` — `@nestjs/config` wiring. `appEnv()` centralises the single non-null
  assertion so no other file needs one. Env validation now also checks JWT TTL *format*,
  which is what makes the `SignOptions['expiresIn']` cast honest rather than hopeful.
- `src/db/db.service.ts` — the enforcement point. No method hands out a raw connection:
  `withTenant(ctx, fn)` opens a transaction, sets the three `app.*` session variables with
  `set_config(..., true)` (transaction-local, so a pooled connection cannot leak context to
  the next request), and commits or rolls back. `withoutTenant()` always rolls back.
  `onModuleInit` refuses to boot if the runtime role holds BYPASSRLS.
- `src/auth/` — signup, login, `LoginThrottlerGuard`, `JwtStrategy`, `JwtAuthGuard`
  (global, with a `@Public()` opt-out), `/me`.
- Migrations `0002` (SECURITY DEFINER lookup functions) and `0003` (the policy that makes
  them work — see below).
- `test/auth.e2e-spec.ts` — 29 tests. `test/manual/smoke.mjs` — hand-run HTTP smoke test.

**The bug worth remembering: `SECURITY DEFINER` does NOT see through `FORCE ROW LEVEL
SECURITY`.** `0002` assumed executing as the table owner would bypass RLS. It does not —
DEFINER switches the *effective role*, and FORCE applies to the owner too, so policies are
evaluated inside the function with no tenant context and match nothing. Login returned 401
for every valid credential. Measured on one committed row, three ways: definer fn without
context → 0 rows; definer fn *with* context → 1 row; migrator direct → 0 rows.

Worse, this had been reported as verified in an earlier session. That check used an email
that did not exist, where 0 rows is also the correct answer — it could not distinguish
"works" from "never returns anything". **A negative test with no positive control proves
nothing.** Fixed by `0003`, and the trade-off it accepts is now a tracked launch blocker
(see "Production hardening TODO" above).

**Other bugs found and fixed:**

- **`writeAudit` could silently discard a signup.** A failed INSERT aborts the whole
  Postgres transaction, and catching the error in JavaScript does not un-abort it — the
  following COMMIT would become a ROLLBACK while still returning 201. Now wrapped in
  `SAVEPOINT` / `ROLLBACK TO SAVEPOINT`. Found by re-reading the code, not by a test.
- **Unquoted `user` in Postgres resolves to `CURRENT_USER`, not the table.** So
  `SELECT count(*) FROM user` returns 1 row of role name and an isolation assertion passes
  vacuously. This was in both a probe and `auth.e2e-spec.ts`. Always quote `"user"`.
- **`tsconfig` TS6 deprecations were masking real type errors** — `baseUrl` (removed, paths
  made relative) and then `rootDir` in `tsconfig.build.json` (set explicitly, build-only,
  because the base config also includes `test/`).

**Design decisions worth remembering:**

- **The JWT is not trusted for scoping.** `JwtStrategy.validate()` re-reads the user row on
  every request and builds the tenant context from the *row*, never the token claims. The
  token's only real claim is "which user am I". Side benefit: deactivation takes effect
  immediately instead of up to `JWT_ACCESS_TTL` later.
- **Login throttling keys on email + IP**, not IP alone. IP-only fails both directions: an
  attacker rotating addresses gets an unlimited budget against one account, and users behind
  one NAT starve each other. The email is normalised then hashed, so the throttler store
  never accumulates plaintext addresses.
- **Timing:** `bcrypt.compare` runs even when no user is found, against a dummy hash built
  once at construction. Unknown-email and wrong-password return byte-identical 401s — pinned
  by a test, since this is the kind of thing a later refactor breaks silently.
- **Login DTO deliberately has no `@MinLength`.** A length rule would return 400 for a short
  password and 401 for a wrong one, splitting the response space and leaking which is which.
- **`/me` whitelists its response fields** so a future column addition cannot leak by default.

**Verification (all green):** `tsc --noEmit` clean · `db:check` 5/5 · `test:isolation` 34/34
· `test:e2e` 63/63 (2 suites) · manual smoke 17/17 against the compiled `dist/main.js` over
real HTTP, confirming `managerId: null` for an Owner and exactly six JWT claims.

**Process note:** the DI boot failure chased for part of this session was self-inflicted — it
only reproduced under `tsx`, which does not emit decorator metadata. The project's real start
path is `nest build`/`nest start`, which does. Explicit `@Inject()` tokens were added anyway
(they make the modules runner-independent), but the lesson is to verify through the project's
actual entry point before debugging a phantom.

**What's next (in order):**

1. TenantContext interceptor (AsyncLocalStorage) + `RolesGuard` + `ResourceOwnerGuard`
2. Manager provisioning + MailerService (console driver) + manager login
3. Team creation + member provisioning
4. Refresh rotation, logout, passcode regeneration, forgot-passcode
5. `isolation.e2e-spec.ts` — the HTTP-layer §11 gate — then `/security-review`

**Still open from this session:**

- **Human review required before this is considered done** (CLAUDE.md §12) — specifically the
  `0003` policy trade-off and the auth module as a whole. AI review is explicitly not
  sufficient here.
- `/security-review` has not been run yet on the auth module.
- Doc fixes from plan §10 still not landed (CLAUDE.md §9 vs prototype design tokens, mobile
  nav gap below `md`, the Phase 2 zero-`task_step` question).

### 2026-08-03

**Commits this session (4):**

| SHA | Summary |
|---|---|
| `5fe597a` | chore: initial scaffold — monorepo, NestJS app skeleton, env template, Claude settings |
| `02973fd` | Phase 1: schema, RLS policies, and the DB-layer isolation proof |
| `cc9b992` | fix(web): point Tailwind at the prototype so utilities are generated |
| `7ff00c4` | docs: log session 1 — scaffold, Phase 1 schema + RLS, Tailwind fix |

<!-- These SHAs were corrected on 2026-08-04. The originally logged values
     (5f4bea8 / afa3ad0 / 9cca1ed) were written before the author-identity
     rewrite, which changed every hash. Pre-rewrite commits are still reachable
     on the `backup-before-author-rewrite` branch if the old hashes need tracing. -->

**What was done:**

- **Scaffold** (`5f4bea8`) — npm-workspaces monorepo (`apps/api`, `apps/web`), NestJS
  skeleton, `.gitignore`, `.env.example`, and `.claude/settings.json` deny rules for
  `.env`/secrets and outbound network calls (CLAUDE.md §12).

- **Database + isolation foundation** (`afa3ad0`) — the substance of the session:
  - PostgreSQL 17.10 installed and running as a Windows service.
  - Two Postgres roles per the plan: `relay_migrator` owns the schema and runs DDL and is
    never used at runtime; `relay_app` is the runtime role with DML grants only, no
    ownership, and explicitly `NOBYPASSRLS`. Provisioned by `src/db/scripts/bootstrap.sql`
    (superuser, run once — deliberately outside the migration runner, which connects as
    `relay_migrator` and by design cannot create roles).
  - `npm run db:check` replaces the old db:up/db:down and asserts the security contract
    itself: app role connects, is not superuser, has no BYPASSRLS, owns no tables. It exits
    non-zero with "Tenant isolation cannot be trusted until these pass."
  - Migration `0000_init.sql` — organization, user, team, refresh_token, audit_log.
  - Migration `0001_rls.sql` — policies on every tenant table with both `ENABLE` and
    `FORCE ROW LEVEL SECURITY`, driven by three transaction-local session variables
    (`app.current_org_id`, `app.current_role`, `app.current_manager_id`).
  - 34-test suite `test/rls.e2e-spec.ts`, all passing (34/34, ~1.4s).

- **UI visible on localhost** (`9cca1ed`) — Vite dev server on `http://localhost:5173`
  rendering the prototype, wired via `.claude/launch.json`. Tailwind was generating zero
  utility classes; root cause was that Tailwind 4 declares content sources in CSS with
  `@source` (not a JS config), and the prototype lives above `apps/web`. Fixed with
  `@source '../../../workspace-relay-prototype.jsx'` — compiled CSS went 4,659 → 18,916
  bytes. Relay chain verified rendering: 4 avatars, 3 connecting arrows, pulsing active dot
  in `#0073EA`, per-step durations in IBM Plex Mono.

**Design decisions worth remembering (these shaped the code):**

- **`manager_id` self-reference.** Owner = NULL, Manager = own id, Member = manager's id.
  Makes every scoped query and every RLS policy one uniform predicate with no `CASE` on
  role. Enforced by CHECK constraint `user_manager_id_invariant`.
- **`FORCE ROW LEVEL SECURITY` applies to the table owner too.** Consequence: test fixtures
  cannot be seeded by the migrator directly — they are created through `relay_app` with a
  tenant context, exactly the way production creates them. The seed path and the real path
  therefore cannot drift apart.
- **`RETURNING` performs an implicit SELECT.** So `INSERT ... RETURNING id` on `audit_log`
  as a manager fails RLS even though the INSERT is permitted (SELECT is owner-only).
  Audit writes must be fire-and-forget. Documented in `0001_rls.sql`.
- **Every policy is org-scoped first**, so even the Owner bypass stays inside one
  organization — "owner" never means "sees everything", only "sees everything in one tenant".
- **`current_setting(..., true)` returns NULL when unset**, and comparison to NULL is false,
  so a connection with no tenant context sees zero rows. The failure mode is an empty
  result, not a breach.

**Isolation test result — 34/34 passing.** Coverage:
zero-rows-by-exact-primary-key (the ID-guessing attack); UPDATE/DELETE report `rowCount 0`
and the row is then verified unchanged from a context that *can* see it; cross-tenant INSERT
raises rather than silently no-ops; Owner scope stops at the org boundary; positive controls
(without these, a policy rejecting everything would pass the whole negative half);
no-context-fails-closed; pooled-connection leak check proving `set_config(..., true)` is
transaction-local; audit_log append-only; and the schema invariants isolation depends on.

The suite was **sabotage-tested** — dropping `FORCE` on one table aborted the run via the
global-setup guard, which refuses to run unless RLS is both enabled and forced. So it is
capable of failing; it is not green by accident.

**What's next (in order):**

1. Owner signup + login + JWT strategy (`/auth/owner/signup`, `/auth/owner/login`, `/me`)
2. TenantContext (AsyncLocalStorage) + TenantTransactionInterceptor + the three guards
   (JwtAuthGuard → RolesGuard → ResourceOwnerGuard)
3. Manager provisioning + MailerService (console driver) + manager login
4. Team creation + member provisioning
5. Refresh rotation, logout, passcode regeneration, forgot-passcode, throttling
6. `isolation.e2e-spec.ts` — the HTTP-layer gate — then `/security-review`

**Deferred / known issues:**

- **Git identity — resolved.** All commits now carry a real author identity. The rewrite
  changed every SHA; pre-rewrite history is preserved on the
  `backup-before-author-rewrite` branch. Keep that branch until the work is pushed
  somewhere durable, then it can be deleted.
- **Relay chain check-mark icons (Phase 2 note).** Completed steps should show a
  `CheckCircle2` badge (prototype line 157), but a DOM query found zero matching SVGs.
  Either only pending/active steps were present on the task inspected, or the Lucide class
  name differs from what was queried. Not investigated — parked for Phase 2 per decision
  this session.
- **Migration re-baselining.** After editing an already-applied migration, the checksum
  guard fired (correct behaviour) and was cleared with `TRUNCATE _migration` + re-migrate.
  That is safe **only** because nothing is deployed. Once Phase 1 ships, schema changes need
  a new migration file, never an edit to an applied one.
- **`refresh_token` deliberately has no RLS** — rows are found only by SHA-256 of a token the
  client presents, `/auth/refresh` runs before any tenant context exists, and there is no
  tenant predicate RLS could express. Documented in `0001_rls.sql` rather than silently
  omitted.
- **Doc fixes from plan §10 not yet landed** — CLAUDE.md §9 vs prototype design-token
  disagreement, the mobile nav gap below `md`, and the Phase 2 open question about whether a
  task can exist with zero `task_step` rows when an Owner assigns to a Manager.
- **Human review still required** before Phase 1 is considered done — CLAUDE.md §12 says AI
  review is explicitly not sufficient for auth, authorization, or tenant-isolation code.
