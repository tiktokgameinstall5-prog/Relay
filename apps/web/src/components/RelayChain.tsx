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
      <div className="flex items-center gap-1 overflow-x-auto py-2">
        {steps.map((step, i) => {
          const isActive = step.state === 'active';
          const firstName = step.name.split(' ')[0] ?? step.name;
          return (
            <Fragment key={step.id}>
              <div className="flex min-w-[68px] flex-col items-center gap-1">
                <div className="relative">
                  <Avatar name={step.name} size={34} ring={isActive} />
                  {step.state === 'completed' && (
                    <div className="absolute -right-0.5 -bottom-0.5 rounded-full bg-white">
                      {/* #00C875 / #E7FBF1 mirror the done / done-soft tokens —
                          lucide takes colour strings on props, not utilities. */}
                      <CheckCircle2 size={13} color="#00C875" fill="#E7FBF1" />
                    </div>
                  )}
                  {isActive && (
                    <span className="bg-active absolute -top-1 -right-1 h-2.5 w-2.5 animate-pulse rounded-full" />
                  )}
                </div>
                <div
                  className={`text-center text-[11px] leading-tight font-medium ${
                    isActive ? 'text-active' : 'text-muted'
                  }`}
                >
                  {firstName}
                </div>
                <div className="text-faint font-mono text-[10px]">
                  {durationFromSeconds(step.durationSeconds)}
                </div>
              </div>
              {i < steps.length - 1 && (
                <ArrowRight size={13} className="text-gray mb-5 shrink-0" />
              )}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
