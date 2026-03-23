/**
 * lazyWithRetry — React.lazy wrapper with exponential-backoff retry.
 *
 * Why: Vite code-split chunks are content-addressed (hash in filename).
 * A transient network hiccup on a LAN connection causes a chunk fetch to
 * fail. Without retry, React throws a ChunkLoadError and the user sees a
 * broken route. With retry, the fetch re-attempts up to `maxRetries` times
 * before surfacing the error to the ChunkErrorBoundary.
 *
 * Usage:
 *   const SystemFocusView = lazyWithRetry(
 *     () => import('./components/SystemFocusView').then(m => ({ default: m.SystemFocusView }))
 *   );
 */

import { lazy } from 'react';

export function lazyWithRetry<T extends React.ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
  maxRetries = 3,
  baseDelayMs = 800,
): React.LazyExoticComponent<T> {
  return lazy(() => {
    let attempt = 0;

    const load = (): Promise<{ default: T }> =>
      factory().catch((err: unknown) => {
        attempt += 1;
        if (attempt > maxRetries) {
          console.error(`[Chunk] Failed after ${maxRetries} retries:`, err);
          throw err;
        }
        const delay = baseDelayMs * Math.pow(2, attempt - 1); // 800, 1600, 3200ms
        console.warn(`[Chunk] Load failed (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms…`, err);
        return new Promise<void>(resolve => setTimeout(resolve, delay)).then(load);
      });

    return load();
  });
}
