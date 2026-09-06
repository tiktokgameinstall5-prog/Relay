/**
 * Slide-over Task Detail Drawer (Inspired by Asana & Linear).
 *
 * Allows users to inspect complete task metadata, readable brief/description,
 * sequential step-by-step relay timeline with exact durations, and advance
 * or forward work directly without navigating away from the task board.
 */
import { useEffect, useState } from 'react';
import {
  ArrowRight,
  ArrowRightLeft,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  FileText,
  Paperclip,
  Send,
  Sparkles,
  User,
  Video,
  X,
} from 'lucide-react';
import type { TaskResponse, TaskType } from '../api/types';
import { Avatar } from './Avatar';
import { Button } from './Button';
import { durationFromSeconds, fmtDateTime } from '../lib/format';
import { forwardStep } from '../api/workflow';
import { ApiError } from '../api/client';

interface TaskDetailDrawerProps {
  task: TaskResponse;
  currentUserId: string;
  userRole: string;
  onClose: () => void;
  onForwardSuccess: () => void;
  onForwardError: (msg: string) => void;
}

function TaskTypeIcon({ type }: { type: TaskType }) {
  switch (type) {
    case 'video':
      return <Video size={16} className="text-blue-500" />;
    case 'file':
      return <Paperclip size={16} className="text-amber-500" />;
    case 'text':
    default:
      return <FileText size={16} className="text-slate-500" />;
  }
}

export function TaskDetailDrawer({
  task,
  currentUserId,
  userRole,
  onClose,
  onForwardSuccess,
  onForwardError,
}: TaskDetailDrawerProps) {
  const [copied, setCopied] = useState(false);
  const [forwarding, setForwarding] = useState(false);

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const isMyActiveStep =
    task.status === 'in_progress' && task.currentAssignee?.id === currentUserId;

  const activeStep = task.steps.find((s) => s.status === 'active');
  const nextStep = activeStep
    ? task.steps.find((s) => s.stepOrder === activeStep.stepOrder + 1)
    : null;

  const percentComplete =
    task.totalSteps > 0
      ? Math.round((task.completedSteps / task.totalSteps) * 100)
      : 0;

  async function handleCopyDescription() {
    if (!task.description) return;
    try {
      await navigator.clipboard.writeText(task.description);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const el = document.createElement('textarea');
      el.value = task.description;
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

  async function handleForward() {
    setForwarding(true);
    try {
      await forwardStep(task.id);
      onForwardSuccess();
      onClose();
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
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Dimmed backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity animate-in fade-in duration-200"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-over panel */}
      <div className="relative z-10 flex h-full w-full max-w-xl flex-col bg-white shadow-2xl border-l border-slate-200 animate-in slide-in-from-right duration-250">
        {/* Top Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 bg-slate-50/50">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white border border-slate-200/80 shadow-2xs">
              <TaskTypeIcon type={task.type} />
            </span>
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 font-mono">
                {task.type} Workflow
              </span>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-700">Task Details</span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close drawer"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Title & Status Bar */}
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-xl font-bold tracking-tight text-slate-900">
                {task.name}
              </h2>
              {task.status === 'completed' && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 border border-emerald-200">
                  <CheckCircle2 size={12} className="text-emerald-600" />
                  Completed
                </span>
              )}
              {task.status === 'scheduled' && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-50 px-2.5 py-0.5 text-xs font-semibold text-violet-700 border border-violet-200">
                  <Clock size={12} className="text-violet-600" />
                  Scheduled
                </span>
              )}
              {task.status === 'in_progress' && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700 border border-blue-200">
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
                  In Progress
                </span>
              )}
            </div>

            {/* Micro-progress meter */}
            <div className="mt-3 rounded-xl border border-slate-200/80 bg-slate-50/80 p-3">
              <div className="flex items-center justify-between text-xs font-medium text-slate-700 mb-1.5">
                <span>Relay Progression</span>
                <span className="font-mono text-slate-500">
                  {task.completedSteps} of {task.totalSteps} steps ({percentComplete}%)
                </span>
              </div>
              <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${percentComplete}%` }}
                />
              </div>
            </div>
          </div>

          {/* Key Properties Grid */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="rounded-xl border border-slate-200/80 p-3 bg-white shadow-2xs">
              <span className="text-slate-400 font-medium block">Current Assignee</span>
              <div className="mt-1 flex items-center gap-2">
                {task.currentAssignee ? (
                  <>
                    <Avatar name={task.currentAssignee.name} size={22} />
                    <span className="font-semibold text-slate-800 truncate">
                      {task.currentAssignee.name}
                    </span>
                  </>
                ) : (
                  <span className="text-slate-500 font-medium">None / Finished</span>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200/80 p-3 bg-white shadow-2xs">
              <span className="text-slate-400 font-medium block">Created Date</span>
              <div className="mt-1 flex items-center gap-1.5 font-medium text-slate-700">
                <Calendar size={13} className="text-slate-400" />
                <span>{fmtDateTime(task.createdAt)}</span>
              </div>
            </div>

            {task.scheduledFor && (
              <div className="col-span-2 rounded-xl border border-violet-200/80 bg-violet-50/40 p-3 text-violet-900 shadow-2xs">
                <span className="text-violet-600 font-medium block">Scheduled Kickoff</span>
                <div className="mt-1 flex items-center gap-1.5 font-semibold">
                  <Clock size={13} className="text-violet-500" />
                  <span>{fmtDateTime(task.scheduledFor)}</span>
                </div>
              </div>
            )}
          </div>

          {/* Description Section */}
          <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <span className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                <FileText size={13} className="text-slate-400" />
                Brief & Instructions
              </span>
              {task.description && (
                <button
                  type="button"
                  onClick={handleCopyDescription}
                  className="flex items-center gap-1 rounded-md border border-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-600 hover:bg-slate-50 transition-colors shadow-2xs"
                  title="Copy full instructions"
                >
                  {copied ? (
                    <>
                      <Check size={12} className="text-emerald-600" />
                      <span className="text-emerald-600 font-semibold">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy size={12} className="text-slate-400" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              )}
            </div>
            <div className="mt-3 text-xs leading-relaxed text-slate-700 whitespace-pre-wrap select-text">
              {task.description || (
                <span className="text-slate-400 italic">No description provided for this task.</span>
              )}
            </div>
          </div>

          {/* Step Progression Timeline (Asana / Process Street style) */}
          <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <span className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                <ArrowRightLeft size={13} className="text-blue-500" />
                Relay Sequence Steps ({task.steps.length})
              </span>
              <span className="text-[11px] font-mono text-slate-400">Sequential Hand-off</span>
            </div>

            <div className="mt-4 relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
              {task.steps.map((step, idx) => {
                const isCompleted = step.status === 'completed';
                const isActive = step.status === 'active';
                return (
                  <div key={step.id} className="relative">
                    {/* Status node dot on timeline */}
                    <div
                      className={`absolute -left-6 top-0 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ring-4 ring-white ${
                        isCompleted
                          ? 'bg-emerald-500 text-white'
                          : isActive
                            ? 'bg-blue-600 text-white shadow-xs animate-pulse'
                            : 'bg-slate-200 text-slate-600'
                      }`}
                    >
                      {isCompleted ? <Check size={11} /> : idx + 1}
                    </div>

                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <Avatar name={step.assignedUserName} size={26} />
                        <div>
                          <span className="font-semibold text-xs text-slate-800">
                            {step.assignedUserName}
                          </span>
                          <div className="text-[10.5px] text-slate-400">
                            Step {step.stepOrder} of {task.totalSteps}
                          </div>
                        </div>
                      </div>

                      <div>
                        {isCompleted && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 border border-emerald-200">
                            Done · {durationFromSeconds(step.durationSeconds)}
                          </span>
                        )}
                        {isActive && (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700 border border-blue-200">
                            <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-ping" />
                            Holding Baton
                          </span>
                        )}
                        {step.status === 'pending' && (
                          <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                            Waiting
                          </span>
                        )}
                      </div>
                    </div>

                    {step.startedAt && (
                      <div className="mt-1 text-[10px] text-slate-400 pl-8">
                        Started: {fmtDateTime(step.startedAt)}
                        {step.completedAt && ` · Finished: ${fmtDateTime(step.completedAt)}`}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Action Footer (if active user holds the baton) */}
        {isMyActiveStep && (
          <div className="border-t border-slate-200 bg-slate-50 p-4 flex items-center justify-between gap-3">
            <div className="text-xs font-medium text-slate-600 flex items-center gap-1.5">
              <Sparkles size={14} className="text-blue-600" />
              <span>You currently hold this active step.</span>
            </div>

            <Button
              variant="primary"
              onClick={handleForward}
              disabled={forwarding}
              className="bg-blue-600 hover:bg-blue-700 font-semibold text-xs shadow-xs"
            >
              <Send size={13} className="-ml-0.5" />
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
  );
}
