/**
 * Centred card layout for the three unauthenticated screens.
 *
 * Deliberately shows the Relay wordmark and nothing else — no nav, no org name,
 * nothing that would leak whether an email or organization exists to someone
 * who is not signed in.
 */
import type { ReactNode } from 'react';
import { Layers } from 'lucide-react';
import { ThemeToggle } from '../components/ThemeToggle';

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
    <div className="bg-cool-slate dark:bg-[#0b0d13] text-ink dark:text-slate-100 flex min-h-screen items-center justify-center p-4 relative transition-colors">
      <div className="absolute top-4 right-4 sm:top-6 sm:right-6">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2">
          <div className="bg-signal flex h-8 w-8 items-center justify-center rounded-lg shadow-sm shadow-blue-500/20">
            <Layers size={17} color="white" />
          </div>
          <span className="font-display text-lg font-bold text-slate-900 dark:text-white">Relay</span>
        </div>

        <div className="border-hairline dark:border-[#222738] rounded-xl border bg-white dark:bg-[#151821] p-6 shadow-sm">
          <h1 className="font-display text-xl font-semibold text-slate-900 dark:text-slate-100">{title}</h1>
          {subtitle !== undefined && (
            <p className="mt-1 mb-5 text-sm text-[#68707C] dark:text-slate-400">{subtitle}</p>
          )}
          <div className={subtitle === undefined ? 'mt-5' : ''}>{children}</div>
        </div>

        {footer !== undefined && (
          <p className="mt-4 text-center text-[13px] text-[#68707C] dark:text-slate-400">{footer}</p>
        )}
      </div>
    </div>
  );
}
