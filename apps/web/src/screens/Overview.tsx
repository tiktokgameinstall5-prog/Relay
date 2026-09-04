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
import { Building2, Crown, UserPlus, Users, Activity, AlertTriangle, Trophy, CheckCircle2 } from 'lucide-react';
import { listManagers, listTeams } from '../api/auth';
import { getAnalyticsOverview, getBottlenecks } from '../api/analytics';
import type { ManagerListRow, TeamListRow, AnalyticsOverview, BottlenecksResponse } from '../api/types';
import { useAsync } from '../lib/useAsync';
import { AsyncView } from '../components/AsyncView';
import { StatTile } from '../components/StatTile';
import { TeamCard } from '../components/TeamCard';

const MAX_CARDS = 6;

export function Overview() {
  const { state } = useAsync(async () => {
    const [teams, managers, analytics, bottlenecks] = await Promise.all([
      listTeams(),
      listManagers(),
      getAnalyticsOverview().catch(() => null),
      getBottlenecks().catch(() => null),
    ]);
    return { teams, managers, analytics, bottlenecks };
  });

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="font-display text-xl font-semibold">Overview</h1>
      <p className="text-muted mt-0.5 text-sm">
        Your whole organization — every manager’s team, at a glance.
      </p>

      <div className="mt-5">
        <AsyncView state={state}>
          {({ teams, managers, analytics, bottlenecks }) => (
            <OverviewBody
              teams={teams}
              managers={managers}
              analytics={analytics}
              bottlenecks={bottlenecks}
            />
          )}
        </AsyncView>
      </div>
    </div>
  );
}

function OverviewBody({
  teams,
  managers,
  analytics,
  bottlenecks,
}: {
  teams: TeamListRow[];
  managers: ManagerListRow[];
  analytics: AnalyticsOverview | null;
  bottlenecks: BottlenecksResponse | null;
}) {
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

      {analytics && (
        <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className="border-hairline rounded-xl border bg-white p-5">
            <div className="text-muted flex items-center gap-1.5 text-xs font-medium">
              <CheckCircle2 size={13} className="text-[#00C875]" />
              <span>Completion rate</span>
            </div>
            <div className="font-display mt-2 text-3xl font-bold tabular-nums text-[#00C875]">
              {analytics.tasks.completionRate}%
            </div>
          </div>

          <StatTile
            label="Total tasks"
            value={analytics.tasks.total}
            icon={<Activity size={13} />}
          />

          <div className="border-hairline rounded-xl border bg-white p-5">
            <div className="text-muted flex items-center gap-1.5 text-xs font-medium">
              <Trophy size={13} className="text-[#0073EA]" />
              <span>Avg member score</span>
            </div>
            <div className="font-display mt-2 text-3xl font-bold tabular-nums text-[#0073EA]">
              {analytics.rankings.averageRanking ? Math.round(analytics.rankings.averageRanking) : '—'}
            </div>
          </div>

          <div className="border-hairline rounded-xl border bg-white p-5">
            <div className="text-muted flex items-center gap-1.5 text-xs font-medium">
              <Crown size={13} className="text-[#FDAB3D]" />
              <span>Top performer</span>
            </div>
            <div className="font-display mt-2 truncate text-2xl font-bold text-[#FDAB3D]">
              {analytics.rankings.topPerformer ? analytics.rankings.topPerformer.name.split(' ')[0] : '—'}
            </div>
          </div>
        </div>
      )}

      {bottlenecks && bottlenecks.bottlenecks.length > 0 && (
        <div className="border-hairline mt-6 rounded-xl border bg-white p-5">
          <div className="mb-3 flex items-center gap-2 text-[#FDAB3D]">
            <AlertTriangle size={16} />
            <h2 className="font-display text-[15px] font-semibold text-[#161A22]">Workflow Bottlenecks</h2>
          </div>
          <p className="text-xs text-[#68707C]">
            These steps exceeded the average duration ({bottlenecks.averageStepDurationSeconds}s) and may require attention:
          </p>
          <div className="mt-3 divide-y divide-[#F4F5F8]">
            {bottlenecks.bottlenecks.map((b) => (
              <div key={b.stepId} className="flex items-center justify-between py-2 text-xs">
                <div>
                  <span className="font-medium text-[#161A22]">{b.taskName}</span>{' '}
                  <span className="text-[#9AA1AC]">· Step {b.stepOrder} ({b.memberName})</span>
                </div>
                <span className="font-mono font-semibold text-[#FDAB3D]">
                  {b.durationFormatted}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

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
