/**
 * EWoCS Texture Manifest v3 — Perlin-noise base + stamp/decal system.
 *
 * Architecture:
 *   1. BASE texture  – a 2:1 equirectangular texture that covers the whole sphere
 *      providing the foundational color/material for the world type.
 *   2. STAMP textures – square 1:1 regional patches applied as decals at
 *      seed-determined positions. Stamps blend via Perlin noise + heightmap
 *      awareness with dithered/feathered edges.
 *   3. CLOUD/LIQUID layers – optional overlay textures for atmosphere and oceans.
 *
 * For each texture ID the runtime loads:
 *   /textures/planets/{id}.png            – diffuse (albedo)
 *   /textures/planets/{id}_height.png     – greyscale heightmap
 *   /textures/planets/{id}_normal.png     – tangent-space normal map
 */

/* ── Types ──────────────────────────────────────────────── */

export type StampBand = 'equator' | 'mid' | 'polar' | 'any';

/** A stamp (decal) texture to scatter across the surface */
export interface StampTexture {
  /** Texture file ID (without extension) */
  id: string;
  /** Weight for random selection (higher = more likely chosen) */
  weight: number;
  /** Preferred latitude band */
  band: StampBand;
  /** Hue shift in degrees (-180..180) applied in-shader to match base */
  hueShift?: number;
  /** Saturation multiplier (0..2, default 1) */
  satMul?: number;
  /** Brightness multiplier (0..2, default 1) */
  brightMul?: number;
  /** Angular radius of each stamp in radians on the sphere (default ~0.25) */
  stampRadius?: number;
}

export interface WorldPalette {
  /** Base (equirectangular) texture ID — provides foundational colour */
  baseTexture: string;
  /** Stamp textures to scatter as decals */
  stamps: StampTexture[];
  /** How many stamp instances to place (default 8) */
  stampCount?: number;
  /** Atmosphere color [R,G,B] 0-1 */
  atmColor: [number, number, number];
  /** Atmosphere thickness 0-1 (drives Rayleigh intensity) */
  atmThickness: number;
  /** Emissive glow 0-1 (lava, hot surfaces) */
  emissive: number;
  /** Cloud texture ID (optional) */
  cloud?: string;
  /** Cloud density 0-1 */
  cloudDensity: number;
  /** Liquid texture ID (optional — ocean surface) */
  liquid?: string;
  /** Liquid level 0-1 (fraction of heightmap below which liquid shows) */
  liquidLevel?: number;
  /** Liquid color tint */
  liquidColor?: [number, number, number];
  /** Heightmap displacement strength */
  displacementScale: number;
  /** Normal map strength */
  normalStrength: number;
  /** Base color tint [H-shift, S-mul, B-mul] for procedural Perlin layer */
  baseTint?: [number, number, number];
}

/* ── Palette Definitions ─────────────────────────────── */

const PALETTES: Record<string, WorldPalette> = {

  // ═══ Rocky / Airless ══════════════════════════════════
  'rocky': {
    baseTexture: 'base_rocky_barren',
    stamps: [
      { id: 'basaltic_cratered_moon', weight: 0.4, band: 'any' },
      { id: 'ancient_lunar_highlands', weight: 0.3, band: 'mid' },
      { id: 'mercury_hollow_terrain', weight: 0.2, band: 'equator' },
      { id: 'crater_ejecta_blanket', weight: 0.1, band: 'any', stampRadius: 0.15 },
    ],
    stampCount: 10,
    atmColor: [0.3, 0.3, 0.3], atmThickness: 0.05, emissive: 0,
    cloudDensity: 0, displacementScale: 0.025, normalStrength: 1.5,
  },
  'sub-earth': {
    baseTexture: 'base_rocky_ancient',
    stamps: [
      { id: 'ancient_lunar_highlands', weight: 0.35, band: 'any' },
      { id: 'fresh_impact_crater_field', weight: 0.3, band: 'equator', stampRadius: 0.18 },
      { id: 'crater_ejecta_blanket', weight: 0.2, band: 'polar' },
      { id: 'shock_fractured_rock', weight: 0.15, band: 'mid' },
    ],
    stampCount: 12,
    atmColor: [0.3, 0.3, 0.3], atmThickness: 0.03, emissive: 0,
    cloudDensity: 0, displacementScale: 0.020, normalStrength: 1.5,
  },
  'iron-planet': {
    baseTexture: 'base_rocky_iron',
    stamps: [
      { id: 'mercury_hollow_terrain', weight: 0.35, band: 'any', satMul: 0.7 },
      { id: 'impact_melt_plains', weight: 0.25, band: 'equator', hueShift: -15 },
      { id: 'glassified_impact_terrain', weight: 0.25, band: 'mid' },
      { id: 'shock_fractured_rock', weight: 0.15, band: 'polar' },
    ],
    stampCount: 9,
    atmColor: [0.4, 0.35, 0.3], atmThickness: 0.02, emissive: 0,
    cloudDensity: 0, displacementScale: 0.015, normalStrength: 1.8,
  },
  'carbon-planet': {
    baseTexture: 'base_rocky_barren',
    stamps: [
      { id: 'tar_sand_plains', weight: 0.3, band: 'equator', satMul: 0.5 },
      { id: 'shock_fractured_rock', weight: 0.3, band: 'mid', hueShift: -30 },
      { id: 'granite_plateau_surface', weight: 0.2, band: 'polar', satMul: 0.3, brightMul: 0.6 },
      { id: 'volcanic_ash_basin', weight: 0.2, band: 'any', satMul: 0.3 },
    ],
    stampCount: 10,
    baseTint: [-20, 0.4, 0.6],
    atmColor: [0.2, 0.15, 0.1], atmThickness: 0.10, emissive: 0,
    cloudDensity: 0, displacementScale: 0.020, normalStrength: 1.5,
  },

  // ═══ Earth-like / Habitable ═══════════════════════════
  'earth-like': {
    baseTexture: 'base_ocean_shallow',
    stamps: [
      { id: 'continental_craton_terrain', weight: 0.25, band: 'mid', stampRadius: 0.35 },
      { id: 'eroded_highlands', weight: 0.2, band: 'mid', stampRadius: 0.3 },
      { id: 'coral_reef_shelf', weight: 0.15, band: 'equator', stampRadius: 0.2 },
      { id: 'glacial_ice_sheet', weight: 0.2, band: 'polar', stampRadius: 0.35 },
      { id: 'folded_mountain_belt', weight: 0.1, band: 'mid', stampRadius: 0.15 },
      { id: 'desert_dune_planet', weight: 0.1, band: 'equator', stampRadius: 0.2 },
    ],
    stampCount: 14,
    liquid: 'base_ocean_deep',
    liquidLevel: 0.35,
    liquidColor: [0.05, 0.15, 0.35],
    atmColor: [0.35, 0.55, 0.90], atmThickness: 0.45, emissive: 0,
    cloudDensity: 0.5, displacementScale: 0.030, normalStrength: 1.2,
  },
  'super-earth': {
    baseTexture: 'base_ocean_shallow',
    stamps: [
      { id: 'folded_mountain_belt', weight: 0.25, band: 'mid', stampRadius: 0.3 },
      { id: 'volcanic_shield_plains', weight: 0.2, band: 'equator', stampRadius: 0.25 },
      { id: 'continental_craton_terrain', weight: 0.2, band: 'mid', stampRadius: 0.35 },
      { id: 'polar_ice_cap_terrain', weight: 0.2, band: 'polar', stampRadius: 0.3 },
      { id: 'plateau_canyon_terrain', weight: 0.15, band: 'mid', stampRadius: 0.2 },
    ],
    stampCount: 12,
    liquid: 'base_ocean_deep',
    liquidLevel: 0.30,
    liquidColor: [0.04, 0.12, 0.30],
    atmColor: [0.30, 0.50, 0.85], atmThickness: 0.55, emissive: 0,
    cloudDensity: 0.55, displacementScale: 0.035, normalStrength: 1.3,
  },
  'hycean': {
    baseTexture: 'base_ocean_deep',
    stamps: [
      { id: 'ocean_world_shallow_shelf', weight: 0.3, band: 'equator', stampRadius: 0.25 },
      { id: 'coral_reef_shelf', weight: 0.2, band: 'equator', stampRadius: 0.18 },
      { id: 'fractured_ice_shelf', weight: 0.25, band: 'polar', stampRadius: 0.35 },
      { id: 'deep_ocean_abyssal_plain', weight: 0.25, band: 'mid' },
    ],
    stampCount: 10,
    liquid: 'base_ocean_deep',
    liquidLevel: 0.6,
    liquidColor: [0.03, 0.10, 0.30],
    atmColor: [0.25, 0.50, 0.85], atmThickness: 0.50, emissive: 0,
    cloudDensity: 0.55, displacementScale: 0.008, normalStrength: 0.8,
  },

  // ═══ Desert / Arid ════════════════════════════════════
  'desert-world': {
    baseTexture: 'base_desert_sand',
    stamps: [
      { id: 'desert_dune_planet', weight: 0.2, band: 'equator', stampRadius: 0.3 },
      { id: 'rocky_desert_plateau', weight: 0.2, band: 'mid', stampRadius: 0.25 },
      { id: 'wind_carved_yardangs', weight: 0.15, band: 'mid', stampRadius: 0.2 },
      { id: 'megadune_desert', weight: 0.15, band: 'equator', stampRadius: 0.3 },
      { id: 'salt_flat_planet', weight: 0.1, band: 'polar', stampRadius: 0.2 },
      { id: 'dust_storm_desert_surface', weight: 0.1, band: 'any', stampRadius: 0.35 },
      { id: 'evaporite_basin', weight: 0.1, band: 'polar', stampRadius: 0.2 },
    ],
    stampCount: 14,
    atmColor: [0.70, 0.55, 0.35], atmThickness: 0.25, emissive: 0,
    cloudDensity: 0.05, displacementScale: 0.030, normalStrength: 1.4,
  },

  // ═══ Ocean ════════════════════════════════════════════
  'ocean-world': {
    baseTexture: 'base_ocean_deep',
    stamps: [
      { id: 'coral_reef_shelf', weight: 0.2, band: 'equator', hueShift: -10, stampRadius: 0.2 },
      { id: 'basalt_seafloor_ridge', weight: 0.2, band: 'mid', stampRadius: 0.15 },
      { id: 'ocean_world_shallow_shelf', weight: 0.25, band: 'equator', stampRadius: 0.25 },
      { id: 'glacial_ice_sheet', weight: 0.2, band: 'polar', hueShift: 15, stampRadius: 0.3 },
      { id: 'deep_ocean_abyssal_plain', weight: 0.15, band: 'mid' },
    ],
    stampCount: 10,
    liquid: 'base_ocean_deep',
    liquidLevel: 0.55,
    liquidColor: [0.02, 0.08, 0.25],
    atmColor: [0.25, 0.50, 0.85], atmThickness: 0.45, emissive: 0,
    cloudDensity: 0.6, displacementScale: 0.005, normalStrength: 0.6,
  },

  // ═══ Volcanic / Lava ═════════════════════════════════
  'lava-world': {
    baseTexture: 'base_lava_crust',
    stamps: [
      { id: 'lava_world_magma_crust', weight: 0.25, band: 'equator', stampRadius: 0.3 },
      { id: 'cooling_lava_crust', weight: 0.2, band: 'mid', stampRadius: 0.25 },
      { id: 'basalt_lava_plains', weight: 0.2, band: 'polar', stampRadius: 0.3 },
      { id: 'ropy_pahoehoe_lava', weight: 0.15, band: 'any', stampRadius: 0.2 },
      { id: 'volcanic_shield_plains', weight: 0.1, band: 'mid', stampRadius: 0.2 },
      { id: 'ash_covered_lava_plateau', weight: 0.1, band: 'polar', stampRadius: 0.25 },
    ],
    stampCount: 12,
    atmColor: [0.80, 0.30, 0.10], atmThickness: 0.20, emissive: 0.65,
    cloudDensity: 0, displacementScale: 0.020, normalStrength: 1.8,
  },
  'chthonian': {
    baseTexture: 'base_lava_cooled',
    stamps: [
      { id: 'impact_melt_plains', weight: 0.3, band: 'equator', hueShift: 10, satMul: 0.8 },
      { id: 'glassified_impact_terrain', weight: 0.3, band: 'mid' },
      { id: 'cooling_lava_crust', weight: 0.25, band: 'polar', satMul: 0.7 },
      { id: 'shock_fractured_rock', weight: 0.15, band: 'any' },
    ],
    stampCount: 10,
    atmColor: [0.6, 0.3, 0.15], atmThickness: 0.08, emissive: 0.30,
    cloudDensity: 0, displacementScale: 0.025, normalStrength: 1.6,
  },
  'venus': {
    baseTexture: 'base_rocky_volcanic',
    stamps: [
      { id: 'volcanic_shield_plains', weight: 0.25, band: 'equator' },
      { id: 'tectonic_rift_zone', weight: 0.2, band: 'mid', stampRadius: 0.2 },
      { id: 'subduction_arc_volcano_terrain', weight: 0.2, band: 'mid' },
      { id: 'ash_covered_lava_plateau', weight: 0.15, band: 'polar' },
      { id: 'folded_mountain_belt', weight: 0.1, band: 'mid', stampRadius: 0.2 },
      { id: 'lava_world_magma_crust', weight: 0.1, band: 'equator', stampRadius: 0.15 },
    ],
    stampCount: 12,
    atmColor: [0.85, 0.75, 0.45], atmThickness: 0.90, emissive: 0.05,
    cloudDensity: 0.85, displacementScale: 0.020, normalStrength: 1.2,
  },

  // ═══ Ice / Cryo ══════════════════════════════════════
  'ice-dwarf': {
    baseTexture: 'base_ice_nitrogen',
    stamps: [
      { id: 'nitrogen_ice_glacier', weight: 0.25, band: 'equator', stampRadius: 0.3 },
      { id: 'methane_ice_plains', weight: 0.2, band: 'mid' },
      { id: 'ammonia_ice_plains', weight: 0.2, band: 'polar' },
      { id: 'crevasse_ice_field', weight: 0.15, band: 'any', stampRadius: 0.18 },
      { id: 'cryovolcanic_ice_moon', weight: 0.1, band: 'mid', stampRadius: 0.15 },
      { id: 'enceladus_tiger_stripes', weight: 0.1, band: 'mid', stampRadius: 0.12 },
    ],
    stampCount: 12,
    atmColor: [0.6, 0.7, 0.9], atmThickness: 0.08, emissive: 0,
    cloudDensity: 0, displacementScale: 0.015, normalStrength: 1.0,
  },
  'eyeball-world': {
    baseTexture: 'base_ice_sheet',
    stamps: [
      { id: 'ocean_world_shallow_shelf', weight: 0.25, band: 'equator', hueShift: 5, stampRadius: 0.35 },
      { id: 'fractured_ice_shelf', weight: 0.2, band: 'mid', stampRadius: 0.25 },
      { id: 'glacial_ice_sheet', weight: 0.2, band: 'polar', stampRadius: 0.3 },
      { id: 'blue_ice_plains', weight: 0.15, band: 'polar' },
      { id: 'europa_chaos_terrain', weight: 0.1, band: 'mid', stampRadius: 0.15 },
      { id: 'crevasse_ice_field', weight: 0.1, band: 'mid', stampRadius: 0.12 },
    ],
    stampCount: 12,
    liquid: 'base_ocean_shallow',
    liquidLevel: 0.25,
    liquidColor: [0.05, 0.15, 0.30],
    atmColor: [0.40, 0.55, 0.85], atmThickness: 0.30, emissive: 0,
    cloudDensity: 0.3, displacementScale: 0.015, normalStrength: 1.0,
  },

  // ═══ Moons ═══════════════════════════════════════════
  'moon-rocky': {
    baseTexture: 'base_rocky_barren',
    stamps: [
      { id: 'basaltic_cratered_moon', weight: 0.35, band: 'any' },
      { id: 'ancient_lunar_highlands', weight: 0.3, band: 'mid' },
      { id: 'crater_ejecta_blanket', weight: 0.2, band: 'equator', stampRadius: 0.15 },
      { id: 'fresh_impact_crater_field', weight: 0.15, band: 'any', stampRadius: 0.12 },
    ],
    stampCount: 14,
    atmColor: [0.3, 0.3, 0.3], atmThickness: 0.0, emissive: 0,
    cloudDensity: 0, displacementScale: 0.025, normalStrength: 1.8,
  },
  'moon-icy': {
    baseTexture: 'base_ice_sheet',
    stamps: [
      { id: 'europa_chaos_terrain', weight: 0.3, band: 'equator' },
      { id: 'crevasse_ice_field', weight: 0.25, band: 'mid' },
      { id: 'blue_ice_plains', weight: 0.25, band: 'polar' },
      { id: 'enceladus_tiger_stripes', weight: 0.1, band: 'mid', stampRadius: 0.12 },
      { id: 'cryovolcanic_ice_moon', weight: 0.1, band: 'any', stampRadius: 0.15 },
    ],
    stampCount: 12,
    atmColor: [0.5, 0.6, 0.8], atmThickness: 0.0, emissive: 0,
    cloudDensity: 0, displacementScale: 0.015, normalStrength: 1.2,
  },
  'moon-volcanic': {
    baseTexture: 'base_lava_cooled',
    stamps: [
      { id: 'io_sulfur_volcanic_plains', weight: 0.3, band: 'equator' },
      { id: 'sulfur_vent_fields', weight: 0.25, band: 'mid' },
      { id: 'cooling_lava_crust', weight: 0.2, band: 'any' },
      { id: 'ash_covered_lava_plateau', weight: 0.15, band: 'polar' },
      { id: 'ropy_pahoehoe_lava', weight: 0.1, band: 'equator', stampRadius: 0.15 },
    ],
    stampCount: 12,
    atmColor: [0.7, 0.5, 0.2], atmThickness: 0.05, emissive: 0.3,
    cloudDensity: 0, displacementScale: 0.020, normalStrength: 1.5,
  },
  'moon-ocean': {
    baseTexture: 'base_ocean_deep',
    stamps: [
      { id: 'deep_ocean_abyssal_plain', weight: 0.3, band: 'equator' },
      { id: 'basalt_seafloor_ridge', weight: 0.25, band: 'mid' },
      { id: 'fractured_ice_shelf', weight: 0.25, band: 'polar', stampRadius: 0.3 },
      { id: 'ocean_world_shallow_shelf', weight: 0.2, band: 'equator', stampRadius: 0.2 },
    ],
    stampCount: 10,
    liquid: 'base_ocean_deep',
    liquidLevel: 0.50,
    liquidColor: [0.03, 0.10, 0.28],
    atmColor: [0.3, 0.5, 0.8], atmThickness: 0.10, emissive: 0,
    cloudDensity: 0.2, displacementScale: 0.008, normalStrength: 0.8,
  },
  'moon-desert': {
    baseTexture: 'base_desert_oxide',
    stamps: [
      { id: 'dust_storm_desert_surface', weight: 0.3, band: 'equator' },
      { id: 'rocky_desert_plateau', weight: 0.3, band: 'mid' },
      { id: 'dry_lakebed_terrain', weight: 0.2, band: 'polar', stampRadius: 0.2 },
      { id: 'wind_carved_yardangs', weight: 0.1, band: 'mid', stampRadius: 0.15 },
      { id: 'evaporite_basin', weight: 0.1, band: 'polar', stampRadius: 0.15 },
    ],
    stampCount: 12,
    atmColor: [0.6, 0.5, 0.3], atmThickness: 0.12, emissive: 0,
    cloudDensity: 0, displacementScale: 0.022, normalStrength: 1.3,
  },
  'moon-iron': {
    baseTexture: 'base_rocky_iron',
    stamps: [
      { id: 'mercury_hollow_terrain', weight: 0.35, band: 'any', satMul: 0.6 },
      { id: 'shock_fractured_rock', weight: 0.3, band: 'equator' },
      { id: 'impact_melt_plains', weight: 0.2, band: 'mid', hueShift: -20 },
      { id: 'glassified_impact_terrain', weight: 0.15, band: 'polar' },
    ],
    stampCount: 10,
    atmColor: [0.35, 0.30, 0.25], atmThickness: 0.0, emissive: 0,
    cloudDensity: 0, displacementScale: 0.018, normalStrength: 1.6,
  },
  'moon-carbon-soot': {
    baseTexture: 'base_rocky_barren',
    stamps: [
      { id: 'tar_sand_plains', weight: 0.35, band: 'any', satMul: 0.4 },
      { id: 'volcanic_ash_basin', weight: 0.3, band: 'mid', satMul: 0.3 },
      { id: 'ancient_shield_terrain', weight: 0.2, band: 'polar', brightMul: 0.5 },
      { id: 'shock_fractured_rock', weight: 0.15, band: 'equator', brightMul: 0.5 },
    ],
    stampCount: 10,
    baseTint: [-15, 0.3, 0.5],
    atmColor: [0.15, 0.12, 0.10], atmThickness: 0.05, emissive: 0,
    cloudDensity: 0, displacementScale: 0.015, normalStrength: 1.2,
  },
  'moon-subsurface-ocean': {
    baseTexture: 'base_ice_sheet',
    stamps: [
      { id: 'europa_chaos_terrain', weight: 0.3, band: 'equator' },
      { id: 'enceladus_tiger_stripes', weight: 0.25, band: 'mid', stampRadius: 0.12 },
      { id: 'subglacial_ocean_ice_shell', weight: 0.25, band: 'polar' },
      { id: 'crevasse_ice_field', weight: 0.1, band: 'any', stampRadius: 0.12 },
      { id: 'cryovolcanic_ice_moon', weight: 0.1, band: 'mid', stampRadius: 0.12 },
    ],
    stampCount: 10,
    atmColor: [0.5, 0.6, 0.8], atmThickness: 0.0, emissive: 0,
    cloudDensity: 0, displacementScale: 0.012, normalStrength: 1.0,
  },
  'moon-magma-ocean': {
    baseTexture: 'base_lava_crust',
    stamps: [
      { id: 'lava_world_magma_crust', weight: 0.35, band: 'equator' },
      { id: 'cooling_lava_crust', weight: 0.3, band: 'mid' },
      { id: 'basalt_lava_plains', weight: 0.2, band: 'polar' },
      { id: 'ropy_pahoehoe_lava', weight: 0.15, band: 'any', stampRadius: 0.15 },
    ],
    stampCount: 12,
    atmColor: [0.8, 0.3, 0.1], atmThickness: 0.10, emissive: 0.6,
    cloudDensity: 0, displacementScale: 0.018, normalStrength: 1.5,
  },
  'moon-atmosphere-thin': {
    baseTexture: 'base_desert_oxide',
    stamps: [
      { id: 'dust_storm_desert_surface', weight: 0.25, band: 'equator' },
      { id: 'sedimentary_layer_terrain', weight: 0.2, band: 'mid' },
      { id: 'salt_flat_planet', weight: 0.15, band: 'equator', satMul: 0.7, stampRadius: 0.2 },
      { id: 'polar_ice_cap_terrain', weight: 0.2, band: 'polar', stampRadius: 0.3 },
      { id: 'rocky_desert_plateau', weight: 0.2, band: 'mid' },
    ],
    stampCount: 12,
    atmColor: [0.7, 0.5, 0.35], atmThickness: 0.15, emissive: 0,
    cloudDensity: 0.05, displacementScale: 0.020, normalStrength: 1.2,
  },
  'moon-atmosphere-thick': {
    baseTexture: 'base_hydrocarbon_dark',
    stamps: [
      { id: 'titan_hydrocarbon_dunes', weight: 0.25, band: 'equator', stampRadius: 0.3 },
      { id: 'methane_hydrocarbon_shores', weight: 0.2, band: 'mid' },
      { id: 'hydrocarbon_lake_shore', weight: 0.2, band: 'mid' },
      { id: 'methane_ice_plains', weight: 0.15, band: 'polar' },
      { id: 'tar_sand_plains', weight: 0.1, band: 'equator', stampRadius: 0.2 },
      { id: 'crevasse_ice_field', weight: 0.1, band: 'polar', hueShift: -20, stampRadius: 0.15 },
    ],
    stampCount: 12,
    atmColor: [0.70, 0.55, 0.25], atmThickness: 0.70, emissive: 0,
    cloudDensity: 0.6, displacementScale: 0.015, normalStrength: 1.0,
  },
  'moon-tidally-heated': {
    baseTexture: 'base_lava_cooled',
    stamps: [
      { id: 'io_sulfur_volcanic_plains', weight: 0.25, band: 'equator' },
      { id: 'sulfur_vent_fields', weight: 0.2, band: 'mid' },
      { id: 'volcanic_shield_plains', weight: 0.2, band: 'mid', stampRadius: 0.25 },
      { id: 'cooling_lava_crust', weight: 0.15, band: 'polar' },
      { id: 'lava_world_magma_crust', weight: 0.1, band: 'equator', stampRadius: 0.15 },
      { id: 'ash_covered_lava_plateau', weight: 0.1, band: 'any' },
    ],
    stampCount: 14,
    atmColor: [0.7, 0.5, 0.2], atmThickness: 0.08, emissive: 0.35,
    cloudDensity: 0, displacementScale: 0.022, normalStrength: 1.5,
  },
  'moon-captured': {
    baseTexture: 'base_rocky_ancient',
    stamps: [
      { id: 'ancient_lunar_highlands', weight: 0.3, band: 'any' },
      { id: 'fresh_impact_crater_field', weight: 0.3, band: 'equator', stampRadius: 0.15 },
      { id: 'crater_ejecta_blanket', weight: 0.2, band: 'polar', stampRadius: 0.12 },
      { id: 'shock_fractured_rock', weight: 0.2, band: 'mid' },
    ],
    stampCount: 12,
    atmColor: [0.3, 0.3, 0.3], atmThickness: 0.0, emissive: 0,
    cloudDensity: 0, displacementScale: 0.025, normalStrength: 1.8,
  },
  'moon-trojan': {
    baseTexture: 'base_rocky_barren',
    stamps: [
      { id: 'basaltic_cratered_moon', weight: 0.3, band: 'any' },
      { id: 'ancient_lunar_highlands', weight: 0.25, band: 'mid', hueShift: 10 },
      { id: 'shock_fractured_rock', weight: 0.25, band: 'equator' },
      { id: 'crater_ejecta_blanket', weight: 0.2, band: 'polar', stampRadius: 0.12 },
    ],
    stampCount: 10,
    atmColor: [0.3, 0.3, 0.3], atmThickness: 0.0, emissive: 0,
    cloudDensity: 0, displacementScale: 0.022, normalStrength: 1.6,
  },
  'moon-ring-shepherd': {
    baseTexture: 'base_ice_sheet',
    stamps: [
      { id: 'blue_ice_plains', weight: 0.3, band: 'any' },
      { id: 'ammonia_ice_plains', weight: 0.3, band: 'mid' },
      { id: 'glacial_ice_sheet', weight: 0.2, band: 'polar' },
      { id: 'crevasse_ice_field', weight: 0.1, band: 'equator', stampRadius: 0.12 },
      { id: 'cryovolcanic_ice_moon', weight: 0.1, band: 'mid', stampRadius: 0.1 },
    ],
    stampCount: 10,
    atmColor: [0.5, 0.6, 0.8], atmThickness: 0.0, emissive: 0,
    cloudDensity: 0, displacementScale: 0.010, normalStrength: 0.8,
  },
  'moon-binary': {
    baseTexture: 'base_rocky_barren',
    stamps: [
      { id: 'basaltic_cratered_moon', weight: 0.3, band: 'any' },
      { id: 'faulted_crust_terrain', weight: 0.25, band: 'equator' },
      { id: 'ancient_lunar_highlands', weight: 0.25, band: 'polar' },
      { id: 'tectonic_rift_zone', weight: 0.2, band: 'mid', stampRadius: 0.15 },
    ],
    stampCount: 10,
    atmColor: [0.3, 0.3, 0.3], atmThickness: 0.0, emissive: 0,
    cloudDensity: 0, displacementScale: 0.025, normalStrength: 1.6,
  },
  'moon-earth-like': {
    baseTexture: 'base_ocean_shallow',
    stamps: [
      { id: 'continental_craton_terrain', weight: 0.25, band: 'mid', stampRadius: 0.3 },
      { id: 'eroded_highlands', weight: 0.2, band: 'mid' },
      { id: 'coral_reef_shelf', weight: 0.15, band: 'equator', stampRadius: 0.2 },
      { id: 'glacial_ice_sheet', weight: 0.2, band: 'polar', stampRadius: 0.3 },
      { id: 'desert_dune_planet', weight: 0.1, band: 'equator', stampRadius: 0.15 },
      { id: 'folded_mountain_belt', weight: 0.1, band: 'mid', stampRadius: 0.15 },
    ],
    stampCount: 12,
    liquid: 'base_ocean_deep',
    liquidLevel: 0.30,
    liquidColor: [0.04, 0.12, 0.30],
    atmColor: [0.35, 0.55, 0.90], atmThickness: 0.40, emissive: 0,
    cloudDensity: 0.45, displacementScale: 0.028, normalStrength: 1.2,
  },
  'moon-co-orbital': {
    baseTexture: 'base_rocky_ancient',
    stamps: [
      { id: 'ancient_lunar_highlands', weight: 0.35, band: 'any' },
      { id: 'basaltic_cratered_moon', weight: 0.25, band: 'equator' },
      { id: 'mesa_plateau_fields', weight: 0.2, band: 'mid', satMul: 0.5 },
      { id: 'crater_ejecta_blanket', weight: 0.2, band: 'polar', stampRadius: 0.12 },
    ],
    stampCount: 10,
    atmColor: [0.3, 0.3, 0.3], atmThickness: 0.0, emissive: 0,
    cloudDensity: 0, displacementScale: 0.022, normalStrength: 1.5,
  },
  'moon-irregular': {
    baseTexture: 'base_rocky_ancient',
    stamps: [
      { id: 'ancient_lunar_highlands', weight: 0.3, band: 'any', satMul: 0.6 },
      { id: 'fresh_impact_crater_field', weight: 0.25, band: 'equator' },
      { id: 'shock_fractured_rock', weight: 0.25, band: 'polar', brightMul: 0.8 },
      { id: 'crater_ejecta_blanket', weight: 0.2, band: 'mid', stampRadius: 0.1 },
    ],
    stampCount: 14,
    atmColor: [0.25, 0.25, 0.25], atmThickness: 0.0, emissive: 0,
    cloudDensity: 0, displacementScale: 0.030, normalStrength: 2.0,
  },
  'moon-hycean': {
    baseTexture: 'base_ocean_deep',
    stamps: [
      { id: 'deep_ocean_abyssal_plain', weight: 0.3, band: 'equator' },
      { id: 'ocean_world_shallow_shelf', weight: 0.25, band: 'mid' },
      { id: 'fractured_ice_shelf', weight: 0.25, band: 'polar', stampRadius: 0.3 },
      { id: 'coral_reef_shelf', weight: 0.2, band: 'equator', stampRadius: 0.2 },
    ],
    stampCount: 10,
    liquid: 'base_ocean_deep',
    liquidLevel: 0.55,
    liquidColor: [0.03, 0.10, 0.28],
    atmColor: [0.25, 0.50, 0.85], atmThickness: 0.45, emissive: 0,
    cloudDensity: 0.50, displacementScale: 0.008, normalStrength: 0.8,
  },

  // ═══ Gas Giants (procedural shader in ProceduralPlanet; minimal palette) ══
  'gas-giant':      { baseTexture: 'base_desert_sand', stamps: [], stampCount: 0, atmColor: [0.8, 0.7, 0.5], atmThickness: 0.0, emissive: 0, cloudDensity: 0, displacementScale: 0, normalStrength: 0 },
  'super-jupiter':  { baseTexture: 'base_desert_sand', stamps: [], stampCount: 0, atmColor: [0.8, 0.7, 0.5], atmThickness: 0.0, emissive: 0, cloudDensity: 0, displacementScale: 0, normalStrength: 0 },
  'hot-jupiter':    { baseTexture: 'base_lava_crust',  stamps: [], stampCount: 0, atmColor: [0.9, 0.4, 0.2], atmThickness: 0.0, emissive: 0.2, cloudDensity: 0, displacementScale: 0, normalStrength: 0 },
  'neptune-like':   { baseTexture: 'base_ice_sheet',   stamps: [], stampCount: 0, atmColor: [0.3, 0.5, 0.9], atmThickness: 0.0, emissive: 0, cloudDensity: 0, displacementScale: 0, normalStrength: 0 },
  'warm-neptune':   { baseTexture: 'base_ice_sheet',   stamps: [], stampCount: 0, atmColor: [0.4, 0.5, 0.8], atmThickness: 0.0, emissive: 0, cloudDensity: 0, displacementScale: 0, normalStrength: 0 },
  'mini-neptune':   { baseTexture: 'base_ice_sheet',   stamps: [], stampCount: 0, atmColor: [0.4, 0.7, 0.9], atmThickness: 0.0, emissive: 0, cloudDensity: 0, displacementScale: 0, normalStrength: 0 },
  'sub-neptune':    { baseTexture: 'base_ice_sheet',   stamps: [], stampCount: 0, atmColor: [0.5, 0.7, 0.9], atmThickness: 0.0, emissive: 0, cloudDensity: 0, displacementScale: 0, normalStrength: 0 },
};

/** Default fallback for unknown types */
const DEFAULT_PALETTE: WorldPalette = {
  baseTexture: 'base_rocky_barren',
  stamps: [
    { id: 'basaltic_cratered_moon', weight: 0.4, band: 'any' },
    { id: 'ancient_lunar_highlands', weight: 0.3, band: 'mid' },
    { id: 'fresh_impact_crater_field', weight: 0.2, band: 'polar', stampRadius: 0.12 },
    { id: 'crater_ejecta_blanket', weight: 0.1, band: 'equator', stampRadius: 0.1 },
  ],
  stampCount: 10,
  atmColor: [0.3, 0.3, 0.3], atmThickness: 0.05, emissive: 0,
  cloudDensity: 0, displacementScale: 0.020, normalStrength: 1.5,
};

/* ── Star spectral class → tint color ─────────────────── */

export const STAR_TINT: Record<string, [number, number, number]> = {
  'O': [0.65, 0.70, 1.00],
  'B': [0.75, 0.80, 1.00],
  'A': [0.90, 0.92, 1.00],
  'F': [0.98, 0.97, 0.95],
  'G': [1.00, 0.96, 0.88],
  'K': [1.00, 0.85, 0.70],
  'M': [1.00, 0.70, 0.50],
  'L': [0.95, 0.55, 0.35],
  'T': [0.85, 0.45, 0.55],
};

/* gas giant set — still falls through to ProceduralPlanet */
export const GAS_TYPES = new Set([
  'gas-giant', 'super-jupiter', 'hot-jupiter',
  'neptune-like', 'warm-neptune', 'mini-neptune', 'sub-neptune',
]);

/* ── Public API ─────────────────────────────────────── */

export function getWorldPalette(planetType: string, temperatureK: number = 300): WorldPalette {
  const palette = PALETTES[planetType] ?? DEFAULT_PALETTE;
  let em = palette.emissive;
  if (temperatureK > 1500 && em < 0.3) {
    em = Math.min(1, 0.3 + (temperatureK - 1500) / 3000);
  }
  return { ...palette, emissive: em };
}

export function getStarColor(spectralClass?: string): [number, number, number] {
  if (!spectralClass) return [1, 0.96, 0.88];
  const letter = spectralClass.charAt(0).toUpperCase();
  return STAR_TINT[letter] ?? [1, 0.96, 0.88];
}

export function textureUrl(id: string, suffix: '' | '_height' | '_normal' = ''): string {
  return `/textures/planets/${id}${suffix}.png`;
}

export function getPaletteTextureIds(palette: WorldPalette): string[] {
  const ids = [palette.baseTexture];
  for (const s of palette.stamps) if (!ids.includes(s.id)) ids.push(s.id);
  if (palette.liquid && !ids.includes(palette.liquid)) ids.push(palette.liquid);
  return ids;
}
