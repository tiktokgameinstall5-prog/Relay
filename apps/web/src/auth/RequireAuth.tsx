/**
 * Gate for routes that need a session.
 *
 * This is navigation, not security. It stops a signed-out user from landing on
 * a screen that would fire 401s; it is not what protects any data. Every
 * protected route on the API is behind the global JwtAuthGuard regardless of
 * what this component does.
 */
import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { BootSplash } from '../components/BootSplash';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    // The mount-time session restore is still in flight. Show the neutral boot
    // splash rather than redirecting, so a user with a valid relay_rt cookie is
    // not bounced to /login before their session resolves.
    return <BootSplash />;
  }

  if (status === 'anon') {
    // `from` lets /login send the user back where they were aiming. It is only
    // a path, never a token or any other credential.
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
