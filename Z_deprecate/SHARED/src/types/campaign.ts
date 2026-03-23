/**
 * Campaign & Exploration types — Fog-of-War system.
 *
 * A star system doesn't exist for a campaign until explored.
 * Desktop generates content on exploration, server stores it,
 * web clients view explored territory.
 */

/* ── Campaign ──────────────────────────────────────── */

export type CampaignStatus = 'active' | 'paused' | 'archived';

export interface Campaign {
  id: string;
  name: string;
  owner_id?: string;
  created_at: string;
  updated_at: string;
  seed: number;
  settings: CampaignSettings;
  status: CampaignStatus;
}

export interface CampaignSettings {
  /** Difficulty modifier (0.5 = easy, 1.0 = normal, 2.0 = hard) */
  difficulty?: number;
  /** Whether fog-of-war is enabled (default: true) */
  fog_of_war?: boolean;
  /** Starting system main_id */
  starting_system?: string;
  /** Custom rules / mod config */
  [key: string]: unknown;
}

export interface CampaignSummary {
  id: string;
  name: string;
  status: CampaignStatus;
  created_at: string;
  systems_explored: number;
  planets_surveyed: number;
  factions: number;
}

export interface CampaignListResponse {
  campaigns: CampaignSummary[];
  total: number;
  filter_status: CampaignStatus;
}

/* ── Exploration ───────────────────────────────────── */

/** How deeply a system has been scanned */
export type ScanLevel = 1 | 2 | 3;

export interface Exploration {
  id: string;
  campaign_id: string;
  system_main_id: string;
  explored_at: string;
  explored_by?: string;
  scan_level: ScanLevel;
  notes?: string;
}

export interface ExploreSystemRequest {
  explored_by?: string;
  scan_level?: ScanLevel;
  notes?: string;
}

export interface ExploreSystemResponse {
  campaign_id: string;
  system_main_id: string;
  explored_by?: string;
  scan_level: ScanLevel;
  is_new: boolean;
}

/* ── Explored Planet (Baked Assets) ────────────────── */

export interface ExploredPlanet {
  id: string;
  exploration_id: string;
  planet_index: number;
  planet_key: string;
  generation_seed?: number;
  scan_level: ScanLevel;
  albedo_url?: string;
  heightmap_url?: string;
  normal_url?: string;
  pbr_url?: string;
  thumbnail_url?: string;
  summary?: PlanetSummarySnapshot;
  created_at: string;
}

export interface PlanetSummarySnapshot {
  composition?: {
    iron_fraction: number;
    silicate_fraction: number;
    volatile_fraction: number;
    h_he_fraction: number;
  };
  atmosphere?: {
    surface_pressure_bar: number;
    dominant_gas: string;
    surface_temp_k: number;
  };
  geology?: {
    tectonic_activity: string;
    volcanic_activity: string;
  };
}

export interface BakePlanetRequest {
  generation_seed?: number;
  summary_json?: PlanetSummarySnapshot;
  albedo_b64?: string;
  heightmap_b64?: string;
  normal_b64?: string;
  pbr_b64?: string;
  thumbnail_b64?: string;
}

export interface PlanetTexturesResponse {
  planet_key: string;
  albedo_url?: string;
  heightmap_url?: string;
  normal_url?: string;
  pbr_url?: string;
  thumbnail_url?: string;
  summary?: PlanetSummarySnapshot;
}

/* ── Campaign Map (Fog-of-War View) ────────────────── */

export interface CampaignMapSystem {
  system_main_id: string;
  explored_at: string;
  explored_by?: string;
  scan_level: ScanLevel;
  x: number;
  y: number;
  z: number;
  distance_ly: number;
  spectral_class: string;
  teff: number;
  luminosity: number;
  planet_count: number;
  confidence: 'observed' | 'inferred';
}

export interface CampaignMapResponse {
  campaign_id: string;
  systems: CampaignMapSystem[];
  total_explored: number;
  min_scan_level: ScanLevel;
}

/* ── Faction (stub) ────────────────────────────────── */

export interface Faction {
  id: string;
  campaign_id: string;
  name: string;
  color: string;
  home_system_id?: string;
  created_at: string;
}

export interface FactionListResponse {
  campaign_id: string;
  factions: Faction[];
}
