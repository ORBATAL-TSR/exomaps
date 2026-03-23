/**
 * profiles.ts — Visual profiles for all world types.
 *
 * DATA ONLY — no functions.
 * All hand-tuned profiles from real-world science/imagery references.
 */

import type { WorldVisuals } from './types';

export const WORLD_VISUALS: Record<string, WorldVisuals> = {
  // ══════════════════════════════════════════════════════
  //  SOLID PLANET TYPES — colors from real-world science
  // ══════════════════════════════════════════════════════

  'earth-like': { // Earth — terrain with star-dependent vegetation overlay
    color1: [0.42, 0.34, 0.18],    // bare terrain (rock/soil — foliage added by shader)
    color2: [0.46, 0.34, 0.14],    // warm brown soil/sediment
    color3: [0.74, 0.70, 0.60],    // exposed granite/snow-line
    oceanColor: [0.01, 0.05, 0.26], oceanLevel: 0.68,
    atmColor: [0.28, 0.48, 0.94], atmThickness: 0.6,
    emissive: 0, iceCaps: 0.7, clouds: 0.35, noiseScale: 3.0,
    mountainHeight: 0.24, valleyDepth: 0.10,
    auroraStrength: 0.18,
    hazeColor: [0.55, 0.72, 0.95], hazeHeight: 0.25,
  },

  'rocky': { // ★ MERCURY — dark basalt grey, bright crater ejecta, subtle tan
    color1: [0.26, 0.24, 0.22],    // dark basalt (Mercury MESSENGER imagery)
    color2: [0.44, 0.42, 0.37],    // medium grey highlands
    color3: [0.64, 0.60, 0.52],    // bright ejecta rays
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.40, 0.30, 0.22], atmThickness: 0.05,
    emissive: 0, iceCaps: 0, clouds: 0, noiseScale: 4.5,
    craterDensity: 0.48,           // heavily cratered — ancient primordial surface
    mountainHeight: 0.25, valleyDepth: 0.12,
    terrainAge: 0.92,              // 4.4 Gyr — nearly primordial
    thermalGlow: 0.08,             // subtle day/night temperature contrast (430K/100K)
  },

  'venus': { // ★ VENUS — dense sulfuric acid clouds, orange-tan surface, extreme greenhouse
    color1: [0.72, 0.52, 0.22],    // hot basalt plains (Magellan radar tones)
    color2: [0.58, 0.38, 0.14],    // dark volcanic highlands (Ishtar Terra)
    color3: [0.84, 0.60, 0.26],    // bright tesserae terrain
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.92, 0.76, 0.38],  // thick sulfuric acid haze — yellow-orange
    atmThickness: 0.95,             // extremely thick atmosphere (92 bar!)
    emissive: 0.12, iceCaps: 0, clouds: 0.85, noiseScale: 2.8,
    mountainHeight: 0.28, valleyDepth: 0.18, volcanism: 0.35,
    hazeColor: [0.82, 0.68, 0.28], hazeHeight: 0.85,
    thermalGlow: 0.65,
  },

  'super-earth': { // Larger Earth — deeper oceans, thick clouds, scattered islands
    color1: [0.38, 0.30, 0.16],    // exposed laterite terrain (foliage added by shader)
    color2: [0.44, 0.36, 0.16],    // rich laterite soil
    color3: [0.62, 0.58, 0.46],    // limestone cliffs
    oceanColor: [0.01, 0.06, 0.30], oceanLevel: 0.80,
    atmColor: [0.30, 0.52, 0.90], atmThickness: 0.65,
    emissive: 0, iceCaps: 0.5, clouds: 0.30, noiseScale: 2.8,
    mountainHeight: 0.20, valleyDepth: 0.08,
  },

  'sub-earth': { // Ultramafic dwarf — olivine-rich, smoother than Mercury, pitted
    color1: [0.42, 0.38, 0.28],    // warm olivine-tan (ultramafic mantle exposure)
    color2: [0.56, 0.50, 0.36],    // lighter feldspar highlands
    color3: [0.68, 0.62, 0.48],    // pale ejecta blankets
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.32, 0.27, 0.20], atmThickness: 0.01,
    emissive: 0, iceCaps: 0, clouds: 0, noiseScale: 5.2,
    craterDensity: 0.38,           // battered but less so than Mercury (less mass = fewer impactors)
    mountainHeight: 0.12, valleyDepth: 0.06,
    terrainAge: 0.88,
  },

  'desert-world': { // ★ MARS — rust-red Fe₂O₃, dark basalt, shield volcanoes, polar CO₂ caps
    color1: [0.78, 0.34, 0.10],    // Mars rust-red (iron oxide)
    color2: [0.50, 0.20, 0.06],    // dark basalt (Syrtis Major)
    color3: [0.92, 0.64, 0.28],    // bright ochre dust (Arabia Terra)
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.80, 0.54, 0.30],  // salmon-pink Martian sky
    atmThickness: 0.22,
    emissive: 0, iceCaps: 0.42, clouds: 0.05, noiseScale: 3.5,
    craterDensity: 0.28,           // Hellas, Argyre, etc. — moderately cratered
    mountainHeight: 0.30, valleyDepth: 0.24,
    volcanism: 0.38,               // Tharsis plateau + Olympus Mons shield system
    terrainAge: 0.72,
    hazeColor: [0.82, 0.56, 0.28], hazeHeight: 0.22, // dust-storm haze layer
  },

  'ocean-world': { // Deep global ocean — rare volcanic peaks barely breach surface
    color1: [0.12, 0.18, 0.14],    // rare volcanic seamount
    color2: [0.08, 0.14, 0.12],    // dark basalt
    color3: [0.16, 0.22, 0.18],    // wave-washed reef
    oceanColor: [0.01, 0.06, 0.32], oceanLevel: 0.92,
    atmColor: [0.50, 0.72, 0.96], atmThickness: 0.55, // sky haze — distinct from deep ocean blue
    emissive: 0, iceCaps: 0.25, clouds: 0.50, noiseScale: 2.5,
    auroraStrength: 0.22,
    hazeColor: [0.50, 0.75, 0.98], hazeHeight: 0.30,
  },

  'lava-world': { // ★ 55 CANCRI e — charred crust over glowing magma ocean, silicate 'snow'
    color1: [0.06, 0.03, 0.02],    // charred obsidian crust
    color2: [0.20, 0.07, 0.02],    // dark solidified basalt flows
    color3: [0.96, 0.44, 0.08],    // incandescent fresh lava — glowing orange-yellow
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.78, 0.30, 0.06],  // volcanic SO₂ / SiO haze
    atmThickness: 0.32,
    emissive: 0.95, iceCaps: 0, clouds: 0, noiseScale: 3.0,
    volcanism: 0.88,               // virtually the entire surface is volcanically active
    mountainHeight: 0.18,          // lava dome pressure ridges
    valleyDepth: 0.22,             // collapsed lava tubes and rifts
    thermalGlow: 0.78,             // strong dayside/terminator incandescence
    hazeColor: [0.70, 0.24, 0.04], hazeHeight: 0.50, // thick volcanic aerosol column
  },

  'iron-planet': { // Exposed metallic core — burnished steel, blue-grey shimmer, specular glint
    color1: [0.60, 0.56, 0.52],    // burnished nickel-iron
    color2: [0.36, 0.34, 0.42],    // blue-grey metal alloy
    color3: [0.75, 0.72, 0.66],    // polished specular face
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.36, 0.34, 0.44], atmThickness: 0.04, // mineral vapor exosphere
    emissive: 0, iceCaps: 0, clouds: 0, noiseScale: 5.5,
    metallic: 0.45,                // strong specular — iron reflects well
    craterDensity: 0.35,           // Mercury-like: battered from mantle-stripping collision
    mountainHeight: 0.28, valleyDepth: 0.16,
    hazeColor: [0.40, 0.38, 0.50], hazeHeight: 0.05, // faint Fe vapor exosphere glow
  },

  'carbon-planet': { // Diamond world — near-black with iridescent purple shimmer
    color1: [0.05, 0.03, 0.08],    // ultra-dark purple-black
    color2: [0.12, 0.06, 0.18],    // deep amethyst
    color3: [0.22, 0.14, 0.30],    // bright graphite with violet shimmer
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.28, 0.16, 0.36], atmThickness: 0.15,
    emissive: 0, iceCaps: 0, clouds: 0, noiseScale: 6.0,
    craterDensity: 0.16, mountainHeight: 0.20,
  },

  'hycean': { // H₂-rich ocean world — deep teal ocean, purple-blue haze, exotic sky
    color1: [0.04, 0.22, 0.16],    // dark teal volcanic island
    color2: [0.08, 0.32, 0.24],    // aquamarine coast
    color3: [0.14, 0.30, 0.22],    // bright lagoon fringe
    oceanColor: [0.01, 0.07, 0.22], oceanLevel: 0.88, // deep dark alien ocean
    atmColor: [0.38, 0.40, 0.76],  // purple-blue H₂ photochemical haze
    atmThickness: 0.78,            // thick H₂ envelope, high-altitude haze layers
    emissive: 0, iceCaps: 0.08, clouds: 0.55, noiseScale: 2.5,
    cloudRegime: 2,                // high-altitude water/H₂S cloud deck
    hazeColor: [0.28, 0.38, 0.78], hazeHeight: 0.58, // deep violet H₂ photochemical stratosphere
    auroraStrength: 0.14,
  },

  'eyeball-world': { // Tidally locked — habitable green ring, frozen everywhere else
    color1: [0.10, 0.38, 0.14],    // vivid habitable ring (dense vegetation analog)
    color2: [0.85, 0.88, 0.94],    // sharp ice boundary (dramatic contrast at ring edge)
    color3: [0.95, 0.96, 0.99],    // dazzling polar ice
    oceanColor: [0.02, 0.10, 0.28], oceanLevel: 0.38,
    atmColor: [0.32, 0.50, 0.76], atmThickness: 0.45,
    emissive: 0, iceCaps: 0, clouds: 0.25, noiseScale: 3.0,
    hazeColor: [0.30, 0.50, 0.80], hazeHeight: 0.30, // day-side terminator haze wall
    auroraStrength: 0.20,          // significant aurora on night side (M-dwarf field compression)
  },

  'ocean-eyeball': { // Tidally locked ocean world — star side: boiling sea + hurricane
    // Night side: frozen ocean (thick ice shelf). Day side: open deep ocean.
    // Terminator: thick cloud wall, fog bank, storm systems.
    color1: [0.04, 0.10, 0.18],    // frozen night-side rock/ice
    color2: [0.06, 0.18, 0.30],    // dark ocean floor
    color3: [0.12, 0.26, 0.40],    // ocean wave crest
    oceanColor: [0.01, 0.05, 0.24], oceanLevel: 0.72,
    atmColor: [0.22, 0.44, 0.88],  // deep blue thick atmosphere
    atmThickness: 0.60,
    emissive: 0, iceCaps: 0.55, clouds: 0.70, noiseScale: 2.2,
    mountainHeight: 0.05, valleyDepth: 0.08,
  },

  'ice-dwarf': { // ★ PLUTO — N₂ ice plains, tholin basins, water-ice mountains
    color1: [0.92, 0.88, 0.82],    // bright N₂ ice (Sputnik Planitia heart)
    color2: [0.52, 0.26, 0.10],    // dark tholin red-brown (Cthulhu Macula)
    color3: [0.76, 0.70, 0.62],    // water-ice mountain ridges (Wright/Hillary Mons)
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.44, 0.52, 0.82],  // pale blue multi-layer haze (New Horizons)
    atmThickness: 0.04,
    emissive: 0, iceCaps: 0.88, clouds: 0, noiseScale: 4.2,
    craterDensity: 0.14, crackIntensity: 0.28,
    mountainHeight: 0.26, valleyDepth: 0.18,
    terrainAge: 0.70, isIce: false,
    hazeColor: [0.40, 0.50, 0.82], hazeHeight: 0.45,
  },

  'kbo-bright': { // ★ ERIS/DYSNOMIA — ultra-high albedo methane frost, near-white
    color1: [0.96, 0.94, 0.90],    // brilliant methane frost (albedo ~0.96)
    color2: [0.80, 0.78, 0.74],    // grey-white mid-latitude ice
    color3: [0.88, 0.86, 0.80],    // compacted water ice highlands
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.60, 0.66, 0.88],  // CH₄/N₂ photochemical haze
    atmThickness: 0.02,
    emissive: 0, iceCaps: 0.95, clouds: 0, noiseScale: 5.2,
    craterDensity: 0.10, mountainHeight: 0.18, valleyDepth: 0.10,
    terrainAge: 0.65, isIce: true,
    metallic: 0.12,                // N₂ ice plains specular glint
    hazeColor: [0.55, 0.65, 0.90], hazeHeight: 0.30,
  },

  'kbo-tholin': { // ★ SEDNA/QUAOAR — deep organic tholins, one of the reddest bodies
    color1: [0.60, 0.20, 0.06],    // deep rust-red tholin plains
    color2: [0.40, 0.12, 0.03],    // dark red-brown ancient terrain
    color3: [0.82, 0.38, 0.10],    // bright orange-red CH₄ sublimation exposures
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.58, 0.42, 0.72],  // faint CH₄ sublimation haze
    atmThickness: 0.01,
    emissive: 0, iceCaps: 0.18, clouds: 0, noiseScale: 4.4,
    craterDensity: 0.45,           // ancient heavily-battered surface (4+ Gyr)
    mountainHeight: 0.22, valleyDepth: 0.14,
    terrainAge: 0.97, isIce: false, // near-primordial surface
  },

  'kbo-mixed': { // ★ MAKEMAKE — patchy N₂+CH₄ ice, dark tholin basins, moderate albedo
    color1: [0.78, 0.72, 0.64],    // patchy pale ice plains (avg albedo ~0.77)
    color2: [0.50, 0.28, 0.12],    // dark tholin basins
    color3: [0.92, 0.88, 0.80],    // bright fresh CH₄ ice deposits
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.48, 0.54, 0.78],  // very thin N₂ haze
    atmThickness: 0.015,
    emissive: 0, iceCaps: 0.62, clouds: 0, noiseScale: 4.6,
    craterDensity: 0.18, crackIntensity: 0.20, mountainHeight: 0.20, valleyDepth: 0.12,
    terrainAge: 0.78,
  },

  'kbo-contact': { // ★ ARROKOTH — contact binary bilobed KBO, very red cold classical
    color1: [0.66, 0.42, 0.22],    // warm brownish-red tholins (extremely cold)
    color2: [0.52, 0.30, 0.14],    // darker tholin mid-tones
    color3: [0.80, 0.56, 0.28],    // bright hillside ice exposures
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.44, 0.40, 0.54],  // virtually no atmosphere
    atmThickness: 0.0,
    emissive: 0, iceCaps: 0.12, clouds: 0, noiseScale: 4.8,
    craterDensity: 0.35, mountainHeight: 0.14, valleyDepth: 0.08,
    terrainAge: 0.95, isIce: false,
  },

  'chthonian': { // Stripped gas giant core — dark hot metallic, residual glow
    color1: [0.16, 0.10, 0.06],    // dark metal
    color2: [0.40, 0.24, 0.12],    // warm bronze
    color3: [0.22, 0.14, 0.08],    // dark variation
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.40, 0.24, 0.10], atmThickness: 0.10,
    emissive: 0.22, iceCaps: 0, clouds: 0, noiseScale: 4.5,
    volcanism: 0.28, mountainHeight: 0.18,
  },

  // ══════════════════════════════════════════════════════
  //  GAS GIANT TYPES
  // ══════════════════════════════════════════════════════

  'gas-giant': { // ★ JUPITER — vivid ochre-cream zones, deep brown belts, Great Red Spot
    color1: [0.90, 0.70, 0.32],    // bright cream-ochre zone (NH₃ clouds)
    color2: [0.46, 0.24, 0.06],    // deep brown belt (deeper cloud deck)
    color3: [0.96, 0.40, 0.12],    // vivid Great Red Spot
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.78, 0.58, 0.32], atmThickness: 0.85,
    emissive: 0, iceCaps: 0, clouds: 0, noiseScale: 2.0,
    hasRings: true, ringInner: 1.30, ringOuter: 2.25,
    auroraStrength: 0.35, auroraColor: [0.38, 0.12, 0.82],
    hazeColor: [0.75, 0.82, 0.95], hazeHeight: 0.40,
    cloudRegime: 0.0,
    stormLat: 0.35, stormLon: 1.2, stormSize: 0.55, stormIntensity: 0.85,
  },

  'super-jupiter': { // Deeper ochres — compressed, intense bands, high contrast
    color1: [0.70, 0.44, 0.16],    // intense ochre zone
    color2: [0.28, 0.12, 0.04],    // very dark belt (ultra-deep)
    color3: [0.88, 0.28, 0.06],    // deep crimson storm
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.62, 0.40, 0.20], atmThickness: 0.90,
    emissive: 0, iceCaps: 0, clouds: 0, noiseScale: 2.0,
    hasRings: true, ringInner: 1.25, ringOuter: 2.10,
    auroraStrength: 0.40, auroraColor: [0.28, 0.08, 0.88],
    hazeColor: [0.65, 0.72, 0.88], hazeHeight: 0.35,
    cloudRegime: 0.0,
    stormLat: -0.28, stormLon: 0.7, stormSize: 0.45, stormIntensity: 0.70,
  },

  'hot-jupiter': { // ★ Scorched — incandescent dayside, iron cloud nightside, violent jets
    color1: [1.0, 0.62, 0.12],     // incandescent orange dayside cloud tops
    color2: [0.82, 0.24, 0.04],    // deep blood-red FeS belt
    color3: [1.0, 0.82, 0.30],     // white-hot substellar zone
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.94, 0.50, 0.10], atmThickness: 0.95,
    emissive: 0.45, iceCaps: 0, clouds: 0, noiseScale: 1.5,
    thermalGlow: 0.80,
    nightCloudFraction: 0.72,      // iron/silicate clouds condense on cold nightside
    auroraStrength: 0.50, auroraColor: [0.85, 0.20, 0.95], // intense magnetic aurora (stellar wind)
    hazeColor: [0.88, 0.45, 0.12], hazeHeight: 0.42,       // silicate particle stratospheric haze
  },

  'neptune-like': { // ★ NEPTUNE — vivid electric blue, dark methane, bright cirrus
    color1: [0.06, 0.32, 0.90],    // electric azure (methane absorption)
    color2: [0.02, 0.16, 0.55],    // deep navy-indigo band
    color3: [0.55, 0.78, 0.98],    // bright white-blue cirrus
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.14, 0.42, 0.94], atmThickness: 0.80,
    emissive: 0, iceCaps: 0, clouds: 0, noiseScale: 2.0,
    hasRings: true, ringInner: 1.50, ringOuter: 1.85,
    auroraStrength: 0.30, auroraColor: [0.10, 0.50, 0.95],
    cloudRegime: 0.66,
  },

  'warm-neptune': { // Warmer teal-cyan — vivid heated methane, emerald shifts
    color1: [0.06, 0.60, 0.56],    // vivid teal-green
    color2: [0.02, 0.32, 0.42],    // deep teal-navy belt
    color3: [0.28, 0.78, 0.68],    // bright emerald highlight
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.16, 0.62, 0.70], atmThickness: 0.75,
    emissive: 0, iceCaps: 0, clouds: 0, noiseScale: 2.0,
    cloudRegime: 2,                // warm → water cloud deck visible
    hazeColor: [0.18, 0.68, 0.72], hazeHeight: 0.45,
    auroraStrength: 0.22, auroraColor: [0.10, 0.80, 0.70],
  },

  'mini-neptune': { // ★ URANUS-like — distinct pale aqua-green, very smooth
    color1: [0.52, 0.72, 0.78],    // pale aqua-mint (Uranus CH₄ ice)
    color2: [0.36, 0.52, 0.62],    // subtle teal-grey band
    color3: [0.68, 0.82, 0.88],    // bright featureless zone
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.48, 0.66, 0.84], atmThickness: 0.65,
    emissive: 0, iceCaps: 0, clouds: 0, noiseScale: 2.5,
    cloudRegime: 2,                // ice giant — methane/ice haze stratosphere
    hazeColor: [0.50, 0.70, 0.88], hazeHeight: 0.50,
    auroraStrength: 0.25, auroraColor: [0.12, 0.55, 0.95],
  },

  'sub-neptune': { // Transitional — cool steel-lavender haze, muted but distinct
    color1: [0.48, 0.48, 0.68],    // steel-lavender zone
    color2: [0.30, 0.30, 0.50],    // dark purple-grey belt
    color3: [0.64, 0.62, 0.78],    // bright lavender zone
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.48, 0.48, 0.72], atmThickness: 0.72, // thicker — sub-neptune puffy envelope
    emissive: 0, iceCaps: 0, clouds: 0, noiseScale: 2.5,
    cloudRegime: 1,                // NH₄SH deck — mid-temperature sub-Neptune
    hazeColor: [0.50, 0.50, 0.78], hazeHeight: 0.42,
  },

  // ══════════════════════════════════════════════════════
  //  MOON PROFILES (21 types) — real Solar System colors
  // ══════════════════════════════════════════════════════

  // === Group 1: Volcanic / Thermal ===
  'moon-volcanic': { // ★ IO — bright sulfur yellow, volcanic orange, dark silicate lava
    color1: [0.90, 0.84, 0.28],    // sulfur yellow (S₈ allotropes)
    color2: [0.86, 0.50, 0.10],    // volcanic orange (sulfur flows)
    color3: [0.14, 0.08, 0.04],    // dark silicate lava crust
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.65, 0.52, 0.12], atmThickness: 0.06,
    emissive: 0.58, iceCaps: 0, clouds: 0, noiseScale: 4.5,
    craterDensity: 0.10, volcanism: 0.72, mountainHeight: 0.20, valleyDepth: 0.12,
    resonanceHeat: 0.55, isMoon: 1.0,
  },

  'moon-magma-ocean': { // Tidally super-heated — ultra-dark crust, glowing magma sea
    color1: [0.06, 0.03, 0.02],    // ultra-dark solidified crust
    color2: [0.96, 0.30, 0.02],    // molten orange-red
    color3: [1.0, 0.65, 0.08],     // white-hot magma
    oceanColor: [0.78, 0.20, 0.02], oceanLevel: 0.30,
    atmColor: [0.68, 0.22, 0.05], atmThickness: 0.18,
    emissive: 0.88, iceCaps: 0, clouds: 0, noiseScale: 3.2,
    craterDensity: 0.05, volcanism: 0.92, mountainHeight: 0.10, valleyDepth: 0.05,
  },

  // === Group 2: Icy / Cryogenic ===
  'moon-ice-shell': { // ★ EUROPA — warm cream ice, brown-red lineae, bright frost
    color1: [0.85, 0.79, 0.70],    // tan-cream ice (Europa's characteristic hue)
    color2: [0.58, 0.32, 0.16],    // brown-red tectonic lineae (irradiated salts)
    color3: [0.93, 0.91, 0.87],    // fresh bright frost
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.50, 0.55, 0.68], atmThickness: 0.01,
    emissive: 0, iceCaps: 0.99, clouds: 0, noiseScale: 3.0,
    craterDensity: 0.08, crackIntensity: 0.78, valleyDepth: 0.38, mountainHeight: 0.05,
    subsurfaceOcean: 1.0, resonanceHeat: 0.75, isMoon: 1.0,
  },

  'moon-ocean': { // ★ ENCELADUS — brilliant white ice, blue tiger stripes
    color1: [0.95, 0.96, 0.98],    // brilliant white (highest albedo in Solar System)
    color2: [0.60, 0.72, 0.84],    // blue-tinted tiger stripe crevasses
    color3: [0.98, 0.98, 0.99],    // near-pure white fresh frost
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.62, 0.70, 0.85], atmThickness: 0.02,
    emissive: 0, iceCaps: 0.92, clouds: 0, noiseScale: 3.5,
    craterDensity: 0.14, crackIntensity: 0.62, valleyDepth: 0.30, mountainHeight: 0.08,
  },

  'moon-nitrogen-ice': { // ★ TRITON — pink N₂ frost, dark cantaloupe terrain, geyser streaks
    color1: [0.84, 0.66, 0.60],    // pinkish nitrogen frost (sublimated N₂/CH₄)
    color2: [0.36, 0.26, 0.22],    // dark cantaloupe terrain
    color3: [0.94, 0.82, 0.78],    // bright polar cap
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.70, 0.58, 0.55], atmThickness: 0.04,
    emissive: 0, iceCaps: 0.78, clouds: 0, noiseScale: 4.0,
    craterDensity: 0.20, crackIntensity: 0.38, mountainHeight: 0.22, valleyDepth: 0.26, volcanism: 0.20,
  },

  'moon-co2-frost': { // Mars polar style — white CO₂ frost on ochre-red substrate
    color1: [0.74, 0.48, 0.26],    // ochre-red substrate
    color2: [0.90, 0.87, 0.82],    // CO₂ frost (white)
    color3: [0.84, 0.60, 0.32],    // bright ochre dust
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.58, 0.46, 0.34], atmThickness: 0.08,
    emissive: 0, iceCaps: 0.68, clouds: 0.05, noiseScale: 3.8,
    craterDensity: 0.35, mountainHeight: 0.24, valleyDepth: 0.18,
  },

  'moon-ammonia-slush': { // NH₃ subsurface ocean — dirty warm ice, teal-blue slush veins
    color1: [0.50, 0.44, 0.30],    // dirty warm ice
    color2: [0.26, 0.44, 0.50],    // teal ammonia slush
    color3: [0.64, 0.56, 0.42],    // lighter dry crust
    oceanColor: [0.22, 0.30, 0.26], oceanLevel: 0.22,
    atmColor: [0.46, 0.44, 0.38], atmThickness: 0.10,
    emissive: 0, iceCaps: 0.18, clouds: 0.08, noiseScale: 3.2,
    craterDensity: 0.16, crackIntensity: 0.42, mountainHeight: 0.10, valleyDepth: 0.34,
  },

  // === Group 3: Rocky / Mineral ===
  'moon-cratered': { // ★ LUNA — light highland grey, dark mare basalt, bright ejecta rays
    color1: [0.50, 0.48, 0.46],    // highland anorthosite grey
    color2: [0.20, 0.18, 0.16],    // dark mare basalt (Sea of Tranquility)
    color3: [0.66, 0.64, 0.60],    // bright ray ejecta (Tycho, Copernicus)
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.30, 0.28, 0.26], atmThickness: 0.0,
    emissive: 0, iceCaps: 0, clouds: 0, noiseScale: 5.0,
    craterDensity: 0.80, mountainHeight: 0.32, valleyDepth: 0.16,
    resonanceHeat: 0.30, isMoon: 1.0,
  },

  'moon-iron-rich': { // ★ PSYCHE — rust-orange oxide, exposed grey metal
    color1: [0.68, 0.36, 0.16],    // rust-orange (iron oxide layer)
    color2: [0.80, 0.54, 0.26],    // bright oxidized surface
    color3: [0.44, 0.42, 0.40],    // exposed bare nickel-iron
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.50, 0.34, 0.22], atmThickness: 0.0,
    emissive: 0, iceCaps: 0, clouds: 0, noiseScale: 5.5,
    craterDensity: 0.46, mountainHeight: 0.44, valleyDepth: 0.24,
  },

  'moon-olivine': { // Mantle fragment — vivid olive-green Mg₂SiO₄ crystals
    color1: [0.30, 0.52, 0.16],    // olive green (forsterite)
    color2: [0.50, 0.60, 0.28],    // bright crystalline olivine
    color3: [0.20, 0.30, 0.10],    // dark dunite matrix
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.28, 0.38, 0.20], atmThickness: 0.0,
    emissive: 0, iceCaps: 0, clouds: 0, noiseScale: 5.8,
    craterDensity: 0.38, mountainHeight: 0.40, valleyDepth: 0.20, volcanism: 0.16,
  },

  'moon-basalt': { // Lunar maria analog — very dark volcanic flood basalt
    color1: [0.09, 0.08, 0.07],    // ultra-dark basalt (fresh lava)
    color2: [0.16, 0.14, 0.12],    // weathered basalt
    color3: [0.05, 0.04, 0.04],    // obsidian black flow channels
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.14, 0.12, 0.10], atmThickness: 0.0,
    emissive: 0, iceCaps: 0, clouds: 0, noiseScale: 4.5,
    craterDensity: 0.64, mountainHeight: 0.14, valleyDepth: 0.24, volcanism: 0.50,
  },

  'moon-regolith': { // ★ PHOBOS/DEIMOS — warm tan powdery dust, softened features
    color1: [0.46, 0.40, 0.32],    // warm tan dust (carbonaceous chondrite)
    color2: [0.34, 0.28, 0.20],    // dark grove recesses
    color3: [0.56, 0.50, 0.40],    // bright dust highlights
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.36, 0.32, 0.26], atmThickness: 0.0,
    emissive: 0, iceCaps: 0, clouds: 0, noiseScale: 4.0,
    craterDensity: 0.58, mountainHeight: 0.16, valleyDepth: 0.10,
  },

  // === Group 4: Carbonaceous / Dark ===
  'moon-captured': { // ★ PHOEBE — very dark C-type, ancient battered KBO
    color1: [0.10, 0.08, 0.07],    // very dark carbon-rich (albedo ~0.06)
    color2: [0.18, 0.16, 0.14],    // medium dark
    color3: [0.06, 0.05, 0.04],    // coal-black shadow
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.14, 0.12, 0.10], atmThickness: 0.0,
    emissive: 0, iceCaps: 0.08, clouds: 0, noiseScale: 6.0,
    craterDensity: 0.70, mountainHeight: 0.24, valleyDepth: 0.14,
  },

  'moon-carbon-soot': { // ★ HYPERION — spongy ultra-dark, lowest albedo object
    color1: [0.04, 0.03, 0.03],    // near-black soot coating
    color2: [0.10, 0.07, 0.06],    // dark reddish-brown tinge
    color3: [0.02, 0.02, 0.02],    // deepest void
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.06, 0.05, 0.04], atmThickness: 0.0,
    emissive: 0, iceCaps: 0, clouds: 0, noiseScale: 7.0,
    craterDensity: 0.60, mountainHeight: 0.12, valleyDepth: 0.10,
  },

  'moon-tholin': { // ★ MAKEMAKE/SEDNA — rich rust-red organics (irradiated CH₄)
    color1: [0.65, 0.28, 0.08],    // rich rust-red tholin
    color2: [0.50, 0.18, 0.04],    // deep dark red-brown
    color3: [0.78, 0.42, 0.14],    // bright orange-brown highlights
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.52, 0.30, 0.12], atmThickness: 0.02,
    emissive: 0, iceCaps: 0.12, clouds: 0, noiseScale: 5.0,
    craterDensity: 0.44, crackIntensity: 0.20, mountainHeight: 0.20, valleyDepth: 0.14,
  },

  // === Group 5: Atmosphere-bearing ===
  'moon-atmosphere': { // ★ TITAN — thick orange smog, dark hydrocarbon dunes, methane lakes
    color1: [0.44, 0.28, 0.06],    // dark orange-brown (hydrocarbon dunes)
    color2: [0.28, 0.18, 0.04],    // very dark lowland
    color3: [0.58, 0.40, 0.12],    // bright highland
    oceanColor: [0.14, 0.08, 0.02], oceanLevel: 0.28,
    atmColor: [0.84, 0.60, 0.14],  // thick orange photochemical haze
    atmThickness: 0.90,
    emissive: 0, iceCaps: 0, clouds: 0.62, noiseScale: 2.8,
    craterDensity: 0.03, mountainHeight: 0.14, valleyDepth: 0.16,
    hazeColor: [0.72, 0.44, 0.18], hazeHeight: 0.90,
  },

  'moon-thin-atm': { // Small Mars-like — rusty with thin pink-salmon atmosphere
    color1: [0.60, 0.36, 0.16],    // rusty terrain
    color2: [0.38, 0.22, 0.10],    // dark basalt rock
    color3: [0.74, 0.52, 0.26],    // bright ochre dust
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.75, 0.50, 0.28],  // pinkish Mars-like sky
    atmThickness: 0.14,
    emissive: 0, iceCaps: 0.14, clouds: 0.03, noiseScale: 4.2,
    craterDensity: 0.44, mountainHeight: 0.26, valleyDepth: 0.22, volcanism: 0.12,
  },

  // === Group 6: Special / Mixed ===
  'moon-shepherd': { // Pan/Atlas/Prometheus — pale icy rubble, ring-sculpted
    color1: [0.68, 0.66, 0.64],    // pale grey ice
    color2: [0.52, 0.50, 0.46],    // medium grey
    color3: [0.80, 0.78, 0.76],    // bright icy highlight
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.42, 0.40, 0.38], atmThickness: 0.0,
    emissive: 0, iceCaps: 0.18, clouds: 0, noiseScale: 7.0,
    craterDensity: 0.60, mountainHeight: 0.10, valleyDepth: 0.06,
  },

  'moon-binary': { // ★ CHARON — grey ice + reddish-brown polar tholin (Mordor Macula)
    color1: [0.50, 0.48, 0.46],    // neutral grey ice
    color2: [0.54, 0.28, 0.16],    // reddish-brown tholin polar cap (Mordor!)
    color3: [0.60, 0.58, 0.54],    // bright grey highland
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.32, 0.30, 0.28], atmThickness: 0.0,
    emissive: 0, iceCaps: 0.14, clouds: 0, noiseScale: 5.5,
    craterDensity: 0.48, crackIntensity: 0.14, mountainHeight: 0.26, valleyDepth: 0.22, volcanism: 0.06,
  },

  'moon-sulfate': { // ★ CERES — dark regolith + brilliant white salt (Occator)
    color1: [0.94, 0.90, 0.68],    // brilliant white-yellow salt deposit
    color2: [0.38, 0.34, 0.26],    // dark regolith substrate
    color3: [0.98, 0.96, 0.80],    // ultra-bright sodium carbonate brine
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.54, 0.52, 0.42], atmThickness: 0.01,
    emissive: 0, iceCaps: 0.20, clouds: 0, noiseScale: 4.5,
    craterDensity: 0.34, crackIntensity: 0.50, mountainHeight: 0.16, valleyDepth: 0.26,
  },

  'moon-silicate-frost': { // ★ GANYMEDE — dark ancient terrain + bright icy grooved terrain
    color1: [0.52, 0.58, 0.68],    // blue-grey frost (bright grooved terrain)
    color2: [0.24, 0.18, 0.14],    // dark ancient terrain (Galileo Regio)
    color3: [0.74, 0.78, 0.84],    // brilliant icy groove highlights
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.44, 0.50, 0.62], atmThickness: 0.03,
    emissive: 0, iceCaps: 0.48, clouds: 0, noiseScale: 4.8,
    craterDensity: 0.50, mountainHeight: 0.30, valleyDepth: 0.20, crackIntensity: 0.28,
  },

  // ── Feature B: Snowball / Rogue Planet profiles ───────────
  // snowball: fully glaciated world — all surface ice, thick N2/CO2/H2O mix
  'snowball': { // fully glaciated — all surface ice, thin CO₂ atmosphere, no exposed land
    color1: [0.90, 0.94, 0.99],    // brilliant fresh CO₂/N₂ snow (very high albedo)
    color2: [0.60, 0.70, 0.88],    // blue-tinged compacted water ice (glacial blue)
    color3: [0.70, 0.44, 0.22],    // rust-orange methane/tholin patches (ancient organic ice)
    oceanColor: [0.02, 0.08, 0.28], oceanLevel: 0.0,
    atmColor: [0.54, 0.64, 0.88], atmThickness: 0.08, // very thin CO₂ remnant
    emissive: 0, iceCaps: 1.0, clouds: 0.08, noiseScale: 3.5,
    isIce: true,
    crackIntensity: 0.55,          // deep glacial rifts + tidal stress fractures
    mountainHeight: 0.14, valleyDepth: 0.10,
    hazeColor: [0.60, 0.70, 0.92], hazeHeight: 0.14, // ice crystal noctilucent haze
  },

  // rogue-planet: free-floating planetary body, no star — internal decay heat only
  'rogue-planet': {
    color1: [0.06, 0.06, 0.08],    // near-black frozen surface (∼30K, no illumination)
    color2: [0.04, 0.04, 0.06],    // darker cryo-compressed ice
    color3: [0.70, 0.14, 0.03],    // vivid internal heat fracture — glowing red-orange
    oceanColor: [0, 0, 0], oceanLevel: 0.0,
    atmColor: [0.10, 0.10, 0.14], atmThickness: 0.0,
    emissive: 0.04, iceCaps: 1.0, clouds: 0, noiseScale: 3.2,
    isIce: true,
    crackIntensity: 0.72,          // extensive fracture network from thermal stress
    mountainHeight: 0.10, valleyDepth: 0.08,
  },

  // ── Type aliases: backend sends these keys, map to equivalent profiles ──
  'moon-rocky': { // Generic airless rocky moon — Luna-analog (= moon-cratered)
    color1: [0.50, 0.48, 0.46],    // highland anorthosite grey
    color2: [0.20, 0.18, 0.16],    // dark mare basalt
    color3: [0.66, 0.64, 0.60],    // bright ray ejecta
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.30, 0.28, 0.26], atmThickness: 0.0,
    emissive: 0, iceCaps: 0, clouds: 0, noiseScale: 5.0,
    craterDensity: 0.78, mountainHeight: 0.30, valleyDepth: 0.15,
  },

  'moon-sulfur': { // Sulfurous volcanic moon — Io-analog (= moon-volcanic)
    color1: [0.94, 0.88, 0.14],    // bright sulfur yellow
    color2: [0.78, 0.42, 0.06],    // volcanic orange (SO₂ frost)
    color3: [0.18, 0.12, 0.10],    // dark silicate lava flows
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.78, 0.62, 0.18], atmThickness: 0.04,
    emissive: 0.18, iceCaps: 0, clouds: 0, noiseScale: 5.0,
    craterDensity: 0.06, mountainHeight: 0.40, volcanism: 0.85, valleyDepth: 0.30,
  },

  'moon-hydrocarbon': { // Hydrocarbon-rich moon — Titan-analog (= moon-atmosphere)
    color1: [0.58, 0.38, 0.14],    // orange smog (Titan haze)
    color2: [0.38, 0.22, 0.08],    // dark hydrocarbon dunes
    color3: [0.72, 0.52, 0.24],    // bright methane rain plateau
    oceanColor: [0.10, 0.08, 0.12], oceanLevel: 0.22,
    atmColor: [0.76, 0.52, 0.22], atmThickness: 0.28,
    emissive: 0, iceCaps: 0.15, clouds: 0.35, noiseScale: 3.5,
    craterDensity: 0.06, mountainHeight: 0.20, valleyDepth: 0.30,
  },

  // ══════════════════════════════════════════════════════
  //  v2 NEW PROFILES — taxonomy extension
  // ══════════════════════════════════════════════════════

  // ── C5: Ultra-Short-Period Rocks (P < 1 day) ──────────
  'usp-rock': { // Airless baked rock, 800-1500K, tidally locked to sub-day orbit
    color1: [0.42, 0.28, 0.16],    // baked basalt — heat-altered to reddish-brown
    color2: [0.58, 0.38, 0.18],    // bright regolith ridges (thermally cracked)
    color3: [0.24, 0.16, 0.10],    // dark shadow rock
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.60, 0.32, 0.12], atmThickness: 0.0,
    emissive: 0.08, iceCaps: 0, clouds: 0, noiseScale: 5.5,
    thermalGlow: 0.35,
    craterDensity: 0.12, mountainHeight: 0.20, valleyDepth: 0.14, volcanism: 0.18,
  },

  'usp-hot-rock': { // Extreme USP, 1500-3000K — incandescent dayside, molten patches
    color1: [0.54, 0.24, 0.08],    // heat-altered dark silicate
    color2: [0.32, 0.14, 0.04],    // cooled dark basalt channels
    color3: [0.70, 0.40, 0.16],    // thermally-brightened ridges
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.72, 0.30, 0.08], atmThickness: 0.02,  // mineral vapor exosphere
    emissive: 0.45, iceCaps: 0, clouds: 0, noiseScale: 4.5,
    thermalGlow: 0.80,
    craterDensity: 0.04, mountainHeight: 0.12, valleyDepth: 0.08, volcanism: 0.60,
  },

  'usp-airless-remnant': { // Stripped bare silicate core — all volatiles ablated
    color1: [0.70, 0.58, 0.42],    // exposed silicate mantle
    color2: [0.52, 0.42, 0.30],    // dark olivine-rich rock
    color3: [0.86, 0.72, 0.52],    // bright shocked mineral surface
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.52, 0.40, 0.28], atmThickness: 0.0,
    emissive: 0.12, iceCaps: 0, clouds: 0, noiseScale: 6.0,
    thermalGlow: 0.50, metallic: 0.20,
    craterDensity: 0.06, mountainHeight: 0.08, valleyDepth: 0.06,
  },

  // ── G3: Radius Gap (Fulton gap) types ─────────────────
  'photoevap-stripped': { // Bare rocky core — envelope photoevaporated by XUV
    color1: [0.48, 0.38, 0.26],    // dry compressed silicate
    color2: [0.34, 0.26, 0.18],    // dark olivine regions
    color3: [0.64, 0.52, 0.36],    // bright highland ridges
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.44, 0.34, 0.24], atmThickness: 0.01,
    emissive: 0, iceCaps: 0, clouds: 0, noiseScale: 5.0,
    metallic: 0.10,
    craterDensity: 0.22, mountainHeight: 0.22, valleyDepth: 0.14,
  },

  // ── I5: Circumbinary Worlds ────────────────────────────
  'circumbinary-temperate': { // Two-sun world in HZ around binary pair
    color1: [0.40, 0.32, 0.18],    // warm terrain (dual-illuminated)
    color2: [0.48, 0.38, 0.16],    // clay-bronze highlands
    color3: [0.68, 0.62, 0.48],    // bleached limestone
    oceanColor: [0.02, 0.06, 0.28], oceanLevel: 0.62,
    atmColor: [0.30, 0.50, 0.88], atmThickness: 0.55,
    emissive: 0, iceCaps: 0.45, clouds: 0.28, noiseScale: 3.0,
    mountainHeight: 0.22, valleyDepth: 0.12,
  },

  // ── I6: Compact Resonance Chain Worlds ────────────────
  'chain-inner': { // Innermost resonance chain member — dry, hot, tidally stressed
    color1: [0.64, 0.38, 0.14],    // baked reddish basalt
    color2: [0.46, 0.24, 0.08],    // dark volcanic rock
    color3: [0.80, 0.56, 0.24],    // bright thermally-cracked surface
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.74, 0.48, 0.22], atmThickness: 0.12,
    emissive: 0.08, iceCaps: 0, clouds: 0.04, noiseScale: 4.0,
    resonanceHeat: 0.55,
    craterDensity: 0.06, mountainHeight: 0.20, valleyDepth: 0.12, volcanism: 0.45,
  },

  'chain-temperate': { // Mid-chain TRAPPIST-1e/f analog — warm habitable
    color1: [0.38, 0.30, 0.16],    // warm soil
    color2: [0.44, 0.36, 0.14],    // clay plains
    color3: [0.62, 0.54, 0.40],    // rock outcrops
    oceanColor: [0.02, 0.06, 0.26], oceanLevel: 0.68,
    atmColor: [0.28, 0.46, 0.82], atmThickness: 0.45,
    emissive: 0, iceCaps: 0.55, clouds: 0.30, noiseScale: 2.8,
    resonanceHeat: 0.20,
    mountainHeight: 0.18, valleyDepth: 0.10,
  },

  'chain-cold': { // Outer chain member — icy, possible subsurface ocean
    color1: [0.72, 0.76, 0.82],    // bright ice shelf
    color2: [0.50, 0.54, 0.62],    // grey-blue ice plains
    color3: [0.88, 0.90, 0.94],    // fresh-snow highlights
    oceanColor: [0.04, 0.08, 0.30], oceanLevel: 0.15,
    atmColor: [0.44, 0.52, 0.78], atmThickness: 0.18,
    emissive: 0, iceCaps: 0.92, clouds: 0.18, noiseScale: 3.5,
    resonanceHeat: 0.08,
    isIce: true, crackIntensity: 0.28, mountainHeight: 0.14, valleyDepth: 0.10,
  },

  // ── K2: Gas Giant Cloud Regimes ───────────────────────
  'water-cloud-giant': { // Hot gas giant with H₂O cloud deck (400-800K)
    color1: [0.72, 0.82, 0.94],    // blue-white water cloud tops
    color2: [0.54, 0.66, 0.84],    // medium blue band
    color3: [0.88, 0.92, 0.98],    // bright white cloud deck
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.52, 0.64, 0.88], atmThickness: 0.90,
    emissive: 0, iceCaps: 0, clouds: 0.55, noiseScale: 1.8,
    cloudRegime: 2,
  },

  'nh4sh-cloud-giant': { // Warm gas giant NH₄SH deck (200-400K) — brown-tan
    color1: [0.64, 0.46, 0.24],    // tan-brown cloud top
    color2: [0.48, 0.32, 0.14],    // dark ochre band
    color3: [0.80, 0.62, 0.36],    // light tan highlight
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.62, 0.48, 0.28], atmThickness: 0.90,
    emissive: 0, iceCaps: 0, clouds: 0.45, noiseScale: 1.5,
    cloudRegime: 1,
  },

  'cloudless-hot-jupiter': { // Dayside too hot for clouds — bare silicate vapor, thermal glow
    color1: [0.28, 0.18, 0.10],    // dark silicate — no reflective clouds
    color2: [0.38, 0.24, 0.14],    // dim grey-brown banded atmosphere
    color3: [0.18, 0.12, 0.08],    // deep shadow lanes
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.42, 0.28, 0.14], atmThickness: 0.75,
    emissive: 0.35, iceCaps: 0, clouds: 0.08, noiseScale: 1.6,
    cloudRegime: 3, nightCloudFraction: 0.65,
    thermalGlow: 0.48,             // dayside absorbs all radiation — thermal re-emission
    hazeColor: [0.30, 0.20, 0.10], hazeHeight: 0.28, // silicate aerosol haze layer
  },

  'night-cloud-giant': { // Hot Jupiter asymmetry — roasted dayside, cloud-loaded nightside
    color1: [0.52, 0.38, 0.18],    // heated amber dayside (warmer than before)
    color2: [0.30, 0.22, 0.12],    // dim dark banded dayside
    color3: [0.72, 0.58, 0.32],    // bright hot atmospheric streak at limb
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.62, 0.46, 0.26], atmThickness: 0.88,
    emissive: 0, iceCaps: 0, clouds: 0.30, noiseScale: 1.4,
    cloudRegime: 2, nightCloudFraction: 0.80,
    thermalGlow: 0.22,             // mild dayside heating drives jet dynamics
    hazeColor: [0.58, 0.40, 0.20], hazeHeight: 0.32,
  },

  // ── Cluster P: Post-Main-Sequence Worlds ──────────────
  'rgb-hz-world': { // Rocky planet in red giant habitable zone (5-8 AU equivalent)
    color1: [0.42, 0.32, 0.18],    // warm-lit terrain (red giant illumination)
    color2: [0.50, 0.38, 0.16],    // amber-ochre soil
    color3: [0.66, 0.56, 0.38],    // light sandy highland
    oceanColor: [0.04, 0.08, 0.28], oceanLevel: 0.58,
    atmColor: [0.44, 0.42, 0.52], atmThickness: 0.50,
    emissive: 0, iceCaps: 0.28, clouds: 0.25, noiseScale: 2.8,
    postMsAmbient: [0.28, 0.12, 0.04],   // red giant warm fill
    mountainHeight: 0.18, valleyDepth: 0.10,
  },

  'wd-rocky-survivor': { // Ancient rocky world orbiting a white dwarf (Sirius B-like)
    color1: [0.34, 0.30, 0.26],    // ancient space-weathered rock
    color2: [0.20, 0.18, 0.16],    // dark compressed basalt
    color3: [0.50, 0.46, 0.40],    // bright ejecta-blanket highland
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.28, 0.32, 0.40], atmThickness: 0.0,
    emissive: 0, iceCaps: 0, clouds: 0, noiseScale: 5.5,
    postMsAmbient: [0.08, 0.10, 0.20],   // WD blue-white UV fill
    metallic: 0.12,
    craterDensity: 0.80, mountainHeight: 0.14, valleyDepth: 0.18,
  },

  'psr-rocky': { // Planet around a millisecond pulsar (PSR 1257+12-like)
    color1: [0.14, 0.10, 0.12],    // irradiated dark surface (X-ray + gamma darkened)
    color2: [0.22, 0.16, 0.18],    // purple-tinted regolith (synchrotron tint)
    color3: [0.10, 0.06, 0.10],    // deep violet-black
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.30, 0.16, 0.36], atmThickness: 0.0,
    emissive: 0.05, iceCaps: 0, clouds: 0, noiseScale: 5.0,
    postMsAmbient: [0.04, 0.02, 0.12],   // pulsar hard violet radiation
    auroraStrength: 0.75,
    auroraColor: [0.40, 0.10, 0.90],     // violet ion-stripped aurora
    craterDensity: 0.45, mountainHeight: 0.12, valleyDepth: 0.14,
  },

};

/** Short alias — V for legacy compatibility */
export const V = WORLD_VISUALS;
