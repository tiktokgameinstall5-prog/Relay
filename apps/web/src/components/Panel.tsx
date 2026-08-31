/**
 * A white card with a hairline border — CLAUDE.md §9's card treatment, with no
 * shadow (shadow is for hover and modals only).
 *
 * Used for the Phase 2 stubs and the role-refusal panel, which are the two
 * places the app has to say "there is deliberately nothing here".
 */
import type { ReactNode } from 'react';

export function Panel({
  icon,
  title,
  className = '',
  children,
}: {
  icon?: ReactNode;
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`border-hairline rounded-xl border bg-white ${title ? 'p-6' : ''} ${className}`}>
      {title && (
        <div className="mb-2 flex items-center gap-2">
          {icon}
          <h2 className="font-display text-[15px] font-semibold">{title}</h2>
        </div>
      )}
      {title ? (
        <div className="text-sm text-[#68707C]">{children}</div>
      ) : (
        children
      )}
    </div>
  );
}
