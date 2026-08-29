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
  active: { className: 'bg-active', label: 'Active' },
  in_progress: { className: 'bg-active', label: 'In Progress' },
  completed: { className: 'bg-done', label: 'Completed' },
  pending: { className: 'bg-amber', label: 'Pending' },
  scheduled: { className: 'bg-[#579bfc]', label: 'Scheduled' },
  inactive: { className: 'bg-[#C4C7D0]', label: 'Deactivated' },
} as const;

export type ChipStatus = keyof typeof VARIANTS;

export function StatusChip({ status, label }: { status: ChipStatus; label?: string }) {
  const variant = VARIANTS[status];
  return (
    <span
      className={`inline-block rounded-md px-2.5 py-1 text-[11px] font-semibold text-white ${variant.className}`}
    >
      {label ?? variant.label}
    </span>
  );
}
