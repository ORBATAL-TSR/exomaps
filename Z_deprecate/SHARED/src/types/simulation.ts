/* ── Simulation types ───────────────────────────────── */
/* Types for the game / simulation engine layer         */

export interface SimulationSnapshot {
  tick: number;
  population: number;
  colonies: number;
  events: SimulationEvent[];
}

export interface SimulationEvent {
  tick: number;
  type: string;
  detail: string;
}

/** A civilization / faction in the game layer */
export interface Faction {
  id: string;
  name: string;
  color: string;               // hex for map overlay
  home_system: string;         // main_id of origin star
  controlled_systems: string[];
  tech_level: number;          // 1-10 scale
  expansion_rate: number;      // systems per century
  vision_radius_ly: number;    // fog-of-war radius
}

/** Vision model for faction fog-of-war */
export type VisionLevel = 'full' | 'partial' | 'none';

export interface FactionVision {
  faction_id: string;
  system_id: string;
  vision: VisionLevel;
}

/** Territory claim on a star system */
export interface TerritoryClaim {
  system_id: string;
  faction_id: string;
  claimed_at_tick: number;
  contested: boolean;
}

/** Fleet / expedition between systems */
export interface FleetTransit {
  fleet_id: string;
  faction_id: string;
  origin_system: string;
  destination_system: string;
  departure_tick: number;
  arrival_tick: number;
  fleet_size: number;
}
