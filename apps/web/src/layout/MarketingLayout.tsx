/**
 * Chrome for the public marketing pages: a light top bar with the wordmark and
 * the two entry points, and a footer.
 *
 * This is the only outward-facing, unauthenticated *marketing* surface. Unlike
 * AuthLayout (a centred credential card that leaks nothing) and AppShell (the
 * authenticated dark sidebar), it links OUT to signup/login. Signup is the
 * Owner's self-service door (CLAUDE.md §1); managers/members never see a public
 * registration form, so the only account CTA here is "Start free" → owner signup.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Layers } from 'lucide-react';
import { ThemeToggle } from '../components/ThemeToggle';

export function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-white dark:bg-[#0b0d13] text-ink dark:text-slate-100 transition-colors">
      <header className="border-hairline dark:border-slate-800/80 sticky top-0 z-10 border-b bg-white/90 dark:bg-[#0b0d13]/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 sm:px-6 py-3 sm:py-3.5">
          <div className="bg-signal flex h-8 w-8 items-center justify-center rounded-lg shadow-sm shadow-blue-500/20">
            <Layers size={17} color="white" />
          </div>
          <span className="font-display text-lg font-bold text-slate-900 dark:text-white">Relay</span>
          <div className="flex-1" />
          <nav className="flex items-center gap-1.5 sm:gap-2">
            <ThemeToggle />
            <Link
              to="/login"
              className="text-ink dark:text-slate-200 hover:bg-cool-slate dark:hover:bg-slate-800/80 rounded-lg px-2.5 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-semibold transition-colors"
            >
              Log in
            </Link>
            <Link
              to="/signup"
              className="bg-signal hover:bg-signal-hover rounded-lg px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-semibold text-white shadow-2xs transition-colors"
            >
              Start free
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1 w-full overflow-x-hidden">{children}</main>

      <footer className="border-hairline dark:border-slate-800/80 border-t bg-white dark:bg-[#0b0d13]">
        <div className="text-muted dark:text-slate-400 mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 sm:px-6 py-6 text-xs sm:flex-row">
          <div className="flex items-center gap-1.5">
            <span className="font-display text-ink dark:text-slate-200 font-bold">Relay</span>
            <span>· Team workspace &amp; task-relay platform</span>
          </div>
          <div>Owner sign-up is self-service. Managers and members join by invite.</div>
        </div>
      </footer>
    </div>
  );
}
