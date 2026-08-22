/**
 * The refresh-token cookie — the browser half of the session transport.
 *
 * CLAUDE.md §6 mandates ONE API shared by the web app and the Flutter client, so
 * the refresh token still travels in the response body for the mobile client,
 * which has no cookie jar. This file adds a SECOND, browser-only channel: the
 * same rotated token, set as an HttpOnly cookie the page's JavaScript cannot
 * read. The access token stays in memory (never a cookie, never localStorage);
 * only the long-lived refresh token needs a store that survives an F5, and an
 * HttpOnly cookie is that store without exposing the token to script.
 *
 * Each attribute is load-bearing, not habit:
 *   • HttpOnly — an XSS payload can call fetch() as the user but cannot read this
 *     cookie, so it cannot exfiltrate the refresh token. This is the whole reason
 *     the token is not just kept in a JS-readable place.
 *   • Secure — never sent over plaintext HTTP, so a network observer never sees
 *     it. Browsers make an explicit exception for http://localhost (treated as a
 *     secure context), so this still works in dev without TLS.
 *   • SameSite=Lax — the browser does not attach this cookie to a cross-site POST,
 *     which is exactly the shape a CSRF against session/refresh or session/logout
 *     would take. Combined with the access token living in an Authorization header
 *     (so every state-changing route is unreachable by a cookie-only forged
 *     request), this closes the CSRF surface without a separate token.
 *   • Path=/api/auth/session — the TIGHTEST scope that still covers both routes
 *     that read this cookie. refresh and logout live at
 *     /api/auth/session/{refresh,logout}; every other /api/auth/* route (signup,
 *     login, first-login, provisioning, the directory reads) neither reads nor
 *     needs the cookie, so scoping here stops the browser from even attaching it to
 *     them. Logout must also RECEIVE the cookie — a browser cannot read its own
 *     HttpOnly cookie to place the token in the logout body — so the path has to
 *     cover logout as well as refresh; the session sub-namespace does exactly that
 *     and nothing more.
 *
 * A stolen cookie still only buys rotation, which reuse-detection then catches
 * and burns the whole family (see AuthService.refresh) — defence in depth, not a
 * single wall.
 *
 * Cookies are handled with Express's built-in res.cookie / res.clearCookie and a
 * hand-rolled header parse on the way in, so no cookie-parser middleware is added
 * — the dependency surface the §12 review sees stays unchanged.
 */
import type { Request, Response } from 'express';

/** Cookie name. Opaque and un-prefixed on purpose — it reveals nothing. */
export const REFRESH_COOKIE = 'relay_rt';

/**
 * Scope the cookie to the session sub-namespace: the only two routes that read it,
 * /api/auth/session/{refresh,logout}, live under here. See the file header for why
 * this is /api/auth/session and not the broader /api/auth or a refresh-only path.
 */
export const REFRESH_COOKIE_PATH = '/api/auth/session';

/**
 * The attributes shared by set and clear. clearCookie must be given the SAME
 * path (and flags) the cookie was set with, or the browser treats it as a
 * different cookie and keeps the original — hence one BASE for both.
 */
const BASE = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax' as const,
  path: REFRESH_COOKIE_PATH,
};

/**
 * Set (or replace) the refresh cookie. `maxAgeSeconds` should track the refresh
 * token's own TTL so the cookie and the server-side row expire together — a
 * cookie outliving its token would only ever yield a 401, and a token outliving
 * its cookie would strand a still-valid session the browser can no longer see.
 * Express takes maxAge in milliseconds.
 */
export function setRefreshCookie(res: Response, token: string, maxAgeSeconds: number): void {
  res.cookie(REFRESH_COOKIE, token, { ...BASE, maxAge: maxAgeSeconds * 1000 });
}

/**
 * Clear the refresh cookie (empty value, expiry in the past). Called on logout
 * alongside the server-side family revocation, and safe to call when no cookie
 * was present — clearing an absent cookie is a no-op for the browser.
 */
export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, BASE);
}

/**
 * Read the refresh token out of the incoming Cookie header, or undefined if it
 * is absent. Parsed by hand rather than via cookie-parser: we need exactly one
 * cookie, the header is a simple `name=value; name=value` list, and adding
 * middleware for one lookup would enlarge the dependency surface for no gain.
 * The value is decoded because res.cookie url-encodes on the way out (a no-op for
 * our base64url tokens, but correct for any value).
 */
export function readRefreshCookie(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === REFRESH_COOKIE) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return undefined;
}
