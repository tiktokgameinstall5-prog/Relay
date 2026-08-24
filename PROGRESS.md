# Build Progress — Relay

Update this file at the end of every session, and re-read it at the start of the next one
(along with CLAUDE.md). This file — not the chat history — is the record of what's done.

## Current phase
Phase 1 — Auth & Tenancy (code-complete — Owner + Manager + Member provisioning, team
creation, session lifecycle (refresh rotation / logout / passcode regeneration / signup
throttle), and the two-layer §11 isolation gate (DB + HTTP, 59 tests) all done and green.
Remaining before Phase 1 is fully closed: human review of the auth module (§12) and a
`/security-review` pass — both outstanding for tasks #4–#9. Phase 2 (Workflow Engine) is next.)

**Web client — MERGED into `main` (2026-08-24).** Branch `feat/admin-dashboard-ui` (formerly
`feat/phase2-admin-dashboards`) fast-forwarded into `main`; both refs now point at `5537eb3`. It
delivered the read-side admin dashboards (owner Overview / Teams / TeamDetail / Managers, manager
`/team`) over the Phase 1 list endpoints, the public landing page, the RelayChain/StatTile
primitives, and **HttpOnly-cookie session restore-on-load**. The earlier in-memory-token "refresh
signs you out" trade and security-review finding **F4** (refresh token in the body, not a cookie)
are both **closed** — see the 2026-08-23 log. The access token remains **in-memory only**; only the
refresh token gained an HttpOnly cookie. **§12 gate satisfied for THIS merge:** the two
auth/session-touching commits on the branch — `6b8bcca` (the HttpOnly `relay_rt` cookie) and
`89aeb9f` (browser restore-on-load) — got a `/security-review` pass (clean, no findings) AND the
Owner's explicit human review + approval before the merge (2026-08-24 log). Post-merge on main:
`test:isolation` **88/88** (re-run and verified today), `test:e2e` **240/240** (carried from the
branch verification — fast-forward merge, identical tree, only docs-only CLAUDE.md commits on top).
This branch is Phase-1-data UI, NOT the Workflow Engine (Phase 2), which is still unstarted. Still
open (unchanged, separate from this merge): the broader §12 human review + full `/security-review`
of the original Phase 1 auth module (tasks #4–#9).

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
  - [x] Refresh-token rotation + server-side logout + passcode regeneration + real signup throttle (awaiting human review, §12)
  - [x] HTTP-layer isolation test (the §11 gate — DB layer alone is only half) — 25 tests, `http-isolation.e2e-spec.ts`
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

### 2026-08-24 (web tests) — apps/web test runner stood up (Vitest + Testing Library + jsdom); §9 mobile-nav regression test added

Closes the follow-up flagged in the entry below ("no automated test for mobile-nav reachability … standing one up is its own task"). **Non-sensitive** — test tooling + one presentational nav element; touches no auth/authz/isolation/session code, so it ships autonomously (§12). Committed on `main`.

**Test runner.** `apps/web` had no runner (the API side uses Jest; the user asked for Vitest here). Added dev-deps: `vitest ^4.1.11`, `jsdom ^30`, `@testing-library/react ^16.3.2`, `@testing-library/dom ^10`, `@testing-library/user-event ^14`, `@testing-library/jest-dom ^7`. Config lives in `vite.config.ts` (`defineConfig` switched to import from `vitest/config`): `environment:'jsdom'`, `globals:false` (explicit imports), `setupFiles:['./src/test/setup.ts']`, `css:false`, `include:['src/**/*.{test,spec}.{ts,tsx}']`. Setup file registers `@testing-library/jest-dom/vitest` matchers and an `afterEach(cleanup)` (auto-cleanup does not self-register with globals off). Scripts: `test`/`test:watch` in `apps/web`, and a root `test:web` for parity with `test`/`test:e2e`/`test:isolation`.

**Windows gotcha — pool.** The default `forks` pool timed out waiting for the worker to hand-shake ("Failed to start forks worker … Timeout waiting for worker to respond", 60s) in this npm-workspace on Windows. Set `pool:'threads'` — worker threads start reliably. Note this if the API side ever moves to Vitest.

**§9 mobile-nav test — `src/layout/AppShell.test.tsx` (5 tests, green).** Mocks `useAuth` (the context itself isn't exported and its provider does a network bootstrap on mount), renders `AppShell` in a `MemoryRouter` with a layout route + one panel route per known path. Asserts the **mobile tab bar** carries a reachable link for every nav item of every role (owner 5 / manager 4 / member 3), that both navs coexist in the DOM (the §9 fix is that the mobile bar is an *addition*, not a replacement), and walks every owner tab via `userEvent.click` proving each navigates (incl. the last tab, "Reports", the one the manual 390px check confirms is reachable after scroll). Inputs use `userEvent`, never raw `el.value=` (see the signup non-bug note below).

**Two source hooks in `AppShell.tsx` (the only app change):** `data-testid="sidebar-nav"` on the desktop `<nav>` and `data-testid="mobile-nav"` on the mobile tab bar — **essential**, because both navs render the same links (responsive CSS hides one) and an unscoped query would pass off the desktop copy even if the mobile bar were deleted, i.e. it would miss the exact §9 regression. Also upgraded the mobile tab bar from `<div>` → `<nav aria-label="Primary">` (small a11y win: it's now a landmark; block→flex layout unchanged, zero visual diff).

**What this test does NOT prove (documented in its header).** jsdom applies no CSS, runs no media query, and doesn't compile Tailwind — so `md:hidden`/`hidden … md:flex` are inert strings here. The test is a **structural** guard (the mobile nav exists and carries every item, reachable); the **visual** "which nav shows at 390px" behaviour stays the manual browser check recorded in the entry below. The two are complementary, not redundant.

**Signup "empty form" investigation (earlier this session) — NOT a bug, no code change.** A browser-tool form fill (`preview_fill` / programmatic `input.value=`) submits Relay's React forms with an **empty** body: the form passes native validation and POSTs, but every field is `''` (server 400). Root cause is React's per-input value *tracker* — `el.value=` updates the tracker so the subsequent `input` event reads as "no change" and `onChange` never fires. Real keystrokes go through native machinery the tracker registers, so users are unaffected; `@testing-library`'s `userEvent`/`fireEvent.change` use the native setter, so the new test is unaffected too. Recorded in memory (`preview-fill-empty-react-forms`); `Signup.tsx`/`Field.tsx` are correct and untouched.

**Verified:** `npm --workspace apps/web run test` **5/5**, `typecheck` (`tsc --noEmit`, which covers the test file since it's under `src`) clean, `build` clean (1826 modules). API gate unaffected (no backend file touched).

### 2026-08-24 — Workflow-policy edits, security-review + Owner-approved merge of the web branch into main, §9 mobile-nav verification

**Two CLAUDE.md workflow-policy commits (docs-only, both on main):**
- `ef94240` — scoped the §12 review gate: **sensitive** = authentication, authorization,
  RLS/tenant isolation, session/token handling → still require the Owner's explicit human review
  **and** a `/security-review` pass before merge (AI review is NOT sufficient; ambiguous ⇒
  sensitive). **Everything else** (UI, styling, non-sensitive CRUD, bug fixes, refactors) ships
  autonomously once the normal suite (incl. the §11 isolation test) passes — no human-review ask,
  batch several before reporting.
- `5537eb3` — **Speed defaults (non-sensitive work only):** default to Sonnet (escalate to Opus
  only for auth/authz/isolation/session-critical work), terse output, skip redundant exploration,
  batch, never ask approval except for genuine security/auth/isolation risk. Explicitly does NOT
  relax the §12 sensitive gate or the §11 isolation test. `.claude/settings.local.json` now sets
  `"model": "sonnet"` (verified persisted this session).

**`/security-review` of the two auth/session-touching web-branch commits — CLEAN, no findings.**
Ran the review methodology manually over `6b8bcca` (the HttpOnly `relay_rt` refresh cookie on
login/signup/first-login/refresh/logout) and `89aeb9f` (browser session restore-on-load); the
builtin skill's `origin/HEAD...` diff can't run (no remote). Confirmed: cookie is
HttpOnly+Secure+SameSite=Lax+Path=/api/auth/session (tightest scope, only the two routes that read
it); CSRF closed (Lax blocks the cross-site POST cookie, routes are POST-only, state-changing calls
use Bearer, no CORS grant to read the rotated response); anti-oracle preserved (absent token → `''`
→ uniform 401, never 500); logout idempotent 204 and always clears the cookie; refresh DTO
`@IsOptional` allows the browser's empty body while `@IsNotEmpty` + `MaxLength(512)` reject
empty/garbage; rotation + reuse-detection unchanged; access token stays module-scoped (never
storage/state/JS-readable cookie); StrictMode single-refresh via module-scope memoization;
BootSplash prevents a valid-cookie user flashing Landing/login. **One pre-existing note (NOT a
blocker, not introduced here):** the refresh token is still also present in the JSON response body
on the browser (the §6 one-API/two-transport trade for the cookie-less Flutter client), so an XSS
intercepting the in-flight fetch could read it there — mitigated by rotation + reuse-detection.

**Owner-approved, then merged.** The Owner gave explicit human review + approval of `6b8bcca` and
`89aeb9f` (the §12 sensitive gate — the one place pausing is still correct). Fast-forwarded
`feat/admin-dashboard-ui` into `main`; both refs now at `5537eb3`, working tree clean.

**Post-merge test counts on main.** Re-ran the §11 gate on main today: `test:isolation` **88/88**
(2 suites, rls + http-isolation) — verified, not inferred. `test:e2e` **240/240** carried from the
2026-08-23 branch verification: the merge is a fast-forward (identical tree) and the only commits
added on top are docs-only CLAUDE.md edits, so no backend code moved — the count cannot have
changed. Did not re-run the full e2e (redundant given the FF + docs-only delta; speed directive).

**§9 mobile-nav check — PASS, no code change needed.** CLAUDE.md §9 calls the vanishing-sidebar
below `md` out by name ("resize to ~390px and confirm every nav tab is still reachable").
`AppShell.tsx` already implements it correctly: desktop `<aside>` is `hidden … md:flex`; below `md`
a `md:hidden` horizontal `overflow-x-auto` tab bar renders every nav item with `shrink-0`. Verified
live in the browser at 390px on the owner layout (widest, 5 tabs): `aside` computed `display:none`;
all 5 tabs present (Overview, Managers, All teams, All tasks, Reports); tab bar scrollable
(`scrollW 537 > clientW 390`); no tab zero-width/clipped; last tab "Reports" fully in view after
scroll. Data proof via `preview_eval`/`preview_inspect` (more reliable than a screenshot for this);
the optional screenshot couldn't be captured because the Browser pane isn't displayed (compositing
paused) — not a code defect. `/overview` also spot-checked: clean stat tiles + a proper "No teams
yet" empty state with CTA. No polish defect found; did not churn freshly-merged main speculatively.

**Follow-up worth a future session (flagged, not done):** §9 says "keep the test for it," but there
is still **no automated test** for mobile-nav reachability — it's manually re-verified each time.
`apps/web` has no test runner yet; standing one up (vitest + jsdom + testing-library) is its own
task, not "small polish," and touches build config — recorded here rather than done unprompted.

**Left in the dev DB** by the §9 browser check: org `Nav Check Co` (owner
`navcheck-1787555603383@relay.test`).



### 2026-08-23 (web) — feat/admin-dashboard-ui (renamed from feat/phase2-admin-dashboards): read-side admin dashboards + HttpOnly-cookie session restore (F4 closed, restore-on-load no longer deferred)

Branch `feat/admin-dashboard-ui` — **12 commits off main** (merge-base `68883e7`), **not
merged**. **Renamed this session** from `feat/phase2-admin-dashboards`, whose name collided with
CLAUDE.md's Phase 2 (Workflow Engine); this branch is **web admin-dashboard UI over Phase 1 read
endpoints, plus the session-transport hardening**, and does NOT touch the Workflow Engine
(task_step chain, forward/complete, live holder), which is still unstarted. (Note the count: this
is 12 commits, not the "5 + 1" it's easy to remember — the read-side API work and the cookie commit
are on this branch too, not on main.) Grouped:

**API — read-side list endpoints, each shipping its own §11 gate (4 commits):**
- `aa30d32` GET /api/auth/teams + org counts
- `5adf568` GET /api/auth/managers (owner-only)
- `31e4eb6` GET /api/auth/teams/:id/members (@OwnedResource) + gate-header rewrite
- `6b8bcca` **the HttpOnly refresh cookie** on login/signup/first-login/refresh/logout (see below)

**Web — landing, primitives, dashboards (7 commits):**
- `ec244c8` design tokens + format helpers + StatusChip divergence note
- `053db9f` RelayChain + StatTile primitives + landing relay demo data
- `abe37fc` public landing page at "/" + RootGate
- `c8df1cb` list-read client fns + row types (teams/managers/members)
- `7d2c5ef` owner Overview + Teams + TeamDetail (real list-reads)
- `0da1269` Managers screen → real GET /api/auth/managers
- `8c610d5` manager /team screen — create team, add members, shared roster

**Web — session restore (1 commit, THIS session):**
- `89aeb9f` restore session on load from the HttpOnly relay_rt cookie

**Headline status change: restore-on-load is DONE, and security-review finding F4 is CLOSED.**
The 2026-08-21 (web) entry recorded the in-memory access token with a "refresh signs you out"
trade and restore-on-load explicitly **deferred**; the 2026-08-21 security-review recorded **F4**
(refresh token returned in the JSON body, not an HttpOnly cookie) as a conscious pre-ship
decision. Both are now resolved and those earlier notes are superseded (not edited — they remain
the record of what was true then):
- `6b8bcca` adds `auth/cookie.ts`: the rotated refresh token is ALSO set as `relay_rt` —
  HttpOnly, Secure, SameSite=Lax, Path=/api/auth/session (the tightest scope covering only the
  two routes that read it, refresh + logout). The body copy stays for the cookie-less Flutter
  client (§6): one API, two transports. `POST /api/auth/session/{refresh,logout}` read the token
  from the body (mobile) OR the cookie (browser), and always re-set / clear the cookie.
- `89aeb9f` wires the browser half: on mount AuthContext calls `refreshSession()`; the browser
  sends the HttpOnly cookie its own JS cannot read, and a fresh access token comes back in the
  body. A page refresh no longer signs you out.

**The in-memory-token rule is UNCHANGED and still load-bearing.** The access token still lives
ONLY in the module-scoped `let` in `api/client.ts` — never storage, never React state, never a
JS-readable cookie. Only the long-lived refresh token gained a store (the HttpOnly cookie), which
is precisely a store page JS cannot read. Do NOT "fix" anything by moving the ACCESS token into
storage.

**StrictMode is why the restore is memoised at module scope.** `POST /api/auth/session/refresh`
ROTATES the refresh token, so it is NOT idempotent — presenting the same cookie twice trips
reuse-detection and burns the whole family (logging the user out). React StrictMode double-invokes
mount effects in dev, and the usual "ignore the late response" guard suppresses the second
*response* but still FIRES the second *request*. So `bootstrapSession()` memoises the in-flight
promise in a module-scope variable (which survives StrictMode's mount/unmount/mount because the
module itself is not re-evaluated) → exactly one refresh per page load. A neutral `BootSplash` is
shown by RootGate + RequireAuth during `status==='loading'` so a valid-cookie user never flashes
the marketing Landing or the login screen before the restore resolves.

**Verified this session:**
- **Static review** of the restore diff (AuthContext, client.ts, types.ts, RequireAuth, App,
  AppShell, new BootSplash) — StrictMode memoisation correct; access token confirmed in-memory
  only; backend routes + cookie path (`/api/auth/session`) cross-checked against the frontend
  `/auth/session/*` calls; `secure:true` verified fine on http://localhost (secure-context
  exception); Vite proxy makes `/api` same-origin so the cookie rides along with no `credentials`
  option.
- **Browser E2E** (dev servers up, Vite proxy): signup → reload **stayed on /overview** with the
  owner dashboard rendered (not bounced to Landing/login). Post-reload `POST /session/refresh`
  fired **exactly once → 200**, while the non-memoised screen GETs (/teams, /managers) each fired
  **twice** under StrictMode — the single-vs-double contrast is the live proof the memoisation
  works (a double-fire would have burned the family). `localStorage`/`sessionStorage` empty;
  `document.cookie` has no `relay_rt` (HttpOnly).
- **Web gate:** `tsc --noEmit` clean; `vite build` clean (1826 modules).
- **API gate (re-run on the branch):** `test:isolation` **88/88** (2 suites; was 64 on main — the
  three list-read commits added +24 gate tests), `test:e2e` **240/240** (10 suites; was 210). The
  one `ExceptionsHandler` line in the e2e log is the expected `ProbeController.publicTx` negative
  assertion (db.tx() on a @Public() route must throw), not a failure.

**Re-verified live this session (independent reproduction, after the branch rename):** re-ran the
full signup → F5 flow end-to-end against the running dev servers and read the raw network log to
confirm it — not carried over from the prior session's notes:
- **Stays signed in on refresh.** Fresh owner signup (`POST /api/auth/owner/signup` → 201) landed
  on `/overview`; a full page reload **stayed on /overview** with the dashboard rendered. The
  reload's bootstrap `POST /api/auth/session/refresh` returned **200** (then `/api/me` 200) — which
  is exactly why the session survived the F5.
- **StrictMode single-fire, proven by contrast.** On the reload, `performance.getEntriesByType`
  showed `session/refresh` = **1** call while the non-memoised `teams`/`managers` GETs = **2** each.
  StrictMode is demonstrably double-invoking; only the memoised bootstrap resists it.
- **Token nowhere JS-readable.** `localStorage` and `sessionStorage` both empty; `document.cookie`
  was the empty string (the `relay_rt` cookie rides the request but is HttpOnly, so invisible to
  script).
- **Console-error triage (so they aren't mistaken for defects later).** Three console errors during
  the run are all benign and OFF the tested path: (1) a one-off `502` on an early bootstrap
  (transient Vite-proxy→Nest blip, never recurred; API error log clean); (2) two `401`s — bootstrap
  refresh with **no cookie**, which MUST 401 (the anti-oracle uniform 401 is how "anonymous" is
  detected) and correctly routes to anon; (3) one `net::ERR_ABORTED` on the logout POST — the server
  returned 204 but the immediate navigation aborted the response, and `signOut` is best-effort by
  design. The signup → reload path itself was 100% 2xx.

**Still outstanding / flagged:**
- **§12 human review before merge** — `6b8bcca` touches auth and `89aeb9f` touches session
  handling; AI review + this manual verification is a first pass, not a substitute. Nothing merged
  to main.
- **Two observations for the §12 reviewer (from this session's review — low risk, not blockers):**
  (a) a theoretical race on the *pre-auth* screen — a slow no-cookie bootstrap refresh resolving
  *after* a user's `completeSignIn` could clobber `authed`→`anon`; it is NOT present in the reload
  path, and the no-cookie 401 is the fastest call so it resolves first in practice. (b)
  `bootstrapSession` treats ANY refresh failure (incl. a transient 502 / network blip, not just a
  401) as anon, so a flaky network on reload could cause a spurious logout — it fails *closed* (safe
  direction), but a retry on transient non-401 failures would harden it.
- **/security-review** on the auth module (tasks #4–#9) is STILL not run — and now also needs to
  cover the cookie transport.
- **Cross-origin deployment caveat (new, for the reviewer):** the web `request()` helper relies on
  fetch's default `same-origin` credentials mode. Correct for dev (Vite proxy) and any same-origin
  prod (reverse-proxy `/api`), but if the SPA and API are ever served from DIFFERENT origins the
  browser will neither store the Set-Cookie (login/signup) nor send it (session/refresh) — that
  deployment would need `credentials:'include'` + `SameSite=None; Secure` + CORS
  `Access-Control-Allow-Credentials`. Consistent with the vite proxy's stated same-origin design;
  recorded so it isn't discovered in production.
- **Left in the dev DB** by browser tests: orgs `Restore Test Co` (owner
  `restore-check-20260823@relay.test`) and `Restore Verify Co` (owner
  `restore-verify-20260823b@relay.test`).

### 2026-08-21 (web) — feat/web-auth-client rebased onto merged main + API-surface reconciliation

The real web auth client (task #17, built while the backend was at task #6) sat on a branch cut
from `13da62b`. Phase 1's backend work has since merged to main at `24b1052` (#7 teams/members,
#8 refresh/logout/passcode, #9 HTTP isolation gate, 0005 FK invariants). Rebased the client onto
that main so it builds against the real, current API surface instead of the #6 snapshot it was
written against.

**The rebase dropped two of three commits as already-upstream.** The branch had three commits
above the merge-base: `61ac55a` (the frontend client), `1a44865` (an invite-link port fix), and
`8482367` (a first-login test fix). The latter two had already reached main independently during
the Phase 1 merge — `1a44865` as `84178e6` (a literal cherry-pick: same "invite links pointed at
the API's port" fix) and `8482367` as `09cf26a`. Replaying them would have been an
empty-or-conflicting no-op (main had already resolved the PROGRESS.md narrative hunk by dropping
the branch's version). Strategy: `git reset --hard 61ac55a` (keep only the frontend commit) then
`git rebase main`, which replayed it cleanly as **`4e12ba0`**. Pre-rebase tip preserved at
`backup/web-auth-client-pre-rebase` (`8482367`).

**`package-lock.json` 3-way-merged with no content change.** The client's `apps/web` dependency
additions and main's backend changes are non-overlapping, so git auto-merged; `npm install`
confirmed the merged lockfile needed zero edits (the only churn was CRLF-vs-pinned-LF from the
install rewrite, reverted with `git checkout --`).

**Reconciliation: one real type fix, the rest stale-comment corrections.** The client was written
against the #6 API (five endpoints, no teams/members, no refresh). The merged surface falsified
several of its inline notes and exactly one type:

- **The genuine fix — `AuthResult` was missing `refreshToken` (mirror drift).**
  `apps/web/src/api/types.ts` hand-mirrors `AuthResultDto` (deliberately not imported, to keep
  NestJS/class-validator out of the browser bundle); task #8 added `refreshToken` to that DTO, so
  the mirror was now wrong. Added the field and documented that the client deliberately does
  **not** persist or use it yet.
- **Stale comments corrected across six files** (`api/auth.ts`, `api/client.ts`,
  `auth/AuthContext.tsx`, `layout/AppShell.tsx`, `screens/Managers.tsx`, `App.tsx`): notes saying
  teams/members/refresh "do not exist yet (tasks #7+)" now say those endpoints shipped
  server-side (#7/#8) but this client deliberately wires none of them (Phase 2 screens; the
  refresh-token restore-on-load path is a deferred, security-sensitive step). The `/teams` and
  `/team` route stubs and the `Managers` session-only-list footer were reworded the same way: the
  barrier is now "no list-read endpoint / not wired here", not "endpoint doesn't exist".

**The in-memory-token stance is unchanged and must stay.** #8 makes a restore-on-load path
*buildable* (POST /api/auth/refresh, token in the body not a cookie), but wiring it is deferred
and carries its own storage decision. The access token stays in a module-scoped `let` (never
storage/state); the refresh-signs-you-out trade still holds and is still shown in the shell
banner. Do not "fix" this by moving the access token into storage.

Verified: `npm --workspace apps/web run typecheck` exit 0, `npm --workspace apps/web run build`
exit 0 (1810 modules, ~2.7s). No backend file touched — the client change cannot move the API
test counts (test:isolation 64, test:e2e 210 on main). The reconciliation fixes are a **separate**
commit on top of `4e12ba0` (not amended), so the rebase and the post-rebase corrections stay
distinguishable in history. Still on `feat/web-auth-client`; not merged to main.

### 2026-08-21 — /security-review over the full auth module (#4..#9)

First-pass AI security review driven manually over `a762eaa..HEAD` (tasks #4 Owner
signup/login/JWT through #9 HTTP isolation gate) — the builtin skill's `origin/HEAD...` diff
failed (this local repo has no `origin` remote), so the review used the skill's methodology
over the explicit range. **Per CLAUDE.md §12 this is NOT a substitute for the human review
that auth/authz/isolation code still requires before merge.** Nothing merged to main.

**No exploitable finding.** No injection (every SQL statement parameterized; the one
identifier interpolation is `ResourceOwnerGuard`, sourced from the frozen compile-checked
`OWNED_TABLES` allow-list), no isolation bypass, no auth oracle, no secret in any response
DTO or `/me` or the invite URL. Verified-correct controls: JWT never trusted for scoping
(row re-read every request); FORCE RLS + relay_app NOBYPASSRLS with a boot-time refusal;
SECURITY DEFINER lookups pinned `search_path`, `REVOKE ALL FROM PUBLIC`, EXECUTE to relay_app
only, no write definers; anti-oracle login (unconditional bcrypt, byte-identical 401s, no
login MinLength); passcode ~57-bit, `randomInt`, hashed, single-use enforced in the UPDATE
WHERE; global ValidationPipe whitelist+forbidNonWhitelisted+transform; guard order
JwtAuthGuard→RolesGuard→ResourceOwnerGuard; refresh rotation locks FOR UPDATE and burns the
family on reuse.

**Findings (all defense-in-depth or already-tracked launch blockers, none Phase-1-blocking):**
- **F1 (Low, DiD) — `createTeam` single-layer + no DB org-consistency invariant on
  `team.manager_id`.** `team_manager_id_fkey` enforces manager *existence*, not org-match;
  `createTeam`'s cross-org rejection rests solely on one RLS-scoped SELECT (Sabotage-C, logged
  2026-08-18). Not exploitable today (that SELECT is itself RLS-scoped → cross-org manager
  invisible → 400), but a single point of failure. Durable fix = composite-FK invariant so
  `team.(org_id, manager_id)` references a same-org user — **migration `0005`** (0004 slot is
  taken by `0004_passcode_lookup.sql`). Routed to human review, not applied unilaterally.
- **F2 (Info, tracked) — TLS boot gate still absent.** The `ff2acfed` commit says
  `env.validation.ts` should refuse to boot on `NODE_ENV=production` without
  `sslmode=verify-full`; that check is not in the file yet. Launch blocker #2 above; harmless
  today (loopback-only), must land before any multi-host deploy.
- **F3 (Info, tracked) — `0003` grants relay_migrator context-free SELECT on "user".**
  Accepted trade; tighter design (NOLOGIN BYPASSRLS role owning only the two lookup fns) is a
  tracked launch blocker, blocked on a superuser credential this dev env lacks.
- **F4 (Info) — `refreshToken` returned in the JSON body, not an HttpOnly cookie.** Deliberate
  and documented (AuthResultDto), and consistent with the web client's interim in-memory-token
  stance. For the shipped web client the standard hardening is an HttpOnly+Secure+SameSite
  refresh cookie — a conscious decision to make before that client ships, not a Phase-1 bug.

**Part B — the #5 open item ("no member-writable route") re-confirmed as of #9: HOLDS, with a
shifted mechanism.** `0001_rls.sql` is byte-identical — the `user`/`team` write predicate is
still `FOR ALL` with no member branch (member's write-slice == manager's). Every #7/#8/#9
write route to an RLS-governed table excludes members at the app layer: `POST teams`,
`POST members`, `POST users/:id/passcode` are `@Roles('owner','manager')` (member → 403),
`POST managers` is `@Roles('owner')`; `first-login` is self-scoped by passcode possession
(the UPDATE WHERE); `refresh`/`logout` touch only `refresh_token` (no RLS, token-keyed).
**The nuance: the member barrier is now RolesGuard, not the RLS write-predicate.** So Phase 2's
first genuinely member-writable route (relay forward / peer hand-off) still cannot lean on
RLS to scope the write — it must carry its own business-state WHERE clause (the `task_step …
WHERE assigned_user_id = $2 AND status='active'` pattern above). The line-122 constraint is
unchanged and now load-bearing for Phase 2.

**F1 fix APPLIED — reviewed per §12, migration 0005 applied, proof made permanent (2026-08-21).**
Drafted, then human-reviewed and approved, then applied in the same session:
- `apps/api/src/db/migrations/0005_tenant_fk_invariants.sql` (**applied**) — three composite FKs
  pinning every cross-row tenant reference to one org: `team.(org_id, manager_id)` and
  `"user".(org_id, manager_id)` (self-ref) → `"user".(org_id, id)`; `"user".(org_id, team_id)`
  → `team.(org_id, id)`; plus the `UNIQUE (org_id, id)` targets both tables need as FK anchors.
  **Additive** (keeps the single-col FKs that own the tested RESTRICT/SET NULL delete
  behaviour), **idempotent** (DO/`duplicate_object`, like 0000), **ON DELETE NO ACTION**
  (a composite SET NULL would illegally null the NOT NULL `org_id`; NO ACTION defers to
  end-of-statement so it coexists with the existing `user_team_id_fkey` SET NULL), **MATCH
  SIMPLE** (owners have NULL `manager_id`, teamless users NULL `team_id` — MATCH FULL would
  reject every one of them). Linchpin: RI checks **bypass** RLS (documented PG behaviour), the
  mirror of the 0002/0003 lesson that SECURITY DEFINER does *not* — so the FK sees the
  cross-org row the inserting relay_app session cannot, and rejects it (23503, not 42501).
- The DB-layer proof — an **owner** inserting into their **own** org (passes RLS WITH CHECK) but
  naming another org's manager/team, which only the composite FK can stop — was **folded into
  `rls.e2e-spec.ts`'s "schema invariants" block as 5 permanent tests, and the `RUN_0005_TESTS`
  gate removed** (§11); the standalone `tenant-fk-invariants.e2e-spec.ts` was deleted. The
  cross-org team is inserted `status='deleted'` to dodge the partial `team_manager_id_active_key`
  so the composite FK is the sole rejection cause; one test pins SQLSTATE 23503 (FK) vs 42501
  (RLS); a same-org positive control proves the FK is not blanket-rejecting.
- Counts after: **test:isolation 59 → 64, test:e2e 205 → 210**, all green. F1 is now closed at
  the database layer — a mis-attributed cross-org row can no longer be committed even via a path
  that passes RLS. (Not merged to main; lives on `feat/phase1-provisioning`.)

### 2026-08-18 — HTTP-layer isolation gate across all Phase 1 routes (task #9 complete)

`http-isolation.e2e-spec.ts` (**25 tests**) is the HTTP companion to `rls.e2e-spec.ts` (34,
DB layer). Together they are the two halves of the §11 gate: RLS proves the *database* returns
zero rows for a cross-tenant id even with every guard removed; this suite proves the *HTTP
stack* — `JwtAuthGuard → RolesGuard → ResourceOwnerGuard` + RLS — refuses cross-tenant and
cross-role requests over real routes with real (sometimes forged) bearer tokens. The filename
matches the `(isolation|rls)` pattern so `test:isolation` runs it as part of the permanent gate.

**Phase 1 exposes no read-by-id route.** The only GET that returns a user is `/api/me`, and it
is self-only (it reads `request.user`, ignores any id). There is no "fetch manager B by id"
endpoint to attack directly — the id-guessing surface is the *write/provisioning* routes
(`POST /auth/teams`, `/auth/members`, `/auth/managers`) and the issuer-scoped passcode regenerate
(`POST /auth/users/:id/passcode`). The gate drives each cross-tenant and cross-role and pins the
exact refusal. (Phase 2's read-by-id task/step routes will extend this same spec — noted in its
header.)

**The status matrix is the contract (each code pinned, each meaning distinct):**
- **403** — RolesGuard, *before* target resolution: the action is refused for the caller's role
  (a Member/Manager hitting an Owner-only route). It never reveals whether a target exists.
- **400** — the named target manager is unresolvable *within the caller's RLS slice*
  (`resolveTargetManagerId` + an RLS-scoped manager lookup): a Manager naming another manager, or
  an Owner naming a manager in another org. Byte-identical to "no such manager", never a leak.
- **404** — ResourceOwnerGuard/RLS: an id-addressed row outside the caller's slice is
  indistinguishable from one that never existed (a malformed UUID also 404s, pre-DB).

**The property the gate exploits: the JWT is never trusted for scoping.** Two tests forge a
validly-signed token whose `orgId`/`managerId`/`role` claims lie. Because
`JwtStrategy.validate()` re-reads the user row every request and builds `CurrentUser` from the
*row* (never the payload), a forged `orgId` does not move `/me`'s scope and a forged `role=owner`
still 403s at an Owner-only route. These two are the load-bearing gate tests.

**Three sabotage checks (mutate→run→revert), same discipline as tasks #5/#6 — all reverted, none
a defect:**
1. **A — `jwt.strategy.ts` trusts claims.** Rebuilt `CurrentUser` from the token payload instead
   of the row. Exactly the two forged-token tests reddened (`/me` returned the forged org;
   `role=owner` forgery turned a 403 into a 400). Confirms those two pin the claims-not-trusted
   property and nothing else silently depends on it.
2. **B — `roles.guard.ts` refusal disabled.** Commented out the `throw new ForbiddenException()`.
   All six "refused (403)" tests reddened (403 → 200/400/409). The passcode case (Member 403 →
   200) specifically proves RolesGuard runs *before* ResourceOwnerGuard — with the role check
   gone, a Member reached the owned-resource path.
3. **C — `auth.service.ts` `createTeam` manager-lookup 400 disabled.** Only the owner-cross-org
   *team* test reddened (400 → 409: `team_manager_id_active_key` fires because managerC already
   has an active team). The owner-cross-org *member* test stayed green — `createMember`'s path is
   double-defended (its own manager lookup + the active-team lookup), so a single mutation cannot
   redden it. Confirms the team route's cross-org 400 rests on a single layer and that the test
   genuinely pins it (not incidentally passing).

`grep -rn SABOTAGE apps/api/src` clean; `git diff -- apps/api/src` empty — the only new artifact
is the spec file.

Verified: `test:isolation` **59/59** across **2 suites** (34 rls + 25 http-isolation), `test:e2e`
**204/204** across **10 suites** (+1 suite, +25 vs #8's 179/9), `tsc --noEmit` and `nest build`
clean. (The one `ExceptionsHandler` line in the e2e log is the `ProbeController.publicTx` negative
test deliberately calling `db.tx()` on a `@Public()` route to prove `requireTenantScope` throws —
a passing negative assertion, not a failure.)

Per CLAUDE.md §12 this is authentication/authorization/isolation code and **needs human review
before merge**; `/security-review` still has not been run — outstanding for the whole auth module
(tasks #4–#9). **This entry closes Phase 1 build-order item 1 and the §11 gate requirement** — the
isolation test (Manager A cannot reach Manager B by id → empty result / 403 / 404) now exists at
both the DB and HTTP layers and must never be removed from CI.

### 2026-08-17 — Refresh rotation, logout, passcode regeneration, real signup throttle (task #8 complete)

Four capabilities shipped, all `@Public()` or issuer-scoped: `POST /api/auth/refresh`
(opaque-token rotation), `POST /api/auth/logout` (server-side family revoke), `POST
/api/auth/users/:id/passcode` (issuer regenerates a pending invite's passcode — role-neutral,
on a new `InviteController`), and the signup throttle is now **real** (env-driven
`SignupThrottlerGuard`) rather than the inert decorator noted in #6/#7.

**Opaque refresh tokens, not JWTs.** 32 random bytes → base64url raw, returned once; SHA-256
hex at rest; a `family_id` ties one rotation lineage together. There is **no
`JWT_REFRESH_SECRET`** — an opaque token is a random lookup key, there is nothing to sign or
verify. `refresh()` rotates on use: the presented token is revoked and a successor minted in
the same family, both inside one tx. Reuse of an already-revoked token is treated as theft and
**burns the whole family** (both the thief and the legitimate client are forced back to login).
Every failure — unknown, expired, reused, deactivated-user — is one identical 401 body
("Session expired. Please sign in again."), the same anti-oracle discipline the login path holds.

**`unscopedTx`, and why it is not an isolation hole.** `refresh()` runs *before* any tenant
context exists (the caller is still proving who they are), so it cannot use `db.tx()` — it uses
`db.unscopedTx` (no RLS). `refresh_token` deliberately has **no RLS**: a row is found only by
`sha256(presented token)`, so possession of the secret *is* the authorization; there is no id
to guess and nothing cross-tenant to reach. Identity for the new session is still re-derived
from the `user` row (role/orgId/managerId from the row, never from the token), exactly as
`JwtStrategy.validate()` does. The migrator may insert `refresh_token` rows (seeding the expired-token
tests) precisely because the table is outside RLS.

**Refresh token in the response body, not an HttpOnly cookie.** One contract serves web and
Flutter (§6); a cookie is invisible to a native mobile client. The web client holds the refresh
token in memory — its XSS exposure is the same as the access token it already holds — so this
is a deliberate, documented trade, not an oversight.

**Signup throttle is now real and env-driven.** `SignupThrottlerGuard` keys the named `signup`
throttler on IP (signup is unauthenticated and creates a *new* org, so there is no account to
key on); `SIGNUP_THROTTLE_LIMIT` / `_TTL` configure it (default 10/hr). Every *other* e2e spec
lifts the limit to 1,000,000 via `test/helpers/test-env.ts` so it never bites mid-suite;
`signup-throttle.e2e-spec.ts` boots its **own** `AppModule` with the limit at 3 to prove the
bite, and also proves a bad-creds login still 401s (not 429) from an exhausted signup bucket —
pinning the `@SkipThrottle` wiring (a `ThrottlerGuard` evaluates every registered throttler).

**Access-token-equality test fix (carried from a prior session, re-confirmed).** A JWT's
`iat`/`exp` are integer seconds, so two access tokens minted in the same wall-clock second are
byte-identical. The rotation test therefore must **not** assert the access token differs across
a refresh — it asserts a 3-segment JWT plus a `GET /api/me` round-trip. The security-critical
rotation is on the *opaque* refresh token, which is asserted to differ.

**Three sabotage findings — the tests assert the right behaviour, but three `[sabotage #X]`
annotations overstated what removing a single element proves.** All confirmed by
mutate→run→revert; **none is a security defect** (every property is enforced, in each case by at
least one layer, usually two). The overstatement was in the *documentation*; corrected in-place
in the spec headers with the true mechanism and a `Verified 2026-08-17` stamp.

1. **session-refresh #C (`FOR UPDATE`).** The two-request concurrency test does **not** go red
   when `FOR UPDATE` is removed: in single-process `runInBand` the two `Promise.all` refreshes
   serialise by timing (the first tx commits before the second's `SELECT`, so the second reads
   `revoked_at` already set and takes the reuse path via the committed row, not the lock) —
   `[200,401]` either way. Forcing genuine concurrency instead (an 8-way burst) **deadlocks**
   with the lock removed (row-lock on `WHERE id` vs the reuse branch's `WHERE family_id`), which
   confirms `FOR UPDATE` **is** load-bearing under real multi-connection load — but also that a
   burst is not a usable deterministic test. Kept `FOR UPDATE`; the test now honestly pins only
   the end-state invariant (exactly one success, family burned).

2. **passcode #A (`password_hash IS NULL`).** Removing *just* this predicate stays green: an
   activated account has **both** `password_hash` and `passcode_used_at` set (first-login stamps
   them in one atomic UPDATE), so `passcode_used_at IS NULL` independently blocks re-issue.
   Removing **both** is the effective sabotage (200 + an invite mail on a live account, then
   first-login could reset the password). They are kept as belt-and-braces; first-login *itself*
   also re-checks `password_hash IS NULL`, a second independent takeover barrier.

3. **passcode #C (`@OwnedResource`).** Removing it reddens **no** cross-tenant test:
   `regeneratePasscode` runs under `db.tx()`, so RLS filters a cross-org/cross-team target to
   zero rows → 404 regardless of the guard. What it *does* redden is "a malformed id is a 404"
   (→ 500 — Postgres invalid-uuid on the non-UUID reaching the UPDATE). So on this route the
   guard's observable job is the pre-DB UUID/existence 404 (plus defence-in-depth), **not** the
   tenant boundary — RLS owns that. Re-tagged the malformed-id test as the real `#C` guard.

**Accurate sabotage checks (reddened exactly as documented, reverted):** session-refresh #A
(normal-path revoke — replay returns 200), #B (drop the family-revoke UPDATE — the live
successor survives a reuse), #D (give any one failure branch a distinct body — anti-oracle
breaks); passcode #B (`@Roles` → a Member 403s *before* `ResourceOwnerGuard` runs, so it is 403
not 404); signup #A (remove `@UseGuards(SignupThrottlerGuard)` → the limit+1th signup is 201 not
429, since there is no global `ThrottlerGuard`). `grep -rn SABOTAGE apps/api/src` clean; only the
documented test-header comments remain.

**Deferred to Phase 6 (not this task):** self-service "forgot passcode" re-issue for an
*unauthenticated* invitee (§1). The issuer-driven regenerate above covers the operational need
now; the self-service variant is a Phase-6 polish item, recorded so it is not lost.

Verified: `test:isolation` **34/34** (no regression), `test:e2e` **179/179** across **9 suites**
(was 149/149 in 6; +3 suites: `session-refresh` 14, `passcode-regeneration` 15, `signup-throttle`
1), `tsc --noEmit` and `nest build` clean.

Per CLAUDE.md §12 this is authentication/authorization/isolation code and **needs human review
before merge**. `/security-review` still has not been run on the auth module — outstanding for
the whole module (tasks #4–#8). **Flagged for review:** the three sabotage-annotation
corrections above — a reviewer should confirm the redundancy layers (RLS + guard; the two
passcode predicates; first-login's own `password_hash IS NULL`) are all intended defence-in-depth,
and decide whether `FOR UPDATE` warrants a dedicated deterministic concurrency harness later.

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
