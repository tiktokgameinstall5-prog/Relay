/**
 * Status chip. Rebuilt from workspace-relay-prototype.jsx:116-130.
 *
 * CLAUDE.md §9: bold/solid-filled, white text on saturated colour — the
 * monday.com/ClickUp convention — never soft tints.
 *
 * Only the statuses something actually renders today are here. Task statuses
 * (in_progress / scheduled) arrive with the workflow engine in Phase 2 and are
 * added when there is a task to put them on.
 *
 * Deliberate divergence from the prototype: there, `pending` (amber) is a relay
 * step still waiting its turn. Until tasks exist, this app reuses the same amber
 * `pending` chip for a *pending invite* — an account provisioned but not yet
 * activated (password_hash IS NULL). Same visual, different domain; kept on
 * purpose so the dashboards get an invite-state chip without inventing a colour.
 * When the workflow engine lands, `pending` regains its step meaning and
 * invite-state takes its own label if the two ever need to coexist.
 */
const VARIANTS = {
  active: {
    className:
      'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200/70 dark:border-emerald-800/50',
    dot: 'bg-emerald-500',
    label: 'Active',
  },
  in_progress: {
    className:
      'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200/70 dark:border-blue-800/50',
    dot: 'bg-blue-500 animate-pulse',
    label: 'In Progress',
  },
  completed: {
    className:
      'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200/70 dark:border-emerald-800/50',
    dot: 'bg-emerald-500',
    label: 'Completed',
  },
  pending: {
    className:
      'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border border-amber-200/70 dark:border-amber-800/50',
    dot: 'bg-amber-500',
    label: 'Pending',
  },
  scheduled: {
    className:
      'bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-400 border border-violet-200/70 dark:border-violet-800/50',
    dot: 'bg-violet-500',
    label: 'Scheduled',
  },
  inactive: {
    className:
      'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200/70 dark:border-slate-700',
    dot: 'bg-slate-400',
    label: 'Deactivated',
  },
} as const;

export type ChipStatus = keyof typeof VARIANTS;

export function StatusChip({ status, label }: { status: ChipStatus; label?: string }) {
  const variant = VARIANTS[status] ?? VARIANTS.active;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-wide ${variant.className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${variant.dot}`} />
      <span>{label ?? variant.label}</span>
    </span>
  );
}
