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
   * anonymous every time. When task #8 adds a refresh cookie, a 'loading'
   * state comes back with it — the refresh call is what needs one.
   */
  const completeSignIn = useCallback(async (result: AuthResult) => {
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
    // affected". Server-side revocation arrives with refresh rotation (#8);
    // until then the access token simply expires.
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
