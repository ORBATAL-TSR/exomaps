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
  },

  'rocky': { // ★ MERCURY — dark basalt grey, bright crater ejecta, subtle tan
    color1: [0.26, 0.24, 0.22],    // dark basalt (Mercury MESSENGER imagery)
    color2: [0.44, 0.42, 0.37],    // medium grey highlands
    color3: [0.64, 0.60, 0.52],    // bright ejecta rays
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.40, 0.30, 0.22], atmThickness: 0.05,
    emissive: 0, iceCaps: 0, clouds: 0, noiseScale: 4.5,
    craterDensity: 0.30, mountainHeight: 0.25, valleyDepth: 0.12,
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

  'sub-earth': { // Small Mercury-like — grey-tan, heavily cratered
    color1: [0.38, 0.34, 0.28],    // warm grey
    color2: [0.50, 0.46, 0.38],    // lighter highlands
    color3: [0.62, 0.56, 0.46],    // pale ejecta
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.30, 0.25, 0.20], atmThickness: 0.02,
    emissive: 0, iceCaps: 0, clouds: 0, noiseScale: 5.0,
    craterDensity: 0.28, mountainHeight: 0.16, valleyDepth: 0.08,
  },

  'desert-world': { // ★ MARS — rust-red Fe₂O₃, dark basalt, bright ochre dust
    color1: [0.78, 0.34, 0.10],    // Mars rust-red (iron oxide)
    color2: [0.50, 0.20, 0.06],    // dark basalt (Syrtis Major)
    color3: [0.92, 0.64, 0.28],    // bright ochre dust (Arabia Terra)
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.80, 0.54, 0.30],  // salmon-pink Martian sky
    atmThickness: 0.22,
    emissive: 0, iceCaps: 0.42, clouds: 0.05, noiseScale: 3.5,
    mountainHeight: 0.30, valleyDepth: 0.24, volcanism: 0.22,
  },

  'ocean-world': { // Deep global ocean — rare volcanic peaks barely breach surface
    color1: [0.12, 0.18, 0.14],    // rare volcanic seamount
    color2: [0.08, 0.14, 0.12],    // dark basalt
    color3: [0.16, 0.22, 0.18],    // wave-washed reef
    oceanColor: [0.01, 0.06, 0.32], oceanLevel: 0.92,
    atmColor: [0.20, 0.44, 0.88], atmThickness: 0.55,
    emissive: 0, iceCaps: 0.25, clouds: 0.50, noiseScale: 2.5,
  },

  'lava-world': { // ★ 55 CANCRI e — charred obsidian crust, glowing cracks
    color1: [0.06, 0.03, 0.02],    // charred obsidian black
    color2: [0.16, 0.06, 0.03],    // dark basalt
    color3: [0.10, 0.05, 0.03],    // dark rock variation
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.75, 0.28, 0.05],  // volcanic haze
    atmThickness: 0.30,
    emissive: 0.95, iceCaps: 0, clouds: 0, noiseScale: 3.0,
    volcanism: 0.78, mountainHeight: 0.12, valleyDepth: 0.16,
  },

  'iron-planet': { // Exposed metallic core — burnished steel, blue-grey shimmer
    color1: [0.56, 0.53, 0.50],    // burnished steel
    color2: [0.38, 0.36, 0.42],    // blue-grey metal
    color3: [0.70, 0.67, 0.63],    // polished bright face
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.36, 0.34, 0.42], atmThickness: 0.05,
    emissive: 0, iceCaps: 0, clouds: 0, noiseScale: 5.5,
    craterDensity: 0.22, mountainHeight: 0.32, valleyDepth: 0.14,
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

  'hycean': { // H₂-rich ocean world — deep teal ocean, purple-blue haze
    color1: [0.05, 0.26, 0.18],    // teal island
    color2: [0.08, 0.32, 0.24],    // aquamarine coast
    color3: [0.12, 0.28, 0.20],    // warm lagoon
    oceanColor: [0.02, 0.10, 0.28], oceanLevel: 0.85,
    atmColor: [0.40, 0.42, 0.72],  // purple-blue hydrogen haze
    atmThickness: 0.70,
    emissive: 0, iceCaps: 0.10, clouds: 0.50, noiseScale: 2.5,
  },

  'eyeball-world': { // Tidally locked — habitable green ring, frozen everywhere else
    color1: [0.12, 0.36, 0.16],    // habitable zone green
    color2: [0.80, 0.82, 0.88],    // ice border
    color3: [0.92, 0.93, 0.96],    // bright polar ice
    oceanColor: [0.02, 0.10, 0.28], oceanLevel: 0.38,
    atmColor: [0.32, 0.48, 0.72], atmThickness: 0.40,
    emissive: 0, iceCaps: 0, clouds: 0.20, noiseScale: 3.0,
  },

  'ice-dwarf': { // ★ PLUTO — nitrogen ice (Sputnik), tholin red (Cthulhu), grey rock
    color1: [0.90, 0.86, 0.80],    // nitrogen ice plains (Sputnik Planitia)
    color2: [0.56, 0.30, 0.14],    // tholin red-brown (Cthulhu Macula)
    color3: [0.74, 0.68, 0.60],    // rocky grey highlands
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.52, 0.56, 0.75],  // faint blue haze (like New Horizons imagery)
    atmThickness: 0.04,
    emissive: 0, iceCaps: 0.85, clouds: 0, noiseScale: 4.0,
    craterDensity: 0.15, crackIntensity: 0.22,
    mountainHeight: 0.22, valleyDepth: 0.16,
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
  },

  'super-jupiter': { // Deeper ochres — compressed, intense bands, high contrast
    color1: [0.70, 0.44, 0.16],    // intense ochre zone
    color2: [0.28, 0.12, 0.04],    // very dark belt (ultra-deep)
    color3: [0.88, 0.28, 0.06],    // deep crimson storm
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.62, 0.40, 0.20], atmThickness: 0.90,
    emissive: 0, iceCaps: 0, clouds: 0, noiseScale: 2.0,
  },

  'hot-jupiter': { // ★ Scorched — incandescent molten orange-white, day-night extremes
    color1: [1.0, 0.62, 0.12],     // incandescent orange
    color2: [0.82, 0.24, 0.04],    // deep blood-red belt
    color3: [1.0, 0.82, 0.30],     // white-hot zone
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.94, 0.50, 0.10], atmThickness: 0.95,
    emissive: 0.45, iceCaps: 0, clouds: 0, noiseScale: 1.5,
  },

  'neptune-like': { // ★ NEPTUNE — vivid electric blue, dark methane, bright cirrus
    color1: [0.06, 0.32, 0.90],    // electric azure (methane absorption)
    color2: [0.02, 0.16, 0.55],    // deep navy-indigo band
    color3: [0.55, 0.78, 0.98],    // bright white-blue cirrus
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.14, 0.42, 0.94], atmThickness: 0.80,
    emissive: 0, iceCaps: 0, clouds: 0, noiseScale: 2.0,
  },

  'warm-neptune': { // Warmer teal-cyan — vivid heated methane, emerald shifts
    color1: [0.06, 0.60, 0.56],    // vivid teal-green
    color2: [0.02, 0.32, 0.42],    // deep teal-navy belt
    color3: [0.28, 0.78, 0.68],    // bright emerald highlight
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.16, 0.62, 0.70], atmThickness: 0.75,
    emissive: 0, iceCaps: 0, clouds: 0, noiseScale: 2.0,
  },

  'mini-neptune': { // ★ URANUS-like — distinct pale aqua-green, very smooth
    color1: [0.52, 0.72, 0.78],    // pale aqua-mint (Uranus CH₄ ice)
    color2: [0.36, 0.52, 0.62],    // subtle teal-grey band
    color3: [0.68, 0.82, 0.88],    // bright featureless zone
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.48, 0.66, 0.84], atmThickness: 0.65,
    emissive: 0, iceCaps: 0, clouds: 0, noiseScale: 2.5,
  },

  'sub-neptune': { // Transitional — cool steel-lavender haze, muted but distinct
    color1: [0.48, 0.48, 0.68],    // steel-lavender zone
    color2: [0.30, 0.30, 0.50],    // dark purple-grey belt
    color3: [0.64, 0.62, 0.78],    // bright lavender zone
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.48, 0.48, 0.72], atmThickness: 0.55,
    emissive: 0, iceCaps: 0, clouds: 0, noiseScale: 2.5,
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
    emissive: 0, iceCaps: 0.25, clouds: 0, noiseScale: 3.0,
    craterDensity: 0.08, crackIntensity: 0.78, valleyDepth: 0.38, mountainHeight: 0.05,
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
};

/** Short alias — V for legacy compatibility */
export const V = WORLD_VISUALS;
