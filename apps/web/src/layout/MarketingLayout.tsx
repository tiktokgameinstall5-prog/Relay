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

export function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <header className="border-hairline sticky top-0 z-10 border-b bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-6 py-3.5">
          <div className="bg-signal flex h-8 w-8 items-center justify-center rounded-lg">
            <Layers size={17} color="white" />
          </div>
          <span className="font-display text-lg font-bold">Relay</span>
          <div className="flex-1" />
          <nav className="flex items-center gap-1.5 sm:gap-2">
            <Link
              to="/login"
              className="text-ink hover:bg-cool-slate rounded-lg px-3 py-2 text-sm font-semibold sm:px-4"
            >
              Log in
            </Link>
            <Link
              to="/signup"
              className="bg-signal hover:bg-signal-hover rounded-lg px-3 py-2 text-sm font-semibold text-white sm:px-4"
            >
              Start free
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-hairline border-t">
        <div className="text-muted mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-6 py-6 text-xs sm:flex-row">
          <div className="flex items-center gap-1.5">
            <span className="font-display text-ink font-bold">Relay</span>
            <span>· Team workspace &amp; task-relay platform</span>
          </div>
          <div>Owner sign-up is self-service. Managers and members join by invite.</div>
        </div>
      </footer>
    </div>
  );
}
