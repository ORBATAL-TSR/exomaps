/**
 * useGameMode — Game mode context for single-player / multiplayer switching.
 *
 * In SINGLE-PLAYER mode:
 *   - All campaign data is stored locally in encrypted SQLite via Tauri IPC
 *   - No server connection required
 *   - Simulation runs client-side (Rust engine)
 *
 * In MULTIPLAYER mode:
 *   - Campaign data flows through the Flask gateway API
 *   - Requires server connection
 *   - Simulation runs on the World Engine service
 *
 * Wrap <App /> in <GameModeProvider> above <CampaignProvider>.
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
import { invoke } from '@tauri-apps/api/core';

// ── Types ───────────────────────────────────────────

export type GameMode = 'singleplayer' | 'multiplayer';

export interface GameModeCapabilities {
  singleplayer_available: boolean;
  multiplayer_available: boolean;
  savegame_encryption: string;
  version: string;
}

export interface GameModeState {
  mode: GameMode;
  capabilities: GameModeCapabilities | null;
  serverReachable: boolean;
  loading: boolean;
  setMode: (mode: GameMode) => void;
  isSinglePlayer: boolean;
  isMultiplayer: boolean;
}

const STORAGE_KEY = 'exomaps_game_mode';

const GameModeContext = createContext<GameModeState | null>(null);

// ── Helpers ─────────────────────────────────────────

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function checkServerReachable(): Promise<boolean> {
  try {
    const resp = await fetch('/api/health', { signal: AbortSignal.timeout(3000) });
    return resp.ok;
  } catch {
    return false;
  }
}

// ── Provider ────────────────────────────────────────

export function GameModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeRaw] = useState<GameMode>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'singleplayer' || stored === 'multiplayer') return stored;
    } catch { /* noop */ }
    return 'singleplayer'; // Default to single-player for desktop
  });

  const [capabilities, setCapabilities] = useState<GameModeCapabilities | null>(null);
  const [serverReachable, setServerReachable] = useState(false);
  const [loading, setLoading] = useState(true);

  // Probe capabilities on mount
  useEffect(() => {
    let cancelled = false;

    async function init() {
      // Check Tauri IPC capabilities
      if (isTauri()) {
        try {
          const caps = await invoke<GameModeCapabilities>('sg_get_game_mode');
          if (!cancelled) setCapabilities(caps);
        } catch (err) {
          console.warn('[GameMode] Failed to query capabilities:', err);
        }
      }

      // Check server reachability
      const reachable = await checkServerReachable();
      if (!cancelled) {
        setServerReachable(reachable);
        setLoading(false);
      }
    }

    init();
    return () => { cancelled = true; };
  }, []);

  // Periodically check server connectivity (every 30s)
  useEffect(() => {
    const interval = setInterval(async () => {
      const reachable = await checkServerReachable();
      setServerReachable(reachable);
    }, 30_000);
    return () => clearInterval(interval);
  }, []);

  const setMode = useCallback((newMode: GameMode) => {
    setModeRaw(newMode);
    try {
      localStorage.setItem(STORAGE_KEY, newMode);
    } catch { /* noop */ }
  }, []);

  const value = useMemo<GameModeState>(() => ({
    mode,
    capabilities,
    serverReachable,
    loading,
    setMode,
    isSinglePlayer: mode === 'singleplayer',
    isMultiplayer: mode === 'multiplayer',
  }), [mode, capabilities, serverReachable, loading, setMode]);

  return (
    <GameModeContext.Provider value={value}>
      {children}
    </GameModeContext.Provider>
  );
}

// ── Hook ────────────────────────────────────────────

export function useGameMode(): GameModeState {
  const ctx = useContext(GameModeContext);
  if (!ctx) throw new Error('useGameMode must be used inside <GameModeProvider>');
  return ctx;
}
