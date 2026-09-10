/**
 * The owner's full team directory — a dense list (CLAUDE.md §9's default view),
 * one row per team, each linking to the team's drill-down. The Overview grid is
 * the recent-six; this is all of them.
 *
 * GET /api/auth/teams is RLS-scoped, so this is safe for a manager too — they
 * would see only their own team — but the screen is framed as the owner's
 * org-wide view and is owner-only at the route.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Crown, UserPlus } from 'lucide-react';
import { listTeams } from '../api/auth';
import type { MemberProvisioned, TeamListRow } from '../api/types';
import { useAsync } from '../lib/useAsync';
import { AsyncView } from '../components/AsyncView';
import { Avatar } from '../components/Avatar';
import { StatusChip } from '../components/StatusChip';
import { Button } from '../components/Button';
import { InviteResult } from '../components/InviteResult';
import { AddMemberModal } from '../components/AddMemberModal';
import { fmtDateTime } from '../lib/format';

export function Teams() {
  const [showAdd, setShowAdd] = useState(false);
  const [lastAdded, setLastAdded] = useState<MemberProvisioned | null>(null);
  const { state, reload } = useAsync(() => listTeams());

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-semibold">All teams</h1>
          <p className="text-muted mt-0.5 text-sm">
            Every manager’s team across the organization — your full-visibility view.
          </p>
        </div>
        {state.status === 'success' && state.data.length > 0 && (
          <Button onClick={() => setShowAdd(true)} className="w-full sm:w-auto justify-center">
            <UserPlus size={15} className="-ml-1" />
            Add member to team
          </Button>
        )}
      </div>

      {lastAdded !== null && (
        <div className="mt-5">
          <InviteResult
            name={lastAdded.name}
            inviteEmailSent={lastAdded.inviteEmailSent}
            passcodeExpiresAt={lastAdded.passcodeExpiresAt}
            action="added"
          />
        </div>
      )}

      <div className="mt-5">
        <AsyncView state={state}>
          {(teams) => (teams.length === 0 ? <EmptyState /> : <TeamList teams={teams} />)}
        </AsyncView>
      </div>

      {showAdd && state.status === 'success' && state.data.length > 0 && (
        <AddMemberModal
          onClose={() => setShowAdd(false)}
          teams={state.data}
          onCreated={(member) => {
            setLastAdded(member);
            setShowAdd(false);
            reload();
          }}
        />
      )}
    </div>
  );
}

function TeamList({ teams }: { teams: TeamListRow[] }) {
  return (
    <div className="border-hairline dark:border-[#222738] overflow-hidden rounded-xl border bg-white dark:bg-[#151821]">
      {teams.map((team) => (
        <Link
          key={team.id}
          to={`/teams/${team.id}`}
          className="border-hairline dark:border-[#222738] hover:bg-cool-slate dark:hover:bg-slate-800/50 flex items-center gap-3 border-b px-4 py-3 last:border-0"
        >
          <Avatar name={team.managerName} size={34} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-ink dark:text-slate-100">{team.name}</div>
            <div className="text-faint flex items-center gap-1 text-xs">
              <Crown size={11} className="text-amber shrink-0" />
              <span className="truncate">
                {team.managerName} · {team.managerEmail}
              </span>
            </div>
          </div>
          <div className="hidden text-right sm:block">
            <div className="text-ink dark:text-slate-100 text-sm font-medium tabular-nums">{team.memberCount}</div>
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
    <div className="border-hairline dark:border-[#222738] rounded-xl border bg-white dark:bg-[#151821] p-10 text-center">
      <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">No teams yet</h2>
      <p className="text-muted dark:text-slate-400 mx-auto mt-1.5 max-w-md text-sm">
        Teams appear here as your managers create them. Add a manager from the Managers screen to
        get started.
      </p>
    </div>
  );
}
