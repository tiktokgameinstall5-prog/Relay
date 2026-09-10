/**
 * The relay chain — Relay's signature UI element (CLAUDE.md §9): a horizontal row
 * of member avatars joined by arrows, the active member ring-highlighted with a
 * pulsing dot, completed members check-marked, and per-step duration in mono type
 * underneath. Rebuilt from workspace-relay-prototype.jsx:145-180.
 *
 * PURELY PRESENTATIONAL — driven entirely by the RelayStep[] it is handed. It has
 * no forward/complete action (the prototype's did) because the workflow engine
 * does not exist yet: its only caller this phase is the public landing page,
 * fed fixed marketing data (screens/landing/relayDemo.ts). When the engine lands,
 * the real board renders this same component from live task_step rows.
 */
import { Fragment } from 'react';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { Avatar } from './Avatar';
import { durationFromSeconds } from '../lib/format';

export interface RelayStep {
  id: string;
  name: string;
  state: 'completed' | 'active' | 'pending';
  /** Recorded elapsed time on this step; null while the step is still pending. */
  durationSeconds: number | null;
}

export function RelayChain({
  steps,
  label,
}: {
  steps: RelayStep[];
  label?: string | undefined;
}) {
  return (
    <div>
      {label && <div className="text-muted mb-1 text-xs font-medium">{label}</div>}
      <div className="flex items-center justify-between sm:justify-start gap-1 sm:gap-1.5 overflow-x-auto no-scrollbar scroll-smooth touch-pan-x py-1.5 px-0.5">
        {steps.map((step, i) => {
          const isActive = step.state === 'active';
          const firstName = step.name.split(' ')[0] ?? step.name;
          return (
            <Fragment key={step.id}>
              <div className="flex min-w-[58px] xs:min-w-[64px] sm:min-w-[68px] flex-col items-center gap-1 shrink-0">
                <div className="relative">
                  <Avatar name={step.name} size={30} ring={isActive} />
                  {step.state === 'completed' && (
                    <div className="absolute -right-0.5 -bottom-0.5 rounded-full bg-white dark:bg-[#0e1118]">
                      <CheckCircle2 size={13} className="text-[#00C875] fill-[#E7FBF1] dark:fill-[#082a1c]" />
                    </div>
                  )}
                  {isActive && (
                    <span className="bg-active absolute -top-1 -right-1 h-2.5 w-2.5 animate-pulse rounded-full" />
                  )}
                </div>
                <div
                  className={`text-center text-[10.5px] sm:text-[11px] leading-tight font-medium truncate max-w-[58px] xs:max-w-none ${
                    isActive ? 'text-active font-semibold' : 'text-slate-700 dark:text-slate-200'
                  }`}
                >
                  {firstName}
                </div>
                <div className="text-slate-500 dark:text-slate-400 font-mono text-[9.5px] sm:text-[10px]">
                  {durationFromSeconds(step.durationSeconds)}
                </div>
              </div>
              {i < steps.length - 1 && (
                <ArrowRight size={12} className="text-gray mb-4 sm:mb-5 shrink-0" />
              )}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
