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
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { clearToken, setToken } from '../api/client';
import { me } from '../api/auth';
import type { AuthResult, MeResponse } from '../api/types';

type Status = 'anon' | 'authed';

interface AuthContextValue {
  user: MeResponse | null;
  status: Status;
  /** Take an auth result, store the token, then load the real profile. */
  completeSignIn: (result: AuthResult) => Promise<MeResponse>;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<MeResponse | null>(null);

  /**
   * No bootstrap-from-storage effect and no 'loading' status: with an
   * in-memory token there is nothing to restore on mount, so the app starts
   * anonymous every time. Task #8 shipped refresh rotation server-side, so a
   * restore-on-load path is now buildable — wiring it (and the 'loading' state
   * the refresh call then needs) is a deferred step, not done here.
   */
  const completeSignIn = useCallback(async (result: AuthResult) => {
    // result.refreshToken is intentionally dropped here: persisting it is the
    // deferred restore-on-load work (see api/client.ts). Only the access token
    // is kept, and only in memory.
    setToken(result.accessToken);
    try {
      const profile = await me();
      setUser(profile);
      return profile;
    } catch (error) {
      // A token we cannot use is worse than none: it would make the app look
      // signed in while every request 401s.
      clearToken();
      setUser(null);
      throw error;
    }
  }, []);

  const signOut = useCallback(() => {
    // Local only. CLAUDE.md §1: "logout only ends the session — no data is
    // affected". Server-side revocation now exists (task #8: POST /api/auth/
    // logout), but this client does not call it yet — it belongs with the
    // deferred refresh-token wiring. Today the access token simply expires.
    clearToken();
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      status: user === null ? 'anon' : 'authed',
      completeSignIn,
      signOut,
    }),
    [user, completeSignIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx === null) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
