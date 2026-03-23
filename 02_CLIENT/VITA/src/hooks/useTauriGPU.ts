/**
 * useTauriGPU — IPC bridge hook for native GPU planet generation.
 *
 * Wraps all Tauri `invoke()` calls to the Rust backend, exposing
 * GPU info, planet texture generation, composition/atmosphere
 * inference, and generation status tracking.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';

/** Safe invoke — returns null if Tauri IPC isn't available */
async function safeInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
    throw new Error(`Tauri IPC not available (command: ${cmd})`);
  }
  return invoke<T>(cmd, args);
}

/* ── Types ──────────────────────────────────────────── */

export interface GpuInfo {
  name: string;
  backend: string;
  device_type: string;
  driver: string;
  features: string[];
  max_texture_size: number;
  max_compute_workgroup_size: number[];
}

export interface BulkComposition {
  iron_fraction: number;
  silicate_fraction: number;
  volatile_fraction: number;
  h_he_fraction: number;
  dominant_component: string;
  confidence: number;
}

export interface AtmosphereParams {
  surface_pressure_bar: number;
  scale_height_km: number;
  mean_molecular_weight: number;
  greenhouse_delta_k: number;
  surface_temp_k: number;
  equilibrium_temp_k: number;
  dominant_gas: string;
  species: AtmosphericSpecies[];
  rayleigh_color: [number, number, number];
}

export interface AtmosphericSpecies {
  name: string;
  fraction: number;
}

export interface PlanetTextures {
  heightmap_base64: string;
  albedo_base64: string;
  normal_base64: string;
  atmosphere_lut_base64: string | null;
  resolution: number;
  planet_type: string;
  composition: BulkComposition;
  atmosphere: AtmosphereParams;
}

/** V2 terrain pipeline result — matches Rust PlanetGenResultV2 */
export interface PlanetTexturesV2 {
  albedo_texture_b64: string;
  heightmap_texture_b64: string;
  normal_texture_b64: string;
  pbr_texture_b64: string;
  atmosphere_lut_b64: string;
  ocean_level: number;
  composition: BulkComposition;
  atmosphere: AtmosphereParams;
  render_time_ms: number;
}

export interface GenerationStatus {
  planetId: string;
  state: 'idle' | 'generating' | 'complete' | 'error';
  progress: number; // 0-1
  textures: PlanetTextures | null;
  error: string | null;
}

export interface TauriGPUHook {
  gpuInfo: GpuInfo | null;
  gpuAvailable: boolean;
  loading: boolean;
  generations: Map<string, GenerationStatus>;
  generatePlanet: (params: GeneratePlanetParams) => Promise<PlanetTextures>;
  generatePlanetV2: (params: GeneratePlanetV2Params) => Promise<PlanetTexturesV2>;
  computeComposition: (params: CompositionParams) => Promise<BulkComposition>;
  computeAtmosphere: (params: AtmosphereInputParams) => Promise<AtmosphereParams>;
  cancelGeneration: (planetId: string) => void;
}

export interface GeneratePlanetParams {
  planet_name: string;
  planet_type: string;
  mass_earth: number | null;
  radius_earth: number | null;
  semi_major_axis_au: number | null;
  star_teff: number | null;
  star_luminosity: number | null;
  resolution?: number;
}

/** V2 generation params — matches Rust PlanetGenRequest */
export interface GeneratePlanetV2Params {
  system_id: string;
  planet_index: number;
  mass_earth: number;
  radius_earth: number;
  semi_major_axis_au: number;
  eccentricity: number;
  star_teff: number;
  star_luminosity: number;
  planet_type: string;
  temperature_k: number;
  in_habitable_zone: boolean;
  texture_resolution: number;
}

export interface CompositionParams {
  mass_earth: number;
  radius_earth: number;
  planet_type: string;
  semi_major_axis_au: number | null;
}

export interface AtmosphereInputParams {
  mass_earth: number;
  radius_earth: number;
  planet_type: string;
  semi_major_axis_au: number | null;
  star_teff: number | null;
  star_luminosity: number | null;
}

/* ── Hook ───────────────────────────────────────────── */

export function useTauriGPU(): TauriGPUHook {
  const [gpuInfo, setGpuInfo] = useState<GpuInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [generations, setGenerations] = useState<Map<string, GenerationStatus>>(
    new Map()
  );
  const abortControllers = useRef<Map<string, AbortController>>(new Map());

  // Probe GPU on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const info = await safeInvoke<GpuInfo>('get_gpu_info');
        if (!cancelled) setGpuInfo(info);
      } catch (err) {
        if (!(err instanceof Error && err.message.includes('Tauri IPC not available')))
          console.warn('[GPU] Failed to probe GPU:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const updateGeneration = useCallback(
    (planetId: string, patch: Partial<GenerationStatus>) => {
      setGenerations(prev => {
        const next = new Map(prev);
        const current = next.get(planetId) ?? {
          planetId,
          state: 'idle' as const,
          progress: 0,
          textures: null,
          error: null,
        };
        next.set(planetId, { ...current, ...patch });
        return next;
      });
    },
    []
  );

  const generatePlanet = useCallback(
    async (params: GeneratePlanetParams): Promise<PlanetTextures> => {
      const id = params.planet_name;
      const controller = new AbortController();
      abortControllers.current.set(id, controller);

      updateGeneration(id, { state: 'generating', progress: 0.1, error: null });

      try {
        // Composition pass
        updateGeneration(id, { progress: 0.2 });

        // Full pipeline: composition → atmosphere → GPU textures
        const result = await safeInvoke<PlanetTextures>('generate_planet', {
          request: {
            system_id: params.planet_name,
            planet_index: 0,
            mass_earth: params.mass_earth ?? 1.0,
            radius_earth: params.radius_earth ?? 1.0,
            semi_major_axis_au: params.semi_major_axis_au ?? 1.0,
            eccentricity: 0.0,
            star_teff: params.star_teff ?? 5778.0,
            star_luminosity: params.star_luminosity ?? 1.0,
            planet_type: params.planet_type,
            temperature_k: 288.0,
            in_habitable_zone: true,
            texture_resolution: params.resolution ?? 512,
          },
        });

        if (controller.signal.aborted) {
          throw new Error('Generation cancelled');
        }

        updateGeneration(id, {
          state: 'complete',
          progress: 1,
          textures: result,
        });

        return result;
      } catch (err: any) {
        const errMsg = err?.message ?? String(err);
        updateGeneration(id, {
          state: 'error',
          progress: 0,
          error: errMsg,
        });
        throw err;
      } finally {
        abortControllers.current.delete(id);
      }
    },
    [updateGeneration]
  );

  const computeComposition = useCallback(
    async (params: CompositionParams): Promise<BulkComposition> => {
      return safeInvoke<BulkComposition>('compute_composition', {
        massEarth: params.mass_earth,
        radiusEarth: params.radius_earth,
        planetType: params.planet_type,
        semiMajorAxisAu: params.semi_major_axis_au,
      });
    },
    []
  );

  const computeAtmosphere = useCallback(
    async (params: AtmosphereInputParams): Promise<AtmosphereParams> => {
      return safeInvoke<AtmosphereParams>('compute_atmosphere', {
        massEarth: params.mass_earth,
        radiusEarth: params.radius_earth,
        planetType: params.planet_type,
        semiMajorAxisAu: params.semi_major_axis_au,
        starTeff: params.star_teff,
        starLuminosity: params.star_luminosity,
      });
    },
    []
  );

  const generatePlanetV2 = useCallback(
    async (params: GeneratePlanetV2Params): Promise<PlanetTexturesV2> => {
      const id = `${params.system_id}_${params.planet_index}`;
      updateGeneration(id, { state: 'generating', progress: 0.1, error: null });

      try {
        updateGeneration(id, { progress: 0.3 });
        const result = await safeInvoke<PlanetTexturesV2>('generate_planet_v2', {
          request: params,
        });

        updateGeneration(id, { state: 'complete', progress: 1, textures: null });
        return result;
      } catch (err: any) {
        const msg = err?.message ?? String(err);
        updateGeneration(id, { state: 'error', progress: 0, error: msg });
        throw err;
      }
    },
    [updateGeneration],
  );

  const cancelGeneration = useCallback((planetId: string) => {
    const controller = abortControllers.current.get(planetId);
    if (controller) {
      controller.abort();
      abortControllers.current.delete(planetId);
    }
  }, []);

  return {
    gpuInfo,
    gpuAvailable: gpuInfo !== null,
    loading,
    generations,
    generatePlanet,
    generatePlanetV2,
    computeComposition,
    computeAtmosphere,
    cancelGeneration,
  };
}
