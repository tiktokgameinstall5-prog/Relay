import type { ReactNode } from 'react';

export function StatTile({
  label,
  value,
  icon,
  trend,
  color = 'blue',
}: {
  label: string;
  value: number | string;
  icon?: ReactNode;
  trend?: string;
  color?: 'blue' | 'emerald' | 'amber' | 'violet' | 'indigo' | 'rose';
}) {
  const colorMap = {
    blue: 'bg-blue-50 text-blue-600 border-blue-100',
    emerald: 'bg-emerald-50 text-emerald-600 border-emerald-100',
    amber: 'bg-amber-50 text-amber-600 border-amber-100',
    violet: 'bg-violet-50 text-violet-600 border-violet-100',
    indigo: 'bg-indigo-50 text-indigo-600 border-indigo-100',
    rose: 'bg-rose-50 text-rose-600 border-rose-100',
  };

  return (
    <div className="group rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xs hover:border-slate-300 hover:shadow-xs transition-all">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-500">{label}</span>
        {icon && (
          <div className={`flex h-7 w-7 items-center justify-center rounded-lg border ${colorMap[color]} shadow-2xs transition-transform group-hover:scale-105`}>
            {icon}
          </div>
        )}
      </div>
      <div className="mt-2 flex items-baseline justify-between">
        <div className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 tabular-nums">
          {value}
        </div>
        {trend && (
          <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200/60">
            {trend}
          </span>
        )}
      </div>
    </div>
  );
}
