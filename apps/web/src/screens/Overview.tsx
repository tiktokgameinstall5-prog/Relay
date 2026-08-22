/**
 * The owner's home: four real-number tiles over a grid of recent teams. Every
 * number is derived from the two list-reads — nothing here is a placeholder
 * (that is the whole reason there are no task/report tiles yet; those tables do
 * not exist, so a tile for them would be a zero that lies about being real).
 *
 * Loads GET /api/auth/teams and /api/auth/managers together. Owner-only at the
 * route (RequireRole) — listManagers 403s for anyone else by design.
 */
import { Link } from 'react-router-dom';
import { Building2, Crown, UserPlus, Users } from 'lucide-react';
import { listManagers, listTeams } from '../api/auth';
import type { ManagerListRow, TeamListRow } from '../api/types';
import { useAsync } from '../lib/useAsync';
import { AsyncView } from '../components/AsyncView';
import { StatTile } from '../components/StatTile';
import { TeamCard } from '../components/TeamCard';

const MAX_CARDS = 6;

export function Overview() {
  const { state } = useAsync(async () => {
    const [teams, managers] = await Promise.all([listTeams(), listManagers()]);
    return { teams, managers };
  });

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="font-display text-xl font-semibold">Overview</h1>
      <p className="text-muted mt-0.5 text-sm">
        Your whole organization — every manager’s team, at a glance.
      </p>

      <div className="mt-5">
        <AsyncView state={state}>
          {({ teams, managers }) => <OverviewBody teams={teams} managers={managers} />}
        </AsyncView>
      </div>
    </div>
  );
}

function OverviewBody({ teams, managers }: { teams: TeamListRow[]; managers: ManagerListRow[] }) {
  const membersCount = teams.reduce((sum, t) => sum + t.memberCount, 0);

  // Pending invites = member invites + manager invites. The two sets are
  // disjoint: memberCount/pendingInviteCount filter role='member' server-side,
  // and managers are counted from their own list — so summing never
  // double-counts a person.
  const pendingCount =
    teams.reduce((sum, t) => sum + t.pendingInviteCount, 0) +
    managers.filter((m) => m.pendingInvite).length;

  // ISO timestamps sort lexicographically, so this is newest-first.
  const recent = [...teams].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, MAX_CARDS);

  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Teams" value={teams.length} icon={<Building2 size={13} />} />
        <StatTile label="Managers" value={managers.length} icon={<Crown size={13} />} />
        <StatTile label="Members" value={membersCount} icon={<Users size={13} />} />
        <StatTile label="Pending invites" value={pendingCount} icon={<UserPlus size={13} />} />
      </div>

      {teams.length === 0 ? (
        <EmptyTeams hasManagers={managers.length > 0} />
      ) : (
        <div className="mt-8">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-[15px] font-semibold">Recent teams</h2>
            {teams.length > MAX_CARDS && (
              <Link to="/teams" className="text-signal text-sm font-semibold hover:underline">
                View all {teams.length} teams →
              </Link>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {recent.map((team) => (
              <TeamCard key={team.id} team={team} />
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/** Shown when the org has no teams yet. A styled Link, not a <Button> inside an
 *  <a> (nesting a button in an anchor is invalid HTML). */
function EmptyTeams({ hasManagers }: { hasManagers: boolean }) {
  return (
    <div className="border-hairline mt-8 rounded-xl border bg-white p-10 text-center">
      <div className="bg-signal-soft mx-auto flex h-12 w-12 items-center justify-center rounded-xl">
        <Building2 size={22} className="text-signal" />
      </div>
      <h2 className="font-display mt-4 text-base font-semibold">No teams yet</h2>
      <p className="text-muted mx-auto mt-1.5 max-w-md text-sm">
        {hasManagers
          ? 'Your managers haven’t created their teams yet. Each manager builds and runs exactly one team.'
          : 'Start by adding a manager. Managers can’t sign themselves up — you create the account, and they build and run their own team.'}
      </p>
      <Link
        to="/managers"
        className="bg-signal hover:bg-signal-hover mt-5 inline-block rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition-colors"
      >
        {hasManagers ? 'Manage managers' : 'Add your first manager'}
      </Link>
    </div>
  );
}
