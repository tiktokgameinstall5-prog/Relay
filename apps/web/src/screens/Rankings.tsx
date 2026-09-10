/**
 * Rankings & Leaderboard screen (CLAUDE.md §4).
 * Rebuilt from workspace-relay-prototype.jsx:213-234.
 */
import { useState, type FormEvent } from 'react';
import {
  Trophy,
  History,
  Edit3,
  Star,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import {
  getLeaderboard,
  updateRanking,
  setReporterStatus,
  getRankingHistory,
} from '../api/rankings';
import type { LeaderboardUser } from '../api/types';
import { useAsync } from '../lib/useAsync';
import { AsyncView } from '../components/AsyncView';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { ModalShell } from '../components/ModalShell';
import { Alert } from '../components/Alert';
import { fmtDateTime } from '../lib/format';
import { ApiError } from '../api/client';

const MEDAL_COLORS = ['#D6A73B', '#A9AFBA', '#B77A4A'];

export function Rankings() {
  const { user } = useAuth();
  const { state, reload } = useAsync(getLeaderboard);

  // Management modals state
  const [targetMember, setTargetMember] = useState<LeaderboardUser | null>(null);
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);

  // Member's self history
  const [myHistoryOpen, setMyHistoryOpen] = useState(false);

  if (user === null) return null;

  const isManagerOrOwner = user.role === 'owner' || user.role === 'manager';

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="font-display text-xl font-semibold">Rankings & Leaderboard</h1>
          <p className="mt-0.5 text-sm text-[#68707C]">
            {user.role === 'owner'
              ? 'Organization-wide performance leaderboard across all teams.'
              : 'Team performance leaderboard and audit history.'}
          </p>
        </div>
        {!isManagerOrOwner && (
          <Button
            variant="secondary"
            onClick={() => setMyHistoryOpen(true)}
            className="flex items-center justify-center gap-1.5 w-full sm:w-auto"
          >
            <History size={15} />
            My Score History
          </Button>
        )}
      </div>

      <div className="mt-6">
        <AsyncView state={state}>
          {(members) => (
            <LeaderboardCard
              members={members}
              currentUserId={user.id}
              isManagerOrOwner={isManagerOrOwner}
              onAdjust={(m) => {
                setTargetMember(m);
                setShowAdjustModal(true);
              }}
              onViewHistory={(m) => {
                setTargetMember(m);
                setShowHistoryModal(true);
              }}
              onToggleReporter={async (m) => {
                try {
                  await setReporterStatus(m.id, { isReporter: !m.isReporter });
                  reload();
                } catch (err) {
                  alert(err instanceof Error ? err.message : 'Failed to update reporter status.');
                }
              }}
            />
          )}
        </AsyncView>
      </div>

      {/* Adjust Ranking Modal (Manager / Owner) */}
      {showAdjustModal && targetMember && (
        <AdjustRankingModal
          member={targetMember}
          onClose={() => {
            setShowAdjustModal(false);
            setTargetMember(null);
          }}
          onSuccess={() => {
            setShowAdjustModal(false);
            setTargetMember(null);
            reload();
          }}
        />
      )}

      {/* Ranking Audit History Modal */}
      {showHistoryModal && targetMember && (
        <RankingHistoryModal
          member={targetMember}
          onClose={() => {
            setShowHistoryModal(false);
            setTargetMember(null);
          }}
        />
      )}

      {/* Member Self History Modal */}
      {myHistoryOpen && (
        <RankingHistoryModal
          member={{
            id: user.id,
            name: user.name,
          }}
          onClose={() => setMyHistoryOpen(false)}
        />
      )}
    </div>
  );
}

function LeaderboardCard({
  members,
  currentUserId,
  isManagerOrOwner,
  onAdjust,
  onViewHistory,
  onToggleReporter,
}: {
  members: LeaderboardUser[];
  currentUserId: string;
  isManagerOrOwner: boolean;
  onAdjust: (m: LeaderboardUser) => void;
  onViewHistory: (m: LeaderboardUser) => void;
  onToggleReporter: (m: LeaderboardUser) => void;
}) {
  if (members.length === 0) {
    return (
      <div className="border-hairline rounded-xl border bg-white p-8 text-center">
        <Trophy size={28} className="mx-auto text-[#FDAB3D]" />
        <h2 className="font-display mt-2 text-base font-semibold">No members on the leaderboard yet</h2>
        <p className="mt-1 text-xs text-[#68707C]">
          Team members will appear here once accounts are active.
        </p>
      </div>
    );
  }

  const maxScore = Math.max(...members.map((m) => m.ranking), 100);

  return (
    <div className="border-hairline rounded-xl border bg-white p-5">
      <div className="mb-4 flex items-center justify-between border-b border-[#F4F5F8] pb-3">
        <div className="flex items-center gap-2">
          <Trophy size={18} className="text-[#FDAB3D]" />
          <h2 className="font-display text-[15px] font-semibold">Team ranking</h2>
        </div>
        <span className="font-mono text-xs text-[#68707C]">
          {members.length} {members.length === 1 ? 'member' : 'members'}
        </span>
      </div>

      <div className="space-y-4">
        {members.map((m, index) => {
          const isSelf = m.id === currentUserId;
          const medalColor = index < 3 ? MEDAL_COLORS[index] : null;

          return (
            <div
              key={m.id}
              data-testid={`ranking-row-${m.id}`}
              className={`flex flex-col gap-3 rounded-lg p-3 transition-colors sm:flex-row sm:items-center ${
                isSelf ? 'bg-signal/5 ring-signal/30 ring-1' : 'hover:bg-[#FAFAFC]'
              }`}
            >
              {/* Rank indicator & Avatar */}
              <div className="flex items-center gap-3">
                <div
                  className="font-display w-6 text-center text-sm font-bold"
                  style={{ color: medalColor ?? '#9AA1AC' }}
                >
                  {index + 1}
                </div>
                <Avatar name={m.name} size={34} />
              </div>

              {/* Member details & Progress Bar */}
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between">
                  <div className="flex items-center gap-2 truncate">
                    <span className="truncate text-sm font-medium">{m.name}</span>
                    {isSelf && (
                      <span className="bg-signal/10 text-signal rounded px-1.5 py-0.5 text-[10px] font-semibold">
                        You
                      </span>
                    )}
                    {m.isReporter && (
                      <span
                        title="Designated task completion reporter"
                        className="flex items-center gap-1 rounded bg-[#E7FBF1] px-1.5 py-0.5 text-[10px] font-medium text-[#00C875]"
                      >
                        <Star size={10} fill="#00C875" /> Reporter
                      </span>
                    )}
                  </div>
                  <span className="font-mono text-xs font-semibold text-[#161A22]">
                    {m.ranking}
                  </span>
                </div>

                {/* Progress bar matching prototype */}
                <div className="mt-2 h-2 rounded-full bg-[#EEF0F3]">
                  <div
                    className="h-2 rounded-full transition-all duration-300"
                    style={{
                      width: `${Math.min(100, Math.max(0, (m.ranking / maxScore) * 100))}%`,
                      background: index === 0 ? '#FDAB3D' : '#0073EA',
                    }}
                  />
                </div>
              </div>

              {/* Manager Actions */}
              {isManagerOrOwner && (
                <div className="flex shrink-0 items-center gap-2 pt-1 sm:pt-0">
                  <button
                    type="button"
                    onClick={() => onAdjust(m)}
                    title="Adjust ranking score"
                    className="flex items-center gap-1 rounded-md border border-[#E4E7EC] bg-white px-2 py-1 text-xs font-medium text-[#161A22] hover:bg-[#F4F5F8]"
                  >
                    <Edit3 size={12} />
                    Adjust
                  </button>

                  <button
                    type="button"
                    onClick={() => onToggleReporter(m)}
                    title={m.isReporter ? 'Revoke reporter role' : 'Make designated reporter'}
                    className={`flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors ${
                      m.isReporter
                        ? 'border-[#00C875]/30 bg-[#E7FBF1] text-[#00C875] hover:bg-[#D3F7E5]'
                        : 'border-[#E4E7EC] bg-white text-[#68707C] hover:bg-[#F4F5F8]'
                    }`}
                  >
                    <Star size={12} fill={m.isReporter ? '#00C875' : 'none'} />
                    {m.isReporter ? 'Reporter' : 'Make Reporter'}
                  </button>

                  <button
                    type="button"
                    onClick={() => onViewHistory(m)}
                    title="View audit history"
                    className="rounded-md border border-[#E4E7EC] bg-white p-1 text-[#68707C] hover:bg-[#F4F5F8] hover:text-[#161A22]"
                  >
                    <History size={14} />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AdjustRankingModal({
  member,
  onClose,
  onSuccess,
}: {
  member: LeaderboardUser;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [ranking, setRanking] = useState(member.ranking);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!reason.trim()) {
      setError('Audit reason is required for ranking changes.');
      return;
    }
    if (ranking < 0 || ranking > 100) {
      setError('Ranking must be between 0 and 100.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await updateRanking(member.id, {
        ranking: Number(ranking),
        reason: reason.trim(),
      });
      onSuccess();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Failed to update ranking.',
      );
      setSubmitting(false);
    }
  };

  return (
    <ModalShell title={`Adjust Ranking — ${member.name}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}

        <div>
          <label htmlFor="adjust-ranking-score" className="block text-xs font-medium text-[#68707C]">
            Ranking score (0–100)
          </label>
          <div className="mt-1 flex items-center gap-3">
            <input
              id="adjust-ranking-score"
              type="number"
              min={0}
              max={100}
              required
              value={ranking}
              onChange={(e) => setRanking(Number(e.target.value))}
              className="w-24 rounded-lg border border-[#E4E7EC] px-3 py-2 font-mono text-sm outline-none focus:border-signal focus:ring-1 focus:ring-signal"
            />
            <span className="text-xs text-[#9AA1AC]">Previous: {member.ranking}</span>
          </div>
        </div>

        <div>
          <label htmlFor="adjust-ranking-reason" className="block text-xs font-medium text-[#68707C]">
            Audit reason (mandatory)
          </label>
          <textarea
            id="adjust-ranking-reason"
            rows={3}
            required
            placeholder="Explain why this ranking was modified (e.g. fast hand-offs, quality delivery)..."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="mt-1 w-full rounded-lg border border-[#E4E7EC] px-3 py-2 text-sm outline-none focus:border-signal focus:ring-1 focus:ring-signal"
          />
          <p className="mt-1 text-[11px] text-[#9AA1AC]">
            Logged permanently in the append-only audit trail.
          </p>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting || !reason.trim()}>
            {submitting ? 'Saving...' : 'Save & Log Event'}
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}

function RankingHistoryModal({
  member,
  onClose,
}: {
  member: { id: string; name: string };
  onClose: () => void;
}) {
  const { state } = useAsync(() => getRankingHistory(member.id), member.id);

  return (
    <ModalShell title={`Audit Trail — ${member.name}`} onClose={onClose} wide>
      <AsyncView state={state}>
        {(events) => (
          <div className="space-y-3">
            {events.length === 0 ? (
              <p className="py-6 text-center text-sm text-[#68707C]">
                No ranking audit events recorded yet for this member.
              </p>
            ) : (
              <div className="space-y-3">
                {events.map((ev) => (
                  <div
                    key={ev.id}
                    className="border-hairline rounded-lg border bg-[#FAFAFC] p-3 text-sm"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-[#68707C]">
                          {ev.oldRanking}
                        </span>
                        <span className="text-xs text-[#9AA1AC]">→</span>
                        <span className="font-mono text-xs font-bold text-[#0073EA]">
                          {ev.newRanking}
                        </span>
                      </div>
                      <span className="font-mono text-[11px] text-[#9AA1AC]">
                        {fmtDateTime(ev.createdAt)}
                      </span>
                    </div>

                    <p className="mt-2 text-xs text-[#161A22]">{ev.reason}</p>

                    {ev.changedByName && (
                      <div className="mt-1 text-[11px] text-[#68707C]">
                        Logged by <span className="font-medium">{ev.changedByName}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-end pt-3">
              <Button variant="secondary" onClick={onClose}>
                Close
              </Button>
            </div>
          </div>
        )}
      </AsyncView>
    </ModalShell>
  );
}
