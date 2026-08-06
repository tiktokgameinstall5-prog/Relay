/**
 * Status chip. Rebuilt from workspace-relay-prototype.jsx:116-130.
 *
 * CLAUDE.md §9: bold/solid-filled, white text on saturated colour — the
 * monday.com/ClickUp convention — never soft tints.
 *
 * Only the statuses something actually renders today are here. Task statuses
 * (in_progress / scheduled) arrive with the workflow engine in Phase 2 and are
 * added when there is a task to put them on.
 */
const VARIANTS = {
  active: { className: 'bg-active', label: 'Active' },
  completed: { className: 'bg-done', label: 'Completed' },
  pending: { className: 'bg-amber', label: 'Pending' },
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
