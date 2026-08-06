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

/** POST /api/auth/owner/signup, /api/auth/login, /api/auth/manager/first-login */
export interface AuthResult {
  accessToken: string;
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
