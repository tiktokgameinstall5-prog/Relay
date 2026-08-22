/**
 * Renders the loading / error arms of an {@link AsyncState} and hands the ready
 * data to its children — so a data screen writes only its success branch and the
 * three states stay visually consistent across every dashboard.
 *
 * A 401 has already been normalised to one sentence in client.ts (the anti-oracle
 * rule); everything else shows the server's message in a plain card. There is no
 * retry button here on purpose: the owner screens reload on navigation, and a
 * failed read is usually "the API is not running", which a button will not fix.
 */
import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { AsyncState } from '../lib/useAsync';
import { Panel } from './Panel';

export function AsyncView<T>({
  state,
  children,
}: {
  state: AsyncState<T>;
  children: (data: T) => ReactNode;
}) {
  if (state.status === 'loading') {
    return <div className="text-muted py-16 text-center text-sm">Loading…</div>;
  }
  if (state.status === 'error') {
    return (
      <Panel icon={<AlertTriangle size={18} className="text-amber" />} title="Couldn’t load this">
        <p>{state.error.message}</p>
      </Panel>
    );
  }
  return <>{children(state.data)}</>;
}
