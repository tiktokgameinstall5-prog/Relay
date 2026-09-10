import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { Avatar } from '../components/Avatar';
import { Panel } from '../components/Panel';
import { Button } from '../components/Button';
import { ThemeSegmentedControl } from '../components/ThemeToggle';
import {
  Building2,
  CheckCircle2,
  Crown,
  KeyRound,
  LogOut,
  Mail,
  Shield,
  Trophy,
  User,
  Users,
} from 'lucide-react';

export function Profile() {
  const { user, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  if (!user) return null;

  async function handleSignOut() {
    setSigningOut(true);
    await signOut();
  }

  const roleLabel =
    user.role === 'owner'
      ? 'Organization Owner'
      : user.role === 'manager'
        ? 'Team Manager'
        : 'Team Member';

  const roleBadgeColor =
    user.role === 'owner'
      ? 'bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800/60'
      : user.role === 'manager'
        ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800/60'
        : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/60';

  const RoleIcon =
    user.role === 'owner' ? Crown : user.role === 'manager' ? Shield : User;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Header Banner & Avatar */}
      <Panel className="overflow-hidden border border-hairline dark:border-[#222738] bg-white dark:bg-[#151821] shadow-sm">
        <div className="h-28 bg-gradient-to-r from-blue-600 to-indigo-700 p-6 flex items-end">
          <span className="text-white/80 text-xs font-medium uppercase tracking-wider">
            {user.organizationName}
          </span>
        </div>
        <div className="px-6 pb-6 pt-0">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 -mt-10 mb-4">
            <div className="flex items-end gap-4">
              <div className="rounded-2xl ring-4 ring-white dark:ring-[#151821] bg-white dark:bg-[#151821] shadow-md p-1">
                <Avatar name={user.name} size={72} />
              </div>
              <div className="mb-1">
                <h1 className="text-xl font-bold text-ink dark:text-slate-100">{user.name}</h1>
                <p className="text-sm text-muted dark:text-slate-400">{user.email}</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${roleBadgeColor}`}
              >
                <RoleIcon size={13} />
                {roleLabel}
              </span>
            </div>
          </div>
        </div>
      </Panel>

      {/* Main Details Grid */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* Personal Details */}
        <Panel title="Personal Information" className="space-y-4">
          <div>
            <label className="text-xs font-medium text-muted uppercase tracking-wider">
              Full Name
            </label>
            <div className="mt-1 flex items-center gap-2 text-sm font-medium text-ink">
              <User size={16} className="text-muted" />
              {user.name}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted uppercase tracking-wider">
              Email Address
            </label>
            <div className="mt-1 flex items-center gap-2 text-sm font-medium text-ink">
              <Mail size={16} className="text-muted" />
              {user.email}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted uppercase tracking-wider">
              Role Title
            </label>
            <div className="mt-1 text-sm font-medium text-ink">
              {user.roleTitle || (user.role === 'owner' ? 'Owner / Founder' : 'Standard Member')}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted uppercase tracking-wider">
              Account Status
            </label>
            <div className="mt-1 flex items-center gap-1.5 text-sm font-medium text-emerald-600">
              <CheckCircle2 size={16} />
              Active & Verified
            </div>
          </div>
        </Panel>

        {/* Organization & Team Information */}
        <Panel title="Organization & Team" className="space-y-4">
          <div>
            <label className="text-xs font-medium text-muted uppercase tracking-wider">
              Organization
            </label>
            <div className="mt-1 flex items-center gap-2 text-sm font-medium text-ink">
              <Building2 size={16} className="text-muted" />
              {user.organizationName}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted uppercase tracking-wider">
              Assigned Role
            </label>
            <div className="mt-1 text-sm font-medium capitalize text-ink">
              {user.role}
            </div>
          </div>

          {user.role === 'member' && (
            <>
              <div>
                <label className="text-xs font-medium text-muted uppercase tracking-wider">
                  Performance Ranking
                </label>
                <div className="mt-1 flex items-center gap-2 text-sm font-semibold text-ink">
                  <Trophy size={16} className="text-amber-500" />
                  Score: {user.ranking} / 100
                </div>
              </div>

              {user.workflowStep !== null && (
                <div>
                  <label className="text-xs font-medium text-muted uppercase tracking-wider">
                    Default Relay Step
                  </label>
                  <div className="mt-1 text-sm font-medium text-ink">
                    Step {user.workflowStep}
                  </div>
                </div>
              )}

              <div>
                <label className="text-xs font-medium text-muted uppercase tracking-wider">
                  Designated Reporter
                </label>
                <div className="mt-1 text-sm font-medium text-ink">
                  {user.isReporter ? 'Yes (Can submit completion reports)' : 'No'}
                </div>
              </div>
            </>
          )}

          {user.role === 'manager' && (
            <div>
              <label className="text-xs font-medium text-muted uppercase tracking-wider">
                Management Scope
              </label>
              <div className="mt-1 flex items-center gap-2 text-sm font-medium text-ink">
                <Users size={16} className="text-muted" />
                Manages assigned team relay workflows
              </div>
            </div>
          )}

          {user.role === 'owner' && (
            <div>
              <label className="text-xs font-medium text-muted uppercase tracking-wider">
                Organization Scope
              </label>
              <div className="mt-1 flex items-center gap-2 text-sm font-medium text-ink">
                <Crown size={16} className="text-amber-500" />
                Full administrative access & visibility across all teams
              </div>
            </div>
          )}
        </Panel>
      </div>

      {/* Appearance & Interface Theme */}
      <Panel title="Appearance & Theme" className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium text-ink dark:text-slate-200">Color Theme</div>
            <p className="text-xs text-muted dark:text-slate-400 mt-1">
              Select between obsidian dark mode, crisp light mode, or automatic system sync.
            </p>
          </div>
          <ThemeSegmentedControl />
        </div>
      </Panel>

      {/* Account Security & Actions */}
      <Panel title="Session & Account Security" className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-ink">
              <KeyRound size={16} className="text-muted" />
              Authenticated Session
            </div>
            <p className="text-xs text-muted mt-1">
              Signed in as <span className="font-mono text-ink">{user.email}</span> with high-security JWT token.
            </p>
          </div>

          <Button
            variant="secondary"
            onClick={handleSignOut}
            disabled={signingOut}
            className="flex items-center gap-2 text-red-600 hover:text-red-700 hover:bg-red-50"
          >
            <LogOut size={15} />
            {signingOut ? 'Signing out…' : 'Sign out of Relay'}
          </Button>
        </div>
      </Panel>
    </div>
  );
}
