/**
 * useOfflineCache — Hook for managing the SQLite offline cache
 * via Tauri IPC commands.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';

/** Safe invoke — throws descriptive error if Tauri IPC isn't available */
async function safeInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
    throw new Error(`Tauri IPC not available (command: ${cmd})`);
  }
  return invoke<T>(cmd, args);
}

export interface OfflineCacheHook {
  cachedSystems: string[];
  cacheCount: number;
  loading: boolean;
  online: boolean;
  cacheSystem: (mainId: string) => Promise<void>;
  getCachedSystem: (mainId: string) => Promise<any | null>;
  isCached: (mainId: string) => boolean;
  refresh: () => Promise<void>;
}

export function useOfflineCache(): OfflineCacheHook {
  const [cachedSystems, setCachedSystems] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(navigator.onLine);

  // Track online/offline
  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const ids = await safeInvoke<string[]>('list_cached_systems');
      setCachedSystems(ids);
    } catch (err) {
      if (!(err instanceof Error && err.message.includes('Tauri IPC not available')))
        console.warn('[Cache] Failed to list cached systems:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load on mount
  useEffect(() => {
    refresh();
  }, [refresh]);

  const cacheSystem = useCallback(
    async (mainId: string) => {
      try {
        await safeInvoke('fetch_and_cache_system', { mainId });
        await refresh();
      } catch (err) {
        console.error('[Cache] Failed to cache system:', mainId, err);
        throw err;
      }
    },
    [refresh]
  );

  const getCachedSystem = useCallback(async (mainId: string) => {
    try {
      const json = await safeInvoke<string | null>('get_cached_system', { mainId });
      return json ? JSON.parse(json) : null;
    } catch {
      return null;
    }
  }, []);

  const cachedSet = useMemo(() => new Set(cachedSystems), [cachedSystems]);

  const isCached = useCallback(
    (mainId: string) => cachedSet.has(mainId),
    [cachedSet]
  );

  return {
    cachedSystems,
    cacheCount: cachedSystems.length,
    loading,
    online,
    cacheSystem,
    getCachedSystem,
    isCached,
    refresh,
  };
}
