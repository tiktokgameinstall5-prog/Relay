/**
 * Role gate for screens that only one role can use.
 *
 * THE UI IS NOT THE ISOLATION BOUNDARY. This component is ergonomics: it stops
 * a Manager from staring at an Owner-only form that would only ever 403. What
 * actually enforces CLAUDE.md §1 is RolesGuard on the server, plus the
 * row-level policies underneath it.
 *
 * So: never remove or weaken a server-side check on the grounds that "the UI
 * already hides it". Anyone can call the API directly, and the isolation test
 * required by §11 exercises exactly that path.
 *
 * Renders a refusal rather than redirecting, deliberately — a silent bounce to
 * another page reads as a broken link, whereas "your role cannot open this"
 * is the true statement.
 */
import type { ReactNode } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from './AuthContext';
import type { UserRole } from '../api/types';
import { Panel } from '../components/Panel';

export function RequireRole({ role, children }: { role: UserRole; children: ReactNode }) {
  const { user } = useAuth();

  if (user !== null && user.role !== role) {
    return (
      <Panel
        icon={<ShieldAlert size={18} className="text-red-500" />}
        title="Not available for your role"
      >
        <p>
          This screen is for the <strong>{role}</strong> role. You are signed in as a{' '}
          <strong>{user.role}</strong>.
        </p>
        <p className="mt-2">
          The server enforces this independently — requesting it directly returns 403.
        </p>
      </Panel>
    );
  }

  return <>{children}</>;
}
