/**
 * useScience — IPC bridge for v2 scientific simulation commands.
 *
 * Wraps Tauri invoke() calls for the advanced Rust simulation modules:
 *   - Interior structure (4-layer shooting method)
 *   - Climate equilibrium (ice-albedo, HZ boundaries)
 *   - Atmosphere v2 (radiative-convective equilibrium)
 *   - Detailed composition (Birch-Murnaghan EOS)
 *   - Model manifest (registry of all scientific models)
 */

import { useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';

/** Safe invoke — throws descriptive error if Tauri IPC isn't available */
async function safeInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
    throw new Error(`Tauri IPC not available (command: ${cmd})`);
  }
  return invoke<T>(cmd, args);
}

/* ── Types matching Rust structs ────────────────────── */

export interface InteriorProfile {
  n_shells: number;
  radius_km: number[];
  pressure_gpa: number[];
  density_kg_m3: number[];
  gravity_m_s2: number[];
  temperature_k: number[];
  layer_names: string[];
  layer_boundary_km: number[];
  core_radius_fraction: number;
  surface_gravity_m_s2: number;
  central_pressure_gpa: number;
  central_temperature_k: number;
  convergence_info: { converged: boolean; iterations: number; radius_error_pct: number };
}

export interface ClimateState {
  regime: string;
  surface_temp_mean_k: number;
  surface_temp_day_k: number;
  surface_temp_night_k: number;
  polar_temp_k: number;
  equator_temp_k: number;
  ice_fraction: number;
  habitable_fraction: number;
  bond_albedo_effective: number;
  greenhouse_warming_k: number;
  tidal_heating_w_m2: number;
  hz_inner_au: number;
  hz_outer_au: number;
  in_habitable_zone: boolean;
  kopparapu_zone: string;
}

export interface AtmosphericProfile {
  n_layers: number;
  pressure_bar: number[];
  temperature_k: number[];
  altitude_km: number[];
  mixing_ratios: { species: string; fractions: number[] }[];
  total_ir_optical_depth: number;
  rayleigh_optical_depth_550: number;
  summary: {
    surface_pressure_bar: number;
    surface_temp_k: number;
    equilibrium_temp_k: number;
    greenhouse_delta_k: number;
    tropopause_temp_k: number;
    tropopause_altitude_km: number;
    scale_height_km: number;
    mean_molecular_weight: number;
    bond_albedo: number;
    dominant_gas: string;
    olr_w_m2: number;
    asr_w_m2: number;
    rayleigh_color: [number, number, number];
    species: { name: string; surface_fraction: number; column_abundance_kg_m2: number }[];
  };
  convergence: { converged: boolean; iterations: number; final_imbalance_w_m2: number; method: string };
}

export interface DetailedComposition {
  bulk: {
    iron_fraction: number;
    silicate_fraction: number;
    volatile_fraction: number;
    h_he_fraction: number;
  };
  core_mass_fraction: number;
  mantle_mass_fraction: number;
  water_mass_fraction: number;
  envelope_mass_fraction: number;
  core_radius_fraction: number;
  cmb_pressure_gpa: number;
  central_pressure_gpa: number;
  model_used: string;
  confidence: number;
}

export interface ModelDescriptor {
  id: string;
  name: string;
  version: string;
  category: string;
  description: string;
  citations: { authors: string; title: string; journal: string; year: number; doi: string }[];
  parameters: { name: string; unit: string; min_value: number | null; max_value: number | null }[];
}

export interface ScienceHook {
  loading: boolean;
  error: string | null;
  interior: InteriorProfile | null;
  climate: ClimateState | null;
  atmosphereV2: AtmosphericProfile | null;
  detailedComp: DetailedComposition | null;
  modelManifest: ModelDescriptor[] | null;
  computeInterior: (params: InteriorParams) => Promise<InteriorProfile>;
  computeClimate: (params: ClimateParams) => Promise<ClimateState>;
  computeAtmosphereV2: (params: AtmosphereV2Params) => Promise<AtmosphericProfile>;
  computeDetailedComposition: (params: CompositionParams) => Promise<DetailedComposition>;
  fetchModelManifest: () => Promise<ModelDescriptor[]>;
  computeAll: (params: FullPlanetParams) => Promise<void>;
}

export interface InteriorParams {
  mass_earth: number;
  radius_earth: number;
  planet_type: string;
}

export interface ClimateParams {
  mass_earth: number;
  radius_earth: number;
  sma_au: number;
  eccentricity: number;
  star_luminosity: number;
  star_teff: number;
  planet_type: string;
}

export interface AtmosphereV2Params {
  mass_earth: number;
  radius_earth: number;
  sma_au: number;
  star_luminosity: number;
  star_teff: number;
  planet_type: string;
}

export interface CompositionParams {
  mass_earth: number;
  radius_earth: number;
  semi_major_axis_au: number;
  planet_type: string;
}

export interface FullPlanetParams {
  mass_earth: number;
  radius_earth: number;
  sma_au: number;
  eccentricity: number;
  star_luminosity: number;
  star_teff: number;
  planet_type: string;
}

/* ── Hook ───────────────────────────────────────────── */

export function useScience(): ScienceHook {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [interior, setInterior] = useState<InteriorProfile | null>(null);
  const [climate, setClimate] = useState<ClimateState | null>(null);
  const [atmosphereV2, setAtmosphereV2] = useState<AtmosphericProfile | null>(null);
  const [detailedComp, setDetailedComp] = useState<DetailedComposition | null>(null);
  const [modelManifest, setModelManifest] = useState<ModelDescriptor[] | null>(null);

  const computeInterior = useCallback(async (params: InteriorParams) => {
    const result = await safeInvoke<InteriorProfile>('compute_interior', {
      massEarth: params.mass_earth,
      radiusEarth: params.radius_earth,
      planetType: params.planet_type,
    });
    setInterior(result);
    return result;
  }, []);

  const computeClimate = useCallback(async (params: ClimateParams) => {
    const result = await safeInvoke<ClimateState>('compute_climate', {
      massEarth: params.mass_earth,
      radiusEarth: params.radius_earth,
      smaAu: params.sma_au,
      eccentricity: params.eccentricity,
      starLuminosity: params.star_luminosity,
      starTeff: params.star_teff,
      planetType: params.planet_type,
    });
    setClimate(result);
    return result;
  }, []);

  const computeAtmosphereV2 = useCallback(async (params: AtmosphereV2Params) => {
    const result = await safeInvoke<AtmosphericProfile>('compute_atmosphere_v2', {
      massEarth: params.mass_earth,
      radiusEarth: params.radius_earth,
      smaAu: params.sma_au,
      starLuminosity: params.star_luminosity,
      starTeff: params.star_teff,
      planetType: params.planet_type,
    });
    setAtmosphereV2(result);
    return result;
  }, []);

  const computeDetailedComposition = useCallback(async (params: CompositionParams) => {
    const result = await safeInvoke<DetailedComposition>('compute_detailed_composition', {
      massEarth: params.mass_earth,
      radiusEarth: params.radius_earth,
      semiMajorAxisAu: params.semi_major_axis_au,
      planetType: params.planet_type,
    });
    setDetailedComp(result);
    return result;
  }, []);

  const fetchModelManifest = useCallback(async () => {
    const result = await safeInvoke<ModelDescriptor[]>('get_model_manifest');
    setModelManifest(result);
    return result;
  }, []);

  const computeAll = useCallback(async (params: FullPlanetParams) => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([
        computeDetailedComposition({
          mass_earth: params.mass_earth,
          radius_earth: params.radius_earth,
          semi_major_axis_au: params.sma_au,
          planet_type: params.planet_type,
        }),
        computeAtmosphereV2({
          mass_earth: params.mass_earth,
          radius_earth: params.radius_earth,
          sma_au: params.sma_au,
          star_luminosity: params.star_luminosity,
          star_teff: params.star_teff,
          planet_type: params.planet_type,
        }),
        computeInterior({
          mass_earth: params.mass_earth,
          radius_earth: params.radius_earth,
          planet_type: params.planet_type,
        }),
        computeClimate(params),
      ]);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setLoading(false);
    }
  }, [computeDetailedComposition, computeAtmosphereV2, computeInterior, computeClimate]);

  return {
    loading,
    error,
    interior,
    climate,
    atmosphereV2,
    detailedComp,
    modelManifest,
    computeInterior,
    computeClimate,
    computeAtmosphereV2,
    computeDetailedComposition,
    fetchModelManifest,
    computeAll,
  };
}
