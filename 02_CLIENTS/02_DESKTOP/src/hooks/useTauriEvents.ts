/**
 * useTauriEvents — React hook for the Tauri event bus.
 *
 * Listens for push events emitted by the Rust backend:
 *   - generation:started  — planet generation began
 *   - generation:complete — planet generation finished (or served from cache)
 *   - generation:error    — planet generation failed
 *   - viewport:ready      — native viewport has textures loaded
 *
 * Unlike useTauriGPU (pull-based invoke), this hook receives
 * unsolicited push notifications from the Rust side.
 */

import { useEffect, useState, useRef } from 'react';

// Tauri event listener — lazy import to avoid SSR/web crashes
let listenFn: typeof import('@tauri-apps/api/event')['listen'] | null = null;

async function getListenFn() {
  if (listenFn) return listenFn;
  try {
    const mod = await import('@tauri-apps/api/event');
    listenFn = mod.listen;
    return listenFn;
  } catch {
    return null;
  }
}

/* ── Event payload types ───────────────────────────── */

export interface GenerationStartedPayload {
  system_id: string;
  planet_index: number;
  resolution: number;
}

export interface GenerationCompletePayload {
  system_id: string;
  planet_index: number;
  render_time_ms: number;
  from_cache: boolean;
}

export interface GenerationErrorPayload {
  system_id: string;
  planet_index: number;
  error: string;
}

export interface ViewportReadyPayload {
  planet_key: string;
  resolution: number;
}

/* ── Hook state ────────────────────────────────────── */

export interface TauriEventState {
  /** Last generation event received */
  lastGeneration: GenerationCompletePayload | null;
  /** Whether a generation is currently in progress */
  generating: boolean;
  /** Current generating planet info */
  generatingPlanet: { system_id: string; planet_index: number } | null;
  /** Last error */
  lastError: GenerationErrorPayload | null;
  /** Whether the native viewport has textures loaded */
  viewportReady: boolean;
  /** Last viewport planet key */
  viewportPlanetKey: string | null;
}

/* ── Hook ──────────────────────────────────────────── */

export function useTauriEvents() {
  const [state, setState] = useState<TauriEventState>({
    lastGeneration: null,
    generating: false,
    generatingPlanet: null,
    lastError: null,
    viewportReady: false,
    viewportPlanetKey: null,
  });

  const unlisteners = useRef<Array<() => void>>([]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const listen = await getListenFn();
      if (!listen || cancelled) return;

      // generation:started
      const u1 = await listen<GenerationStartedPayload>('generation:started', (event) => {
        if (cancelled) return;
        setState(prev => ({
          ...prev,
          generating: true,
          generatingPlanet: {
            system_id: event.payload.system_id,
            planet_index: event.payload.planet_index,
          },
          lastError: null,
          viewportReady: false,
        }));
      });

      // generation:complete
      const u2 = await listen<GenerationCompletePayload>('generation:complete', (event) => {
        if (cancelled) return;
        setState(prev => ({
          ...prev,
          generating: false,
          generatingPlanet: null,
          lastGeneration: event.payload,
        }));
      });

      // generation:error
      const u3 = await listen<GenerationErrorPayload>('generation:error', (event) => {
        if (cancelled) return;
        setState(prev => ({
          ...prev,
          generating: false,
          generatingPlanet: null,
          lastError: event.payload,
        }));
      });

      // viewport:ready
      const u4 = await listen<ViewportReadyPayload>('viewport:ready', (event) => {
        if (cancelled) return;
        setState(prev => ({
          ...prev,
          viewportReady: true,
          viewportPlanetKey: event.payload.planet_key,
        }));
      });

      if (!cancelled) {
        unlisteners.current = [u1, u2, u3, u4];
      } else {
        u1(); u2(); u3(); u4();
      }
    })();

    return () => {
      cancelled = true;
      unlisteners.current.forEach(fn => fn());
      unlisteners.current = [];
    };
  }, []);

  return state;
}
