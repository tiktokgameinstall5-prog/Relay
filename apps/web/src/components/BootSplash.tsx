/**
 * The full-page state shown while AuthContext restores the session from the
 * HttpOnly relay_rt cookie (status === 'loading').
 *
 * It is deliberately neutral — it must imply neither signed-in nor signed-out,
 * because which one is true is exactly what the in-flight refresh call is still
 * deciding. Both RootGate and RequireAuth render it during 'loading' so a visitor
 * with a valid cookie never flashes the marketing Landing or the login screen
 * before the restore resolves. On localhost the refresh is sub-100ms, so this is
 * a brief flash in the normal case and only lingers if the API is slow.
 */
import { Layers } from 'lucide-react';

export function BootSplash() {
  return (
    <div className="bg-cool-slate flex min-h-screen flex-col items-center justify-center gap-4">
      <div className="bg-signal flex h-10 w-10 items-center justify-center rounded-xl">
        <Layers size={20} color="white" />
      </div>
      <span
        role="status"
        aria-label="Loading"
        className="border-hairline border-t-signal h-4 w-4 animate-spin rounded-full border-2"
      />
    </div>
  );
}
