# Build Progress — Relay

Update this file at the end of every session, and re-read it at the start of the next one
(along with CLAUDE.md). This file — not the chat history — is the record of what's done.

## Current phase
Phase 1 — Auth & Tenancy (in progress — Owner + Manager + Member provisioning and team
creation done; the HTTP-layer isolation gate across all routes, task #9, is next)

## Phase checklist

- [ ] Phase 1 — Auth & Tenancy
  - [x] Postgres provisioned, two-role security model (`relay_migrator` / `relay_app`)
  - [x] Schema: organization, user, team, refresh_token, audit_log
  - [x] Row-level security policies on every tenant-scoped table (ENABLE + FORCE)
  - [x] DB-layer isolation proof — 34 tests, Manager A cannot reach Manager B
  - [x] Owner self-signup + org creation
  - [x] JWT strategy + `/me` (TenantContext type, DbService.withTenant, JwtAuthGuard)
  - [x] Login rate limiting (email+IP, 5 / 15 min)
  - [x] TenantContext interceptor + ambient `db.tx()` (awaiting human review, §12)
  - [x] RolesGuard + ResourceOwnerGuard (awaiting human review, §12)
  - [x] Manager provisioning (Owner-only, passcode/invite) + first login (awaiting human review, §12)
  - [x] Member provisioning + team creation (Manager/Owner, scoped to team) (awaiting human review, §12)
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

### 2. Require TLS on database connections (`ssl = off` today)

**Status:** open. **Blocks:** production launch (any deploy where API and DB are separate hosts).

The local Postgres runs `ssl = off`. That is currently harmless *only* because the server was
changed to `listen_addresses = 'localhost'` on 2026-08-04 — traffic never leaves the machine,
so there is no wire to sniff. Both mitigations are properties of the dev setup, and neither
survives a real deployment.

In production the API and database sit on different hosts, so every query — including the
bcrypt-verified login path and the `app.current_org_id` context that all tenant isolation
depends on — crosses a network. Unencrypted, that is credentials and tenant identifiers in
plaintext.

**Definition of done:** server has `ssl = on` with a real certificate (managed providers such
as RDS supply one); connection strings use `sslmode=verify-full` — **not** `require`, which
encrypts but does not authenticate the server and so still allows a MITM — with the CA bundle
pinned; `env.validation.ts` refuses to boot when `NODE_ENV=production` and `DATABASE_URL`
lacks `sslmode=verify-full`, so this cannot regress silently the way an ops-only setting can.

**Related, already done (dev only):** `listen_addresses` was `'*'` (installer default), binding
every interface. Now `'localhost'`. Config backed up at
`C:\Program Files\PostgreSQL\17\data\postgresql.conf.bak-20260804`. That file is outside the
repo and therefore outside version control — a production deploy must set this through the
provider's config management, not by hand.

### 3. `.env` secrets are dev-generated

`JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` and both role passwords were generated locally.
Production needs freshly generated secrets from a secret manager, never carried over from dev.

## Phase 2 write-authorization constraint (read before adding any member-writable route)

**Status:** open by design, not a bug. **Found:** 2026-08-04, during `/security-review` of
the auth module. **Not currently exploitable** — no member-writable route exists yet.

**RLS cannot distinguish a member from a manager on writes, and never will.** In
`0001_rls.sql` the `user` and `team` policies are `FOR ALL` with a single predicate:

```sql
org_id = app_current_org_id()
AND (app_current_role() = 'owner' OR manager_id = app_current_manager_id())
```

There is no member branch, and that is deliberate — the `manager_id` self-reference
invariant (owner NULL / manager own id / member → manager) is what lets one uniform
predicate serve all three roles with no `CASE`. But it means a member's slice is *identical*
to their manager's, and `0001_rls.sql:131` grants `relay_app` `UPDATE, DELETE` on `"user"`
and `team` for every session regardless of role. So at the database layer, a member session
can UPDATE or DELETE a teammate's row.

**Consequence for the guards:** `ResourceOwnerGuard` answers "is this row inside your tenant
slice", which is the correct contract for *reads* — the leaderboard (CLAUDE.md §4) and the
relay chain (§9) both require a member to see teammates, which is why
`memberA1 → memberA2.id = 200` is pinned as a test rather than treated as a leak. That same
answer is **insufficient for writes.** Write authorization cannot be delegated to RLS and
cannot be delegated to `ResourceOwnerGuard` either.

**Where write authorization goes instead:** inside the writing statement, as a predicate on
the row's own business state. For the relay forward (§2 — "only the member at the active
step can act"):

```sql
UPDATE task_step SET status = 'completed', completed_at = now()
 WHERE id = $1 AND assigned_user_id = $2 AND status = 'active'
```

Zero rows affected is the rejection (403/409). This placement is not a style preference —
guards run in a *separate transaction* from the handler's write, so a guard-based check is a
check-then-act race: two members could both pass it and both forward the same step. The row
lock makes the double-forward impossible rather than merely unlikely.

**Do not "fix" this by adding a member branch to the RLS policy.** That would break the
read contract the leaderboard and relay chain depend on. The layers are: RLS = tenancy,
guard = "may you address this row at all", the writing statement = "may you do *this* to it".

## Log

<!-- Add one entry per session, most recent on top -->

### 2026-08-16 — Team creation + member provisioning + role-neutral first login (task #7 complete)

Three routes shipped: `POST /api/auth/teams` (Owner or Manager), `POST /api/auth/members`
(Owner or Manager), and the canonical `POST /api/auth/first-login` for **both** managers and
members. `manager/first-login` from task #6 stays as a thin deprecated alias so the existing
web client keeps working; both call one `AuthService.firstLogin`.

**Two forks resolved without asking, per the autonomous directive — both are the more
CLAUDE.md-consistent reading.**

*Fork A — first login is role-neutral.* Member activation is why the passcode flow had to
generalise past managers. The route is `@Public()` (the caller has no token yet) and the invite
link carries no role, so the role cannot come from the request — `firstLogin` reads it from the
user row and uses a fail-closed allow-list `role IN ('manager', 'member')`; the audit action is
`${row.role}.first_login`. An Owner never has a passcode (they self-sign-up), so they are outside
the allow-list by construction. Narrowing that allow-list back to `role = 'manager'` is
**SABOTAGE #A** — it reddens all six member-activation tests (confirmed, reverted).

*Fork B — who may name the target manager.* `resolveTargetManagerId` centralises it: a Manager
may omit `managerId` and may **not** name another (a requested id ≠ their own is a 400, caught
before any DB work); an Owner **must** name one (they have no team of their own). This is the
same shape for teams and members.

**The RLS write-path asymmetry is the security core of this task, and it is not symmetric with
reads.** On a Manager session the team/member INSERT's `WITH CHECK` forces the new row's
`manager_id` to the manager's own id, so a manager physically cannot create cross-manager rows.
On an **Owner** session the owner branch of the policy permits *any* `manager_id` in the org —
so `WITH CHECK` alone does **not** stop an Owner from naming a manager in **another** org. The
only thing that does is the service's RLS-scoped lookup
`SELECT id FROM "user" WHERE id = $1 AND role = 'manager' AND status = 'active'`: the foreign
manager's row is invisible under the owner's tenant context, so the lookup returns zero rows and
the request 400s ("no such manager in your organization") instead of creating an org-1 team owned
by an org-2 manager. That lookup is load-bearing isolation code, not a friendly validation.

**SABOTAGE #C therefore targets that lookup in `createTeam`** — and running it surfaced a real
weakness in the test that was supposed to prove it. The original cross-org test used `managerC`,
who is seeded **with** an active team. Removing the guard did not produce the 201 breach the test
claimed; it produced a **409**, because the second active-team INSERT trips the partial unique
index `team_manager_id_active_key` (enforced below RLS, so it sees across orgs) before the breach
lands. The test still failed-closed (409 ≠ the expected 400, so it caught the removal) but it was
not exercising the breach it documented. Fixed by pairing it with a companion test whose target
is a **teamless** manager in the other org (provisioned via `owner2`): with no active team the
unique index never fires, so removing the guard yields the genuine **201** — an org-1 team owned
by an org-2 manager — and the leaked-row assertion bites. Both halves were confirmed red under
the sabotage and green with the guard restored. Lesson recorded in the spec header: an isolation
test that only trips a *unique-index conflict* is testing the wrong backstop; force the path where
the breach actually writes a row.

**Why #C lives in `createTeam` and not `createMember`.** `createMember` has the same manager
lookup, but there it is defence-in-depth: a second RLS-scoped guard (the active-team lookup
`SELECT id FROM team WHERE manager_id = $1 AND status = 'active'`) also fails closed for a foreign
manager, so removing the first guard downgrades the cross-org case to a 409/400, never a 201.
`createTeam` has no such second guard — the manager lookup is the whole isolation boundary there.

**SABOTAGE #B — the `@Roles('owner','manager')` guard on both new routes.** Removing it does
**not** immediately breach (a member falls through to `resolveTargetManagerId` + the manager
lookup and gets a 400, not a 201) — but it drops the correct **403** refusal, so the two
"refuses memberA1 (403)" tests redden as 400. Worth keeping the nuance: the guard is what makes
the product *refuse* the action cleanly rather than let it fail deep in the service; defence in
depth means removing one layer changes the status code, not the outcome. Confirmed, reverted.
All three sabotages reverted; `grep -rn SABOTAGE` shows only the documented test-header comments.

**One active team per manager** is the partial unique index `team_manager_id_active_key ON team
(manager_id) WHERE status = 'active'`; a second active team (for a Manager creating their own, or
an Owner naming a manager who already has one) raises 23505 → 409. The manager is set as a member
of their own team (`team_id` on their user row) on creation, matching the seed fixtures and the
dashboards that read team membership.

**Provisioning throttle and the not-yet-activated manager both carry over from #6 unchanged:**
`OwnerThrottlerGuard` keys 20/hour on the authenticated user, with `@SkipThrottle({login,
signup})` load-bearing (a `ThrottlerGuard` evaluates every registered throttler); and a
provisioned-but-not-activated manager (`password_hash IS NULL`) still authenticates via a minted
JWT in tests because `JwtStrategy` re-reads the row and only checks `status = 'active'` — which is
what lets "a Manager creates their own team" run without a login round trip.

Verified: `db:check` 5/5, `test:isolation` **34/34** (no regression), `test:e2e` **149/149**
across **6 suites** (was 122/122 in 5; the new suite is `member-provisioning.e2e-spec.ts`,
27 tests), `tsc --noEmit` and `nest build` clean.

Per CLAUDE.md §12 this is authentication/authorization/isolation code and **needs human review
before merge**. `/security-review` has not been run on this module yet — still outstanding for
the whole auth module (tasks #4–#7).

Still deferred to task #8: passcode regeneration by the issuer (§1), refresh-token rotation +
server-side logout, making the inert signup throttle real (env-configurable, not a decorator —
see the #6 note), and SMTP mail. Task #9 is the full HTTP-layer isolation gate across every real
route (its spec file must match the `(isolation|rls)` pattern so `test:isolation` runs it).

### 2026-08-05 (later) — Manager provisioning, mailer, manager first login (task #6 complete)

An Owner can now `POST /api/auth/managers {name, email}`; the manager receives a single-use
passcode by email and activates with `POST /api/auth/manager/first-login
{email, passcode, newPassword}`, after which they log in like anyone else.

**Two spec interpretations recorded here, because both resolve real ambiguities in CLAUDE.md §1.**

*First login is atomic — the password is required, not optional.* §1 says passcodes are
single-use **and** that a manager "may set a permanent password on first login". If setting one
were optional, consuming the passcode would leave the account with no usable credential at all
— permanently locked out with no self-service path back in. Reading "may" as "may choose the
password" rather than "may skip it" resolves the contradiction without inventing a second token
type (a set-password token would have to be refused by every guard everywhere else — scope-
confusion risk for no gain). One request, one transaction: passcode consumed and password set
together, or neither.

*Production refuses to boot with `MAIL_DRIVER=console`.* The console driver renders the whole
message to the log, passcode included — that is the point in development, where there is no
inbox, and exactly why it must not run in production, where it would deposit a live credential
in the log aggregator for every manager and member ever invited. `.env.example` warned about
this in prose; `env.validation.ts` now enforces it. `MAIL_DRIVER=smtp` also refuses to boot
(not implemented — `.claude/settings.json` denies outbound network calls, so an SMTP transport
would ship untested on the invite path). Net effect: production cannot boot at all until task
#8 implements SMTP, which is correct, since production has no mail path yet.

**The login route widened: `/api/auth/owner/login` → `/api/auth/login`,** and
`ownerLogin` → `passwordLogin`. The old `role !== 'owner'` rejection is gone on purpose: after
first login a manager logs in here, and a role check would lock them out permanently. The
property that actually protected the passcode flow was never the role check — it is
`password_hash IS NULL`. A provisioned-but-not-activated manager has no hash, so no password
can ever match and first-login cannot be skipped by guessing one. `auth.e2e-spec.ts` now pins
both halves: a provisioned manager is refused (401, byte-identical to an unknown address), an
activated one is accepted (200, `role: 'manager'` read from the row, never the request).

**Provisioning is throttled at 20/hour keyed on the authenticated Owner,** not the IP —
`OwnerThrottlerGuard` overrides `getTracker()` to key on `request.user.userId`, which
`JwtStrategy.validate()` builds from a fresh DB read rather than from token claims. Note the
`@SkipThrottle({login: true, signup: true})` on that route is load-bearing, not tidiness: a
`ThrottlerGuard` evaluates **every** throttler registered in AppModule, so without the skips
this route would also be capped at the login limit of 5 per 15 minutes.

**Passcodes are bcrypt-hashed, never SHA-256.** 10 chars over a 55-char ambiguity-free alphabet
is ~57 bits — offline-brute-forceable behind a fast hash from a database dump, not behind
bcrypt. §1 only says "hashed at rest"; this is the strict reading, and it reuses the cost
already validated in env. Generation uses `crypto.randomInt(alphabet.length)`, not
`randomBytes(1) % len`, which would bias toward the first `256 % 55` characters.

**Defense-in-depth finding from the sabotage run — worth keeping.** Sabotage #1 (drop
`passcode_used_at IS NULL` from the first-login UPDATE's WHERE clause) failed **nothing**. The
JS guard `row.passcode_used_at !== null` shadows it on sequential replay, so the replay test
stayed green. A concurrency test was added, and even then the sabotage passed — because
`password_hash IS NULL` and `passcode_expires_at > now()` (paired with
`SET passcode_expires_at = NULL`) are each *independently* sufficient to make the update
single-winner. Only removing all three broke it. So the WHERE clause is genuinely three-way
redundant rather than one load-bearing condition. The lesson recorded in the test file: a
sequential replay test does not test a race, and a suite that stays green through a sabotage
is not a suite.

Sabotage #2 (return the passcode in the 201 body) turned out to be caught at **compile time**
by `createManager`'s explicit return type — a stronger guarantee than a runtime test. Verified
that the runtime assertion also bites once the type is widened. The other three behaved as
planned: SHA-256 instead of bcrypt fails 2 tests, removing `@Roles('owner')` fails the
manager/member 403 tests, and putting the passcode in the invite URL fails the URL test. All
reverted; `grep -rn SABOTAGE` is clean.

Migration `0004_passcode_lookup.sql` drops and recreates `auth_lookup_by_email` three columns
wider (`passcode_hash`, `passcode_expires_at`, `passcode_used_at`). Postgres cannot
`CREATE OR REPLACE` a function with a changed `RETURNS TABLE` list, and applied migrations are
checksum-immutable, so a new file was the only route. The hash must reach Node so bcrypt runs
unconditionally — comparing in SQL would reintroduce the timing oracle 0002 exists to avoid.
Ownership stays `relay_migrator`, so 0003's `user_definer_lookup` policy still applies.

Verified: `db:migrate` 0000–0004 applied, `db:check` 5/5, `test:isolation` 34/34,
`test:e2e` **122/122** (5 suites), `tsc --noEmit` and `nest build` clean.

Per CLAUDE.md §12 this is authentication code and **needs human review before merge**.
`/security-review` has not been run on this module yet.

Deferred to task #8 by design: passcode regeneration by the issuer (§1), refresh-token
rotation/logout, and making the signup throttle real — `@Throttle({signup: ...})` on
`POST /api/auth/owner/signup` is currently **inert** because no `ThrottlerGuard` is attached
there; attaching one would immediately fail 13 e2e tests that create more than 10 orgs from
one IP, so the fix is an env-configurable limit rather than a decorator. Member provisioning
and team creation are task #7.


### 2026-08-05 — RolesGuard + ResourceOwnerGuard (task #5 complete)

Closes task #5. `/security-review` ran first and found nothing at HIGH/MEDIUM ≥0.8 — but it
did surface the write-authorization constraint now recorded in its own section above, which
is the reason these guards are scoped to reads.

**`RolesGuard`** — `@Roles('owner')` / `@Roles('owner','manager')`, handler-then-controller
precedence, skips `@Public()`. Throws 403 on mismatch, **not** 404: the caller is
authenticated and the route exists, so we are refusing the *action*, not concealing a
resource. Concealment is the other guard's job, where a row's existence is the secret.

*A route with no `@Roles` is open to every authenticated role, deliberately.* Requiring it
everywhere would mean annotating `/me` with all three, and every future read route likewise.
A list that must name everyone is a list nobody maintains, and an over-broad `@Roles` added
only to satisfy a rule is worse than none — it reads as considered when it was not.

**`ResourceOwnerGuard`** — `@OwnedResource({ table, param })` runs a tenant-scoped existence
probe and 404s on zero rows. Three load-bearing properties:

- **The table name is the only interpolated SQL identifier in the codebase.** Postgres has no
  parameter form for an identifier, so `OWNED_TABLES` is a frozen `as const` map and the
  decorator's `table` is typed to its keys — an arbitrary string is a *compile* error, not a
  runtime injection. The id is bound as `$1`.
- **404, never 403.** A 403 confirms the row exists in someone else's tenant, which is the
  id-guessing disclosure §1 forbids. §11 permits "empty result or 403"; 404 is the stricter
  end. A test asserts cross-tenant and nonexistent responses are byte-identical.
- **Non-uuid params 404 before the query**, so an invalid cast cannot become a 500 that
  distinguishes "wrong shape" from "not yours".

It calls `withTenant()` with an explicit context, not `db.tx()` — guards run before
interceptors, so there is no ambient scope. Noted in the guard header so nobody "fixes" it.

**`memberA1 → memberA2.id = 200` is pinned as a test.** The guard's contract is "inside your
tenant slice", not "belongs to you". The leaderboard (§4) and relay chain (§9) both need
members to see teammates; narrowing this to self-only would break both. Also pinned:
member → own manager = 200 (a manager's `manager_id` is their own id), member → owner = 404
(an owner's is NULL, matching no member predicate).

**Sabotage-tested, four ways, each caught by exactly the right tests:** 403-instead-of-404 →
9 failures; owner-style bypass ignoring `manager_id` → 7; no uuid shape check → 1 (the
malformed-id test alone); `RolesGuard` admitting every role → 3. Verified no `SABOTAGE`
marker survives in `src/` or `test/`.

Verified: `db:check` 5/5, `test:isolation` 34/34 (no regression), `test:e2e` **100/100 across
4 suites** (was 77), `tsc --noEmit` and `nest build` clean.

Still required per CLAUDE.md §12: **human review before merge** — this is authorization and
tenant-isolation logic, and AI review plus a clean `/security-review` is explicitly a first
pass, not an audit.

### 2026-08-04 (later still) — Ambient tenant context (`TenantContextInterceptor` + `db.tx()`)

First half of task #5. Services no longer receive a `CurrentUser` purely to re-derive
scoping: an `AsyncLocalStorage` scope is established per authenticated request and
`db.tx()` reads it. `me.service.ts` is converted as the proof on a real route.
The guards (`RolesGuard`, `ResourceOwnerGuard`) are **not** in this change — still open.

**What AsyncLocalStorage carries is the `TenantContext`, not a `PoolClient`.** A
request-long transaction would pin 1 of the pool's 10 connections across every non-DB
pause in a handler — bcrypt cost 12 on login (~300ms), the mailer in #6, and S3 multipart
video upload in Phase 3, where it would be held open for minutes. Atomicity is per-`tx()`
call, which is the shape the work already has: the Phase 2 relay forward (complete step N,
activate N+1, stamp timestamps, write `audit_log`) is one `tx()`.

**Guards run before interceptors, and that is not configurable.** So the ALS scope is
available to handlers and services but *not* to guards. `ResourceOwnerGuard` will have to
call `withTenant()` with an explicit context — noted here and in `app.module.ts` so nobody
later "fixes" it into a `db.tx()` that would throw. `withTenant()` stays public for that
and for signup, where the org does not exist yet and the transaction *asserts* the context.

**No scope on `@Public()` routes.** `db.tx()` throws there rather than querying
context-free — a context-free query returns zero rows under FORCE RLS, which a handler
could easily read as "no data" instead of "misconfigured". Fail loud, not open.

**Rename recorded here because the migration cannot be edited.** `0001_rls.sql:9` says
"set transaction-locally by TenantTransactionInterceptor". The component shipped as
`TenantContextInterceptor` — it no longer owns a transaction. `migrate.ts` throws when an
applied migration's checksum changes and the checksum is over LF-normalised content, so
even a comment-only edit trips it. Applied migrations are immutable history.

**A plan claim was disproved by sabotage-testing, and the plan has been corrected.** The
plan asserted that the naive `runInTenantScope(ctx, () => next.handle())` loses the scope
before the handler runs (because the Observable body executes on subscription), and that
the new tests catch a refactor back to it. Neither holds on Nest 11: `InterceptorsConsumer`
wraps each step in `defer(AsyncResource.bind(...))` and eagerly calls the terminal handler
inside that bound scope, with an in-source comment saying it is deliberate so
AsyncLocalStorage is inherited. Sabotage run: naive form → **14/14 still passed**; scope
removed entirely → **10 of 14 failed**, so the suite does bite, it just cannot tell those
two forms apart. The explicit-subscribe form still ships — not because a test enforces it,
but because it does not depend on a framework internal that is no part of the
`NestInterceptor` contract. The interceptor header and the spec's header state this
accurately; do not re-add the "a test catches this" claim.

Test scaffolding, both **test-only** and imported by the spec's `TestingModule` rather than
by `AppModule`, so neither can ship: `test/helpers/token.ts` mints an access token for a
seeded user (needed because managers/members have no login route until #6 — not a shortcut
around auth, since `JwtStrategy.validate()` re-reads the row and the only claim that
matters is `sub`), and `test/helpers/probe.module.ts` exposes routes that observe the scope
at both the handler and the *database* level. The DB-level probe is the one that matters: a
scope object the handler can read proves nothing if the session variables end up unset.

Verified: `test:isolation` 34/34 (no regression), `test:e2e` 77/77 across 3 suites,
`tsc --noEmit` clean, `nest build` clean. The `ExceptionsHandler` stack trace in the e2e
output is expected — it is the `public-tx` test asserting `db.tx()` throws.

Still required before merge, per CLAUDE.md §12: **human review** (this is tenant-isolation
logic, AI review is explicitly not sufficient) and `/security-review`. Neither has run.

### 2026-08-04 (later) — Interactive API docs at `/api/docs`

Additive only: no handler logic, no query, no policy changed. It exists so the Owner
signup → login → `/me` chain can be exercised from a browser until the Phase 2 UI lands.

- `src/docs/swagger.ts` — `DocumentBuilder` + `SwaggerModule.setup`. Two options are
  load-bearing rather than cosmetic. `useGlobalPrefix: true`, because Swagger does **not**
  inherit `setGlobalPrefix('api')` and silently mounts at `/docs` without it (caught in the
  browser: `/api/docs` 404, `/docs` 200). And `persistAuthorization: false`, because `true`
  writes the bearer token to `localStorage`, where it outlives the tab.
- `src/auth/dto/api-response.dto.ts` — response classes for `AuthResult` / `MeResponse`.
  Swagger builds schemas from runtime metadata and a TS `interface` emits none, so both
  would document as `{}`. Each class `implements` the real interface, which turns doc drift
  into a compile error. Note `implements` needs a *name*: `AuthResult['user']` is a TS2500,
  hence the one-line `AuthResultUser` alias.

**The docs page is UNAUTHENTICATED and cannot be otherwise.** `SwaggerModule.setup` mounts
Express middleware on the HTTP adapter, so the global `JwtAuthGuard` never sees those
requests — `@Public()` is not involved and could not help. It also enumerates every route,
DTO field, and validation rule. Hence `API_DOCS_ENABLED`, which defaults on outside
production and **off in it**; when false, `setupSwagger()` is simply not called, so the
route does not exist rather than existing and refusing. Verified both ways: enabled →
`/api/docs` 200 and the full signup → Authorize → `/me` 200 flow works in the browser;
`API_DOCS_ENABLED=false` → `/api/docs` and `/docs` both 404 while `/api/me` still 401.
Opting in on production is allowed but logs a `logger.warn`.

**`@nestjs/swagger` is pinned to exactly `11.4.5`, deliberately.** `11.4.6` pins
`js-yaml@5.2.1`, which is inside the GHSA-pm4m-ph32-ghv5 (high) range; `11.4.5` uses
`js-yaml@4.3.0`, outside it. The normal fix would be an `overrides` entry, but **npm 11.3.0
in this environment ignores the `overrides` field entirely** — a deliberately bogus
`"js-yaml": "999.999.999"` override produced no error and no resolution change, and a
from-scratch lockfile regeneration never recorded an `overrides` key. Worth knowing before
anyone reaches for `overrides` again here. Production dependency audit is now clean
(`npm audit --omit=dev` → 0); the remaining 4 moderate are dev-only and pre-existing
(`drizzle-kit` → `esbuild`). Revisit the pin when a `>11.4.6` release moves off js-yaml 5.x.

**Incidental fix, unrelated to Swagger:** `npm run start:dev` was dying with
`Cannot find module dist/main`. `nest-cli.json` sets `deleteOutDir`, but the incremental
`tsconfig.build.tsbuildinfo` sat *beside* `tsconfig.build.json` rather than inside `dist` —
so the wipe removed the output while the cache still claimed every file was emitted, and
watch mode compiled cleanly and wrote nothing. Fixed by pointing `tsBuildInfoFile` into
`dist` so the wipe invalidates the cache it belongs to. Also added an `api` entry to
`.claude/launch.json`.

Left behind: the smoke test created a real org (`Swagger Smoke Test Co`,
`docs-smoke-2026-08-04@relay.test`) in the dev database.

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

**Postgres hardening (dev machine).** Audit of where the database actually runs turned up
`listen_addresses = '*'` — the installer default, binding every network interface with
`ssl = off`. Nothing needed non-local access, so it is now `'localhost'`; confirmed by
`netstat` (`0.0.0.0:5432` → `127.0.0.1:5432`) and by reading the live setting back after a
service restart. `db:check` 5/5, `test:isolation` 34/34, `test:e2e` 63/63 all still pass
afterwards. Config backed up to `postgresql.conf.bak-20260804`. `ssl = off` remains and is
now tracked as launch blocker #2 — harmless while loopback-only, unacceptable once the API
and DB are on separate hosts.

Also verified in that audit: both connection strings point at `localhost:5432`, the server
reports loopback on both ends, `.env` is matched by `.gitignore:7` and has never appeared in
any commit on any branch (`git log --all --full-history`), and no git remote is configured.

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
