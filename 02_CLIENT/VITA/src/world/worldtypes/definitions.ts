/**
 * worldtypes/definitions.ts — Declarative world type configuration system.
 *
 * Each entry describes a world type's physical characteristics, which features
 * to enable, and default visual parameters. This drives:
 *   - Shader feature selection (what GLSL code to include)
 *   - Default uniform values in ProceduralWorld.tsx
 *   - Profile derivation hints in derive.ts
 *
 * Architecture philosophy:
 *   A world can be defined along three axes:
 *     1. Ocean fraction (0 = dry desert / airless, 1 = pure ocean world)
 *     2. Ice fraction  (0 = tropical, 1 = global ice sheet)
 *     3. Terrain age   (0 = freshly-formed volcanic, 1 = ancient eroded)
 *
 *   These three axes + the active feature set completely describe the visual
 *   appearance class of a planet, independently of its exact seed/genome.
 *
 * Usage in ProceduralWorld.tsx:
 *   const cfg = WORLD_TYPE_CONFIGS[planetType] ?? DEFAULT_WORLD_CONFIG;
 *   // cfg.features contains what shader feature modules are active
 *   // cfg.defaults drives fallback uniform values
 */

// ── Feature flags ────────────────────────────────────────────────────────────

export type WorldFeature =
  | 'ocean'         // Ocean rendering branch (depth, seabed, waves, currents)
  | 'deep-ocean'    // Abyssal zone, benthic nodules, canyon shadows
  | 'wave-swell'    // Sin-wave ocean swell + crest foam
  | 'algae'         // Algae bloom patches in warm shallow water
  | 'kelp'          // Kelp / seagrass shallow belt
  | 'sea-ice'       // Sea ice fringe at high latitudes
  | 'icebergs'      // Worley-cell procedural icebergs (requires sea-ice)
  | 'icecaps'       // POLAR_ICE zone-driven ice cap rendering
  | 'clouds'        // Two-altitude dedicated cloud layer
  | 'cloud-shadows' // Cloud shadow dappling on surface
  | 'storms'        // Active storm system + lightning
  | 'atmosphere-rim'// Rayleigh/Mie rim scattering on the lit limb
  | 'aurora'        // Polar aurora curtains
  | 'vegetation'    // Foliage color overlay
  | 'lava'          // Emissive lava / volcanic emission
  | 'craters'       // Crater topology + ejecta
  | 'tectonics'     // Tectonic plate height variation
  | 'dust-storm'    // Arid atmosphere dust suspension
  | 'salt-pans'     // Dry world salt flat crystalline zones
  | 'dune-seas'     // Wind-sculpted dune ripple patterns
  | 'city-lights'   // Night-side habitation glow
  | 'bioluminescence' // Ocean night-side bio-light
  | 'cryo-plumes'   // Cryovolcanic ice plumes
  | 'tidallock'     // Eyeball world: substellar/antistellar/terminator zones
  | 'rings'         // Ring plane shadow across equatorial face
  | 'mineral-map'   // Mineral abundance overlay
  | 'temp-map';     // Temperature distribution overlay

// ── World class categories ────────────────────────────────────────────────────

export type TerrainStyle =
  | 'rocky'         // Barren rock, craters, ancient highlands
  | 'volcanic'      // Fresh basalt, ash fields, lava flows
  | 'sedimentary'   // Layered rock, canyon networks, erosion
  | 'icy'           // Ice sheet, crevasses, sublimation pits
  | 'desert'        // Sand dunes, salt pans, yardangs
  | 'oceanic'       // Seabed ridges, abyssal plains, reefs
  | 'hydrocarbon';  // Tholin-rich, methane dunes, tar flats

// ── World type config ─────────────────────────────────────────────────────────

export interface WorldTypeConfig {
  /** Human-readable display name */
  label: string;

  /** Ocean fraction 0–1:
   *  0    = completely dry (no ocean rendering)
   *  0.30 = desert with some seas / crater lakes
   *  0.70 = earthlike (continents + ocean basins)
   *  0.95 = near-total ocean, few island arcs
   *  1.0  = pure ocean world (no exposed land) */
  oceanFraction: number;

  /** Ice fraction 0–1 at typical temperature:
   *  0 = no ice
   *  0.3 = moderate polar caps
   *  1.0 = global ice sheet */
  iceFraction: number;

  /** Terrain style driving zone texture palette selection */
  terrainStyle: TerrainStyle;

  /** Active shader features for this world type */
  features: WorldFeature[];

  /** Default uniform overrides (merged into ProfileVisuals defaults) */
  defaults: {
    noiseScale?: number;
    mountainHeight?: number;
    craterDensity?: number;
    cloudDensity?: number;
    atmThickness?: number;
    volcanism?: number;
    terrainAge?: number;
    tectonicsLevel?: number;
  };
}

// ── World type registry ───────────────────────────────────────────────────────

export const WORLD_TYPE_CONFIGS: Record<string, WorldTypeConfig> = {

  // ════ OCEAN / WATER WORLDS ═══════════════════════════════════════════════

  'ocean-world': {
    label: 'Ocean World',
    oceanFraction: 0.95,
    iceFraction: 0.15,
    terrainStyle: 'oceanic',
    features: ['ocean', 'deep-ocean', 'wave-swell', 'sea-ice', 'icebergs',
                'algae', 'kelp', 'clouds', 'cloud-shadows', 'atmosphere-rim',
                'aurora', 'bioluminescence', 'city-lights'],
    defaults: { cloudDensity: 0.55, atmThickness: 0.45, mountainHeight: 0.0 },
  },

  'water-world': {
    label: 'Water World',
    oceanFraction: 1.0,
    iceFraction: 0.10,
    terrainStyle: 'oceanic',
    features: ['ocean', 'deep-ocean', 'wave-swell', 'sea-ice', 'icebergs',
                'algae', 'clouds', 'cloud-shadows', 'atmosphere-rim',
                'bioluminescence'],
    defaults: { cloudDensity: 0.65, atmThickness: 0.50 },
  },

  'hycean': {
    label: 'Hycean World',
    oceanFraction: 1.0,
    iceFraction: 0.05,
    terrainStyle: 'oceanic',
    features: ['ocean', 'deep-ocean', 'wave-swell', 'algae', 'clouds',
                'atmosphere-rim', 'bioluminescence'],
    defaults: { cloudDensity: 0.80, atmThickness: 0.70 },
  },

  // ════ EARTHLIKE / TEMPERATE ═══════════════════════════════════════════════

  'earth-like': {
    label: 'Earth-like',
    oceanFraction: 0.70,
    iceFraction: 0.25,
    terrainStyle: 'sedimentary',
    features: ['ocean', 'deep-ocean', 'wave-swell', 'sea-ice', 'icebergs',
                'icecaps', 'algae', 'kelp', 'clouds', 'cloud-shadows',
                'storms', 'atmosphere-rim', 'aurora', 'vegetation',
                'tectonics', 'city-lights', 'bioluminescence', 'mineral-map'],
    defaults: { cloudDensity: 0.45, atmThickness: 0.35, terrainAge: 0.55 },
  },

  'temperate': {
    label: 'Temperate',
    oceanFraction: 0.55,
    iceFraction: 0.20,
    terrainStyle: 'sedimentary',
    features: ['ocean', 'wave-swell', 'sea-ice', 'icecaps', 'algae',
                'clouds', 'cloud-shadows', 'atmosphere-rim', 'vegetation',
                'tectonics', 'city-lights'],
    defaults: { cloudDensity: 0.40, atmThickness: 0.30, terrainAge: 0.50 },
  },

  'super-earth': {
    label: 'Super-Earth',
    oceanFraction: 0.50,
    iceFraction: 0.20,
    terrainStyle: 'rocky',
    features: ['ocean', 'wave-swell', 'icecaps', 'clouds', 'cloud-shadows',
                'atmosphere-rim', 'tectonics', 'vegetation'],
    defaults: { cloudDensity: 0.35, atmThickness: 0.40, tectonicsLevel: 0.55 },
  },

  // ════ DESERT / ARID WORLDS ════════════════════════════════════════════════

  'desert-world': {
    label: 'Desert World',
    oceanFraction: 0.0,
    iceFraction: 0.05,
    terrainStyle: 'desert',
    features: ['dust-storm', 'salt-pans', 'dune-seas', 'craters',
                'atmosphere-rim', 'mineral-map'],
    defaults: { cloudDensity: 0.05, atmThickness: 0.20, volcanism: 0.10 },
  },

  'desert': {
    label: 'Desert',
    oceanFraction: 0.05,
    iceFraction: 0.05,
    terrainStyle: 'desert',
    features: ['ocean', 'dust-storm', 'salt-pans', 'dune-seas', 'craters',
                'atmosphere-rim'],
    defaults: { cloudDensity: 0.08, atmThickness: 0.18 },
  },

  // ════ ROCKY / AIRLESS WORLDS ═════════════════════════════════════════════

  'rocky': {
    label: 'Rocky',
    oceanFraction: 0.0,
    iceFraction: 0.0,
    terrainStyle: 'rocky',
    features: ['craters', 'mineral-map'],
    defaults: { cloudDensity: 0.0, atmThickness: 0.0, craterDensity: 0.45 },
  },

  'sub-earth': {
    label: 'Sub-Earth',
    oceanFraction: 0.0,
    iceFraction: 0.0,
    terrainStyle: 'rocky',
    features: ['craters', 'mineral-map'],
    defaults: { cloudDensity: 0.0, atmThickness: 0.02, craterDensity: 0.55 },
  },

  'iron-planet': {
    label: 'Iron Planet',
    oceanFraction: 0.0,
    iceFraction: 0.0,
    terrainStyle: 'rocky',
    features: ['craters', 'mineral-map'],
    defaults: { cloudDensity: 0.0, atmThickness: 0.0 },
  },

  'carbon-planet': {
    label: 'Carbon Planet',
    oceanFraction: 0.0,
    iceFraction: 0.0,
    terrainStyle: 'hydrocarbon',
    features: ['craters', 'mineral-map', 'dust-storm'],
    defaults: { cloudDensity: 0.10, atmThickness: 0.12 },
  },

  'chthonian': {
    label: 'Chthonian',
    oceanFraction: 0.0,
    iceFraction: 0.0,
    terrainStyle: 'rocky',
    features: ['craters', 'mineral-map', 'lava'],
    defaults: { cloudDensity: 0.0, atmThickness: 0.0, volcanism: 0.15 },
  },

  // ════ VOLCANIC WORLDS ════════════════════════════════════════════════════

  'lava-world': {
    label: 'Lava World',
    oceanFraction: 0.0,
    iceFraction: 0.0,
    terrainStyle: 'volcanic',
    features: ['lava', 'tectonics', 'cryo-plumes'],
    defaults: { cloudDensity: 0.0, atmThickness: 0.08, volcanism: 0.85 },
  },

  'lava-ocean': {
    label: 'Lava Ocean',
    oceanFraction: 0.50,
    iceFraction: 0.0,
    terrainStyle: 'volcanic',
    features: ['ocean', 'lava', 'tectonics'],
    defaults: { cloudDensity: 0.15, atmThickness: 0.15, volcanism: 0.65 },
  },

  'volcanic': {
    label: 'Volcanic',
    oceanFraction: 0.15,
    iceFraction: 0.0,
    terrainStyle: 'volcanic',
    features: ['ocean', 'lava', 'tectonics', 'dust-storm', 'craters'],
    defaults: { cloudDensity: 0.20, atmThickness: 0.25, volcanism: 0.55 },
  },

  // ════ ICE WORLDS ═════════════════════════════════════════════════════════

  'ice-dwarf': {
    label: 'Ice Dwarf',
    oceanFraction: 0.30,
    iceFraction: 0.90,
    terrainStyle: 'icy',
    features: ['ocean', 'sea-ice', 'icebergs', 'icecaps', 'cryo-plumes',
                'mineral-map'],
    defaults: { cloudDensity: 0.05, atmThickness: 0.05, volcanism: 0.05 },
  },

  // ════ EYEBALL / TIDAL LOCK ════════════════════════════════════════════════

  'eyeball-world': {
    label: 'Eyeball World',
    oceanFraction: 0.40,
    iceFraction: 0.35,
    terrainStyle: 'rocky',
    features: ['ocean', 'sea-ice', 'icebergs', 'icecaps', 'clouds',
                'atmosphere-rim', 'tidallock'],
    defaults: { cloudDensity: 0.30, atmThickness: 0.28 },
  },

  // ════ MOON TYPES ══════════════════════════════════════════════════════════

  'moon-ice-shell': {
    // Europa/Enceladus-like: ice crust over subsurface ocean, cryovolcanic geysers
    label: 'Ice Shell Moon',
    oceanFraction: 0.0,
    iceFraction: 0.95,
    terrainStyle: 'icy',
    features: ['icecaps', 'icebergs', 'sea-ice', 'craters', 'cryo-plumes', 'aurora', 'mineral-map'],
    defaults: { cloudDensity: 0.0, atmThickness: 0.02, craterDensity: 0.40, volcanism: 0.08, terrainAge: 0.30 },
  },

  'moon-ocean': {
    // Ganymede/Callisto subsurface ocean: ancient cratered ice surface over deep saline ocean
    label: 'Ocean Moon',
    oceanFraction: 0.0,
    iceFraction: 0.80,
    terrainStyle: 'icy',
    features: ['icecaps', 'sea-ice', 'icebergs', 'craters', 'aurora', 'mineral-map'],
    defaults: { cloudDensity: 0.0, atmThickness: 0.03, craterDensity: 0.55, terrainAge: 0.70 },
  },

  'moon-nitrogen-ice': {
    // Triton/Pluto-like: nitrogen ice plains, sparse craters, seasonal frost migration
    label: 'Nitrogen Ice Moon',
    oceanFraction: 0.0,
    iceFraction: 0.90,
    terrainStyle: 'icy',
    features: ['icecaps', 'craters', 'cryo-plumes', 'atmosphere-rim', 'mineral-map'],
    defaults: { cloudDensity: 0.05, atmThickness: 0.06, craterDensity: 0.20, terrainAge: 0.25 },
  },

  'moon-co2-frost': {
    // Rhea/Dione-like: CO₂ frost & water ice surface, heavily cratered ancient terrain
    label: 'CO₂ Frost Moon',
    oceanFraction: 0.0,
    iceFraction: 0.70,
    terrainStyle: 'icy',
    features: ['icecaps', 'craters', 'dust-storm', 'mineral-map'],
    defaults: { cloudDensity: 0.0, atmThickness: 0.0, craterDensity: 0.65, terrainAge: 0.80 },
  },

  'moon-ammonia-slush': {
    // Titan/cryogenic-ammonia-ocean: hydrocarbon haze, methane lakes, tholin dunes
    label: 'Ammonia Slush Moon',
    oceanFraction: 0.30,
    iceFraction: 0.40,
    terrainStyle: 'hydrocarbon',
    features: ['ocean', 'atmosphere-rim', 'clouds', 'dust-storm', 'dune-seas', 'mineral-map'],
    defaults: { cloudDensity: 0.55, atmThickness: 0.60, terrainAge: 0.45 },
  },

  'moon-silicate-frost': {
    // Generic rocky moon with surface frost patches, moderate craters
    label: 'Silicate-Frost Moon',
    oceanFraction: 0.0,
    iceFraction: 0.20,
    terrainStyle: 'rocky',
    features: ['icecaps', 'craters', 'mineral-map'],
    defaults: { cloudDensity: 0.0, atmThickness: 0.0, craterDensity: 0.50, terrainAge: 0.65 },
  },

  // ── Airless rocky moons ───────────────────────────────────────────────────

  'moon-cratered': {
    label: 'Cratered Moon',
    oceanFraction: 0.0, iceFraction: 0.0, terrainStyle: 'rocky',
    features: ['craters', 'mineral-map'],
    defaults: { cloudDensity: 0.0, atmThickness: 0.0, craterDensity: 0.70, terrainAge: 0.80 },
  },
  'moon-basalt': {
    label: 'Basaltic Moon',
    oceanFraction: 0.0, iceFraction: 0.0, terrainStyle: 'rocky',
    features: ['craters', 'mineral-map'],
    defaults: { cloudDensity: 0.0, atmThickness: 0.0, craterDensity: 0.50, terrainAge: 0.60 },
  },
  'moon-iron-rich': {
    label: 'Iron-Rich Moon',
    oceanFraction: 0.0, iceFraction: 0.0, terrainStyle: 'rocky',
    features: ['craters', 'mineral-map'],
    defaults: { cloudDensity: 0.0, atmThickness: 0.0, craterDensity: 0.55, terrainAge: 0.70 },
  },
  'moon-olivine': {
    label: 'Olivine Moon',
    oceanFraction: 0.0, iceFraction: 0.0, terrainStyle: 'rocky',
    features: ['craters', 'mineral-map'],
    defaults: { cloudDensity: 0.0, atmThickness: 0.0, craterDensity: 0.50, terrainAge: 0.65 },
  },
  'moon-regolith': {
    label: 'Regolith Moon',
    oceanFraction: 0.0, iceFraction: 0.0, terrainStyle: 'rocky',
    features: ['craters', 'mineral-map'],
    defaults: { cloudDensity: 0.0, atmThickness: 0.0, craterDensity: 0.80, terrainAge: 0.90 },
  },
  'moon-sulfate': {
    label: 'Sulfate Moon',
    oceanFraction: 0.0, iceFraction: 0.0, terrainStyle: 'rocky',
    features: ['craters', 'mineral-map', 'dust-storm'],
    defaults: { cloudDensity: 0.0, atmThickness: 0.0, craterDensity: 0.45, terrainAge: 0.55 },
  },
  'moon-tholin': {
    // Phoebe/KBO-like: dark reddish organic tholins, ancient terrain
    label: 'Tholin Moon',
    oceanFraction: 0.0, iceFraction: 0.10, terrainStyle: 'hydrocarbon',
    features: ['craters', 'mineral-map', 'dune-seas'],
    defaults: { cloudDensity: 0.0, atmThickness: 0.0, craterDensity: 0.60, terrainAge: 0.85 },
  },
  'moon-carbon-soot': {
    // Iapetus dark-side / very low albedo carbon-rich surface
    label: 'Carbon-Soot Moon',
    oceanFraction: 0.0, iceFraction: 0.0, terrainStyle: 'rocky',
    features: ['craters', 'mineral-map'],
    defaults: { cloudDensity: 0.0, atmThickness: 0.0, craterDensity: 0.55, terrainAge: 0.75 },
  },
  'moon-captured': {
    // Captured asteroid: irregular shape, dark surface, ancient
    label: 'Captured Moon',
    oceanFraction: 0.0, iceFraction: 0.0, terrainStyle: 'rocky',
    features: ['craters', 'mineral-map'],
    defaults: { cloudDensity: 0.0, atmThickness: 0.0, craterDensity: 0.65, terrainAge: 0.85 },
  },
  'moon-shepherd': {
    // Tiny shepherd moon in ring system
    label: 'Shepherd Moon',
    oceanFraction: 0.0, iceFraction: 0.05, terrainStyle: 'icy',
    features: ['craters'],
    defaults: { cloudDensity: 0.0, atmThickness: 0.0, craterDensity: 0.40, terrainAge: 0.70 },
  },
  'moon-binary': {
    // Double moon pair
    label: 'Binary Moon',
    oceanFraction: 0.0, iceFraction: 0.10, terrainStyle: 'rocky',
    features: ['craters', 'mineral-map'],
    defaults: { cloudDensity: 0.0, atmThickness: 0.0, craterDensity: 0.60, terrainAge: 0.75 },
  },

  // ── Active / thin-atm moons ───────────────────────────────────────────────

  'moon-thin-atm': {
    // Trace atmosphere retained by mass or magnetic field (Callisto, Io-like)
    label: 'Thin-Atm Moon',
    oceanFraction: 0.0, iceFraction: 0.10, terrainStyle: 'rocky',
    features: ['craters', 'mineral-map', 'atmosphere-rim'],
    defaults: { cloudDensity: 0.0, atmThickness: 0.07, craterDensity: 0.50, terrainAge: 0.60 },
  },
  'moon-volcanic': {
    // Io-like: active sulfur volcanism, lava flows, SO₂ plumes
    label: 'Volcanic Moon',
    oceanFraction: 0.0, iceFraction: 0.0, terrainStyle: 'volcanic',
    features: ['lava', 'craters', 'cryo-plumes', 'dust-storm'],
    defaults: { cloudDensity: 0.0, atmThickness: 0.04, volcanism: 0.80, craterDensity: 0.10, terrainAge: 0.05 },
  },
  'moon-magma-ocean': {
    // Extreme tidal heating → surface magma ocean, no solid crust
    label: 'Magma Ocean Moon',
    oceanFraction: 0.0, iceFraction: 0.0, terrainStyle: 'volcanic',
    features: ['lava', 'mineral-map'],
    defaults: { cloudDensity: 0.0, atmThickness: 0.06, volcanism: 0.98, terrainAge: 0.0 },
  },
  'moon-atmosphere': {
    // Titan-like: thick N₂/CH₄ haze, hydrocarbon lakes, tholin dunes
    label: 'Atmosphere Moon',
    oceanFraction: 0.20, iceFraction: 0.10, terrainStyle: 'hydrocarbon',
    features: ['clouds', 'atmosphere-rim', 'dune-seas', 'mineral-map'],
    defaults: { cloudDensity: 0.70, atmThickness: 0.65, terrainAge: 0.35 },
  },
};

/** Fallback config for unknown world types.
 *  Conservative — no atmosphere-rim, no ocean, no clouds.
 *  atmosphere-rim must be declared explicitly in each type's features array.
 */
export const DEFAULT_WORLD_CONFIG: WorldTypeConfig = {
  label: 'Unknown World',
  oceanFraction: 0.0,
  iceFraction: 0.0,
  terrainStyle: 'rocky',
  features: ['craters', 'mineral-map'],
  defaults: { cloudDensity: 0.0, atmThickness: 0.0 },
};

/** Get world config for a planet type */
export function getWorldConfig(planetType: string): WorldTypeConfig {
  return WORLD_TYPE_CONFIGS[planetType] ?? DEFAULT_WORLD_CONFIG;
}

/** Check if a world type has a specific feature active */
export function hasFeature(planetType: string, feature: WorldFeature): boolean {
  return getWorldConfig(planetType).features.includes(feature);
}
