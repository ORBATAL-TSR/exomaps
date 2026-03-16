/**
 * EWoCS Texture Manifest v2 — Many-to-many world→texture mapping.
 *
 * Each world type gets a "terrain palette" of 2-4 region textures
 * that are blended by latitude/altitude on the sphere. Textures are
 * creatively reused across many world types with different hue/tint.
 *
 * For each texture ID, the runtime loads:
 *   /textures/planets/{id}.png            — diffuse (albedo)
 *   /textures/planets/{id}_height.png     — greyscale heightmap
 *   /textures/planets/{id}_normal.png     — tangent-space normal map
 */

/* ── Types ──────────────────────────────────────────────── */

export interface RegionTexture {
  /** Texture file ID (without extension) */
  id: string;
  /** Weight in blend (0-1, relative to others in palette) */
  weight: number;
  /** Latitude band: 'equator' | 'mid' | 'polar' | 'any' */
  band: 'equator' | 'mid' | 'polar' | 'any';
  /** Hue shift in degrees (-180..180), applied in-shader */
  hueShift?: number;
  /** Saturation multiplier (0..2, default 1) */
  satMul?: number;
  /** Brightness multiplier (0..2, default 1) */
  brightMul?: number;
}

export interface WorldPalette {
  /** Region textures to blend */
  regions: RegionTexture[];
  /** Atmosphere color [R,G,B] 0-1 */
  atmColor: [number, number, number];
  /** Atmosphere thickness 0-1 */
  atmThickness: number;
  /** Emissive glow 0-1 (lava, hot surfaces) */
  emissive: number;
  /** Cloud texture ID (optional) */
  cloud?: string;
  /** Cloud density 0-1 */
  cloudDensity: number;
  /** Heightmap displacement strength */
  displacementScale: number;
  /** Normal map strength */
  normalStrength: number;
}

/* ── Creative Many-to-Many Palette Definitions ───────── */

const PALETTES: Record<string, WorldPalette> = {
  // ═══ Rocky / Airless ══════════════════════════════════
  'rocky': {
    regions: [
      { id: 'basaltic_cratered_moon', weight: 0.45, band: 'any' },
      { id: 'ancient_lunar_highlands', weight: 0.30, band: 'mid' },
      { id: 'mercury_hollow_terrain', weight: 0.25, band: 'equator' },
    ],
    atmColor: [0.3, 0.3, 0.3], atmThickness: 0.05, emissive: 0,
    cloudDensity: 0, displacementScale: 0.025, normalStrength: 1.5,
  },
  'sub-earth': {
    regions: [
      { id: 'ancient_lunar_highlands', weight: 0.40, band: 'any' },
      { id: 'fresh_impact_crater_field', weight: 0.30, band: 'equator' },
      { id: 'crater_ejecta_blanket', weight: 0.30, band: 'polar' },
    ],
    atmColor: [0.3, 0.3, 0.3], atmThickness: 0.03, emissive: 0,
    cloudDensity: 0, displacementScale: 0.020, normalStrength: 1.5,
  },
  'iron-planet': {
    regions: [
      { id: 'mercury_hollow_terrain', weight: 0.40, band: 'any', satMul: 0.7 },
      { id: 'impact_melt_plains', weight: 0.30, band: 'equator', hueShift: -15 },
      { id: 'glassified_impact_terrain', weight: 0.30, band: 'mid' },
    ],
    atmColor: [0.4, 0.35, 0.3], atmThickness: 0.02, emissive: 0,
    cloudDensity: 0, displacementScale: 0.015, normalStrength: 1.8,
  },
  'carbon-planet': {
    regions: [
      { id: 'tar_sand_plains', weight: 0.35, band: 'equator', satMul: 0.5 },
      { id: 'shock_fractured_rock', weight: 0.35, band: 'mid', hueShift: -30 },
      { id: 'granite_plateau_surface', weight: 0.30, band: 'polar', satMul: 0.3, brightMul: 0.6 },
    ],
    atmColor: [0.2, 0.15, 0.1], atmThickness: 0.10, emissive: 0,
    cloudDensity: 0, displacementScale: 0.020, normalStrength: 1.5,
  },

  // ═══ Earth-like / Habitable ═══════════════════════════
  'earth-like': {
    regions: [
      { id: 'coral_reef_shelf', weight: 0.25, band: 'equator' },
      { id: 'continental_craton_terrain', weight: 0.30, band: 'mid' },
      { id: 'eroded_highlands', weight: 0.25, band: 'mid' },
      { id: 'glacial_ice_sheet', weight: 0.20, band: 'polar' },
    ],
    atmColor: [0.35, 0.55, 0.90], atmThickness: 0.45, emissive: 0,
    cloudDensity: 0.5, displacementScale: 0.030, normalStrength: 1.2,
  },
  'super-earth': {
    regions: [
      { id: 'ocean_world_shallow_shelf', weight: 0.25, band: 'equator' },
      { id: 'folded_mountain_belt', weight: 0.30, band: 'mid' },
      { id: 'volcanic_shield_plains', weight: 0.25, band: 'equator' },
      { id: 'polar_ice_cap_terrain', weight: 0.20, band: 'polar' },
    ],
    atmColor: [0.30, 0.50, 0.85], atmThickness: 0.55, emissive: 0,
    cloudDensity: 0.55, displacementScale: 0.035, normalStrength: 1.3,
  },
  'hycean': {
    regions: [
      { id: 'deep_ocean_abyssal_plain', weight: 0.40, band: 'equator', hueShift: 10 },
      { id: 'ocean_world_shallow_shelf', weight: 0.35, band: 'mid' },
      { id: 'fractured_ice_shelf', weight: 0.25, band: 'polar' },
    ],
    atmColor: [0.25, 0.50, 0.85], atmThickness: 0.50, emissive: 0,
    cloudDensity: 0.55, displacementScale: 0.008, normalStrength: 0.8,
  },

  // ═══ Desert / Arid ════════════════════════════════════
  'desert-world': {
    regions: [
      { id: 'desert_dune_planet', weight: 0.30, band: 'equator' },
      { id: 'rocky_desert_plateau', weight: 0.25, band: 'mid' },
      { id: 'wind_carved_yardangs', weight: 0.20, band: 'mid' },
      { id: 'dust_storm_desert_surface', weight: 0.25, band: 'polar' },
    ],
    atmColor: [0.70, 0.55, 0.35], atmThickness: 0.25, emissive: 0,
    cloudDensity: 0.05, displacementScale: 0.030, normalStrength: 1.4,
  },

  // ═══ Ocean ════════════════════════════════════════════
  'ocean-world': {
    regions: [
      { id: 'deep_ocean_abyssal_plain', weight: 0.30, band: 'equator' },
      { id: 'coral_reef_shelf', weight: 0.25, band: 'equator', hueShift: -10 },
      { id: 'basalt_seafloor_ridge', weight: 0.25, band: 'mid' },
      { id: 'glacial_ice_sheet', weight: 0.20, band: 'polar', hueShift: 15 },
    ],
    atmColor: [0.25, 0.50, 0.85], atmThickness: 0.45, emissive: 0,
    cloudDensity: 0.6, displacementScale: 0.005, normalStrength: 0.6,
  },

  // ═══ Volcanic / Lava ═════════════════════════════════
  'lava-world': {
    regions: [
      { id: 'lava_world_magma_crust', weight: 0.35, band: 'equator' },
      { id: 'cooling_lava_crust', weight: 0.30, band: 'mid' },
      { id: 'basalt_lava_plains', weight: 0.20, band: 'polar' },
      { id: 'ropy_pahoehoe_lava', weight: 0.15, band: 'any' },
    ],
    atmColor: [0.80, 0.30, 0.10], atmThickness: 0.20, emissive: 0.65,
    cloudDensity: 0, displacementScale: 0.020, normalStrength: 1.8,
  },
  'chthonian': {
    regions: [
      { id: 'impact_melt_plains', weight: 0.35, band: 'equator', hueShift: 10, satMul: 0.8 },
      { id: 'glassified_impact_terrain', weight: 0.30, band: 'mid' },
      { id: 'cooling_lava_crust', weight: 0.35, band: 'polar', satMul: 0.7 },
    ],
    atmColor: [0.6, 0.3, 0.15], atmThickness: 0.08, emissive: 0.30,
    cloudDensity: 0, displacementScale: 0.025, normalStrength: 1.6,
  },
  'venus': {
    regions: [
      { id: 'volcanic_shield_plains', weight: 0.30, band: 'equator' },
      { id: 'tectonic_rift_zone', weight: 0.25, band: 'mid' },
      { id: 'subduction_arc_volcano_terrain', weight: 0.25, band: 'mid' },
      { id: 'ash_covered_lava_plateau', weight: 0.20, band: 'polar' },
    ],
    atmColor: [0.85, 0.75, 0.45], atmThickness: 0.90, emissive: 0.05,
    cloudDensity: 0.85, displacementScale: 0.020, normalStrength: 1.2,
  },

  // ═══ Ice / Cryo ══════════════════════════════════════
  'ice-dwarf': {
    regions: [
      { id: 'nitrogen_ice_glacier', weight: 0.30, band: 'equator' },
      { id: 'methane_ice_plains', weight: 0.25, band: 'mid' },
      { id: 'ammonia_ice_plains', weight: 0.25, band: 'polar' },
      { id: 'crevasse_ice_field', weight: 0.20, band: 'any' },
    ],
    atmColor: [0.6, 0.7, 0.9], atmThickness: 0.08, emissive: 0,
    cloudDensity: 0, displacementScale: 0.015, normalStrength: 1.0,
  },
  'eyeball-world': {
    regions: [
      { id: 'ocean_world_shallow_shelf', weight: 0.30, band: 'equator', hueShift: 5 },
      { id: 'fractured_ice_shelf', weight: 0.25, band: 'mid' },
      { id: 'glacial_ice_sheet', weight: 0.25, band: 'polar' },
      { id: 'blue_ice_plains', weight: 0.20, band: 'polar' },
    ],
    atmColor: [0.40, 0.55, 0.85], atmThickness: 0.30, emissive: 0,
    cloudDensity: 0.3, displacementScale: 0.015, normalStrength: 1.0,
  },

  // ═══ Moons ═══════════════════════════════════════════
  'moon-rocky': {
    regions: [
      { id: 'basaltic_cratered_moon', weight: 0.40, band: 'any' },
      { id: 'ancient_lunar_highlands', weight: 0.35, band: 'mid' },
      { id: 'crater_ejecta_blanket', weight: 0.25, band: 'equator' },
    ],
    atmColor: [0.3, 0.3, 0.3], atmThickness: 0.0, emissive: 0,
    cloudDensity: 0, displacementScale: 0.025, normalStrength: 1.8,
  },
  'moon-icy': {
    regions: [
      { id: 'europa_chaos_terrain', weight: 0.35, band: 'equator' },
      { id: 'crevasse_ice_field', weight: 0.30, band: 'mid' },
      { id: 'blue_ice_plains', weight: 0.35, band: 'polar' },
    ],
    atmColor: [0.5, 0.6, 0.8], atmThickness: 0.0, emissive: 0,
    cloudDensity: 0, displacementScale: 0.015, normalStrength: 1.2,
  },
  'moon-volcanic': {
    regions: [
      { id: 'io_sulfur_volcanic_plains', weight: 0.35, band: 'equator' },
      { id: 'sulfur_vent_fields', weight: 0.30, band: 'mid' },
      { id: 'cooling_lava_crust', weight: 0.20, band: 'any' },
      { id: 'ash_covered_lava_plateau', weight: 0.15, band: 'polar' },
    ],
    atmColor: [0.7, 0.5, 0.2], atmThickness: 0.05, emissive: 0.3,
    cloudDensity: 0, displacementScale: 0.020, normalStrength: 1.5,
  },
  'moon-ocean': {
    regions: [
      { id: 'deep_ocean_abyssal_plain', weight: 0.35, band: 'equator' },
      { id: 'basalt_seafloor_ridge', weight: 0.30, band: 'mid' },
      { id: 'fractured_ice_shelf', weight: 0.35, band: 'polar' },
    ],
    atmColor: [0.3, 0.5, 0.8], atmThickness: 0.10, emissive: 0,
    cloudDensity: 0.2, displacementScale: 0.008, normalStrength: 0.8,
  },
  'moon-desert': {
    regions: [
      { id: 'dust_storm_desert_surface', weight: 0.35, band: 'equator' },
      { id: 'rocky_desert_plateau', weight: 0.35, band: 'mid' },
      { id: 'dry_lakebed_terrain', weight: 0.30, band: 'polar' },
    ],
    atmColor: [0.6, 0.5, 0.3], atmThickness: 0.12, emissive: 0,
    cloudDensity: 0, displacementScale: 0.022, normalStrength: 1.3,
  },
  'moon-iron': {
    regions: [
      { id: 'mercury_hollow_terrain', weight: 0.45, band: 'any', satMul: 0.6 },
      { id: 'shock_fractured_rock', weight: 0.30, band: 'equator' },
      { id: 'impact_melt_plains', weight: 0.25, band: 'mid', hueShift: -20 },
    ],
    atmColor: [0.35, 0.30, 0.25], atmThickness: 0.0, emissive: 0,
    cloudDensity: 0, displacementScale: 0.018, normalStrength: 1.6,
  },
  'moon-carbon-soot': {
    regions: [
      { id: 'tar_sand_plains', weight: 0.40, band: 'any', satMul: 0.4 },
      { id: 'volcanic_ash_basin', weight: 0.30, band: 'mid', satMul: 0.3 },
      { id: 'ancient_shield_terrain', weight: 0.30, band: 'polar', brightMul: 0.5 },
    ],
    atmColor: [0.15, 0.12, 0.10], atmThickness: 0.05, emissive: 0,
    cloudDensity: 0, displacementScale: 0.015, normalStrength: 1.2,
  },
  'moon-subsurface-ocean': {
    regions: [
      { id: 'europa_chaos_terrain', weight: 0.35, band: 'equator' },
      { id: 'enceladus_tiger_stripes', weight: 0.30, band: 'mid' },
      { id: 'subglacial_ocean_ice_shell', weight: 0.35, band: 'polar' },
    ],
    atmColor: [0.5, 0.6, 0.8], atmThickness: 0.0, emissive: 0,
    cloudDensity: 0, displacementScale: 0.012, normalStrength: 1.0,
  },
  'moon-magma-ocean': {
    regions: [
      { id: 'lava_world_magma_crust', weight: 0.40, band: 'equator' },
      { id: 'cooling_lava_crust', weight: 0.35, band: 'mid' },
      { id: 'basalt_lava_plains', weight: 0.25, band: 'polar' },
    ],
    atmColor: [0.8, 0.3, 0.1], atmThickness: 0.10, emissive: 0.6,
    cloudDensity: 0, displacementScale: 0.018, normalStrength: 1.5,
  },
  'moon-atmosphere-thin': {
    regions: [
      { id: 'dust_storm_desert_surface', weight: 0.30, band: 'equator' },
      { id: 'sedimentary_layer_terrain', weight: 0.30, band: 'mid' },
      { id: 'salt_flat_planet', weight: 0.20, band: 'equator', satMul: 0.7 },
      { id: 'polar_ice_cap_terrain', weight: 0.20, band: 'polar' },
    ],
    atmColor: [0.7, 0.5, 0.35], atmThickness: 0.15, emissive: 0,
    cloudDensity: 0.05, displacementScale: 0.020, normalStrength: 1.2,
  },
  'moon-atmosphere-thick': {
    regions: [
      { id: 'titan_hydrocarbon_dunes', weight: 0.30, band: 'equator' },
      { id: 'methane_hydrocarbon_shores', weight: 0.25, band: 'mid' },
      { id: 'hydrocarbon_lake_shore', weight: 0.25, band: 'mid' },
      { id: 'methane_ice_plains', weight: 0.20, band: 'polar' },
    ],
    atmColor: [0.70, 0.55, 0.25], atmThickness: 0.70, emissive: 0,
    cloudDensity: 0.6, displacementScale: 0.015, normalStrength: 1.0,
  },
  'moon-tidally-heated': {
    regions: [
      { id: 'io_sulfur_volcanic_plains', weight: 0.30, band: 'equator' },
      { id: 'sulfur_vent_fields', weight: 0.25, band: 'mid' },
      { id: 'volcanic_shield_plains', weight: 0.25, band: 'mid' },
      { id: 'cooling_lava_crust', weight: 0.20, band: 'polar' },
    ],
    atmColor: [0.7, 0.5, 0.2], atmThickness: 0.08, emissive: 0.35,
    cloudDensity: 0, displacementScale: 0.022, normalStrength: 1.5,
  },
  'moon-captured': {
    regions: [
      { id: 'ancient_lunar_highlands', weight: 0.35, band: 'any' },
      { id: 'fresh_impact_crater_field', weight: 0.35, band: 'equator' },
      { id: 'crater_ejecta_blanket', weight: 0.30, band: 'polar' },
    ],
    atmColor: [0.3, 0.3, 0.3], atmThickness: 0.0, emissive: 0,
    cloudDensity: 0, displacementScale: 0.025, normalStrength: 1.8,
  },
  'moon-trojan': {
    regions: [
      { id: 'basaltic_cratered_moon', weight: 0.40, band: 'any' },
      { id: 'ancient_lunar_highlands', weight: 0.30, band: 'mid', hueShift: 10 },
      { id: 'shock_fractured_rock', weight: 0.30, band: 'equator' },
    ],
    atmColor: [0.3, 0.3, 0.3], atmThickness: 0.0, emissive: 0,
    cloudDensity: 0, displacementScale: 0.022, normalStrength: 1.6,
  },
  'moon-ring-shepherd': {
    regions: [
      { id: 'blue_ice_plains', weight: 0.35, band: 'any' },
      { id: 'ammonia_ice_plains', weight: 0.35, band: 'mid' },
      { id: 'glacial_ice_sheet', weight: 0.30, band: 'polar' },
    ],
    atmColor: [0.5, 0.6, 0.8], atmThickness: 0.0, emissive: 0,
    cloudDensity: 0, displacementScale: 0.010, normalStrength: 0.8,
  },
  'moon-binary': {
    regions: [
      { id: 'basaltic_cratered_moon', weight: 0.35, band: 'any' },
      { id: 'faulted_crust_terrain', weight: 0.30, band: 'equator' },
      { id: 'ancient_lunar_highlands', weight: 0.35, band: 'polar' },
    ],
    atmColor: [0.3, 0.3, 0.3], atmThickness: 0.0, emissive: 0,
    cloudDensity: 0, displacementScale: 0.025, normalStrength: 1.6,
  },
  'moon-earth-like': {
    regions: [
      { id: 'coral_reef_shelf', weight: 0.25, band: 'equator' },
      { id: 'continental_craton_terrain', weight: 0.30, band: 'mid' },
      { id: 'eroded_highlands', weight: 0.25, band: 'mid' },
      { id: 'glacial_ice_sheet', weight: 0.20, band: 'polar' },
    ],
    atmColor: [0.35, 0.55, 0.90], atmThickness: 0.40, emissive: 0,
    cloudDensity: 0.45, displacementScale: 0.028, normalStrength: 1.2,
  },
  'moon-co-orbital': {
    regions: [
      { id: 'ancient_lunar_highlands', weight: 0.40, band: 'any' },
      { id: 'basaltic_cratered_moon', weight: 0.30, band: 'equator' },
      { id: 'mesa_plateau_fields', weight: 0.30, band: 'mid', satMul: 0.5 },
    ],
    atmColor: [0.3, 0.3, 0.3], atmThickness: 0.0, emissive: 0,
    cloudDensity: 0, displacementScale: 0.022, normalStrength: 1.5,
  },
  'moon-irregular': {
    regions: [
      { id: 'ancient_lunar_highlands', weight: 0.40, band: 'any', satMul: 0.6 },
      { id: 'fresh_impact_crater_field', weight: 0.30, band: 'equator' },
      { id: 'shock_fractured_rock', weight: 0.30, band: 'polar', brightMul: 0.8 },
    ],
    atmColor: [0.25, 0.25, 0.25], atmThickness: 0.0, emissive: 0,
    cloudDensity: 0, displacementScale: 0.030, normalStrength: 2.0,
  },
  'moon-hycean': {
    regions: [
      { id: 'deep_ocean_abyssal_plain', weight: 0.35, band: 'equator' },
      { id: 'ocean_world_shallow_shelf', weight: 0.30, band: 'mid' },
      { id: 'fractured_ice_shelf', weight: 0.35, band: 'polar' },
    ],
    atmColor: [0.25, 0.50, 0.85], atmThickness: 0.45, emissive: 0,
    cloudDensity: 0.50, displacementScale: 0.008, normalStrength: 0.8,
  },

  // ═══ Gas Giants (procedural shader in ProceduralPlanet; minimal palette) ══
  'gas-giant':      { regions: [{ id: 'desert_dune_planet', weight: 1, band: 'any', satMul: 0.3 }], atmColor: [0.8, 0.7, 0.5], atmThickness: 0.0, emissive: 0, cloudDensity: 0, displacementScale: 0, normalStrength: 0 },
  'super-jupiter':  { regions: [{ id: 'desert_dune_planet', weight: 1, band: 'any', satMul: 0.3 }], atmColor: [0.8, 0.7, 0.5], atmThickness: 0.0, emissive: 0, cloudDensity: 0, displacementScale: 0, normalStrength: 0 },
  'hot-jupiter':    { regions: [{ id: 'lava_world_magma_crust', weight: 1, band: 'any', satMul: 0.5 }], atmColor: [0.9, 0.4, 0.2], atmThickness: 0.0, emissive: 0.2, cloudDensity: 0, displacementScale: 0, normalStrength: 0 },
  'neptune-like':   { regions: [{ id: 'blue_ice_plains', weight: 1, band: 'any', hueShift: 20 }], atmColor: [0.3, 0.5, 0.9], atmThickness: 0.0, emissive: 0, cloudDensity: 0, displacementScale: 0, normalStrength: 0 },
  'warm-neptune':   { regions: [{ id: 'blue_ice_plains', weight: 1, band: 'any', hueShift: 10 }], atmColor: [0.4, 0.5, 0.8], atmThickness: 0.0, emissive: 0, cloudDensity: 0, displacementScale: 0, normalStrength: 0 },
  'mini-neptune':   { regions: [{ id: 'glacial_ice_sheet', weight: 1, band: 'any', hueShift: 30 }], atmColor: [0.4, 0.7, 0.9], atmThickness: 0.0, emissive: 0, cloudDensity: 0, displacementScale: 0, normalStrength: 0 },
  'sub-neptune':    { regions: [{ id: 'glacial_ice_sheet', weight: 1, band: 'any', hueShift: 25 }], atmColor: [0.5, 0.7, 0.9], atmThickness: 0.0, emissive: 0, cloudDensity: 0, displacementScale: 0, normalStrength: 0 },
};

/** Default fallback for unknown types */
const DEFAULT_PALETTE: WorldPalette = {
  regions: [
    { id: 'basaltic_cratered_moon', weight: 0.50, band: 'any' },
    { id: 'ancient_lunar_highlands', weight: 0.30, band: 'mid' },
    { id: 'fresh_impact_crater_field', weight: 0.20, band: 'polar' },
  ],
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

/**
 * Get the full rendering palette for a world type.
 * Applies temperature-based adjustments.
 */
export function getWorldPalette(planetType: string, temperatureK: number = 300): WorldPalette {
  const palette = PALETTES[planetType] ?? DEFAULT_PALETTE;

  // Temperature-driven emissive boost for very hot worlds
  let em = palette.emissive;
  if (temperatureK > 1500 && em < 0.3) {
    em = Math.min(1, 0.3 + (temperatureK - 1500) / 3000);
  }

  return { ...palette, emissive: em };
}

/**
 * Get star lighting color from spectral class.
 */
export function getStarColor(spectralClass?: string): [number, number, number] {
  if (!spectralClass) return [1, 0.96, 0.88];
  const letter = spectralClass.charAt(0).toUpperCase();
  return STAR_TINT[letter] ?? [1, 0.96, 0.88];
}

/**
 * Build the file path for texture assets.
 */
export function textureUrl(id: string, suffix: '' | '_height' | '_normal' = ''): string {
  return `/textures/planets/${id}${suffix}.png`;
}

/**
 * Collect all unique texture IDs needed for a palette.
 */
export function getPaletteTextureIds(palette: WorldPalette): string[] {
  return palette.regions.map(r => r.id);
}
