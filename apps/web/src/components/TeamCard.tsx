/**
 * One team as a card, for the owner's Overview grid. Links to the team's
 * drill-down (/teams/:id).
 *
 * DIVERGENCE FROM THE PROTOTYPE (lines 519-536): the prototype fans out an
 * avatar for every member (`team.map(m => <Avatar…>)`). GET /api/auth/teams
 * returns COUNTS, not member rows — deliberately, so the owner's team grid does
 * not enumerate every person's invite state across the org. So the card shows the
 * manager's avatar and numeric counts; the member avatars appear on the
 * drill-down, which does load the roster.
 */
import { Link } from 'react-router-dom';
import { Crown } from 'lucide-react';
import type { TeamListRow } from '../api/types';
import { Avatar } from './Avatar';

export function TeamCard({ team }: { team: TeamListRow }) {
  return (
    <Link
      to={`/teams/${team.id}`}
      className="border-hairline dark:border-[#222738] block rounded-xl border bg-white dark:bg-[#151821] p-5 transition-all hover:shadow-sm dark:hover:border-slate-700"
    >
      <div className="flex items-center gap-3">
        <Avatar name={team.managerName} size={38} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-ink dark:text-slate-100">{team.name}</div>
          <div className="text-faint flex items-center gap-1 text-xs">
            <Crown size={11} className="text-amber shrink-0" />
            <span className="truncate">{team.managerName}</span>
          </div>
        </div>
      </div>
      <div className="text-muted dark:text-slate-400 mt-3 flex gap-4 text-xs">
        <span>
          {team.memberCount} member{team.memberCount === 1 ? '' : 's'}
        </span>
        {team.pendingInviteCount > 0 && (
          <span className="text-amber">{team.pendingInviteCount} pending</span>
        )}
      </div>
    </Link>
  );
}
