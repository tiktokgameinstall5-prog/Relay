/**
 * Completion Reports screen (CLAUDE.md §4).
 * Rebuilt from workspace-relay-prototype.jsx:236-258.
 */
import { useState, type FormEvent } from 'react';
import {
  MessageSquare,
  Plus,
  Clock,
  ChevronDown,
  ChevronUp,
  Info,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { listReports, createReport } from '../api/reports';
import { listTasks } from '../api/workflow';
import type { TaskReportResponse } from '../api/types';
import { useAsync } from '../lib/useAsync';
import { AsyncView } from '../components/AsyncView';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { ModalShell } from '../components/ModalShell';
import { Alert } from '../components/Alert';
import { fmtDateTime } from '../lib/format';
import { ApiError } from '../api/client';

export function Reports() {
  const { user } = useAuth();
  const { state, reload } = useAsync(listReports);

  const [showSubmitModal, setShowSubmitModal] = useState(false);

  if (user === null) return null;

  const canSubmit = user.role === 'owner' || user.role === 'manager' || user.isReporter;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="font-display text-xl font-semibold">Completion Reports</h1>
          <p className="mt-0.5 text-sm text-[#68707C]">
            Post-completion summaries and delivery reviews submitted by designated reporters.
          </p>
        </div>

        {canSubmit && (
          <Button
            onClick={() => setShowSubmitModal(true)}
            className="flex items-center justify-center gap-1.5 w-full sm:w-auto"
          >
            <Plus size={16} />
            Write Completion Report
          </Button>
        )}
      </div>

      {!canSubmit && (
        <div className="mt-5 flex items-start gap-2.5 rounded-lg border border-[#E4E7EC] bg-white p-3.5 text-xs text-[#68707C]">
          <Info size={16} className="text-[#3654F4] shrink-0 mt-0.5" />
          <div>
            <span className="font-medium text-[#161A22]">Read-only access: </span>
            You can read all completion reports delivered to your team. Completion reports are
            submitted by designated reporters or managers upon task completion.
          </div>
        </div>
      )}

      <div className="mt-6">
        <AsyncView state={state}>
          {(reports) => (
            <ReportsFeed reports={reports} onReportClick={() => {}} />
          )}
        </AsyncView>
      </div>

      {showSubmitModal && (
        <CreateReportModal
          onClose={() => setShowSubmitModal(false)}
          onSuccess={() => {
            setShowSubmitModal(false);
            reload();
          }}
        />
      )}
    </div>
  );
}

function ReportsFeed({
  reports,
}: {
  reports: TaskReportResponse[];
  onReportClick?: (report: TaskReportResponse) => void;
}) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (reports.length === 0) {
    return (
      <div className="border-hairline rounded-xl border bg-white p-8 text-center">
        <MessageSquare size={28} className="mx-auto text-[#3654F4]" />
        <h2 className="font-display mt-2 text-base font-semibold">No completion reports yet</h2>
        <p className="mt-1 text-xs text-[#68707C]">
          When a task completes its final relay step, the designated reporter will submit a completion report.
        </p>
      </div>
    );
  }

  return (
    <div className="border-hairline rounded-xl border bg-white p-5">
      <div className="mb-4 flex items-center justify-between border-b border-[#F4F5F8] pb-3">
        <div className="flex items-center gap-2">
          <MessageSquare size={18} className="text-[#3654F4]" />
          <h2 className="font-display text-[15px] font-semibold">Completion reports</h2>
        </div>
        <span className="font-mono text-xs text-[#68707C]">
          {reports.length} {reports.length === 1 ? 'report' : 'reports'}
        </span>
      </div>

      <div className="divide-y divide-[#F4F5F8]">
        {reports.map((r) => {
          const isExpanded = expandedIds.has(r.id);
          const hasDetails = Boolean(r.highlights || r.blockers);

          return (
            <div key={r.id} data-testid={`report-card-${r.id}`} className="py-4 first:pt-0 last:pb-0">
              <div className="flex items-start gap-3.5">
                <Avatar name={r.reportedByName ?? 'Reporter'} size={34} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-[#161A22]">
                    <span className="font-semibold">{r.reportedByName ?? 'Reporter'}</span>{' '}
                    <span className="text-[#9AA1AC]">reported on</span>{' '}
                    <span className="font-medium text-[#3654F4]">{r.taskName}</span>
                  </div>

                  <p className="mt-1.5 whitespace-pre-line text-sm text-[#4E5562]">
                    {r.summary}
                  </p>

                  {/* Highlights & Blockers detail block */}
                  {isExpanded && hasDetails && (
                    <div className="mt-3 space-y-2 rounded-lg border border-[#E4E7EC] bg-[#FAFAFC] p-3 text-xs">
                      {r.highlights && (
                        <div>
                          <div className="font-semibold text-[#00C875]">Key Highlights</div>
                          <p className="mt-0.5 whitespace-pre-line text-[#4E5562]">{r.highlights}</p>
                        </div>
                      )}
                      {r.blockers && (
                        <div className="pt-2 border-t border-[#EEF0F3]">
                          <div className="font-semibold text-[#FDAB3D]">Blockers & Follow-ups</div>
                          <p className="mt-0.5 whitespace-pre-line text-[#4E5562]">{r.blockers}</p>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="mt-2.5 flex items-center gap-4 text-[11px] text-[#9AA1AC]">
                    <span className="font-mono flex items-center gap-1">
                      <Clock size={11} />
                      {fmtDateTime(r.createdAt)}
                    </span>

                    {hasDetails && (
                      <button
                        type="button"
                        onClick={() => toggleExpand(r.id)}
                        className="flex items-center gap-0.5 font-medium text-[#3654F4] hover:underline"
                      >
                        {isExpanded ? (
                          <>Hide details <ChevronUp size={12} /></>
                        ) : (
                          <>Show details <ChevronDown size={12} /></>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CreateReportModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { state: tasksState } = useAsync(listTasks);
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [summary, setSummary] = useState('');
  const [highlights, setHighlights] = useState('');
  const [blockers, setBlockers] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const completedTasks =
    tasksState.status === 'ready'
      ? tasksState.data.filter((t) => t.status === 'completed')
      : [];

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedTaskId) {
      setError('Please select a completed task to report on.');
      return;
    }
    if (!summary.trim()) {
      setError('Report summary is mandatory.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const payload: { summary: string; highlights?: string; blockers?: string } = {
        summary: summary.trim(),
      };
      if (highlights.trim()) {
        payload.highlights = highlights.trim();
      }
      if (blockers.trim()) {
        payload.blockers = blockers.trim();
      }
      await createReport(selectedTaskId, payload);
      onSuccess();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Failed to submit report.',
      );
      setSubmitting(false);
    }
  };

  return (
    <ModalShell title="Write Completion Report" onClose={onClose} wide>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}

        <div>
          <label htmlFor="report-task-select" className="block text-xs font-medium text-[#68707C]">
            Completed Task *
          </label>
          {tasksState.status === 'loading' ? (
            <div className="mt-1 text-xs text-[#9AA1AC]">Loading completed tasks...</div>
          ) : completedTasks.length === 0 ? (
            <p className="mt-1 rounded-lg border border-[#E4E7EC] bg-[#FAFAFC] p-3 text-xs text-[#68707C]">
              No completed tasks found in your slice. A report can only be written once all relay steps are completed.
            </p>
          ) : (
            <select
              id="report-task-select"
              required
              value={selectedTaskId}
              onChange={(e) => setSelectedTaskId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[#E4E7EC] px-3 py-2 text-sm outline-none focus:border-signal focus:ring-1 focus:ring-signal"
            >
              <option value="">Select a completed task...</option>
              {completedTasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} (Completed)
                </option>
              ))}
            </select>
          )}
        </div>

        <div>
          <label htmlFor="report-summary" className="block text-xs font-medium text-[#68707C]">
            Delivery Summary (Required) *
          </label>
          <textarea
            id="report-summary"
            rows={3}
            required
            placeholder="Summarize the delivered result, final outcome, and verification..."
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            className="mt-1 w-full rounded-lg border border-[#E4E7EC] px-3 py-2 text-sm outline-none focus:border-signal focus:ring-1 focus:ring-signal"
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="report-highlights" className="block text-xs font-medium text-[#68707C]">
              Key Highlights (Optional)
            </label>
            <textarea
              id="report-highlights"
              rows={2}
              placeholder="What went well, milestones achieved..."
              value={highlights}
              onChange={(e) => setHighlights(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[#E4E7EC] px-3 py-2 text-sm outline-none focus:border-signal focus:ring-1 focus:ring-signal"
            />
          </div>

          <div>
            <label htmlFor="report-blockers" className="block text-xs font-medium text-[#68707C]">
              Blockers & Notes (Optional)
            </label>
            <textarea
              id="report-blockers"
              rows={2}
              placeholder="Delays, hurdles or follow-ups..."
              value={blockers}
              onChange={(e) => setBlockers(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[#E4E7EC] px-3 py-2 text-sm outline-none focus:border-signal focus:ring-1 focus:ring-signal"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={submitting || !selectedTaskId || !summary.trim()}
          >
            {submitting ? 'Submitting...' : 'Submit Report'}
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}
