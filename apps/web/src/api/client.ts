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
 * The cost is real and deliberate: a page refresh drops the token, so the user
 * is signed out. Refresh-token rotation now exists server-side (task #8: POST
 * /api/auth/refresh returns a fresh pair, the refresh token in the body — not a
 * cookie). Wiring this client to persist that refresh token and restore the
 * session on load is a deferred step with its own storage decision, and is NOT
 * done here — so the refresh-signs-you-out trade still stands. When it is wired,
 * do NOT "fix" it by moving the ACCESS token into storage; that trades a visible
 * inconvenience for an invisible vulnerability.
 *
 * Keeping it out of React state also means it is never a prop, never in a
 * dependency array, and never serialised into a devtools snapshot.
 */

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

function messageFor(status: number, body: NestErrorBody | null): {
  message: string;
  fields: string[];
} {
  if (status === 401) return { message: CREDENTIALS_REJECTED, fields: [] };

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
  method?: 'GET' | 'POST';
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
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (authenticated && accessToken !== null) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    // fetch only rejects on a transport failure, so this is genuinely "the API
    // is not reachable" rather than any HTTP status.
    throw new ApiError(0, 'Could not reach the API. Is it running on port 3000?');
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
    );
    throw new ApiError(response.status, message, fields);
  }

  return parsed as T;
}
