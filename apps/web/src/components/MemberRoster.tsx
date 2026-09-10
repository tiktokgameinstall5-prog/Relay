/**
 * The shared member-row list. Used by BOTH the owner's team drill-down
 * (TeamDetail) and the manager's own team screen (MyTeam) so a member renders
 * byte-identically in both — the owner viewing someone's team and the manager
 * viewing their own see the same row, chip, and join date.
 *
 * Assumes a non-empty roster: the empty state is each screen's own concern,
 * because the copy differs (the owner is told the manager adds members; the
 * manager is prompted to add the first member themselves).
 */
import { Avatar } from './Avatar';
import { StatusChip } from './StatusChip';
import type { MemberRow } from '../api/types';
import { fmtDateTime } from '../lib/format';

import { UserMinus } from 'lucide-react';

export function MemberRoster({
  members,
  onDeactivate,
}: {
  members: MemberRow[];
  onDeactivate?: (member: MemberRow) => void;
}) {
  return (
    <div className="border-hairline dark:border-[#222738] overflow-hidden rounded-xl border bg-white dark:bg-[#151821]">
      {members.map((member) => (
        <div
          key={member.id}
          className="border-hairline dark:border-[#222738] flex items-center gap-3 border-b px-4 py-3 last:border-0 hover:bg-gray-50/50 dark:hover:bg-slate-800/40 transition"
        >
          <Avatar name={member.name} size={32} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-ink dark:text-slate-100">{member.name}</div>
            <div className="text-faint truncate text-xs">{member.email}</div>
          </div>
          <div className="text-faint hidden font-mono text-[11px] sm:block">
            joined {fmtDateTime(member.createdAt)}
          </div>
          <MemberChip member={member} />
          {onDeactivate && member.status === 'active' && (
            <button
              type="button"
              onClick={() => onDeactivate(member)}
              title="Deactivate member"
              className="rounded-lg p-1.5 text-gray-400 dark:text-slate-400 hover:bg-red-50 dark:hover:bg-red-950/40 hover:text-red-600 dark:hover:text-red-400 transition"
            >
              <UserMinus size={15} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/** Invite/account state as a chip: pending invite → amber, deactivated → grey,
 *  otherwise active → blue. (StatusChip reuses `pending` for a pending invite —
 *  see its divergence note.) Kept beside the roster it belongs to; the owner's
 *  manager directory has its own copy of this precedence so the two read alike. */
function MemberChip({ member }: { member: MemberRow }) {
  if (member.pendingInvite) return <StatusChip status="pending" />;
  if (member.status === 'inactive') return <StatusChip status="inactive" />;
  return <StatusChip status="active" />;
}
