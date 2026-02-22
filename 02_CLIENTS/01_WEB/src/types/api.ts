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
