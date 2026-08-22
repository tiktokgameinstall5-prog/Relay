/**
 * The owner's full team directory — a dense list (CLAUDE.md §9's default view),
 * one row per team, each linking to the team's drill-down. The Overview grid is
 * the recent-six; this is all of them.
 *
 * GET /api/auth/teams is RLS-scoped, so this is safe for a manager too — they
 * would see only their own team — but the screen is framed as the owner's
 * org-wide view and is owner-only at the route.
 */
import { Link } from 'react-router-dom';
import { Crown } from 'lucide-react';
import { listTeams } from '../api/auth';
import type { TeamListRow } from '../api/types';
import { useAsync } from '../lib/useAsync';
import { AsyncView } from '../components/AsyncView';
import { Avatar } from '../components/Avatar';
import { StatusChip } from '../components/StatusChip';
import { fmtDateTime } from '../lib/format';

export function Teams() {
  const { state } = useAsync(() => listTeams());

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="font-display text-xl font-semibold">All teams</h1>
      <p className="text-muted mt-0.5 text-sm">
        Every manager’s team across the organization — your full-visibility view.
      </p>

      <div className="mt-5">
        <AsyncView state={state}>
          {(teams) => (teams.length === 0 ? <EmptyState /> : <TeamList teams={teams} />)}
        </AsyncView>
      </div>
    </div>
  );
}

function TeamList({ teams }: { teams: TeamListRow[] }) {
  return (
    <div className="border-hairline overflow-hidden rounded-xl border bg-white">
      {teams.map((team) => (
        <Link
          key={team.id}
          to={`/teams/${team.id}`}
          className="border-hairline hover:bg-cool-slate flex items-center gap-3 border-b px-4 py-3 last:border-0"
        >
          <Avatar name={team.managerName} size={34} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{team.name}</div>
            <div className="text-faint flex items-center gap-1 text-xs">
              <Crown size={11} className="text-amber shrink-0" />
              <span className="truncate">
                {team.managerName} · {team.managerEmail}
              </span>
            </div>
          </div>
          <div className="hidden text-right sm:block">
            <div className="text-ink text-sm font-medium tabular-nums">{team.memberCount}</div>
            <div className="text-faint text-[11px]">
              member{team.memberCount === 1 ? '' : 's'}
            </div>
          </div>
          {team.pendingInviteCount > 0 && (
            <StatusChip status="pending" label={`${team.pendingInviteCount} pending`} />
          )}
          <div className="text-faint hidden font-mono text-[11px] md:block">
            {fmtDateTime(team.createdAt)}
          </div>
        </Link>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="border-hairline rounded-xl border bg-white p-10 text-center">
      <h2 className="font-display text-base font-semibold">No teams yet</h2>
      <p className="text-muted mx-auto mt-1.5 max-w-md text-sm">
        Teams appear here as your managers create them. Add a manager from the Managers screen to
        get started.
      </p>
    </div>
  );
}
