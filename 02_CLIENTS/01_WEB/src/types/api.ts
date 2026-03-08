/* ── Backend API types ──────────────────────────────── */

/** Star system from /api/world/systems/full */
export interface StarSystemFull {
  main_id: string;
  x: number;                    // parsecs, ICRS
  y: number;
  z: number;
  distance_ly: number;
  spectral_class: string;       // O B A F G K M L T
  teff: number;                 // effective temperature (K)
  luminosity: number;           // solar luminosities
  multiplicity: number;         // 1 = single, 2 = binary, 3+ = multiple
  planet_count: number;
  confidence: 'observed' | 'inferred';
  /** Companion linkage from curated catalog */
  companions: CompanionBond[];
  /** System group name (e.g. "Alpha Centauri") */
  system_group: string | null;
  /** Hierarchy string (e.g. "(A,B) + C") */
  group_hierarchy: string | null;
}

/** A bond to a companion star in the same system group */
export interface CompanionBond {
  name: string;
  separation_au: number;
  bond_type: 'close_binary' | 'wide_companion';
}

export interface FullSystemsResponse {
  systems: StarSystemFull[];
  total_count: number;
  persona: string;
  source: 'database' | 'csv_fallback';
}

/** Legacy system shape */
export interface StarSystem {
  main_id: string;
  distance_ly: number;
  source: 'observed' | 'inferred';
  confidence_bound?: number;
  x_pc?: number;
  y_pc?: number;
  z_pc?: number;
}

export interface Persona {
  key: string;
  label: string;
  description: string;
  menus: string[];
}

export interface PersonaResponse {
  current_persona_key: string;
  current_persona: Persona;
  available_personas: { key: string; label: string }[];
}

export interface SystemsResponse {
  systems: StarSystem[];
  total_count: number;
  persona: string;
}

export interface ConfidenceRecord {
  main_id: string;
  distance_ly: number;
  uncertainty_pc: number;
  sanity_pass: boolean;
  parallax_mas: number;
}

export interface ConfidenceResponse {
  confidence_data: ConfidenceRecord[];
  total_count: number;
  high_uncertainty_threshold_pc: number;
}

export interface IngestRun {
  run_id: string;
  run_name: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  notes: string | null;
}

export interface RunsManifestResponse {
  runs: IngestRun[];
  total_returned: number;
  limit: number;
}

export interface ValidationRecord {
  source_name: string;
  total_rows: number;
  accepted_rows: number;
  quarantined_rows: number;
  gate_status: string;
  created_at: string;
}

export interface ValidationResponse {
  run_id: string;
  validation_summary: ValidationRecord[];
  total_sources: number;
}

export interface SimulationSnapshot {
  tick: number;
  population: number;
  colonies: number;
  events: unknown[];
}

export interface SimulationEvent {
  tick: number;
  type: string;
  detail: string;
}

export interface DBStatus {
  configured: boolean;
  connected: boolean;
  message: string;
}

export interface HealthResponse {
  db_status: DBStatus;
  persona: string;
  routes_count: number;
}

/* ── Planetary system detail types ─────────────────── */

/** A moon orbiting a planet */
export interface Moon {
  moon_name: string;
  orbital_radius_au: number;
  mass_earth: number;
  radius_earth: number;
  moon_type: 'rocky' | 'icy';
  confidence: 'observed' | 'inferred';
}

/** An individual planet (observed or inferred) */
export interface Planet {
  planet_name: string;
  planet_status: string;            // 'Confirmed', 'Inferred', 'Candidate', etc.
  mass_earth: number | null;
  mass_source: 'true_mass' | 'mass_sini' | 'inferred' | null;
  radius_earth: number | null;
  semi_major_axis_au: number | null;
  orbital_period_days: number | null;
  eccentricity: number | null;
  inclination_deg: number | null;
  temp_calculated_k: number | null;
  temp_measured_k: number | null;
  geometric_albedo: number | null;
  detection_type: string | null;
  molecules: string | null;
  discovered: string | null;
  planet_type: 'sub-earth' | 'rocky' | 'super-earth' | 'neptune-like' | 'gas-giant' | 'super-jupiter' | 'unknown';
  confidence: 'observed' | 'inferred';
  moons: Moon[];
}

/** A major asteroid body within a belt */
export interface Asteroid {
  name: string;
  semi_major_axis_au: number;
  diameter_km: number;
  spectral_class: string;           // 'C', 'S', 'M'
  confidence: 'observed' | 'inferred';
}

/** An asteroid or debris belt */
export interface Belt {
  belt_id: string;
  belt_type: 'rocky-asteroid' | 'icy-kuiper';
  inner_radius_au: number;
  outer_radius_au: number;
  estimated_bodies: number;
  confidence: 'observed' | 'inferred';
  major_asteroids: Asteroid[];
}

/** Habitable zone bounds for a star */
export interface HabitableZone {
  inner_au: number;
  outer_au: number;
}

/** Protoplanetary / debris disc around a star */
export interface ProtoplanetaryDisc {
  disc_type: 'protoplanetary' | 'transitional' | 'debris';
  inner_radius_au: number;
  outer_radius_au: number;
  density: number;        // 0-1 relative density
  opacity: number;        // 0-1 visual opacity hint
  color_hint: 'warm' | 'cool';
  confidence: 'observed' | 'inferred';
}

/** Full planetary system response from /api/system/<main_id> */
export interface PlanetarySystemResponse {
  star: StarSystemFull;
  planets: Planet[];
  belts: Belt[];
  habitable_zone: HabitableZone;
  protoplanetary_disc: ProtoplanetaryDisc | null;
  summary: {
    observed_planets: number;
    inferred_planets: number;
    total_planets: number;
    total_moons: number;
    total_belts: number;
  };
}

/** Per-star data within a multi-star group response */
export interface StarSystemData {
  star: StarSystemFull;
  planets: Planet[];
  belts: Belt[];
  habitable_zone: HabitableZone;
  protoplanetary_disc: ProtoplanetaryDisc | null;
  summary: {
    observed_planets: number;
    inferred_planets: number;
    total_planets: number;
    total_moons: number;
    total_belts: number;
  };
}

/** Multi-star system group response from /api/system-group/<group> */
export interface SystemGroupResponse {
  group_name: string;
  hierarchy: string | null;
  star_count: number;
  stars: StarSystemData[];
  group_summary: {
    total_stars: number;
    total_planets: number;
    total_moons: number;
    total_belts: number;
  };
}

/** Planet summary per star from /api/systems/planets/summary */
export interface PlanetSummary {
  main_id: string;
  observed_count: number;
  inferred_count: number;
  total: number;
}

export interface PlanetSummaryResponse {
  systems: PlanetSummary[];
  total_systems: number;
}
