/**
 * The Tasks & Relay Workflow screen (CLAUDE.md §2, §9).
 *
 * Displays all tasks in the caller's tenant slice:
 *   • Manager: Can view team tasks, create new ordered relay tasks, and watch live progression.
 *   • Member: Can view team tasks, see their active step with sequential forward or peer hand-off.
 *   • Owner: Org-wide task oversight and cross-org assignment (to Team, Manager, or Member).
 *
 * Implements 5-second short polling so step completions and hand-offs by teammates reflect live.
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  ArrowRightLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  Copy,
  Download,
  FileText,
  Film,
  Paperclip,
  Plus,
  Radio,
  Send,
  Shield,
  Trash2,
  UploadCloud,
  User,
  Users,
  Video,
  MessageSquare,
  X,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import {
  createTask,
  deleteAttachment,
  downloadAttachmentFile,
  forwardStep,
  getAttachmentDownloadUrl,
  listAttachments,
  listTasks,
  uploadAttachment,
} from '../api/workflow';
import { listManagers, listTeamMembers, listTeams } from '../api/auth';
import { ApiError } from '../api/client';
import type {
  ManagerListRow,
  MemberRow,
  TaskAttachment,
  TaskResponse,
  TaskType,
} from '../api/types';
import { useAsync } from '../lib/useAsync';
import { AsyncView } from '../components/AsyncView';
import { Panel } from '../components/Panel';
import { Button } from '../components/Button';
import { Field } from '../components/Field';
import { Alert } from '../components/Alert';
import { ModalShell } from '../components/ModalShell';
import { StatusChip } from '../components/StatusChip';
import { RelayChain, type RelayStep } from '../components/RelayChain';
import { Avatar } from '../components/Avatar';
import { fmtDateTime } from '../lib/format';

/** Poll interval for live relay updates (5 seconds) */
const POLL_INTERVAL_MS = 5000;

function TaskTypeIcon({ type }: { type: TaskType }) {
  switch (type) {
    case 'video':
      return <Video size={14} className="text-active" />;
    case 'file':
      return <Paperclip size={14} className="text-amber" />;
    case 'text':
    default:
      return <FileText size={14} className="text-muted" />;
  }
}

export function Tasks() {
  const { user } = useAuth();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [tasks, setTasks] = useState<TaskResponse[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchTasks = useCallback(async (isBackground = false) => {
    try {
      const data = await listTasks();
      setTasks(data);
      setError(null);
    } catch (err: unknown) {
      if (!isBackground) {
        setError(err instanceof Error ? err : new Error('Failed to load tasks'));
      }
    } finally {
      if (!isBackground) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    fetchTasks(false);
  }, [fetchTasks]);

  // Smooth short-polling: refreshes tasks in background without any UI flicker or unmounting
  useEffect(() => {
    // Pause background polling while creating a task so modal and inputs are never disturbed
    if (showCreateModal) return;

    const timer = setInterval(() => {
      fetchTasks(true);
    }, POLL_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [showCreateModal, fetchTasks]);

  const canAssign = user?.role === 'manager' || user?.role === 'owner';

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-display text-xl font-semibold">Tasks</h1>
            <span className="flex items-center gap-1.5 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-active">
              <Radio size={10} className="animate-pulse" /> Live Relay
            </span>
          </div>
          <p className="text-muted mt-0.5 text-sm">
            Ordered workflows moving sequentially through the relay chain.
          </p>
        </div>

        {canAssign && (
          <Button variant="primary" onClick={() => setShowCreateModal(true)}>
            <Plus size={16} className="-ml-1" />
            Assign task
          </Button>
        )}
      </div>

      {actionError && (
        <div className="mt-4">
          <Alert tone="error">{actionError}</Alert>
        </div>
      )}

      <div className="mt-6">
        {loading && tasks === null ? (
          <div className="text-muted py-16 text-center text-sm">Loading…</div>
        ) : error && tasks === null ? (
          <Panel title="Couldn’t load tasks">
            <p className="text-sm text-red-600">{error.message}</p>
          </Panel>
        ) : tasks && tasks.length === 0 ? (
          <EmptyTasksState canAssign={canAssign} onAssign={() => setShowCreateModal(true)} />
        ) : tasks ? (
          <div className="space-y-4">
            {tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                currentUserId={user?.id ?? ''}
                userRole={user?.role ?? 'member'}
                onForwardSuccess={() => {
                  setActionError(null);
                  fetchTasks(true);
                }}
                onForwardError={(msg) => setActionError(msg)}
              />
            ))}
          </div>
        ) : null}
      </div>

      {showCreateModal && (
        <CreateTaskModal
          userRole={user?.role ?? 'manager'}
          onClose={() => setShowCreateModal(false)}
          onCreated={() => {
            setShowCreateModal(false);
            fetchTasks(true);
          }}
        />
      )}
    </div>
  );
}

function EmptyTasksState({
  canAssign,
  onAssign,
}: {
  canAssign: boolean;
  onAssign: () => void;
}) {
  return (
    <Panel className="flex flex-col items-center justify-center p-12 text-center">
      <div className="rounded-full bg-slate-100 p-4">
        <FileText size={32} className="text-muted" />
      </div>
      <h3 className="mt-4 font-semibold text-ink">No tasks assigned yet</h3>
      <p className="text-muted mt-1 max-w-sm text-sm">
        {canAssign
          ? 'Assign your team or organization a relay task to start moving work sequentially through the chain.'
          : 'No tasks have been assigned to your team yet.'}
      </p>
      {canAssign && (
        <div className="mt-5">
          <Button variant="primary" onClick={onAssign}>
            <Plus size={16} className="-ml-1" />
            Assign first task
          </Button>
        </div>
      )}
    </Panel>
  );
}

function TaskDescriptionBox({ description }: { description: string }) {
  const [copied, setCopied] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  // Check if description is long (more than 400 characters or more than 6 lines)
  const isLong = description.length > 400 || description.split('\n').length > 6;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(description);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback copy for environments where clipboard API is restricted
      const el = document.createElement('textarea');
      el.value = description;
      el.setAttribute('readonly', '');
      el.style.position = 'absolute';
      el.style.left = '-9999px';
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="mt-3.5 rounded-lg border border-hairline bg-slate-50/80 p-3.5 transition-colors hover:bg-slate-50">
      <div className="flex items-center justify-between gap-2 pb-2 border-b border-hairline/60">
        <div className="flex items-center gap-1.5">
          <FileText size={13} className="text-signal" />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
            Description & Instructions
          </span>
          {isLong && (
            <span className="text-[10px] text-faint font-normal">
              ({description.trim().split(/\s+/).filter(Boolean).length} words)
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isLong && (
            <button
              type="button"
              onClick={() => setIsExpanded((prev) => !prev)}
              className="text-[11px] font-medium text-signal hover:underline"
            >
              {isExpanded ? 'Show less' : 'Expand full text'}
            </button>
          )}
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1.5 rounded-md border border-hairline bg-white px-2.5 py-1 text-xs font-medium text-ink shadow-2xs transition-all hover:border-active hover:bg-blue-50/40 hover:text-active active:scale-95"
            title="Copy entire description to clipboard"
          >
            {copied ? (
              <>
                <Check size={13} className="text-emerald-600" />
                <span className="text-emerald-600 font-semibold">Copied!</span>
              </>
            ) : (
              <>
                <Copy size={13} className="text-muted" />
                <span>Copy description</span>
              </>
            )}
          </button>
        </div>
      </div>

      <div className="relative mt-2.5">
        <div
          className={`select-text font-sans text-xs leading-relaxed text-ink whitespace-pre-wrap break-words ${
            !isExpanded && isLong ? 'max-h-36 overflow-hidden' : ''
          }`}
        >
          {description}
        </div>
        {!isExpanded && isLong && (
          <div
            onClick={() => setIsExpanded(true)}
            className="absolute inset-x-0 bottom-0 flex h-14 cursor-pointer items-end justify-center bg-gradient-to-t from-slate-50 via-slate-50/80 to-transparent pb-0.5 text-xs font-medium text-signal hover:underline"
          >
            Click to view full description ({description.length.toLocaleString()} characters)
          </div>
        )}
      </div>
    </div>
  );
}

function TaskCard({
  task,
  currentUserId,
  userRole,
  onForwardSuccess,
  onForwardError,
}: {
  task: TaskResponse;
  currentUserId: string;
  userRole: string;
  onForwardSuccess: () => void;
  onForwardError: (msg: string) => void;
}) {
  const [forwarding, setForwarding] = useState(false);
  const [showHandoffPicker, setShowHandoffPicker] = useState(false);
  const [teamMembers, setTeamMembers] = useState<MemberRow[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);

  const isMyActiveStep =
    task.status === 'in_progress' && task.currentAssignee?.id === currentUserId;

  // Next assignee in sequence (if forwarding to another member)
  const activeStep = task.steps.find((s) => s.status === 'active');
  const nextStep = activeStep
    ? task.steps.find((s) => s.stepOrder === activeStep.stepOrder + 1)
    : null;

  const relaySteps: RelayStep[] = task.steps.map((step) => ({
    id: step.id,
    name: step.assignedUserName,
    state: step.status,
    durationSeconds: step.durationSeconds,
  }));

  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);

  async function handleForward(targetUserId?: string) {
    setForwarding(true);
    try {
      if (targetUserId) {
        await forwardStep(task.id, { targetUserId });
      } else {
        await forwardStep(task.id);
      }
      setShowHandoffPicker(false);
      onForwardSuccess();
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        onForwardError(err.message);
      } else {
        onForwardError('Failed to forward task step.');
      }
    } finally {
      setForwarding(false);
    }
  }

  function handleAddSequenceStep(memberId: string) {
    if (selectedMemberIds.includes(memberId)) return;
    setSelectedMemberIds((prev) => [...prev, memberId]);
  }

  function handleRemoveSequenceStep(index: number) {
    setSelectedMemberIds((prev) => prev.filter((_, i) => i !== index));
  }

  function handleAddAllSequence() {
    setSelectedMemberIds(eligiblePeers.map((m) => m.id));
  }

  async function handleAssignSequence() {
    if (selectedMemberIds.length === 0) return;
    setForwarding(true);
    try {
      await forwardStep(task.id, { memberIds: selectedMemberIds });
      setShowHandoffPicker(false);
      setSelectedMemberIds([]);
      onForwardSuccess();
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        onForwardError(err.message);
      } else {
        onForwardError('Failed to assign team relay sequence.');
      }
    } finally {
      setForwarding(false);
    }
  }

  async function handleToggleHandoff() {
    if (!showHandoffPicker && teamMembers.length === 0) {
      setLoadingMembers(true);
      try {
        if (task.teamId) {
          const members = await listTeamMembers(task.teamId);
          setTeamMembers(members);
        } else if (userRole === 'manager') {
          const teams = await listTeams();
          if (teams.length > 0) {
            const allMembers: MemberRow[] = [];
            for (const t of teams) {
              const members = await listTeamMembers(t.id);
              allMembers.push(...members);
            }
            setTeamMembers(allMembers);
          }
        }
      } catch {
        // Fallback: use team members from steps
      } finally {
        setLoadingMembers(false);
      }
    }
    setShowHandoffPicker((prev) => !prev);
  }

  // Filter eligible peers for hand-off (teammates only, excluding self)
  const eligiblePeers = teamMembers.filter(
    (m) => m.id !== currentUserId && m.role === 'member' && m.status === 'active',
  );

  return (
    <Panel className="overflow-hidden border border-hairline transition-shadow hover:shadow-sm">
      <div className="p-5">
        {/* Header: Title, Type, Status & Progress */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-cool-slate">
              <TaskTypeIcon type={task.type} />
            </span>
            <div>
              <h2 className="font-medium text-ink">{task.name}</h2>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <span className="text-muted font-mono text-xs">
              {task.completedSteps}/{task.totalSteps} steps
            </span>
            <StatusChip status={task.status} />
          </div>
        </div>

        {/* Full Task Description with Complete Visibility & 1-Click Copy */}
        {task.description && (
          <TaskDescriptionBox description={task.description} />
        )}

        {/* Relay Chain Visualization */}
        <div className="mt-4 rounded-lg bg-wash p-3">
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="text-muted font-medium">Relay sequence</span>
            {task.status === 'scheduled' ? (
              <span className="text-[#579bfc] font-medium flex items-center gap-1">
                <Clock size={12} />
                {task.scheduledFor ? `Scheduled for: ${fmtDateTime(task.scheduledFor)}` : 'Scheduled for future'}
              </span>
            ) : task.currentAssignee ? (
              <span className="text-active font-medium">
                Currently with: {task.currentAssignee.name}
              </span>
            ) : (
              <span className="text-done flex items-center gap-1 font-medium">
                <CheckCircle2 size={12} /> Completed
              </span>
            )}
          </div>
          <RelayChain steps={relaySteps} />
        </div>

        {/* Action Bar / Forward & Hand-off Prompts */}
        <div className="mt-4 flex flex-col items-start justify-between gap-3 border-t border-hairline pt-3 text-xs sm:flex-row sm:items-center">
          <div className="flex items-center gap-3">
            <div className="text-faint">Created {fmtDateTime(task.createdAt)}</div>
            {task.status === 'completed' && (
              <Link
                to="/reports"
                className="flex items-center gap-1 font-medium text-signal hover:underline"
              >
                <MessageSquare size={12} />
                Completion reports →
              </Link>
            )}
          </div>

          {isMyActiveStep && (
            <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
              {(task.teamId || userRole === 'manager') && (
                <Button
                  variant="secondary"
                  onClick={handleToggleHandoff}
                  disabled={forwarding}
                  className="text-xs"
                >
                  <ArrowRightLeft size={13} className="-ml-0.5" />
                  {userRole === 'manager' ? 'Assign relay sequence to team' : 'Hand off to peer'}
                  <ChevronDown size={12} className="ml-1 opacity-60" />
                </Button>
              )}

              <Button
                variant="primary"
                onClick={() => handleForward()}
                disabled={forwarding}
                className="bg-active hover:bg-blue-600 font-semibold"
              >
                <Send size={14} className="-ml-0.5" />
                {forwarding
                  ? 'Forwarding...'
                  : nextStep
                    ? `Forward to ${nextStep.assignedUserName.split(' ')[0]}`
                    : 'Complete Task'}
              </Button>
            </div>
          )}
        </div>

        {/* Manager: Relay Sequence Builder Flyout */}
        {showHandoffPicker && isMyActiveStep && userRole === 'manager' && (
          <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50/70 p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-ink text-xs sm:text-sm flex items-center gap-1.5">
                  <ArrowRightLeft size={14} className="text-active" />
                  Assign relay sequence to team
                </h3>
                <p className="text-muted text-[11px] mt-0.5">
                  Add team members in the order work should flow. Step 1 starts immediately upon assignment.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowHandoffPicker(false);
                  setSelectedMemberIds([]);
                }}
                className="text-muted hover:text-ink p-1"
              >
                <X size={15} />
              </button>
            </div>

            {loadingMembers ? (
              <p className="text-muted mt-3 text-xs">Loading team roster...</p>
            ) : eligiblePeers.length === 0 ? (
              <p className="text-muted mt-3 text-xs">No active team members found in your team roster.</p>
            ) : (
              <div className="mt-3 space-y-3">
                {/* Selected Sequence Steps */}
                {selectedMemberIds.length > 0 ? (
                  <div className="space-y-1.5 rounded-lg border border-blue-100 bg-white p-2.5 shadow-2xs">
                    <div className="flex items-center justify-between pb-1 border-b border-hairline text-[11px] text-muted font-medium">
                      <span>Ordered relay sequence ({selectedMemberIds.length} steps):</span>
                      <button
                        type="button"
                        onClick={() => setSelectedMemberIds([])}
                        className="text-faint hover:text-red-600 transition-colors"
                      >
                        Clear sequence
                      </button>
                    </div>
                    {selectedMemberIds.map((memId, idx) => {
                      const m = eligiblePeers.find((p) => p.id === memId);
                      const mName = m?.name || 'Member';
                      return (
                        <div
                          key={`${memId}-${idx}`}
                          className="flex items-center justify-between rounded-md bg-wash px-2.5 py-1.5 text-xs"
                        >
                          <div className="flex items-center gap-2">
                            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-active text-[10px] font-bold text-white">
                              {idx + 1}
                            </span>
                            <Avatar name={mName} size={18} />
                            <span className="font-medium text-ink">{mName}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRemoveSequenceStep(idx)}
                            className="text-faint hover:text-red-500"
                            title="Remove step"
                          >
                            <X size={13} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-blue-200 bg-white/70 p-3 text-center text-xs text-muted">
                    No sequence steps added yet. Click members below to build the relay chain.
                  </div>
                )}

                {/* Member selection & Quick Add */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted font-medium">Add steps to chain:</span>
                    {eligiblePeers.length > 1 && (
                      <button
                        type="button"
                        onClick={handleAddAllSequence}
                        className="text-signal hover:underline font-medium text-xs"
                      >
                        Quick: Add all {eligiblePeers.length} members in order
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {eligiblePeers.map((peer) => {
                      const isSelected = selectedMemberIds.includes(peer.id);
                      return (
                        <button
                          key={peer.id}
                          type="button"
                          disabled={isSelected || forwarding}
                          onClick={() => handleAddSequenceStep(peer.id)}
                          className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                            isSelected
                              ? 'border-hairline bg-cool-slate text-faint cursor-not-allowed'
                              : 'border-blue-200 bg-white text-ink hover:border-active hover:bg-blue-50 hover:text-active'
                          }`}
                        >
                          <Plus size={12} className={isSelected ? 'text-faint' : 'text-active'} />
                          <Avatar name={peer.name} size={16} />
                          <span>{peer.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Submit Sequence Button */}
                <div className="flex items-center justify-end gap-2 border-t border-blue-100 pt-3">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setShowHandoffPicker(false);
                      setSelectedMemberIds([]);
                    }}
                    className="text-xs"
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    disabled={forwarding || selectedMemberIds.length === 0}
                    onClick={handleAssignSequence}
                    className="bg-active hover:bg-blue-600 font-semibold text-xs"
                  >
                    <Send size={13} className="-ml-0.5" />
                    {forwarding
                      ? 'Assigning...'
                      : `Assign Relay to Team (${selectedMemberIds.length} ${selectedMemberIds.length === 1 ? 'step' : 'steps'})`}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Member: Single Peer Hand-off Selector Flyout */}
        {showHandoffPicker && isMyActiveStep && userRole === 'member' && (
          <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50/50 p-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-ink">Select teammate to hand off to:</span>
              <button
                type="button"
                onClick={() => setShowHandoffPicker(false)}
                className="text-muted hover:text-ink"
              >
                <X size={14} />
              </button>
            </div>

            {loadingMembers ? (
              <p className="text-muted mt-2 text-xs">Loading team roster...</p>
            ) : eligiblePeers.length === 0 ? (
              <p className="text-muted mt-2 text-xs">No eligible teammates found in your team.</p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {eligiblePeers.map((peer) => (
                  <button
                    key={peer.id}
                    type="button"
                    onClick={() => handleForward(peer.id)}
                    disabled={forwarding}
                    className="flex items-center gap-1.5 rounded-full border border-blue-200 bg-white px-3 py-1 text-xs font-medium text-ink shadow-2xs transition-colors hover:border-active hover:bg-blue-50 hover:text-active"
                  >
                    <Avatar name={peer.name} size={18} />
                    <span>{peer.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Content & Attachments Section */}
        <TaskAttachmentsSection
          taskId={task.id}
          taskType={task.type}
          currentUserId={currentUserId}
          userRole={userRole}
        />
      </div>
    </Panel>
  );
}

function fmtFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function TaskAttachmentsSection({
  taskId,
  taskType,
  currentUserId,
  userRole,
}: {
  taskId: string;
  taskType?: TaskType;
  currentUserId: string;
  userRole: string;
}) {
  const [attachments, setAttachments] = useState<TaskAttachment[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (expanded) {
      loadAttachments();
    }
  }, [expanded, taskId]);

  async function loadAttachments() {
    setLoading(true);
    setError(null);
    try {
      const data = await listAttachments(taskId);
      setAttachments(data);
    } catch {
      setError('Failed to load attachments.');
    } finally {
      setLoading(false);
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 30 * 1024 * 1024) {
      setError(`Attachment cannot exceed 30MB (selected: ${fmtFileSize(file.size)})`);
      e.target.value = '';
      return;
    }
    if (taskType === 'file' && file.size > 2 * 1024 * 1024) {
      setError(`File attachment cannot exceed 2MB (selected: ${fmtFileSize(file.size)})`);
      e.target.value = '';
      return;
    }

    setUploading(true);
    setError(null);
    try {
      const created = await uploadAttachment(taskId, file);
      setAttachments((prev) => [...prev, created]);
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : 'Failed to upload file.');
      }
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  async function handleDelete(attachmentId: string) {
    try {
      await deleteAttachment(taskId, attachmentId);
      setAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
    } catch {
      setError('Failed to delete attachment.');
    }
  }

  return (
    <div className="mt-3 border-t border-hairline/60 pt-3">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="flex items-center gap-1.5 text-xs font-medium text-muted hover:text-ink"
        >
          <Paperclip size={13} />
          <span>Attachments ({attachments.length})</span>
          <ChevronDown
            size={12}
            className={`transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
        </button>

        {expanded && (
          <label className="cursor-pointer inline-flex items-center gap-1 text-xs font-semibold text-active hover:underline">
            <UploadCloud size={13} />
            <span>{uploading ? 'Uploading...' : 'Add attachment'}</span>
            <input
              type="file"
              onChange={handleFileUpload}
              disabled={uploading}
              className="hidden"
              aria-label="Upload attachment"
            />
          </label>
        )}
      </div>

      {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}

      {expanded && (
        <div className="mt-3 space-y-2">
          {loading ? (
            <p className="text-xs text-faint">Loading attachments...</p>
          ) : attachments.length === 0 ? (
            <p className="text-xs text-faint">
              No attachments uploaded yet.{' '}
              {taskType === 'video'
                ? '(Max 30MB)'
                : taskType === 'file'
                  ? '(Max 2MB)'
                  : '(Max 5MB)'}
            </p>
          ) : (
            attachments.map((att) => {
              const isVideo = att.mimeType.startsWith('video/');
              const canDelete =
                userRole === 'owner' ||
                userRole === 'manager' ||
                att.uploadedByUserId === currentUserId;

              return (
                <div
                  key={att.id}
                  className="rounded-lg border border-hairline bg-surface p-2.5 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 truncate">
                      {isVideo ? (
                        <Film size={15} className="text-active shrink-0" />
                      ) : (
                        <FileText size={15} className="text-muted shrink-0" />
                      )}
                      <span className="font-medium text-ink truncate" title={att.fileName}>
                        {att.fileName}
                      </span>
                      <span className="text-faint shrink-0 font-mono">
                        ({fmtFileSize(att.fileSize)})
                      </span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <a
                        href={getAttachmentDownloadUrl(taskId, att.id)}
                        download={att.fileName}
                        className="inline-flex items-center gap-1 font-medium text-active hover:underline"
                        title="Download lossless original"
                      >
                        <Download size={12} />
                        {isVideo ? 'Lossless Video' : 'Download'}
                      </a>

                      {canDelete && (
                        <button
                          type="button"
                          onClick={() => handleDelete(att.id)}
                          className="text-faint hover:text-red-600"
                          title="Delete attachment"
                          aria-label={`Delete ${att.fileName}`}
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </div>

                  {isVideo && (
                    <div className="mt-2 overflow-hidden rounded bg-black/5">
                      <video
                        controls
                        preload="metadata"
                        src={getAttachmentDownloadUrl(taskId, att.id)}
                        className="max-h-48 w-full rounded object-contain"
                      >
                        Your browser does not support the video element.
                      </video>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

type OwnerTargetMode = 'team' | 'manager' | 'member';

function CreateTaskModal({
  userRole,
  onClose,
  onCreated,
}: {
  userRole: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const isOwner = userRole === 'owner';

  const [name, setName] = useState('');
  const [type, setType] = useState<TaskType>('text');
  const [description, setDescription] = useState('');

  // Attachment state for task creation
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setAttachmentError(null);

    if (type === 'video' && f.size > 30 * 1024 * 1024) {
      setAttachmentError(`Video cannot exceed 30MB (selected: ${fmtFileSize(f.size)})`);
      e.target.value = '';
      return;
    }
    if (type === 'file' && f.size > 2 * 1024 * 1024) {
      setAttachmentError(`File cannot exceed 2MB (selected: ${fmtFileSize(f.size)})`);
      e.target.value = '';
      return;
    }
    if (type === 'text' && f.size > 5 * 1024 * 1024) {
      setAttachmentError(`Document cannot exceed 5MB (selected: ${fmtFileSize(f.size)})`);
      e.target.value = '';
      return;
    }

    setAttachedFile(f);
  }

  // Scheduling state
  const [isScheduled, setIsScheduled] = useState(false);
  const [scheduledFor, setScheduledFor] = useState('');

  // Owner target mode
  const [targetMode, setTargetMode] = useState<OwnerTargetMode>('team');
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [selectedManagerId, setSelectedManagerId] = useState('');
  const [selectedMemberId, setSelectedMemberId] = useState('');

  // Relay order for team assignment
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load teams and managers for Owner / Manager
  const { state: orgDataState } = useAsync(async () => {
    const teams = await listTeams();
    let managers: ManagerListRow[] = [];
    if (isOwner) {
      try {
        managers = await listManagers();
      } catch {
        // Ignore if forbidden
      }
    }
    return { teams, managers };
  });

  // Selected team's members
  const orgData = orgDataState.status === 'ready' ? orgDataState.data : null;
  const activeTeamId = isOwner ? selectedTeamId : (orgData?.teams[0]?.id ?? '');
  const { state: teamMembersState } = useAsync(
    async () => {
      if (!activeTeamId) return [];
      return await listTeamMembers(activeTeamId);
    },
    activeTeamId,
  );

  // Set default selected team or manager once loaded
  useEffect(() => {
    if (orgDataState.status === 'ready') {
      if (orgDataState.data.teams.length > 0 && !selectedTeamId) {
        setSelectedTeamId(orgDataState.data.teams[0]!.id);
      }
      if (orgDataState.data.managers.length > 0 && !selectedManagerId) {
        setSelectedManagerId(orgDataState.data.managers[0]!.id);
      }
    }
  }, [orgDataState, selectedTeamId, selectedManagerId]);

  function handleAddMemberToRelay(memberId: string) {
    if (selectedMemberIds.includes(memberId)) return;
    setSelectedMemberIds((prev) => [...prev, memberId]);
  }

  function handleRemoveStep(index: number) {
    setSelectedMemberIds((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Please provide a task name.');
      return;
    }

    if (isScheduled) {
      if (!scheduledFor) {
        setError('Please select a scheduled date and time.');
        return;
      }
      const scheduledDate = new Date(scheduledFor);
      if (isNaN(scheduledDate.getTime())) {
        setError('Invalid scheduled date format.');
        return;
      }
      if (scheduledDate.getTime() <= Date.now()) {
        setError('Scheduled date must be in the future.');
        return;
      }
      const maxDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
      if (scheduledDate.getTime() > maxDate.getTime()) {
        setError('Scheduled date cannot be more than 365 days in the future.');
        return;
      }
    }

    const scheduledIso = isScheduled && scheduledFor ? new Date(scheduledFor).toISOString() : undefined;

    setSubmitting(true);
    try {
      let createdTask: TaskResponse;
      if (isOwner) {
        if (targetMode === 'team') {
          if (!selectedTeamId) {
            setError('Please select a target team.');
            setSubmitting(false);
            return;
          }
          createdTask = await createTask({
            name: name.trim(),
            type,
            description: description.trim() ? description.trim() : undefined,
            scheduledFor: scheduledIso,
            teamId: selectedTeamId,
            memberIds: selectedMemberIds.length > 0 ? selectedMemberIds : undefined,
          });
        } else if (targetMode === 'manager') {
          if (!selectedManagerId) {
            setError('Please select a target manager.');
            setSubmitting(false);
            return;
          }
          createdTask = await createTask({
            name: name.trim(),
            type,
            description: description.trim() ? description.trim() : undefined,
            scheduledFor: scheduledIso,
            targetManagerId: selectedManagerId,
          });
        } else {
          if (!selectedMemberId) {
            setError('Please select a target member.');
            setSubmitting(false);
            return;
          }
          createdTask = await createTask({
            name: name.trim(),
            type,
            description: description.trim() ? description.trim() : undefined,
            scheduledFor: scheduledIso,
            targetMemberId: selectedMemberId,
          });
        }
      } else {
        // Manager task creation
        if (selectedMemberIds.length === 0) {
          setError('Please select at least one team member in the relay sequence.');
          setSubmitting(false);
          return;
        }
        createdTask = await createTask({
          name: name.trim(),
          type,
          description: description.trim() ? description.trim() : undefined,
          scheduledFor: scheduledIso,
          memberIds: selectedMemberIds,
        });
      }

      // If an attachment was selected, upload it immediately
      if (attachedFile && createdTask?.id) {
        setUploadProgress(0);
        await uploadAttachment(createdTask.id, attachedFile, (pct) => {
          setUploadProgress(pct);
        });
      }

      onCreated();
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : 'Failed to create task relay.');
      }
    } finally {
      setSubmitting(false);
      setUploadProgress(null);
    }
  }

  return (
    <ModalShell title={isOwner ? 'Assign task (Owner)' : 'Assign new task relay'} onClose={onClose}>
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}

        {/* Owner Target Mode Selector */}
        {isOwner && (
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">
              Assign target
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'team' as OwnerTargetMode, label: 'Whole Team', icon: Users },
                { id: 'manager' as OwnerTargetMode, label: 'Manager', icon: Shield },
                { id: 'member' as OwnerTargetMode, label: 'Specific Member', icon: User },
              ].map((item) => {
                const Icon = item.icon;
                const isSelected = targetMode === item.id;
                return (
                  <button
                    type="button"
                    key={item.id}
                    onClick={() => {
                      setTargetMode(item.id);
                      setSelectedMemberIds([]);
                    }}
                    className={`flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                      isSelected
                        ? 'border-active bg-blue-50 text-active'
                        : 'border-hairline bg-white text-muted hover:bg-cool-slate'
                    }`}
                  >
                    <Icon size={14} />
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Owner Target Pickers */}
        {isOwner && (
          <AsyncView state={orgDataState}>
            {({ teams, managers }) => (
              <div className="space-y-3">
                {targetMode === 'team' && (
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted">Select team</label>
                    <select
                      aria-label="Select target team"
                      value={selectedTeamId}
                      onChange={(e) => {
                        setSelectedTeamId(e.target.value);
                        setSelectedMemberIds([]);
                      }}
                      className="w-full rounded-lg border border-hairline bg-white px-3 py-2 text-sm text-ink outline-none focus:border-active focus:ring-1 focus:ring-active"
                    >
                      {teams.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} (Manager: {t.managerName}, {t.memberCount} members)
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {targetMode === 'manager' && (
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted">Select manager</label>
                    <select
                      aria-label="Select target manager"
                      value={selectedManagerId}
                      onChange={(e) => setSelectedManagerId(e.target.value)}
                      className="w-full rounded-lg border border-hairline bg-white px-3 py-2 text-sm text-ink outline-none focus:border-active focus:ring-1 focus:ring-active"
                    >
                      {managers.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} ({m.email})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {targetMode === 'member' && (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-muted">Team</label>
                      <select
                        aria-label="Select target team"
                        value={selectedTeamId}
                        onChange={(e) => {
                          setSelectedTeamId(e.target.value);
                          setSelectedMemberId('');
                        }}
                        className="w-full rounded-lg border border-hairline bg-white px-3 py-2 text-sm text-ink outline-none focus:border-active focus:ring-1 focus:ring-active"
                      >
                        {teams.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-medium text-muted">Member</label>
                      <AsyncView state={teamMembersState}>
                        {(members) => (
                          <select
                            aria-label="Select target member"
                            value={selectedMemberId}
                            onChange={(e) => setSelectedMemberId(e.target.value)}
                            className="w-full rounded-lg border border-hairline bg-white px-3 py-2 text-sm text-ink outline-none focus:border-active focus:ring-1 focus:ring-active"
                          >
                            <option value="">-- Choose member --</option>
                            {members.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.name} ({m.email}){m.pendingInvite ? ' — (Pending Invite)' : ''}
                              </option>
                            ))}
                          </select>
                        )}
                      </AsyncView>
                    </div>
                  </div>
                )}
              </div>
            )}
          </AsyncView>
        )}

        <Field
          label="Task name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Brand Launch Video"
        />

        <div>
          <label className="mb-1 block text-xs font-medium text-muted">Task type</label>
          <div className="grid grid-cols-3 gap-2">
            {[
              { id: 'text' as TaskType, label: 'Text', icon: FileText },
              { id: 'video' as TaskType, label: 'Video', icon: Video },
              { id: 'file' as TaskType, label: 'File', icon: Paperclip },
            ].map((item) => {
              const Icon = item.icon;
              const isSelected = type === item.id;
              return (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => setType(item.id)}
                  className={`flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                    isSelected
                      ? 'border-active bg-blue-50 text-active'
                      : 'border-hairline bg-white text-muted hover:bg-cool-slate'
                  }`}
                >
                  <Icon size={14} />
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="block text-xs font-medium text-muted">
              Description & Instructions (optional · long text supported)
            </label>
            {description.length > 0 && (
              <span className="text-[11px] text-faint">
                {description.trim().split(/\s+/).filter(Boolean).length} words · {description.length.toLocaleString()} chars
              </span>
            )}
          </div>
          <textarea
            rows={5}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Detailed instructions, requirements, deliverables, or long text / specifications for this task..."
            className="focus:ring-signal min-h-[110px] w-full resize-y rounded-lg border border-hairline px-3 py-2 text-sm font-sans leading-relaxed outline-none focus:ring-2"
          />
          <div className="mt-1 flex items-center justify-between text-[11px] text-muted">
            <span>Supports long instructions, multi-paragraph text, and bullet points.</span>
            {description.length > 0 && (
              <button
                type="button"
                onClick={() => setDescription('')}
                className="text-faint hover:text-red-500 transition-colors"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Attachment Upload Section */}
        <div className="rounded-lg border border-hairline bg-slate-50/70 p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Paperclip size={16} className={attachedFile ? 'text-active' : 'text-muted'} />
              <div>
                <div className="text-xs font-semibold text-ink">
                  {type === 'video'
                    ? 'Attach master video (Optional)'
                    : type === 'file'
                      ? 'Attach file (Optional)'
                      : 'Attach reference document (Optional)'}
                </div>
                <div className="text-[11px] text-muted">
                  {type === 'video'
                    ? 'Lossless original video (MP4, WebM, MOV) — Max 30MB'
                    : type === 'file'
                      ? 'Documents, archives, sheets, etc. — Max 2MB'
                      : 'Text or document file (TXT, PDF, DOCX, JSON) — Max 5MB'}
                </div>
              </div>
            </div>

            {!attachedFile && (
              <label className="cursor-pointer inline-flex items-center gap-1.5 rounded-md border border-hairline bg-white px-2.5 py-1.5 text-xs font-medium text-ink shadow-2xs hover:border-active hover:bg-blue-50 transition-colors">
                <UploadCloud size={14} className="text-active" />
                <span>Choose file</span>
                <input
                  type="file"
                  onChange={handleFileChange}
                  accept={
                    type === 'video'
                      ? 'video/*,.mp4,.mov,.webm,.mkv'
                      : type === 'text'
                        ? '.txt,.pdf,.doc,.docx,.json,.rtf,text/*'
                        : undefined
                  }
                  className="hidden"
                />
              </label>
            )}
          </div>

          {attachmentError && (
            <p className="mt-2 text-xs font-medium text-red-600">{attachmentError}</p>
          )}

          {attachedFile && (
            <div className="mt-2.5 flex items-center justify-between rounded-md border border-hairline bg-white px-3 py-2 text-xs shadow-2xs">
              <div className="flex items-center gap-2 truncate">
                {type === 'video' ? (
                  <Film size={15} className="text-active shrink-0" />
                ) : type === 'file' ? (
                  <Paperclip size={15} className="text-amber shrink-0" />
                ) : (
                  <FileText size={15} className="text-muted shrink-0" />
                )}
                <span className="font-medium text-ink truncate" title={attachedFile.name}>
                  {attachedFile.name}
                </span>
                <span className="text-faint shrink-0 font-mono">
                  ({fmtFileSize(attachedFile.size)})
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setAttachedFile(null);
                  setAttachmentError(null);
                }}
                disabled={submitting}
                className="text-faint hover:text-red-600 shrink-0 ml-2"
                title="Remove attachment"
              >
                <X size={14} />
              </button>
            </div>
          )}
        </div>

        {/* Scheduling Toggle & Picker */}
        <div className="rounded-lg border border-hairline bg-slate-50/70 p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock size={16} className={isScheduled ? 'text-active' : 'text-muted'} />
              <div>
                <div className="text-xs font-semibold text-ink">Schedule for later</div>
                <div className="text-[11px] text-muted">
                  Task starts automatically at the designated date & time.
                </div>
              </div>
            </div>
            <label className="relative inline-flex cursor-pointer items-center">
              <input
                type="checkbox"
                aria-label="Schedule task for later"
                data-testid="schedule-toggle"
                checked={isScheduled}
                onChange={(e) => {
                  setIsScheduled(e.target.checked);
                  if (e.target.checked && !scheduledFor) {
                    const tomorrow = new Date();
                    tomorrow.setDate(tomorrow.getDate() + 1);
                    tomorrow.setHours(9, 0, 0, 0);
                    const tzOffset = tomorrow.getTimezoneOffset() * 60000;
                    const localISOTime = new Date(tomorrow.getTime() - tzOffset)
                      .toISOString()
                      .slice(0, 16);
                    setScheduledFor(localISOTime);
                  }
                }}
                className="peer sr-only"
              />
              <div className="peer h-5 w-9 rounded-full bg-slate-200 after:absolute after:top-[2px] after:left-[2px] after:h-4 after:w-4 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-active peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none" />
            </label>
          </div>

          {isScheduled && (
            <div className="mt-3 border-t border-hairline pt-3">
              <label htmlFor="scheduled-datetime-input" className="mb-1 block text-xs font-medium text-muted">
                Activation Date & Time
              </label>
              <input
                id="scheduled-datetime-input"
                type="datetime-local"
                aria-label="Activation Date & Time"
                data-testid="scheduled-datetime-input"
                value={scheduledFor}
                min={new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
                  .toISOString()
                  .slice(0, 16)}
                max={new Date(
                  Date.now() + 365 * 24 * 60 * 60 * 1000 - new Date().getTimezoneOffset() * 60000,
                )
                  .toISOString()
                  .slice(0, 16)}
                onChange={(e) => setScheduledFor(e.target.value)}
                className="w-full rounded-lg border border-hairline bg-white px-3 py-2 text-sm text-ink outline-none focus:border-active focus:ring-1 focus:ring-active"
                required={isScheduled}
              />
              <p className="mt-1 text-[11px] text-faint">
                Task status will remain <strong>Scheduled</strong> and step 1 will stay <strong>Pending</strong> until this time.
              </p>
            </div>
          )}
        </div>

        {/* Relay Sequence Picker (for Manager or Owner -> Team mode) */}
        {(!isOwner || targetMode === 'team') && (
          <div className="border-t border-hairline pt-3">
            <label className="text-muted block text-xs font-semibold uppercase tracking-wider">
              Relay sequence (ordered steps)
            </label>
            <p className="text-faint text-xs">
              {isOwner
                ? 'Optional: pick specific members in order. If empty, defaults to all team members.'
                : 'Add team members in the order work should flow. Step 1 starts immediately.'}
            </p>

            <AsyncView state={teamMembersState}>
              {(members) => {
                const memberMap = new Map(members.map((m) => [m.id, m]));

                return (
                  <div className="mt-3 space-y-3">
                    {/* Selected Ordered Steps */}
                    {selectedMemberIds.length > 0 ? (
                      <div className="space-y-2 rounded-lg bg-wash p-3">
                        {selectedMemberIds.map((memberId, idx) => {
                          const m = memberMap.get(memberId);
                          const memberName = m?.name ?? 'Member';
                          return (
                            <div
                              key={`${memberId}-${idx}`}
                              className="flex items-center justify-between rounded-md border border-hairline bg-white px-3 py-2 text-sm shadow-xs"
                            >
                              <div className="flex items-center gap-2.5">
                                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-active font-mono text-[10px] font-bold text-white">
                                  {idx + 1}
                                </span>
                                <Avatar name={memberName} size={24} />
                                <span className="font-medium text-ink">{memberName}</span>
                                {m?.pendingInvite && (
                                  <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                                    Pending invite
                                  </span>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={() => handleRemoveStep(idx)}
                                className="text-faint hover:text-red-500"
                                title="Remove step"
                              >
                                <X size={14} />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed border-hairline p-4 text-center text-xs text-muted">
                        {isOwner
                          ? 'No custom sequence chosen. Task will flow through all team members.'
                          : 'No members added to the chain yet. Click below to add steps.'}
                      </div>
                    )}

                    {/* Available Team Members to Append */}
                    <div>
                      <span className="text-muted block text-xs font-medium">Add step to chain:</span>
                      {members.length === 0 ? (
                        <p className="text-amber mt-1 text-xs">
                          No active members found in this team roster.
                        </p>
                      ) : (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {members.map((m: MemberRow) => {
                            const isAlreadySelected = selectedMemberIds.includes(m.id);
                            return (
                              <button
                                type="button"
                                key={m.id}
                                disabled={isAlreadySelected}
                                onClick={() => handleAddMemberToRelay(m.id)}
                                className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                                  isAlreadySelected
                                    ? 'border-hairline bg-cool-slate text-faint cursor-not-allowed'
                                    : 'border-hairline bg-white text-ink hover:border-active hover:bg-blue-50'
                                }`}
                              >
                                <Plus size={12} className={isAlreadySelected ? 'text-faint' : 'text-active'} />
                                <span>{m.name}</span>
                                {m.pendingInvite && (
                                  <span className="rounded bg-amber-50 px-1 py-0.5 text-[10px] font-medium text-amber-700">
                                    Pending
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                );
              }}
            </AsyncView>
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-hairline pt-4">
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={submitting}>
            {submitting
              ? uploadProgress !== null
                ? `Uploading (${uploadProgress}%)...`
                : 'Assigning...'
              : isOwner
                ? 'Confirm assignment'
                : 'Create relay task'}
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}

