/**
 * The single fetch wrapper. Every request to the API goes through request().
 *
 * TOKEN STORAGE — read before changing.
 *
 * The access token lives in a module-scoped variable, not in localStorage,
 * sessionStorage, a cookie, or React state. Storage is readable by any script
 * that gets injected into the page, and an access token is a full session; a
 * module-scoped binding is not reachable from an XSS payload without already
 * having code execution inside this module's closure.
 *
 * The cost would be that a page refresh drops the token — so the session is
 * restored on load from the HttpOnly relay_rt cookie instead (task #8 rotation +
 * the cookie transport): AuthContext calls refreshSession() on mount, the browser
 * sends the cookie its own JS cannot read, and a fresh access token comes back in
 * the body. The ACCESS token still never leaves this module-scoped variable; do
 * NOT "fix" anything by moving it into storage, which would trade a visible
 * inconvenience for an invisible vulnerability.
 *
 * Keeping it out of React state also means it is never a prop, never in a
 * dependency array, and never serialised into a devtools snapshot.
 */

import type { AuthResult } from './types';

let accessToken: string | null = null;

export function setToken(token: string): void {
  accessToken = token;
}

export function clearToken(): void {
  accessToken = null;
}

export function hasToken(): boolean {
  return accessToken !== null;
}

export function getAccessToken(): string | null {
  return accessToken;
}

/**
 * A non-2xx response, normalised into one shape.
 *
 * `fields` carries ValidationPipe's per-field messages when there are any, so a
 * form can show them inline instead of dumping an array into a banner.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly fields: string[];

  constructor(status: number, message: string, fields: string[] = []) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.fields = fields;
  }
}

/**
 * WHY EVERY 401 GETS THE SAME SENTENCE.
 *
 * The API works hard to keep unknown-email, wrong-password, expired-passcode
 * and already-used-passcode byte-identical — auth.service.ts runs bcrypt
 * against a dummy hash even when no user was found, precisely so the responses
 * cannot be told apart. A UI that helpfully says "that passcode was already
 * used" reconstructs the oracle the backend spent that effort suppressing.
 *
 * So: one string for every 401, regardless of what the server said.
 */
const CREDENTIALS_REJECTED = "Those credentials weren't accepted.";

/** Nest's error body: {statusCode, message, error}, message string | string[]. */
interface NestErrorBody {
  statusCode?: number;
  message?: string | string[];
  error?: string;
}

function messageFor(status: number, body: NestErrorBody | null, path?: string): {
  message: string;
  fields: string[];
} {
  if (status === 401) {
    if (path && (path.includes('/login') || path.includes('/first-login'))) {
      return { message: CREDENTIALS_REJECTED, fields: [] };
    }
    return { message: 'Your session has expired. Please log in again.', fields: [] };
  }

  const raw = body?.message;

  // ValidationPipe returns an array of per-field messages.
  if (Array.isArray(raw) && raw.length > 0) {
    return { message: raw[0] ?? 'That request was rejected.', fields: raw };
  }

  if (typeof raw === 'string' && raw.length > 0) {
    return { message: raw, fields: [] };
  }

  if (status === 429) {
    return { message: 'Too many attempts. Wait a few minutes and try again.', fields: [] };
  }

  return { message: `Request failed (${String(status)}).`, fields: [] };
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE' | 'PATCH';
  body?: unknown;
  /**
   * Send the bearer token. Defaults to true — the public routes pass false so a
   * stale token from a previous session cannot ride along on a login attempt.
   */
  authenticated?: boolean;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, authenticated = true } = options;

  const headers: Record<string, string> = { Accept: 'application/json' };
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
  if (body !== undefined && !isFormData) {
    headers['Content-Type'] = 'application/json';
  }
  if (authenticated && accessToken !== null) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: isFormData ? body : JSON.stringify(body) } : {}),
    });
  } catch {
    // fetch only rejects on a transport failure, so this is genuinely "the API
    // is not reachable" rather than any HTTP status.
    throw new ApiError(0, 'Could not reach the API. Is it running on port 3000?');
  }

  // If 401 on an authenticated route and not the refresh endpoint itself, attempt silent refresh once
  if (response.status === 401 && authenticated && path !== '/auth/session/refresh') {
    try {
      const refreshed = await refreshSession();
      setToken(refreshed.accessToken);
      headers['Authorization'] = `Bearer ${refreshed.accessToken}`;
      response = await fetch(`/api${path}`, {
        method,
        headers,
        ...(body !== undefined ? { body: isFormData ? body : JSON.stringify(body) } : {}),
      });
    } catch {
      clearToken();
      throw new ApiError(401, 'Your session has expired. Please log in again.');
    }
  }

  // 204 has no body to parse. No endpoint returns one today, but a JSON.parse
  // on an empty string is an ugly way to find that out later.
  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let parsed: unknown = null;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  if (!response.ok) {
    const { message, fields } = messageFor(
      response.status,
      (parsed as NestErrorBody | null) ?? null,
      path,
    );
    throw new ApiError(response.status, message, fields);
  }

  return parsed as T;
}

/**
 * POST /api/auth/session/refresh — restore a session from the HttpOnly relay_rt
 * cookie. The body is empty by design: the browser cannot read its own HttpOnly
 * cookie to place the token in the body, so the server reads it from the cookie
 * (mobile sends it in the body instead — one API, §6). The cookie rides along on
 * this same-origin request automatically (the Vite dev proxy makes /api
 * same-origin, and the cookie's Path=/api/auth/session covers this route), so no
 * `credentials` option is needed. authenticated:false so a stale in-memory bearer
 * never rides along.
 *
 * Resolves with the rotated AuthResult (200); throws ApiError(401) when there is
 * no valid cookie. The server sets the rotated refresh token back as a fresh
 * cookie — the body copy is ignored by this client.
 */
export function refreshSession(): Promise<AuthResult> {
  return request<AuthResult>('/auth/session/refresh', {
    method: 'POST',
    body: {},
    authenticated: false,
  });
}

/**
 * POST /api/auth/session/logout — 204. Revokes the refresh-token family and
 * clears the relay_rt cookie server-side (a browser cannot clear an HttpOnly
 * cookie itself). Empty body: the server reads the token from the cookie.
 * Idempotent — a missing or already-revoked cookie still returns 204.
 */
export function logoutSession(): Promise<void> {
  return request<void>('/auth/session/logout', {
    method: 'POST',
    body: {},
    authenticated: false,
  });
}
