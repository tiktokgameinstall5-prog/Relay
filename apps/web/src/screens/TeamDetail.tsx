/**
 * A single team's drill-down: the team header (name + manager) over its roster.
 */
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Crown } from 'lucide-react';
import { deactivateMember, listTeamMembers, listTeams } from '../api/auth';
import { ApiError } from '../api/client';
import type { MemberRow, TeamListRow } from '../api/types';
import { useAsync } from '../lib/useAsync';
import { AsyncView } from '../components/AsyncView';
import { Avatar } from '../components/Avatar';
import { StatTile } from '../components/StatTile';
import { MemberRoster } from '../components/MemberRoster';
import { Panel } from '../components/Panel';
import { Alert } from '../components/Alert';

export function TeamDetail() {
  const { teamId = '' } = useParams();
  const [deactivateError, setDeactivateError] = useState<string | null>(null);

  const { state, reload } = useAsync(async () => {
    const [teams, members] = await Promise.all([listTeams(), listTeamMembers(teamId)]);
    return { team: teams.find((t) => t.id === teamId) ?? null, members };
  }, teamId);

  const handleDeactivate = async (member: MemberRow) => {
    setDeactivateError(null);
    if (!window.confirm(`Are you sure you want to deactivate ${member.name}?`)) return;
    try {
      await deactivateMember(member.id);
      reload();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setDeactivateError(
          'Cannot deactivate member with active task steps. Please reassign their active steps first.',
        );
      } else {
        setDeactivateError((err as Error).message || 'Failed to deactivate member.');
      }
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        to="/teams"
        className="text-muted hover:text-ink mb-4 inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft size={14} /> All teams
      </Link>

      {deactivateError !== null && (
        <div className="mb-4">
          <Alert>{deactivateError}</Alert>
        </div>
      )}

      <AsyncView state={state}>
        {({ team, members }) =>
          team === null ? (
            <NotFound />
          ) : (
            <TeamBody
              team={team}
              members={members}
              onDeactivate={handleDeactivate}
            />
          )
        }
      </AsyncView>
    </div>
  );
}

function TeamBody({
  team,
  members,
  onDeactivate,
}: {
  team: TeamListRow;
  members: MemberRow[];
  onDeactivate?: (member: MemberRow) => void;
}) {
  const activeCount = members.filter((m) => m.status === 'active').length;
  const pendingCount = members.filter((m) => m.pendingInvite).length;

  return (
    <>
      <div className="flex items-center gap-3">
        <Avatar name={team.managerName} size={44} />
        <div className="min-w-0">
          <h1 className="font-display truncate text-xl font-semibold">{team.name}</h1>
          <div className="text-faint flex items-center gap-1 text-sm">
            <Crown size={12} className="text-amber shrink-0" />
            <span className="truncate">
              {team.managerName} · {team.managerEmail}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-4">
        <StatTile label="Members" value={activeCount} />
        <StatTile label="Pending invites" value={pendingCount} />
      </div>

      <h2 className="font-display mt-8 mb-3 text-[15px] font-semibold">Roster</h2>
      {members.length === 0 ? (
        <Panel title="No members yet">
          <p>
            This team has no members yet. The manager adds members from their own team screen — the
            same invite flow you use for managers.
          </p>
        </Panel>
      ) : (
        <MemberRoster members={members} onDeactivate={onDeactivate} />
      )}
    </>
  );
}

function NotFound() {
  return (
    <Panel title="Team not found">
      <p>This team doesn’t exist, or it isn’t one you can view.</p>
    </Panel>
  );
}
