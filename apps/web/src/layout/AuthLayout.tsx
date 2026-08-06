/**
 * Centred card layout for the three unauthenticated screens.
 *
 * Deliberately shows the Relay wordmark and nothing else — no nav, no org name,
 * nothing that would leak whether an email or organization exists to someone
 * who is not signed in.
 */
import type { ReactNode } from 'react';
import { Layers } from 'lucide-react';

export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="bg-cool-slate flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2">
          <div className="bg-signal flex h-8 w-8 items-center justify-center rounded-lg">
            <Layers size={17} color="white" />
          </div>
          <span className="font-display text-lg font-bold">Relay</span>
        </div>

        <div className="border-hairline rounded-xl border bg-white p-6">
          <h1 className="font-display text-xl font-semibold">{title}</h1>
          {subtitle !== undefined && (
            <p className="mt-1 mb-5 text-sm text-[#68707C]">{subtitle}</p>
          )}
          <div className={subtitle === undefined ? 'mt-5' : ''}>{children}</div>
        </div>

        {footer !== undefined && (
          <p className="mt-4 text-center text-[13px] text-[#68707C]">{footer}</p>
        )}
      </div>
    </div>
  );
}
