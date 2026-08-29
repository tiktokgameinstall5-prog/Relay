/**
 * Response shapes from the Relay API.
 *
 * Hand-mirrored from apps/api/src/auth/dto/api-response.dto.ts rather than
 * imported across the workspace boundary: those classes carry @ApiProperty
 * decorators, so importing them would drag @nestjs/swagger and reflect-metadata
 * into the browser bundle to describe shapes that TypeScript erases anyway.
 *
 * The cost of mirroring is drift. Keep this file next to that one when either
 * moves — a mismatch here is a type error at the call site, not a runtime bug,
 * which is the point of doing it in TypeScript at all.
 */

/** CLAUDE.md §1. Read from /api/me, never chosen by the client. */
export type UserRole = 'owner' | 'manager' | 'member';

/** The user block inside an auth result — the login response's summary view. */
export interface AuthUser {
  id: string;
  orgId: string;
  role: UserRole;
  name: string;
  email: string;
}

/**
 * POST /api/auth/owner/signup, /api/auth/login, /api/auth/manager/first-login
 * (and POST /api/auth/first-login for a member). All return this shape.
 */
export interface AuthResult {
  accessToken: string;
  /**
   * Opaque refresh token (task #8), returned in the body for the cookie-less
   * mobile client (§6). The server ALSO sets it as the HttpOnly relay_rt cookie
   * on this response, and the web client relies on that cookie — not this body
   * value — to restore the session via POST /api/auth/session/refresh on load
   * (see AuthContext). So this field is intentionally dropped by the web client;
   * the access token is all it keeps, in memory (api/client.ts).
   */
  refreshToken: string;
  user: AuthUser;
}

/**
 * GET /api/me — the authoritative view of the session.
 *
 * Richer than AuthUser, and re-read server-side from the user row on every
 * request, so this (not the login response) is what the UI stores.
 */
export interface MeResponse {
  id: string;
  orgId: string;
  organizationName: string;
  role: UserRole;
  name: string;
  email: string;
  /** NULL for an Owner, own id for a Manager, manager's id for a Member. */
  managerId: string | null;
  teamId: string | null;
  roleTitle: string | null;
  workflowStep: number | null;
  ranking: number;
  isReporter: boolean;
}

/**
 * POST /api/auth/managers.
 *
 * No passcode field, and that is not an omission here: the API never returns it
 * (api-response.dto.ts:102-104). It exists in plaintext only in the invite
 * email.
 */
export interface ManagerProvisioned {
  id: string;
  name: string;
  email: string;
  role: 'manager';
  status: 'active';
  /** ISO 8601 — serialised from a Date over the wire. */
  passcodeExpiresAt: string;
  /** false means the account was still created; the passcode is regenerable. */
  inviteEmailSent: boolean;
}

/**
 * POST /api/auth/members. The member-provisioning twin of ManagerProvisioned,
 * plus the team they joined. The passcode is deliberately absent for the same
 * reason: the API never returns it — it exists only in the invite email.
 */
export interface MemberProvisioned {
  id: string;
  name: string;
  email: string;
  role: 'member';
  status: 'active';
  /** The manager's active team the member landed on. */
  teamId: string;
  /** ISO 8601 — serialised from a Date over the wire. */
  passcodeExpiresAt: string;
  /** false means the account was still created; the passcode is regenerable. */
  inviteEmailSent: boolean;
}

/**
 * One row of GET /api/auth/teams (Owner sees all; Manager sees only their own,
 * scoped server-side by RLS). Mirrors TeamListRowDto.
 *
 * The two counts arrive as numbers — the service already Number()-ed the bigint
 * the driver hands back as a string. `memberCount` deliberately EXCLUDES the
 * manager (the count SQL filters role='member'), so a solo team reads 0, not 1.
 */
export interface TeamListRow {
  id: string;
  name: string;
  managerId: string;
  managerName: string;
  managerEmail: string;
  /** Active members, not counting the manager. */
  memberCount: number;
  /** Active members whose invite is not yet activated (no password set). */
  pendingInviteCount: number;
  /** ISO 8601 — serialised from a Date over the wire. */
  createdAt: string;
}

/**
 * POST /api/auth/teams — the row just created. A team is not a credential, so
 * this is the whole safe view: no secret, no passcode. The manager screen uses
 * it only to confirm the create succeeded, then re-reads the team list.
 */
export interface TeamCreated {
  id: string;
  name: string;
  managerId: string;
  status: 'active';
}

/**
 * One row of GET /api/auth/managers (Owner-only — a manager gets a clean 403,
 * see the route's §11 note). Mirrors ManagerListRowDto.
 *
 * No password/passcode field exists: `pendingInvite` (from `password_hash IS
 * NULL`) is the only account-state signal, and the hash never leaves the DB.
 */
export interface ManagerListRow {
  id: string;
  name: string;
  email: string;
  status: 'active' | 'inactive';
  /** Provisioned but not yet activated — no password set. */
  pendingInvite: boolean;
  /** The manager's active team, or null if they have not created one. */
  teamId: string | null;
  teamName: string | null;
  /** ISO 8601 — serialised from a Date over the wire. */
  createdAt: string;
}

/**
 * One row of GET /api/auth/teams/:id/members. Mirrors MemberRowDto — exactly the
 * eight fields decision #4 fixes, no ranking/title/step, no hash, no passcode.
 *
 * `role` is typed as the full union to match the source DTO, but the roster is
 * members-only (the service filters role='member'), so at runtime it is always
 * 'member' — the manager is rendered from the team header, never as a roster row.
 */
export interface MemberRow {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: 'active' | 'inactive';
  /** Provisioned but not yet activated — no password set. */
  pendingInvite: boolean;
  /** Always the :id in the path. */
  teamId: string;
  /** ISO 8601 — serialised from a Date over the wire. */
  createdAt: string;
}

/** Task workflow enums and types (CLAUDE.md §2) */
export type TaskType = 'text' | 'video' | 'file';
export type TaskStatus = 'scheduled' | 'in_progress' | 'completed';
export type TaskStepStatus = 'pending' | 'active' | 'completed';

export interface TaskAssignee {
  id: string;
  name: string;
}

export interface TaskStepResponse {
  id: string;
  stepOrder: number;
  status: TaskStepStatus;
  assignedUserId: string;
  assignedUserName: string;
  startedAt: string | null;
  completedAt: string | null;
  durationSeconds: number | null;
}

export interface TaskResponse {
  id: string;
  teamId: string | null;
  name: string;
  type: TaskType;
  description: string | null;
  status: TaskStatus;
  totalSteps: number;
  completedSteps: number;
  currentStepOrder: number | null;
  currentAssignee: TaskAssignee | null;
  createdAt: string;
  updatedAt: string;
  steps: TaskStepResponse[];
}

export interface CreateTaskInput {
  name: string;
  type: TaskType;
  description?: string | undefined;
  memberIds?: string[] | undefined;
  teamId?: string | undefined;
  targetManagerId?: string | undefined;
  targetMemberId?: string | undefined;
}

export interface ForwardStepInput {
  targetUserId?: string | undefined;
}

export interface TaskAttachment {
  id: string;
  taskId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  checksumSha256: string;
  uploadedByUserId: string;
  createdAt: string;
  updatedAt: string;
}


