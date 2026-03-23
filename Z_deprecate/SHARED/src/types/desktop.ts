/* ── Desktop-specific types ─────────────────────────── */
/* Types used by the Tauri desktop client for native    */
/* GPU rendering and procedural planet generation.      */

/** Parameters sent to the native GPU renderer via Tauri IPC */
export interface GPURenderRequest {
  system_id: string;
  planet_index: number;
  /** Bulk composition fractions (sum to 1.0) */
  composition: BulkComposition;
  /** Atmospheric parameters for scattering shader */
  atmosphere: AtmosphereParams;
  /** Surface generation parameters */
  surface: SurfaceParams;
  /** Output texture resolution (e.g. 2048, 4096) */
  texture_resolution: number;
}

/** GPU render result returned from native sidecar */
export interface GPURenderResult {
  /** Base64-encoded albedo texture (PNG) */
  albedo_texture: string;
  /** Base64-encoded heightmap (16-bit PNG) */
  heightmap_texture: string;
  /** Base64-encoded normal map (PNG) */
  normal_texture: string;
  /** Atmosphere LUT for scattering (Base64 PNG) */
  atmosphere_lut: string;
  /** Generation time in ms */
  render_time_ms: number;
}

/** Bulk composition fractions for a planet */
export interface BulkComposition {
  iron_fraction: number;       // 0-1, inner core + metallic
  silicate_fraction: number;   // 0-1, mantle rock
  volatile_fraction: number;   // 0-1, water/ice/gas envelope
  h_he_fraction: number;       // 0-1, hydrogen/helium (gas giants)
}

/** Atmospheric parameters derived from stellar + orbital context */
export interface AtmosphereParams {
  surface_pressure_bar: number;
  scale_height_km: number;
  mean_molecular_weight: number;
  bond_albedo: number;
  greenhouse_factor: number;
  /** Dominant atmospheric species for Rayleigh color */
  composition: AtmosphericSpecies[];
  equilibrium_temp_k: number;
  surface_temp_k: number;
}

/** A single atmospheric gas species */
export interface AtmosphericSpecies {
  molecule: string;            // 'N2', 'O2', 'CO2', 'H2O', 'CH4', 'H2', 'He'
  fraction: number;            // volume mixing ratio, 0-1
}

/** Surface generation parameters */
export interface SurfaceParams {
  tectonic_regime: 'stagnant_lid' | 'mobile_lid' | 'episodic' | 'none';
  age_gyr: number;
  ocean_fraction: number;      // 0-1
  ice_fraction: number;        // 0-1 (polar + permanent)
  volcanism_level: number;     // 0-1
  crater_density: number;      // 0-1 (inversely correlated with atm + age)
}

/** TRAPPIST-1 validation expected outputs */
export interface ValidationTarget {
  planet_name: string;
  expected_surface: string;
  mass_earth: number;
  radius_earth: number;
  flux_earth: number;
}

/** Cached world state entry (for offline SQLite) */
export interface CachedSystemState {
  main_id: string;
  fetched_at: string;          // ISO 8601
  data_json: string;           // Serialized PlanetarySystemResponse
  textures_cached: boolean;
}
