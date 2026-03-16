/**
 * useCampaign — React context + hook for campaign state management.
 *
 * Provides:
 *   - Active campaign selection (persisted to localStorage)
 *   - Campaign CRUD via gateway API
 *   - Explored-system set (fog-of-war state)
 *   - Campaign map data
 *   - Dev-mode flag for planet regeneration
 *
 * Wrap <App /> in <CampaignProvider> and consume with useCampaign().
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react';
import type {
  CampaignSummary,
  CampaignMapSystem,
  ExploreSystemResponse,
} from '@exomaps/shared/types/campaign';

/* ── API helpers (raw fetch, matching existing desktop pattern) ── */

const API = '/api';

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const opts: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const resp = await fetch(`${API}${path}`, opts);
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }));
    throw new Error(err.message ?? err.error ?? `API ${resp.status}`);
  }
  return resp.json() as Promise<T>;
}

/* ── Types ───────────────────────────────────────────── */

export interface CampaignState {
  /* Campaign list */
  campaigns: CampaignSummary[];
  loadingCampaigns: boolean;

  /* Active campaign */
  activeCampaignId: string | null;
  activeCampaign: CampaignSummary | null;

  /* Fog-of-war map (explored systems in active campaign) */
  exploredSystems: Map<string, CampaignMapSystem>;
  loadingMap: boolean;

  /* Dev mode */
  devMode: boolean;

  /* Actions */
  refreshCampaigns: () => Promise<void>;
  createCampaign: (name: string, seed?: number, settings?: Record<string, unknown>) => Promise<string>;
  selectCampaign: (id: string | null) => void;
  deleteCampaign: (id: string) => Promise<void>;
  exploreSystem: (systemId: string, opts?: { explored_by?: string; scan_level?: 1 | 2 | 3; notes?: string }) => Promise<ExploreSystemResponse>;
  refreshMap: () => Promise<void>;
  isExplored: (systemMainId: string) => boolean;
  toggleDevMode: () => void;

  /* Simulation shortcuts */
  initSimulation: (opts?: { starting_system?: string }) => Promise<void>;
  tickSimulation: (n?: number) => Promise<any>;
  getSimSnapshot: () => Promise<any>;
}

const CampaignContext = createContext<CampaignState | null>(null);

const STORAGE_KEY = 'exomaps_active_campaign';

/* ── Provider ────────────────────────────────────────── */

export function CampaignProvider({ children }: { children: ReactNode }) {
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(true);
  const [activeCampaignId, setActiveCampaignId] = useState<string | null>(() => {
    try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
  });
  const [exploredMap, setExploredMap] = useState<Map<string, CampaignMapSystem>>(new Map());
  const [loadingMap, setLoadingMap] = useState(false);
  const [devMode, setDevMode] = useState(() => {
    try { return localStorage.getItem('exomaps_dev_mode') === '1'; } catch { return false; }
  });

  /* ── Campaign list ──────────────────────────────── */

  const refreshCampaigns = useCallback(async () => {
    setLoadingCampaigns(true);
    try {
      const data = await api<{ campaigns: CampaignSummary[] }>('GET', '/campaigns?status=active');
      setCampaigns(data.campaigns ?? []);
    } catch (err) {
      console.error('[Campaign] Failed to load campaigns:', err);
    } finally {
      setLoadingCampaigns(false);
    }
  }, []);

  // Boot: fetch campaign list
  useEffect(() => { refreshCampaigns(); }, [refreshCampaigns]);

  /* ── Active campaign ────────────────────────────── */

  const activeCampaign = useMemo(
    () => campaigns.find(c => c.id === activeCampaignId) ?? null,
    [campaigns, activeCampaignId],
  );

  const selectCampaign = useCallback((id: string | null) => {
    setActiveCampaignId(id);
    try {
      if (id) localStorage.setItem(STORAGE_KEY, id);
      else localStorage.removeItem(STORAGE_KEY);
    } catch { /* noop */ }
  }, []);

  /* ── Fog-of-war map ─────────────────────────────── */

  const refreshMap = useCallback(async () => {
    if (!activeCampaignId) {
      setExploredMap(new Map());
      return;
    }
    setLoadingMap(true);
    try {
      const data = await api<{ systems: CampaignMapSystem[] }>(
        'GET', `/campaigns/${activeCampaignId}/map`,
      );
      const map = new Map<string, CampaignMapSystem>();
      for (const sys of data.systems ?? []) {
        map.set(sys.system_main_id, sys);
      }
      setExploredMap(map);
    } catch (err) {
      console.error('[Campaign] Failed to load map:', err);
    } finally {
      setLoadingMap(false);
    }
  }, [activeCampaignId]);

  // Refresh map when active campaign changes
  useEffect(() => { refreshMap(); }, [refreshMap]);

  const isExplored = useCallback(
    (mainId: string) => exploredMap.has(mainId),
    [exploredMap],
  );

  /* ── CRUD actions ───────────────────────────────── */

  const createCampaign = useCallback(async (
    name: string,
    seed?: number,
    settings?: Record<string, unknown>,
  ): Promise<string> => {
    const result = await api<{ id: string }>('POST', '/campaigns', { name, seed, settings });
    await refreshCampaigns();
    selectCampaign(result.id);
    return result.id;
  }, [refreshCampaigns, selectCampaign]);

  const deleteCampaign = useCallback(async (id: string) => {
    await api('DELETE', `/campaigns/${id}`);
    if (activeCampaignId === id) selectCampaign(null);
    await refreshCampaigns();
  }, [activeCampaignId, selectCampaign, refreshCampaigns]);

  const exploreSystem = useCallback(async (
    systemId: string,
    opts?: { explored_by?: string; scan_level?: 1 | 2 | 3; notes?: string },
  ): Promise<ExploreSystemResponse> => {
    if (!activeCampaignId) throw new Error('No active campaign');
    const result = await api<ExploreSystemResponse>(
      'POST',
      `/campaigns/${activeCampaignId}/systems/${encodeURIComponent(systemId)}/explore`,
      opts ?? {},
    );
    // Refresh fog-of-war map
    await refreshMap();
    return result;
  }, [activeCampaignId, refreshMap]);

  /* ── Dev mode ───────────────────────────────────── */

  const toggleDevMode = useCallback(() => {
    setDevMode(prev => {
      const next = !prev;
      try { localStorage.setItem('exomaps_dev_mode', next ? '1' : '0'); } catch { /* noop */ }
      return next;
    });
  }, []);

  /* ── Simulation shortcuts ───────────────────────── */

  const initSimulation = useCallback(async (opts?: { starting_system?: string }) => {
    if (!activeCampaignId) throw new Error('No active campaign');
    await api('POST', `/campaigns/${activeCampaignId}/simulation/init`, opts ?? {});
  }, [activeCampaignId]);

  const tickSimulation = useCallback(async (n = 1) => {
    if (!activeCampaignId) throw new Error('No active campaign');
    return api('POST', `/campaigns/${activeCampaignId}/simulation/tick`, { n });
  }, [activeCampaignId]);

  const getSimSnapshot = useCallback(async () => {
    if (!activeCampaignId) throw new Error('No active campaign');
    return api('GET', `/campaigns/${activeCampaignId}/simulation/snapshot`);
  }, [activeCampaignId]);

  /* ── Context value ──────────────────────────────── */

  const value = useMemo<CampaignState>(() => ({
    campaigns,
    loadingCampaigns,
    activeCampaignId,
    activeCampaign,
    exploredSystems: exploredMap,
    loadingMap,
    devMode,
    refreshCampaigns,
    createCampaign,
    selectCampaign,
    deleteCampaign,
    exploreSystem,
    refreshMap,
    isExplored,
    toggleDevMode,
    initSimulation,
    tickSimulation,
    getSimSnapshot,
  }), [
    campaigns, loadingCampaigns, activeCampaignId, activeCampaign,
    exploredMap, loadingMap, devMode,
    refreshCampaigns, createCampaign, selectCampaign, deleteCampaign,
    exploreSystem, refreshMap, isExplored, toggleDevMode,
    initSimulation, tickSimulation, getSimSnapshot,
  ]);

  return <CampaignContext.Provider value={value}>{children}</CampaignContext.Provider>;
}

/* ── Hook ─────────────────────────────────────────── */

export function useCampaign(): CampaignState {
  const ctx = useContext(CampaignContext);
  if (!ctx) throw new Error('useCampaign must be used inside <CampaignProvider>');
  return ctx;
}
