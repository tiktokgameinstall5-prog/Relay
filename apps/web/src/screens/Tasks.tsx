/**
 * The Tasks & Relay Workflow screen (CLAUDE.md §2, §9).
 *
 * Displays all tasks in the caller's tenant slice:
 *   • Manager: Can view team tasks, create new ordered relay tasks, and watch live progression.
 *   • Member: Can view team tasks and see their active step with a prominent "Forward to [Next]" button.
 *   • Owner: Org-wide task oversight.
 *
 * Implements 5-second short polling so step completions by teammates reflect live.
 */
import { useEffect, useState, type FormEvent } from 'react';
import {
  CheckCircle2,
  FileText,
  Paperclip,
  Plus,
  Radio,
  Send,
  Video,
  X,
  ArrowDown,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { createTask, forwardStep, listTasks } from '../api/workflow';
import { listTeamMembers, listTeams } from '../api/auth';
import { ApiError } from '../api/client';
import type { MemberRow, TaskResponse, TaskType } from '../api/types';
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

  const { state, reload } = useAsync(async () => {
    return await listTasks();
  });

  // Short-polling effect: refresh every 5s while mounted
  useEffect(() => {
    const timer = setInterval(() => {
      // Background poll: refetch listTasks without unmounting view
      listTasks().catch(() => {
        // Silent failure on transient poll error
      });
      reload();
    }, POLL_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [reload]);

  const isManager = user?.role === 'manager';

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

        {isManager && (
          <Button variant="primary" onClick={() => setShowCreateModal(true)}>
            <Plus size={16} className="-ml-1" />
            Assign task
          </Button>
        )}
      </div>

      {actionError && (
        <div className="mt-4">
          <Alert variant="error">{actionError}</Alert>
        </div>
      )}

      <div className="mt-6">
        <AsyncView state={state}>
          {(tasks) =>
            tasks.length === 0 ? (
              <EmptyTasksState isManager={isManager} onAssign={() => setShowCreateModal(true)} />
            ) : (
              <div className="space-y-4">
                {tasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    currentUserId={user?.id ?? ''}
                    onForwardSuccess={() => {
                      setActionError(null);
                      reload();
                    }}
                    onForwardError={(msg) => setActionError(msg)}
                  />
                ))}
              </div>
            )
          }
        </AsyncView>
      </div>

      {showCreateModal && (
        <CreateTaskModal
          onClose={() => setShowCreateModal(false)}
          onCreated={() => {
            setShowCreateModal(false);
            reload();
          }}
        />
      )}
    </div>
  );
}

function EmptyTasksState({
  isManager,
  onAssign,
}: {
  isManager: boolean;
  onAssign: () => void;
}) {
  return (
    <Panel className="flex flex-col items-center justify-center p-12 text-center">
      <div className="rounded-full bg-slate-100 p-4">
        <FileText size={32} className="text-muted" />
      </div>
      <h3 className="mt-4 font-semibold text-ink">No tasks assigned yet</h3>
      <p className="text-muted mt-1 max-w-sm text-sm">
        {isManager
          ? 'Assign your team their first relay task to start moving work sequentially through the chain.'
          : 'No tasks have been assigned to your team yet.'}
      </p>
      {isManager && (
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

function TaskCard({
  task,
  currentUserId,
  onForwardSuccess,
  onForwardError,
}: {
  task: TaskResponse;
  currentUserId: string;
  onForwardSuccess: () => void;
  onForwardError: (msg: string) => void;
}) {
  const [forwarding, setForwarding] = useState(false);

  const isCompleted = task.status === 'completed';
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

  async function handleForward() {
    setForwarding(true);
    try {
      await forwardStep(task.id);
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
              {task.description && (
                <p className="text-muted mt-0.5 line-clamp-1 text-xs">{task.description}</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <span className="text-muted font-mono text-xs">
              {task.completedSteps}/{task.totalSteps} steps
            </span>
            <StatusChip status={task.status} />
          </div>
        </div>

        {/* Relay Chain Visualization */}
        <div className="mt-4 rounded-lg bg-wash p-3">
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="text-muted font-medium">Relay sequence</span>
            {task.currentAssignee ? (
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

        {/* Action Bar / Forward Prompt */}
        <div className="mt-4 flex flex-col items-start justify-between gap-3 border-t border-hairline pt-3 text-xs sm:flex-row sm:items-center">
          <div className="text-faint">Created {fmtDateTime(task.createdAt)}</div>

          {isMyActiveStep && (
            <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
              <Button
                variant="primary"
                onClick={handleForward}
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
      </div>
    </Panel>
  );
}

function CreateTaskModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState<TaskType>('text');
  const [description, setDescription] = useState('');
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load manager's team members
  const { state: teamState } = useAsync(async () => {
    const teams = await listTeams();
    const myTeam = teams[0] ?? null;
    if (!myTeam) return { team: null, members: [] };
    const members = await listTeamMembers(myTeam.id);
    return { team: myTeam, members };
  });

  function handleAddMemberToRelay(memberId: string) {
    setSelectedMemberIds((prev) => [...prev, memberId]);
  }

  function handleRemoveStep(index: number) {
    setSelectedMemberIds((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (selectedMemberIds.length === 0) {
      setError('Please select at least one team member in the relay sequence.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await createTask({
        name: name.trim(),
        type,
        description: description.trim() ? description.trim() : undefined,
        memberIds: selectedMemberIds,
      });
      onCreated();
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to create task relay.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModalShell title="Assign new task relay" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <Alert variant="error">{error}</Alert>}

        <Field
          label="Task name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Brand Launch Video"
        />

        <div>
          <label className="mb-1 block text-xs font-medium text-[#68707C]">Task type</label>
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
          <label className="mb-1 block text-xs font-medium text-[#68707C]">
            Description (optional)
          </label>
          <textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Brief notes or instructions for the team..."
            className="focus:ring-signal w-full rounded-lg border border-hairline px-3 py-2 text-sm outline-none focus:ring-2"
          />
        </div>

        {/* Member Roster & Relay Order Picker */}
        <div className="border-t border-hairline pt-3">
          <label className="text-muted block text-xs font-semibold uppercase tracking-wider">
            Relay sequence (ordered steps)
          </label>
          <p className="text-faint text-xs">
            Add team members in the order work should flow. Step 1 starts immediately.
          </p>

          <AsyncView state={teamState}>
            {({ members }) => {
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
                      No members added to the chain yet. Click below to add steps.
                    </div>
                  )}

                  {/* Available Team Members to Append */}
                  <div>
                    <span className="text-muted block text-xs font-medium">Add step to chain:</span>
                    {members.length === 0 ? (
                      <p className="text-amber mt-1 text-xs">
                        No active members found in your team roster. Add members to your team first.
                      </p>
                    ) : (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {members.map((m: MemberRow) => (
                          <button
                            type="button"
                            key={m.id}
                            onClick={() => handleAddMemberToRelay(m.id)}
                            className="flex items-center gap-1.5 rounded-full border border-hairline bg-white px-3 py-1 text-xs font-medium text-ink hover:border-active hover:bg-blue-50"
                          >
                            <Plus size={12} className="text-active" />
                            {m.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            }}
          </AsyncView>
        </div>

        <div className="flex justify-end gap-2 border-t border-hairline pt-4">
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={submitting || selectedMemberIds.length === 0}>
            {submitting ? 'Creating...' : 'Create relay task'}
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}
