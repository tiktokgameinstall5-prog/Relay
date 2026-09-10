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
    blue: 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border-blue-100 dark:border-blue-900/50',
    emerald: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border-emerald-100 dark:border-emerald-900/50',
    amber: 'bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border-amber-100 dark:border-amber-900/50',
    violet: 'bg-violet-50 dark:bg-violet-950/40 text-violet-600 dark:text-violet-400 border-violet-100 dark:border-violet-900/50',
    indigo: 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 border-indigo-100 dark:border-indigo-900/50',
    rose: 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 border-rose-100 dark:border-rose-900/50',
  };

  return (
    <div className="group rounded-2xl border border-slate-200/80 dark:border-[#222738] bg-white dark:bg-[#151821] p-4 sm:p-5 shadow-2xs hover:border-slate-300 dark:hover:border-slate-700 hover:shadow-xs transition-all">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">{label}</span>
        {icon && (
          <div className={`flex h-7 w-7 items-center justify-center rounded-lg border ${colorMap[color]} shadow-2xs transition-transform group-hover:scale-105`}>
            {icon}
          </div>
        )}
      </div>
      <div className="mt-2 flex items-baseline justify-between">
        <div className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100 tabular-nums">
          {value}
        </div>
        {trend && (
          <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-full border border-emerald-200/60 dark:border-emerald-800/50">
            {trend}
          </span>
        )}
      </div>
    </div>
  );
}
