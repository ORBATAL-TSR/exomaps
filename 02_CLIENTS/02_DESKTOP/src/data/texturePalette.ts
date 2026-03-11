/**
 * texturePalette.ts — Maps world types to reference textures used as
 * color/detail sources for procedural planet rendering.
 *
 * The procedural shader handles ALL geometry (continents, craters,
 * mountains, oceans, biomes). These textures are sampled via triplanar
 * projection to provide realistic coloring and micro-detail that
 * complements the procedural noise — "pretrained" color knowledge.
 *
 * Each world type gets 3 texture slots:
 *   texLow  — lowland/valley/ocean-floor color reference
 *   texMid  — midland/plains color reference (dominant surface)
 *   texHigh — highland/mountain/polar color reference
 *
 * The shader blends between these based on terrain height, slope,
 * and biome type, creating infinite variation from a finite texture set.
 */

export interface TextureTriplet {
  /** Lowland texture ID */
  texLow: string;
  /** Midland texture ID (primary surface) */
  texMid: string;
  /** Highland texture ID */
  texHigh: string;
  /** How strongly textures influence final color (0=pure procedural, 1=full texture) */
  texInfluence: number;
  /** Triplanar projection scale (smaller = more tiled, bigger = more stretched) */
  triplanarScale: number;
}

const TEX_PATH = '/textures/planets/';

/** Get texture URL for a given ID and optional suffix */
export function texUrl(id: string, suffix = ''): string {
  return `${TEX_PATH}${id}${suffix}.png`;
}

/**
 * World type → texture triplet mapping.
 *
 * texInfluence controls how much the downloaded textures affect final
 * coloring vs pure procedural. 0.3-0.5 is the sweet spot: textures add
 * richness without overriding the procedural diversity system.
 */
const TRIPLETS: Record<string, TextureTriplet> = {

  // ═══ Rocky / Airless ═══════════════════════════════════
  'rocky': {
    texLow:  'basaltic_cratered_moon',
    texMid:  'base_rocky_barren',
    texHigh: 'ancient_lunar_highlands',
    texInfluence: 0.40,
    triplanarScale: 3.0,
  },
  'super-earth': {
    texLow:  'base_rocky_ancient',
    texMid:  'continental_craton_terrain',
    texHigh: 'folded_mountain_belt',
    texInfluence: 0.38,
    triplanarScale: 2.5,
  },
  'sub-earth': {
    texLow:  'base_rocky_barren',
    texMid:  'basaltic_cratered_moon',
    texHigh: 'eroded_highlands',
    texInfluence: 0.42,
    triplanarScale: 3.5,
  },

  // ═══ Desert / Arid ════════════════════════════════════
  'desert': {
    texLow:  'dry_lakebed_terrain',
    texMid:  'base_desert_sand',
    texHigh: 'rocky_desert_plateau',
    texInfluence: 0.45,
    triplanarScale: 2.8,
  },
  'desert-world': {
    texLow:  'evaporite_basin',
    texMid:  'desert_dune_planet',
    texHigh: 'wind_carved_yardangs',
    texInfluence: 0.45,
    triplanarScale: 2.5,
  },

  // ═══ Iron / Metal-rich ════════════════════════════════
  'iron-planet': {
    texLow:  'base_rocky_iron',
    texMid:  'shock_fractured_rock',
    texHigh: 'glassified_impact_terrain',
    texInfluence: 0.38,
    triplanarScale: 3.2,
  },

  // ═══ Carbon worlds ════════════════════════════════════
  'carbon-planet': {
    texLow:  'tar_sand_plains',
    texMid:  'base_hydrocarbon_dark',
    texHigh: 'granite_plateau_surface',
    texInfluence: 0.35,
    triplanarScale: 3.0,
  },

  // ═══ Lava / Volcanic ═════════════════════════════════
  'lava-world': {
    texLow:  'lava_world_magma_crust',
    texMid:  'base_lava_crust',
    texHigh: 'cooling_lava_crust',
    texInfluence: 0.50,
    triplanarScale: 3.5,
  },
  'lava-ocean': {
    texLow:  'ropy_pahoehoe_lava',
    texMid:  'basalt_lava_plains',
    texHigh: 'ash_covered_lava_plateau',
    texInfluence: 0.48,
    triplanarScale: 3.0,
  },

  // ═══ Volcanic (non-lava) ═════════════════════════════
  'volcanic': {
    texLow:  'volcanic_ash_basin',
    texMid:  'base_rocky_volcanic',
    texHigh: 'andesite_volcano_field',
    texInfluence: 0.42,
    triplanarScale: 3.0,
  },

  // ═══ Oceanic / Water worlds ═══════════════════════════
  'ocean-world': {
    texLow:  'base_ocean_deep',
    texMid:  'base_ocean_shallow',
    texHigh: 'island_arc_volcanics',
    texInfluence: 0.35,
    triplanarScale: 2.5,
  },
  'water-world': {
    texLow:  'deep_ocean_abyssal_plain',
    texMid:  'ocean_world_shallow_shelf',
    texHigh: 'coral_reef_shelf',
    texInfluence: 0.35,
    triplanarScale: 2.5,
  },

  // ═══ Habitable / Temperate ════════════════════════════
  'temperate': {
    texLow:  'sedimentary_layer_terrain',
    texMid:  'continental_craton_terrain',
    texHigh: 'folded_mountain_belt',
    texInfluence: 0.35,
    triplanarScale: 2.5,
  },
  'earth-like': {
    texLow:  'sedimentary_layer_terrain',
    texMid:  'continental_craton_terrain',
    texHigh: 'folded_mountain_belt',
    texInfluence: 0.32,
    triplanarScale: 2.5,
  },

  // ═══ Ice worlds ═══════════════════════════════════════
  'ice-dwarf': {
    texLow:  'base_ice_sheet',
    texMid:  'glacial_ice_sheet',
    texHigh: 'polar_ice_cap_terrain',
    texInfluence: 0.42,
    triplanarScale: 3.0,
  },
  'ice-giant': {
    texLow:  'base_ice_nitrogen',
    texMid:  'blue_ice_plains',
    texHigh: 'crevasse_ice_field',
    texInfluence: 0.38,
    triplanarScale: 2.5,
  },

  // ═══ Moons ════════════════════════════════════════════
  'moon-rocky': {
    texLow:  'basaltic_cratered_moon',
    texMid:  'base_rocky_barren',
    texHigh: 'ancient_lunar_highlands',
    texInfluence: 0.45,
    triplanarScale: 3.5,
  },
  'moon-volcanic': {
    texLow:  'io_sulfur_volcanic_plains',
    texMid:  'sulfur_vent_fields',
    texHigh: 'volcanic_shield_plains',
    texInfluence: 0.48,
    triplanarScale: 3.0,
  },
  'moon-ice-shell': {
    texLow:  'subglacial_ocean_ice_shell',
    texMid:  'surface_europan',
    texHigh: 'europa_chaos_terrain',
    texInfluence: 0.45,
    triplanarScale: 3.0,
  },
  'moon-ocean': {
    texLow:  'subglacial_ocean_ice_shell',
    texMid:  'enceladus_tiger_stripes',
    texHigh: 'cryovolcanic_ice_moon',
    texInfluence: 0.42,
    triplanarScale: 3.0,
  },
  'moon-nitrogen-ice': {
    texLow:  'nitrogen_ice_glacier',
    texMid:  'base_ice_nitrogen',
    texHigh: 'fractured_ice_shelf',
    texInfluence: 0.42,
    triplanarScale: 3.0,
  },
  'moon-co2-frost': {
    texLow:  'polar_ice_cap_terrain',
    texMid:  'base_ice_sheet',
    texHigh: 'crevasse_ice_field',
    texInfluence: 0.40,
    triplanarScale: 3.0,
  },
  'moon-ammonia-slush': {
    texLow:  'ammonia_ice_plains',
    texMid:  'base_ice_ammonia',
    texHigh: 'fractured_ice_shelf',
    texInfluence: 0.42,
    triplanarScale: 3.0,
  },
  'moon-carbon-soot': {
    texLow:  'tar_sand_plains',
    texMid:  'base_hydrocarbon_dark',
    texHigh: 'base_rocky_barren',
    texInfluence: 0.40,
    triplanarScale: 3.2,
  },
  'moon-magma-ocean': {
    texLow:  'lava_world_magma_crust',
    texMid:  'basalt_lava_plains',
    texHigh: 'base_lava_cooled',
    texInfluence: 0.48,
    triplanarScale: 3.0,
  },
  'moon-sulfur': {
    texLow:  'io_sulfur_volcanic_plains',
    texMid:  'sulfur_vent_fields',
    texHigh: 'base_desert_oxide',
    texInfluence: 0.45,
    triplanarScale: 3.0,
  },
  'moon-silicate-frost': {
    texLow:  'base_ice_sheet',
    texMid:  'surface_europan',
    texHigh: 'ancient_lunar_highlands',
    texInfluence: 0.40,
    triplanarScale: 3.0,
  },
  'moon-thin-atm': {
    texLow:  'base_desert_oxide',
    texMid:  'eroded_highlands',
    texHigh: 'crater_ejecta_blanket',
    texInfluence: 0.42,
    triplanarScale: 3.0,
  },
  'moon-shepherd': {
    texLow:  'base_rocky_barren',
    texMid:  'basaltic_cratered_moon',
    texHigh: 'base_ice_sheet',
    texInfluence: 0.40,
    triplanarScale: 3.5,
  },
  'moon-binary': {
    texLow:  'base_ice_nitrogen',
    texMid:  'glacial_ice_sheet',
    texHigh: 'polar_ice_cap_terrain',
    texInfluence: 0.40,
    triplanarScale: 3.0,
  },
  'moon-sulfate': {
    texLow:  'base_rocky_barren',
    texMid:  'base_desert_salt',
    texHigh: 'salt_flat_planet',
    texInfluence: 0.42,
    triplanarScale: 3.0,
  },
  'moon-hydrocarbon': {
    texLow:  'hydrocarbon_lake_shore',
    texMid:  'titan_hydrocarbon_dunes',
    texHigh: 'methane_hydrocarbon_shores',
    texInfluence: 0.45,
    triplanarScale: 2.8,
  },

  // ═══ Special ══════════════════════════════════════════
  'eyeball-world': {
    texLow:  'base_ice_sheet',
    texMid:  'continental_craton_terrain',
    texHigh: 'glacial_ice_sheet',
    texInfluence: 0.35,
    triplanarScale: 2.5,
  },
  'chthonian': {
    texLow:  'base_lava_cooled',
    texMid:  'base_rocky_iron',
    texHigh: 'glassified_impact_terrain',
    texInfluence: 0.38,
    triplanarScale: 3.0,
  },
  'hycean': {
    texLow:  'deep_ocean_abyssal_plain',
    texMid:  'base_ocean_deep',
    texHigh: 'base_ocean_shallow',
    texInfluence: 0.35,
    triplanarScale: 2.5,
  },
};

/** Default fallback triplet for unknown world types */
const DEFAULT_TRIPLET: TextureTriplet = {
  texLow:  'basaltic_cratered_moon',
  texMid:  'base_rocky_barren',
  texHigh: 'ancient_lunar_highlands',
  texInfluence: 0.35,
  triplanarScale: 3.0,
};

/**
 * Get the texture triplet for a world type.
 * Returns textures to use as color/detail references for procedural rendering.
 */
export function getTextureTriplet(planetType: string): TextureTriplet {
  return TRIPLETS[planetType] ?? DEFAULT_TRIPLET;
}

/** Check if a world type has a defined texture triplet */
export function hasTextureTriplet(planetType: string): boolean {
  return planetType in TRIPLETS;
}

/** Gas giant types — these don't use texture triplets */
export const GAS_TYPES = new Set([
  'gas-giant', 'hot-jupiter', 'warm-neptune', 'cold-neptune',
  'mini-neptune', 'super-neptune', 'ice-giant',
]);
