/* ── Persona / user types ──────────────────────────── */

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

/* ── Service health types ──────────────────────────── */

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

/* ── Pipeline / ingest types ──────────────────────── */

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
