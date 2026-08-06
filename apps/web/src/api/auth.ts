/**
 * The five auth endpoints that exist today (task #6). Thin by design — every
 * one is a single request() call, so the interesting behaviour stays in
 * client.ts where it is written down once.
 *
 * Nothing here for teams, members, tasks or rankings: those endpoints do not
 * exist yet (tasks #7+), and a stub client function would be a place for the UI
 * to start pretending they do.
 */
import { request } from './client';
import type { AuthResult, ManagerProvisioned, MeResponse } from './types';

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
