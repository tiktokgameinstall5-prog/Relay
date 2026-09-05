/**
 * The auth-flow endpoints this client wires: owner signup, login, manager
 * provisioning, manager first-login, and /me. Thin by design — every one is a
 * single request() call, so the interesting behaviour stays in client.ts where
 * it is written down once.
 *
 * The three GET list-reads below (teams / managers / team members) now land with
 * the Phase 2 dashboards that consume them — the rule holds that a client
 * function only exists once a screen is behind it. Passcode regeneration still
 * has no screen and stays unwired; refresh/logout are wired in AuthContext, not
 * here, because they touch the token store in client.ts.
 */
import { request } from './client';
import type {
  AuthResult,
  DeletedManager,
  ManagerImpactStats,
  ManagerListRow,
  ManagerProvisioned,
  MemberProvisioned,
  MemberRow,
  MeResponse,
  TeamCreated,
  TeamListRow,
} from './types';

export interface OwnerSignupInput {
  organizationName: string;
  name: string;
  email: string;
  password: string;
}

/** POST /api/auth/owner/signup — 201. The only self-service sign-up (§1). */
export function ownerSignup(input: OwnerSignupInput): Promise<AuthResult> {
  return request<AuthResult>('/auth/owner/signup', {
    method: 'POST',
    body: input,
    authenticated: false,
  });
}

/**
 * POST /api/auth/login — 200.
 *
 * Not owner-specific: a Manager uses this too, once first-login has set their
 * password. The role is never sent, it is read from the user row server-side.
 */
export function login(input: { email: string; password: string }): Promise<AuthResult> {
  return request<AuthResult>('/auth/login', {
    method: 'POST',
    body: input,
    authenticated: false,
  });
}

/** POST /api/auth/managers — 201, Owner only. Passcode goes to email, not here. */
export function createManager(input: {
  name: string;
  email: string;
}): Promise<ManagerProvisioned> {
  return request<ManagerProvisioned>('/auth/managers', { method: 'POST', body: input });
}

/**
 * POST /api/auth/teams — 201. A Manager creates their OWN team: the server takes
 * the owning manager from the caller and rejects any other id, so no managerId is
 * sent from here. (An Owner-created team names a managerId, but that screen does
 * not exist yet — this function stays as narrow as the one screen behind it.)
 * 409 if the manager already has an active team.
 */
export function createTeam(input: { name: string }): Promise<TeamCreated> {
  return request<TeamCreated>('/auth/teams', { method: 'POST', body: input });
}

/**
 * POST /api/auth/members — 201. A Manager adds a member to their own team; the
 * team is resolved from the caller server-side. Name + email only — roleTitle and
 * the workflow-step number (§1) are a later screen. Passcode goes to the invite
 * email, never returned. 409 if the email already exists in the org.
 */
export function createMember(input: {
  name: string;
  email: string;
}): Promise<MemberProvisioned> {
  return request<MemberProvisioned>('/auth/members', { method: 'POST', body: input });
}

/**
 * POST /api/auth/manager/first-login — 200.
 *
 * One atomic step: consumes the single-use passcode and sets the permanent
 * password. Replaying the passcode returns the same 401 as a wrong one.
 */
export function managerFirstLogin(input: {
  email: string;
  passcode: string;
  newPassword: string;
}): Promise<AuthResult> {
  return request<AuthResult>('/auth/manager/first-login', {
    method: 'POST',
    body: input,
    authenticated: false,
  });
}

/** GET /api/me — the authoritative session view, re-read from the row. */
export function me(): Promise<MeResponse> {
  return request<MeResponse>('/me');
}

/**
 * GET /api/auth/teams — the teams the session may see. Owner: every team in the
 * org; Manager: only their own (RLS scopes it server-side, one query for both).
 * Counts exclude the manager (§ TeamListRow).
 */
export function listTeams(): Promise<TeamListRow[]> {
  return request<TeamListRow[]>('/auth/teams');
}

/**
 * GET /api/auth/managers — Owner-only org-wide manager directory. A manager
 * calling this gets a 403 (ApiError status 403), not a one-row list of self.
 */
export function listManagers(): Promise<ManagerListRow[]> {
  return request<ManagerListRow[]>('/auth/managers');
}

/**
 * GET /api/auth/teams/:id/members — the members-only roster of one team.
 *
 * `teamId` is a UUID from our own team list, but it is still encoded: the server
 * answers a cross-tenant or malformed id with a byte-identical 404 (@OwnedResource
 * decides that before the DB), so the client never needs to special-case it.
 */
export function listTeamMembers(teamId: string): Promise<MemberRow[]> {
  return request<MemberRow[]>(`/auth/teams/${encodeURIComponent(teamId)}/members`);
}

/** GET /api/auth/managers/:id/impact — Owner only pre-deletion impact analysis */
export function getManagerImpact(managerId: string): Promise<ManagerImpactStats> {
  return request<ManagerImpactStats>(`/auth/managers/${encodeURIComponent(managerId)}/impact`);
}

/** DELETE /api/auth/managers/:id — Owner only cascading soft delete */
export function deleteManager(managerId: string): Promise<{ message: string }> {
  return request<{ message: string }>(`/auth/managers/${encodeURIComponent(managerId)}`, {
    method: 'DELETE',
  });
}

/** GET /api/auth/managers/deleted — Owner only 30-day recoverable managers */
export function getDeletedManagers(): Promise<DeletedManager[]> {
  return request<DeletedManager[]>('/auth/managers/deleted');
}

/** POST /api/auth/managers/:id/restore — Owner only 1-click restore */
export function restoreManager(managerId: string): Promise<{ message: string }> {
  return request<{ message: string }>(`/auth/managers/${encodeURIComponent(managerId)}/restore`, {
    method: 'POST',
  });
}

/** DELETE /api/auth/members/:id — Owner or Manager soft deactivation */
export function deactivateMember(memberId: string): Promise<{ message: string }> {
  return request<{ message: string }>(`/auth/members/${encodeURIComponent(memberId)}`, {
    method: 'DELETE',
  });
}

/** POST /api/auth/passcode/request-reset — Public rate-limited passcode recovery */
export function requestPasscodeReset(email: string): Promise<{ message: string }> {
  return request<{ message: string }>('/auth/passcode/request-reset', {
    method: 'POST',
    body: { email },
    authenticated: false,
  });
}
