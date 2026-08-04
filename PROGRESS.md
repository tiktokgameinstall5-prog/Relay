# Build Progress — Relay

Update this file at the end of every session, and re-read it at the start of the next one
(along with CLAUDE.md). This file — not the chat history — is the record of what's done.

## Current phase
Phase 1 — Auth & Tenancy (in progress — database foundation done, API not started)

## Phase checklist

- [ ] Phase 1 — Auth & Tenancy
  - [x] Postgres provisioned, two-role security model (`relay_migrator` / `relay_app`)
  - [x] Schema: organization, user, team, refresh_token, audit_log
  - [x] Row-level security policies on every tenant-scoped table (ENABLE + FORCE)
  - [x] DB-layer isolation proof — 34 tests, Manager A cannot reach Manager B
  - [ ] Owner self-signup + org creation
  - [ ] JWT strategy, TenantContext, interceptor + three guards
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

## Log

<!-- Add one entry per session, most recent on top -->

### 2026-08-03

**Commits this session (3):**

| SHA | Summary |
|---|---|
| `5f4bea8` | chore: initial scaffold — monorepo, NestJS app skeleton, env template, Claude settings |
| `afa3ad0` | Phase 1: schema, RLS policies, and the DB-layer isolation proof |
| `9cca1ed` | fix(web): point Tailwind at the prototype so utilities are generated |

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

- **Git identity is still the placeholder** `Relay Dev <relay-dev@relay.local>` on all three
  commits. No real identity exists in global config, local config, or the spec doc metadata.
  Needs a real name/email; existing commits can be rewritten with `git filter-branch` or
  `git rebase` while nothing is pushed.
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
