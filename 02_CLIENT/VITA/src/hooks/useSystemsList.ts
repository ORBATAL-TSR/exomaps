/**
 * useSystemsList — fetches and caches the star system catalog.
 *
 * Uses a module-level cache so the JSON is fetched exactly once per session.
 * On back-navigation (DesktopLayout remounts) the cache is hit synchronously —
 * stars appear immediately.
 *
 * getCachedSystems() is also exported for use in lazy-loaded modules (e.g.
 * SystemFocusView) that need catalog data without a React hook.
 */

import { useState, useEffect } from 'react';
import { verifiedFetch } from '../utils/verifiedFetch';
import type { StarSystem } from '../components/StarField';

// Module-level: survives component mounts/unmounts.
let _cache: StarSystem[] | null = null;
const _listeners = new Set<(systems: StarSystem[]) => void>();

/** Synchronous read of the cache. Returns [] before first fetch resolves. */
export function getCachedSystems(): StarSystem[] {
  return _cache ?? [];
}

export function useSystemsList() {
  const [systems, setSystems] = useState<StarSystem[]>(_cache ?? []);
  const [loading, setLoading]   = useState(_cache === null);

  useEffect(() => {
    if (_cache !== null) return; // already loaded

    // Register this component as a listener so it updates when fetch resolves.
    _listeners.add(setSystems);
    return () => { _listeners.delete(setSystems); };
  }, []);

  useEffect(() => {
    if (_cache !== null) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await verifiedFetch('/data/systemsList.json');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: StarSystem[] = await res.json();
        if (!cancelled) {
          _cache = data;
          _listeners.forEach(fn => fn(data));
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          console.error('[useSystemsList] Failed to load systemsList.json:', e);
          setLoading(false);
        }
      }
    })();

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { systems, loading };
}
