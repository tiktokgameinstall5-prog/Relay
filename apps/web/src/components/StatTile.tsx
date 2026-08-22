/**
 * A dashboard stat tile: one big number under a small label, in the §9 card
 * treatment (white, rounded-xl, hairline border, no shadow).
 *
 * `value` is a required `number`, never a string: every tile shows a real count
 * derived from the API, so the type forbids passing placeholder text. An optional
 * leading icon tints with the label.
 */
import type { ReactNode } from 'react';

export function StatTile({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon?: ReactNode;
}) {
  return (
    <div className="border-hairline rounded-xl border bg-white p-5">
      <div className="text-muted flex items-center gap-1.5 text-xs font-medium">
        {icon}
        <span>{label}</span>
      </div>
      <div className="font-display mt-2 text-3xl font-bold tabular-nums">{value}</div>
    </div>
  );
}
