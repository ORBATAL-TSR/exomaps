/**
 * ProceduralPlanet — Noise-based planet renderer that ALWAYS works.
 *
 * No texture dependency. Generates terrain, color, clouds, atmosphere,
 * and lighting entirely in GLSL shaders using 3D value noise / FBM.
 * This is the instant-on renderer that ensures planets are NEVER dark.
 *
 * Two visual modes:
 *   Solid — noise terrain + color ramps + ocean + ice caps + atmosphere rim
 *   Gas   — latitude bands + turbulence + storms + deep atmosphere
 *
 * All 22 planet types have hand-tuned visual profiles.
 */

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/* ── Planet visual profiles ──────────────────────────── */

const GAS_TYPES = new Set([
  'gas-giant', 'super-jupiter', 'hot-jupiter',
  'neptune-like', 'warm-neptune', 'mini-neptune', 'sub-neptune',
]);

interface PlanetVisuals {
  color1: [number, number, number]; // primary terrain / band
  color2: [number, number, number]; // secondary
  color3: [number, number, number]; // accent / storm
  oceanColor: [number, number, number];
  oceanLevel: number;
  atmColor: [number, number, number];
  atmThickness: number;
  emissive: number;
  iceCaps: number;
  clouds: number;
  noiseScale: number;
  craterDensity?: number;
  crackIntensity?: number;
  mountainHeight?: number;  // 0-1 ridged mountain ranges
  valleyDepth?: number;     // 0-1 rift canyons
  volcanism?: number;       // 0-1 shield volcanoes with calderas
  isIce?: boolean;          // ice-dominated world (fewer craters, smooth plains)
  terrainAge?: number;      // 0-1: 0=young (smooth volcanic), 1=ancient (cratered, eroded)
  tectonicsLevel?: number;  // 0-1: 0=dead (no plates), 1=highly active tectonics
}

/** Derive world visuals from physical parameters — universal across planets and moons */
export function deriveWorldVisuals(base: PlanetVisuals, params: {
  temperature?: number; mass?: number; tidalHeating?: number;
  starSpectralClass?: string;
}): PlanetVisuals {
  const v = { ...base };
  const temp = params.temperature ?? 300;
  const mass = params.mass ?? 1;
  const tidal = params.tidalHeating ?? 0;

  // Temperature-driven effects
  if (temp > 1500 && v.emissive < 0.3) {
    v.emissive = Math.min(1, 0.3 + (temp - 1500) / 3000);
    v.volcanism = Math.max(v.volcanism ?? 0, 0.35);
  }

  // ── FROST-LINE AWARENESS: strong cold-world transformation ──
  // Below ~180K: worlds should look increasingly icy, not rocky-brown
  if (temp < 200 && !v.isIce && v.oceanLevel < 0.5) {
    const coldFactor = 1.0 - Math.max(0, Math.min(1, (temp - 60) / 140)); // 0 at 200K, 1 at 60K
    // Ice tint: shift colors toward ice-white/blue-grey
    const iceC1: [number, number, number] = [0.78, 0.82, 0.88]; // nitrogen/water ice plain
    const iceC2: [number, number, number] = [0.55, 0.60, 0.70]; // grey-blue weathered ice
    const iceC3: [number, number, number] = [0.90, 0.92, 0.96]; // bright frost highlights
    const blend = coldFactor * 0.85; // up to 85% override at very cold
    v.color1 = [
      v.color1[0] * (1 - blend) + iceC1[0] * blend,
      v.color1[1] * (1 - blend) + iceC1[1] * blend,
      v.color1[2] * (1 - blend) + iceC1[2] * blend,
    ];
    v.color2 = [
      v.color2[0] * (1 - blend) + iceC2[0] * blend,
      v.color2[1] * (1 - blend) + iceC2[1] * blend,
      v.color2[2] * (1 - blend) + iceC2[2] * blend,
    ];
    v.color3 = [
      v.color3[0] * (1 - blend) + iceC3[0] * blend,
      v.color3[1] * (1 - blend) + iceC3[1] * blend,
      v.color3[2] * (1 - blend) + iceC3[2] * blend,
    ];
    v.iceCaps = Math.max(v.iceCaps, 0.45 + coldFactor * 0.50); // up to 0.95
    v.crackIntensity = Math.max(v.crackIntensity ?? 0, coldFactor * 0.35);
    v.volcanism = Math.min(v.volcanism ?? 0, 0.10 * (1 - coldFactor));
    v.isIce = coldFactor > 0.5;
    // Colder atmospheres thin out
    if (temp < 120 && !v.atmThickness) {
      v.atmColor = [0.50, 0.55, 0.72];
      v.atmThickness = Math.max(v.atmThickness, 0.02);
    }
  } else if (temp < 100 && !v.isIce) {
    v.iceCaps = Math.max(v.iceCaps, 0.55);
  }

  // Mass-driven atmosphere retention
  if (mass > 0.5 && temp < 700 && temp > 80 && v.atmThickness < 0.25) {
    v.atmThickness = Math.max(v.atmThickness, Math.min(0.5, mass * 0.08));
    v.clouds = Math.max(v.clouds, mass * 0.04);
  }

  // Tidal heating → volcanism, erases craters
  if (tidal > 0.3) {
    v.volcanism = Math.max(v.volcanism ?? 0, tidal * 0.7);
    v.craterDensity = Math.min(v.craterDensity ?? 0.5, 0.10);
  }

  // Small airless bodies → ancient heavily cratered
  if (mass < 0.005 && v.atmThickness < 0.03) {
    v.craterDensity = Math.max(v.craterDensity ?? 0, 0.55);
  }

  // Large rocky worlds → plate tectonics likely
  if (mass > 0.8 && mass < 8 && !GAS_TYPES.has('') && v.volcanism === undefined) {
    v.mountainHeight = Math.max(v.mountainHeight ?? 0, 0.18);
    v.valleyDepth = Math.max(v.valleyDepth ?? 0, 0.10);
  }

  // Continental rarity: higher mass → deeper oceans → more water world
  // Most ocean-bearing rocky worlds should be overwhelmingly ocean
  if (v.oceanLevel > 0.1 && v.oceanLevel < 0.90 && mass > 0.3) {
    v.oceanLevel = Math.min(0.96, v.oceanLevel + mass * 0.16);
  }

  // Star-spectrum foliage handled in GLSL via uFoliageColor uniform
  // (base terrain color1 stays as geological/mineral color;
  //  vegetation is applied only in habitable elevation/slope/latitude zones)

  // ── Derive terrain age and tectonics level ──
  // Age: young surfaces come from volcanism, tidal heating, or large mass; ancient from small, cold, inert
  // Tectonics: mass‐driven (plate tectonics onset ~0.5 M⊕), boosted by tidal heating
  if (v.terrainAge === undefined) {
    let age = 0.60; // default: moderate age
    if (mass < 0.01) age = 0.95;     // tiny → ancient, heavily cratered
    else if (mass < 0.1) age = 0.80; // small → old
    else if (mass > 2.0) age = 0.35; // large → younger (more internal heat)
    if (tidal > 0.3) age = Math.min(age, 0.20); // tidal heating → resurfaced
    if ((v.volcanism ?? 0) > 0.3) age = Math.min(age, 0.30);
    if (temp > 1200) age = Math.min(age, 0.15); // very hot → molten/resurfaced
    v.terrainAge = Math.max(0, Math.min(1, age));
  }
  if (v.tectonicsLevel === undefined) {
    let tect = 0.0;
    if (mass > 0.4 && mass < 10 && temp > 100 && temp < 1500) {
      tect = Math.min(1, (mass - 0.3) * 0.4); // onset at ~0.3 M⊕
    }
    if (tidal > 0.2) tect = Math.max(tect, tidal * 0.8);
    if ((v.volcanism ?? 0) > 0.2) tect = Math.max(tect, (v.volcanism ?? 0) * 0.6);
    v.tectonicsLevel = Math.max(0, Math.min(1, tect));
  }

  // Age-driven modifications
  if (v.terrainAge > 0.7) {
    // Ancient worlds: more craters, eroded features, darker/weathered colors
    v.craterDensity = Math.max(v.craterDensity ?? 0, (v.terrainAge - 0.5) * 0.6);
    v.mountainHeight = (v.mountainHeight ?? 0) * (1.3 - v.terrainAge * 0.5); // eroded peaks
    // Space-weathered darkening
    const darken = (v.terrainAge - 0.7) * 0.15;
    v.color1 = [v.color1[0] - darken, v.color1[1] - darken, v.color1[2] - darken];
    v.color2 = [v.color2[0] - darken * 0.7, v.color2[1] - darken * 0.7, v.color2[2] - darken * 0.7];
  } else if (v.terrainAge < 0.3) {
    // Young worlds: smooth fresh surfaces, volcanic plains, few craters
    v.craterDensity = Math.min(v.craterDensity ?? 0.5, 0.08);
    v.volcanism = Math.max(v.volcanism ?? 0, (0.3 - v.terrainAge) * 0.5);
  }

  // Tectonics-driven modifications
  if (v.tectonicsLevel > 0.4) {
    v.mountainHeight = Math.max(v.mountainHeight ?? 0, v.tectonicsLevel * 0.28);
    v.valleyDepth = Math.max(v.valleyDepth ?? 0, v.tectonicsLevel * 0.22);
    v.crackIntensity = Math.max(v.crackIntensity ?? 0, (v.tectonicsLevel - 0.3) * 0.25);
  }

  return v;
}

export const V: Record<string, PlanetVisuals> = {
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

  'gas-giant': { // ★ JUPITER — ochre-cream zones, brown belts, Great Red Spot
    color1: [0.84, 0.65, 0.34],    // warm cream-ochre zone (NH₃ clouds)
    color2: [0.52, 0.30, 0.10],    // dark brown belt (deeper cloud deck)
    color3: [0.92, 0.44, 0.18],    // Great Red Spot orange-red
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.74, 0.58, 0.36], atmThickness: 0.85,
    emissive: 0, iceCaps: 0, clouds: 0, noiseScale: 2.0,
  },

  'super-jupiter': { // Deeper ochres — compressed, intense bands
    color1: [0.64, 0.42, 0.20],    // deep ochre
    color2: [0.36, 0.18, 0.06],    // very dark belt
    color3: [0.80, 0.34, 0.12],    // deep red storm
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.58, 0.42, 0.26], atmThickness: 0.90,
    emissive: 0, iceCaps: 0, clouds: 0, noiseScale: 2.0,
  },

  'hot-jupiter': { // ★ Scorched — glowing molten orange, day-side incandescent
    color1: [0.94, 0.58, 0.16],    // bright molten orange
    color2: [0.78, 0.30, 0.06],    // deep crimson belt
    color3: [1.0, 0.70, 0.22],     // white-hot zone
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.90, 0.48, 0.14], atmThickness: 0.95,
    emissive: 0.38, iceCaps: 0, clouds: 0, noiseScale: 1.5,
  },

  'neptune-like': { // ★ NEPTUNE — vivid azure blue, dark methane bands
    color1: [0.12, 0.36, 0.82],    // rich azure (methane absorption)
    color2: [0.06, 0.22, 0.60],    // deep navy band
    color3: [0.50, 0.70, 0.94],    // bright methane cirrus
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.20, 0.45, 0.90], atmThickness: 0.80,
    emissive: 0, iceCaps: 0, clouds: 0, noiseScale: 2.0,
  },

  'warm-neptune': { // Warmer teal-cyan — heated methane shifts spectra
    color1: [0.10, 0.54, 0.60],    // warm teal
    color2: [0.06, 0.36, 0.48],    // deep teal belt
    color3: [0.30, 0.70, 0.65],    // bright cyan highlight
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.20, 0.60, 0.68], atmThickness: 0.75,
    emissive: 0, iceCaps: 0, clouds: 0, noiseScale: 2.0,
  },

  'mini-neptune': { // ★ URANUS-like — pale blue-green ice giant, very uniform
    color1: [0.44, 0.58, 0.76],    // pale blue-green (Uranus/ice giant)
    color2: [0.30, 0.44, 0.66],    // subtle darker band
    color3: [0.62, 0.72, 0.86],    // bright featureless zone
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.44, 0.58, 0.82], atmThickness: 0.65,
    emissive: 0, iceCaps: 0, clouds: 0, noiseScale: 2.5,
  },

  'sub-neptune': { // Transitional — steel-blue haze, muted bands
    color1: [0.44, 0.50, 0.62],    // steel blue
    color2: [0.32, 0.38, 0.52],    // dark haze band
    color3: [0.58, 0.62, 0.72],    // bright zone
    oceanColor: [0, 0, 0], oceanLevel: 0,
    atmColor: [0.44, 0.50, 0.68], atmThickness: 0.55,
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
};

/* ── World Diversity Genome System ─────────────────────
 *  Three-slot combinatorial "slot machine":
 *    Slot 1: Surface Regime  (20 options — mineral/rock types)
 *    Slot 2: Atmosphere Char (11 options — sky color/thickness)
 *    Slot 3: Hydrosphere     (9 options  — liquid type/coverage)
 *
 *  Selection constrained by temperature, mass, metallicity.
 *  Rarity: 1=common, 2=uncommon, 3=rare
 *  Each world gets a unique genome from seed → thousands of combos.
 * ───────────────────────────────────────────────────── */

interface SurfaceRegime {
  c1: [number, number, number]; c2: [number, number, number]; c3: [number, number, number];
  tempRange: [number, number]; tags: string[]; rarity: 1 | 2 | 3;
}
interface AtmosphereChar {
  color: [number, number, number]; thickness: number; clouds: number;
  tempRange: [number, number]; minMass: number; rarity: 1 | 2 | 3;
}
interface HydroState {
  color: [number, number, number]; level: number;
  tempRange: [number, number]; needsAtm: boolean; rarity: 1 | 2 | 3;
}

function genomeHash(seed: number, slot: number): number {
  const x = Math.sin(seed * 127.1 + slot * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function selectSlot<T extends { rarity: 1 | 2 | 3; tempRange: [number, number] }>(
  pool: T[], seed: number, slot: number, temp: number,
  extra?: (item: T) => boolean,
): T {
  let valid = pool.filter(p => temp >= p.tempRange[0] && temp <= p.tempRange[1]);
  if (extra) valid = valid.filter(extra);
  if (valid.length === 0) valid = pool;
  const weights = valid.map(p => p.rarity === 1 ? 4 : p.rarity === 2 ? 2 : 1);
  const total = weights.reduce((a, b) => a + b, 0);
  const r = genomeHash(seed, slot) * total;
  let acc = 0;
  for (let i = 0; i < valid.length; i++) {
    acc += weights[i];
    if (r < acc) return valid[i];
  }
  return valid[valid.length - 1];
}

// ── Slot 1: Surface Regimes (20) ──
const SURFACES: SurfaceRegime[] = [
  // Common (rarity 1) — 6 variants
  { c1: [0.15, 0.14, 0.13], c2: [0.25, 0.24, 0.22], c3: [0.35, 0.33, 0.30], tempRange: [0, 3000], tags: [], rarity: 1 },            // basalt field
  { c1: [0.38, 0.36, 0.32], c2: [0.45, 0.43, 0.38], c3: [0.55, 0.52, 0.48], tempRange: [0, 3000], tags: [], rarity: 1 },            // grey regolith
  { c1: [0.42, 0.40, 0.36], c2: [0.52, 0.50, 0.46], c3: [0.62, 0.60, 0.55], tempRange: [0, 3000], tags: [], rarity: 1 },            // silicate plain
  { c1: [0.52, 0.22, 0.08], c2: [0.60, 0.28, 0.12], c3: [0.42, 0.20, 0.08], tempRange: [100, 1200], tags: [], rarity: 1 },          // iron oxide
  { c1: [0.10, 0.10, 0.12], c2: [0.18, 0.17, 0.20], c3: [0.28, 0.27, 0.32], tempRange: [0, 3000], tags: [], rarity: 1 },            // dark rock
  { c1: [0.55, 0.45, 0.30], c2: [0.65, 0.52, 0.36], c3: [0.48, 0.40, 0.28], tempRange: [200, 600], tags: ['atm'], rarity: 1 },      // tan desert
  // Uncommon (rarity 2) — 8 variants
  { c1: [0.28, 0.35, 0.14], c2: [0.36, 0.42, 0.20], c3: [0.22, 0.28, 0.12], tempRange: [0, 2000], tags: ['metal'], rarity: 2 },     // olivine mantle
  { c1: [0.62, 0.58, 0.12], c2: [0.72, 0.65, 0.08], c3: [0.52, 0.48, 0.10], tempRange: [200, 800], tags: ['volc'], rarity: 2 },     // sulfur deposit
  { c1: [0.06, 0.05, 0.04], c2: [0.12, 0.10, 0.08], c3: [0.18, 0.15, 0.12], tempRange: [0, 2000], tags: [], rarity: 2 },            // carbon crust
  { c1: [0.58, 0.32, 0.18], c2: [0.65, 0.38, 0.22], c3: [0.50, 0.28, 0.16], tempRange: [180, 600], tags: ['atm'], rarity: 2 },      // red sandstone
  { c1: [0.68, 0.72, 0.78], c2: [0.78, 0.82, 0.88], c3: [0.58, 0.62, 0.70], tempRange: [0, 250], tags: [], rarity: 2 },             // ice rock
  { c1: [0.38, 0.20, 0.10], c2: [0.48, 0.28, 0.14], c3: [0.30, 0.16, 0.08], tempRange: [40, 200], tags: [], rarity: 2 },            // tholin crust
  { c1: [0.58, 0.25, 0.10], c2: [0.66, 0.30, 0.14], c3: [0.50, 0.22, 0.08], tempRange: [150, 500], tags: ['metal'], rarity: 2 },    // ferric highlands
  { c1: [0.70, 0.68, 0.62], c2: [0.78, 0.76, 0.72], c3: [0.62, 0.60, 0.55], tempRange: [200, 400], tags: ['atm'], rarity: 2 },      // limestone pale
  // Rare (rarity 3) — 6 variants
  { c1: [0.12, 0.32, 0.30], c2: [0.16, 0.40, 0.38], c3: [0.10, 0.26, 0.24], tempRange: [150, 800], tags: ['metal'], rarity: 3 },    // copper verdigris
  { c1: [0.80, 0.82, 0.86], c2: [0.88, 0.90, 0.94], c3: [0.72, 0.75, 0.80], tempRange: [0, 3000], tags: ['metal'], rarity: 3 },     // titanium frost
  { c1: [0.04, 0.06, 0.04], c2: [0.08, 0.14, 0.08], c3: [0.14, 0.20, 0.14], tempRange: [300, 2000], tags: ['volc'], rarity: 3 },    // obsidian glass
  { c1: [0.82, 0.80, 0.76], c2: [0.90, 0.88, 0.85], c3: [0.75, 0.73, 0.70], tempRange: [200, 600], tags: [], rarity: 3 },           // salt crystal
  { c1: [0.75, 0.68, 0.70], c2: [0.82, 0.76, 0.78], c3: [0.68, 0.60, 0.63], tempRange: [20, 100], tags: [], rarity: 3 },            // nitrogen ice
  { c1: [0.32, 0.30, 0.38], c2: [0.42, 0.40, 0.48], c3: [0.56, 0.52, 0.62], tempRange: [0, 1500], tags: [], rarity: 3 },            // metamorphic fold
];

// ── Slot 2: Atmosphere Characters (11) ──
const ATMOSPHERES: AtmosphereChar[] = [
  { color: [0, 0, 0],           thickness: 0,    clouds: 0,    tempRange: [0, 3000], minMass: 0,    rarity: 1 },     // vacuum
  { color: [0.38, 0.40, 0.45],  thickness: 0.12, clouds: 0.05, tempRange: [0, 2000], minMass: 0.01, rarity: 1 },     // thin haze
  { color: [0.32, 0.52, 0.80],  thickness: 0.55, clouds: 0.35, tempRange: [180, 500], minMass: 0.3,  rarity: 2 },    // blue Rayleigh
  { color: [0.58, 0.35, 0.10],  thickness: 0.45, clouds: 0.15, tempRange: [50, 200],  minMass: 0.1,  rarity: 2 },    // orange methane
  { color: [0.55, 0.50, 0.15],  thickness: 0.65, clouds: 0.40, tempRange: [300, 800], minMass: 0.5,  rarity: 2 },    // yellow sulfuric
  { color: [0.52, 0.32, 0.28],  thickness: 0.38, clouds: 0.20, tempRange: [150, 500], minMass: 0.2,  rarity: 2 },    // pink CO₂
  { color: [0.52, 0.28, 0.18],  thickness: 0.25, clouds: 0.10, tempRange: [180, 500], minMass: 0.15, rarity: 2 },    // red dust
  { color: [0.38, 0.22, 0.58],  thickness: 0.32, clouds: 0.25, tempRange: [50, 300],  minMass: 0.1,  rarity: 3 },    // purple nitrogen
  { color: [0.62, 0.52, 0.18],  thickness: 0.90, clouds: 0.75, tempRange: [400, 1000], minMass: 0.5, rarity: 3 },    // Venus soup
  { color: [0.48, 0.32, 0.14],  thickness: 0.58, clouds: 0.30, tempRange: [60, 200],  minMass: 0.02, rarity: 3 },    // Titan orange
  { color: [0.15, 0.42, 0.28],  thickness: 0.35, clouds: 0.20, tempRange: [200, 600], minMass: 0.3,  rarity: 3 },    // emerald haze
];

// ── Slot 3: Hydrosphere States (9) ──
const HYDROSPHERES: HydroState[] = [
  { color: [0, 0, 0],           level: 0,    tempRange: [0, 3000], needsAtm: false, rarity: 1 },     // dry
  { color: [0.04, 0.12, 0.30],  level: 0.42, tempRange: [270, 380], needsAtm: true,  rarity: 2 },    // water ocean
  { color: [0.06, 0.16, 0.28],  level: 0.32, tempRange: [270, 380], needsAtm: true,  rarity: 2 },    // shallow seas
  { color: [0.62, 0.16, 0.03],  level: 0.22, tempRange: [800, 3000], needsAtm: false, rarity: 2 },   // lava fields
  { color: [0.02, 0.06, 0.22],  level: 0.62, tempRange: [270, 380], needsAtm: true,  rarity: 3 },    // deep ocean
  { color: [0.14, 0.10, 0.05],  level: 0.28, tempRange: [80, 120],  needsAtm: false, rarity: 3 },    // methane lakes
  { color: [0.20, 0.22, 0.10],  level: 0.35, tempRange: [200, 270], needsAtm: true,  rarity: 3 },    // ammonia seas
  { color: [0.08, 0.14, 0.18],  level: 0.22, tempRange: [250, 400], needsAtm: true,  rarity: 3 },    // brine pools
  { color: [0.28, 0.30, 0.06],  level: 0.30, tempRange: [300, 700], needsAtm: false, rarity: 3 },    // sulfuric acid
];

/** Types where genome should NOT override visuals (highly specific identity) */
const NO_GENOME = new Set([
  ...GAS_TYPES,
  'lava-world', 'iron-planet', 'carbon-planet', 'eyeball-world',
  'moon-volcanic', 'moon-magma-ocean', 'moon-carbon-soot',
]);

/** Shift an RGB color in HSV space */
function shiftHSV(rgb: [number, number, number], dh: number, ds: number, dv: number): [number, number, number] {
  const [r, g, b] = rgb;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 0) {
    if (mx === r) h = ((g - b) / d + 6) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  let s = mx > 0 ? d / mx : 0;
  let v = mx;
  h = (h + dh + 1) % 1;
  s = Math.max(0, Math.min(1, s + ds));
  v = Math.max(0, Math.min(1, v + dv));
  const c = v * s, x = c * (1 - Math.abs((h * 6) % 2 - 1)), m = v - c;
  const hi = Math.floor(h * 6) % 6;
  const tbl: [number, number, number][] = [[c,x,0],[x,c,0],[0,c,x],[0,x,c],[x,0,c],[c,0,x]];
  const [rr, gg, bb] = tbl[hi] || [0, 0, 0];
  return [rr + m, gg + m, bb + m];
}

/** Apply world genome to visuals — called for eligible solid types */
function applyWorldGenome(vis: PlanetVisuals, seed: number, temp: number, mass: number): void {
  const surface = selectSlot(SURFACES, seed, 1, temp,
    s => !(s.tags.includes('atm') && mass < 0.1) &&
         !(s.tags.includes('metal') && mass < 0.002));
  const atmosphere = selectSlot(ATMOSPHERES, seed, 2, temp,
    a => mass >= a.minMass);
  const hasAtm = atmosphere.thickness > 0.05;
  const hydro = selectSlot(HYDROSPHERES, seed, 3, temp,
    h => !(h.needsAtm && !hasAtm));

  // Blend genome surface colors with base profile (70% genome, 30% base)
  const blend = 0.70;
  vis.color1 = [
    vis.color1[0] * (1 - blend) + surface.c1[0] * blend,
    vis.color1[1] * (1 - blend) + surface.c1[1] * blend,
    vis.color1[2] * (1 - blend) + surface.c1[2] * blend,
  ];
  vis.color2 = [
    vis.color2[0] * (1 - blend) + surface.c2[0] * blend,
    vis.color2[1] * (1 - blend) + surface.c2[1] * blend,
    vis.color2[2] * (1 - blend) + surface.c2[2] * blend,
  ];
  vis.color3 = [
    vis.color3[0] * (1 - blend) + surface.c3[0] * blend,
    vis.color3[1] * (1 - blend) + surface.c3[1] * blend,
    vis.color3[2] * (1 - blend) + surface.c3[2] * blend,
  ];

  // Per-world HSV shift for intra-regime variation (larger shifts = more diversity)
  const dh = (genomeHash(seed, 4) - 0.5) * 0.35;
  const ds = (genomeHash(seed, 5) - 0.5) * 0.30;
  const dv = (genomeHash(seed, 6) - 0.5) * 0.22;
  vis.color1 = shiftHSV(vis.color1, dh, ds, dv);
  vis.color2 = shiftHSV(vis.color2, dh * 0.8, ds * 0.8, dv * 0.8);
  vis.color3 = shiftHSV(vis.color3, dh * 0.5, ds * 0.6, dv * 0.4);

  // Atmosphere genome influence (only if genome picks a stronger atmosphere)
  if (atmosphere.thickness > vis.atmThickness * 0.3) {
    vis.atmColor = [
      vis.atmColor[0] * 0.2 + atmosphere.color[0] * 0.8,
      vis.atmColor[1] * 0.2 + atmosphere.color[1] * 0.8,
      vis.atmColor[2] * 0.2 + atmosphere.color[2] * 0.8,
    ];
    vis.atmThickness = Math.max(vis.atmThickness, atmosphere.thickness * 0.85);
    vis.clouds = Math.max(vis.clouds, atmosphere.clouds);
  }

  // Hydrosphere genome influence (changes ocean COLOR but not topology)
  if (hydro.level > 0.05 && vis.oceanLevel > 0.05) {
    vis.oceanColor = [
      vis.oceanColor[0] * 0.2 + hydro.color[0] * 0.8,
      vis.oceanColor[1] * 0.2 + hydro.color[1] * 0.8,
      vis.oceanColor[2] * 0.2 + hydro.color[2] * 0.8,
    ];
  }
}

/* ── GLSL Shaders ────────────────────────────────────── */

const VERT = /* glsl */ `
uniform float uDisplacement;
uniform float uSeedV;
uniform float uNoiseScaleV;
uniform float uIsGasV;
uniform float uOceanLevelV;
uniform float uCraterDensityV;
uniform float uMountainHeightV;
uniform float uValleyDepthV;
uniform float uVolcanismV;
uniform float uTerrainAgeV;
uniform float uTectonicsV;

varying vec3 vObjPos;
varying vec3 vNormal;
varying vec3 vViewDir;
varying float vFresnel;

/* ── Inline noise for vertex displacement ── */
float vHash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float vNoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(vHash(i), vHash(i+vec3(1,0,0)), f.x),
        mix(vHash(i+vec3(0,1,0)), vHash(i+vec3(1,1,0)), f.x), f.y),
    mix(mix(vHash(i+vec3(0,0,1)), vHash(i+vec3(1,0,1)), f.x),
        mix(vHash(i+vec3(0,1,1)), vHash(i+vec3(1,1,1)), f.x), f.y), f.z);
}
float vFbm(vec3 p) {
  float f = 0.0, amp = 0.5;
  for (int i = 0; i < 5; i++) { f += amp * vNoise(p); p *= 2.03; amp *= 0.48; }
  return f;
}
float vWarpedFbm(vec3 p) {
  vec3 q = vec3(vFbm(p), vFbm(p + vec3(5.2,1.3,2.8)), vFbm(p + vec3(1.7,9.2,3.4)));
  return vFbm(p + q * 1.5);
}
/* Ridged noise for mountains */
float vRidged(vec3 p) {
  float f = 0.0, amp = 0.5;
  for (int i = 0; i < 4; i++) {
    float n = 1.0 - abs(vNoise(p) * 2.0 - 1.0);
    f += n * n * amp; p *= 2.1; amp *= 0.45;
  }
  return f;
}

float vertexHeight(vec3 pos) {
  float h = vWarpedFbm(pos * uNoiseScaleV + uSeedV);
  // Mountains
  if (uMountainHeightV > 0.01) {
    h += vRidged(pos * 3.5 + uSeedV * 0.7) * uMountainHeightV * 0.35;
  }
  // Valleys (carve)
  if (uValleyDepthV > 0.01) {
    float v = abs(vNoise(pos * 4.0 + uSeedV * 1.3) * 2.0 - 1.0);
    v = pow(v, 0.3);
    h -= (1.0 - v) * uValleyDepthV * 0.20;
  }
  // Volcanism (peaks)
  if (uVolcanismV > 0.01) {
    float vp = 1.0 - smoothstep(0.0, 0.25, length(fract(pos * 2.5 + uSeedV) - 0.5));
    h += vp * uVolcanismV * 0.18;
  }
  return h;
}

void main() {
  vObjPos = position;
  vec3 displaced = position;
  if (uIsGasV < 0.5 && uDisplacement > 0.001) {
    vec3 dir = normalize(position);
    float h = vertexHeight(dir);
    // Clamp to ocean floor (no displacement below ocean level)
    float terrain = max(h, uOceanLevelV);
    float disp = (terrain - 0.5) * uDisplacement;
    displaced = position + dir * disp;
  }
  vNormal = normalize(normalMatrix * normal);
  vec4 worldPos = modelMatrix * vec4(displaced, 1.0);
  vViewDir = normalize(cameraPosition - worldPos.xyz);
  vFresnel = 1.0 - max(dot(vNormal, vViewDir), 0.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;

uniform float uTime;
uniform vec3  uColor1;
uniform vec3  uColor2;
uniform vec3  uColor3;
uniform vec3  uOceanColor;
uniform float uOceanLevel;
uniform vec3  uAtmColor;
uniform float uAtmThickness;
uniform float uEmissive;
uniform float uIceCaps;
uniform float uCloudDensity;
uniform float uNoiseScale;
uniform vec3  uSunDir;
uniform float uIsGas;
uniform float uSeed;
uniform float uCraterDensity;
uniform float uCrackIntensity;
uniform float uMountainHeight;
uniform float uValleyDepth;
uniform float uVolcanism;
uniform float uIsIceWorld;
uniform float uTerrainAge;
uniform float uTectonics;
uniform vec3  uFoliageColor;

// ── Tidal lock + temperature distribution ──
uniform float uTidallyLocked;
uniform float uSpinOrbit32;
uniform float uShowTempMap;
uniform float uSubstellarTemp;
uniform float uAntistellarTemp;
uniform float uEquatorTemp;
uniform float uPolarTemp;
uniform float uHeatRedist;
// Storm system
uniform float uStormLat;
uniform float uStormLon;
uniform float uStormSize;
uniform float uStormIntensity;
// Mineral overlay
uniform float uShowMineralMap;
uniform float uIronPct;
uniform float uSilicatePct;
uniform float uWaterIcePct;
uniform float uKreepIndex;
uniform float uCarbonPct;

varying vec3  vObjPos;
varying vec3  vNormal;
varying vec3  vViewDir;
varying float vFresnel;

/* ── 3D value noise ── */
float hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise3D(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i),              hash(i + vec3(1,0,0)), f.x),
        mix(hash(i + vec3(0,1,0)),hash(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash(i + vec3(0,0,1)),hash(i + vec3(1,0,1)), f.x),
        mix(hash(i + vec3(0,1,1)),hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}

float fbm(vec3 p) {
  float f = 0.0, amp = 0.5;
  for (int i = 0; i < 6; i++) { f += amp * noise3D(p); p *= 2.03; amp *= 0.48; }
  return f;
}

/* ── Domain warp for richer features ── */
float warpedFbm(vec3 p) {
  vec3 q = vec3(fbm(p), fbm(p + vec3(5.2, 1.3, 2.8)), fbm(p + vec3(1.7, 9.2, 3.4)));
  return fbm(p + q * 1.5);
}

/* ── Voronoi for impact crater placement ── */
vec2 voronoi3D(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  float md = 1e5, cid = 0.0;
  for (int x = -1; x <= 1; x++)
  for (int y = -1; y <= 1; y++)
  for (int z = -1; z <= 1; z++) {
    vec3 nb = vec3(float(x), float(y), float(z));
    vec3 id = i + nb;
    vec3 pt = nb + vec3(hash(id), hash(id + 71.0), hash(id + 113.0)) * 0.76 + 0.12 - f;
    float d = dot(pt, pt);
    if (d < md) { md = d; cid = hash(id + 37.0); }
  }
  return vec2(sqrt(md), cid);
}

/* ── Voronoi returning nearest + 2nd-nearest cells ── */
vec4 voronoi3D_dual(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  float md1 = 1e5, cid1 = 0.0;
  float md2 = 1e5, cid2 = 0.0;
  for (int x = -1; x <= 1; x++)
  for (int y = -1; y <= 1; y++)
  for (int z = -1; z <= 1; z++) {
    vec3 nb = vec3(float(x), float(y), float(z));
    vec3 id = i + nb;
    vec3 pt = nb + vec3(hash(id), hash(id + 71.0), hash(id + 113.0)) * 0.76 + 0.12 - f;
    float d = dot(pt, pt);
    if (d < md1) {
      md2 = md1; cid2 = cid1;
      md1 = d; cid1 = hash(id + 37.0);
    } else if (d < md2) {
      md2 = d; cid2 = hash(id + 37.0);
    }
  }
  return vec4(sqrt(md1), cid1, sqrt(md2), cid2);
}

/* ── Domain-warped dual voronoi for organic biome boundaries ── */
/* Returns vec4(d1, id1, d2, id2): nearest + 2nd-nearest cells.
   FBM domain warping bends cell edges into natural continent shapes. */
vec4 biomeVoronoi(vec3 p) {
  vec3 warp = vec3(
    fbm(p * 0.8 + vec3(0.0, 3.1, 7.4)),
    fbm(p * 0.8 + vec3(5.2, 1.3, 2.8)),
    fbm(p * 0.8 + vec3(1.7, 9.2, 3.4))
  );
  vec3 wp = p + warp * 0.55;
  return voronoi3D_dual(wp * 1.6);
}

/* ── Biome classification from cell hash ID ── */
float classifyBiome(float id) {
  float bh = fract(id * 7.7 + 0.13);
  if (bh > 0.85)      return 2.0;
  else if (bh > 0.70) return 4.0;
  else if (bh > 0.52) return 1.0;
  else if (bh > 0.35) return 0.0;
  else if (bh > 0.18) return 3.0;
  else                 return 5.0;
}

/* ── Per-biome terrain multipliers ── */
void biomeTerrainMults(float b, out float mc, out float mm, out float mv, out float mf) {
  if (b < 0.5)      { mc=0.25; mm=0.12; mv=0.15; mf=0.05; }
  else if (b < 1.5) { mc=0.45; mm=2.80; mv=2.00; mf=0.15; }
  else if (b < 2.5) { mc=0.10; mm=0.70; mv=0.40; mf=4.00; }
  else if (b < 3.5) { mc=0.20; mm=0.08; mv=0.10; mf=0.06; }
  else if (b < 4.5) { mc=0.35; mm=1.00; mv=3.50; mf=0.25; }
  else              { mc=0.75; mm=0.55; mv=0.35; mf=0.12; }
}

/* ── Per-biome color palette ── */
void biomePalette(float b, out vec3 c1, out vec3 c2, out vec3 c3) {
  if (b < 0.5)      { c1=vec3(0.74,0.58,0.30); c2=vec3(0.62,0.46,0.22); c3=vec3(0.84,0.74,0.52); }
  else if (b < 1.5) { c1=vec3(0.44,0.41,0.37); c2=vec3(0.34,0.32,0.29); c3=vec3(0.82,0.80,0.78); }
  else if (b < 2.5) { c1=vec3(0.16,0.12,0.10); c2=vec3(0.10,0.07,0.05); c3=vec3(0.22,0.16,0.12); }
  else if (b < 3.5) { c1=vec3(0.15,0.13,0.12); c2=vec3(0.21,0.19,0.17); c3=vec3(0.28,0.25,0.22); }
  else if (b < 4.5) { c1=vec3(0.52,0.38,0.22); c2=vec3(0.40,0.28,0.16); c3=vec3(0.64,0.52,0.36); }
  else              { c1=vec3(0.56,0.50,0.40); c2=vec3(0.48,0.43,0.34); c3=vec3(0.70,0.65,0.56); }
}

/* ── Vegetation suppression per biome ── */
float biomeVegSuppress(float b) {
  if (b < 0.5) return 0.06;
  if (b > 1.5 && b < 2.5) return 0.0;
  if (b > 2.5 && b < 3.5) return 0.30;
  if (b > 0.5 && b < 1.5) return 0.45;
  return 1.0;
}

float craterBowl(float d, float R) {
  float t = d / R;
  if (t > 1.6) return 0.0;
  // Deep bowl with flat floor
  float bowl = (1.0 - smoothstep(0.0, 0.80, t)) * -1.0;
  float flatFloor = smoothstep(0.0, 0.20, t);
  // Raised rim with ejecta blanket
  float rim = exp(-((t - 1.0) * (t - 1.0)) / 0.02) * 0.55;
  float ejecta = exp(-((t - 1.3) * (t - 1.3)) / 0.06) * 0.18;
  // Central peak for large craters
  float peak = exp(-(t * t) / 0.005) * 0.25 * step(0.25, R);
  // Terraced walls inside the bowl
  float terrace = sin(t * 12.0) * 0.03 * (1.0 - smoothstep(0.7, 1.0, t)) * step(0.22, R);
  return (bowl * flatFloor + rim + ejecta + peak + terrace) * 0.40;
}

float craterField(vec3 pos, float density, float seed) {
  vec3 sp = pos + vec3(seed, seed * 0.73, seed * 1.37);
  float h = 0.0;
  // Giant basin impacts
  vec2 v1 = voronoi3D(sp * 4.0);
  if (v1.y < density * 0.6) h += craterBowl(v1.x, 0.32 + v1.y * 0.25);
  // Large craters
  vec2 v2 = voronoi3D(sp * 10.0 + 100.0);
  if (v2.y < density) h += craterBowl(v2.x, 0.20 + v2.y * 0.16) * 0.55;
  // Medium craters
  vec2 v3 = voronoi3D(sp * 22.0 + 200.0);
  if (v3.y < density * 0.7) h += craterBowl(v3.x, 0.14 + v3.y * 0.10) * 0.32;
  // Small craters
  vec2 v4 = voronoi3D(sp * 48.0 + 300.0);
  if (v4.y < density * 0.5) h += craterBowl(v4.x, 0.08 + v4.y * 0.06) * 0.18;
  return h;
}

/* ── Ridge / crack pattern for icy moons ── */
float crackPattern(vec3 pos, float intensity, float seed) {
  vec3 q = pos * 6.0;
  q += vec3(fbm(q + seed), fbm(q + seed + 20.0), fbm(q + seed + 40.0)) * 0.8;
  float r1 = 1.0 - abs(fbm(q) * 2.0 - 1.0);
  float r2 = 1.0 - abs(fbm(q * 2.3 + 10.0) * 2.0 - 1.0);
  r1 = pow(r1, 4.0);
  r2 = pow(r2, 4.0);
  return (r1 * 0.65 + r2 * 0.35) * intensity;
}

/* ── Ridged FBM for mountain ranges ── */
float ridgedFbm(vec3 p) {
  float f = 0.0, amp = 0.5;
  for (int i = 0; i < 5; i++) {
    float n = abs(noise3D(p) * 2.0 - 1.0);
    n = 1.0 - n;           // peaks at fold lines
    n = n * n;              // sharpen ridges
    f += amp * n;
    p *= 2.12;
    amp *= 0.46;
  }
  return f;
}

float mountainRidges(vec3 pos, float height, float seed) {
  if (height < 0.01) return 0.0;
  vec3 p = pos * 4.0 + seed * 13.7;
  // Domain warp for natural-looking ranges
  p += vec3(noise3D(p * 0.7) * 1.5, noise3D(p * 0.7 + 31.0) * 1.5, noise3D(p * 0.7 + 67.0) * 1.5);
  float ridges = ridgedFbm(p);
  // Regional mask: mountains only in some areas
  float mask = smoothstep(0.38, 0.60, noise3D(pos * 2.0 + seed + 77.0));
  return ridges * mask * height * 0.45;
}

/* ── Rift valleys & canyon networks ── */
float valleyCarve(vec3 pos, float depth, float seed) {
  if (depth < 0.01) return 0.0;
  vec3 p = pos * 3.0 + seed * 9.3;
  // Domain warp
  p += vec3(noise3D(p + 30.0), noise3D(p + 50.0), noise3D(p + 70.0)) * 0.8;
  // Sharp valleys from absolute value noise
  float v = abs(noise3D(p * 3.0) * 2.0 - 1.0);
  v = min(v, abs(noise3D(p * 5.5 + 11.0) * 2.0 - 1.0));
  v = pow(v, 0.6);         // sharpen
  v = 1.0 - v;             // invert: valleys are negative
  // Regional mask
  float mask = smoothstep(0.38, 0.58, noise3D(pos * 1.5 + seed + 99.0));
  return -v * mask * depth * 0.30;
}

/* ── Volcanic cones & calderas ── */
float volcanicCone(float d, float R) {
  float t = d / R;
  if (t > 2.0) return 0.0;
  // Shield volcano: broad base, steep near summit
  float cone = 1.0 - smoothstep(0.0, 1.5, t);
  cone = pow(cone, 1.8) * 0.50;
  // Caldera depression at summit
  float caldera = exp(-(t * t) / 0.012) * 0.20;
  return cone - caldera;
}

float volcanicField(vec3 pos, float volcanism, float seed) {
  if (volcanism < 0.01) return 0.0;
  vec3 sp = pos + vec3(seed * 1.1, seed * 0.57, seed * 1.83);
  float h = 0.0;
  // Sparse large shield volcanoes
  vec2 v1 = voronoi3D(sp * 3.5);
  if (v1.y < volcanism * 0.35) h += volcanicCone(v1.x, 0.35 + v1.y * 0.15);
  // Medium volcanic peaks
  vec2 v2 = voronoi3D(sp * 7.0 + 150.0);
  if (v2.y < volcanism * 0.5) h += volcanicCone(v2.x, 0.22 + v2.y * 0.12) * 0.55;
  return h * volcanism;
}

/* ── Temperature map coloring — maps temperature K to thermal palette ── */
vec3 tempToColor(float tempK) {
  // Scientific thermal palette: blue(40K) → cyan(150K) → green(250K) → yellow(320K) → orange(500K) → red(1000K) → white(2000K+)
  if (tempK < 80.0)   return mix(vec3(0.05, 0.05, 0.2), vec3(0.1, 0.2, 0.6), tempK / 80.0);
  if (tempK < 180.0)  return mix(vec3(0.1, 0.2, 0.6), vec3(0.1, 0.5, 0.6), (tempK - 80.0) / 100.0);
  if (tempK < 280.0)  return mix(vec3(0.1, 0.5, 0.6), vec3(0.2, 0.7, 0.2), (tempK - 180.0) / 100.0);
  if (tempK < 350.0)  return mix(vec3(0.2, 0.7, 0.2), vec3(0.8, 0.7, 0.1), (tempK - 280.0) / 70.0);
  if (tempK < 600.0)  return mix(vec3(0.8, 0.7, 0.1), vec3(0.9, 0.3, 0.05), (tempK - 350.0) / 250.0);
  if (tempK < 1500.0) return mix(vec3(0.9, 0.3, 0.05), vec3(1.0, 0.1, 0.05), (tempK - 600.0) / 900.0);
  return mix(vec3(1.0, 0.1, 0.05), vec3(1.0, 0.9, 0.8), min((tempK - 1500.0) / 2000.0, 1.0));
}

/* ── Compute surface temperature at a given position ── */
float surfaceTemp(vec3 pos, vec3 sunDir) {
  if (uTidallyLocked > 0.5) {
    if (uSpinOrbit32 > 0.5) {
      // 3:2 resonance — two "hot longitudes" 180° apart
      float lon = atan(pos.z, pos.x);
      float hotPhase = cos(lon * 2.0) * 0.5 + 0.5; // peaks at 0° and 180°
      float lat = abs(pos.y);
      float latFade = 1.0 - lat * 0.4;
      return mix(uAntistellarTemp, uSubstellarTemp, hotPhase * latFade);
    } else {
      // 1:1 synchronous — substellar point always faces star
      float facing = dot(pos, sunDir);  // -1 (anti) to +1 (sub)
      float t = facing * 0.5 + 0.5;    // 0 (anti) to 1 (sub)
      // smooth transition through terminator
      float tSmooth = smoothstep(0.0, 1.0, t);
      // atmospheric redistribution softens contrast
      tSmooth = mix(tSmooth, 0.5, uHeatRedist * 0.7);
      return mix(uAntistellarTemp, uSubstellarTemp, tSmooth);
    }
  } else {
    // Free rotator — latitudinal gradient (equator to pole)
    float lat = abs(pos.y);
    float latT = smoothstep(0.0, 0.85, lat);
    return mix(uEquatorTemp, uPolarTemp, latT);
  }
}

/* ── Substellar storm (tidally locked worlds) ── */
float tidalStorm(vec3 pos, vec3 sunDir, float time) {
  if (uStormIntensity < 0.01) return 0.0;
  // Storm center at substellar point
  float stormAngle = acos(clamp(dot(pos, sunDir), -1.0, 1.0));
  float stormRadius = radians(uStormSize);
  float stormMask = 1.0 - smoothstep(stormRadius * 0.3, stormRadius, stormAngle);
  // Spiral arms
  float lon = atan(pos.z, pos.x);
  float lat = asin(clamp(pos.y, -1.0, 1.0));
  float spiral = sin(stormAngle * 15.0 - lon * 3.0 + time * 0.3 + lat * 2.0) * 0.5 + 0.5;
  float arms = smoothstep(0.25, 0.65, spiral) * stormMask;
  // Turbulent eye wall
  float eyewall = smoothstep(stormRadius * 0.08, stormRadius * 0.18, stormAngle) *
                  (1.0 - smoothstep(stormRadius * 0.18, stormRadius * 0.35, stormAngle));
  float turbulence = fbm(pos * 12.0 + vec3(time * 0.08, 0.0, 0.0)) * eyewall;
  return (arms * 0.6 + stormMask * 0.25 + turbulence * 0.35) * uStormIntensity;
}

/* ── Mineral overlay coloring ── */
vec3 mineralColor(vec3 pos) {
  // Procedural mineral distribution using voronoi + noise
  vec3 sp = pos * 6.0 + uSeed * 0.5;
  vec2 v = voronoi3D(sp);
  float n = fbm(sp * 2.0);

  // Iron deposits (red) — concentrated in lower elevations, near volcanic regions
  float ironWeight = uIronPct / 100.0;
  float ironZone = smoothstep(0.3, 0.7, n) * ironWeight;

  // Silicate regions (yellow/tan) — dominant in highlands
  float silWeight = uSilicatePct / 100.0;
  float silZone = smoothstep(0.2, 0.6, 1.0 - n) * silWeight;

  // Water ice (blue) — polar and high elevation
  float iceWeight = uWaterIcePct / 100.0;
  float lat = abs(pos.y);
  float iceZone = smoothstep(0.3, 0.8, lat + n * 0.3) * iceWeight;

  // KREEP terranes (magenta) — localized deposits
  float kreepZone = 0.0;
  if (uKreepIndex > 0.1) {
    float kv = voronoi3D(sp * 1.8 + 77.0).x;
    kreepZone = (1.0 - smoothstep(0.0, 0.15, kv)) * uKreepIndex;
  }

  // Carbon deposits (dark gray-brown)
  float carbonZone = 0.0;
  if (uCarbonPct > 1.0) {
    carbonZone = smoothstep(0.4, 0.8, fbm(sp * 3.0 + 50.0)) * uCarbonPct / 100.0;
  }

  // Compose mineral overlay
  vec3 col = vec3(0.15, 0.15, 0.18);  // base dark
  col = mix(col, vec3(0.9, 0.2, 0.1), ironZone);    // iron = red
  col = mix(col, vec3(0.85, 0.75, 0.3), silZone);    // silicate = yellow
  col = mix(col, vec3(0.2, 0.5, 0.95), iceZone);     // water = blue
  col = mix(col, vec3(0.8, 0.15, 0.7), kreepZone);   // KREEP = magenta
  col = mix(col, vec3(0.25, 0.22, 0.18), carbonZone); // carbon = dark brown
  return col;
}

void main() {
  vec3 pos = normalize(vObjPos);
  vec3 N = normalize(vNormal);
  vec3 L = normalize(uSunDir);
  vec3 V = normalize(vViewDir);
  vec3 H = normalize(L + V);
  float NdotL = max(dot(N, L), 0.0);
  float rim = vFresnel;

  vec3 finalColor;

  if (uIsGas > 0.5) {
    // ════════════════════════════════════════════
    //  GAS GIANT — turbulent bands + multi-storm
    // ════════════════════════════════════════════
    float lat = pos.y;
    float lon = atan(pos.z, pos.x);

    // === Turbulent band structure with multiple warp layers ===
    float warp  = fbm(pos * 2.5 + uSeed) * 2.2;
    float warp2 = fbm(pos * 4.0 + uSeed + 42.0) * 0.8;
    float bandVal = sin(lat * 18.0 + warp) * 0.5 + 0.5;

    // Fine sub-band structure
    float fine = sin(lat * 52.0 + fbm(pos * 7.0 + uSeed + 20.0) * 2.5) * 0.5 + 0.5;

    // Turbulent eddies along band boundaries
    float bandEdge = abs(fract(lat * 2.86 + warp * 0.15) - 0.5) * 2.0;
    float edgeTurb = smoothstep(0.25, 0.48, bandEdge);
    float turb = fbm(pos * 12.0 + vec3(uTime * 0.008, 0, uSeed + 70.0)) * edgeTurb;
    bandVal = bandVal * 0.58 + fine * 0.24 + turb * 0.18;

    // === Richer band coloring with 3-zone gradient ===
    vec3 color;
    if (bandVal < 0.38) {
      color = mix(uColor2, uColor1, smoothstep(0.12, 0.38, bandVal));
    } else if (bandVal < 0.62) {
      color = mix(uColor1, uColor1 * 1.12 + uColor3 * 0.06, smoothstep(0.38, 0.62, bandVal));
    } else {
      color = mix(uColor1 * 1.12, uColor2 * 0.88, smoothstep(0.62, 1.0, bandVal));
    }

    // === Multiple storm ovals ===
    // Great storm spot (large, prominent)
    float spotAngle = uSeed * 2.0;
    vec2 spotCenter = vec2(cos(spotAngle) * 0.35, -0.15 + sin(uSeed * 3.0) * 0.2);
    float spotDist = length(pos.xz - spotCenter);
    float spot = 1.0 - smoothstep(0.0, 0.14, spotDist);
    float swirl = fbm(pos * 8.0 + vec3(0, 0, uTime * 0.015) + uSeed + 50.0);
    spot *= smoothstep(0.28, 0.55, swirl);
    color = mix(color, uColor3, spot * 0.85);

    // Secondary storm (different latitude)
    float s2Angle = uSeed * 4.7 + 2.1;
    vec2 s2Center = vec2(cos(s2Angle) * 0.30, 0.25 + sin(uSeed * 5.0) * 0.15);
    float s2Dist = length(pos.xz - s2Center);
    float s2 = 1.0 - smoothstep(0.0, 0.075, s2Dist);
    s2 *= smoothstep(0.3, 0.6, fbm(pos * 12.0 + vec3(0, 0, uTime * 0.02) + uSeed + 90.0));
    color = mix(color, uColor3 * 0.85 + uColor1 * 0.15, s2 * 0.70);

    // White oval chain (3 small anticyclones)
    for (int si = 0; si < 3; si++) {
      float sAngle = uSeed * 3.3 + float(si) * 1.8;
      vec2 sC = vec2(cos(sAngle) * 0.26 + float(si) * 0.09,
                     -0.36 + sin(uSeed * 7.0 + float(si)) * 0.06);
      float sD = length(pos.xz - sC);
      float sSp = 1.0 - smoothstep(0.0, 0.04, sD);
      sSp *= smoothstep(0.25, 0.5, fbm(pos * 16.0 + uSeed + float(si) * 30.0));
      vec3 whiteOval = mix(uColor1 * 1.2, vec3(0.92, 0.88, 0.80), 0.55);
      color = mix(color, whiteOval, sSp * 0.50);
    }

    // === Chevron / festoon patterns at belt-zone boundaries ===
    float chevron = sin(lon * 8.0 + lat * 25.0 + warp2 * 6.0) * 0.5 + 0.5;
    chevron *= smoothstep(0.35, 0.50, bandEdge) * (1.0 - smoothstep(0.50, 0.65, bandEdge));
    color = mix(color, uColor2 * 0.72, chevron * 0.14);

    // === Polar regions — chaotic / muted (Saturn hex, Jupiter vortex swirl) ===
    float polar = smoothstep(0.55, 0.82, abs(lat));
    float polarNoise = fbm(pos * 6.0 + uSeed + 200.0);
    vec3 polarColor = mix(uColor2 * 0.62, uColor1 * 0.50, polarNoise);
    color = mix(color, polarColor, polar * 0.72);

    // Belt shading (zones brighter than belts)
    float zoneShade = sin(lat * 18.0 + warp) * 0.06;
    color += zoneShade;

    // Very soft Lambert (gas giants are self-illuminated-looking)
    float diff = NdotL * 0.30 + 0.70;
    color *= diff;

    // Hot jupiter glow
    if (uEmissive > 0.01) {
      float nightFactor = 1.0 - smoothstep(-0.05, 0.2, NdotL);
      color += vec3(1.0, 0.35, 0.08) * nightFactor * uEmissive * 1.8;
    }

    // Deep atmosphere rim (reduced — separate shell handles outer glow)
    float gasRim = pow(rim, 2.2) * uAtmThickness;
    color += uAtmColor * gasRim * 0.30;

    // Limb darkening
    color *= (1.0 - pow(rim, 3.0) * 0.25);

    finalColor = color;

  } else {
    // ════════════════════════════════════════════
    //  SOLID WORLD — terrain + ocean + ice + lava
    // ════════════════════════════════════════════

    // ══════════════════════════════════════════════════
    //  BIOME TERRITORY SYSTEM — dramatically distinct regions
    // ══════════════════════════════════════════════════
    // ── Dual-cell biome voronoi (overlapping textures with faded edges) ──
    vec4 terr = biomeVoronoi(pos + uSeed * 3.0);
    float d1 = terr.x, tID = terr.y, d2 = terr.z, tID2 = terr.w;

    // Edge blend factor: 0 = deep inside primary cell, 1 = right at boundary
    float edgeDist = d2 - d1;
    float edgeBlend = 1.0 - smoothstep(0.02, 0.30, edgeDist);
    float tBorder = 1.0 - smoothstep(0.02, 0.05, edgeDist);

    // Classify both neighboring biomes
    float biome  = classifyBiome(tID);
    float biome2 = classifyBiome(tID2);

    // Crossfade weight (caps at 50% so primary biome stays dominant)
    float bw = edgeBlend * 0.5;

    // Compat flags for ocean / cloud / ice subsystems (primary biome)
    float tVolcanic = step(1.5, biome) * step(biome, 2.5);
    float tMare     = step(2.5, biome) * step(biome, 3.5);
    float tTectonic = min(step(0.5, biome) * step(biome, 1.5)
                       + step(3.5, biome) * step(biome, 4.5), 1.0);
    float tHighland = step(4.5, biome);

    // Blended terrain parameters (smooth transition between biomes)
    float mc1, mm1, mv1, mf1;
    biomeTerrainMults(biome, mc1, mm1, mv1, mf1);
    float mc2, mm2, mv2, mf2;
    biomeTerrainMults(biome2, mc2, mm2, mv2, mf2);
    // Age-modulated: ancient → more craters, less volcanism; young → opposite
    float ageCraterMult = 0.5 + uTerrainAge * 1.2;   // 0.5 at age=0, 1.7 at age=1
    float ageVolcMult = 1.5 - uTerrainAge * 1.2;     // 1.5 at age=0, 0.3 at age=1
    float ageMountMult = 1.0 - uTerrainAge * 0.35;   // eroded peaks on old worlds
    // Tectonics-modulated: active → sharper ridges, deeper valleys
    float tectMountMult = 1.0 + uTectonics * 0.8;
    float tectValleyMult = 1.0 + uTectonics * 0.6;
    float lCrater = uCraterDensity * mix(mc1, mc2, bw) * ageCraterMult;
    float lMount  = uMountainHeight * mix(mm1, mm2, bw) * ageMountMult * tectMountMult;
    float lValley = uValleyDepth * mix(mv1, mv2, bw) * tectValleyMult;
    float lVolc   = uVolcanism * mix(mf1, mf2, bw) * ageVolcMult;

    // Micro-feature strength (fades near biome edges)
    float microStr = 1.0 - edgeBlend * 0.80;

    // Ice world: smooth surfaces, far fewer craters, weaker mountains
    if (uIsIceWorld > 0.5) {
      lCrater *= 0.15;
      lMount  *= 0.30;
      lVolc   *= 0.40;
    }

    // ── Terrain height with domain warping
    float h  = warpedFbm(pos * uNoiseScale + uSeed);
    float eps = 0.003;
    float hx = warpedFbm((pos + vec3(eps, 0, 0)) * uNoiseScale + uSeed);
    float hz = warpedFbm((pos + vec3(0, 0, eps)) * uNoiseScale + uSeed);

    // Ice world: smooth undulating ice plains in mare territories
    if (uIsIceWorld > 0.5) {
      float smoothIce = fbm(pos * 2.0 + uSeed + 400.0) * 0.25;
      h  = mix(h,  smoothIce, tMare * 0.70);
      hx = mix(hx, smoothIce, tMare * 0.70);
      hz = mix(hz, smoothIce, tMare * 0.70);
    }

    // ── Impact craters (territory-modulated density)
    if (lCrater > 0.01) {
      float cH  = craterField(pos, lCrater, uSeed);
      float cHx = craterField(pos + vec3(eps, 0, 0), lCrater, uSeed);
      float cHz = craterField(pos + vec3(0, 0, eps), lCrater, uSeed);
      h += cH; hx += cHx; hz += cHz;
    }

    // ── Mountain ridges (territory-modulated, tectonic zones get more)
    if (lMount > 0.01) {
      float mH  = mountainRidges(pos, lMount, uSeed);
      float mHx = mountainRidges(pos + vec3(eps, 0, 0), lMount, uSeed);
      float mHz = mountainRidges(pos + vec3(0, 0, eps), lMount, uSeed);
      h += mH; hx += mHx; hz += mHz;
    }

    // ── Rift valleys & canyon networks
    if (lValley > 0.01) {
      float vH  = valleyCarve(pos, lValley, uSeed);
      float vHx = valleyCarve(pos + vec3(eps, 0, 0), lValley, uSeed);
      float vHz = valleyCarve(pos + vec3(0, 0, eps), lValley, uSeed);
      h += vH; hx += vHx; hz += vHz;
    }

    // ── Volcanic peaks & shield volcanoes (concentrated in volcanic territories)
    if (lVolc > 0.01) {
      float fH  = volcanicField(pos, lVolc, uSeed);
      float fHx = volcanicField(pos + vec3(eps, 0, 0), lVolc, uSeed);
      float fHz = volcanicField(pos + vec3(0, 0, eps), lVolc, uSeed);
      h += fH; hx += fHx; hz += fHz;
    }

    // ── Biome terrain modifiers (fade near edges) ──
    float terrModStr = 1.0 - edgeBlend * 0.65;
    // Desert: flatten + dune wave overlay
    if (biome < 0.5) {
      float duneDir = fract(tID * 3.3) * 6.28;
      vec3 dVec = vec3(cos(duneDir), 0.0, sin(duneDir));
      float duneW = sin(dot(pos, dVec) * 35.0 + fbm(pos * 2.5 + uSeed + 200.0) * 4.0) * 0.012;
      float flatBase = warpedFbm(pos * uNoiseScale * 0.3 + uSeed + 100.0) * 0.35;
      float fAmt = terrModStr * 0.55;
      h  = mix(h,  flatBase + duneW, fAmt);
      hx = mix(hx, flatBase + duneW, fAmt);
      hz = mix(hz, flatBase + duneW, fAmt);
    }
    // Mare basin: flatten to ancient eroded plain
    if (biome > 2.5 && biome < 3.5) {
      float flatBase = warpedFbm(pos * uNoiseScale * 0.2 + uSeed + 150.0) * 0.20;
      float fAmt = terrModStr * 0.65;
      h  = mix(h,  flatBase, fAmt);
      hx = mix(hx, flatBase, fAmt);
      hz = mix(hz, flatBase, fAmt);
    }

    // ── Bump normals (strong relief)
    vec3 bumpN = normalize(N + vec3(h - hx, 0.04, h - hz) * 18.0);

    // Height-based coloring
    vec3 color;
    bool isOcean = h < uOceanLevel;

    if (isOcean) {
      float depth = (uOceanLevel - h) / max(uOceanLevel, 0.01);

      // ── Compute seafloor terrain color first (as if land) ──
      float tSeafloor = (h) / max(1.0 - uOceanLevel, 0.01);
      float slopeSeafloor = length(vec2(h - hx, h - hz)) * 120.0;
      vec3 bC1sf, bC2sf, bC3sf;
      biomePalette(biome, bC1sf, bC2sf, bC3sf);
      bC1sf = mix(uColor1, bC1sf, 0.60);
      bC2sf = mix(uColor2, bC2sf, 0.50);
      vec3 seafloorCol;
      if (tSeafloor < 0.35) {
        seafloorCol = mix(bC1sf, bC2sf, smoothstep(0.0, 0.35, tSeafloor));
      } else {
        seafloorCol = mix(bC2sf, bC1sf * 0.6, smoothstep(0.35, 1.0, tSeafloor));
      }
      // darken seafloor slightly (sediment/mud)
      seafloorCol *= 0.75;

      // ── Water absorption — deeper water absorbs more light ──
      // Shallow water is semi-transparent, deep water opaque
      float waterOpacity = smoothstep(0.0, 0.35, depth); // 0=shore(transparent) to 1=deep(opaque)

      // Water color (layered depth)
      vec3 shallow = uOceanColor * 2.2 + vec3(0.03, 0.08, 0.05);
      vec3 mid = uOceanColor * 0.65;
      vec3 deep = uOceanColor * 0.25;
      vec3 abyss = vec3(0.01, 0.02, 0.06);
      vec3 waterCol;
      if (depth < 0.20) {
        waterCol = mix(shallow, mid, smoothstep(0.0, 0.20, depth));
      } else if (depth < 0.55) {
        waterCol = mix(mid, deep, smoothstep(0.20, 0.55, depth));
      } else {
        waterCol = mix(deep, abyss, smoothstep(0.55, 0.95, depth));
      }

      // ── Blend seafloor visible through water ──
      // Near shore: see terrain through the water clearly
      // Deep: water color dominates
      color = mix(seafloorCol, waterCol, waterOpacity);

      // Shore foam
      float shore = 1.0 - smoothstep(0.0, 0.03, uOceanLevel - h);
      color = mix(color, vec3(0.55, 0.62, 0.52), shore * 0.40);

      // Ocean current patterns (visible from orbit)
      float current = fbm(pos * 4.5 + vec3(uTime * 0.006, uSeed, uTime * 0.004));
      float currentLine = abs(current * 2.0 - 1.0);
      currentLine = 1.0 - pow(currentLine, 0.4);
      color += uOceanColor * 0.14 * currentLine * (1.0 - depth * 0.7);

      // Territory-sensitive ocean features
      if (tMare > 0.2 && depth < 0.30) {
        // Shallow reef / lagoon patterns in mare territories
        vec2 reefCell = voronoi3D(pos * 35.0 + uSeed * 6.6);
        float reef = (1.0 - smoothstep(0.0, 0.04, reefCell.x)) * (1.0 - depth / 0.30);
        color = mix(color, vec3(0.10, 0.28, 0.20), reef * tMare * 0.30);
      }
      if (tTectonic > 0.3 && depth > 0.5) {
        // Deep trenches in tectonic territories
        float trenchNoise = abs(noise3D(pos * 8.0 + uSeed * 3.0) * 2.0 - 1.0);
        trenchNoise = pow(trenchNoise, 0.5);
        color = mix(color, abyss * 0.5, (1.0 - trenchNoise) * tTectonic * 0.25);
      }

      // Deep ocean ice phases (Ice-VI / Ice-VII) for super-ocean worlds
      if (uOceanLevel > 0.55 && depth > 0.70) {
        float icePhase = smoothstep(0.70, 0.95, depth);
        // Crystalline voronoi facets — geometric pressure-ice structure
        vec2 iceCell = voronoi3D(pos * 22.0 + uSeed * 5.0);
        float facetEdge = smoothstep(0.0, 0.03, iceCell.x);
        vec3 deepIceColor = mix(vec3(0.06, 0.12, 0.28), vec3(0.16, 0.28, 0.45), facetEdge);
        // Geometric crystalline glow at cell edges
        float facetGlow = exp(-(iceCell.x * iceCell.x) / 0.001) * 0.3;
        deepIceColor += vec3(0.06, 0.12, 0.28) * facetGlow;
        color = mix(color, deepIceColor, icePhase * 0.65);
      }

      // Hydrothermal vent glow at ocean floor
      if (depth > 0.85) {
        vec2 ventCell = voronoi3D(pos * 14.0 + uSeed * 9.0);
        float vent = exp(-(ventCell.x * ventCell.x) / 0.004);
        float ventStrength = smoothstep(0.85, 0.98, depth) * step(0.82, ventCell.y);
        color += vec3(0.50, 0.15, 0.03) * vent * ventStrength * 0.25;
      }

      // Animated ocean wave normals (weaker in deep water)
      vec3 waveP = pos * 22.0 + vec3(uTime * 0.025, uTime * 0.018, uSeed);
      float w1 = noise3D(waveP) - 0.5;
      float w2 = noise3D(waveP * 2.1 + 55.0) - 0.5;
      bumpN = normalize(N + vec3(w1, 0.0, w2) * 0.06 * (1.0 - depth * 0.7));
    } else {
      float t = (h - uOceanLevel) / max(1.0 - uOceanLevel, 0.01);
      float slope = length(vec2(h - hx, h - hz)) * 120.0;

      // ── Dual-cell blended biome palettes ──
      vec3 bC1a, bC2a, bC3a;
      biomePalette(biome, bC1a, bC2a, bC3a);
      vec3 bC1b, bC2b, bC3b;
      biomePalette(biome2, bC1b, bC2b, bC3b);

      // Crossfade between neighboring biome palettes at edges
      vec3 bCol1 = mix(bC1a, bC1b, bw);
      vec3 bCol2 = mix(bC2a, bC2b, bw);
      vec3 bCol3 = mix(bC3a, bC3b, bw);

      // Blend with planet base (preserves planet type identity)
      bCol1 = mix(uColor1, bCol1, 0.70);
      bCol2 = mix(uColor2, bCol2, 0.60);
      bCol3 = mix(uColor3, bCol3, 0.50);

      // Star-dependent foliage (blended suppression at biome edges)
      vec3 landC1 = bCol1;
      if (length(uFoliageColor) > 0.1) {
        float vegZone = (1.0 - smoothstep(0.0, 0.45, t)) * (1.0 - smoothstep(0.2, 0.7, slope));
        float latVeg = abs(pos.y);
        vegZone *= 1.0 - smoothstep(0.55, 0.78, latVeg);
        // Blend vegetation suppression between neighboring biomes
        float vegSuppress = mix(biomeVegSuppress(biome), biomeVegSuppress(biome2), bw);
        landC1 = mix(bCol1, uFoliageColor, vegZone * 0.92 * vegSuppress);
      }

      // Height-based coloring with biome palette
      if (t < 0.35) {
        color = mix(landC1, bCol2, smoothstep(0.0, 0.35, t));
      } else {
        color = mix(bCol2, bCol3, smoothstep(0.35, 1.0, t));
      }
      // Rocky cliff faces and steep terrain
      color = mix(color, bCol3 * 0.40, smoothstep(0.25, 1.0, slope) * 0.55);

      // Crater maria — darkened basalt in mare territories + large impacts
      float mariaStrength = max(lCrater, tMare * 0.5);
      if (mariaStrength > 0.12) {
        vec3 ms = pos + vec3(uSeed, uSeed * 0.73, uSeed * 1.37);
        vec2 mv = voronoi3D(ms * 5.0);
        if (mv.y < mariaStrength * 0.5) {
          float mt = mv.x / (0.28 + mv.y * 0.22);
          float maria = (1.0 - smoothstep(0.0, 0.7, mt)) * (0.20 + tMare * 0.20);
          color = mix(color, color * 0.35, maria);
        }
      }

      // Ice lineae / tectonic cracks
      if (uCrackIntensity > 0.01) {
        float ck = crackPattern(pos, uCrackIntensity, uSeed);
        color = mix(color, uColor2 * 0.55, ck);
      }

      // Volcanic caldera glow (territory-modulated)
      if (lVolc > 0.06) {
        vec3 vsp = pos + vec3(uSeed * 1.1, uSeed * 0.57, uSeed * 1.83);
        vec2 vv1 = voronoi3D(vsp * 3.5);
        if (vv1.y < lVolc * 0.35) {
          float vt = vv1.x / (0.35 + vv1.y * 0.15);
          float calGlow = exp(-(vt * vt) / 0.018) * 0.9;
          float lFlow = (1.0 - smoothstep(0.0, 0.55, vt)) *
                        noise3D(pos * 18.0 + uSeed * 5.0) * 0.45;
          float hot = (calGlow + lFlow) * lVolc;
          color = mix(color, vec3(1.0, 0.30, 0.03), hot * 0.75);
        }
        vec2 vv2 = voronoi3D(vsp * 7.0 + 150.0);
        if (vv2.y < lVolc * 0.45) {
          float vt2 = vv2.x / (0.22 + vv2.y * 0.12);
          float calGlow2 = exp(-(vt2 * vt2) / 0.015) * 0.6;
          color = mix(color, vec3(0.85, 0.20, 0.02), calGlow2 * lVolc * 0.6);
        }
      }

      // ── Biome micro-features (fade near biome edges) ──
      if (biome < 0.5) {
        // DESERT: dune ripple patterns + wind-scoured flats
        float duneDir2 = fract(tID * 3.3) * 6.28;
        vec3 dV = vec3(cos(duneDir2), 0.0, sin(duneDir2));
        float dune = sin(dot(pos, dV) * 50.0 + fbm(pos * 3.0 + uSeed + 210.0) * 5.0);
        float duneLines = smoothstep(0.3, 0.7, dune * 0.5 + 0.5);
        color = mix(color, bCol3 * 0.85, duneLines * microStr * 0.28);
        float interdune = 1.0 - smoothstep(0.0, 0.2, abs(dune));
        color = mix(color, bCol2 * 0.80, interdune * microStr * 0.18);
      }
      else if (biome < 1.5) {
        // MOUNTAIN: sharp ridge texture + snow/frost on peaks
        float ridge = abs(noise3D(pos * 22.0 + uSeed * 3.0) * 2.0 - 1.0);
        ridge = pow(ridge, 0.35);
        color = mix(color, bCol2 * 0.45, ridge * microStr * 0.30);
        if (t > 0.55) {
          float snow = smoothstep(0.55, 0.85, t) * (1.0 - min(slope * 0.5, 1.0));
          color = mix(color, vec3(0.90, 0.92, 0.96), snow * microStr * 0.70);
        }
        float valShadow = smoothstep(0.5, 1.2, slope) * (1.0 - smoothstep(0.0, 0.3, t));
        color *= 1.0 - valShadow * microStr * 0.25;
      }
      else if (biome < 2.5) {
        // VOLCANIC: cooling lava plate cracks, glowing fissures
        vec2 plateC = voronoi3D(pos * 8.0 + uSeed * 2.2 + 300.0);
        float plateEdge = 1.0 - smoothstep(0.0, 0.045, plateC.x);
        float lavaHeat = plateEdge * max(uVolcanism, 0.15);
        color = mix(color, vec3(0.85, 0.22, 0.02), lavaHeat * microStr * 0.55);
        float crustTex = smoothstep(0.04, 0.12, plateC.x);
        color = mix(color, bCol1 * 0.65, (1.0 - crustTex) * microStr * 0.20);
      }
      else if (biome < 3.5) {
        // MARE: ghost craters + faint wrinkle ridges
        vec2 ghostC = voronoi3D(pos * 10.0 + uSeed * 7.7 + 500.0);
        float ghostRim = exp(-pow(ghostC.x - 0.14, 2.0) / 0.004) * 0.14;
        color -= ghostRim * microStr;
        float wrinkle = sin(dot(pos, vec3(2.1, 0.3, 3.7)) * 14.0 + uSeed * 4.0);
        wrinkle = 1.0 - smoothstep(0.0, 0.05, abs(wrinkle));
        color += vec3(0.05) * wrinkle * microStr;
      }
      else if (biome < 4.5) {
        // RIFT: exposed strata layers + canyon floor shadow
        float strata = sin(h * 90.0 + noise3D(pos * 4.0 + uSeed) * 3.5);
        strata = strata * 0.5 + 0.5;
        color = mix(color, mix(bCol1 * 0.75, bCol2 * 1.15, strata), microStr * 0.32);
        float canyon = (1.0 - smoothstep(0.0, 0.18, t)) * smoothstep(0.3, 0.8, slope);
        color = mix(color, bCol2 * 0.18, canyon * microStr * 0.40);
        float fault = abs(sin(dot(pos, vec3(3.1, 1.7, 2.3)) * 8.0 + uSeed * 5.0));
        fault = 1.0 - smoothstep(0.0, 0.035, fault);
        color = mix(color, bCol2 * 0.28, fault * microStr * 0.22);
      }
      else {
        // HIGHLAND: mesa formations + bedrock veins + wind polish
        float mesa = smoothstep(0.68, 0.74, fbm(pos * 5.0 + uSeed + 700.0));
        color = mix(color, bCol3 * 1.08, mesa * microStr * 0.30);
        float vein = abs(noise3D(pos * 28.0 + uSeed * 8.0) * 2.0 - 1.0);
        vein = pow(vein, 5.0);
        color = mix(color, bCol3 * 1.15, vein * microStr * 0.15);
        float polish = pow(max(1.0 - slope, 0.0), 4.0);
        color = mix(color, bCol1 * 1.12, polish * microStr * 0.10);
      }

      // ── Terrain age visual effects ──
      if (uTerrainAge > 0.65 && !isOcean) {
        // Ancient: space-weathered darkening + regolith maturation
        float weathering = (uTerrainAge - 0.65) * 2.86; // 0→1 over 0.65→1.0
        // Space weathering desaturates and darkens exposed surfaces
        float lum = dot(color, vec3(0.299, 0.587, 0.114));
        vec3 weatheredCol = vec3(lum) * 0.85; // desaturate toward grey
        color = mix(color, weatheredCol, weathering * 0.25);
        // Micro-crater peppering (ancient bombardment)
        vec2 microImpact = voronoi3D(pos * 55.0 + uSeed * 12.0);
        float pepperCrater = (1.0 - smoothstep(0.0, 0.025, microImpact.x)) * weathering;
        color = mix(color, color * 0.55, pepperCrater * 0.40);
      }
      if (uTerrainAge < 0.25 && !isOcean) {
        // Young: fresh volcanic flows, smooth lava plains, bright ejecta
        float youth = 1.0 - uTerrainAge / 0.25; // 1 at age=0, 0 at age=0.25
        // Fresh lava flow texture 
        float flowNoise = fbm(pos * 6.0 + uSeed + 800.0);
        float freshFlow = smoothstep(0.35, 0.55, flowNoise) * youth;
        color = mix(color, bCol1 * 0.75, freshFlow * 0.25);
      }
      // ── Tectonics visual effects ──
      if (uTectonics > 0.5 && !isOcean) {
        // Active plate boundaries: linear fault scarps
        float tectStr = (uTectonics - 0.5) * 2.0; // 0→1 over 0.5→1.0
        float faultLine = abs(noise3D(pos * 6.0 + uSeed * 2.7) * 2.0 - 1.0);
        faultLine = 1.0 - smoothstep(0.0, 0.04, faultLine);
        color = mix(color, bCol2 * 0.30, faultLine * tectStr * 0.30);
        // Folded mountain textures — more complex ridging
        float fold = sin(dot(pos, vec3(3.7, 1.2, 2.8)) * 12.0 + fbm(pos * 3.0 + uSeed + 900.0) * 4.0);
        float foldLine = smoothstep(0.65, 0.95, fold * 0.5 + 0.5);
        float foldMask = smoothstep(0.3, 0.65, t); // mainly at higher elevations
        color = mix(color, bCol3 * 0.90, foldLine * foldMask * tectStr * 0.20);
      }
    }

    // ── Ice world biome enhancements ──
    if (uIsIceWorld > 0.5 && !isOcean) {
      if (biome > 2.5 && biome < 3.5) {
        color = mix(color, vec3(0.82, 0.88, 0.96), microStr * 0.50);
      }
      if (biome > 1.5 && biome < 2.5) {
        color = mix(color, color * vec3(0.88, 0.95, 1.18), microStr * 0.25);
      }
      if (tTectonic > 0.3) {
        float extraCrack = crackPattern(pos, 0.5, uSeed + 111.0);
        color = mix(color, uColor2 * 0.35, extraCrack * tTectonic * 0.45);
      }
    }

    // Polar ice caps — irregular edges, glacier flow lines, blue deep ice
    if (uIceCaps > 0.01) {
      float absLat = abs(pos.y);
      float iceLine = 1.0 - uIceCaps * 0.55;
      // Irregular coast with domain warping
      float iceWarp = fbm(pos * 5.0 + uSeed + 50.0) * 0.10;
      float iceDetail = fbm(pos * 14.0 + uSeed + 55.0) * 0.05;
      float ice = smoothstep(iceLine - 0.08, iceLine + 0.05, absLat + iceWarp + iceDetail);
      // Deep ice is blue-tinted, surface is white
      float iceDepth = smoothstep(iceLine, iceLine + 0.28, absLat);
      vec3 iceColor = mix(vec3(0.90, 0.93, 0.97), vec3(0.70, 0.82, 0.96), iceDepth * 0.45);
      // Glacier flow lines
      float glacier = abs(sin(pos.x * 42.0 + fbm(pos * 8.0 + uSeed + 60.0) * 5.5));
      glacier = smoothstep(0.0, 0.15, glacier) * 0.06;
      iceColor -= glacier * ice;
      color = mix(color, iceColor, ice);
    }

    // ── Tidally locked eyeball effect ──
    // Antistellar hemisphere: deep ice/frost accumulation
    // Substellar point: scorched heat glow
    if (uTidallyLocked > 0.5 && uSpinOrbit32 < 0.5) {
      float facing = dot(pos, L);  // -1 (anti) to +1 (sub)

      // === Antistellar ice cap (permanent frost on far side) ===
      // Stronger, wider coverage — entire dark side should be icy
      float iceMask = smoothstep(0.15, -0.65, facing); // starts before terminator, full at -0.65
      // Irregular ice boundary — domain-warped edge
      float iceWarpT = fbm(pos * 6.0 + uSeed + 150.0) * 0.22;
      iceMask *= smoothstep(0.20, -0.40, facing + iceWarpT);
      // Deep ice vs surface frost
      float iceDepthT = smoothstep(-0.3, -0.85, facing);
      // Multiple ice textures for variety
      float iceNoise = fbm(pos * 4.0 + uSeed + 155.0);
      vec3 tidalIce = mix(
        vec3(0.82, 0.86, 0.94),   // fresh frost (white-blue)
        vec3(0.55, 0.68, 0.88),   // deep glacial ice (blue)
        iceDepthT * 0.65
      );
      // Nitrogen frost patches (pinkish-white at extreme cold)
      float n2frost = smoothstep(-0.7, -0.95, facing) * smoothstep(0.4, 0.6, iceNoise);
      tidalIce = mix(tidalIce, vec3(0.88, 0.82, 0.84), n2frost * 0.4);
      // Cracked ice texture on deep frost
      float crackIce = abs(noise3D(pos * 18.0 + uSeed + 160.0) * 2.0 - 1.0);
      crackIce = pow(crackIce, 4.0);
      tidalIce -= vec3(0.12, 0.10, 0.06) * crackIce * iceDepthT;
      // Cryovolcanic venting at the deep anti-stellar point
      vec2 cryoCell = voronoi3D(pos * 12.0 + uSeed + 165.0);
      float cryoVent = exp(-(cryoCell.x * cryoCell.x) / 0.003) * smoothstep(-0.80, -0.95, facing);
      tidalIce = mix(tidalIce, vec3(0.70, 0.80, 0.95), cryoVent * 0.35);
      color = mix(color, tidalIce, iceMask);

      // === Substellar scorched zone (extreme heat) ===
      float heatMask = smoothstep(0.45, 0.90, facing);
      // Baked/darkened surface, molten at extreme heat
      vec3 scorchedCol = mix(color * 0.50, vec3(0.30, 0.15, 0.06), 0.60);
      // Glassed surface (silicate melting at extreme substellar)
      float glassMask = smoothstep(0.80, 0.96, facing);
      vec3 glassCol = vec3(0.18, 0.14, 0.10) + vec3(0.08, 0.04, 0.02) * fbm(pos * 8.0 + uSeed + 180.0);
      scorchedCol = mix(scorchedCol, glassCol, glassMask * 0.5);
      color = mix(color, scorchedCol, heatMask * 0.55);
      // Molten glow right at substellar point (if hot enough)
      if (uSubstellarTemp > 500.0) {
        float moltenMask = smoothstep(0.82, 0.98, facing);
        float moltenNoise = fbm(pos * 10.0 + uSeed + 170.0);
        float moltenCracks = smoothstep(0.35, 0.55, moltenNoise);
        vec3 moltenGlow = vec3(1.0, 0.35, 0.06) * moltenCracks;
        color = mix(color, moltenGlow, moltenMask * 0.60);
      }

      // === Terminator ring — habitable zone (if temperate) ===
      float termRing = 1.0 - abs(facing);  // peaks at terminator
      termRing = smoothstep(0.60, 0.92, termRing);
      // Green tint if habitable temperature range
      if (uAntistellarTemp < 260.0 && uSubstellarTemp > 320.0) {
        vec3 habitableGreen = mix(color, vec3(0.22, 0.42, 0.16), 0.25);
        color = mix(color, habitableGreen, termRing * 0.45);
      }
    }

    // Lighting
    float NdotL_bump = max(dot(bumpN, L), 0.0);
    float terminator = smoothstep(-0.06, 0.18, NdotL_bump);
    vec3 ambient = color * 0.04;
    vec3 lit = color * NdotL_bump * 0.92;

    // Ocean specular glint (subtle sun glitter via wave normals)
    float spec = 0.0;
    if (isOcean) {
      spec = pow(max(dot(bumpN, H), 0.0), 260.0) * 0.35;
    }

    // Multi-layer clouds — territory-sensitive, with cyclone cells
    float cloudMask = 0.0;
    if (uCloudDensity > 0.01) {
      // Territory-modulated cloud density
      float localCloud = uCloudDensity;
      localCloud *= 1.0 + tVolcanic * 0.40;  // convective clouds over volcanoes
      localCloud *= 1.0 - tHighland * 0.25;  // rain shadow over highlands
      localCloud *= 1.0 + tMare * 0.15;      // moisture over mare basins

      // Low stratus (large-scale weather systems)
      float c1l = fbm(pos * 3.8 + vec3(uTime * 0.012, 0.0, uSeed + 30.0));
      float low = smoothstep(0.52 - localCloud * 0.28, 0.68, c1l);

      // Cyclone cells — spiral cloud structures
      vec2 cyc = voronoi3D(pos * 2.2 + uSeed * 2.0 + 700.0);
      float spiral = sin(atan(pos.z, pos.x) * 3.0 + cyc.x * 12.0 + uTime * 0.04);
      float cyclone = (1.0 - smoothstep(0.0, 0.25, cyc.x)) * (spiral * 0.5 + 0.5);
      low = max(low, cyclone * localCloud * 0.50);

      // High cirrus (thin wispy, faster drift) — only for thick atmospheres
      float high = 0.0;
      if (uAtmThickness > 0.30) {
        float c2l = fbm(pos * 7.5 + vec3(uTime * 0.020, uTime * 0.008, uSeed + 65.0));
        high = smoothstep(0.58, 0.75, c2l) * 0.45;
      }
      cloudMask = (low * 0.70 + high * 0.30) * localCloud;
    }

    // Tidal storm vortex — permanent substellar cyclone on 1:1 locked worlds
    if (uTidallyLocked > 0.5 && uStormIntensity > 0.01) {
      float stormMask = tidalStorm(pos, L, uTime);
      cloudMask = max(cloudMask, stormMask * uStormIntensity * 0.85);
      // Storm also adds a warm glow on the dayside
      float stormGlow = stormMask * uStormIntensity * 0.15;
      color = mix(color, vec3(0.85, 0.70, 0.50), stormGlow * terminator);
    }

    // Lava emission on night side
    vec3 lavaGlow = vec3(0.0);
    if (uEmissive > 0.01) {
      float lavaNoise = fbm(pos * uNoiseScale * 1.6 + uSeed + 80.0);
      // Cracks pattern from high-frequency domain warp
      float cracks = warpedFbm(pos * uNoiseScale * 3.0 + uSeed + 120.0);
      float lavaMask = smoothstep(0.42, 0.58, lavaNoise) * smoothstep(0.38, 0.52, cracks);
      float nightFactor = 1.0 - terminator;
      lavaGlow = vec3(1.0, 0.28, 0.04) * lavaMask * nightFactor * uEmissive * 3.5;
      // Day side: dark cracks visible
      color = mix(color, vec3(0.06, 0.04, 0.03), lavaMask * 0.4 * terminator);
    }

    // Compose
    finalColor = lit * terminator + ambient;
    finalColor += vec3(spec) * terminator;

    // Cloud shadows darken terrain, then bright clouds on top
    finalColor *= (1.0 - cloudMask * 0.35);
    finalColor += vec3(0.93, 0.95, 0.98) * cloudMask * terminator * 0.30;
    finalColor += lavaGlow;

    // Atmospheric scattering at the terminator (sunset/sunrise glow)
    if (uAtmThickness > 0.05) {
      float sunAngle = NdotL_bump;
      float termGlow = exp(-(sunAngle * sunAngle) / 0.008) * uAtmThickness;
      vec3 sunsetColor = vec3(1.0, 0.42, 0.08) * 0.55 + uAtmColor * 0.45;
      finalColor += sunsetColor * termGlow * 0.28;
    }

    // Atmosphere handled by separate shell — only faint inner scattering
    float atmRim = pow(rim, 3.5) * uAtmThickness;
    finalColor += uAtmColor * atmRim * 0.12;

    // Night-side city lights (habitable worlds with oceans + atmosphere)
    if (uOceanLevel > 0.1 && uAtmThickness > 0.2) {
      float nightF = 1.0 - smoothstep(-0.02, 0.06, NdotL_bump);
      vec2 cv1 = voronoi3D(pos * 38.0 + uSeed * 7.0);
      float landMask = step(uOceanLevel, h);
      float cityPop = (1.0 - smoothstep(0.0, 0.055, cv1.x)) * landMask;
      vec2 cv2 = voronoi3D(pos * 90.0 + uSeed * 11.0);
      float citySmall = (1.0 - smoothstep(0.0, 0.035, cv2.x)) * landMask * 0.45;
      vec3 cityColor = vec3(1.0, 0.82, 0.44);
      finalColor += cityColor * (cityPop + citySmall) * nightF * 0.12;
    }

    // Subsurface scattering removed — was causing unwanted glossy backlight

    // Aurora at magnetic poles (worlds with atmosphere)
    if (uAtmThickness > 0.10) {
      float aurLat = abs(pos.y);
      float aurZone = smoothstep(0.72, 0.82, aurLat) * (1.0 - smoothstep(0.88, 0.95, aurLat));
      if (aurZone > 0.01) {
        float aurWave = sin(pos.x * 20.0 + pos.z * 15.0 + uTime * 0.5 + uSeed * 10.0) * 0.5 + 0.5;
        float aurFlicker = noise3D(pos * 8.0 + vec3(uTime * 0.3, 0, uSeed)) * 0.7 + 0.3;
        float nightSide = 1.0 - smoothstep(-0.05, 0.15, NdotL_bump);
        vec3 aurColor = mix(vec3(0.1, 0.9, 0.3), vec3(0.3, 0.1, 0.8), aurWave);
        finalColor += aurColor * aurZone * aurFlicker * nightSide * 0.06 * uAtmThickness;
      }
    }

    // Organic territory borders — coastlines and tectonic ridges
    float orgBorder = 0.0;
    if (uOceanLevel > 0.02) {
      // Coastline glow (land-sea boundary — the natural continent edge)
      float coastDist = abs(h - uOceanLevel);
      float coastGlow = 1.0 - smoothstep(0.0, 0.018, coastDist);
      // Continental shelf edge (subtle secondary line just below surface)
      float shelfDist = abs(h - (uOceanLevel - 0.035));
      float shelfGlow = (1.0 - smoothstep(0.0, 0.012, shelfDist)) * 0.35;
      orgBorder = max(coastGlow, shelfGlow);
    }
    // Tectonic ridge lines on land (mountain crests as natural plate boundaries)
    if (!isOcean) {
      float borderSlope = length(vec2(h - hx, h - hz)) * 120.0;
      float ridgeLine = smoothstep(0.50, 0.95, borderSlope) * 0.45;
      orgBorder = max(orgBorder, ridgeLine);
    }
    vec3 orgBorderC = isOcean ? vec3(0.28, 0.52, 0.78) : vec3(0.50, 0.44, 0.32);
    finalColor = mix(finalColor, orgBorderC, orgBorder * 0.15);
  }

  // ── Science overlay: Temperature map ──────────────────
  if (uShowTempMap > 0.5) {
    vec3 sPos = normalize(vObjPos);
    float localTemp = surfaceTemp(sPos, normalize(uSunDir));
    vec3 tCol = tempToColor(localTemp);
    // Strong overlay but preserve lighting structure
    float lumOrig = dot(finalColor, vec3(0.299, 0.587, 0.114));
    finalColor = mix(finalColor, tCol * (0.35 + lumOrig * 0.65), 0.72);
  }

  // ── Science overlay: Mineral abundance map ────────────
  if (uShowMineralMap > 0.5) {
    vec3 sPos = normalize(vObjPos);
    vec3 mCol = mineralColor(sPos);
    float lumOrig = dot(finalColor, vec3(0.299, 0.587, 0.114));
    finalColor = mix(finalColor, mCol * (0.30 + lumOrig * 0.70), 0.75);
  }

  // Tone map (Reinhard) + gamma
  finalColor = finalColor / (finalColor + vec3(1.0));
  finalColor = pow(finalColor, vec3(0.4545));

  gl_FragColor = vec4(finalColor, 1.0);
}
`;

/* ── Atmosphere Shell Shaders ───────────────────────────── */

const ATM_VERT = /* glsl */ `
varying vec3 vNormal;
varying vec3 vViewDir;
varying float vFresnel;
void main() {
  vNormal = normalize(normalMatrix * normal);
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vViewDir = normalize(cameraPosition - worldPos.xyz);
  vFresnel = 1.0 - max(dot(vNormal, vViewDir), 0.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const ATM_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uAtmColor;
uniform float uAtmThickness;
uniform vec3 uSunDir;
varying vec3 vNormal;
varying vec3 vViewDir;
varying float vFresnel;

void main() {
  vec3 N = normalize(vNormal);
  vec3 L = normalize(uSunDir);
  float rim = vFresnel;
  float NdotL = dot(N, L);

  // Rayleigh-like scattering: strong at limb, colored by atmosphere
  float scatter = pow(rim, 2.2);

  // Day-night asymmetry: brighter on sunlit side
  float dayFactor = smoothstep(-0.15, 0.35, NdotL);

  // Forward scattering (bright ring when star is behind planet)
  float backScatter = pow(max(-NdotL, 0.0), 2.0) * pow(rim, 1.5) * 0.30;

  // Terminator glow band
  float termGlow = exp(-pow(NdotL - 0.02, 2.0) / 0.015) * 0.20;

  vec3 color = uAtmColor * (scatter * dayFactor * 0.85 + backScatter + termGlow);

  // Alpha: transparent at center, visible at limb
  float alpha = (scatter * 0.70 + backScatter * 0.35) * uAtmThickness;
  alpha = clamp(alpha, 0.0, 0.50);

  gl_FragColor = vec4(color, alpha);
}
`;

/* ── Component ───────────────────────────────────────── */

interface TempDistribution {
  substellar_k?: number;
  antistellar_k?: number;
  equator_k?: number;
  polar_k?: number;
  terminator_k?: number;
  heat_redistribution?: number;
  hot_longitude_k?: number;
  cold_longitude_k?: number;
  day_night_contrast?: number;
  pattern?: string;
  storms?: Array<{ latitude_deg: number; longitude_deg: number; diameter_deg: number; intensity: number; wind_speed_ms?: number }>;
}

interface MineralAbundance {
  iron_pct?: number;
  silicate_pct?: number;
  water_ice_pct?: number;
  kreep_index?: number;
  carbon_pct?: number;
  [key: string]: unknown;
}

interface Props {
  planetType: string;
  temperature?: number;
  seed?: number;
  sunDirection?: [number, number, number];
  rotationSpeed?: number;
  /** Per-instance color shifts [r,g,b] added to base profile colors (−0.3 to +0.3) */
  colorShift?: [number, number, number];
  /** Physical parameters for universal world derivation */
  mass?: number;
  tidalHeating?: number;
  /** Star spectral class (e.g. 'G2V', 'M4', 'K1') for foliage color derivation */
  starSpectralClass?: string;
  /** Tidal locking state */
  tidallyLocked?: boolean;
  spinOrbit32?: boolean;
  /** Science overlay toggles */
  showTempMap?: boolean;
  showMineralMap?: boolean;
  /** Temperature distribution data from backend */
  tempDistribution?: TempDistribution;
  /** Mineral abundance data from backend */
  mineralAbundance?: MineralAbundance;
}

/** Ice-dominated world types */
const _ICE_TYPES = new Set([
  'ice-dwarf', 'moon-ice-shell', 'moon-ocean', 'moon-nitrogen-ice',
  'moon-co2-frost', 'moon-ammonia-slush', 'moon-silicate-frost',
]);
void _ICE_TYPES; // reserved for future use

export function ProceduralPlanet({
  planetType,
  temperature = 300,
  seed = 0,
  sunDirection = [1, 0.3, 0.5],
  rotationSpeed = 0.08,
  colorShift,
  mass,
  tidalHeating,
  starSpectralClass,
  displacement = 0.055,
  segments = 96,
  tidallyLocked = false,
  spinOrbit32 = false,
  showTempMap = false,
  showMineralMap = false,
  tempDistribution,
  mineralAbundance,
}: Props & { displacement?: number; segments?: number }) {
  const groupRef = useRef<THREE.Group>(null!);
  const meshRef = useRef<THREE.Mesh>(null!);

  const baseVis = V[planetType] || V['rocky'];
  const vis = deriveWorldVisuals(baseVis, { temperature, mass, tidalHeating, starSpectralClass });

  // ── World genome diversity — slot-machine combinatorial colors ──
  if (seed && !NO_GENOME.has(planetType)) {
    applyWorldGenome(vis, seed, temperature, mass ?? 1);
  }

  // ── Seed-based ocean / terrain diversity ───────────────────────
  // Same profile, different seed → continental, standard, or island world
  if (vis.oceanLevel > 0.1 && vis.oceanLevel < 0.95 && seed) {
    const variation = Math.sin(seed * 127.1 + 37.7) * 0.5 + 0.5; // 0-1
    vis.oceanLevel = Math.max(0.15, Math.min(0.93,
      vis.oceanLevel + (variation - 0.5) * 0.35));
  }
  if (vis.mountainHeight && vis.mountainHeight > 0.02 && seed) {
    const mtnVar = Math.sin(seed * 211.3 + 19.1) * 0.5 + 0.5;
    vis.mountainHeight *= 0.55 + mtnVar * 0.9;   // 0.55x – 1.45x range
  }
  if (vis.valleyDepth && vis.valleyDepth > 0.02 && seed) {
    const valVar = Math.sin(seed * 53.7 + 88.3) * 0.5 + 0.5;
    vis.valleyDepth *= 0.5 + valVar * 1.0;        // 0.5x – 1.5x range
  }

  const isGas = GAS_TYPES.has(planetType);
  const isIceWorld = !!(vis.isIce || temperature < 150);
  const foliageColor = useMemo((): [number,number,number] => {
    if (isGas || vis.oceanLevel < 0.1 || vis.atmThickness < 0.15 || temperature < 180 || temperature > 400) {
      return [0, 0, 0]; // no vegetation possible
    }
    const s = (starSpectralClass || 'G')[0]?.toUpperCase() || 'G';
    switch (s) {
      case 'M': return [0.05, 0.01, 0.04] as [number,number,number]; // near-black burgundy
      case 'K': return [0.24, 0.28, 0.04] as [number,number,number]; // warm olive-brown
      case 'G': return [0.12, 0.48, 0.06] as [number,number,number]; // Earth green
      case 'F': return [0.42, 0.56, 0.10] as [number,number,number]; // chartreuse
      case 'A': return [0.54, 0.50, 0.14] as [number,number,number]; // golden-olive
      default:  return [0.12, 0.48, 0.06] as [number,number,number]; // Earth green
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vis.oceanLevel, vis.atmThickness, temperature, starSpectralClass]);

  // Per-instance color variation from geology
  const cs = colorShift || [0, 0, 0];
  const c1: [number,number,number] = [Math.min(1, Math.max(0, vis.color1[0] + cs[0])), Math.min(1, Math.max(0, vis.color1[1] + cs[1])), Math.min(1, Math.max(0, vis.color1[2] + cs[2]))];
  const c2: [number,number,number] = [Math.min(1, Math.max(0, vis.color2[0] + cs[0] * 0.7)), Math.min(1, Math.max(0, vis.color2[1] + cs[1] * 0.7)), Math.min(1, Math.max(0, vis.color2[2] + cs[2] * 0.7))];
  const c3: [number,number,number] = [Math.min(1, Math.max(0, vis.color3[0] + cs[0] * 0.4)), Math.min(1, Math.max(0, vis.color3[1] + cs[1] * 0.4)), Math.min(1, Math.max(0, vis.color3[2] + cs[2] * 0.4))];

  // Tweak emissive based on temperature for very hot planets
  const emissive = vis.emissive > 0 ? vis.emissive : (temperature > 1500 ? 0.5 : temperature > 800 ? 0.15 : 0);

  // Extract storm data for tidal vortex
  // Auto-generate substellar storm for tidally locked worlds with atmosphere
  const storm0 = tempDistribution?.storms?.[0] ??
    (tidallyLocked && vis.atmThickness > 0.1
      ? { latitude_deg: 0, longitude_deg: 0, diameter_deg: 45, intensity: 0.75 }
      : undefined);

  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uTime: { value: 0 },
        uColor1: { value: new THREE.Color(c1[0], c1[1], c1[2]) },
        uColor2: { value: new THREE.Color(c2[0], c2[1], c2[2]) },
        uColor3: { value: new THREE.Color(c3[0], c3[1], c3[2]) },
        uOceanColor: { value: new THREE.Color(vis.oceanColor[0], vis.oceanColor[1], vis.oceanColor[2]) },
        uOceanLevel: { value: vis.oceanLevel },
        uAtmColor: { value: new THREE.Color(vis.atmColor[0], vis.atmColor[1], vis.atmColor[2]) },
        uAtmThickness: { value: vis.atmThickness },
        uEmissive: { value: emissive },
        uIceCaps: { value: vis.iceCaps },
        uCloudDensity: { value: vis.clouds },
        uNoiseScale: { value: vis.noiseScale },
        uSunDir: { value: new THREE.Vector3(sunDirection[0], sunDirection[1], sunDirection[2]).normalize() },
        uIsGas: { value: isGas ? 1.0 : 0.0 },
        uTerrainAgeV: { value: vis.terrainAge ?? 0.5 },
        uTectonicsV: { value: vis.tectonicsLevel ?? 0.0 },
        uSeed: { value: seed * 137.0 },
        uCraterDensity: { value: vis.craterDensity ?? 0 },
        uCrackIntensity: { value: vis.crackIntensity ?? 0 },
        uMountainHeight: { value: vis.mountainHeight ?? 0 },
        uValleyDepth: { value: vis.valleyDepth ?? 0 },
        uVolcanism: { value: vis.volcanism ?? 0 },
        uIsIceWorld: { value: isIceWorld ? 1.0 : 0.0 },
        uFoliageColor: { value: new THREE.Vector3(foliageColor[0], foliageColor[1], foliageColor[2]) },
        // Tidal lock + temperature + mineral overlays
        uTidallyLocked: { value: tidallyLocked ? 1.0 : 0.0 },
        uSpinOrbit32: { value: spinOrbit32 ? 1.0 : 0.0 },
        uShowTempMap: { value: showTempMap ? 1.0 : 0.0 },
        uSubstellarTemp: { value: tempDistribution?.substellar_k ?? temperature },
        uAntistellarTemp: { value: tempDistribution?.antistellar_k ?? Math.max(40, temperature * 0.25) },
        uEquatorTemp: { value: tempDistribution?.equator_k ?? temperature },
        uPolarTemp: { value: tempDistribution?.polar_k ?? Math.max(40, temperature * 0.7) },
        uHeatRedist: { value: tempDistribution?.heat_redistribution ?? 0.3 },
        uStormLat: { value: storm0?.latitude_deg ?? 0.0 },
        uStormLon: { value: storm0?.longitude_deg ?? 0.0 },
        uStormSize: { value: storm0?.diameter_deg ?? 0.0 },
        uStormIntensity: { value: storm0?.intensity ?? 0.0 },
        uShowMineralMap: { value: showMineralMap ? 1.0 : 0.0 },
        uIronPct: { value: mineralAbundance?.iron_pct ?? 0.0 },
        uSilicatePct: { value: mineralAbundance?.silicate_pct ?? 0.0 },
        uWaterIcePct: { value: mineralAbundance?.water_ice_pct ?? 0.0 },
        uKreepIndex: { value: mineralAbundance?.kreep_index ?? 0.0 },
        uCarbonPct: { value: mineralAbundance?.carbon_pct ?? 0.0 },
        // Vertex shader displacement uniforms
        uDisplacement: { value: isGas ? 0 : displacement },
        uSeedV: { value: seed * 137.0 },
        uNoiseScaleV: { value: vis.noiseScale },
        uIsGasV: { value: isGas ? 1.0 : 0.0 },
        uOceanLevelV: { value: vis.oceanLevel },
        uCraterDensityV: { value: vis.craterDensity ?? 0 },
        uMountainHeightV: { value: vis.mountainHeight ?? 0 },
        uValleyDepthV: { value: vis.valleyDepth ?? 0 },
        uVolcanismV: { value: vis.volcanism ?? 0 },
      },
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planetType, seed, cs[0], cs[1], cs[2], mass, tidalHeating, starSpectralClass,
      tidallyLocked, spinOrbit32, showTempMap, showMineralMap]);

  // ── Thick atmosphere layers (Venus / super-Earth soupy atmospheres) ──
  // Multiple concentric cloud shells with different opacity/color for volumetric feel
  const thickAtmLayers = useMemo(() => {
    if (isGas || vis.atmThickness < 0.60) return null;
    const depth = vis.atmThickness; // 0.60 → 0.95+
    const layers: { radius: number; color: [number, number, number]; opacity: number }[] = [];

    // Inner haze layer — dense, tinted darker
    layers.push({
      radius: 1.008 + depth * 0.015,
      color: [vis.atmColor[0] * 0.7, vis.atmColor[1] * 0.6, vis.atmColor[2] * 0.5],
      opacity: 0.10 + (depth - 0.6) * 0.35, // 0.10 → 0.22
    });

    // Middle cloud deck — main visible layer, brightest
    layers.push({
      radius: 1.020 + depth * 0.035,
      color: [
        Math.min(1, vis.atmColor[0] * 1.1 + 0.08),
        Math.min(1, vis.atmColor[1] * 1.0 + 0.04),
        Math.min(1, vis.atmColor[2] * 0.9),
      ],
      opacity: 0.08 + (depth - 0.6) * 0.28, // 0.08 → 0.18
    });

    // Outer high-altitude haze — diffuse, lighter colored
    if (depth > 0.75) {
      layers.push({
        radius: 1.040 + depth * 0.05,
        color: [
          Math.min(1, vis.atmColor[0] * 0.5 + 0.35),
          Math.min(1, vis.atmColor[1] * 0.5 + 0.30),
          Math.min(1, vis.atmColor[2] * 0.5 + 0.25),
        ],
        opacity: 0.04 + (depth - 0.75) * 0.18,
      });
    }

    return layers.map((l, i) => new THREE.ShaderMaterial({
      vertexShader: ATM_VERT,
      fragmentShader: ATM_FRAG,
      uniforms: {
        uAtmColor: { value: new THREE.Color(l.color[0], l.color[1], l.color[2]) },
        uAtmThickness: { value: l.opacity * 2.5 },
        uSunDir: { value: new THREE.Vector3(sunDirection[0], sunDirection[1], sunDirection[2]).normalize() },
      },
      transparent: true,
      side: i === 0 ? THREE.DoubleSide : THREE.FrontSide,
      depthWrite: false,
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planetType, seed]);

  // Atmosphere shell material (solid worlds only, not gas giants)
  const atmMaterial = useMemo(() => {
    if (vis.atmThickness < 0.08 || isGas) return null;
    return new THREE.ShaderMaterial({
      vertexShader: ATM_VERT,
      fragmentShader: ATM_FRAG,
      uniforms: {
        uAtmColor: { value: new THREE.Color(vis.atmColor[0], vis.atmColor[1], vis.atmColor[2]) },
        uAtmThickness: { value: vis.atmThickness },
        uSunDir: { value: new THREE.Vector3(sunDirection[0], sunDirection[1], sunDirection[2]).normalize() },
      },
      transparent: true,
      side: THREE.FrontSide,
      depthWrite: false,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planetType, seed]);

  useFrame((_, delta) => {
    // Scale rotation + shader time with shared orbit speed so pause/speed controls work
    const spd = (globalThis as any).__exomaps_orbit_speed ?? 1;
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * rotationSpeed * spd;
    }
    material.uniforms.uTime.value += delta * spd;
    material.uniformsNeedUpdate = true;
  });

  return (
    <group ref={groupRef}>
      <mesh ref={meshRef} material={material}>
        <sphereGeometry args={[1, segments, Math.round(segments * 0.67)]} />
      </mesh>
      {atmMaterial && (
        <mesh material={atmMaterial}>
          <sphereGeometry args={[1.015 + vis.atmThickness * 0.04, 48, 32]} />
        </mesh>
      )}
      {/* Thick atmosphere: multiple cloud deck shells */}
      {thickAtmLayers?.map((mat, i) => {
        const r = i === 0
          ? 1.008 + vis.atmThickness * 0.015
          : i === 1
            ? 1.020 + vis.atmThickness * 0.035
            : 1.040 + vis.atmThickness * 0.05;
        return (
          <mesh key={`thick-atm-${i}`} material={mat}>
            <sphereGeometry args={[r, 40, 28]} />
          </mesh>
        );
      })}
    </group>
  );
}

export default ProceduralPlanet;
