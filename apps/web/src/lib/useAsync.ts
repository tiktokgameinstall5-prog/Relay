/**
 * Run an async loader and expose its lifecycle as ONE discriminated union, so a
 * screen renders exactly one of loading / error / ready and cannot land in a
 * contradictory combination of separate boolean flags.
 *
 * The loader is re-run whenever `key` changes — pass the id a screen is keyed on
 * (e.g. a teamId) so navigating between two drill-downs refetches instead of
 * showing the previous team's rows. `reload()` re-runs it on demand, for after a
 * mutation (a member added on the manager screen). A resolve or reject that lands
 * after the key changed or the component unmounted is dropped, so a slow first
 * request can never overwrite the result of a newer one.
 *
 * The loader is read through a ref, so passing a fresh arrow every render (the
 * normal thing) does not by itself retrigger the effect — only `key`/`reload` do.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export type AsyncState<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error'; error: Error };

export function useAsync<T>(
  loader: () => Promise<T>,
  key = '',
): { state: AsyncState<T>; reload: () => void } {
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const [reloadCount, setReloadCount] = useState(0);
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    loaderRef.current().then(
      (data) => {
        if (!cancelled) setState({ status: 'ready', data });
      },
      (error: unknown) => {
        if (!cancelled) {
          setState({
            status: 'error',
            error: error instanceof Error ? error : new Error('Request failed.'),
          });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key, reloadCount]);

  const reload = useCallback(() => setReloadCount((n) => n + 1), []);
  return { state, reload };
}
