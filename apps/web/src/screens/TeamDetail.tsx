/**
 * A single team's drill-down: the team header (name + manager) over its roster.
 *
 * Two reads in parallel: GET /api/auth/teams for the header (the members endpoint
 * returns only member rows, no team/manager metadata) and
 * /api/auth/teams/:id/members for the roster. A cross-tenant or unknown :id is the
 * server's byte-identical 404 (@OwnedResource), which surfaces as the error card;
 * a soft-deleted or otherwise unseen team is absent from listTeams, so `team` is
 * null and we render "not found" rather than a header with no name.
 *
 * The roster is NOT status-filtered server-side, so a deactivated member still
 * appears here (CLAUDE.md §5: keep them attributed, labelled "Deactivated"). The
 * Members tile therefore counts only the active ones, matching the count shown on
 * the card the owner clicked to get here.
 */
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Crown } from 'lucide-react';
import { listTeamMembers, listTeams } from '../api/auth';
import type { MemberRow, TeamListRow } from '../api/types';
import { useAsync } from '../lib/useAsync';
import { AsyncView } from '../components/AsyncView';
import { Avatar } from '../components/Avatar';
import { StatTile } from '../components/StatTile';
import { MemberRoster } from '../components/MemberRoster';
import { Panel } from '../components/Panel';

export function TeamDetail() {
  // The route is /teams/:teamId, so teamId is always present; the default only
  // satisfies useParams' string | undefined without a conditional hook call.
  const { teamId = '' } = useParams();

  const { state } = useAsync(async () => {
    const [teams, members] = await Promise.all([listTeams(), listTeamMembers(teamId)]);
    return { team: teams.find((t) => t.id === teamId) ?? null, members };
  }, teamId);

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        to="/teams"
        className="text-muted hover:text-ink mb-4 inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft size={14} /> All teams
      </Link>

      <AsyncView state={state}>
        {({ team, members }) =>
          team === null ? <NotFound /> : <TeamBody team={team} members={members} />
        }
      </AsyncView>
    </div>
  );
}

function TeamBody({ team, members }: { team: TeamListRow; members: MemberRow[] }) {
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
        <MemberRoster members={members} />
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
