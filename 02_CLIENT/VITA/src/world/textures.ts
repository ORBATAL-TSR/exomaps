/**
 * textures.ts — Canonical texture palette for world rendering.
 *
 * Maps world types to reference textures used as color/detail sources
 * for procedural world rendering. The canonical version of data/texturePalette.ts.
 * (The original data/texturePalette.ts is preserved unchanged.)
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

/**
 * Zone texture set — 5 textures covering the geological archetype space:
 *   z0: smooth low elevation  (mare / basin / ocean floor)
 *   z1: rough low elevation   (volcanic / fractured / dark rough)
 *   z2: mid elevation/rough   (plains / sedimentary / transitional)
 *   z3: smooth high elevation (highland / craton / ancient stable)
 *   z4: rough high elevation  (mountain belt / active young terrain)
 */
export interface ZoneTexSet {
  z0: string; z1: string; z2: string; z3: string; z4: string;
  scale: number;
}

const TEX_PATH = '/textures/planets/';

/** Get texture URL for a given ID and optional suffix */
export function texUrl(id: string, suffix = ''): string {
  return `${TEX_PATH}${id}${suffix}.png`;
}

/** Gas giant types — these don't use texture triplets */
export const GAS_TYPES = new Set([
  'gas-giant', 'hot-jupiter', 'warm-neptune', 'cold-neptune',
  'mini-neptune', 'super-neptune', 'ice-giant',
]);

// ── World type → texture triplet mapping ────────────────────────────────────
export const WORLD_TRIPLETS: Record<string, TextureTriplet> = {

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
    texLow:  'surface_europan',
    texMid:  'europa_chaos_terrain',
    texHigh: 'subglacial_ocean_ice_shell',
    texInfluence: 0.45,
    triplanarScale: 3.0,
  },
  'moon-ocean': {
    texLow:  'cryovolcanic_ice_moon',
    texMid:  'enceladus_tiger_stripes',
    texHigh: 'fractured_ice_shelf',
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

  // ═══ Additional moon types ════════════════════════════
  'moon-cratered': {
    texLow:  'basaltic_cratered_moon',
    texMid:  'crater_ejecta_blanket',
    texHigh: 'ancient_lunar_highlands',
    texInfluence: 0.45,
    triplanarScale: 3.5,
  },
  'moon-iron-rich': {
    texLow:  'base_rocky_iron',
    texMid:  'shock_fractured_rock',
    texHigh: 'glassified_impact_terrain',
    texInfluence: 0.42,
    triplanarScale: 3.0,
  },
  'moon-olivine': {
    texLow:  'base_rocky_ancient',
    texMid:  'base_rocky_volcanic',
    texHigh: 'continental_craton_terrain',
    texInfluence: 0.40,
    triplanarScale: 3.0,
  },
  'moon-basalt': {
    texLow:  'basalt_lava_plains',
    texMid:  'basaltic_cratered_moon',
    texHigh: 'base_lava_cooled',
    texInfluence: 0.45,
    triplanarScale: 3.0,
  },
  'moon-regolith': {
    texLow:  'base_rocky_barren',
    texMid:  'basaltic_cratered_moon',
    texHigh: 'crater_ejecta_blanket',
    texInfluence: 0.42,
    triplanarScale: 3.5,
  },
  'moon-captured': {
    texLow:  'tar_sand_plains',
    texMid:  'base_hydrocarbon_dark',
    texHigh: 'base_rocky_barren',
    texInfluence: 0.40,
    triplanarScale: 3.2,
  },
  'moon-tholin': {
    texLow:  'tar_sand_plains',
    texMid:  'base_hydrocarbon_dark',
    texHigh: 'base_desert_oxide',
    texInfluence: 0.42,
    triplanarScale: 3.0,
  },
  'moon-atmosphere': {
    texLow:  'titan_hydrocarbon_dunes',
    texMid:  'methane_hydrocarbon_shores',
    texHigh: 'hydrocarbon_lake_shore',
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
export const DEFAULT_TRIPLET: TextureTriplet = {
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
export function getTextureTriplet(worldType: string): TextureTriplet {
  return WORLD_TRIPLETS[worldType] ?? DEFAULT_TRIPLET;
}

// ── Zone texture sets ────────────────────────────────────────────────────────
export const ZONE_TEX_SETS: Record<string, ZoneTexSet> = {
  // Rocky / airless
  'rocky':       { z0:'base_rocky_ancient',      z1:'base_rocky_volcanic',      z2:'continental_craton_terrain', z3:'ancient_shield_terrain',   z4:'eroded_highlands',          scale:3.2 },
  'super-earth': { z0:'base_rocky_ancient',      z1:'eroded_canyon_network',    z2:'continental_craton_terrain', z3:'ancient_shield_terrain',   z4:'folded_mountain_belt',      scale:2.5 },
  'sub-earth':   { z0:'basaltic_cratered_moon',  z1:'base_rocky_barren',        z2:'crater_ejecta_blanket',      z3:'ancient_lunar_highlands',  z4:'mercury_hollow_terrain',    scale:3.5 },
  'iron-planet': { z0:'base_rocky_iron',         z1:'shock_fractured_rock',     z2:'glassified_impact_terrain',  z3:'base_rocky_ancient',       z4:'eroded_highlands',          scale:3.0 },
  'chthonian':   { z0:'base_lava_cooled',        z1:'base_rocky_iron',          z2:'glassified_impact_terrain',  z3:'ancient_shield_terrain',   z4:'eroded_highlands',          scale:3.0 },

  // Desert / arid
  'desert':       { z0:'dry_lakebed_terrain',    z1:'eroded_canyon_network',    z2:'base_desert_sand',           z3:'rocky_desert_plateau',     z4:'wind_carved_yardangs',      scale:2.8 },
  'desert-world': { z0:'evaporite_basin',        z1:'base_desert_oxide',        z2:'desert_dune_planet',         z3:'base_desert_salt',         z4:'wind_carved_yardangs',      scale:2.5 },
  'carbon-planet':{ z0:'tar_sand_plains',        z1:'base_hydrocarbon_dark',    z2:'base_rocky_barren',          z3:'granite_plateau_surface',  z4:'eroded_highlands',          scale:3.0 },

  // Lava / volcanic
  'lava-world':   { z0:'lava_world_magma_crust', z1:'base_lava_crust',          z2:'basalt_lava_plains',         z3:'cooling_lava_crust',       z4:'ash_covered_lava_plateau',  scale:3.5 },
  'lava-ocean':   { z0:'ropy_pahoehoe_lava',     z1:'basalt_lava_plains',       z2:'base_lava_cooled',           z3:'ash_covered_lava_plateau', z4:'andesite_volcano_field',    scale:3.0 },
  'volcanic':     { z0:'volcanic_ash_basin',     z1:'base_rocky_volcanic',      z2:'basalt_lava_plains',         z3:'andesite_volcano_field',   z4:'subduction_arc_volcano_terrain', scale:3.0 },

  // Ocean / water
  'ocean-world':  { z0:'base_ocean_deep',        z1:'basalt_seafloor_ridge',    z2:'deep_ocean_abyssal_plain',   z3:'base_ocean_shallow',       z4:'coral_reef_shelf',          scale:2.5 },
  'water-world':  { z0:'deep_ocean_abyssal_plain',z1:'basalt_seafloor_ridge',   z2:'ocean_world_shallow_shelf',  z3:'coral_reef_shelf',         z4:'island_arc_volcanics',      scale:2.5 },
  'hycean':       { z0:'deep_ocean_abyssal_plain',z1:'base_ocean_deep',         z2:'base_ocean_shallow',         z3:'coral_reef_shelf',         z4:'island_arc_volcanics',      scale:2.5 },

  // Ice
  'ice-dwarf':    { z0:'base_ice_sheet',         z1:'crevasse_ice_field',       z2:'glacial_ice_sheet',          z3:'polar_ice_cap_terrain',    z4:'fractured_ice_shelf',       scale:3.0 },

  // Habitable / temperate
  'temperate':    { z0:'sedimentary_layer_terrain',z1:'eroded_canyon_network',  z2:'continental_craton_terrain', z3:'ancient_shield_terrain',   z4:'folded_mountain_belt',      scale:2.5 },
  'earth-like':   { z0:'sedimentary_layer_terrain',z1:'eroded_canyon_network',  z2:'continental_craton_terrain', z3:'granite_plateau_surface',  z4:'folded_mountain_belt',      scale:2.5 },
  'eyeball-world':{ z0:'base_ice_sheet',         z1:'fractured_ice_shelf',      z2:'continental_craton_terrain', z3:'ancient_shield_terrain',   z4:'glacial_ice_sheet',         scale:2.5 },

  // Moons
  'moon-rocky':   { z0:'basaltic_cratered_moon', z1:'base_rocky_barren',        z2:'crater_ejecta_blanket',      z3:'ancient_lunar_highlands',  z4:'mercury_hollow_terrain',    scale:3.5 },
  'moon-volcanic':{ z0:'io_sulfur_volcanic_plains',z1:'sulfur_vent_fields',     z2:'volcanic_shield_plains',     z3:'andesite_volcano_field',   z4:'subduction_arc_volcano_terrain', scale:3.0 },
  'moon-ice-shell':{ z0:'surface_europan',           z1:'europa_chaos_terrain',  z2:'subglacial_ocean_ice_shell', z3:'fractured_ice_shelf',      z4:'crevasse_ice_field',        scale:3.0 },
  'moon-ocean':   { z0:'cryovolcanic_ice_moon',     z1:'enceladus_tiger_stripes',z2:'subglacial_ocean_ice_shell', z3:'fractured_ice_shelf',      z4:'crevasse_ice_field',        scale:3.0 },
  'moon-nitrogen-ice':{ z0:'nitrogen_ice_glacier',z1:'fractured_ice_shelf',    z2:'base_ice_nitrogen',          z3:'blue_ice_plains',          z4:'crevasse_ice_field',        scale:3.0 },
  'moon-co2-frost':{ z0:'polar_ice_cap_terrain', z1:'crevasse_ice_field',       z2:'base_ice_sheet',             z3:'glacial_ice_sheet',        z4:'fractured_ice_shelf',       scale:3.0 },
  'moon-ammonia-slush':{ z0:'ammonia_ice_plains',z1:'fractured_ice_shelf',      z2:'base_ice_ammonia',           z3:'base_ice_sheet',           z4:'crevasse_ice_field',        scale:3.0 },
  'moon-carbon-soot':{ z0:'tar_sand_plains',     z1:'base_hydrocarbon_dark',    z2:'base_rocky_barren',          z3:'base_rocky_ancient',       z4:'eroded_highlands',          scale:3.2 },
  'moon-magma-ocean':{ z0:'lava_world_magma_crust',z1:'basalt_lava_plains',     z2:'base_lava_cooled',           z3:'ash_covered_lava_plateau', z4:'cooling_lava_crust',        scale:3.0 },
  'moon-sulfur':  { z0:'io_sulfur_volcanic_plains',z1:'sulfur_vent_fields',     z2:'base_desert_oxide',          z3:'volcanic_shield_plains',   z4:'andesite_volcano_field',    scale:3.0 },
  'moon-silicate-frost':{ z0:'base_ice_sheet',   z1:'surface_europan',          z2:'ancient_lunar_highlands',    z3:'polar_ice_cap_terrain',    z4:'fractured_ice_shelf',       scale:3.0 },
  'moon-thin-atm':{ z0:'base_desert_oxide',      z1:'crater_ejecta_blanket',    z2:'eroded_highlands',           z3:'ancient_lunar_highlands',  z4:'mercury_hollow_terrain',    scale:3.0 },
  'moon-shepherd':{ z0:'base_rocky_barren',      z1:'basaltic_cratered_moon',   z2:'crater_ejecta_blanket',      z3:'ancient_lunar_highlands',  z4:'base_ice_sheet',            scale:3.5 },
  'moon-binary':  { z0:'base_ice_nitrogen',      z1:'crevasse_ice_field',       z2:'glacial_ice_sheet',          z3:'polar_ice_cap_terrain',    z4:'fractured_ice_shelf',       scale:3.0 },
  'moon-sulfate': { z0:'base_desert_salt',       z1:'evaporite_basin',          z2:'base_rocky_barren',          z3:'salt_flat_planet',         z4:'base_rocky_ancient',        scale:3.0 },
  'moon-hydrocarbon':{ z0:'hydrocarbon_lake_shore',z1:'titan_hydrocarbon_dunes',z2:'methane_hydrocarbon_shores', z3:'base_hydrocarbon_dark',    z4:'tar_sand_plains',           scale:2.8 },

  // Moon types used by pickMoonProfile — previously fell through to DEFAULT_ZONE_SET
  'moon-cratered':   { z0:'basaltic_cratered_moon', z1:'base_rocky_barren',        z2:'crater_ejecta_blanket',      z3:'ancient_lunar_highlands',  z4:'mercury_hollow_terrain',    scale:3.5 },
  'moon-iron-rich':  { z0:'base_rocky_iron',        z1:'shock_fractured_rock',      z2:'glassified_impact_terrain',  z3:'base_rocky_ancient',       z4:'eroded_highlands',          scale:3.0 },
  'moon-olivine':    { z0:'base_rocky_ancient',     z1:'base_rocky_volcanic',       z2:'continental_craton_terrain', z3:'ancient_shield_terrain',   z4:'eroded_highlands',          scale:3.0 },
  'moon-basalt':     { z0:'basalt_lava_plains',     z1:'base_rocky_volcanic',       z2:'basaltic_cratered_moon',     z3:'base_lava_cooled',         z4:'andesite_volcano_field',    scale:3.0 },
  'moon-regolith':   { z0:'base_rocky_barren',      z1:'crater_ejecta_blanket',     z2:'basaltic_cratered_moon',     z3:'ancient_lunar_highlands',  z4:'mesa_plateau_fields',       scale:3.5 },
  'moon-captured':   { z0:'tar_sand_plains',        z1:'base_hydrocarbon_dark',     z2:'base_rocky_barren',          z3:'base_rocky_ancient',       z4:'eroded_highlands',          scale:3.2 },
  'moon-tholin':     { z0:'tar_sand_plains',        z1:'base_hydrocarbon_dark',     z2:'base_desert_oxide',          z3:'base_rocky_barren',        z4:'eroded_highlands',          scale:3.0 },
  'moon-atmosphere': { z0:'titan_hydrocarbon_dunes',z1:'methane_hydrocarbon_shores',z2:'hydrocarbon_lake_shore',     z3:'base_hydrocarbon_dark',    z4:'tar_sand_plains',           scale:2.8 },
};

export const DEFAULT_ZONE_SET: ZoneTexSet = {
  z0: 'base_rocky_ancient', z1: 'base_rocky_volcanic', z2: 'continental_craton_terrain',
  z3: 'ancient_shield_terrain', z4: 'eroded_highlands', scale: 3.0,
};

/** Get the 5-texture zone splat set for this world type. */
export function getZoneTextures(worldType: string): ZoneTexSet {
  return ZONE_TEX_SETS[worldType] ?? DEFAULT_ZONE_SET;
}
