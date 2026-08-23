/**
 * Session state for the app.
 *
 * The token is deliberately NOT here — it lives in api/client.ts in a
 * module-scoped variable (see the comment there). This context holds only the
 * user profile, which is safe to render and safe to keep in React state.
 *
 * /api/me is the source of truth for role / orgId / managerId, not the login
 * response. Same principle the backend applies in JwtStrategy.validate(), which
 * re-reads the user row on every request rather than trusting token claims: the
 * token's only assertion is "which user am I".
 *
 * SESSION RESTORE. The access token is in-memory only, so a page reload drops it.
 * On mount we try to restore the session from the HttpOnly relay_rt cookie (set
 * by the server on login/signup/first-login/refresh) via POST
 * /api/auth/session/refresh — the page's JS cannot read that cookie, but the
 * browser sends it on the same-origin refresh call and the rotated access token
 * comes back in the response body. Until that resolves the status is 'loading';
 * it then becomes 'authed' (a valid cookie) or 'anon' (none). That is what keeps
 * an F5 from signing the user out without ever exposing the token to script.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { clearToken, logoutSession, refreshSession, setToken } from '../api/client';
import { me } from '../api/auth';
import type { AuthResult, MeResponse } from '../api/types';

type Status = 'loading' | 'anon' | 'authed';

interface AuthContextValue {
  user: MeResponse | null;
  status: Status;
  /** Take an auth result, store the token, then load the real profile. */
  completeSignIn: (result: AuthResult) => Promise<MeResponse>;
  /** Revoke the session server-side (best-effort), then clear it locally. */
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * The mount-time session restore, memoised at module scope.
 *
 * React StrictMode runs mount effects twice in development, and this call is NOT
 * idempotent: POST /api/auth/session/refresh ROTATES the refresh token, and the
 * server trips reuse-detection if the same cookie value is presented twice (it
 * cannot tell a double-mount from a stolen token, so it burns the whole family).
 * The usual "ignore the late response" guard does not help here — it suppresses
 * the second response but still FIRES the second request. Memoising the in-flight
 * promise at module scope (which survives StrictMode's mount/unmount/mount,
 * because the module itself is not re-evaluated) guarantees exactly one refresh
 * per page load.
 *
 * Resolves to the profile on success, or null when there is no usable cookie (a
 * first-time visitor, or an expired / already-rotated family): the caller reads
 * null as "anonymous", never as an error to surface.
 */
let bootstrapPromise: Promise<MeResponse | null> | null = null;

function bootstrapSession(): Promise<MeResponse | null> {
  if (bootstrapPromise === null) {
    bootstrapPromise = (async () => {
      try {
        const result = await refreshSession();
        setToken(result.accessToken);
        return await me();
      } catch {
        // No cookie, or an expired / rotated / burned family: the uniform 401
        // lands here. Clear any token set before a later step failed, so the app
        // can never look half-signed-in.
        clearToken();
        return null;
      }
    })();
  }
  return bootstrapPromise;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<MeResponse | null>(null);
  const [status, setStatus] = useState<Status>('loading');

  useEffect(() => {
    let active = true;
    void bootstrapSession().then((profile) => {
      if (!active) return;
      setUser(profile);
      setStatus(profile === null ? 'anon' : 'authed');
    });
    return () => {
      active = false;
    };
  }, []);

  const completeSignIn = useCallback(async (result: AuthResult) => {
    // The web client restores itself from the HttpOnly relay_rt cookie the server
    // set alongside this response; result.refreshToken (the body copy, there for
    // the cookie-less mobile client, §6) is intentionally not stored. Only the
    // access token is kept, and only in memory.
    setToken(result.accessToken);
    try {
      const profile = await me();
      setUser(profile);
      setStatus('authed');
      return profile;
    } catch (error) {
      // A token we cannot use is worse than none: it would make the app look
      // signed in while every request 401s.
      clearToken();
      setUser(null);
      setStatus('anon');
      throw error;
    }
  }, []);

  const signOut = useCallback(async () => {
    // CLAUDE.md §1/§5: logout only ends the session — no data is affected. Revoke
    // the refresh-token family and clear the cookie server-side first
    // (POST /api/auth/session/logout, cookie-carried). Best-effort: the route is
    // idempotent and we drop the local token regardless, so a failed call still
    // signs this client out — the worst case is a server-side token left to
    // expire on its own TTL.
    try {
      await logoutSession();
    } catch {
      // Swallowed on purpose: nothing to recover, and the local clear below is
      // what actually ends the session on this client.
    }
    clearToken();
    setUser(null);
    setStatus('anon');
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      status,
      completeSignIn,
      signOut,
    }),
    [user, status, completeSignIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx === null) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
