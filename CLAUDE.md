# Relay — Team Workspace & Task-Relay Platform

Full spec: `relay-technical-specification.docx` (read first for anything not covered below).
UI reference: `workspace-relay-prototype.jsx` (design tokens, layout, component style).
Progress tracker: `PROGRESS.md` (read at the start of every session, update at the end).

## What this system is

A multi-tenant workspace where a single task is not owned by one person — it moves through
an ordered chain of team members (a "relay"), one step at a time, until the last member
marks it complete. Three roles: Owner (full org visibility) → Manager (owns exactly one
team) → Member (works tasks, sees own team's board).

---

## 1. Roles, Auth & Account Provisioning

- **Owner**: self-service sign-up/login (email+password, or SSO later). First sign-up
  auto-creates the Organization. Owner has full visibility — every manager's team, every
  task, every report, across the whole org (like a full CRM view).
- **Manager**: NEVER self-signs up. Only the Owner creates a Manager account — Owner enters
  name+email, system generates a one-time passcode/invite link, emailed to the manager.
  Manager logs in with email+passcode at a dedicated login screen (may set a permanent
  password on first login). No public registration form exists for this role.
- **Member**: Added by their Manager (or by the Owner on the manager's behalf) — same
  passcode/invite mechanism, scoped to that manager's team at creation. No public sign-up.
- Manager creates their own team and adds members to it. Owner can also create teams and
  assign a manager to them.
- Manager assigns each member a **role/title** and, optionally, a **workflow step number**
  — visible on that member's own dashboard.
- Passcodes: 8–10 char alphanumeric, single-use, hashed at rest, rate-limited, expire in
  ~72h and are regenerable by the issuer. Sessions: JWT, "remember me" ~30-day refresh
  token, self-service "forgot passcode" re-issue flow so accidental logout is a non-event
  (logout only ends the session — no data is affected; re-entry is the same login flow).

### Cross-team isolation — hard, non-negotiable rule
Every Team, Member, and Task row is scoped by `manager_id`/`team_id`. Every query on behalf
of a Manager or Member session MUST be scoped server-side —
`WHERE manager_id = current_user.manager_id`. A Manager must never see, search, contact, or
reach another manager's team/tasks/reports/members, even by direct ID/URL guessing. Only
Owner-scoped sessions bypass this filter. Enforce via row-level security or middleware —
never rely on hiding it in the UI only.

---

## 2. Task & Workflow Engine (the core of the product)

- Task fields: name, type (text / video / file), description, created_by, scheduled_for
  (nullable), status (scheduled / in_progress / completed).
- **Who can assign what**: Owner → a Manager; Owner → a whole team or a specific member;
  Manager → their own team (ordered relay) or one member; Member → another member in the
  same team (peer hand-off).
- **Relay chain**: a task assigned to a team is split into ordered `task_step`s, one per
  member, each with `step_order`. Exactly one step is `active` at a time (or zero once all
  are completed). A step becomes `active` the moment the previous one is marked `completed`
  (step 1 is active immediately on assignment).
- **Live visibility**: at every moment, ALL team members (and the Manager/Owner) can see
  which member currently holds the task — a live "currently with X" indicator, updated in
  real time (WebSocket/SSE). Multiple simultaneous tasks show as separate rows/cards, each
  with its own relay-chain visual.
- **Actions**: only the member at the active step can act (forward/complete) on that task;
  everyone else on the team has read-only visibility of it. When the last step completes,
  the parent task auto-flips to `completed` and triggers the reporter prompt (see §4).
- **Time tracking**: `started_at` stamped when a step goes active, `completed_at` when
  forwarded. Manager/Owner dashboards show per-step and total task duration (for spotting
  bottlenecks — e.g. "member 3 consistently 2x slower").
- **Scheduling**: Owner/Manager can set `scheduled_for` up to 365 days ahead. Scheduled
  tasks stay hidden from the active board until a cron job (e.g. BullMQ) flips them to
  in_progress at the scheduled time and notifies step-1's member.
- **Notifications**: on task assigned, step becomes active (notify that member + whole
  team), task completed (notify manager/owner/reporter), scheduled task goes live, ranking
  changed. In-app + email; push notification once the mobile app exists.

---

## 3. Content Types & Files

- Text: stored directly (rich text recommended). File: object storage (S3-compatible),
  virus-scanned on upload. Video: stored at **original bitrate/resolution — never
  re-encoded** on upload or download; downloads must be byte-identical to the source. Build
  any preview/streaming proxy as a separate derivative, never touching the master file.
- Downloadable by Owner, the relevant Manager, and members on that task's team only — same
  team_id isolation rule as everything else. Large video: resumable/multipart upload.

---

## 4. Rankings & Reporter Role

- Each member has a numeric ranking (e.g. 0–100), editable by their Manager or the Owner;
  every change logged (`ranking_event`: old value, new value, changed_by, reason) for
  audit. Shown to teammates as a leaderboard — **within their own team only, never
  cross-team**.
- Manager can flag one or more members `is_reporter = true`. When a task's final step
  completes, the reporter is prompted to write a short completion report (e.g. "task
  completed 2 days ago, delivered per spec"). Reports are visible to: the whole team, that
  team's Manager, and the Owner (all teams) — never to another team's manager/members.

---

## 5. Deletion, Removal & Other Edge Cases

- **Never hard-delete a user.** Set `status = inactive` (soft delete). History, completed
  task steps, rankings, and reports stay attributed to the inactive user (label them
  "removed"/"deactivated") — matches how Asana/ClickUp handle offboarding.
- **Reassign before removing.** If a member holds an *active* task_step, block their
  removal until the Manager reassigns that step to another eligible member (show affected
  tasks + a replacement dropdown).
- **Deleting a Manager (cascades to their whole team) is the highest-risk action.** Soft
  delete into a 30-day recoverable "Recently deleted" state, restorable by Owner in one
  click. Require two-step confirmation before even the soft delete: (1) a warning dialog
  with impact numbers ("this affects N members and M tasks"), (2) require Owner to type the
  manager's name to confirm (type-to-confirm pattern, like GitHub repo deletion). Permanent
  purge only after the retention window, or via a separate explicit action — never as a
  side effect of the first click.
- This "soft-delete + confirm" pattern is a **product-wide default**, not just for
  Managers — prefer it over irreversible destructive actions anywhere in the product.

---

## 6. Web + Mobile (Flutter) Strategy

- One shared backend API (REST/GraphQL) serves both the web app and the Flutter app —
  never build two separate backends. Same JWT auth across both.
- Mobile adds push notifications for handoffs and background/resumable upload so video/file
  quality isn't compromised on mobile networks.
- Sequencing: ship web first (faster to validate the workflow engine), then build Flutter
  against the now-stable API.

---

## 7. Architecture — Modular, Not Monolithic-Tangled

Modular monolith (not microservices yet) so future additions (Attendance, Payroll, Leave
Management, AI agents, social-media automation) don't require breaking existing modules:

**Authentication & Permissions · Company & Team Management · Workflow Engine (core —
everything else calls into this, not into each other) · Task Management · File Storage
(cross-cutting, used by all modules) · Scheduling · Notifications · Reports & Analytics ·
Ranking System · Audit Logs · Chat & Comments · Settings**

## 8. Tech Stack

- Frontend: React + Tailwind (core utility classes only — matches
  `workspace-relay-prototype.jsx`)
- Backend: Node.js (NestJS/Express) or Django
- DB: **PostgreSQL** — `manager_id`/`team_id` indexed on every tenant-scoped table; JSON
  columns allowed for flexible fields (e.g. custom workflow settings)
- Realtime: WebSocket (Socket.IO) or Postgres LISTEN/NOTIFY → SSE
- File/video storage: S3-compatible bucket (AWS S3 / Cloudflare R2) + CDN — never in the DB
- Auth: JWT sessions; passcode/invite emails via a transactional email provider (SES/Postmark)
- Scheduling: cron worker (BullMQ) for scheduled-task activation

## 9. Design System

- Colors (source of truth: `workspace-relay-prototype.jsx`, rebuilt against ClickUp/monday.com
  research): dark workspace sidebar `#181A24` (fixed, always visible ≥`md`; below `md` it
  must collapse into the horizontal scrollable tab bar described below — never render only
  the dark sidebar with no mobile fallback), signal indigo `#3654F4` (primary buttons/brand),
  active-status blue `#0073EA`, completed-status green `#00C875`, scheduled/pending amber
  `#FDAB3D`, ink `#161A22` (text), cool slate `#F4F5F8` (content background), hairline border
  `#E4E7EC`. Status chips are bold/solid-filled (white text on saturated color), not soft
  tints — this matches the monday.com/ClickUp convention the redesign was based on.
- Fonts: Space Grotesk (display/headings), Inter (body), IBM Plex Mono (timestamps/ids).
- Buttons: primary = solid indigo/white text; secondary = white+border; destructive =
  red outline, always confirmation-gated.
- Nav: dark sidebar on desktop (`≥md`) with workspace/persona switcher at top and current
  user at the bottom. **Below the `md` breakpoint the sidebar must not simply disappear** —
  render a horizontal scrollable tab bar instead so navigation is never unreachable on
  mobile widths. (This was a real bug in an earlier prototype revision — keep the test for
  it: resize to ~390px width and confirm every nav tab is still reachable.)
- Cards: white, rounded-xl, 1px hairline border, shadow only on hover/modals.
- Task list default view: dense list rows (task name, current holder avatar, progress bar
  as `done/total` steps, bold status chip) — click a row to expand the relay chain inline.
- Signature UI element: the relay chain — a horizontal row of member avatars connected by
  arrows, active member ring-highlighted + pulsing dot, completed members check-marked,
  per-step duration shown in mono type underneath. This is our differentiator vs. competitor
  tools and should not be diluted when borrowing their list/board conventions.

## 10. Build Order (see spec §10 for full detail)

1. Auth & Tenancy — Owner sign-up, Manager/Member provisioning, isolation enforced + tested
2. Workflow Engine — task_step chain, forward/complete actions, live status
3. Content — text/file/video attachments, lossless downloads
4. Scheduling & Notifications
5. Rankings & Reporter workflow, time-tracking analytics
6. Polish — audit log views, quotas, 2FA, mobile-responsive pass

Work one phase at a time. Do not start the next phase's code until the current phase has
passing tests, especially the isolation test in Phase 1.

## 11. Testing Requirement (permanent, never remove from CI)

After Phase 1, and after any change touching Auth or the Workflow Engine, there must be an
automated test that proves isolation: log in as Manager A, attempt to read Manager B's
team/tasks/reports by ID — must fail (empty result or 403).

## 12. How Claude Code Should Work On This Project

- Use least-privilege permissions. Never run with `--dangerously-skip-permissions`. Keep
  deny rules in `.claude/settings.json` for `.env`/secrets and outbound network calls.
- Any change touching authentication, authorization, or the tenant-isolation logic requires
  human review before merge — do not treat AI review as sufficient for these areas.
- Run `/security-review` after finishing each module, especially Auth and Workflow Engine.
  Treat it as a first pass, not a full audit.
- Use **Plan Mode** before implementing any new module — propose the plan, get it approved,
  then implement.
- Prefer many small, tested, committed steps over one large change.

## 13. Session & Context Management

- Conversation is lossy; files and git commits are not. Anything important must end up in
  this file, `PROGRESS.md`, or a commit — not left only in chat/session memory.
- Update `PROGRESS.md` at the end of every session (what changed, what's next, anything
  deferred). Read it at the start of the next session along with this file.
- `/compact` proactively at ~60% context usage, with explicit preservation instructions
  (current task, files modified, isolation rules, schema decisions) — don't wait until
  90%+.
- `/compact` = same session continues, lighter context. `/clear` = full wipe, only this
  file reloads. Use `/clear` between completed phases (fresh module, fresh session); use
  `/compact` mid-task.
- If any decision changes something written in this file or in the spec doc, update the
  file immediately — don't leave it only in conversation history.
