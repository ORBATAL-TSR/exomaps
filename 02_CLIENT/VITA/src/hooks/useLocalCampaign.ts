/**
 * useLocalCampaign — Single-player campaign operations via Tauri IPC.
 *
 * Mirrors the CampaignState interface from useCampaign.tsx but all data
 * is persisted locally in encrypted SQLite via the Rust savegame module.
 * No server connection required.
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';

// ── Types (mirrors server API types) ────────────────

export interface LocalCampaignSummary {
  id: string;
  name: string;
  seed: number;
  status: string;
  current_tick: number;
  created_at: string;
  updated_at: string;
  explored_count: number;
  faction_count: number;
}

export interface LocalExploredSystem {
  system_main_id: string;
  scan_level: number;
  explored_by: string | null;
  explored_at: string;
  notes: string | null;
}

export interface LocalExploreResult {
  system_main_id: string;
  scan_level: number;
  newly_explored: boolean;
}

export interface LocalFaction {
  id: string;
  campaign_id: string;
  name: string;
  color: string | null;
  home_system: string | null;
  state: Record<string, unknown>;
  created_at: string;
}

export interface LocalSimulationSnapshot {
  campaign_id: string;
  tick: number;
  state: Record<string, unknown>;
  updated_at: string;
}

export interface LocalCampaignState {
  /* Campaign list */
  campaigns: LocalCampaignSummary[];
  loadingCampaigns: boolean;

  /* Active campaign */
  activeCampaignId: string | null;
  activeCampaign: LocalCampaignSummary | null;

  /* Fog-of-war map */
  exploredSystems: Map<string, LocalExploredSystem>;
  loadingMap: boolean;

  /* Actions */
  refreshCampaigns: () => Promise<void>;
  createCampaign: (name: string, seed?: number, settings?: Record<string, unknown>) => Promise<string>;
  selectCampaign: (id: string | null) => void;
  deleteCampaign: (id: string) => Promise<void>;
  exploreSystem: (systemId: string, opts?: { explored_by?: string; scan_level?: number; notes?: string }) => Promise<LocalExploreResult>;
  refreshMap: () => Promise<void>;
  isExplored: (systemMainId: string) => boolean;

  /* Simulation */
  saveGameState: (tick: number, state: Record<string, unknown>) => Promise<void>;
  loadGameState: () => Promise<LocalSimulationSnapshot | null>;

  /* Factions */
  createFaction: (name: string, color?: string, homeSystem?: string) => Promise<string>;
  listFactions: () => Promise<LocalFaction[]>;
}

// ── Safe invoke ─────────────────────────────────────

async function ipc<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
    throw new Error(`Tauri IPC not available (command: ${cmd})`);
  }
  return invoke<T>(cmd, args);
}

// ── Hook ────────────────────────────────────────────

const STORAGE_KEY = 'exomaps_local_campaign';

export function useLocalCampaign(): LocalCampaignState {
  const [campaigns, setCampaigns] = useState<LocalCampaignSummary[]>([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(true);
  const [activeCampaignId, setActiveCampaignId] = useState<string | null>(() => {
    try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
  });
  const [exploredMap, setExploredMap] = useState<Map<string, LocalExploredSystem>>(new Map());
  const [loadingMap, setLoadingMap] = useState(false);

  // ── Campaign list ───────────────────────────────

  const refreshCampaigns = useCallback(async () => {
    setLoadingCampaigns(true);
    try {
      const data = await ipc<LocalCampaignSummary[]>('sg_list_campaigns', {
        status: 'active',
      });
      setCampaigns(data);
    } catch (err) {
      console.error('[LocalCampaign] Failed to list:', err);
    } finally {
      setLoadingCampaigns(false);
    }
  }, []);

  useEffect(() => { refreshCampaigns(); }, [refreshCampaigns]);

  // ── Active campaign ─────────────────────────────

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

  // ── Fog-of-war map ──────────────────────────────

  const refreshMap = useCallback(async () => {
    if (!activeCampaignId) {
      setExploredMap(new Map());
      return;
    }
    setLoadingMap(true);
    try {
      const systems = await ipc<LocalExploredSystem[]>('sg_get_explored_systems', {
        campaignId: activeCampaignId,
      });
      const map = new Map<string, LocalExploredSystem>();
      for (const sys of systems) {
        map.set(sys.system_main_id, sys);
      }
      setExploredMap(map);
    } catch (err) {
      console.error('[LocalCampaign] Failed to load map:', err);
    } finally {
      setLoadingMap(false);
    }
  }, [activeCampaignId]);

  useEffect(() => { refreshMap(); }, [refreshMap]);

  const isExplored = useCallback(
    (mainId: string) => exploredMap.has(mainId),
    [exploredMap],
  );

  // ── CRUD ────────────────────────────────────────

  const createCampaign = useCallback(async (
    name: string,
    seed?: number,
    settings?: Record<string, unknown>,
  ): Promise<string> => {
    const id = await ipc<string>('sg_create_campaign', {
      name,
      seed: seed ?? Math.floor(Math.random() * 2147483647),
      settings: settings ?? {},
    });
    await refreshCampaigns();
    selectCampaign(id);
    return id;
  }, [refreshCampaigns, selectCampaign]);

  const deleteCampaign = useCallback(async (id: string) => {
    await ipc('sg_delete_campaign', { campaignId: id });
    if (activeCampaignId === id) selectCampaign(null);
    await refreshCampaigns();
  }, [activeCampaignId, selectCampaign, refreshCampaigns]);

  const exploreSystem = useCallback(async (
    systemId: string,
    opts?: { explored_by?: string; scan_level?: number; notes?: string },
  ): Promise<LocalExploreResult> => {
    if (!activeCampaignId) throw new Error('No active campaign');
    const result = await ipc<LocalExploreResult>('sg_explore_system', {
      campaignId: activeCampaignId,
      systemMainId: systemId,
      scanLevel: opts?.scan_level ?? 1,
      exploredBy: opts?.explored_by ?? null,
      notes: opts?.notes ?? null,
    });
    await refreshMap();
    return result;
  }, [activeCampaignId, refreshMap]);

  // ── Simulation ──────────────────────────────────

  const saveGameState = useCallback(async (
    tick: number,
    state: Record<string, unknown>,
  ) => {
    if (!activeCampaignId) throw new Error('No active campaign');
    await ipc('sg_save_simulation', {
      campaignId: activeCampaignId,
      tick,
      state,
    });
    // Also update the campaign's own state + tick
    await ipc('sg_save_campaign_state', {
      campaignId: activeCampaignId,
      tick,
      state,
    });
  }, [activeCampaignId]);

  const loadGameState = useCallback(async (): Promise<LocalSimulationSnapshot | null> => {
    if (!activeCampaignId) return null;
    return ipc<LocalSimulationSnapshot | null>('sg_load_simulation', {
      campaignId: activeCampaignId,
    });
  }, [activeCampaignId]);

  // ── Factions ────────────────────────────────────

  const createFaction = useCallback(async (
    name: string,
    color?: string,
    homeSystem?: string,
  ): Promise<string> => {
    if (!activeCampaignId) throw new Error('No active campaign');
    return ipc<string>('sg_create_faction', {
      campaignId: activeCampaignId,
      name,
      color: color ?? null,
      homeSystem: homeSystem ?? null,
      initialState: {},
    });
  }, [activeCampaignId]);

  const listFactions = useCallback(async (): Promise<LocalFaction[]> => {
    if (!activeCampaignId) return [];
    return ipc<LocalFaction[]>('sg_list_factions', {
      campaignId: activeCampaignId,
    });
  }, [activeCampaignId]);

  // ── Return ──────────────────────────────────────

  return useMemo(() => ({
    campaigns,
    loadingCampaigns,
    activeCampaignId,
    activeCampaign,
    exploredSystems: exploredMap,
    loadingMap,
    refreshCampaigns,
    createCampaign,
    selectCampaign,
    deleteCampaign,
    exploreSystem,
    refreshMap,
    isExplored,
    saveGameState,
    loadGameState,
    createFaction,
    listFactions,
  }), [
    campaigns, loadingCampaigns, activeCampaignId, activeCampaign,
    exploredMap, loadingMap,
    refreshCampaigns, createCampaign, selectCampaign, deleteCampaign,
    exploreSystem, refreshMap, isExplored,
    saveGameState, loadGameState, createFaction, listFactions,
  ]);
}
