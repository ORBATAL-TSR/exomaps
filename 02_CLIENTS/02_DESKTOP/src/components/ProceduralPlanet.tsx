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

import { useRef, useMemo, useEffect, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getTextureTriplet, texUrl, GAS_TYPES as TEX_GAS_TYPES } from '../data/texturePalette';

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
  // ── NEW vivid surface regimes (wider color gamut) ──
  { c1: [0.08, 0.48, 0.42], c2: [0.12, 0.58, 0.52], c3: [0.04, 0.38, 0.32], tempRange: [150, 800], tags: ['metal'], rarity: 3 },  // malachite copper
  { c1: [0.72, 0.08, 0.32], c2: [0.82, 0.14, 0.38], c3: [0.62, 0.06, 0.26], tempRange: [300, 1500], tags: ['volc'], rarity: 3 },  // ruby volcanic
  { c1: [0.18, 0.06, 0.42], c2: [0.28, 0.10, 0.52], c3: [0.38, 0.16, 0.62], tempRange: [0, 2000], tags: [], rarity: 3 },          // amethyst
  { c1: [0.82, 0.78, 0.10], c2: [0.90, 0.86, 0.16], c3: [0.72, 0.68, 0.08], tempRange: [200, 800], tags: ['volc'], rarity: 3 },   // sulfur field
  { c1: [0.04, 0.24, 0.48], c2: [0.08, 0.32, 0.58], c3: [0.02, 0.18, 0.38], tempRange: [50, 300], tags: [], rarity: 3 },          // cobalt ice
  { c1: [0.90, 0.52, 0.08], c2: [0.96, 0.62, 0.14], c3: [0.82, 0.44, 0.06], tempRange: [150, 600], tags: ['atm'], rarity: 2 },    // amber sand
  { c1: [0.50, 0.52, 0.10], c2: [0.58, 0.60, 0.18], c3: [0.42, 0.44, 0.06], tempRange: [0, 1500], tags: [], rarity: 2 },          // lichen green
  { c1: [0.78, 0.12, 0.08], c2: [0.86, 0.18, 0.12], c3: [0.68, 0.08, 0.06], tempRange: [400, 2000], tags: ['volc'], rarity: 2 },  // cinnabar red
  { c1: [0.58, 0.56, 0.72], c2: [0.68, 0.66, 0.82], c3: [0.48, 0.46, 0.62], tempRange: [0, 500], tags: [], rarity: 2 },           // lavender ice
  { c1: [0.88, 0.72, 0.42], c2: [0.94, 0.80, 0.50], c3: [0.80, 0.64, 0.34], tempRange: [250, 450], tags: ['atm'], rarity: 1 },    // warm sandstone
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
  'lava-world', 'iron-planet', 'carbon-planet', 'eyeball-world',
  'moon-volcanic', 'moon-magma-ocean', 'moon-carbon-soot',
]);

/** Gas giant genome — seed-driven HSV color mutation for band/storm diversity */
function applyGasGenome(vis: PlanetVisuals, seed: number): void {
  // Wide hue shift so gas giants of same type look fundamentally different
  const dh = (genomeHash(seed, 10) - 0.5) * 0.55;
  const ds = (genomeHash(seed, 11) - 0.5) * 0.42;
  const dv = (genomeHash(seed, 12) - 0.5) * 0.30;
  vis.color1 = shiftHSV(vis.color1, dh, ds, dv);
  vis.color2 = shiftHSV(vis.color2, dh * 0.70, ds * 0.80, dv * 0.65);
  vis.color3 = shiftHSV(vis.color3, dh * 0.45, ds * 0.55, dv * 0.35);
  // Atmosphere color mutation
  const adh = (genomeHash(seed, 13) - 0.5) * 0.32;
  const ads = (genomeHash(seed, 14) - 0.5) * 0.28;
  vis.atmColor = shiftHSV(vis.atmColor as [number, number, number], adh, ads, 0);
}

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

  // Per-world HSV shift for intra-regime variation (WIDE shifts = strong diversity)
  const dh = (genomeHash(seed, 4) - 0.5) * 0.50;
  const ds = (genomeHash(seed, 5) - 0.5) * 0.45;
  const dv = (genomeHash(seed, 6) - 0.5) * 0.30;
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

/* -- Inline noise for vertex displacement -- */
float vHash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float vNoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x);
  f = f*f*f*(f*(f*6.0-15.0)+10.0); // quintic — matches FRAG for consistent terrain
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
  // World-space normal so lighting matches world-space uSunDir & vViewDir
  vNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
  vec4 worldPos = modelMatrix * vec4(displaced, 1.0);
  vViewDir = normalize(cameraPosition - worldPos.xyz);
  vFresnel = 1.0 - max(dot(vNormal, vViewDir), 0.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;

// =============================================================
// ProceduralPlanet FRAG v3 -- Tectonic plates, pole-free noise,
// heightmap water, dual clouds, texture-informed biomes
// =============================================================

uniform float uTime;
uniform vec3  uColor1, uColor2, uColor3;
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
uniform float uTidallyLocked;
uniform float uSpinOrbit32;
uniform float uShowTempMap;
uniform float uSubstellarTemp, uAntistellarTemp, uEquatorTemp, uPolarTemp;
uniform float uHeatRedist;
uniform float uStormLat, uStormLon, uStormSize, uStormIntensity;
uniform float uShowMineralMap;
uniform float uIronPct, uSilicatePct, uWaterIcePct, uKreepIndex, uCarbonPct;
uniform vec3  uPlanetShineColor;
uniform sampler2D uTexLow, uTexMid, uTexHigh;
uniform float uTexInfluence, uTriplanarScale;

varying vec3  vObjPos;
varying vec3  vNormal;
varying vec3  vViewDir;
varying float vFresnel;

// =============================================================
// NOISE CORE -- gradient noise, NO pole pinching (all 3D)
// =============================================================
vec3 hash33(vec3 p) {
  p = vec3(dot(p, vec3(127.1,311.7,74.7)),
           dot(p, vec3(269.5,183.3,246.1)),
           dot(p, vec3(113.5,271.9,124.6)));
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453);
}
float noise3D(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f*f*f*(f*(f*6.0-15.0)+10.0); // quintic for C2-smooth transitions
  return mix(mix(mix(dot(hash33(i),f),
    dot(hash33(i+vec3(1,0,0)),f-vec3(1,0,0)),u.x),
    mix(dot(hash33(i+vec3(0,1,0)),f-vec3(0,1,0)),
    dot(hash33(i+vec3(1,1,0)),f-vec3(1,1,0)),u.x),u.y),
    mix(mix(dot(hash33(i+vec3(0,0,1)),f-vec3(0,0,1)),
    dot(hash33(i+vec3(1,0,1)),f-vec3(1,0,1)),u.x),
    mix(dot(hash33(i+vec3(0,1,1)),f-vec3(0,1,1)),
    dot(hash33(i+vec3(1,1,1)),f-vec3(1,1,1)),u.x),u.y),u.z)*0.5+0.5;
}
float fbm5(vec3 p) {
  float v = 0.0, a = 0.5;
  for(int i=0;i<6;i++){v+=a*noise3D(p);p=p*2.03+31.97;a*=0.48;}
  return v;
}
float fbm3(vec3 p) {
  float v = 0.0, a = 0.5;
  for(int i=0;i<3;i++){v+=a*noise3D(p);p=p*2.03+31.97;a*=0.49;}
  return v;
}
float ridgedFbm(vec3 p) {
  float v = 0.0, a = 0.5;
  for(int i=0;i<4;i++){
    float n=abs(noise3D(p)*2.0-1.0);n=1.0-n;n=n*n;
    v+=a*n;p=p*2.1+17.3;a*=0.45;
  }
  return v;
}

// =============================================================
// VORONOI TECTONIC PLATES -- discrete biome regions
// Returns (cellDist, cellEdgeDist, cellID hash)
// =============================================================
vec3 voronoiPlates(vec3 p, float sc) {
  vec3 pp = p * sc;
  vec3 i = floor(pp), f = fract(pp);
  float d1 = 2.0, d2 = 2.0;
  float cellId = 0.0;
  // 3x3x3 neighbor search (27 iterations) — proper nearest-cell Voronoi
  for(int x=-1;x<=1;x++)
    for(int y=-1;y<=1;y++)
      for(int z=-1;z<=1;z++){
        vec3 g = vec3(float(x),float(y),float(z));
        vec3 o = fract(sin(vec3(
          dot(i+g,vec3(127.1,311.7,74.7)),
          dot(i+g,vec3(269.5,183.3,246.1)),
          dot(i+g,vec3(113.5,271.9,124.6))))*43758.5453)*0.75+0.125;
        float dd = length(g+o-f);
        if(dd < d1){ d2=d1; d1=dd;
          cellId = fract(sin(dot(i+g,vec3(7.13,157.9,113.2)))*43758.5453);
        } else if(dd < d2){ d2=dd; }
      }
  return vec3(d1, d2-d1, cellId);
}

// =============================================================
// TERRAIN HEIGHT -- domain-warped with tectonic plates
// =============================================================
float terrainHeight(vec3 pos) {
  float sc = uNoiseScale;
  // Domain warp for organic continental shapes
  vec3 q = vec3(fbm3(pos*sc + uSeed),
                fbm3(pos*sc + uSeed + vec3(5.2,1.3,3.7)),
                fbm3(pos*sc + uSeed + vec3(9.1,4.8,7.2)));
  vec3 r = vec3(fbm3(pos*sc + q*3.5 + uSeed + vec3(1.7,8.2,2.1)),
                fbm3(pos*sc + q*3.5 + uSeed + vec3(6.3,3.1,5.8)),
                0.0);
  float h = fbm5(pos*sc + r*2.0 + uSeed);

  // Tectonic plate influence: raise/lower entire plate regions
  if(uTectonics > 0.02) {
    vec3 vp = voronoiPlates(pos, sc * 0.7 + uSeed * 0.01);
    float plateH = fract(vp.z * 7.13) * 0.4 - 0.15; // plate altitude bias
    // Noise-modulated edge width for organic plate boundaries in height too
    float edgeNoise = noise3D(pos * 8.0 + uSeed * 2.7) * 0.5 + 0.5;
    float edgeWidth = mix(0.04, 0.14, edgeNoise);
    float edgeBreak = smoothstep(0.25, 0.45, noise3D(pos * 3.2 + uSeed * 5.1));
    float edge = smoothstep(0.0, edgeWidth, vp.y);
    float edgeMask = (1.0 - edge) * edgeBreak;
    h += plateH * uTectonics * 0.25;
    // Mountain ridges at plate boundaries (subduction zones)
    h += edgeMask * uTectonics * 0.12;
    // Rift valleys at some boundaries
    float riftBias = fract(vp.z * 13.7);
    if(riftBias > 0.6)
      h -= edgeMask * uTectonics * 0.08;
  }

  // Mountain ridges
  if(uMountainHeight > 0.01)
    h += ridgedFbm(pos*sc*2.0 + uSeed + 200.0) * uMountainHeight * 0.30;

  // Valley carving
  if(uValleyDepth > 0.01)
    h -= smoothstep(0.45,0.55,fbm3(pos*sc*1.5+uSeed+300.0)) * uValleyDepth * 0.15;

  // Craters (3D Voronoi bowl+rim)
  if(uCraterDensity > 0.01) {
    vec3 cp = pos*sc*3.0 + uSeed;
    vec3 ci = floor(cp), cf = fract(cp);
    float md = 1.0;
    // 3x3x3 crater search — proper nearest-cell detection
    for(int x=-1;x<=1;x++)
      for(int y=-1;y<=1;y++)
        for(int z=-1;z<=1;z++){
          vec3 g = vec3(float(x),float(y),float(z));
          vec3 o = fract(sin(vec3(
            dot(ci+g,vec3(127.1,311.7,74.7)),
            dot(ci+g,vec3(269.5,183.3,246.1)),
            dot(ci+g,vec3(113.5,271.9,124.6))))*43758.5453)*0.5+0.25;
          md = min(md, length(g+o-cf));
        }
    h -= (1.0-smoothstep(0.0,0.18,md)) * uCraterDensity * 0.10;
    h += smoothstep(0.16,0.22,md)*(1.0-smoothstep(0.22,0.30,md)) * uCraterDensity * 0.03;
  }

  // Volcanism
  if(uVolcanism > 0.01)
    h += smoothstep(0.62,0.82,fbm3(pos*sc*0.8+uSeed+500.0)) * uVolcanism * 0.18;

  // Cracks — domain-warped for organic, meandering paths
  if(uCrackIntensity > 0.01) {
    // Warp the crack coordinate for natural-looking paths
    vec3 crWarp = pos*sc*3.5 + uSeed + 400.0;
    crWarp += vec3(noise3D(pos*sc*1.8+uSeed+410.0),
                   noise3D(pos*sc*1.8+uSeed+420.0),
                   noise3D(pos*sc*1.8+uSeed+430.0)) * 0.35;
    float cr = abs(noise3D(crWarp)*2.0-1.0);
    // Wider smoothstep + noise-varied width for organic cracks
    float crWidth = 0.06 + noise3D(pos*sc*2.0+uSeed+440.0) * 0.05;
    // Some cracks fade out (breakup)
    float crBreak = smoothstep(0.2, 0.5, noise3D(pos*sc*1.2+uSeed+450.0));
    h -= (1.0-smoothstep(0.0, crWidth, cr)) * uCrackIntensity * 0.06 * crBreak;
  }

  // Age: young=smooth, old=rough
  h = mix(h, h*0.7+0.15, (1.0-uTerrainAge)*0.3);
  return h;
}

// =============================================================
// TRIPLANAR TEXTURE -- no pole pinching
// =============================================================
vec3 triplanarSample(sampler2D tex, vec3 p, vec3 n, float sc) {
  vec3 bl = abs(n); bl = pow(bl,vec3(8.0)); bl /= dot(bl,vec3(1.0));
  // Offset each projection plane slightly to break up tiling repetition
  vec2 uvYZ = p.yz * sc + vec2(0.37, 0.13);
  vec2 uvXZ = p.xz * sc + vec2(0.71, 0.59);
  vec2 uvXY = p.xy * sc + vec2(0.23, 0.47);
  return texture2D(tex, uvYZ).rgb * bl.x
       + texture2D(tex, uvXZ).rgb * bl.y
       + texture2D(tex, uvXY).rgb * bl.z;
}

// =============================================================
// CLOUD ROTATION -- latitude-aware, avoids pole pinch
// =============================================================
vec3 cloudWarp(vec3 p, float speed) {
  // Rotate around Y axis proportional to cos(lat) -- no pole pinch
  float lat = asin(clamp(p.y, -1.0, 1.0));
  float windSpeed = speed * cos(lat); // zero speed at poles
  float angle = windSpeed * uTime;
  float c = cos(angle), s = sin(angle);
  return vec3(p.x*c - p.z*s, p.y, p.x*s + p.z*c);
}

// =============================================================
// GAS GIANT
// =============================================================
vec3 gasGiantColor(vec3 pos) {
  float lat = pos.y;
  float seed = uSeed;
  float bf = 8.0 + sin(seed*7.13)*4.0;

  // Animated latitude-differential zonal wind (visible band drift)
  float windAngle = cos(asin(clamp(lat,-1.0,1.0))) * uTime * 0.12;
  vec3 wpos = vec3(
    pos.x * cos(windAngle) - pos.z * sin(windAngle),
    pos.y,
    pos.x * sin(windAngle) + pos.z * cos(windAngle));

  // Temporal turbulence evolution — bands shift and churn over time
  float tEvol = uTime * 0.04;
  vec3 evolOffset = vec3(sin(tEvol*0.7)*0.3, 0.0, cos(tEvol*1.1)*0.3);

  float bands = sin(lat*bf + fbm3(wpos*3.0+seed+evolOffset)*1.8);
  float bands2 = sin(lat*bf*2.3+1.0 + fbm3(wpos*5.0+seed+80.0+evolOffset*0.7)*0.9);
  float turb = fbm5(wpos*6.0 + vec3(0,tEvol*0.5,seed+100.0));
  float turbFine = fbm3(wpos*14.0 + vec3(0,tEvol*0.8,seed+200.0));
  float shear = noise3D(vec3(lat*5.0, uTime*0.05, seed))*0.3;

  // [27] Chevron / festoon patterns at band boundaries
  float bandEdge = abs(fract(lat*bf*0.5/(3.14159*2.0)+0.5)-0.5)*2.0;
  float chevronZone = smoothstep(0.0, 0.15, bandEdge) * (1.0 - smoothstep(0.15, 0.35, bandEdge));
  float lon = atan(wpos.z, wpos.x);
  float chevron = sin(lon * 12.0 + lat * 25.0 + turb * 8.0 + uTime * 0.25) * 0.5 + 0.5;
  float chevronFine = sin(lon * 20.0 - lat * 18.0 + turbFine * 6.0 + uTime * 0.35) * 0.3 + 0.5;
  float festoon = chevronZone * (chevron * 0.6 + chevronFine * 0.4);

  float bandMix = bands*0.55 + bands2*0.30 + shear;
  bandMix += (turb-0.5)*0.50 + (turbFine-0.5)*0.22;
  bandMix += festoon * 0.30;

  // Belt/zone color contrast — belts darker, zones brighter
  float beltZone = sin(lat*bf*0.5)*0.5+0.5;
  vec3 beltCol = uColor1 * 0.50;  // darker belts — deep contrast
  vec3 zoneCol = uColor2 * 1.40;  // brighter zones — vivid

  vec3 col = mix(beltCol, zoneCol, beltZone*0.50+0.20);
  col = mix(col, mix(uColor1, uColor2, smoothstep(-0.8,0.8,bandMix)), 0.40);
  col = mix(col, uColor3, smoothstep(0.55,0.72,turb)*0.40);

  // Great storm vortex — more prominent with visible rotation
  float sLat = 0.35 + sin(seed*3.14)*0.2;
  float sLon = seed * 1.618 + uTime * 0.07; // storm drifts in longitude
  vec3 sc = vec3(cos(sLon)*cos(sLat), sin(sLat), sin(sLon)*cos(sLat));
  float sd = length(pos - sc);
  float sm = 1.0 - smoothstep(0.0, 0.28, sd);
  if(sm > 0.001) {
    float ang = atan(pos.z-sc.z, pos.x-sc.x);
    float spiral = sin(ang*4.0+sd*22.0+uTime*0.70)*0.5+0.5;
    float spiralFine = sin(ang*8.0+sd*40.0+uTime*0.50)*0.3+0.5;
    vec3 stormCol = mix(uColor3,vec3(1,0.92,0.82),spiral*0.35+spiralFine*0.15);
    col = mix(col, stormCol, sm*0.75);
  }
  // Secondary storm
  float s2Lat = -0.20+sin(seed*5.67)*0.15;
  float s2Lon = seed*2.71 + uTime*0.05;
  vec3 sc2 = vec3(cos(s2Lon)*cos(s2Lat),sin(s2Lat),sin(s2Lon)*cos(s2Lat));
  col = mix(col, uColor3*1.1, (1.0-smoothstep(0.0,0.14,length(pos-sc2)))*0.55);

  return col;
}

// =============================================================
// MAIN
// =============================================================
void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(vViewDir);
  vec3 L = normalize(uSunDir);
  vec3 pos = normalize(vObjPos);
  vec3 H = normalize(L+V);
  float rim = 1.0 - max(dot(N,V),0.0);

  vec3 finalColor;

  // ==== GAS GIANT PATH ====
  if(uIsGas > 0.5) {
    vec3 color = gasGiantColor(pos);
    float NdotL = max(dot(N,L),0.0);
    float term = smoothstep(-0.05,0.18,NdotL);
    // [15] Polar darkening/brightening — Jupiter-like limb-darkened poles
    float gasLat = abs(pos.y);
    float polarDark = 1.0 - smoothstep(0.55, 0.90, gasLat) * 0.25;
    color *= polarDark;
    finalColor = color * NdotL * 0.95 * term + color * 0.02;
    // Tinted specular (not pure white — matches atmosphere)
    vec3 specTint = mix(vec3(1.0), uAtmColor * 0.5 + 0.5, 0.3);
    finalColor += specTint * pow(max(dot(N,H),0.0),120.0) * 0.06 * term;
    // [16] Atmospheric haze rim — subtle, day-side only
    float gasHazeRim = pow(rim, 3.0);
    vec3 gasHazeCol = uAtmColor * 0.6 + vec3(0.05, 0.08, 0.12);
    finalColor += gasHazeCol * gasHazeRim * 0.20 * term;
    // Limb darkening
    finalColor *= 1.0 - pow(rim,4.0)*0.40;
    // ACES filmic tone mapping (no gamma — ACES already maps to display range)
    finalColor = finalColor * (finalColor * 2.51 + 0.03) / (finalColor * (finalColor * 2.43 + 0.59) + 0.14);
    gl_FragColor = vec4(clamp(finalColor, 0.0, 1.0), 1.0);
    return;
  }

  // ==== SOLID WORLD PATH ====
  float eps = 0.005;
  vec3 pX = normalize(pos+vec3(eps,0,0));
  vec3 pZ = normalize(pos+vec3(0,0,eps));

  float h  = terrainHeight(pos);
  float hX = terrainHeight(pX);
  float hZ = terrainHeight(pZ);

  // Forward-difference bump (3 samples, not 4)
  vec3 dH = vec3(h-hX, 0.0, h-hZ);
  dH.y = -(dH.x + dH.z) * 0.5; // approximate Y from X+Z
  vec3 bumpN = normalize(N + dH * 16.0);

  float NdotL = max(dot(bumpN,L),0.0);
  float absLat = abs(pos.y);
  float slope = length(dH) * 120.0;

  // ---- VORONOI BIOME REGIONS ----
  vec3 vp = voronoiPlates(pos, uNoiseScale * 0.55 + uSeed * 0.005);
  float biomeId = vp.z;     // 0-1 hash per plate

  // Plate borders: noise-modulated width for organic, natural-looking boundaries.
  // Some segments fade out entirely (geological breakup), others widen.
  float borderNoise = noise3D(pos * 8.0 + uSeed * 2.7) * 0.5 + 0.5;
  float borderBreak = smoothstep(0.20, 0.50, noise3D(pos * 3.2 + uSeed * 5.1)); // segments vanish
  float borderWidth = mix(0.08, 0.22, borderNoise); // wider blend range
  float plateBorder = (1.0 - smoothstep(0.0, borderWidth, vp.y)) * borderBreak;

  // ---- OCEAN (heightmap-driven water surface) ----
  float shoreN = noise3D(pos*18.0+uSeed*3.3)*0.012
               + noise3D(pos*36.0+uSeed*5.1)*0.006;  // dual-freq shore detail
  float effOcean = uOceanLevel + shoreN;
  float underwaterDepth = effOcean - h;
  float shoreBlend = smoothstep(-0.04, 0.035, underwaterDepth); // wider transition zone
  bool isOcean = shoreBlend > 0.01;

  vec3 color;
  if(isOcean) {
    // Depth-dependent ocean color (shallow turquoise -> deep navy)
    float depth01 = clamp(underwaterDepth / max(uOceanLevel,0.01), 0.0, 1.0);
    vec3 shallowC = uOceanColor * 1.4 + vec3(0.04,0.08,0.06);
    vec3 deepC = uOceanColor * 0.35;
    color = mix(shallowC, deepC, smoothstep(0.0,0.5,depth01));
    // Smooth continuous ocean floor variation — NO voronoi cell boundaries
    // Use multi-octave 3D noise for gentle, organic color variation across the ocean
    float oceanVar1 = noise3D(pos * 3.5 + uSeed * 1.3) * 0.5 + 0.5;
    float oceanVar2 = noise3D(pos * 7.0 + uSeed * 2.7) * 0.5 + 0.5;
    float oceanVar  = oceanVar1 * 0.7 + oceanVar2 * 0.3;
    float floorHue = (oceanVar - 0.5) * 0.8;
    color += vec3(floorHue*0.03, -floorHue*0.02, floorHue*0.05) * (1.0-depth01*0.8);

    // Shore foam fringe — wider, softer transition
    float foam = 1.0 - smoothstep(0.0, 0.015, underwaterDepth);
    foam *= noise3D(pos*60.0+uTime*0.5)*0.7+0.3;
    color = mix(color, vec3(0.85,0.90,0.95), foam*0.50);
    // Sandy shallows tint (warm near-shore band)
    float sandyShallow = smoothstep(0.0, 0.025, underwaterDepth) * (1.0-smoothstep(0.025, 0.08, underwaterDepth));
    color = mix(color, uOceanColor*1.2+vec3(0.1,0.08,0.04), sandyShallow*0.30);

    // Animated wave normals (dual-frequency, latitude-aware rotation)
    vec3 wp1 = cloudWarp(pos, 0.02) * 45.0;
    vec3 wp2 = cloudWarp(pos, -0.015) * 30.0;
    float w1 = noise3D(wp1+uSeed)*2.0-1.0;
    float w2 = noise3D(wp2+uSeed+50.0)*2.0-1.0;
    float waveStr = 0.06 * (1.0-depth01*0.8);
    bumpN = normalize(N + vec3(w1,0,w2)*waveStr);
    NdotL = max(dot(bumpN,L),0.0);

    // [22] Ocean sun-glint hotspot — concentrated specular reflection
    vec3 oceanH = normalize(L + V);
    float oceanNdotH = max(dot(bumpN, oceanH), 0.0);
    float glintPow = pow(oceanNdotH, 320.0);    // very tight hotspot
    float glintWide = pow(oceanNdotH, 48.0);    // broader shimmer
    // Fresnel-modulated intensity (brighter at grazing angles)
    float glintFresnel = 0.04 + 0.96 * pow(1.0 - max(dot(bumpN, V), 0.0), 5.0);
    vec3 glintCol = vec3(1.0, 0.98, 0.92);
    color += glintCol * (glintPow * 0.55 + glintWide * 0.08) * glintFresnel * (1.0 - depth01 * 0.6);
  } else {
    // ---- LAND: Biome-aware coloring ----
    float t = smoothstep(0.28, 0.82, h);

    // Per-plate color variation via biomeId hash
    float hueShift = (biomeId - 0.5) * 0.18;
    // Per-plate albedo/brightness variation — each zone gets unique brightness
    float plateAlbedo = 0.82 + fract(biomeId * 17.31) * 0.36; // 0.82 to 1.18
    float plateSatMod = 0.90 + fract(biomeId * 23.57) * 0.20; // subtle saturation variation
    vec3 c1b = uColor1 + vec3(hueShift, hueShift*0.5, -hueShift*0.3);
    vec3 c2b = uColor2 + vec3(hueShift*0.7, -hueShift*0.3, hueShift*0.4);
    vec3 c3b = uColor3 + vec3(-hueShift*0.4, hueShift*0.3, hueShift*0.2);
    c1b *= plateAlbedo; c2b *= plateAlbedo; c3b *= plateAlbedo;
    // Desaturate/saturate slightly per plate
    float lum1 = dot(c1b, vec3(0.299,0.587,0.114));
    c1b = mix(vec3(lum1), c1b, plateSatMod);
    float lum2 = dot(c2b, vec3(0.299,0.587,0.114));
    c2b = mix(vec3(lum2), c2b, plateSatMod);

    // Height-based color ramp with smooth transitions
    color = t < 0.35 ? mix(c1b, c2b, t/0.35)
          : t < 0.65 ? mix(c2b, c3b, (t-0.35)/0.30)
          : mix(c3b, c2b*0.7+0.10, (t-0.65)/0.35);

    // Texture-informed coloring (triplanar, no pole pinch)
    if(uTexInfluence > 0.01) {
      float ts = uTriplanarScale;
      vec3 tLow  = triplanarSample(uTexLow,  pos, N, ts);
      vec3 tMid  = triplanarSample(uTexMid,  pos, N, ts);
      vec3 tHigh = triplanarSample(uTexHigh, pos, N, ts);
      vec3 texC = t < 0.35 ? mix(tLow,tMid,t/0.35)
                : t < 0.65 ? mix(tMid,tHigh,(t-0.35)/0.30)
                : tHigh;
      color = mix(color, texC, uTexInfluence*0.50);
    }

    // Latitude: cooler tone at poles (uses abs(y) -- sphere 3D, no UV pinch)
    color = mix(color, mix(color,vec3(0.76,0.79,0.86),0.22), smoothstep(0.50,0.85,absLat));

    // Latitude-band brightness variation — equatorial, mid-lat, polar zones differ
    float latBand = sin(absLat * 6.28 + uSeed * 0.1) * 0.08;
    color *= 1.0 + latBand;

    // Slope: rocky cliff exposure
    // [12] Slope-dependent micro-detail bump noise for rough terrain
    float slopeRough = smoothstep(0.20, 0.55, slope);
    float microBump = noise3D(pos * 80.0 + uSeed + 700.0) * 0.5 + 0.5;
    color = mix(color, uColor2*0.50, slopeRough*0.50);
    color *= 1.0 - slopeRough * (1.0 - microBump) * 0.12; // micro-roughness darkening

    // [26] Crater ejecta ray patterns — bright radial rays from impact sites
    if(uCraterDensity > 0.01) {
      vec3 ecp = pos * uNoiseScale * 3.0 + uSeed;
      vec3 eci = floor(ecp), ecf = fract(ecp);
      // Find nearest crater center for ejecta rays
      float eDist = 1.0;
      vec3 eCenter = vec3(0.0);
      for(int x=-1;x<=1;x++)
        for(int y=-1;y<=1;y++)
          for(int z=-1;z<=1;z++){
            vec3 g = vec3(float(x),float(y),float(z));
            vec3 o = fract(sin(vec3(
              dot(eci+g,vec3(127.1,311.7,74.7)),
              dot(eci+g,vec3(269.5,183.3,246.1)),
              dot(eci+g,vec3(113.5,271.9,124.6))))*43758.5453)*0.5+0.25;
            float d = length(g+o-ecf);
            if(d < eDist) { eDist = d; eCenter = g + o; }
          }
      // Radial ray pattern from crater center
      vec3 toCenter = normalize(ecf - eCenter);
      float rayAngle = atan(toCenter.z, toCenter.x);
      float rays = sin(rayAngle * 7.0 + fract(sin(dot(eci, vec3(37.1, 91.7, 53.3))) * 43758.5) * 6.28) * 0.5 + 0.5;
      rays = smoothstep(0.55, 0.85, rays);
      // Ejecta visible between crater rim and ~3x crater radius
      float ejectaZone = smoothstep(0.18, 0.25, eDist) * (1.0 - smoothstep(0.25, 0.55, eDist));
      // Only fresh craters have visible ejecta (high crater density = old surface, less visible)
      float freshness = step(0.5, fract(sin(dot(eci, vec3(71.3, 23.9, 17.1))) * 43758.5));
      color += vec3(0.12, 0.10, 0.08) * rays * ejectaZone * freshness * uCraterDensity * 0.6;
    }

    // [29] Terrain color noise breakup — high-frequency detail variation
    float microVar = noise3D(pos * 65.0 + uSeed + 800.0) * 0.5 + 0.5;
    float microVar2 = noise3D(pos * 130.0 + uSeed + 850.0) * 0.5 + 0.5;
    color *= 0.92 + 0.08 * microVar + 0.04 * microVar2;  // ±6% brightness variation
    // Subtle hue micro-shift per-pixel
    color += (vec3(microVar, microVar2, microVar * microVar2) - 0.5) * 0.025;

    // Plate boundaries: subtle tonal shift (not dark lines)
    float borderDarken = mix(0.92, 0.85, borderNoise); // very subtle
    color *= mix(1.0, borderDarken, plateBorder * uTectonics * smoothstep(0.10, 0.35, uTectonics));

    // Vegetation (habitable conditions)
    if(length(uFoliageColor) > 0.01) {
      float veg = smoothstep(0.32,0.54,h) * (1.0-smoothstep(0.58,0.78,h));
      veg *= clamp(1.0-absLat*1.4, 0.0, 1.0);
      veg *= clamp(1.0-slope*2.5, 0.0, 1.0);
      veg *= smoothstep(0.03, 0.12, underwaterDepth < 0.0 ? -underwaterDepth : 0.0) + step(0.0, underwaterDepth-0.01) < 0.5 ? 0.0 : 1.0;
      // Vegetation patches using plate biome (some plates barren)
      float vegPlate = step(0.25, biomeId) * step(biomeId, 0.85);
      color = mix(color, uFoliageColor, veg * vegPlate * 0.55);
    }

    // Shore transition
    // [14] Wet-sand darkening — narrow band just above waterline
    float wetSand = smoothstep(0.0, 0.02, -underwaterDepth) * (1.0 - smoothstep(0.02, 0.06, -underwaterDepth));
    color *= 1.0 - wetSand * 0.25;
    color = mix(color, uOceanColor*0.8+0.06, shoreBlend*0.6);
  }

  // ---- ICE CAPS (3D noise, no pole pinch) ----
  // Frost-zone worlds (already icy surfaces): subtle pole variation instead of dramatic white caps
  if(uIceCaps > 0.01) {
    float iceLine = 1.0 - uIceCaps*0.55;
    float iceWarp = fbm3(pos*5.0+uSeed+50.0)*0.10;
    float ice = smoothstep(iceLine-0.06, iceLine+0.06, absLat+iceWarp);

    // Reduce polar whitening for ice worlds — they're already icy everywhere
    float iceWorldDampen = uIsIceWorld > 0.5 ? 0.25 : 1.0;
    ice *= iceWorldDampen;

    vec3 iceCol = mix(vec3(0.90,0.93,0.97), vec3(0.70,0.82,0.96),
                      smoothstep(iceLine, iceLine+0.22, absLat)*0.42);
    // [13] Ice subsurface scattering — translucent blue-white at glancing angles
    float iceFresnel = pow(1.0 - max(dot(N, V), 0.0), 3.0);
    iceCol += vec3(0.15, 0.25, 0.40) * iceFresnel * 0.25 * max(dot(N, L), 0.0);
    // For frost-zone worlds, ice is slightly tinted by the base surface color
    if(uIsIceWorld > 0.5) {
      iceCol = mix(iceCol, color*1.15, 0.35);
    }
    // Glacier crevasses via 3D noise (not sin(pos.x) which pinches at poles)
    float glacier = abs(noise3D(pos*25.0+uSeed+60.0)*2.0-1.0);
    iceCol -= smoothstep(0.0,0.12,glacier)*0.05*ice;
    color = mix(color, iceCol, ice);
  }

  // ---- TIDALLY LOCKED EYEBALL ----
  if(uTidallyLocked > 0.5 && uSpinOrbit32 < 0.5) {
    float facing = dot(pos,L);
    float iceWarpT = fbm3(pos*6.0+uSeed+150.0)*0.20;
    float iceMask = smoothstep(0.12,-0.55,facing+iceWarpT);
    vec3 tidalIce = mix(vec3(0.82,0.86,0.94),vec3(0.55,0.68,0.88),
                        smoothstep(-0.3,-0.85,facing)*0.60);
    color = mix(color, tidalIce, iceMask);
    float heatMask = smoothstep(0.50,0.90,facing);
    color = mix(color, mix(color*0.50,vec3(0.28,0.14,0.05),0.55), heatMask*0.55);
    if(uSubstellarTemp > 500.0) {
      float molten = smoothstep(0.82,0.97,facing);
      color = mix(color, vec3(1,0.35,0.06)*smoothstep(0.35,0.55,
        fbm3(pos*10.0+uSeed+170.0)), molten*0.60);
    }
  }

  // ---- LIGHTING (Oren-Nayar diffuse + ambient fill) ----
  float terminator = smoothstep(-0.08, 0.25, NdotL);
  // Height-based ambient occlusion: low terrain darker, ridges brighter
  float ao = 0.85 + 0.15 * smoothstep(0.35, 0.65, h);
  vec3 ambient = color * 0.08 * ao;
  vec3 lit = color * NdotL * 0.88;
  finalColor = lit * terminator + ambient;

  // Specular: water gets sharp sun-glint, land gets subtle sheen
  if(isOcean) {
    // Schlick fresnel for wider glancing-angle sun glint
    float f0 = 0.02;
    float fresnelOcean = f0 + (1.0 - f0) * pow(1.0 - max(dot(bumpN, V), 0.0), 5.0);
    float spec = pow(max(dot(bumpN,H),0.0), 280.0) * (0.35 + fresnelOcean * 0.45);
    finalColor += vec3(spec) * terminator;
    // Wide-angle glint at grazing angles
    float wideGlint = pow(max(dot(bumpN,H),0.0), 40.0) * fresnelOcean * 0.12;
    finalColor += vec3(wideGlint) * terminator;
    // Subsurface scattering blue for shallow water
    float sss = pow(max(dot(-bumpN,L),0.0),3.0) * 0.08;
    finalColor += uOceanColor * sss * terminator;
  } else {
    float spec = pow(max(dot(bumpN,H),0.0), 40.0) * 0.04;
    finalColor += vec3(spec) * terminator;
  }

  // ---- LAVA EMISSION ----
  // [25] Animated flow + pulsing glow along cracks
  if(uEmissive > 0.01) {
    // Animated domain warp — lava flows slowly shift
    vec3 lavaWarp = pos*uNoiseScale*2.0 + uSeed + 80.0;
    lavaWarp += vec3(sin(uTime*0.08)*0.15, cos(uTime*0.06)*0.12, sin(uTime*0.1)*0.10);
    float lavaN = fbm3(lavaWarp);
    // Crack pattern with time-evolving domain warp
    vec3 crackWarp = pos*uNoiseScale*5.0 + uSeed + 120.0;
    crackWarp += vec3(sin(uTime*0.05+pos.x*3.0)*0.08, 0.0, cos(uTime*0.07+pos.z*3.0)*0.08);
    float crackN = noise3D(crackWarp);
    float lavaMask = smoothstep(0.43,0.58,lavaN)*smoothstep(0.35,0.50,crackN);
    float nightF = 1.0 - terminator;
    // Pulsing glow — different regions pulse at different rates
    float lavaPulse = 0.75 + 0.25 * sin(uTime * 1.2 + lavaN * 12.0 + pos.x * 5.0);
    // Temperature gradient: white-hot center → orange → dark red edges
    float lavaTemp = lavaMask * lavaPulse;
    vec3 lavaHot = vec3(1.0, 0.65, 0.20);  // orange-hot
    vec3 lavaWhite = vec3(1.0, 0.90, 0.60); // white-hot center
    vec3 lavaCol = mix(lavaHot, lavaWhite, smoothstep(0.3, 0.7, lavaTemp));
    finalColor += lavaCol * lavaMask * nightF * uEmissive * 3.5 * lavaPulse;
    // Dayside: lava still visible but darkened by sunlight
    finalColor = mix(finalColor, finalColor*0.5, lavaMask*0.35*terminator);
  }

  // ---- DUAL CLOUD LAYERS (latitude-aware rotation) ----
  if(uCloudDensity > 0.01) {
    // Layer 1: Low cumulus (slower, thicker, larger scale)
    vec3 cp1 = cloudWarp(pos, 0.004);
    float lo = noise3D(cp1*4.0+uSeed+30.0)
             + noise3D(cp1*8.0+uSeed+31.0)*0.5
             + noise3D(cp1*16.0+uSeed+32.0)*0.25;
    lo /= 1.75;
    float cumulus = smoothstep(0.50-uCloudDensity*0.26, 0.70, lo)*uCloudDensity;

    // Layer 2: High cirrus (faster, thinner, wispy)
    vec3 cp2 = cloudWarp(pos, 0.007);
    float hi = noise3D(cp2*6.0+uSeed+40.0)
             + noise3D(cp2*12.0+uSeed+41.0)*0.5;
    hi /= 1.5;
    float cirrus = smoothstep(0.55, 0.78, hi) * uCloudDensity * 0.5;

    float totalCloud = min(cumulus + cirrus, 0.90);

    // [11] Cloud edge softening — noise-based alpha feathering
    float cloudEdgeNoise = noise3D(pos * 28.0 + uSeed + 55.0) * 0.5 + 0.5;
    totalCloud *= smoothstep(0.0, 0.15, totalCloud) * (0.85 + 0.15 * cloudEdgeNoise);
    cumulus *= smoothstep(0.0, 0.10, cumulus) * (0.88 + 0.12 * cloudEdgeNoise);
    cirrus *= smoothstep(0.0, 0.08, cirrus);

    // Cloud lighting: bright on dayside, warm sunset at terminator,
    // atmospheric blue tint in shadows, refraction glow past terminator
    vec3 cloudCol = vec3(0.95,0.97,0.99);
    float cSunA = dot(N,L);
    float cSunDay = max(cSunA, 0.0);
    float cTerm = exp(-pow(cSunA-0.03,2.0)/0.028); // sunset band
    vec3 sunsetC = vec3(1.0,0.60,0.28)*0.45 + uAtmColor*0.55;
    cloudCol = mix(cloudCol, sunsetC, cTerm*0.30);
    // Clouds fully dark on night side — no backlit glow
    cloudCol *= smoothstep(-0.02,0.15,cSunA);

    // High cirrus slightly different tint (ice crystals)
    vec3 cirrusCol = mix(cloudCol, vec3(0.90,0.92,1.0), 0.3);

    // [10] Cloud self-shadowing — higher clouds darken terrain beneath
    float cloudShadow = 1.0 - totalCloud * 0.35 * max(dot(N,L), 0.0);
    finalColor *= cloudShadow;

    // [28] Cloud shadow on ocean — visible shadow patterns on water below
    if(isOcean) {
      // Offset cloud position toward sun to simulate shadow parallax
      vec3 shadowPos = pos + L * 0.008; // slight offset toward light
      vec3 sp1 = cloudWarp(shadowPos, 0.004);
      float sLo = noise3D(sp1*4.0+uSeed+30.0)
               + noise3D(sp1*8.0+uSeed+31.0)*0.5;
      sLo /= 1.5;
      float shadowMask = smoothstep(0.50-uCloudDensity*0.26, 0.70, sLo)*uCloudDensity;
      // Darken ocean where cloud shadow falls (only on day side)
      finalColor *= 1.0 - shadowMask * 0.20 * max(dot(N,L), 0.0);
    }

    finalColor += cloudCol * cumulus * 0.45;
    finalColor += cirrusCol * cirrus * 0.30;
  }

  // Tidal storm vortex
  if(uTidallyLocked > 0.5 && uStormIntensity > 0.01) {
    float sDist = acos(clamp(dot(pos,L),-1.0,1.0));
    float sMask = 1.0-smoothstep(0.0,radians(uStormSize),sDist);
    float sSpiral = sin(atan(pos.z,pos.x)*5.0+sDist*15.0+uTime*0.06);
    sMask *= (sSpiral*0.3+0.7);
    finalColor += vec3(0.90,0.92,0.95)*sMask*uStormIntensity*0.24;
  }

  // ---- ATMOSPHERE (surface-side Rayleigh + terminator + refraction) ----
  // Supplements the ATM shell. Tightly limb-gated to avoid diffuse haze.
  if(uAtmThickness > 0.05) {
    float sunAngle = max(dot(N,L),0.0);
    float dayTerm  = smoothstep(-0.12,0.30,dot(N,L));

    // Hard limb gate — nothing visible inside 55% from edge
    float surfLimb = smoothstep(0.55, 0.92, rim);

    // Rayleigh sky-light scattered down onto the surface
    vec3 rayleighC = uAtmColor * vec3(0.22, 0.52, 1.0);
    float dayRim   = pow(rim,3.5)*uAtmThickness*dayTerm*surfLimb;
    finalColor += rayleighC * dayRim * 0.22;

    // Aerial perspective — only near the very edge
    float aerial = pow(rim,3.0)* uAtmThickness * dayTerm * surfLimb * 0.12;
    finalColor = mix(finalColor, uAtmColor * 0.8 + vec3(0.05,0.08,0.15), aerial);

    // Terminator sunset/sunrise glow — strongest near limb
    float termA    = dot(N,L) + 0.03;
    float termGlow = exp(-termA*termA / 0.028)*uAtmThickness;
    vec3 sunsetCol = vec3(1.0,0.50,0.18)*0.40 + uAtmColor*0.60;
    finalColor += sunsetCol * termGlow * surfLimb * 0.15;

    // Atmospheric refraction past terminator
    float refrA    = dot(N,L) + 0.07;
    float refrGlow = exp(-refrA*refrA / 0.006) * step(-0.14, dot(N,L));
    finalColor += vec3(0.70,0.45,0.20) * refrGlow * uAtmThickness * surfLimb * 0.05;

    // Night-side atmospheric glow — limb-gated
    float nightRim = pow(rim,3.0)*max(-dot(N,L),0.0)*uAtmThickness*surfLimb;
    finalColor += uAtmColor * nightRim * 0.06;
    finalColor += vec3(0.05,0.10,0.04) * nightRim * 0.08;
  }

  // ---- NIGHT-SIDE CITY LIGHTS (placeholder — will cluster around user-placed objects) ----
  if(uOceanLevel > 0.1 && uAtmThickness > 0.2) {
    float nightF = 1.0-smoothstep(-0.02,0.06,NdotL);
    float landM = step(effOcean,h);
    float cityN = fbm3(pos*38.0+uSeed*7.0);
    float cityPop = smoothstep(0.58,0.70,cityN)*landM;
    finalColor += vec3(1,0.82,0.44)*cityPop*nightF*0.10;
  }

  // ---- AURORA ----
  // [23] Proper curtain shapes with vertical structure & altitude-dependent color
  if(uAtmThickness > 0.10) {
    float aurZone = smoothstep(0.72,0.82,absLat)*(1.0-smoothstep(0.88,0.95,absLat));
    if(aurZone > 0.01) {
      // Curtain folds — undulating wave along longitude, animated drift
      float lon = atan(pos.z, pos.x);
      float curtainWave = sin(lon * 8.0 + uTime * 0.6 + uSeed * 3.0) * 0.5 + 0.5;
      curtainWave *= sin(lon * 13.0 + uTime * 0.35 + uSeed * 7.0) * 0.3 + 0.7;
      // Vertical shimmer — rapid flicker simulating electron precipitation
      float shimmer = noise3D(pos * 20.0 + vec3(0, uTime * 2.5, uSeed * 10.0));
      shimmer = smoothstep(0.3, 0.7, shimmer);
      float nightSide = 1.0 - smoothstep(-0.05, 0.15, NdotL);
      // Altitude-dependent color: green (557nm oxygen) at base,
      // red/purple (630nm oxygen + N2) at altitude
      float altFrac = smoothstep(0.72, 0.92, absLat); // proxy for altitude within auroral zone
      vec3 aurBase = vec3(0.1, 0.9, 0.3);    // green — most common
      vec3 aurMid  = vec3(0.15, 0.6, 0.5);   // teal transition
      vec3 aurTop  = vec3(0.5, 0.1, 0.7);    // purple/red — high altitude
      vec3 aurColor = mix(aurBase, aurMid, smoothstep(0.0, 0.5, altFrac));
      aurColor = mix(aurColor, aurTop, smoothstep(0.5, 1.0, altFrac));
      float aurIntensity = aurZone * curtainWave * shimmer * nightSide;
      finalColor += aurColor * aurIntensity * 0.09 * uAtmThickness;
    }
  }

  // ---- PLANETSHINE ----
  if(length(uPlanetShineColor) > 0.01) {
    float nightFade = 1.0-smoothstep(-0.15,0.10,NdotL);
    float pRim = pow(1.0-max(dot(N,V),0.0),2.0)*0.5+0.5;
    finalColor += uPlanetShineColor*nightFade*pRim*0.14;
  }

  // ---- SCIENCE OVERLAYS ----
  if(uShowTempMap > 0.5) {
    float sT = mix(uPolarTemp,uEquatorTemp,1.0-absLat);
    if(uTidallyLocked>0.5) sT=mix(uAntistellarTemp,uSubstellarTemp,dot(pos,L)*0.5+0.5);
    vec3 tC = sT<273.0 ? mix(vec3(0,0,1),vec3(0,1,1),sT/273.0)
            : sT<373.0 ? mix(vec3(0,1,0),vec3(1,1,0),(sT-273.0)/100.0)
            : mix(vec3(1,0.5,0),vec3(1,0,0),min((sT-373.0)/500.0,1.0));
    finalColor = mix(finalColor, tC*(0.35+dot(finalColor,vec3(0.3,0.6,0.1))*0.65), 0.72);
  }
  if(uShowMineralMap > 0.5) {
    vec3 mC = vec3(uIronPct,uSilicatePct,uWaterIcePct)*0.5+0.3;
    mC += vec3(uCarbonPct*0.3,uKreepIndex*0.5,0);
    finalColor = mix(finalColor, mC*(0.3+dot(finalColor,vec3(0.3,0.6,0.1))*0.7), 0.75);
  }

  // ---- TONE MAP (ACES-inspired, [19] adjusted shoulder/toe) + GAMMA ----
  // Slightly lifted toe for richer shadow detail, brighter mid highlights
  finalColor = finalColor * (finalColor * 2.51 + 0.04) / (finalColor * (finalColor * 2.43 + 0.55) + 0.14);
  // [20] Night-side ambient floor — ensure terrain never goes pure black
  finalColor = max(finalColor, vec3(0.008, 0.008, 0.012));
  finalColor = pow(clamp(finalColor, 0.0, 1.0), vec3(0.4545));

  gl_FragColor = vec4(finalColor, 1.0);
}
`;
/* ── Atmosphere Shell Shaders — Ray-march scattering ────────── */

const ATM_VERT = /* glsl */ `
varying vec3 vWorldPos;
varying vec3 vPlanetCenter;
varying float vPlanetR;
varying float vAtmR;

void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  // Planet center in world space (translation column of model matrix)
  vPlanetCenter = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  // Planet surface radius in world units (= geometry scale factor × 1.0)
  vPlanetR = length((modelMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
  // Atmosphere radius (this sphere's geometry radius × scale)
  vAtmR = length(wp.xyz - vPlanetCenter);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const ATM_FRAG = /* glsl */ `
precision highp float;
uniform vec3  uAtmColor;
uniform float uAtmThickness;
uniform vec3  uSunDir;
uniform vec3  uPlanetShineColor;

varying vec3 vWorldPos;
varying vec3 vPlanetCenter;
varying float vPlanetR;
varying float vAtmR;

// =============================================================
// Atmosphere v4 — 8-sample view-ray march through atmosphere
// volume with analytical sun optical depth.  Produces correct
// limb brightening, sunset colours, and visible halo.
// =============================================================

#define NUM_STEPS 8
#define PI 3.14159265

// Ray-sphere intersection → (tNear, tFar); both < 0 = miss
vec2 raySphere(vec3 ro, vec3 rd, vec3 c, float r) {
  vec3 oc = ro - c;
  float b = dot(oc, rd);
  float disc = b * b - (dot(oc, oc) - r * r);
  if (disc < 0.0) return vec2(-1.0);
  float s = sqrt(disc);
  return vec2(-b - s, -b + s);
}

void main() {
  vec3  center = vPlanetCenter;
  float rP = vPlanetR;                        // planet surface radius
  float rA = vAtmR;                           // atmosphere outer radius
  float H  = rA - rP;                         // atmosphere height
  if (H < 0.0001) discard;

  vec3 ro  = cameraPosition;
  vec3 rd  = normalize(vWorldPos - cameraPosition);
  vec3 sun = normalize(uSunDir);
  float mu = dot(rd, sun);                    // view-sun cosine

  // ── Intersect view ray with atmosphere and planet ──────────
  vec2 tAtm = raySphere(ro, rd, center, rA);
  vec2 tPln = raySphere(ro, rd, center, rP);

  float tNear = max(tAtm.x, 0.0);
  float tFar  = tAtm.y;
  if (tPln.x > 0.0) tFar = min(tFar, tPln.x); // stop at planet surface
  if (tFar <= tNear) discard;

  float ds = (tFar - tNear) / float(NUM_STEPS);

  // ── Scattering coefficients (tuned for geometry scale) ─────
  float invH = 1.0 / H;

  // Rayleigh: λ^-4 wavelength dependence.  Mild tint by uAtmColor so
  // blue atmospheres stay strongly blue while exotic atm colours show.
  // [7] Reduced magnitude to avoid oversaturated blue halos
  vec3  bR = vec3(0.06, 0.16, 0.40) * invH * uAtmThickness;
  bR *= (0.50 + 0.50 * uAtmColor);

  // Mie: wavelength-independent scatter, coloured by atmosphere haze
  vec3 bM = uAtmColor * 0.035 * invH * uAtmThickness;

  // Scale heights (fraction of atmosphere height)
  float hR = 0.35;    // Rayleigh
  float hM = 0.12;    // Mie (concentrated lower)

  // ── Phase functions ────────────────────────────────────────
  float phR = (3.0 / (16.0 * PI)) * (1.0 + mu * mu);

  // Cornette-Shanks Mie phase (g = 0.55 for gentle forward glow, no hot-spot)
  float g   = 0.55;
  float g2  = g * g;
  float phM = (3.0 / (8.0 * PI)) * ((1.0 - g2) * (1.0 + mu * mu))
            / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * g * mu, 1.5));

  // [9] Back-scatter lobe (g = -0.25) for realistic back-lit haze
  float gB  = -0.25;
  float gB2 = gB * gB;
  float phMback = (3.0 / (8.0 * PI)) * ((1.0 - gB2) * (1.0 + mu * mu))
               / ((2.0 + gB2) * pow(1.0 + gB2 - 2.0 * gB * mu, 1.5));
  phM = phM * 0.90 + phMback * 0.10; // blend forward + backward lobes

  // ── Multi-scatter approximation ─────────────────────────────
  // Real atmospheres scatter blue light back into long view paths
  // via higher-order bounces.  We approximate this by dampening
  // the view-path extinction (ms < 1).  Sun-path extinction stays
  // at full strength so sunsets are correctly reddened.
  float ms = 0.25;

  // ── March along view ray ───────────────────────────────────
  vec3  scatter = vec3(0.0);
  float odR = 0.0, odM = 0.0;           // accumulated view optical depth

  for (int i = 0; i < NUM_STEPS; i++) {
    float t  = tNear + (float(i) + 0.5) * ds;
    vec3  P  = ro + rd * t;
    float alt = (length(P - center) - rP) / H; // normalised altitude 0-1

    float dR = exp(-alt / hR) * ds;      // Rayleigh density × step
    float dM = exp(-alt / hM) * ds;      // Mie density × step
    odR += dR;
    odM += dM;

    // ── Sun illumination reaching this sample ──────────────
    vec3 Pn     = normalize(P - center);
    float sunCos = dot(Pn, sun);

    if (sunCos > -0.08) {
      // Analytical sun path optical depth (plane-parallel approx)
      float sf = 1.0 / max(sunCos + 0.08, 0.012);
      sf = min(sf, 55.0);                 // cap to prevent fireflies
      float sR = exp(-alt / hR) * H * hR * sf;
      float sM = exp(-alt / hM) * H * hM * sf;

      // Sun-path extinction at full strength (correct sunset reddening)
      vec3 sunAttn = exp(-(bR * sR + bM * sM));

      // View-path extinction with multi-scatter dampening
      // (prevents blue from being killed along long limb rays)
      vec3 viewAttn = exp(-(bR * odR + bM * odM) * ms);

      // [8] Sunset color injection near terminator
      // When sun is near horizon (sunCos ~ 0), inject orange/red tint
      float sunsetFactor = exp(-sunCos * sunCos / 0.025) * step(-0.08, sunCos);
      vec3 sunsetTint = mix(vec3(1.0), vec3(1.0, 0.55, 0.22), sunsetFactor * 0.25);

      scatter += (dR * bR * phR + dM * bM * phM) * sunAttn * viewAttn * sunsetTint;
    }
  }

  // ── Night-side airglow (emission, no sun needed) ───────────
  vec3  fragN   = normalize(vWorldPos - center);
  float nightF  = max(-dot(fragN, sun), 0.0);
  float rim     = 1.0 - max(dot(fragN, normalize(cameraPosition - center)), 0.0);
  scatter += vec3(0.06, 0.15, 0.05) * pow(rim, 3.5) * nightF * uAtmThickness * 0.22;

  // ── Planet-shine ───────────────────────────────────────────
  if (length(uPlanetShineColor) > 0.01) {
    scatter += uPlanetShineColor * pow(rim, 3.0) * nightF * uAtmThickness * 0.10;
  }

  // ── Alpha from total view optical depth (dampened) ─────────
  float od = dot(bR * odR + bM * odM, vec3(0.33)) * ms;
  float alpha = 1.0 - exp(-od * 2.5);
  // Ensure bright scatter regions stay visible after blending
  alpha = max(alpha, length(scatter) * 0.45);
  float maxA = 0.35 + uAtmThickness * 0.55;

  gl_FragColor = vec4(scatter, clamp(alpha, 0.0, maxA));
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
  /** Planetshine — colored reflected light from nearby parent planet (rgb 0-1) */
  planetShineColor?: [number, number, number];
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
  planetShineColor,
}: Props & { displacement?: number; segments?: number }) {
  const groupRef = useRef<THREE.Group>(null!);
  const meshRef = useRef<THREE.Mesh>(null!);
  // Track latest sunDirection prop for per-frame uniform updates
  const sunDirRef = useRef(sunDirection);
  sunDirRef.current = sunDirection;

  const baseVis = V[planetType] || V['rocky'];
  const vis = deriveWorldVisuals(baseVis, { temperature, mass, tidalHeating, starSpectralClass });

  // ── World genome diversity — slot-machine combinatorial colors ──
  if (seed) {
    if (GAS_TYPES.has(planetType)) {
      applyGasGenome(vis, seed);
    } else if (!NO_GENOME.has(planetType)) {
      applyWorldGenome(vis, seed, temperature, mass ?? 1);
    }
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

  // ── Texture-informed coloring: load reference textures ──────────
  // Gas giants don't use texture triplets. For solid worlds, we load
  // 3 textures (low/mid/high) that inform the procedural color palette.
  const triplet = useMemo(() => {
    if (isGas || TEX_GAS_TYPES.has(planetType)) return null;
    return getTextureTriplet(planetType);
  }, [planetType, isGas]);

  const placeholderTex = useMemo(() => {
    const t = new THREE.DataTexture(
      new Uint8Array([128, 128, 128, 255]), 1, 1, THREE.RGBAFormat
    );
    t.needsUpdate = true;
    return t;
  }, []);

  const [textures, setTextures] = useState<{
    low: THREE.Texture; mid: THREE.Texture; high: THREE.Texture;
  } | null>(null);

  useEffect(() => {
    if (!triplet) { setTextures(null); return; }
    const loader = new THREE.TextureLoader();
    let cancelled = false;
    const loaded: Partial<{ low: THREE.Texture; mid: THREE.Texture; high: THREE.Texture }> = {};
    let count = 0;
    const onDone = () => {
      count++;
      if (count === 3 && !cancelled && loaded.low && loaded.mid && loaded.high) {
        setTextures(loaded as { low: THREE.Texture; mid: THREE.Texture; high: THREE.Texture });
      }
    };
    const loadOne = (id: string, key: 'low' | 'mid' | 'high') => {
      loader.load(
        texUrl(id),
        (tex) => { tex.wrapS = tex.wrapT = THREE.RepeatWrapping; loaded[key] = tex; onDone(); },
        undefined,
        () => { loaded[key] = placeholderTex; onDone(); }  // fallback on error
      );
    };
    loadOne(triplet.texLow, 'low');
    loadOne(triplet.texMid, 'mid');
    loadOne(triplet.texHigh, 'high');
    return () => { cancelled = true; };
  }, [triplet, placeholderTex]);

  const texLow  = textures?.low  ?? placeholderTex;
  const texMid  = textures?.mid  ?? placeholderTex;
  const texHigh = textures?.high ?? placeholderTex;
  const texInfluence = triplet?.texInfluence ?? 0;
  const triplanarScale = triplet?.triplanarScale ?? 3.0;

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
        uTerrainAge: { value: vis.terrainAge ?? 0.5 },
        uTectonics: { value: vis.tectonicsLevel ?? 0.0 },
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
        uPlanetShineColor: { value: new THREE.Vector3(
          planetShineColor?.[0] ?? 0, planetShineColor?.[1] ?? 0, planetShineColor?.[2] ?? 0
        ) },
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
        // Texture-informed coloring uniforms
        uTexLow: { value: texLow },
        uTexMid: { value: texMid },
        uTexHigh: { value: texHigh },
        uTexInfluence: { value: texInfluence },
        uTriplanarScale: { value: triplanarScale },
      },
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planetType, seed, cs[0], cs[1], cs[2], mass, tidalHeating, starSpectralClass,
      tidallyLocked, spinOrbit32, showTempMap, showMineralMap]);

  // Atmosphere shell material (solid worlds only, not gas giants)
  // Single ray-march shell handles all volumetric depth — no thick layers needed
  const atmMaterial = useMemo(() => {
    if (vis.atmThickness < 0.08 || isGas) return null;
    const psc = planetShineColor || [0, 0, 0];
    return new THREE.ShaderMaterial({
      vertexShader: ATM_VERT,
      fragmentShader: ATM_FRAG,
      uniforms: {
        uAtmColor: { value: new THREE.Color(vis.atmColor[0], vis.atmColor[1], vis.atmColor[2]) },
        uAtmThickness: { value: vis.atmThickness },
        uSunDir: { value: new THREE.Vector3(sunDirection[0], sunDirection[1], sunDirection[2]).normalize() },
        uPlanetShineColor: { value: new THREE.Vector3(psc[0], psc[1], psc[2]) },
      },
      transparent: true,
      side: THREE.FrontSide,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planetType, seed]);

  // ── Update texture uniforms when async textures arrive ──────
  useEffect(() => {
    if (material.uniforms.uTexLow) {
      material.uniforms.uTexLow.value = texLow;
      material.uniforms.uTexMid.value = texMid;
      material.uniforms.uTexHigh.value = texHigh;
      material.uniforms.uTexInfluence.value = texInfluence;
      material.uniforms.uTriplanarScale.value = triplanarScale;
      material.uniformsNeedUpdate = true;
    }
  }, [material, texLow, texMid, texHigh, texInfluence, triplanarScale]);

  useFrame((_, delta) => {
    // Scale rotation + shader time with shared orbit speed so pause/speed controls work
    const spd = (globalThis as any).__exomaps_orbit_speed ?? 1;
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * rotationSpeed * spd;
    }
    material.uniforms.uTime.value += delta; // always animate (gas giants, lava, clouds)
    // Update sun direction each frame so orrery planets light correctly
    const sd = sunDirRef.current;
    const sdVec = material.uniforms.uSunDir.value as THREE.Vector3;
    sdVec.set(sd[0], sd[1], sd[2]).normalize();
    material.uniformsNeedUpdate = true;
    // Also update atmosphere shell sun direction
    if (atmMaterial) {
      const atmSd = atmMaterial.uniforms.uSunDir.value as THREE.Vector3;
      atmSd.set(sd[0], sd[1], sd[2]).normalize();
      atmMaterial.uniformsNeedUpdate = true;
    }
  });

  return (
    <group ref={groupRef}>
      <mesh ref={meshRef} material={material}>
        <sphereGeometry args={[1, segments, Math.round(segments * 0.67)]} />
      </mesh>
      {atmMaterial && (
        <mesh material={atmMaterial}>
          <sphereGeometry args={[1.02 + vis.atmThickness * 0.06, 64, 48]} />
        </mesh>
      )}
    </group>
  );
}

export default ProceduralPlanet;
