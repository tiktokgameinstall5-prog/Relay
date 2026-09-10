/**
 * A single team's drill-down: the team header (name + manager) over its roster.
 */
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Crown, UserPlus } from 'lucide-react';
import { deactivateMember, listTeamMembers, listTeams } from '../api/auth';
import { ApiError } from '../api/client';
import type { MemberProvisioned, MemberRow, TeamListRow } from '../api/types';
import { useAsync } from '../lib/useAsync';
import { AsyncView } from '../components/AsyncView';
import { Avatar } from '../components/Avatar';
import { StatTile } from '../components/StatTile';
import { MemberRoster } from '../components/MemberRoster';
import { InviteResult } from '../components/InviteResult';
import { Panel } from '../components/Panel';
import { Button } from '../components/Button';
import { Alert } from '../components/Alert';
import { AddMemberModal } from '../components/AddMemberModal';

export function TeamDetail() {
  const { teamId = '' } = useParams();
  const [showAdd, setShowAdd] = useState(false);
  const [lastAdded, setLastAdded] = useState<MemberProvisioned | null>(null);
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

      {lastAdded !== null && (
        <div className="mb-5">
          <InviteResult
            name={lastAdded.name}
            inviteEmailSent={lastAdded.inviteEmailSent}
            passcodeExpiresAt={lastAdded.passcodeExpiresAt}
            action="added"
          />
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
              onAdd={() => setShowAdd(true)}
              onDeactivate={handleDeactivate}
            />
          )
        }
      </AsyncView>

      {showAdd && state.status === 'success' && state.data.team && (
        <AddMemberModal
          onClose={() => setShowAdd(false)}
          preselectedTeam={{
            id: state.data.team.id,
            managerId: state.data.team.managerId,
            name: state.data.team.name,
          }}
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

function TeamBody({
  team,
  members,
  onAdd,
  onDeactivate,
}: {
  team: TeamListRow;
  members: MemberRow[];
  onAdd: () => void;
  onDeactivate?: (member: MemberRow) => void;
}) {
  const activeCount = members.filter((m) => m.status === 'active').length;
  const pendingCount = members.filter((m) => m.pendingInvite).length;

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
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
        <Button onClick={onAdd} className="w-full sm:w-auto justify-center">
          <UserPlus size={15} className="-ml-1" />
          Add member
        </Button>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-4">
        <StatTile label="Members" value={activeCount} />
        <StatTile label="Pending invites" value={pendingCount} />
      </div>

      <h2 className="font-display mt-8 mb-3 text-[15px] font-semibold">Roster</h2>
      {members.length === 0 ? (
        <Panel title="No members yet">
          <p className="text-sm text-muted">
            This team has no members yet. You can add members directly as the organization owner,
            or the manager can invite members from their own team screen.
          </p>
          <div className="mt-3">
            <Button onClick={onAdd} variant="secondary" className="text-xs">
              <UserPlus size={14} className="-ml-0.5 mr-1" />
              Add first member
            </Button>
          </div>
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
