/**
 * SystemFocusView V5 — Spatial depth-drill system explorer
 *
 * Philosophy: ONE full-screen 3D canvas IS the navigation.
 * No redundant sidebar or strip. Click bodies to drill deeper.
 * Fractal zoom: Star system → Planet system → Moon close-up.
 *
 * Depth levels:
 *   system  — Star at center, planets orbit, belts, habitable zone
 *   planet  — Planet fills center (ProceduralPlanet), moons orbit it
 *   moon    — Moon fills center, parent planet backdrop, habitats orbit
 *   belt    — Kirkwood scatter chart (2D Canvas)
 *
 * Layout:
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │  ← Map  ★ Sol  [G2V] [solar-analog]  4.3 ly  8 planets     │
 *   ├─────────────────────────────────────────────────────┬────────┤
 *   │                                                     │ ☀ Sol  │
 *   │  ☀ Sol › ♃ Jupiter › 🌑 Europa   ← breadcrumb      │ 5778 K │
 *   │                                                     │ G-type │
 *   │       FULL-SCREEN 3D ORRERY                         │────────│
 *   │     (depth-sensitive, click to navigate)             │ Planets│
 *   │                                                     │ ● Merc │
 *   │  system: star+planets+belts+HZ                      │ ● Venus│
 *   │  planet: globe+moons+rings+habitats                 │ ● Earth│
 *   │  moon:   globe+habitats+parent backdrop             │────────│
 *   │                                                     │ Belts  │
 *   │     [🔲 habitat cylinders in orbit]                  │ 🪨 Ast │
 *   │                                                     │ 🧊 Kui │
 *   └─────────────────────────────────────────────────────┴────────┘
 */

import React, { useEffect, useState, useRef, Suspense, useMemo, useCallback } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Text, Billboard } from '@react-three/drei';
// Bloom removed — multi-pass FBO causes flickering on Tauri wgpu/Vulkan
import * as THREE from 'three';
import type { TauriGPUHook, PlanetTexturesV2 } from '../hooks/useTauriGPU';
import { useScience } from '../hooks/useScience';
import { useCampaign } from '../hooks/useCampaign';
import { ErrorBoundary } from './ErrorBoundary';
import { V as PlanetProfiles, deriveWorldVisuals, ProceduralPlanet } from './ProceduralPlanet';
// TexturedPlanet replaced by ProceduralPlanet with texture-informed coloring
import type { TerrainParams } from './ColonyTerrain';
import { getStarData, bvToRGB, STAR_COUNT, FIELDS_PER_STAR } from '../data/hygStarCatalog';
import bundledSystems from '../data/systemsList.json';
import { PlanetSurfaceV2 } from './PlanetSurfaceV2';
import { PlanetEditorPanel } from './PlanetEditorPanel';
import { CompositionPanel } from './CompositionPanel';
import { AtmospherePanel } from './AtmospherePanel';
import { InteriorPanel } from './InteriorPanel';
import { ClimatePanel } from './ClimatePanel';
import { AtmosphereV2Panel } from './AtmosphereV2Panel';
import { ModelManifestPanel } from './ModelManifestPanel';
import { ColonyOverlay } from './ColonyOverlay';
import type { ColonyBuilding, BuildingType } from './ColonyOverlay';
import type { Ship } from './ColonyTerrain';
import type { BiomeInfo } from './ProceduralPlanet';

/* ━━ Orbit Time Accumulator (shared across all orbiting components) ━━ */
const _orbit = { time: 0, speed: 1.0 };

/** Accumulates orbit time with speed scaling — place inside Canvas */
function OrbitClock() {
  useFrame((_, delta) => {
    _orbit.time += delta * _orbit.speed;
    // Expose orbit speed globally so ProceduralPlanet can read it for rotation/shader time
    (globalThis as any).__exomaps_orbit_speed = _orbit.speed;
  });
  return null;
}

/* ━━ Types ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

interface Props {
  systemId: string;
  gpu: TauriGPUHook;
  onBack: () => void;
}

type ScienceTab = 'editor' | 'composition' | 'atmosphere' | 'interior' | 'climate' | 'atm-v2' | 'models';

type ViewDepth = 'system' | 'planet' | 'moon' | 'belt' | 'asteroid';

interface ViewState {
  depth: ViewDepth;
  planetIdx: number;
  moonIdx?: number;
  beltIdx?: number;
  asteroidIdx?: number;  // index into major_asteroids or ice_dwarfs
  asteroidSource?: 'major' | 'ice_dwarf';  // which list the asteroid comes from
}

/* ━━ Color & Label Maps ━━━━━━━━━━━━━━━━━━━━━━━━━ */

const STAR_COLOR: Record<string, string> = {
  O: '#9bb0ff', B: '#aabfff', A: '#cad7ff', F: '#f8f7ff',
  G: '#fff4ea', K: '#ffd2a1', M: '#ffb56c', L: '#ff8c42', T: '#ff6b35',
};

const PT_COLOR: Record<string, string> = {
  'hot-jupiter': '#ff4500', 'gas-giant': '#9370db', 'super-jupiter': '#7b68ee',
  'neptune-like': '#4682b4', 'warm-neptune': '#5f9ea0', 'mini-neptune': '#6495ed',
  'sub-neptune': '#5c7caa', 'super-earth': '#4caf50', 'earth-like': '#3da5d9',
  'rocky': '#b8860b', 'venus': '#daa520', 'eyeball-world': '#2196f3', 'ocean-world': '#00bcd4',
  'desert-world': '#d2691e', 'lava-world': '#ff6347', 'carbon-planet': '#696969',
  'iron-planet': '#a0522d', 'hycean': '#00ced1', 'ice-dwarf': '#b0c4de',
  'chthonian': '#8b4513', 'sub-earth': '#778899',
};

const MOON_COLOR: Record<string, string> = {
  'volcanic': '#ff6347', 'ice-shell': '#add8e6', 'atmosphere-moon': '#daa520',
  'ocean-moon': '#00bfff', 'cratered-airless': '#a89880', 'captured-irregular': '#7a6a5e',
  'shepherd': '#99aabb', 'binary-moon': '#8a8895',
};

/**
 * Smart moon profile selector: uses moon_type as base, then refines with
 * geology flags, tidal heating, mass, and orbital properties to pick from
 * all 20 moon profiles. Guarantees diverse appearance within a planet's moons.
 */
function pickMoonProfile(m: any, moonIdx: number): string {
  const flags: string[] = m.sub_type_flags ?? [];
  const has = (f: string) => flags.includes(f);
  const type = m.moon_type || 'cratered-airless';
  const tidal = m.tidal_heating ?? 0;
  const mass = m.mass_earth ?? 0;

  // --- Flag-driven overrides (most specific first) ---
  if (has('lava_lakes') && tidal > 0.6) return 'moon-magma-ocean';
  if (has('sulfur_eruptions')) return 'moon-volcanic';
  if (has('nitrogen_geysers') || has('nitrogen_atmosphere')) return 'moon-nitrogen-ice';
  if (has('hydrocarbon_lakes') || has('thick_haze')) return 'moon-atmosphere';
  if (has('possible_biosignatures') || has('subsurface_ocean') && has('cracked_ice')) return 'moon-ice-shell';
  if (has('chevron_terrain') || has('possible_geysers')) return 'moon-ocean';
  if (has('captured_kbo')) return 'moon-tholin';
  if (has('dark_material')) return 'moon-carbon-soot';

  // --- Refine by moon_type + properties ---
  if (type === 'volcanic') {
    return tidal > 0.7 ? 'moon-magma-ocean' : 'moon-volcanic';
  }
  if (type === 'ice-shell') {
    if (has('cracked_ice')) return 'moon-ice-shell';
    if (has('resurfaced')) return 'moon-ocean';
    if (mass > 0.02) return 'moon-ice-shell';
    return 'moon-co2-frost';
  }
  if (type === 'ocean-moon') {
    return has('tidal_flexing') ? 'moon-ammonia-slush' : 'moon-ocean';
  }
  if (type === 'atmosphere-moon') {
    return 'moon-atmosphere';
  }
  if (type === 'captured-irregular') {
    if (has('retrograde_orbit')) return 'moon-tholin';
    return mass < 0.0001 ? 'moon-carbon-soot' : 'moon-captured';
  }
  if (type === 'shepherd') {
    return 'moon-shepherd';
  }
  if (type === 'binary-moon') {
    return 'moon-binary';
  }

  // --- cratered-airless: diversify by mass/flags ---
  if (has('heavily_cratered') && has('undifferentiated')) return 'moon-regolith';
  if (has('magnetic_field') || mass > 0.02) return 'moon-thin-atm';
  if (has('death_star_crater') || has('extreme_geology')) return 'moon-basalt';
  if (has('cryogenic_surface')) return 'moon-silicate-frost';
  if (has('possible_subsurface_ocean')) return 'moon-ammonia-slush';

  // --- Fallback: use hash of name+index to distribute among rocky/mineral types ---
  const rocky: string[] = [
    'moon-cratered', 'moon-iron-rich', 'moon-olivine', 'moon-basalt',
    'moon-regolith', 'moon-silicate-frost', 'moon-sulfate',
  ];
  const h = hashStr((m.moon_name ?? '') + moonIdx);
  return rocky[Math.floor(h * rocky.length) % rocky.length];
}

/** Two-tone color for PotatoMoon vertex coloring based on moon type & profile. */
function pickPotatoColors(_m: any, profile: string): [string, string] {
  const POTATO_PALETTE: Record<string, [string, string]> = {
    'moon-volcanic':        ['#b89030', '#3a1808'],  // sulfur + dark lava
    'moon-magma-ocean':     ['#100400', '#ff5500'],  // dark crust + glowing magma
    'moon-ice-shell':       ['#c8c0b0', '#534020'],  // cream ice + brown lineae
    'moon-ocean':           ['#e8eaf0', '#607080'],  // white ice + blue crevasse
    'moon-nitrogen-ice':    ['#c09888', '#3a2420'],  // pink N₂ + dark cantaloupe
    'moon-co2-frost':       ['#b07838', '#d8d4cc'],  // ochre + CO₂ frost
    'moon-ammonia-slush':   ['#6e6040', '#305048'],  // dirty ice + teal slush
    'moon-cratered':        ['#706c68', '#2a2826'],  // highland grey + mare basalt
    'moon-iron-rich':       ['#985828', '#606060'],  // rust + bare metal
    'moon-olivine':         ['#508028', '#283010'],  // olive green + dunite
    'moon-basalt':          ['#181614', '#0a0908'],  // dark basalt + obsidian
    'moon-regolith':        ['#887860', '#4a3e30'],  // tan dust + dark grooves
    'moon-captured':        ['#181410', '#0e0c0a'],  // very dark C-type
    'moon-carbon-soot':     ['#100c0c', '#060404'],  // near-black soot
    'moon-tholin':          ['#a04010', '#502808'],  // rust-red tholin
    'moon-atmosphere':      ['#704818', '#382808'],  // orange-brown hydrocarbon
    'moon-thin-atm':        ['#985828', '#503018'],  // rusty terrain
    'moon-shepherd':        ['#a8a4a0', '#787470'],  // pale grey + medium grey
    'moon-binary':          ['#807c78', '#884028'],  // grey ice + tholin polar
    'moon-sulfate':         ['#f0e8a8', '#584c38'],  // bright salt + dark regolith
    'moon-silicate-frost':  ['#8490a8', '#302418'],  // blue-grey frost + dark ancient
  };
  return POTATO_PALETTE[profile] || ['#776655', '#443322'];
}

const MOON_TEMP: Record<string, number> = {
  'volcanic': 350, 'ice-shell': 100, 'atmosphere-moon': 94,
  'ocean-moon': 120, 'cratered-airless': 160, 'captured-irregular': 120,
  'shepherd': 100, 'binary-moon': 150,
};

const MOON_ICON: Record<string, string> = {
  'volcanic': '🌋', 'ice-shell': '🧊', 'atmosphere-moon': '🌫️',
  'ocean-moon': '🌊', 'cratered-airless': '🌑', 'captured-irregular': '☄️',
  'shepherd': '🛡️', 'binary-moon': '⚭',
};

const FLAG_ICON: Record<string, string> = {
  habitable_zone: '🌍', tidally_locked: '🔒', possible_biosignatures: '🧬',
  subsurface_ocean: '🌊', magma_ocean: '🌋', resonance_locked: '⚛',
  banded_atmosphere: '🪐', great_storm: '🌀', terminator_habitable: '☀️',
  global_ocean: '💧', thick_atmosphere: '☁️', greenhouse_runaway: '🔥',
  plate_tectonics: '🏔️', polar_ice_caps: '❄️', stripped_mantle: '⚙️',
  metallic_surface: '🪙', ancient_ocean: '🏜️', sulfur_eruptions: '💨',
  nitrogen_geysers: '💎', extreme_axial_tilt: '↗️',
};

const SPEC_COLOR: Record<string, string> = {
  S: '#4488ee', V: '#ee5533', C: '#44ccaa', M: '#cc8844',
  D: '#aa66cc', X: '#999', B: '#55bbcc', P: '#887766',
};

const BELT_TYPE_LABEL: Record<string, string> = {
  'rocky-asteroid': '🪨 Asteroid Belt',
  'icy-kuiper': '🧊 Kuiper Belt',
  'scattered-disc': '💫 Scattered Disc',
  'trojan-swarm': '⚔️ Trojan Swarm',
};

const MOON_DESC: Record<string, string> = {
  'volcanic': '🌋 Intense volcanic activity driven by tidal forces. Sulfurous eruptions reshape the surface constantly.',
  'ice-shell': '🧊 Subsurface ocean beneath a frozen crust. Cryovolcanic plumes may carry organics.',
  'atmosphere-moon': '🌫️ Dense atmosphere with complex chemistry — organic haze and possible methane lakes.',
  'ocean-moon': '🌊 Global subsurface ocean with hydrothermal vents — a prime astrobiology target.',
  'cratered-airless': '🌑 Airless, ancient surface scarred by billions of years of impacts.',
  'captured-irregular': '☄️ Captured minor body on an irregular, retrograde orbit.',
  'shepherd': '🛡️ Shepherd moon — gravitational sculpting maintains ring edges.',
  'binary-moon': '⚭ Binary companion orbiting in gravitational tandem.',
};

/* ━━ Utility ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h) / 2147483647;
}

function shortName(name: string | undefined, idx: number): string {
  if (!name) return String.fromCharCode(98 + idx);
  return name.split(' ').pop()?.replace('(inferred)', '').trim() || String.fromCharCode(98 + idx);
}

/* ---------- Shared radial-glow texture (soft circle, no hard square edges) ---------- */
let _glowTex: THREE.Texture | null = null;
function getGlowTexture(): THREE.Texture {
  if (_glowTex) return _glowTex;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1.0)');
  grad.addColorStop(0.15, 'rgba(255,255,255,0.6)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.15)');
  grad.addColorStop(0.7, 'rgba(255,255,255,0.03)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  _glowTex = new THREE.CanvasTexture(canvas);
  _glowTex.needsUpdate = true;
  return _glowTex;
}

/**
 * Keplerian-scaled visual period.
 * Outer bodies orbit noticeably slower than inner ones.
 * Uses sqrt scaling (T ∝ a^0.55) for visual clarity while preserving Kepler's feel.
 */
function vizPeriod(periodDays: number, minPeriodDays: number): number {
  const ratio = Math.max(periodDays, 1) / Math.max(minPeriodDays, 1);
  return 18 * Math.pow(ratio, 0.55);
}

const STAR_VIS_R = 0.22;
/** Luminosity-scaled star visual radius for the orrery */
const starVisRadius = (luminosity: number) =>
  Math.max(0.22, Math.min(0.85, 0.24 + Math.pow(luminosity, 0.30) * 0.20));

/**
 * Logarithmic orbit scaling for system depth.
 * Maps SMA (AU) → visual radius, guaranteeing innermost planet outside star.
 */
function logOrbitRadius(smaAU: number, starVisR: number, maxSma: number): number {
  const padding = starVisR * 1.8;
  const k = 8 / Math.max(maxSma, 0.5);
  const spread = 7;
  return padding + Math.log2(1 + smaAU * k) * spread;
}

function logBeltRadius(auVal: number, starVisR: number, maxSma: number): number {
  return logOrbitRadius(auVal, starVisR, maxSma);
}

/**
 * Collision-aware moon orbit layout for planet depth.
 * First pass: logarithmic mapping. Second pass: push apart any overlapping moons.
 * Returns array of scene-unit orbit radii guaranteed not to overlap.
 */
function layoutMoonOrbits(
  moons: any[],
  minR: number,
  maxAU: number,
): number[] {
  if (!moons.length) return [];
  const sorted = moons.map((m, i) => ({
    au: m.orbital_radius_au || (0.002 + i * 0.002),
    re: m.radius_earth || 0.005,
    idx: i,
  })).sort((a, b) => a.au - b.au);

  const maxMoonRad = Math.max(...sorted.map(s => s.re));
  const gap = 0.18; // generous visual gap so moons never intersect

  // Initial logarithmic positions
  const k = 6 / Math.max(maxAU, 0.0001);
  const spread = 2.0;
  const positions: number[] = [];
  for (const s of sorted) {
    const vizR = 0.02 + (s.re / maxMoonRad) * 0.14;
    const logPos = minR + Math.log2(1 + s.au * k) * spread;
    if (positions.length === 0) {
      positions.push(Math.max(logPos, minR + vizR + gap));
    } else {
      const prevVizR = 0.02 + (sorted[positions.length - 1].re / maxMoonRad) * 0.14;
      const minSep = prevVizR + vizR + gap;
      positions.push(Math.max(logPos, positions[positions.length - 1] + minSep));
    }
  }

  // Map back to original order
  const result: number[] = new Array(moons.length);
  for (let i = 0; i < sorted.length; i++) {
    result[sorted[i].idx] = positions[i];
  }
  return result;
}

/** Detect orbital resonance between two moons (returns label or null) */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function detectResonance(period1: number, period2: number): string | null {
  const ratio = Math.max(period1, period2) / Math.min(period1, period2);
  const resonances: [number, number, string][] = [
    [2, 1, '2:1'], [3, 2, '3:2'], [4, 3, '4:3'], [5, 3, '5:3'],
    [3, 1, '3:1'], [5, 2, '5:2'], [4, 1, '4:1'],
  ];
  for (const [n, d, label] of resonances) {
    if (Math.abs(ratio - n / d) < 0.06) return label;
  }
  return null;
}

/* ━━ Moon visual diversity helpers ━━━━━━━━━━━━━━━━━━ */

/** Unique seed per moon: blends name, orbit, mass, index */
function moonSeed(m: any, planetIdx: number, moonIdx: number): number {
  const nameH = hashStr(m.moon_name ?? '');
  const orbH  = hashStr(String(m.orbital_radius_au ?? 0));
  const massH = hashStr(String(m.mass_earth ?? 0));
  return (nameH * 0.4 + orbH * 0.35 + massH * 0.25 + moonIdx * 0.017 + planetIdx * 0.0031) % 1.0;
}

/** Geology-driven RGB color shift so each moon looks distinct */
function moonColorShift(m: any, mi: number): [number, number, number] {
  let dr = 0, dg = 0, db = 0;
  const flags: string[] = m.sub_type_flags ?? [];
  const has = (f: string) => flags.includes(f);

  // Tidal heating → warm reddish shift
  const tidal = m.tidal_heating ?? 0;
  dr += tidal * 0.12;

  // Mass → slight brightness boost
  const mass = Math.min(m.mass_earth ?? 0, 0.03);
  const mBright = mass / 0.03;
  dr += mBright * 0.03; dg += mBright * 0.03; db += mBright * 0.03;

  // Geology flag mappings (16 flags)
  if (has('sulfur_eruptions'))    { dr += 0.12; dg += 0.08; }
  if (has('nitrogen_geysers'))    { db += 0.10; }
  if (has('subsurface_ocean'))    { db += 0.08; dg += 0.03; }
  if (has('possible_biosignatures')) { dg += 0.10; }
  if (has('hydrocarbon_lakes'))   { dr += 0.08; db -= 0.05; }
  if (has('magnetic_field'))      { db += 0.06; }
  if (has('dark_material'))       { dr -= 0.06; dg -= 0.06; db -= 0.06; }
  if (has('heavily_cratered'))    { dr -= 0.03; dg -= 0.03; db -= 0.02; }
  if (has('cracked_ice'))         { db += 0.08; }
  if (has('resurfaced'))          { dg += 0.05; db += 0.05; }
  if (has('chevron_terrain'))     { dg += 0.06; }
  if (has('retrograde_orbit'))    { dr += 0.04; db += 0.04; }
  if (has('captured_kbo'))        { dr += 0.05; db += 0.03; }
  if (has('lava_lakes'))          { dr += 0.10; db -= 0.06; }
  if (has('thick_haze'))          { dr += 0.06; dg += 0.02; db -= 0.04; }

  // Per-moon hash randomness for extra variation
  const h = hashStr((m.moon_name ?? '') + mi);
  dr += (h - 0.5) * 0.06;
  dg += ((h * 2.71828) % 1 - 0.5) * 0.06;
  db += ((h * 3.14159) % 1 - 0.5) * 0.06;

  const clamp = (v: number) => Math.max(-0.3, Math.min(0.3, v));
  return [clamp(dr), clamp(dg), clamp(db)];
}

/** Derive planetshine color from parent planet type — reflected light tinting nearby moons */
function planetShineFromType(pType: string | undefined): [number, number, number] {
  if (!pType) return [0, 0, 0];
  const t = pType.toLowerCase();
  if (t.includes('neptune') || t.includes('ice-giant'))     return [0.25, 0.45, 0.75];
  if (t.includes('jupiter') || t.includes('gas-giant'))      return [0.60, 0.42, 0.22];
  if (t.includes('gas-saturn') || t.includes('saturn'))      return [0.55, 0.48, 0.28];
  if (t.includes('gas-hot') || t.includes('hot-jupiter'))    return [0.70, 0.35, 0.15];
  if (t.includes('super-earth') || t.includes('ocean'))      return [0.15, 0.30, 0.50];
  if (t.includes('rocky') || t.includes('terrestrial'))      return [0.30, 0.25, 0.20];
  if (t.includes('ice'))                                      return [0.40, 0.50, 0.60];
  return [0.20, 0.20, 0.20]; // neutral default
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   3D Sub-Components
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/** Tiny moon dot for system-depth planet previews */
function MiniMoonDot({ r, orbitR, color, period, startAngle }: {
  r: number; orbitR: number; color: string; period: number; startAngle: number;
}) {
  const ref = useRef<THREE.Mesh>(null!);
  useFrame(() => {
    const a = startAngle + (_orbit.time * Math.PI * 2) / period;
    if (ref.current) {
      ref.current.position.x = Math.cos(a) * orbitR;
      ref.current.position.z = Math.sin(a) * orbitR;
    }
  });
  return (
    <mesh ref={ref}>
      <sphereGeometry args={[r, 8, 8]} />
      <meshStandardMaterial color={color} roughness={0.85} />
    </mesh>
  );
}

/** Generic orbiting body — used for planets at system depth & moons at planet depth */
function OrreryBody({
  orbitR, r, color, active, vizPrd, startAngle, onClick, label,
  ringSystem, moonHints, planetType, planetSeed, temperature, mass, starSpectralClass,
}: {
  orbitR: number; r: number; color: string; active: boolean;
  vizPrd: number; startAngle: number; onClick: () => void;
  label: string; ringSystem?: any; moonHints?: { color: string }[];
  planetType?: string; planetSeed?: number; temperature?: number;
  mass?: number; starSpectralClass?: string;
}) {
  const grp = useRef<THREE.Group>(null!);
  const glow = useRef<THREE.Mesh>(null!);
  // Mutable array — mutated each frame without React re-renders.
  // ProceduralPlanet reads sunDirRef.current which aliases this same array object.
  const sunDirArray = useRef<[number, number, number]>([-1, 0.05, 0]);

  useFrame(({ clock }) => {
    const t = _orbit.time;
    const a = startAngle + (t * Math.PI * 2) / Math.max(vizPrd, 2);
    if (grp.current) {
      grp.current.position.x = Math.cos(a) * orbitR;
      grp.current.position.z = Math.sin(a) * orbitR;
      // Compute actual direction from planet toward star (at origin)
      const px = grp.current.position.x;
      const pz = grp.current.position.z;
      const len = Math.sqrt(px * px + pz * pz);
      if (len > 0.001) {
        sunDirArray.current[0] = -px / len;
        sunDirArray.current[1] = 0.05;
        sunDirArray.current[2] = -pz / len;
      }
    }
    if (glow.current && active) {
      (glow.current.material as THREE.MeshBasicMaterial).opacity =
        0.18 + 0.12 * Math.sin(clock.getElapsedTime() * 3);
    }
  });

  const ringScale = r * 1.2;

  return (
    <group ref={grp} onClick={e => { e.stopPropagation(); onClick(); }}>
      {planetType ? (
        <group scale={[r, r, r]}>
          <ProceduralPlanet
            planetType={planetType}
            temperature={temperature ?? 288}
            seed={planetSeed ?? 0}
            sunDirection={sunDirArray.current}
            rotationSpeed={0.06}
            mass={mass}
            starSpectralClass={starSpectralClass}
          />
        </group>
      ) : (
        <mesh>
          <sphereGeometry args={[r, 24, 24]} />
          <meshStandardMaterial
            color={color}
            emissive={active ? color : '#000'}
            emissiveIntensity={active ? 0.5 : 0}
            roughness={0.65} metalness={0.15}
          />
        </mesh>
      )}

      {active && (
        <mesh ref={glow}>
          <sphereGeometry args={[r * 2.5, 16, 16]} />
          <meshBasicMaterial color="#4d9fff" transparent opacity={0.18}
            depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
      )}

      {/* [21] Rings — custom shader with radial bands, gaps, forward-scatter */}
      {ringSystem?.rings?.map((ring: any, ri: number) => {
        const tiltAngle = Math.sin((planetSeed ?? 0) * 47.3) * 0.18;
        const baseCol = ring.composition === 'icy' ? '#aabbdd' :
              ring.composition === 'mixed' ? '#99aa88' : '#887755';
        return (
        <mesh key={ri} rotation={[-Math.PI / 2 + tiltAngle, 0, 0]}>
          <ringGeometry args={[
            ring.inner_radius_re * ringScale * 0.08,
            ring.outer_radius_re * ringScale * 0.08, 128
          ]} />
          <shaderMaterial
            transparent
            side={THREE.DoubleSide}
            depthWrite={false}
            uniforms={{
              uColor: { value: new THREE.Color(baseCol) },
              uOpticalDepth: { value: ring.optical_depth ?? 0.5 },
              uSeed: { value: (planetSeed ?? 0) * 13.7 + ri * 7.3 },
            }}
            vertexShader={`
              varying vec2 vUv;
              void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
              }
            `}
            fragmentShader={`
              uniform vec3 uColor;
              uniform float uOpticalDepth;
              uniform float uSeed;
              varying vec2 vUv;

              float hash(float n) { return fract(sin(n) * 43758.5453); }

              void main() {
                // Radial position 0→1 from inner to outer edge
                float r = vUv.x;

                // Radial band structure — multiple concentric ringlets
                float bands = 0.0;
                bands += sin(r * 80.0 + uSeed) * 0.15;
                bands += sin(r * 140.0 + uSeed * 2.3) * 0.08;
                bands += sin(r * 220.0 + uSeed * 4.1) * 0.05;

                // Cassini-like division gaps at specific radial positions
                float gap1 = 1.0 - smoothstep(0.0, 0.02, abs(r - 0.38 - hash(uSeed) * 0.08));
                float gap2 = 1.0 - smoothstep(0.0, 0.015, abs(r - 0.62 - hash(uSeed+1.0) * 0.06));
                float gap3 = 1.0 - smoothstep(0.0, 0.008, abs(r - 0.85 - hash(uSeed+2.0) * 0.04));
                float gapMask = (1.0 - gap1 * 0.9) * (1.0 - gap2 * 0.7) * (1.0 - gap3 * 0.5);

                // Optical depth varies radially — denser in middle, thinner at edges
                float radialDensity = smoothstep(0.0, 0.12, r) * smoothstep(1.0, 0.88, r);
                radialDensity *= 0.7 + 0.3 * (1.0 + bands);

                // Color variation — slight hue shift across radius
                vec3 col = uColor;
                col = mix(col, uColor * 1.15, bands * 0.5 + 0.5);
                col = mix(col, uColor * 0.6, smoothstep(0.85, 1.0, r) * 0.3);

                float alpha = radialDensity * gapMask * uOpticalDepth * 0.45;
                alpha = clamp(alpha, 0.0, 0.28);

                // Softer inner/outer edges
                alpha *= smoothstep(0.0, 0.08, r) * smoothstep(1.0, 0.92, r);

                // Reduce color multiplier for less bloom
                gl_FragColor = vec4(col * 0.85, alpha);
              }
            `}
          />
        </mesh>
        );
      })}

      {/* Mini moon hints at system depth */}
      {moonHints?.slice(0, 6).map((m, mi) => (
        <MiniMoonDot key={mi}
          r={Math.max(r * 0.16, 0.02)}
          orbitR={r * (2.0 + mi * 0.65)}
          color={m.color}
          period={2.2 + mi * 1.0}
          startAngle={mi * 2.1} />
      ))}

      <Billboard>
        <Text position={[0, r + 0.18, 0]} fontSize={0.12}
          color={active ? '#c0d8ff' : '#7899bb'}
          fillOpacity={active ? 1 : 0.65}
          anchorX="center" anchorY="bottom">
          {label}
        </Text>
      </Billboard>
    </group>
  );
}

/**
 * Irregular "potato" geometry for tiny moons with multiple deformation styles.
 *
 * Styles:
 *   generic  — Phobos/Deimos: lumpy, elongated, boring
 *   miranda  — Extreme coronae (concentric ridged ovoids), chevron grooves, 20km cliffs
 *   hyperion — Spongy deeply-pitted (sublimation erosion), lowest density
 *   eros     — Highly elongated peanut/saddle shape (contact binary feel)
 *
 * Vertex colors give multi-toned surface (highland/lowland) instead of flat single color.
 */
function PotatoMoon({ seed, color, color2, roughness = 0.92, detail = 4, deformStyle = 'generic' }: {
  seed: number; color: string; color2?: string; roughness?: number; detail?: number;
  deformStyle?: 'generic' | 'miranda' | 'hyperion' | 'eros';
}) {
  const geo = useMemo(() => {
    const g = new THREE.IcosahedronGeometry(1, detail);
    const pos = g.attributes.position;
    const s = seed * 137;
    const S = Math.sin, C = Math.cos;

    // Parse colors for vertex coloring
    const c1 = new THREE.Color(color);
    const c2t = new THREE.Color(color2 || color);
    const colors = new Float32Array(pos.count * 3);

    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const r = Math.sqrt(x * x + y * y + z * z) || 1;
      const nx = x / r, ny = y / r, nz = z / r;
      let scale = 1.0;
      let colorT = 0.5; // 0 = color1, 1 = color2

      if (deformStyle === 'miranda') {
        // ── Miranda: extreme asymmetric terrain ──
        // Large-scale coronae: 2-3 huge concentric ridged ovoid features
        const corona1 = S(nx * 1.6 + s * 0.3) * C(nz * 2.1 + s * 0.5);
        const corona2 = S(ny * 1.8 + s * 0.7) * C(nx * 1.4 + s * 1.1);
        const coronaRidge = Math.abs(S(corona1 * 3.14)) * 0.18 + Math.abs(S(corona2 * 2.8)) * 0.14;
        // Chevron terrain: sharp V-shaped grooves
        const chevron = Math.abs(S((nx + nz) * 4.2 + s)) * C(ny * 3.5 + s * 0.8) * 0.12;
        // Massive cliff scarps (up to 20km on 235km body = ~8.5% radius)
        const cliff = Math.max(0, S(nx * 2.5 + ny * 1.3 + s * 0.4)) *
                       (1.0 - Math.abs(S(nz * 6 + s * 2))) * 0.20;
        // Extreme overall asymmetry — one hemisphere much higher than the other
        const hemisphereWarp = S(nx * 0.8 + s * 0.2) * 0.15;
        // High frequency rough cratered surface
        const rough = S(x * 14 + y * 11 + z * 9 + s * 3) * 0.03;
        scale = 0.55 + coronaRidge + chevron + cliff + hemisphereWarp + rough;
        // Color: bright fresh ice on corona ridges, dark ancient terrain in lows
        colorT = Math.min(1, Math.max(0, coronaRidge * 3.0 + cliff * 2.0));

      } else if (deformStyle === 'hyperion') {
        // ── Hyperion: spongy deeply pitted ──
        // Many deep roughly-spherical pits (sublimation erosion)
        let pits = 0;
        for (let p = 0; p < 5; p++) {
          const px = S(s + p * 47) * 0.8, py = C(s + p * 71) * 0.8, pz = S(s + p * 31) * 0.8;
          const d = Math.sqrt((nx - px) ** 2 + (ny - py) ** 2 + (nz - pz) ** 2);
          const pitR = 0.25 + S(s + p * 17) * 0.12;
          if (d < pitR) pits += (pitR - d) / pitR * 0.35;
        }
        // Overall irregular shape
        const n1 = S(x * 2.3 + s) * C(y * 2.8 + s * 0.6) * 0.18;
        // Surface texture
        const n2 = S(x * 8 + y * 6 + z * 7 + s * 2) * 0.04;
        scale = 0.70 + n1 + n2 - pits;
        colorT = pits * 2.0; // darker inside pits

      } else if (deformStyle === 'eros') {
        // ── Eros: highly elongated peanut/saddle ──
        // Strong elongation along seed-rotated axis
        const ax = S(s * 0.3), az = C(s * 0.3);
        const along = nx * ax + nz * az; // projection onto elongation axis
        // Saddle: pinched in the middle
        const saddle = 1.0 - 0.30 * (1.0 - along * along);
        // Elongation
        const elong = 1.0 + 0.40 * along * along;
        const n1 = S(x * 4.2 + s) * C(y * 3.8 + s * 0.7) * 0.10;
        const rough = S(x * 11 + y * 9 + z * 10 + s * 3) * 0.03;
        scale = 0.55 * saddle * elong + n1 + rough;
        colorT = Math.max(0, Math.min(1, 0.5 + n1 * 3.0));

      } else {
        // ── Generic: Phobos/Deimos lumpy potato ──
        const n1 = S(x * 2.1 + s) * C(y * 3.2 + s * 0.7) * S(z * 1.8 + s * 1.3);
        const n2 = S(x * 5.3 + s * 2) * C(y * 4.1 + s * 1.5) * 0.2;
        const n3 = S(x * 12 + y * 8 + z * 10 + s * 3) * 0.04;
        scale = 0.65 + n1 * 0.25 + n2 + n3;
        colorT = Math.max(0, Math.min(1, 0.5 + n1 + n2 * 0.5));
      }

      scale = Math.max(0.25, scale); // prevent collapse
      pos.setXYZ(i, nx * scale, ny * scale, nz * scale);

      // Vertex color: blend between two surface tones
      const ct = Math.max(0, Math.min(1, colorT));
      colors[i * 3 + 0] = c1.r * (1 - ct) + c2t.r * ct;
      colors[i * 3 + 1] = c1.g * (1 - ct) + c2t.g * ct;
      colors[i * 3 + 2] = c1.b * (1 - ct) + c2t.b * ct;
    }

    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    pos.needsUpdate = true;
    g.computeVertexNormals();
    return g;
  }, [seed, detail, deformStyle, color, color2]);

  return (
    <mesh geometry={geo}>
      <meshStandardMaterial
        vertexColors roughness={roughness} metalness={0.05}
      />
    </mesh>
  );
}

/** Orbiting moon with ProceduralPlanet shader — used at planet depth */
function OrbitingMoon({
  orbitR, r, vizPrd, startAngle, active, onClick, label,
  planetType, temperature, seed, colorShift,
  mass, tidalHeating, isPotato, potatoColor, potatoColor2, potatoDeform,
  starSpectralClass,
  hasAtmosphere, atmColor, planetShineColor,
}: {
  orbitR: number; r: number; vizPrd: number; startAngle: number;
  active: boolean; onClick: () => void; label: string;
  planetType: string; temperature: number; seed: number;
  colorShift: [number, number, number];
  mass?: number; tidalHeating?: number;
  isPotato?: boolean; potatoColor?: string; potatoColor2?: string;
  potatoDeform?: 'generic' | 'miranda' | 'hyperion' | 'eros';
  starSpectralClass?: string;
  hasAtmosphere?: boolean; atmColor?: string;
  planetShineColor?: [number, number, number];
}) {
  const grp = useRef<THREE.Group>(null!);
  const glow = useRef<THREE.Mesh>(null!);

  useFrame(({ clock }) => {
    const t = _orbit.time;
    const a = startAngle + (t * Math.PI * 2) / Math.max(vizPrd, 2);
    if (grp.current) {
      grp.current.position.x = Math.cos(a) * orbitR;
      grp.current.position.z = Math.sin(a) * orbitR;
    }
    if (glow.current && active) {
      (glow.current.material as THREE.MeshBasicMaterial).opacity =
        0.18 + 0.12 * Math.sin(clock.getElapsedTime() * 3);
    }
  });

  return (
    <group ref={grp} onClick={e => { e.stopPropagation(); onClick(); }}>
      <group scale={[r, r, r]}>
        {isPotato ? (
          <PotatoMoon seed={seed} color={potatoColor || '#887766'}
            color2={potatoColor2} deformStyle={potatoDeform || 'generic'} />
        ) : (
          <ProceduralPlanet
            planetType={planetType}
            temperature={temperature}
            seed={seed}
            sunDirection={[-1, 0.5, 0.5]}
            rotationSpeed={0.02}
            colorShift={colorShift}
            mass={mass}
            tidalHeating={tidalHeating}
            starSpectralClass={starSpectralClass}
            planetShineColor={planetShineColor}
          />
        )}
        {/* Atmosphere haze for moons like Titan */}
        {hasAtmosphere && (
          <mesh>
            <sphereGeometry args={[1.06, 32, 24]} />
            <meshBasicMaterial
              color={atmColor || '#cc8844'}
              transparent opacity={0.15}
              side={THREE.FrontSide} depthWrite={false}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
        )}
      </group>
      {active && (
        <mesh ref={glow}>
          <sphereGeometry args={[r * 2.5, 16, 16]} />
          <meshBasicMaterial color="#4d9fff" transparent opacity={0.18}
            depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
      )}
      <Billboard>
        <Text position={[0, r + 0.12, 0]} fontSize={0.08}
          color={active ? '#c0d8ff' : '#7899bb'}
          fillOpacity={active ? 1 : 0.55}
          anchorX="center" anchorY="bottom">
          {label}
        </Text>
      </Billboard>
    </group>
  );
}

/* ---- Star surface shader with solar granulation, limb darkening, sunspots ---- */
const STAR_VERT = `
varying vec3 vNormal;
varying vec3 vPosition;
varying vec2 vUv;
void main() {
  // World-space normal so NdotV is consistent with world-space cameraPosition
  vNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
  vPosition = (modelMatrix * vec4(position, 1.0)).xyz;
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const STAR_FRAG = `
uniform float uTime;
uniform vec3  uColor;
uniform vec3  uHotColor;
uniform float uGranScale;
uniform float uHot;       // 0=cool M-star, 1=hot A/O-star
varying vec3 vNormal;
varying vec3 vPosition;
varying vec2 vUv;

// ---- Hash functions ----
float hash31(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
vec3 hash33(vec3 p) {
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)),
           dot(p, vec3(269.5, 183.3, 246.1)),
           dot(p, vec3(113.5, 271.9, 124.6)));
  return fract(sin(p) * 43758.5453);
}

// ---- Animated 3D Voronoi convection ----
// Returns vec3(dist_to_center, edge_proximity, cell_id)
vec3 voronoiCell(vec3 p, float speed) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  float d1 = 100.0, d2 = 100.0;
  float id = 0.0;
  for (int x = -1; x <= 1; x++)
  for (int y = -1; y <= 1; y++)
  for (int z = -1; z <= 1; z++) {
    vec3 nb = vec3(float(x), float(y), float(z));
    vec3 cell = i + nb;
    vec3 pt = hash33(cell);
    // Each point orbits its home — creates boiling/convection motion
    pt = 0.5 + 0.4 * sin(uTime * speed + 6.2831 * pt);
    vec3 diff = nb + pt - f;
    float d = dot(diff, diff);
    if (d < d1) { d2 = d1; d1 = d; id = hash31(cell); }
    else if (d < d2) { d2 = d; }
  }
  d1 = sqrt(d1);
  d2 = sqrt(d2);
  return vec3(d1, d2 - d1, id);
}

// ---- Value noise for plasma turbulence ----
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(
    mix(mix(hash31(i), hash31(i + vec3(1,0,0)), f.x),
        mix(hash31(i + vec3(0,1,0)), hash31(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash31(i + vec3(0,0,1)), hash31(i + vec3(1,0,1)), f.x),
        mix(hash31(i + vec3(0,1,1)), hash31(i + vec3(1,1,1)), f.x), f.y), f.z);
}

void main() {
  vec3  N   = normalize(vNormal);
  vec3  V   = normalize(cameraPosition - vPosition);
  float mu  = max(dot(N, V), 0.0);
  vec3  sp  = normalize(vPosition);

  // Differential rotation
  float lat     = asin(clamp(sp.y, -1.0, 1.0));
  float rotRate = uTime * 0.025 * (1.0 - 0.45 * lat * lat);
  float cs = cos(rotRate), sn = sin(rotRate);
  sp = vec3(sp.x*cs - sp.z*sn, sp.y, sp.x*sn + sp.z*cs);

  // ── FBM domain-warp for organic, non-geometric cell shapes ───────────────
  // Cool stars: strong irregular warping; hot stars: subtle
  float wStr = mix(0.22, 0.05, uHot);
  vec3  warp = vec3(
    vnoise(sp * 5.5 + uTime * 0.045) - 0.5,
    vnoise(sp * 5.5 + vec3(1.8, 0.5, 0.0) + uTime * 0.038) - 0.5,
    vnoise(sp * 5.5 + vec3(0.0, 2.7, 0.8) + uTime * 0.041) - 0.5
  ) * wStr;
  vec3 spw = normalize(sp + warp);

  // ── Convection cells ──────────────────────────────────────────────────────
  // Animation speed: cool stars boil fast; hot stars barely evolve
  float cspd = mix(0.28, 0.05, uHot);

  // Main granulation on domain-warped surface
  // KEY: use v2.x (distance to center) not v2.y (edge proximity)
  // → smooth glow at cell center, not hard black-crack lanes
  vec3  v2       = voronoiCell(spw * uGranScale, cspd);
  float cellGlow = 1.0 - smoothstep(0.0, 0.40, v2.x);  // 1=center bright, 0=far
  float cellVar  = 0.82 + 0.18 * v2.z;

  // Supergranulation — large-scale brightness modulation
  vec3  v1       = voronoiCell(spw * 3.0, cspd * 0.30);
  float superG   = 1.0 - smoothstep(0.0, 0.46, v1.x);
  float superVar = 0.88 + 0.12 * v1.z;

  // Mesogranulation — fine fast shimmering
  vec3  v3   = voronoiCell(spw * uGranScale * 2.5, cspd * 1.7);
  float mesoG = 1.0 - smoothstep(0.0, 0.35, v3.x);

  // Weighted multi-scale brightness (all smooth, no hard edges)
  float convB = (cellGlow*0.58 + superG*0.24 + mesoG*0.18) * cellVar * superVar;

  // Plasma turbulence overlay
  float turb  = vnoise(sp * 28.0 + uTime * 0.11) * 0.07
              + vnoise(sp * 15.0 + uTime * 0.07) * 0.05;
  convB = clamp(convB + turb, 0.0, 1.0);

  // ── Temperature-scaled brightness floor ──────────────────────────────────
  // Hot stars: high floor (cells barely visible, subtle shimmer)
  // Cool stars: low floor (deeper contrast, visible granulation)
  float floorB = mix(0.38, 0.76, uHot);
  convB        = floorB + convB * (1.0 - floorB);

  // ── Cool-star extras (faculae, spicules, seismic rings) ───────────────────
  float coolF   = 1.0 - uHot;
  float faculae = max(0.0, vnoise(sp * 20.0 + uTime * 0.04) - 0.63) * 4.5
                * smoothstep(0.28, 0.0, mu) * 0.16 * coolF;
  float spicule = max(0.0, vnoise(sp * 45.0 + uTime * 0.22) - 0.70) * 4.2
                * (1.0 - smoothstep(0.0, 0.38, v2.x)) * 0.20 * coolF;
  float sTheta  = acos(clamp(mu, 0.0, 1.0));
  float sPhase  = uTime * 0.34;
  float seismic = (exp(-pow(fract(sTheta*4.5 - sPhase    )*2.0-1.0,2.0)*20.0)*0.07
                +  exp(-pow(fract(sTheta*6.0 - sPhase*1.3)*2.0-1.0,2.0)*16.0)*0.04)
                * coolF * 0.85;

  convB = clamp(convB + spicule + faculae, 0.0, 1.0);

  // ── Limb darkening ────────────────────────────────────────────────────────
  float limb = max(1.0 - 0.38*(1.0-mu) - 0.14*(1.0-mu*mu), 0.28);
  float ef   = pow(1.0-mu, 1.6) * (1.0 - uHot*0.60);
  vec3  limbColor = vec3(1.0+ef*0.12, 1.0-ef*0.06, 1.0-ef*0.24);

  // ── Sunspots ──────────────────────────────────────────────────────────────
  vec3  vSp   = voronoiCell(sp*5.2 + vec3(uTime*0.002,0.0,0.0), 0.02);
  float spotD = 1.0 - step(0.87,vSp.z)*smoothstep(0.25,0.0,vSp.x)*0.55*coolF;
  spotD = mix(1.0, spotD, smoothstep(0.58,0.24,abs(sp.y))*smoothstep(0.0,0.18,mu));

  // ── Physical emissive surface colors ──────────────────────────────────────
  // Actual photospheric emission by temperature — NOT spectral class color.
  // Floor = coolest intergranule gas (deep red/orange but still GLOWING)
  // Peak  = hottest rising cell center (yellow-white, saturated)
  //   M ~3000K: deep crimson    K ~4500K: saturated orange
  //   G ~5800K: orange-yellow   F ~7000K: pale yellow    A ~10000K: blue-white
  vec3 mFloor = vec3(0.92, 0.16, 0.02);  vec3 mPeak = vec3(1.00, 0.44, 0.08);
  vec3 kFloor = vec3(0.98, 0.42, 0.06);  vec3 kPeak = vec3(1.00, 0.68, 0.22);
  vec3 gFloor = vec3(1.00, 0.62, 0.18);  vec3 gPeak = vec3(1.00, 0.86, 0.48);
  vec3 fFloor = vec3(1.00, 0.86, 0.55);  vec3 fPeak = vec3(1.00, 0.97, 0.82);
  vec3 aFloor = vec3(0.84, 0.90, 1.00);  vec3 aPeak = vec3(0.95, 0.98, 1.00);

  float t1 = smoothstep(0.00, 0.22, uHot);
  float t2 = smoothstep(0.22, 0.44, uHot);
  float t3 = smoothstep(0.44, 0.68, uHot);
  float t4 = smoothstep(0.68, 1.00, uHot);
  vec3 floorCol = mix(mix(mix(mix(mFloor, kFloor, t1), gFloor, t2), fFloor, t3), aFloor, t4);
  vec3 peakCol  = mix(mix(mix(mix(mPeak,  kPeak,  t1), gPeak,  t2), fPeak,  t3), aPeak,  t4);

  vec3 surfCol  = mix(floorCol, peakCol, convB);
  surfCol      += peakCol * seismic * 0.35;
  surfCol      += peakCol * (spicule*0.50 + faculae*0.55);
  surfCol      *= spotD * limb * limbColor;

  // Chromospheric rim glow — bright emission ring at disk edge, fades toward center
  // Simulates the chromosphere / lower corona visible at the solar limb
  float mu3     = pow(max(0.0, 1.0 - mu), 3.5);
  float chromoI = mu3 * mix(0.60, 0.22, uHot);
  vec3  chromoC = mix(peakCol * 1.30, vec3(0.90, 0.95, 1.00), uHot * 0.55);
  surfCol      += chromoC * chromoI;

  surfCol      *= 1.0 + 0.010*sin(uTime*1.8) + 0.005*sin(uTime*3.2);

  // Gamma lift: raises midtones strongly so star looks blazing not painted
  surfCol = pow(max(surfCol, vec3(0.0)), vec3(0.60));

  gl_FragColor = vec4(clamp(surfCol, 0.0, 1.0), 1.0);
}`;

/* ---- Corona billboard shader — 2D filaments, prominences, streamer rays ---- */
const CORONA_BILLBOARD_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const CORONA_FRAG = `
uniform float uTime;
uniform vec3  uColor;
varying vec2  vUv;

float h1(float n) { return fract(sin(n) * 43758.5453); }
float h2(vec2  p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }

// Smooth 1-D value noise on angle
float vnoise1(float x) {
  float i = floor(x); float f = fract(x);
  float u = f*f*(3.0-2.0*f);
  return mix(h1(i), h1(i+1.0), u);
}

// FBM over angle — drives filament boundary and flare shapes
float fbmA(float a, float t, float spd) {
  float v=0.0; float amp=0.5; float x=a;
  for(int k=0;k<5;k++){
    v += amp * vnoise1(x + t*spd);
    amp *= 0.55; x *= 2.1; spd *= 1.2;
  }
  return v;
}

// billboard: plane = star * 8, so star radius in UV-half space = 1/8 * 0.5 = 0.0625...
// plane size = size*8 → half = size*4 → starR = size/(size*4) * 0.5 = 0.125
const float starR = 0.125;

void main() {
  vec2  c     = vUv - 0.5;
  float r     = length(c);
  float angle = atan(c.y, c.x);

  // Hard mask — inside the star core: invisible (star sphere covers it)
  if (r < starR * 0.90) discard;

  float t = uTime;

  // ── Filament / Prominence boundary ──────────────────────────────────────────
  // FBM noise on angle creates irregular, tongue-like protrusions at star edge
  float filNoise  = fbmA(angle * 2.5, t, 0.25);
  float filRadius = starR * (1.08 + filNoise * 0.40);  // lumpy star edge
  // How deep inside a filament tongue: 1 at the base, 0 at the tip
  float filDepth  = clamp((filRadius - r) / (filRadius - starR * 1.0), 0.0, 1.0);
  filDepth        = smoothstep(0.0, 1.0, filDepth);
  float filGlow   = filDepth * exp(-max(r - starR, 0.0) / (starR * 0.45));

  // ── Shooting flares — higher-freq angular modulation, faster drift ───────────
  float flareN    = fbmA(angle * 5.5 + 1.3, t, 0.55);
  float flare     = pow(max(flareN - 0.38, 0.0) * 1.7, 2.2);
  flare          *= exp(-max(r - starR, 0.0) / (starR * 0.7));
  flare          *= smoothstep(starR * 0.92, starR * 1.25, r);

  // ── Outer streamer rays ───────────────────────────────────────────────────────
  float rays = 0.0; float wSum = 0.0;
  for(float i=1.0; i<=8.0; i+=1.0){
    float freq  = i * 1.7 + h1(i*4.1) * 2.5;
    float spd   = 0.007 + i * 0.004;
    float amp   = 1.0 / i;
    rays += sin(angle*freq + t*spd + h1(i)*6.2832) * amp;
    wSum += amp;
  }
  rays = (rays/wSum) * 0.5 + 0.5;         // 0..1
  float streamBright = rays * rays;         // punchy bright / dark gap

  // Radial distance beyond star (0 at surface, 1 at billboard edge)
  float d = max(r - starR, 0.0) / (0.5 - starR);

  // Base corona radial falloff
  float base = (exp(-d*d*5.5)*1.0 + exp(-d*4.0)*0.45) * (0.28 + 0.72*streamBright);

  // ── Chromosphere ring ────────────────────────────────────────────────────────
  float chromD  = (r - starR) / starR;
  float chrom   = exp(-chromD*chromD*85.0) * 2.8;

  // ── Mask ─────────────────────────────────────────────────────────────────────
  float mask = smoothstep(starR * 0.88, starR * 1.08, r);

  float pulse  = 0.85 + 0.15 * sin(t*0.38 + angle*1.4);
  float flicker= 1.0  + 0.04 * sin(t*3.2  + angle*2.1);

  // ── Colors ───────────────────────────────────────────────────────────────────
  float hotFrac = dot(uColor, vec3(0.15,0.30,0.55));

  // Filament/prominence: deep orange → bright yellow (like Hα prominences)
  vec3 filCol   = mix(vec3(1.0,0.40,0.06), vec3(1.0,0.78,0.22), filNoise);
  vec3 flareCol = mix(vec3(1.0,0.55,0.10), vec3(1.0,0.88,0.35), flareN);

  // Outer corona: warm white core → star-tinted tips
  vec3 innerCol  = mix(vec3(1.0,0.94,0.82), vec3(0.92,0.96,1.0), hotFrac);
  vec3 outerCol  = mix(uColor * 1.15, vec3(0.55,0.68,1.0), hotFrac * 0.5);
  vec3 coronaCol = mix(innerCol, outerCol, smoothstep(0.0, 0.50, d));

  // Chromosphere: pinkish-orange for cool, blue-white for hot
  vec3 chromCol  = mix(vec3(1.0,0.62,0.28), vec3(0.9,0.95,1.0), hotFrac);

  // ── Compose ──────────────────────────────────────────────────────────────────
  float baseA  = base  * mask * pulse;
  float filA   = (filGlow * 0.85 + flare * 1.10) * mask;
  float chromA = chrom * mask;

  vec3 finalCol = coronaCol * baseA * flicker
                + filCol    * filGlow * mask
                + flareCol  * flare   * mask
                + chromCol  * chromA;
  float finalA  = baseA*0.65 + filA*0.80 + chromA*0.60;

  if (finalA < 0.004) discard;
  gl_FragColor  = vec4(finalCol, finalA);
}`;

// ── Procedural solar granulation texture ─────────────────────────────────────
// Generates a DataTexture approximating photospheric convection cells via FBM.
// Two instances with different seeds are used as rotating layers.
/* ---- Seamless procedural granulation layers (use vObjNormal, no UV seam) ---- */
const LAYER_VERT = `
varying vec3 vObjNormal;
varying float vMu;  // NdotV in view space — used to fade silhouette polygon edges
void main() {
  vObjNormal = normal;
  // normalMatrix * normal gives view-space normal; dot with (0,0,1) = view dir
  vMu = max(0.0, normalize(normalMatrix * normal).z);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const LAYER_FRAG = `
uniform float uSeed;  // per-layer offset so the two layers have different patterns
uniform float uHot;   // 0=cool M, 1=hot A
varying vec3 vObjNormal;
varying float vMu;

float h31(vec3 p) {
  p = fract(p * vec3(127.1, 311.7, 74.7) + uSeed);
  p += dot(p, p.yzx + 19.19);
  return fract((p.x + p.y) * p.z);
}
float vn(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(h31(i),             h31(i+vec3(1,0,0)), f.x),
        mix(h31(i+vec3(0,1,0)), h31(i+vec3(1,1,0)), f.x), f.y),
    mix(mix(h31(i+vec3(0,0,1)), h31(i+vec3(1,0,1)), f.x),
        mix(h31(i+vec3(0,1,1)), h31(i+vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) {
  float v = 0.0, a = 0.50;
  for (int i = 0; i < 5; i++) { v += a * vn(p); a *= 0.50; p *= 2.07; }
  return v;
}

void main() {
  // Silhouette fade: smoothly kill contribution near polygon edges
  float edge = smoothstep(0.0, 0.22, vMu);
  if (edge < 0.01) discard;

  vec3 n = normalize(vObjNormal);
  float raw = fbm(n * 5.0);
  float t   = clamp((raw - 0.30) / 0.42, 0.0, 1.0);
  float w   = t * t * 0.34 * edge;
  if (w < 0.01) discard;

  // Temperature-scaled additive tint — cool=orange, hot=pale yellow
  vec3 warm = mix(vec3(0.95, 0.42, 0.06), vec3(1.00, 0.90, 0.60), uHot);
  gl_FragColor = vec4(warm * w, w);
}`;

/* ---- Inner rim glow billboard — bright at disk edge, transparent toward center ---- */
const RIM_GLOW_FRAG = `
uniform vec3  uColor;
uniform float uHot;
varying vec2 vUv;

void main() {
  vec2  c     = vUv - 0.5;
  float r     = length(c) * 2.0;   // 0=center, 1=plane edge

  // Billboard is size*2.6 wide; star disk edge sits at r = size/(size*2.6)*2 = 0.769
  float starR = 0.769;

  // Inward gradient: 0 at center, peaks at disk edge, decays into corona
  float nr   = clamp(r / starR, 0.0, 1.0);
  float rise = pow(nr, 1.4);                                    // rises 0→1 toward edge
  float fall = exp(-pow(max(0.0, r - starR * 0.96) / 0.10, 2.0)); // Gaussian falloff outside
  float glow = rise * fall;

  if (glow < 0.008) discard;

  // Color: star-tinted warm glow, slightly brighter and more saturated at the very rim
  vec3 rimCol = mix(uColor * vec3(1.4, 1.1, 0.85), vec3(1.0, 0.94, 0.78), 0.30 + uHot * 0.40);
  float alpha = glow * 0.72;
  gl_FragColor = vec4(rimCol * alpha, alpha);
}`;

function OrreryStar({ color, size, teff, occludable = false }: { color: string; size: number; teff?: number; occludable?: boolean }) {
  const matRef = useRef<THREE.ShaderMaterial>(null!);
  const coronaRef = useRef<THREE.ShaderMaterial>(null!);
  const glowRef = useRef<THREE.Group>(null!);
  const layer1Ref = useRef<THREE.Mesh>(null!);
  const layer2Ref = useRef<THREE.Mesh>(null!);

  const starCol = useMemo(() => new THREE.Color(color), [color]);
  const hotCol = useMemo(() => {
    const c = new THREE.Color(color);
    const t = teff ?? 5778;
    const whiteTarget = t > 7500 ? '#e8eeff' : t > 5500 ? '#fffbe8' : t > 4000 ? '#ffe8c0' : '#ffd0a0';
    const whiteFrac = t > 7500 ? 0.7 : t > 5500 ? 0.6 : t > 4000 ? 0.4 : 0.25;
    c.lerp(new THREE.Color(whiteTarget), whiteFrac);
    return c;
  }, [color, teff]);

  const granScale = useMemo(() => {
    const t = teff ?? 5778;
    if (t > 8000) return 16.0;  // hot: small, faint cells
    if (t > 6000) return 12.0;  // F/G: moderate cells
    if (t > 4500) return 9.0;   // K: large, visible cells
    return 7.0;                  // M: huge convection cells
  }, [teff]);

  const hotFrac = useMemo(() => {
    const t = teff ?? 5778;
    return Math.min(1.0, Math.max(0.0, (t - 3000) / 9000));
  }, [teff]);

  const layer1Uniforms = useMemo(() => ({
    uSeed: { value: 0.317 + hotFrac * 0.1 },
    uHot:  { value: hotFrac },
  }), [hotFrac]);
  const layer2Uniforms = useMemo(() => ({
    uSeed: { value: 0.831 + hotFrac * 0.1 },
    uHot:  { value: hotFrac },
  }), [hotFrac]);

  const starUniforms = useMemo(() => ({
    uTime:      { value: 0 },
    uColor:     { value: starCol },
    uHotColor:  { value: hotCol },
    uGranScale: { value: granScale },
    uHot:       { value: hotFrac },
  }), [starCol, hotCol, granScale, hotFrac]);

  const coronaUniforms = useMemo(() => ({
    uTime:  { value: 0 },
    uColor: { value: starCol },
  }), [starCol]);

  const rimGlowUniforms = useMemo(() => ({
    uColor: { value: starCol },
    uHot:   { value: hotFrac },
  }), [starCol, hotFrac]);

  useFrame(({ clock, camera }) => {
    const t = clock.getElapsedTime();
    if (matRef.current) matRef.current.uniforms.uTime.value = t;
    if (coronaRef.current) coronaRef.current.uniforms.uTime.value = t;
    // Single glow billboard faces camera
    if (glowRef.current) glowRef.current.quaternion.copy(camera.quaternion);
    // Texture layers rotate independently for animated granulation
    if (layer1Ref.current) {
      layer1Ref.current.rotation.y = t * 0.04;
      layer1Ref.current.rotation.z = t * 0.008;
    }
    if (layer2Ref.current) {
      layer2Ref.current.rotation.y = -t * 0.025;
      layer2Ref.current.rotation.x = t * 0.006;
    }
  });

  return (
    <group>
      {/* Core sphere — Voronoi convection cells + limb darkening + HDR */}
      <mesh>
        <sphereGeometry args={[size, 64, 64]} />
        <shaderMaterial ref={matRef}
          vertexShader={STAR_VERT}
          fragmentShader={STAR_FRAG}
          uniforms={starUniforms} />
      </mesh>

      {/* Animated granulation layers — seamless 3D-noise shaders, no UV seam */}
      <mesh ref={layer1Ref}>
        <sphereGeometry args={[size * 1.002, 64, 64]} />
        <shaderMaterial
          vertexShader={LAYER_VERT}
          fragmentShader={LAYER_FRAG}
          uniforms={layer1Uniforms}
          transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      <mesh ref={layer2Ref}>
        <sphereGeometry args={[size * 1.004, 64, 64]} />
        <shaderMaterial
          vertexShader={LAYER_VERT}
          fragmentShader={LAYER_FRAG}
          uniforms={layer2Uniforms}
          transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>

      {/* Glow billboards — face camera */}
      <group ref={glowRef}>
        {/* Rim glow: inward gradient — bright at disk edge, transparent toward center.
            depthTest=false so it renders over the opaque star sphere surface. */}
        <mesh>
          <planeGeometry args={[size * 2.6, size * 2.6]} />
          <shaderMaterial
            vertexShader={CORONA_BILLBOARD_VERT}
            fragmentShader={RIM_GLOW_FRAG}
            uniforms={rimGlowUniforms}
            transparent depthTest={!occludable} depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
        {/* Corona billboard — filaments, prominences, streamer rays */}
        <mesh renderOrder={-1}>
          <planeGeometry args={[size * 8.0, size * 8.0]} />
          <shaderMaterial ref={coronaRef}
            vertexShader={CORONA_BILLBOARD_VERT}
            fragmentShader={CORONA_FRAG}
            uniforms={coronaUniforms}
            transparent
            depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
        {/* Outer glow: large soft halo with chromatic aberration + diffraction spikes */}
        <mesh>
          <planeGeometry args={[size * 4.5, size * 4.5]} />
          <shaderMaterial
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            uniforms={{ uColor: { value: starCol } }}
            vertexShader={`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`}
            fragmentShader={`
              uniform vec3 uColor;
              varying vec2 vUv;
              void main() {
                vec2 c = vUv - 0.5;
                float r = length(c) * 2.0;

                // Chromatic aberration — R shifts out, B shifts in
                float rr = length(c * 1.022) * 2.0;
                float rb = length(c * 0.978) * 2.0;
                float glowR = exp(-rr*rr*2.8)*0.36 + exp(-rr*3.6)*0.14;
                float glowG = exp(-r *r *2.8)*0.36 + exp(-r *3.6)*0.14;
                float glowB = exp(-rb*rb*2.8)*0.36 + exp(-rb*3.6)*0.14;
                float glow  = (glowR + glowG + glowB) / 3.0;

                // Diffraction spikes (4-point cross)
                float fade = smoothstep(0.06, 0.30, r);
                float spH = exp(-c.y*c.y*160.0) * exp(-abs(c.x)*4.5);
                float spV = exp(-c.x*c.x*160.0) * exp(-abs(c.y)*4.5);
                float spikes = (spH + spV) * fade * 0.28;

                vec3 col = mix(vec3(1.0,0.99,0.96), uColor, r * 0.6);
                vec3 chromCol = col * vec3(glowR/max(glowG,0.001), 1.0, glowB/max(glowG,0.001));
                vec3 spikeCol = mix(col, vec3(0.80,0.88,1.0), 0.45);
                float total = glow + spikes * 0.55;
                if (total < 0.003) discard;
                gl_FragColor = vec4(chromCol * glow + spikeCol * spikes, total);
              }
            `}
          />
        </mesh>
        {/* Star surface brightener — flat warm fill across the whole disk, additive */}
        {/* plane = size*3 → star edge at r≈0.67 in r=length(c)*2 space */}
        <mesh>
          <planeGeometry args={[size * 3.0, size * 3.0]} />
          <shaderMaterial
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            uniforms={{ uColor: { value: hotCol } }}
            vertexShader={`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`}
            fragmentShader={`
              uniform vec3 uColor;
              varying vec2 vUv;
              void main() {
                vec2 c = vUv - 0.5;
                float r = length(c) * 2.0;
                // Star disk occupies r < 0.667 (plane=3x star diameter)
                // Flat-top fill: strong across whole disk, fades at corona region
                float diskFill = exp(-r * r * 1.8) * 0.55       // wide soft fill
                               + exp(-r * 3.2)     * 0.25;      // extended warm haze
                // Extra hot center punch
                float center   = exp(-r * r * 9.0) * 0.30;
                float total    = diskFill + center;
                if (total < 0.004) discard;
                // Color: near-white hot center → star color outward
                vec3 col = mix(vec3(1.0, 0.97, 0.88), uColor * 1.1, smoothstep(0.0, 0.7, r));
                gl_FragColor = vec4(col * total, total);
              }
            `}
          />
        </mesh>
      </group>
    </group>
  );
}

/** Distant parent star visible from planet/moon depth — bright disc with animated convection */

function HabitableZone({ inner, outer, starVisR, maxSma }: {
  inner: number; outer: number; starVisR: number; maxSma: number;
}) {
  const iR = logBeltRadius(inner, starVisR, maxSma);
  const oR = logBeltRadius(outer, starVisR, maxSma);
  if (iR <= 0 || oR <= iR) return null;
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
      <ringGeometry args={[iR, oR, 64]} />
      <meshBasicMaterial color="#22dd55" transparent opacity={0.045}
        side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  );
}

function BeltParticles({ belt, starVisR, maxSma }: {
  belt: any; starVisR: number; maxSma: number;
}) {
  const data = useMemo(() => {
    const inner = logBeltRadius(belt.inner_radius_au || 2, starVisR, maxSma);
    const outer = logBeltRadius(belt.outer_radius_au || 4, starVisR, maxSma);
    const count = Math.min(Math.floor((belt.estimated_bodies || 1000) / 180), 350);
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    let s = 42;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const isTrojan = belt.belt_type === 'trojan-swarm';
    const baseA = isTrojan ? (belt.angular_offset_deg || 60) * Math.PI / 180 : 0;
    const spread = isTrojan ? (belt.angular_spread_deg || 15) * Math.PI / 180 : Math.PI * 2;
    const gaps = (belt.resonance_gaps || []).map((g: any) => ({
      lo: logBeltRadius(g.position_au - g.width_au / 2, starVisR, maxSma),
      hi: logBeltRadius(g.position_au + g.width_au / 2, starVisR, maxSma),
    }));
    const bc = belt.belt_type === 'icy-kuiper' || belt.belt_type === 'scattered-disc'
      ? new THREE.Color('#6688bb') : belt.belt_type === 'trojan-swarm'
        ? new THREE.Color('#88aa66') : new THREE.Color('#887744');
    let placed = 0, att = 0;
    while (placed < count && att < count * 5) {
      att++;
      const r = inner + rnd() * (outer - inner);
      if (gaps.some((g: { lo: number; hi: number }) => r >= g.lo && r <= g.hi)) continue;
      const a = isTrojan ? baseA + (rnd() - 0.5) * spread : rnd() * Math.PI * 2;
      const y = (rnd() - 0.5) * 0.15;
      pos[placed * 3] = Math.cos(a) * r;
      pos[placed * 3 + 1] = y;
      pos[placed * 3 + 2] = Math.sin(a) * r;
      const c = bc.clone().multiplyScalar(0.7 + rnd() * 0.3);
      col[placed * 3] = c.r; col[placed * 3 + 1] = c.g; col[placed * 3 + 2] = c.b;
      placed++;
    }
    return { pos: pos.slice(0, placed * 3), col: col.slice(0, placed * 3), n: placed };
  }, [belt, starVisR, maxSma]);

  /* Belt particle shader: lights each particle based on angle from star at origin */
  const beltShader = useMemo(() => ({
    vertexShader: `
      attribute vec3 color;
      varying vec3 vColor;
      varying float vLit;
      void main() {
        vColor = color;
        // Star is at origin — light direction is normalize(-position) → toward star
        // We want the side facing the camera to be bright when the particle
        // is on the star-facing side. Use a simple radial falloff:
        // particles closer to camera-star line are brighter.
        vec3 toStar = -normalize(position);
        // Use camera direction as view proxy for face-on check
        vec3 toCam = normalize(cameraPosition - position);
        // Half-Lambert: wrap lighting so back side isn't pure black
        float NdotL = dot(toCam, toStar);
        vLit = NdotL * 0.35 + 0.65; // range [0.30, 1.0]
        vec4 mvp = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = 4.5 * (300.0 / -mvp.z);
        gl_Position = projectionMatrix * mvp;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vLit;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = dot(c, c);
        if (d > 0.25) discard;
        float soft = 1.0 - smoothstep(0.05, 0.25, d);
        vec3 col = vColor * vLit * 1.6;
        gl_FragColor = vec4(col * soft, soft * 0.80);
      }
    `,
  }), []);

  if (data.n === 0) return null;
  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[data.pos, 3]} />
        <bufferAttribute attach="attributes-color" args={[data.col, 3]} />
      </bufferGeometry>
      <shaderMaterial
        vertexShader={beltShader.vertexShader}
        fragmentShader={beltShader.fragmentShader}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

function Starfield() {
  /* ── Twinkling star shader ── */
  const twinkleMatRef = useRef<THREE.ShaderMaterial>(null!);

  const TWINKLE_VERT = `
    attribute float aSize;
    attribute float aPhase;
    attribute float aBrightness;
    varying float vPhase;
    varying float vBrightness;
    varying vec3 vColor2;
    void main() {
      vPhase = aPhase;
      vBrightness = aBrightness;
      vColor2 = color;
      vec4 mvp = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = aSize;
      gl_Position = projectionMatrix * mvp;
    }
  `;
  const TWINKLE_FRAG = `
    uniform float uTime;
    varying float vPhase;
    varying float vBrightness;
    varying vec3 vColor2;
    void main() {
      // Soft circular falloff
      vec2 c = gl_PointCoord - 0.5;
      float d = dot(c, c);
      if (d > 0.25) discard;
      float soft = 1.0 - smoothstep(0.0, 0.25, d);
      // Multi-frequency twinkle (atmospheric scintillation)
      float t1 = sin(uTime * 2.7 + vPhase) * 0.15;
      float t2 = sin(uTime * 5.3 + vPhase * 1.7) * 0.08;
      float t3 = sin(uTime * 0.9 + vPhase * 0.4) * 0.10;
      float twinkle = 1.0 + t1 + t2 + t3;
      // Brighter stars twinkle less (stabilized seeing)
      float twinkleMix = mix(twinkle, 1.0, smoothstep(0.3, 0.9, vBrightness));
      vec3 col = vColor2 * vBrightness * twinkleMix;
      gl_FragColor = vec4(col, soft * vBrightness * twinkleMix);
    }
  `;

  useFrame(() => {
    if (twinkleMatRef.current) {
      twinkleMatRef.current.uniforms.uTime.value = _orbit.time;
    }
  });

  /* ── Build star geometry from real HYG catalog ── */
  const starGeo = useMemo(() => {
    const raw = getStarData();
    const n = STAR_COUNT;
    const R = 60; // sky sphere radius

    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const sizes = new Float32Array(n);
    const phases = new Float32Array(n);
    const brightness = new Float32Array(n);

    // Magnitude range: ~-1.5 (Sirius) to 6.5
    const magMin = -1.5, magMax = 6.5;

    for (let i = 0; i < n; i++) {
      const off = i * FIELDS_PER_STAR;
      const x = raw[off], y = raw[off + 1], z = raw[off + 2];
      const mag = raw[off + 3];
      const bv = raw[off + 4];

      // Place on sky sphere (J2000 equatorial axes → Three.js: x=right, y=up, z=toward)
      pos[i * 3]     = x * R;
      pos[i * 3 + 1] = z * R;  // Dec → Y (up)
      pos[i * 3 + 2] = -y * R; // RA increases left → flip

      // Color from B-V index
      const [cr, cg, cb] = bvToRGB(bv);
      col[i * 3]     = cr;
      col[i * 3 + 1] = cg;
      col[i * 3 + 2] = cb;

      // Brightness: inverse magnitude (brighter = lower mag)
      const b = Math.pow(10, -0.4 * (mag - magMax)) / Math.pow(10, -0.4 * (magMin - magMax));
      brightness[i] = Math.min(1.0, 0.08 + b * 0.92);

      // Point size: bright stars get bigger (log scale), faint stars are tiny
      const sizeFactor = Math.max(0.3, 1.0 - (mag - magMin) / (magMax - magMin));
      sizes[i] = 0.6 + sizeFactor * 3.5; // 0.6px to 4.1px

      // Random phase for twinkle (deterministic from index)
      phases[i] = ((i * 127 + i * i * 31) % 10000) / 10000 * Math.PI * 2;
    }

    return { pos, col, sizes, phases, brightness, n };
  }, []);

  // Milky Way — TRUE particle-based starfield along galactic plane
  // 28K point-particles with density distribution + 40 soft glow sprites for diffuse underglow
  const mwParticles = useMemo(() => {
    const COUNT = 28000;
    const pos = new Float32Array(COUNT * 3);
    const col = new Float32Array(COUNT * 3);
    const sizes = new Float32Array(COUNT);
    let _s = 271828;
    const rng = () => { _s = (_s * 16807 + 7) % 2147483647; return _s / 2147483647; };
    const mwTilt = 1.05;
    const cosMW = Math.cos(mwTilt), sinMW = Math.sin(mwTilt);
    const R = 54;

    // Color palette for MW stars (blue-white dominant, some warm)
    // B-V color index simulation
    const starCol = (t: number): [number, number, number] => {
      // t: 0=blue → 0.5=white → 1.0=warm orange
      if (t < 0.3) return [0.7 + t, 0.75 + t * 0.5, 1.0];          // blue-white
      if (t < 0.6) return [0.95 + t * 0.05, 0.92, 0.88 - t * 0.1]; // white-yellow
      return [1.0, 0.82 - (t - 0.6) * 0.4, 0.6 - (t - 0.6) * 0.5]; // warm yellow-orange
    };

    // Dust lane mask: reduces density along the Great Rift
    const dustLane = (theta: number, galLat: number): number => {
      // Great Rift runs from Cygnus to Centaurus (~60% of the band)
      const riftCenter = 0.0; // galLat offset
      const riftWidth = 0.04 + 0.02 * Math.sin(theta * 1.5);
      const inRift = Math.exp(-(galLat - riftCenter) * (galLat - riftCenter) / (2 * riftWidth * riftWidth));
      // Only active in part of the band
      const riftLon = 0.5 + 0.5 * Math.sin(theta - 0.3);
      return 1.0 - inRift * riftLon * 0.7;
    };

    for (let i = 0; i < COUNT; i++) {
      const theta = rng() * Math.PI * 2;

      // Gaussian latitude distribution — tight along galactic plane
      // Box-Muller for gaussian
      const u1 = Math.max(1e-10, rng()), u2 = rng();
      let galLat = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * 0.09;
      galLat = Math.max(-0.5, Math.min(0.5, galLat)); // clamp

      // Density boost toward galactic center (theta ~ PI)
      const coreDist = Math.abs(theta - Math.PI);
      const coreFactor = coreDist < 0.8 ? 1.0 + (0.8 - coreDist) * 2.5 : 1.0;
      // Reject faint stars away from core to concentrate density
      if (coreFactor < 1.3 && rng() > 0.65) {
        // Redistribute rejected star to core region
        const newTheta = Math.PI + (rng() - 0.5) * 1.2;
        const phi = Math.PI / 2 + galLat;
        const x = R * Math.sin(phi) * Math.cos(newTheta);
        const y = R * Math.cos(phi);
        const z = R * Math.sin(phi) * Math.sin(newTheta);
        pos[i * 3] = x * cosMW - y * sinMW;
        pos[i * 3 + 1] = x * sinMW + y * cosMW;
        pos[i * 3 + 2] = z;
      } else {
        // Apply dust lane suppression
        const dust = dustLane(theta, galLat);
        if (rng() > dust) {
          galLat += (rng() > 0.5 ? 1 : -1) * (0.06 + rng() * 0.12); // push out of rift
        }
        const phi = Math.PI / 2 + galLat;
        const x = R * Math.sin(phi) * Math.cos(theta);
        const y = R * Math.cos(phi);
        const z = R * Math.sin(phi) * Math.sin(theta);
        pos[i * 3] = x * cosMW - y * sinMW;
        pos[i * 3 + 1] = x * sinMW + y * cosMW;
        pos[i * 3 + 2] = z;
      }

      // Star color: mostly blue-white, some warm in core region
      const colorT = rng() < 0.15 ? 0.6 + rng() * 0.4 : rng() * 0.55;
      const [cr, cg, cb] = starCol(colorT);
      // Brightness variation: most are dim, few are bright
      const bright = Math.pow(rng(), 2.8) * 0.7 + 0.15;
      col[i * 3] = cr * bright;
      col[i * 3 + 1] = cg * bright;
      col[i * 3 + 2] = cb * bright;

      // Size: most tiny (unresolved), few larger (resolved brighter stars)
      const sizeRoll = rng();
      sizes[i] = sizeRoll < 0.85 ? 0.3 + rng() * 0.5
               : sizeRoll < 0.97 ? 0.8 + rng() * 1.0
               : 1.8 + rng() * 1.5; // rare bright stars
    }
    return { pos, col, sizes, count: COUNT };
  }, []);

  // Soft diffuse underglow sprites (reduced from 305 → 40) for the smooth band background
  const mwGlow = useMemo(() => {
    const items: { pos: [number, number, number]; size: number; opacity: number; color: string }[] = [];
    let _s = 314159;
    const rng = () => { _s = (_s * 16807 + 7) % 2147483647; return _s / 2147483647; };
    const mwTilt = 1.05;
    const cosMW = Math.cos(mwTilt), sinMW = Math.sin(mwTilt);
    const softPalette = ['#a0b0e0', '#b8c4e8', '#c0c8e4', '#90a0d0', '#c8d0f0'];
    // Broad soft band (20 large dim sprites)
    for (let i = 0; i < 20; i++) {
      const theta = (i / 20) * Math.PI * 2 + (rng() - 0.5) * 0.2;
      const galLat = (rng() - 0.5) * 0.22;
      const phi = Math.PI / 2 + galLat;
      const r = 53.8;
      const x = r * Math.sin(phi) * Math.cos(theta);
      const y = r * Math.cos(phi);
      const z = r * Math.sin(phi) * Math.sin(theta);
      items.push({
        pos: [x * cosMW - y * sinMW, x * sinMW + y * cosMW, z],
        size: 24 + rng() * 20,
        opacity: 0.03 + rng() * 0.04,
        color: softPalette[Math.floor(rng() * softPalette.length)],
      });
    }
    // Galactic core glow (20 warm sprites)
    for (let i = 0; i < 20; i++) {
      const theta = Math.PI + (rng() - 0.5) * 0.9;
      const galLat = (rng() - 0.5) * 0.12;
      const phi = Math.PI / 2 + galLat;
      const r = 53.8;
      const x = r * Math.sin(phi) * Math.cos(theta);
      const y = r * Math.cos(phi);
      const z = r * Math.sin(phi) * Math.sin(theta);
      const warmth = rng();
      items.push({
        pos: [x * cosMW - y * sinMW, x * sinMW + y * cosMW, z],
        size: 14 + rng() * 22,
        opacity: 0.06 + rng() * 0.08,
        color: warmth > 0.5 ? '#f0e8d8' : warmth > 0.25 ? '#e8e0f0' : '#fffff0',
      });
    }
    return items;
  }, []);

  // Nebula patches — vivid emission nebulae scattered through the band
  const nebulae = useMemo(() => {
    const items: { pos: [number, number, number]; size: number; opacity: number; color: string }[] = [];
    let _s = 161803;
    const rng = () => { _s = (_s * 16807 + 7) % 2147483647; return _s / 2147483647; };
    const mwTilt = 1.05;
    const cosMW = Math.cos(mwTilt), sinMW = Math.sin(mwTilt);
    const nebColors = [
      '#ff3355', '#3388ff', '#33cc88', '#ff7733', '#aa33ff', '#33ccff',
      '#ff55aa', '#55ff99', '#ff5533', '#7755ff', '#33ffcc', '#ffaa33',
      '#ff2244', '#2266ff', '#22aa66', '#cc55ff', '#55ddff', '#ffcc55',
    ];
    // Large dramatic nebulae
    for (let i = 0; i < 18; i++) {
      const theta = rng() * Math.PI * 2;
      const galLat = (rng() - 0.5) * 0.30;
      const phi = Math.PI / 2 + galLat;
      const r = 53;
      const x = r * Math.sin(phi) * Math.cos(theta);
      const y = r * Math.cos(phi);
      const z = r * Math.sin(phi) * Math.sin(theta);
      const rx = x * cosMW - y * sinMW;
      const ry = x * sinMW + y * cosMW;
      items.push({
        pos: [rx, ry, z],
        size: 12 + rng() * 22,
        opacity: 0.03 + rng() * 0.05,
        color: nebColors[Math.floor(rng() * nebColors.length)],
      });
    }
    // Small bright emission knots
    for (let i = 0; i < 25; i++) {
      const theta = rng() * Math.PI * 2;
      const galLat = (rng() - 0.5) * 0.22;
      const phi = Math.PI / 2 + galLat;
      const r = 53;
      const x = r * Math.sin(phi) * Math.cos(theta);
      const y = r * Math.cos(phi);
      const z = r * Math.sin(phi) * Math.sin(theta);
      const rx = x * cosMW - y * sinMW;
      const ry = x * sinMW + y * cosMW;
      items.push({
        pos: [rx, ry, z],
        size: 3 + rng() * 7,
        opacity: 0.04 + rng() * 0.06,
        color: nebColors[Math.floor(rng() * nebColors.length)],
      });
    }
    return items;
  }, []);

  // Shared glow texture for soft-circle sprites (eliminates visible square edges)
  const glowTex = useMemo(() => getGlowTexture(), []);

  return (
    <group>
      {/* Real HYG catalog stars with twinkling shader */}
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[starGeo.pos, 3]} />
          <bufferAttribute attach="attributes-color" args={[starGeo.col, 3]} />
          <bufferAttribute attach="attributes-aSize" args={[starGeo.sizes, 1]} />
          <bufferAttribute attach="attributes-aPhase" args={[starGeo.phases, 1]} />
          <bufferAttribute attach="attributes-aBrightness" args={[starGeo.brightness, 1]} />
        </bufferGeometry>
        <shaderMaterial
          ref={twinkleMatRef}
          vertexShader={TWINKLE_VERT}
          fragmentShader={TWINKLE_FRAG}
          uniforms={{ uTime: { value: 0 } }}
          vertexColors
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
      {/* Milky Way TRUE particle starfield — 28K star-like points */}
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[mwParticles.pos, 3]} />
          <bufferAttribute attach="attributes-color" args={[mwParticles.col, 3]} />
          <bufferAttribute attach="attributes-aSize" args={[mwParticles.sizes, 1]} />
        </bufferGeometry>
        <shaderMaterial
          vertexShader={`
            attribute float aSize;
            varying vec3 vColor;
            void main() {
              vColor = color;
              vec4 mv = modelViewMatrix * vec4(position, 1.0);
              gl_PointSize = aSize * (280.0 / -mv.z);
              gl_Position = projectionMatrix * mv;
            }
          `}
          fragmentShader={`
            varying vec3 vColor;
            void main() {
              float d = length(gl_PointCoord - 0.5) * 2.0;
              float core = 1.0 - smoothstep(0.0, 0.35, d);
              float glow = exp(-d * d * 3.0) * 0.6;
              float alpha = core + glow;
              if (alpha < 0.01) discard;
              vec3 col = vColor * (core * 1.2 + glow * 0.8);
              gl_FragColor = vec4(col, alpha);
            }
          `}
          vertexColors
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
      {/* Milky Way soft diffuse underglow — reduced sprite layer */}
      {mwGlow.map((g, i) => (
        <sprite key={`mw-glow-${i}`} position={g.pos} scale={[g.size, g.size, 1]}>
          <spriteMaterial map={glowTex} color={g.color} transparent opacity={g.opacity}
            depthWrite={false} blending={THREE.AdditiveBlending} />
        </sprite>
      ))}
      {/* Nebula patches -- vivid colored emission along band */}
      {nebulae.map((n, i) => (
        <sprite key={`nebula-${i}`} position={n.pos} scale={[n.size, n.size, 1]}>
          <spriteMaterial map={glowTex} color={n.color} transparent opacity={n.opacity}
            depthWrite={false} blending={THREE.AdditiveBlending} />
        </sprite>
      ))}
    </group>
  );
}

/* ━━ Habitat Station 3D (O'Neill cylinder placeholder) ━━ */

function HabitatStation({ orbitR, period, startAngle, type, label }: {
  orbitR: number; period: number; startAngle: number;
  type: 'station' | 'outpost' | 'relay';
  label: string;
}) {
  const grp = useRef<THREE.Group>(null!);

  useFrame(() => {
    const t = _orbit.time;
    const a = startAngle + (t * Math.PI * 2) / period;
    if (grp.current) {
      grp.current.position.x = Math.cos(a) * orbitR;
      grp.current.position.z = Math.sin(a) * orbitR;
      grp.current.rotation.y = t * 0.3;
      grp.current.rotation.x = 0.15;
    }
  });

  const [h, cR] = type === 'station' ? [0.16, 0.04] :
                   type === 'outpost' ? [0.11, 0.028] : [0.07, 0.018];

  return (
    <group ref={grp}>
      {/* Main cylinder hull */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[cR, cR, h, 12]} />
        <meshStandardMaterial
          color="#8899bb" emissive="#4d9fff" emissiveIntensity={0.35}
          roughness={0.2} metalness={0.8} />
      </mesh>
      {/* End-cap glow (docking lights) */}
      <mesh position={[0, 0, h / 2]}>
        <sphereGeometry args={[cR * 0.7, 8, 8]} />
        <meshBasicMaterial color="#4d9fff" transparent opacity={0.45}
          depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      <mesh position={[0, 0, -h / 2]}>
        <sphereGeometry args={[cR * 0.7, 8, 8]} />
        <meshBasicMaterial color="#4d9fff" transparent opacity={0.45}
          depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      {/* Solar panel struts */}
      <mesh position={[cR * 1.8, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <boxGeometry args={[cR * 0.3, cR * 3.5, 0.003]} />
        <meshStandardMaterial color="#334466" emissive="#224488" emissiveIntensity={0.15}
          roughness={0.3} metalness={0.6} />
      </mesh>
      <mesh position={[-cR * 1.8, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <boxGeometry args={[cR * 0.3, cR * 3.5, 0.003]} />
        <meshStandardMaterial color="#334466" emissive="#224488" emissiveIntensity={0.15}
          roughness={0.3} metalness={0.6} />
      </mesh>
      <Billboard>
        <Text position={[0, cR + 0.08, 0]} fontSize={0.05}
          color="#4d9fff" fillOpacity={0.55} anchorX="center" anchorY="bottom">
          {label}
        </Text>
      </Billboard>
    </group>
  );
}

/* ━━ Habitat orbit ring indicator ━━ */

function HabitatOrbitRing({ radius }: { radius: number }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[radius - 0.003, radius + 0.003, 64]} />
      <meshBasicMaterial color="#4d9fff" transparent opacity={0.08}
        depthWrite={false} blending={THREE.AdditiveBlending} />
    </mesh>
  );
}

/* ━━ Temperature Zone Overlay ━━ */
function TemperatureZone({ starTeff, starLum, starVisR, maxSma }: {
  starTeff: number; starLum: number; starVisR: number; maxSma: number;
}) {
  // Show concentric rings colored by equilibrium temperature
  // T_eq = T_star * sqrt(R_star / (2 * a))  approx => T ∝ L^0.25 / a^0.5
  const bands = useMemo(() => {
    const result: { inner: number; outer: number; color: string; opacity: number; label: string }[] = [];
    const lum = Math.max(starLum, 0.0001);
    // Temperature thresholds (K) and colors
    const zones = [
      { tMin: 1000, tMax: 9999, color: '#ff2200', label: 'Scorching' },
      { tMin: 500, tMax: 1000, color: '#ff6600', label: 'Hot' },
      { tMin: 300, tMax: 500, color: '#ffaa00', label: 'Warm' },
      { tMin: 200, tMax: 300, color: '#44cc44', label: 'Temperate' },
      { tMin: 100, tMax: 200, color: '#4488ff', label: 'Cold' },
      { tMin: 40, tMax: 100, color: '#2244aa', label: 'Frigid' },
      { tMin: 0, tMax: 40, color: '#112244', label: 'Frozen' },
    ];
    // a(T) = L / (T/278.5)^4  (simplified equilibrium temp formula)
    for (const z of zones) {
      const aOuter = Math.sqrt(lum) * 278.5 / z.tMin;
      const aInner = z.tMax > 5000 ? 0.001 : Math.sqrt(lum) * 278.5 / z.tMax;
      if (aOuter < 0.001 || aInner > maxSma * 2) continue;
      const rI = logOrbitRadius(Math.max(aInner, 0.001), starVisR, maxSma);
      const rO = logOrbitRadius(Math.min(aOuter, maxSma * 2.5), starVisR, maxSma);
      if (rO > rI && rO - rI > 0.01) {
        result.push({ inner: rI, outer: rO, color: z.color, opacity: 0.06, label: z.label });
      }
    }
    return result;
  }, [starTeff, starLum, starVisR, maxSma]);

  return (
    <group>
      {bands.map((b, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
          <ringGeometry args={[b.inner, b.outer, 64]} />
          <meshBasicMaterial color={b.color} transparent opacity={b.opacity}
            side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

/* ━━ Radiation Zone Overlay ━━ */
function RadiationZone({ starLum, starVisR, maxSma }: {
  starLum: number; starVisR: number; maxSma: number;
}) {
  // Radiation flux ∝ L / a^2 — show danger zones
  const bands = useMemo(() => {
    const result: { inner: number; outer: number; color: string; opacity: number }[] = [];
    const lum = Math.max(starLum, 0.0001);
    // Flux thresholds (Earth = 1 at 1 AU for L=1)
    const zones = [
      { fMin: 100, fMax: 99999, color: '#ff0044' },  // lethal
      { fMin: 10, fMax: 100, color: '#ff4400' },      // extreme
      { fMin: 2, fMax: 10, color: '#ff8800' },        // high
      { fMin: 0.5, fMax: 2, color: '#ffcc00' },       // moderate
      { fMin: 0.1, fMax: 0.5, color: '#44cc88' },     // low
      { fMin: 0.01, fMax: 0.1, color: '#2266aa' },    // minimal
    ];
    // a = sqrt(L / F) 
    for (const z of zones) {
      const aOuter = Math.sqrt(lum / z.fMin);
      const aInner = Math.sqrt(lum / z.fMax);
      if (aOuter < 0.001 || aInner > maxSma * 2) continue;
      const rI = logOrbitRadius(Math.max(aInner, 0.001), starVisR, maxSma);
      const rO = logOrbitRadius(Math.min(aOuter, maxSma * 2.5), starVisR, maxSma);
      if (rO > rI && rO - rI > 0.01) {
        result.push({ inner: rI, outer: rO, color: z.color, opacity: 0.045 });
      }
    }
    return result;
  }, [starLum, starVisR, maxSma]);

  return (
    <group>
      {bands.map((b, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
          <ringGeometry args={[b.inner, b.outer, 64]} />
          <meshBasicMaterial color={b.color} transparent opacity={b.opacity}
            side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

/* ━━ Frost Line marker ━━ */
function FrostLine({ starLum, starVisR, maxSma }: {
  starLum: number; starVisR: number; maxSma: number;
}) {
  // Frost line ≈ 2.7 * sqrt(L) AU (water ice condensation)
  const frostAU = 2.7 * Math.sqrt(Math.max(starLum, 0.0001));
  const r = logOrbitRadius(frostAU, starVisR, maxSma);
  if (r <= starVisR || frostAU > maxSma * 3) return null;
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
      <ringGeometry args={[r - 0.012, r + 0.012, 96]} />
      <meshBasicMaterial color="#88ccff" transparent opacity={0.12}
        side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  );
}

/* ━━ Procedural Asteroid (blobby unique shapes) ━━ */
function ProceduralAsteroid({ seed, size, position: pos, color }: {
  seed: number; size: number; position: [number, number, number]; color: string;
}) {
  const geo = useMemo(() => {
    const g = new THREE.IcosahedronGeometry(1, 2);
    const p = g.attributes.position;
    const s = seed * 173 + 31;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      // Multi-frequency deformation for unique blobby shapes
      const n1 = Math.sin(x * 2.3 + s) * Math.cos(y * 3.1 + s * 0.6) * Math.sin(z * 1.9 + s * 1.4) * 0.35;
      const n2 = Math.sin(x * 5.7 + s * 2.1) * Math.cos(y * 4.3 + s * 1.8) * 0.18;
      const n3 = Math.sin(x * 11 + y * 9 + z * 7 + s * 3) * 0.06;
      // Elongation axis (many asteroids are elongated)
      const elongate = 0.7 + Math.abs(Math.sin(s * 0.37)) * 0.6;
      const scale = 0.5 + n1 + n2 + n3;
      p.setXYZ(i, x * scale * elongate, y * scale * 0.75, z * scale);
    }
    p.needsUpdate = true;
    g.computeVertexNormals();
    return g;
  }, [seed]);

  return (
    <mesh geometry={geo} position={pos} scale={[size, size, size]}
      rotation={[seed * 2.1, seed * 3.7, seed * 1.3]}>
      <meshStandardMaterial color={color} roughness={0.92} metalness={0.05} />
    </mesh>
  );
}

/* ━━ Belt Asteroid Field (visible 3D asteroids) ━━ */
function BeltAsteroids({ belt, starVisR, maxSma }: {
  belt: any; starVisR: number; maxSma: number;
}) {
  const asteroids = useMemo(() => {
    const inner = logBeltRadius(belt.inner_radius_au || 2, starVisR, maxSma);
    const outer = logBeltRadius(belt.outer_radius_au || 4, starVisR, maxSma);
    const count = Math.min(Math.floor((belt.estimated_bodies || 1000) / 600), 80);
    let s = 42 + (belt.inner_radius_au || 0) * 1000;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const isTrojan = belt.belt_type === 'trojan-swarm';
    const baseA = isTrojan ? (belt.angular_offset_deg || 60) * Math.PI / 180 : 0;
    const spread = isTrojan ? (belt.angular_spread_deg || 15) * Math.PI / 180 : Math.PI * 2;
    const isIcy = belt.belt_type === 'icy-kuiper' || belt.belt_type === 'scattered-disc';
    const result: { pos: [number, number, number]; seed: number; size: number; color: string }[] = [];
    for (let i = 0; i < count; i++) {
      const r = inner + rnd() * (outer - inner);
      const a = isTrojan ? baseA + (rnd() - 0.5) * spread : rnd() * Math.PI * 2;
      const y = (rnd() - 0.5) * 0.25;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const sz = 0.02 + rnd() * 0.06;
      const c = isIcy ? '#8899bb' : '#887755';
      result.push({ pos: [x, y, z], seed: rnd() * 1000, size: sz, color: c });
    }
    return result;
  }, [belt, starVisR, maxSma]);

  return (
    <group>
      {asteroids.map((a, i) => (
        <ProceduralAsteroid key={i} seed={a.seed} size={a.size} position={a.pos} color={a.color} />
      ))}
    </group>
  );
}

/* ━━ Ring Particle System (disc of particles instead of flat ring) ━━ */
function RingParticles({ rings, tilt = 0.12 }: { rings: any[]; tilt?: number }) {
  const data = useMemo(() => {
    const allPos: number[] = [];
    const allCol: number[] = [];
    const allSize: number[] = [];
    let s = 77;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };

    for (const ring of rings) {
      const iR = ring.inner_radius_re * 0.1;
      const oR = ring.outer_radius_re * 0.1;
      const density = Math.min(ring.optical_depth * 2400, 4000);
      const count = Math.max(200, Math.floor(density));
      const baseC = ring.composition === 'icy' ? new THREE.Color('#aabbdd') :
        ring.composition === 'mixed' ? new THREE.Color('#99aa88') : new THREE.Color('#887755');
      for (let i = 0; i < count; i++) {
        const r = iR + rnd() * (oR - iR);
        const a = rnd() * Math.PI * 2;
        const y = (rnd() - 0.5) * 0.018 * (oR - iR);
        allPos.push(Math.cos(a) * r, y, Math.sin(a) * r);
        const c = baseC.clone().multiplyScalar(0.45 + rnd() * 0.7);
        allCol.push(c.r, c.g, c.b);
        allSize.push(0.005 + rnd() * 0.015);
      }
    }
    return {
      pos: new Float32Array(allPos),
      col: new Float32Array(allCol),
      sizes: new Float32Array(allSize),
      count: allPos.length / 3,
    };
  }, [rings]);

  if (data.count === 0) return null;
  return (
    <group rotation={[tilt, 0, 0]}>
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[data.pos, 3]} />
          <bufferAttribute attach="attributes-color" args={[data.col, 3]} />
        </bufferGeometry>
        <pointsMaterial vertexColors size={0.012} transparent opacity={0.75}
          sizeAttenuation depthWrite={false} />
      </points>
    </group>
  );
}

/* ━━ Moon Orbit Line ━━ */
function MoonOrbitLine({ radius, active = false }: { radius: number; active?: boolean }) {
  const lineObj = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    const segs = 128;
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineDashedMaterial({
      color: active ? '#6ab4ff' : '#4a6a8a',
      transparent: true,
      opacity: active ? 0.70 : 0.40,
      dashSize: radius * 0.06,
      gapSize: radius * 0.04,
      depthWrite: false,
    });
    const obj = new THREE.Line(geo, mat);
    obj.computeLineDistances();
    return obj;
  }, [radius, active]);

  return (
    <group>
      <primitive object={lineObj} />
    </group>
  );
}

/* ━━ LOD-aware planet wrapper (increases segments when zoomed in) ━━ */
function LODPlanet({ planetType, temperature, seed, sunDirection, rotationSpeed,
  mass, tidalHeating, starSpectralClass, colorShift, baseScale,
  tidallyLocked, spinOrbit32, showTempMap, showMineralMap, tempDistribution, mineralAbundance,
  axialTilt, onBiomeClick,
}: {
  planetType: string; temperature: number; seed: number;
  sunDirection: [number, number, number]; rotationSpeed: number;
  mass?: number; tidalHeating?: number; starSpectralClass?: string;
  colorShift?: [number, number, number]; baseScale: number;
  tidallyLocked?: boolean; spinOrbit32?: boolean;
  showTempMap?: boolean; showMineralMap?: boolean;
  tempDistribution?: any; mineralAbundance?: any;
  axialTilt?: number;
  onBiomeClick?: (biome: BiomeInfo, hitPoint: THREE.Vector3) => void;
}) {
  const ref = useRef<THREE.Group>(null!);
  const [lod, setLod] = useState({ segments: 96, displacement: 0.035 });

  useFrame(({ camera }) => {
    if (!ref.current) return;
    const d = camera.position.distanceTo(ref.current.getWorldPosition(new THREE.Vector3()));
    // LOD tiers based on camera distance
    let seg = 96, disp = 0.035;
    if (d < 2.5)       { seg = 192; disp = 0.065; }
    else if (d < 5)    { seg = 128; disp = 0.045; }
    else if (d < 10)   { seg = 96;  disp = 0.035; }
    else if (d < 20)   { seg = 64;  disp = 0.020; }
    else                { seg = 48;  disp = 0.010; }
    if (seg !== lod.segments) setLod({ segments: seg, displacement: disp });
  });

  return (
    <group ref={ref} scale={[baseScale, baseScale, baseScale]}>
      <ProceduralPlanet
        planetType={planetType}
        temperature={temperature}
        seed={seed}
        sunDirection={sunDirection}
        rotationSpeed={rotationSpeed}
        mass={mass}
        tidalHeating={tidalHeating}
        starSpectralClass={starSpectralClass}
        colorShift={colorShift}
        segments={lod.segments}
        displacement={lod.displacement}
        tidallyLocked={tidallyLocked}
        spinOrbit32={spinOrbit32}
        showTempMap={showTempMap}
        showMineralMap={showMineralMap}
        tempDistribution={tempDistribution}
        mineralAbundance={mineralAbundance}
        axialTilt={axialTilt}
        onBiomeClick={onBiomeClick}
      />
    </group>
  );
}

/** Shared rotation group — planet mesh + colony overlay rotate as one.
 *  Eliminates floating-point drift between independent useFrame accumulators. */
function RotatingSurfaceGroup({ children, rotationSpeed }: {
  children: React.ReactNode; rotationSpeed: number;
}) {
  const ref = useRef<THREE.Group>(null!);
  useFrame((_, delta) => {
    if (ref.current) {
      const spd = (globalThis as any).__exomaps_orbit_speed ?? 1;
      ref.current.rotation.y += delta * rotationSpeed * spd;
    }
  });
  return <group ref={ref}>{children}</group>;
}

/* ━━ Camera controller (smooth lerp — never remounts OrbitControls) ━━ */

function SmoothCamera({ depth }: { depth: ViewDepth }) {
  const controlsRef = useRef<any>(null);
  const camGoal = useRef(new THREE.Vector3(0, 8, 14));
  const lookGoal = useRef(new THREE.Vector3(0, 0, 0));
  const isLerping = useRef(false);
  const userSpeed = useRef(_orbit.speed);      // remember user-set speed

  useEffect(() => {
    const positions: Record<ViewDepth, [number, number, number]> = {
      system: [0, 8, 14],
      planet: [0, 3.5, 7],
      moon:   [0, 1.5, 3.5],
      belt:   [0, 8, 14],
      asteroid: [0, 1.5, 3.5],
    };
    const p = positions[depth] || positions.system;
    camGoal.current.set(p[0], p[1], p[2]);
    lookGoal.current.set(0, 0, 0);
    isLerping.current = true;
    if (controlsRef.current) controlsRef.current.enabled = false;
  }, [depth]);

  useFrame(({ camera }) => {
    // ── Lerp transition ──
    if (isLerping.current) {
      camera.position.lerp(camGoal.current, 0.07);
      if (controlsRef.current) {
        controlsRef.current.target.lerp(lookGoal.current, 0.07);
      }
      if (camera.position.distanceTo(camGoal.current) < 0.05) {
        isLerping.current = false;
        camera.position.copy(camGoal.current);
        if (controlsRef.current) {
          controlsRef.current.target.copy(lookGoal.current);
          controlsRef.current.enabled = true;
          controlsRef.current.update();
        }
      }
    }

    // ── Zoom-lock: slow/pause orbit when camera is close to globe ──
    if (depth === 'planet' || depth === 'moon' || depth === 'asteroid') {
      if (_orbit.speed !== 0) userSpeed.current = _orbit.speed; // track user setting
      const d = camera.position.length(); // distance from origin (globe center)
      const threshold = depth === 'planet' ? 5.0 : 2.5;
      const lockStart = depth === 'planet' ? 3.5 : 1.8;
      if (d < lockStart) {
        _orbit.speed = 0; // fully locked
      } else if (d < threshold) {
        // Gradual slowdown as camera approaches
        const t = (d - lockStart) / (threshold - lockStart);
        _orbit.speed = (userSpeed.current || 1) * t;
      } else {
        _orbit.speed = userSpeed.current || 1;
      }
    }
  });

  return (
    <OrbitControls ref={controlsRef}
      makeDefault
      enableDamping dampingFactor={0.08}
      maxDistance={40} minDistance={0.6} />
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Asteroid Family Scatter Chart (Kirkwood-style)
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

function BeltFamilyChart({ belt }: { belt: any }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    const W = rect.width, H = rect.height;

    const pad = { t: 28, r: 16, b: 38, l: 48 };
    const cw = W - pad.l - pad.r;
    const ch = H - pad.t - pad.b;

    const innerAU = belt.inner_radius_au || 2;
    const outerAU = belt.outer_radius_au || 4;
    const margin = (outerAU - innerAU) * 0.08;
    const xMin = innerAU - margin, xMax = outerAU + margin;
    const yMax = 22;

    const toX = (au: number) => pad.l + ((au - xMin) / (xMax - xMin)) * cw;
    const toY = (deg: number) => pad.t + (1 - deg / yMax) * ch;

    ctx.fillStyle = '#060a12';
    ctx.fillRect(0, 0, W, H);

    // Grid
    ctx.strokeStyle = 'rgba(30,48,80,0.15)';
    ctx.lineWidth = 0.5;
    for (let au = Math.ceil(xMin * 10) / 10; au <= xMax; au += 0.2) {
      ctx.beginPath(); ctx.moveTo(toX(au), pad.t); ctx.lineTo(toX(au), pad.t + ch); ctx.stroke();
    }
    for (let deg = 0; deg <= yMax; deg += 5) {
      ctx.beginPath(); ctx.moveTo(pad.l, toY(deg)); ctx.lineTo(pad.l + cw, toY(deg)); ctx.stroke();
    }

    // Resonance gaps
    (belt.resonance_gaps || []).forEach((g: any) => {
      const x1 = toX(g.position_au - g.width_au / 2);
      const x2 = toX(g.position_au + g.width_au / 2);
      ctx.fillStyle = 'rgba(255,60,60,0.08)';
      ctx.fillRect(x1, pad.t, x2 - x1, ch);
      ctx.fillStyle = '#884444';
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(g.resonance, toX(g.position_au), pad.t + ch + 12);
      ctx.strokeStyle = 'rgba(255,80,60,0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(toX(g.position_au), pad.t);
      ctx.lineTo(toX(g.position_au), pad.t + ch); ctx.stroke();
    });

    // Families — scatter clouds
    const families = belt.families || [];
    let seed = 137;
    const rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

    families.forEach((fam: any) => {
      const cx = fam.center_au;
      const spread = fam.spread_au || 0.05;
      const count = Math.min(fam.member_count || 200, 600);
      const col = SPEC_COLOR[fam.spectral_class] || '#4488ee';
      ctx.fillStyle = col;
      ctx.globalAlpha = 0.55;
      for (let i = 0; i < count; i++) {
        const dx = (rng() + rng() + rng() - 1.5) * spread * 2;
        const incBase = 2 + rng() * 14;
        const dy = (rng() - 0.5) * 4;
        const x = toX(cx + dx);
        const y = toY(incBase + dy);
        if (x < pad.l || x > pad.l + cw || y < pad.t || y > pad.t + ch) continue;
        ctx.beginPath(); ctx.arc(x, y, 1.1, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = col;
      ctx.font = 'bold 10px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(fam.name, toX(cx), toY(8 + rng() * 5));
    });
    ctx.globalAlpha = 1;

    // Major asteroids — diamonds
    (belt.major_asteroids || []).forEach((a: any) => {
      const x = toX(a.semi_major_axis_au);
      const y = toY(a.inclination_deg || 5);
      if (x < pad.l || x > pad.l + cw || y < pad.t || y > pad.t + ch) return;
      const col = SPEC_COLOR[a.spectral_class] || '#ccc';
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(x, y - 4); ctx.lineTo(x + 3, y); ctx.lineTo(x, y + 4); ctx.lineTo(x - 3, y);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#c0d0e0';
      ctx.font = '9px Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`${a.name} (${a.diameter_km?.toFixed(0) || '?'} km)`, x + 5, y + 3);
    });

    // Ice dwarfs
    (belt.ice_dwarfs || []).forEach((d: any) => {
      const x = toX(d.semi_major_axis_au);
      const y = toY(d.inclination_deg || 10);
      if (x < pad.l || x > pad.l + cw || y < pad.t || y > pad.t + ch) return;
      const rPx = Math.max(2.5, Math.min((d.diameter_km || 500) / 300, 6));
      ctx.fillStyle = d.surface_type === 'nitrogen-ice' ? '#aaccff' :
        d.surface_type === 'methane-frost' ? '#ffccaa' : '#99ddff';
      ctx.globalAlpha = 0.7;
      ctx.beginPath(); ctx.arc(x, y, rPx, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#c0d0e0';
      ctx.font = '9px Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(d.name, x + rPx + 3, y + 3);
      if (d.has_companion) {
        ctx.fillStyle = '#667788';
        ctx.fillText('⚭', x + rPx + 3 + ctx.measureText(d.name).width + 3, y + 3);
      }
    });

    // Axes
    ctx.strokeStyle = 'rgba(60,80,110,0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.l, pad.t); ctx.lineTo(pad.l, pad.t + ch); ctx.lineTo(pad.l + cw, pad.t + ch);
    ctx.stroke();
    ctx.fillStyle = '#556677';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'center';
    for (let au = Math.ceil(xMin * 5) / 5; au <= xMax; au += 0.5) {
      if (au < xMin || au > xMax) continue;
      ctx.fillText(au.toFixed(1), toX(au), pad.t + ch + 26);
    }
    ctx.textAlign = 'right';
    for (let deg = 0; deg <= yMax; deg += 5) {
      ctx.fillText(`${deg}°`, pad.l - 6, toY(deg) + 3);
    }
    ctx.fillStyle = '#445566';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Semi-major axis (AU)', pad.l + cw / 2, H - 4);
    ctx.save();
    ctx.translate(12, pad.t + ch / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Inclination (°)', 0, 0);
    ctx.restore();

    // Title + stats
    ctx.fillStyle = '#8899aa';
    ctx.font = 'bold 11px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(BELT_TYPE_LABEL[belt.belt_type] || belt.belt_type, pad.l, pad.t - 10);
    ctx.fillStyle = '#445566';
    ctx.font = '9px Inter, sans-serif';
    ctx.textAlign = 'right';
    const stats = [
      `${(belt.estimated_bodies || 0).toLocaleString()} bodies`,
      `${belt.inner_radius_au?.toFixed(2)}–${belt.outer_radius_au?.toFixed(2)} AU`,
      families.length > 0 ? `${families.length} families` : '',
      (belt.resonance_gaps?.length || 0) > 0 ? `${belt.resonance_gaps.length} gaps` : '',
    ].filter(Boolean).join('  ·  ');
    ctx.fillText(stats, W - pad.r, pad.t - 10);
  }, [belt]);

  return (
    <div className="sf-belt-chart">
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Depth Breadcrumb Overlay
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

function DepthBreadcrumb({ view, systemData, planets, belts, onNavigate }: {
  view: ViewState;
  systemData: any;
  planets: any[];
  belts: any[];
  onNavigate: (v: ViewState) => void;
}) {
  const starName = systemData?.star?.main_id || 'Star';
  const crumbs: { label: string; icon: string; target: ViewState }[] = [];

  crumbs.push({
    label: starName,
    icon: '☀',
    target: { depth: 'system', planetIdx: 0 },
  });

  if (view.depth === 'planet' || view.depth === 'moon') {
    const p = planets[view.planetIdx];
    crumbs.push({
      label: shortName(p?.planet_name, view.planetIdx),
      icon: '●',
      target: { depth: 'planet', planetIdx: view.planetIdx },
    });
  }

  if (view.depth === 'moon' && view.moonIdx != null) {
    const p = planets[view.planetIdx];
    const m = p?.moons?.[view.moonIdx];
    crumbs.push({
      label: m?.moon_name?.split(' ').pop() || `moon-${view.moonIdx}`,
      icon: MOON_ICON[m?.moon_type] || '🌑',
      target: { depth: 'moon', planetIdx: view.planetIdx, moonIdx: view.moonIdx },
    });
  }

  if (view.depth === 'belt' && view.beltIdx != null) {
    const b = belts[view.beltIdx];
    crumbs.push({
      label: BELT_TYPE_LABEL[b?.belt_type]?.replace(/^.\s/, '') || 'Belt',
      icon: b?.belt_type === 'icy-kuiper' ? '🧊' : b?.belt_type === 'trojan-swarm' ? '⚔️' : '🪨',
      target: { depth: 'belt', planetIdx: 0, beltIdx: view.beltIdx },
    });
  }

  if (view.depth === 'asteroid' && view.beltIdx != null && view.asteroidIdx != null) {
    const b = belts[view.beltIdx];
    crumbs.push({
      label: BELT_TYPE_LABEL[b?.belt_type]?.replace(/^.\s/, '') || 'Belt',
      icon: b?.belt_type === 'icy-kuiper' ? '🧊' : '🪨',
      target: { depth: 'belt', planetIdx: 0, beltIdx: view.beltIdx },
    });
    const src = view.asteroidSource === 'ice_dwarf' ? b?.ice_dwarfs : b?.major_asteroids;
    const astData = src?.[view.asteroidIdx];
    crumbs.push({
      label: astData?.name || `Asteroid ${view.asteroidIdx}`,
      icon: '☄',
      target: { depth: 'asteroid', planetIdx: 0, beltIdx: view.beltIdx, asteroidIdx: view.asteroidIdx, asteroidSource: view.asteroidSource },
    });
  }

  if (crumbs.length <= 1) return null; // no breadcrumb at top level

  return (
    <div className="sf-overlay-crumb">
      <div className="sf-crumb">
        {crumbs.map((c, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="sf-crumb-sep">›</span>}
            <button
              className={`sf-crumb-item${i === crumbs.length - 1 ? ' current' : ''}`}
              onClick={() => onNavigate(c.target)}
              disabled={i === crumbs.length - 1}
            >
              <span className="sf-crumb-icon">{c.icon}</span>
              {c.label}
            </button>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

/* ━━ Biome Info Panel ━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

function ResourceBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
      <span style={{ width: 52, color: '#6a8fa8', fontSize: 10, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: 4, background: '#0e1a2a', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${Math.round(value * 100)}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 0.3s' }} />
      </div>
      <span style={{ width: 26, color: '#7ab', fontSize: 10, textAlign: 'right' }}>{Math.round(value * 100)}%</span>
    </div>
  );
}

function BiomeInfoPanel({ biome, onClose }: { biome: BiomeInfo; onClose: () => void }) {
  return (
    <div style={{
      position: 'absolute', bottom: 72, right: 16, width: 274,
      background: 'rgba(6,12,22,0.94)', border: '1px solid rgba(80,160,255,0.28)',
      borderRadius: 8, padding: '14px 16px', color: '#cfe0f2',
      fontFamily: '"Courier New", monospace', fontSize: 12,
      backdropFilter: 'blur(10px)', zIndex: 60,
      boxShadow: '0 4px 28px rgba(0,0,0,0.7)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 22, lineHeight: 1 }}>{biome.icon}</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#90c8ff', letterSpacing: '0.02em' }}>{biome.name}</div>
            <div style={{ fontSize: 10, color: '#5a7a96', marginTop: 1 }}>{biome.climate} · {biome.geology}</div>
          </div>
        </div>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: '#446', cursor: 'pointer', fontSize: 18, padding: '0 2px', lineHeight: 1 }}
        >×</button>
      </div>
      {/* Description */}
      <div style={{ lineHeight: 1.55, color: '#8aaabb', marginBottom: 12, fontSize: 11 }}>{biome.description}</div>
      {/* Resources */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 10, color: '#4a6a7a', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Resources</div>
        <ResourceBar label="Water"    value={biome.resources.water}    color="#3399cc" />
        <ResourceBar label="Minerals" value={biome.resources.minerals} color="#cc7733" />
        <ResourceBar label="Energy"   value={biome.resources.energy}   color="#cccc33" />
        <ResourceBar label="Organics" value={biome.resources.organics} color="#44aa55" />
      </div>
      {/* Habitability */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 10, color: '#4a6a7a', textTransform: 'uppercase', letterSpacing: '0.08em', flexShrink: 0 }}>Habitability</span>
        <div style={{ flex: 1, height: 6, background: '#0e1a2a', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{
            width: `${biome.habitability * 10}%`, height: '100%', borderRadius: 3, transition: 'width 0.3s',
            background: `hsl(${biome.habitability * 12}, 68%, 48%)`,
          }} />
        </div>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#90c8ff', flexShrink: 0 }}>{biome.habitability}/10</span>
      </div>
    </div>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   MAIN COMPONENT
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

export function SystemFocusView({ systemId, gpu, onBack }: Props) {
  const [systemData, setSystemData] = useState<any>(null);
  const [view, setView] = useState<ViewState>({ depth: 'system', planetIdx: 0 });
  const [texturesV2, setTexturesV2] = useState<PlanetTexturesV2 | null>(null);
  const [texStatus, setTexStatus] = useState<'idle' | 'loading' | 'done' | 'failed'>('idle');
  const [usePBR, setUsePBR] = useState(false);
  const [scienceOpen, setScienceOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<ScienceTab>('editor');
  const [regenCounter, setRegenCounter] = useState(0);
  const [orbitSpeed, setOrbitSpeed] = useState(1.0);
  const [showTemp, setShowTemp] = useState(false);
  const [showRad, setShowRad] = useState(false);
  const [orreryScale, setOrreryScale] = useState(0.65);
  const [mapMenuOpen, setMapMenuOpen] = useState(false);
  const [showPlanetTempMap, setShowPlanetTempMap] = useState(false);
  const [showPlanetMineralMap, setShowPlanetMineralMap] = useState(false);
  /* ── Colony builder state ── */
  // Per-world building storage: keyed by "p{planetIdx}" or "p{planetIdx}-m{moonIdx}"
  const [colonyBuildingsMap, setColonyBuildingsMap] = useState<Record<string, ColonyBuilding[]>>({});
  const [buildMode, setBuildMode] = useState(false);
  const [adminMode, setAdminMode] = useState(false);
  const [showRoads, setShowRoads] = useState(true);
  const [showZones, setShowZones] = useState(true);
  const [selectedBuildingType, setSelectedBuildingType] = useState<BuildingType>('dome');
  const [customModelUrl, setCustomModelUrl] = useState<string | null>(null);
  const [customModelName, setCustomModelName] = useState<string>('Custom');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const colonyIdCounter = useRef(0);
  /* ── Biome selection ── */
  const [selectedBiome, setSelectedBiome] = useState<BiomeInfo | null>(null);

  /* ── Ship state ── */
  const [shipsMap, setShipsMap] = useState<Record<string, Ship[]>>({});
  const [shipMode, setShipMode] = useState(false);
  const [selectedShipId, setSelectedShipId] = useState<string | null>(null);
  const shipIdCounter = useRef(0);

  const science = useScience();
  const campaign = useCampaign();

  // Current world key for building storage
  const worldKey = useMemo(() => {
    if (view.depth === 'moon' && view.moonIdx != null)
      return `p${view.planetIdx}-m${view.moonIdx}`;
    return `p${view.planetIdx}`;
  }, [view.depth, view.planetIdx, view.moonIdx]);

  // Current world's buildings (derived from map)
  const colonyBuildings = colonyBuildingsMap[worldKey] || [];

  /* ── Colony handlers ── */
  const handleColonyPlace = useCallback((lat: number, lon: number) => {
    colonyIdCounter.current += 1;
    const newBuilding: ColonyBuilding = {
      id: `b-${colonyIdCounter.current}`,
      lat, lon,
      type: selectedBuildingType,
      ...(selectedBuildingType === 'custom' && customModelUrl ? {
        modelUrl: customModelUrl,
        modelName: customModelName,
        customScale: 1.0,
      } : {}),
    };
    setColonyBuildingsMap(prev => ({
      ...prev,
      [worldKey]: [...(prev[worldKey] || []), newBuilding],
    }));
  }, [selectedBuildingType, customModelUrl, customModelName, worldKey]);

  const handleColonyRemove = useCallback((id: string) => {
    setColonyBuildingsMap(prev => ({
      ...prev,
      [worldKey]: (prev[worldKey] || []).filter(b => b.id !== id),
    }));
  }, [worldKey]);

  const handleGLBImport = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setCustomModelUrl(url);
    setCustomModelName(file.name.replace(/\.(glb|gltf)$/i, ''));
    setSelectedBuildingType('custom');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  // Current world's ships
  const ships = shipsMap[worldKey] || [];

  // Ship placement handler
  const handleShipPlace = useCallback((lat: number, lon: number) => {
    shipIdCounter.current += 1;
    const newShip: Ship = {
      id: `ship-${shipIdCounter.current}`,
      lat, lon,
      progress: 0,
      speed: 2.0,
      name: `Ship ${shipIdCounter.current}`,
    };
    setShipsMap(prev => ({
      ...prev,
      [worldKey]: [...(prev[worldKey] || []), newShip],
    }));
  }, [worldKey]);

  // Ship command handler — sets movement destination
  const handleShipCommand = useCallback((shipId: string, toLat: number, toLon: number) => {
    setShipsMap(prev => {
      const worldShips = prev[worldKey] || [];
      return {
        ...prev,
        [worldKey]: worldShips.map(s =>
          s.id === shipId
            ? { ...s, targetLat: toLat, targetLon: toLon, progress: 0 }
            : s
        ),
      };
    });
  }, [worldKey]);

  // Ship select handler
  const handleShipSelect = useCallback((shipId: string) => {
    setSelectedShipId(prev => prev === shipId ? null : shipId);
  }, []);

  // Ship movement tick — advance all moving ships toward their destination
  useEffect(() => {
    const interval = setInterval(() => {
      setShipsMap(prev => {
        const worldShips = prev[worldKey];
        if (!worldShips || worldShips.length === 0) return prev;
        let changed = false;
        const updated = worldShips.map(s => {
          if (s.targetLat == null || s.targetLon == null) return s;
          const dLat = s.targetLat - s.lat;
          const dLon = s.targetLon - s.lon;
          const totalDist = Math.sqrt(dLat * dLat + dLon * dLon) || 0.001;
          const step = (s.speed * 0.05) / totalDist;
          const newProgress = Math.min(s.progress + step, 1.0);
          changed = true;
          if (newProgress >= 1.0) {
            return { ...s, lat: s.targetLat, lon: s.targetLon,
                     targetLat: undefined, targetLon: undefined, progress: 0 };
          }
          return { ...s,
            lat: s.lat + dLat * step,
            lon: s.lon + dLon * step,
            progress: newProgress,
          };
        });
        if (!changed) return prev;
        return { ...prev, [worldKey]: updated };
      });
    }, 50);
    return () => clearInterval(interval);
  }, [worldKey]);

  // Exit build/ship mode when leaving colonizable depth
  useEffect(() => {
    if (view.depth !== 'planet' && view.depth !== 'moon') {
      setBuildMode(false);
      setShipMode(false);
      setSelectedShipId(null);
    }
  }, [view.depth]);

  /* ── Fetch system data ──
   * Priority: live API → bundled static data → Tauri cache */
  useEffect(() => {
    let dead = false;
    (async () => {
      // 1. Try live API
      try {
        const r = await fetch(`/api/system/${encodeURIComponent(systemId)}`);
        if (r.ok) {
          const d = await r.json();
          if (!dead && d?.star) {
            console.info(`[Focus] Loaded ${systemId} from API – ${d.planets?.length ?? 0} planets`);
            setSystemData(d);
            return;
          }
        }
      } catch (e) {
        console.warn('[Focus] API fetch failed:', e);
      }

      // 2. Try bundled static detail data (public/data/systemDetails.json)
      try {
        const r2 = await fetch('/data/systemDetails.json');
        if (r2.ok) {
          const allDetails = await r2.json();
          const detail = allDetails[systemId];
          if (!dead && detail) {
            const planets = detail.planets ?? [];
            const belts = detail.belts ?? [];
            // Look up real star metadata from bundled systems list
            const starMeta = (bundledSystems as any[]).find((s: any) => s.main_id === systemId);
            const lum = starMeta?.luminosity ?? 1.0;
            const star = starMeta
              ? { ...starMeta }
              : { main_id: systemId, spectral_class: 'G', teff: 5600, luminosity: lum };
            console.info(`[Focus] Loaded ${systemId} from bundled data – ${planets.length} planets`);
            setSystemData({
              star,
              planets,
              belts,
              habitable_zone: { inner_au: Math.sqrt(lum) * 0.95, outer_au: Math.sqrt(lum) * 1.37 },
              summary: {
                total_planets: planets.length,
                total_belts: belts.length,
                observed_planets: planets.filter((p: any) => p.confidence === 'observed').length,
                inferred_planets: planets.filter((p: any) => p.confidence === 'inferred').length,
              },
            });
            return;
          }
        }
      } catch (e2) {
        console.warn('[Focus] Bundled data fetch failed:', e2);
      }

      // 3. Try Tauri SQLite cache
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const cached = await invoke<{ data_json: string } | null>('get_cached_system', { mainId: systemId });
        if (!dead && cached?.data_json) {
          const d = JSON.parse(cached.data_json);
          console.info(`[Focus] Loaded ${systemId} from Tauri cache`);
          setSystemData(d);
          return;
        }
      } catch (e3) {
        // Tauri API may not be available in browser-only mode
      }

      if (!dead) console.error(`[Focus] No data source available for ${systemId}`);
    })();
    return () => { dead = true; };
  }, [systemId]);

  /* ── Texture generation for planet depth ── */
  useEffect(() => {
    if (view.depth !== 'planet') return;
    if (!systemData?.planets?.length) return;
    const p = systemData.planets[view.planetIdx];
    if (!p) return;

    const mass = p.mass_earth ?? p.pl_bmasse ?? 1;
    const radius = p.radius_earth ?? p.pl_rade ?? 1;
    const sma = p.semi_major_axis_au ?? p.pl_orbsmax ?? 1;
    const ecc = p.eccentricity ?? p.pl_orbeccen ?? 0;
    const starTeff = systemData.star?.teff ?? 5778;
    const starLum = systemData.star?.luminosity ?? 1;
    const ptype = p.planet_type || 'rocky';

    let dead = false;
    setTexStatus('loading');
    setTexturesV2(null);
    setUsePBR(false);

    (async () => {
      try {
        const result = await gpu.generatePlanetV2({
          system_id: systemId, planet_index: view.planetIdx,
          mass_earth: mass, radius_earth: radius,
          semi_major_axis_au: sma, eccentricity: ecc,
          star_teff: starTeff, star_luminosity: starLum,
          planet_type: ptype,
          temperature_k: p.temp_calculated_k ?? 288,
          in_habitable_zone: (p.sub_type_flags || []).includes('habitable_zone'),
          texture_resolution: 512,
        });
        if (!dead) { setTexturesV2(result); setTexStatus('done'); }
      } catch { if (!dead) setTexStatus('failed'); }
    })();

    if (mass && radius && sma && starLum && starTeff) {
      science.computeAll({
        mass_earth: mass, radius_earth: radius, sma_au: sma,
        eccentricity: ecc, star_luminosity: starLum, star_teff: starTeff,
        planet_type: ptype,
      }).catch(() => {});
    }
    return () => { dead = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systemData, view.planetIdx, view.depth, regenCounter]);

  /* ── Navigation handlers ── */
  const handleDrillPlanet = useCallback((idx: number) => {
    setView({ depth: 'planet', planetIdx: idx });
    setScienceOpen(false);
    setSelectedBiome(null);
  }, []);

  const handleDrillMoon = useCallback((moonIdx: number) => {
    setView(prev => ({ depth: 'moon', planetIdx: prev.planetIdx, moonIdx }));
    setScienceOpen(false);
    setSelectedBiome(null);
  }, []);

  const handleDrillBelt = useCallback((beltIdx: number) => {
    setView({ depth: 'belt', planetIdx: 0, beltIdx });
    setScienceOpen(false);
  }, []);

  const handleDrillAsteroid = useCallback((beltIdx: number, asteroidIdx: number, source: 'major' | 'ice_dwarf') => {
    setView({ depth: 'asteroid', planetIdx: 0, beltIdx, asteroidIdx, asteroidSource: source });
    setScienceOpen(false);
  }, []);

  const handleNavigate = useCallback((v: ViewState) => {
    setView(v);
    setScienceOpen(false);
  }, []);

  /* ── Derived data ── */
  const planets = systemData?.planets ?? [];
  const belts = systemData?.belts ?? [];
  const starColor = STAR_COLOR[systemData?.star?.spectral_class?.[0]] ?? '#ffcc44';
  const starSpec = systemData?.star?.spectral_class || 'G';
  const hz = systemData?.habitable_zone;
  const arch = systemData?.architecture;

  const curPlanet = planets[view.planetIdx];
  const curMoon = view.depth === 'moon' ? curPlanet?.moons?.[view.moonIdx!] : null;
  const curBelt = view.depth === 'belt' ? belts[view.beltIdx!] : null;

  const minPeriod = useMemo(() =>
    Math.min(...planets.map((p: any) => p.orbital_period_days ?? p.pl_orbper ?? 365), 365),
    [planets]
  );
  const maxSma = useMemo(() =>
    Math.max(...planets.map((p: any) => p.semi_major_axis_au ?? p.pl_orbsmax ?? 1), 1),
    [planets]
  );

  // Moon orbit scaling (planet depth) — also needed for moon depth backdrop
  const moonOrbitData = useMemo(() => {
    if (!curPlanet?.moons?.length) return null;
    if (view.depth !== 'planet' && view.depth !== 'moon') return null;
    const moons = curPlanet.moons;
    const maxAU = Math.max(...moons.map((m: any) => m.orbital_radius_au || 0.005), 0.001);
    const maxRingR = Math.max(
      ...(curPlanet.ring_system?.rings?.map((r: any) => (r.outer_radius_re || 0) * 0.1) || [0]), 1.3
    );
    const minR = maxRingR + 0.4;
    return { maxAU, minR };
  }, [view.depth, curPlanet]);

  // Globe rendering — resolve Venus-type for thick atmosphere worlds
  const resolveVenusType = (p: any) => {
    const raw = p?.planet_type || 'rocky';
    const flags: string[] = p?.sub_type_flags || [];
    return (raw === 'rocky' && flags.includes('thick_atmosphere') && flags.includes('greenhouse_runaway'))
      ? 'venus' : raw;
  };
  const globeType = view.depth === 'moon'
    ? (curMoon ? pickMoonProfile(curMoon, view.moonIdx ?? 0) : 'moon-cratered')
    : resolveVenusType(curPlanet);
  const globeTemp = view.depth === 'moon'
    ? (MOON_TEMP[curMoon?.moon_type] || 150)
    : (curPlanet?.temp_calculated_k ?? 288);
  const globeSeed = view.depth === 'moon'
    ? moonSeed(curMoon, view.planetIdx, view.moonIdx ?? 0)
    : hashStr(curPlanet?.planet_name || `${systemId}-${view.planetIdx}`);

  const showPBR = usePBR && texturesV2 && view.depth === 'planet';
  const isSystemExplored = campaign.isExplored(systemId);

  // ── Terrain params for colony overlay (planets + moons) ──
  const terrainParams: TerrainParams | undefined = useMemo(() => {
    if (view.depth !== 'planet' && view.depth !== 'moon') return undefined;
    const profile = PlanetProfiles[globeType] || PlanetProfiles['rocky'];
    const tp = view.depth === 'moon' ? curMoon : curPlanet;
    const vis = deriveWorldVisuals(profile, {
      temperature: globeTemp,
      mass: tp?.mass_earth,
      tidalHeating: tp?.tidal_heating,
      starSpectralClass: starSpec,
    });
    // Apply same seed-based ocean diversity as ProceduralPlanet
    let oLevel = vis.oceanLevel;
    if (oLevel > 0.1 && oLevel < 0.95 && globeSeed) {
      const variation = Math.sin(globeSeed * 127.1 + 37.7) * 0.5 + 0.5;
      oLevel = Math.max(0.15, Math.min(0.93, oLevel + (variation - 0.5) * 0.35));
    }
    let mtnH = vis.mountainHeight || 0;
    if (mtnH > 0.02 && globeSeed) {
      mtnH *= 0.55 + (Math.sin(globeSeed * 211.3 + 19.1) * 0.5 + 0.5) * 0.9;
    }
    let valD = vis.valleyDepth || 0;
    if (valD > 0.02 && globeSeed) {
      valD *= 0.5 + (Math.sin(globeSeed * 53.7 + 88.3) * 0.5 + 0.5) * 1.0;
    }
    return {
      seed: globeSeed,
      noiseScale: vis.noiseScale,
      oceanLevel: oLevel,
      mountainHeight: mtnH,
      valleyDepth: valD,
      volcanism: vis.volcanism || 0,
    };
  }, [view.depth, globeType, globeTemp, globeSeed, curPlanet, curMoon, starSpec]);

  const TABS: { id: ScienceTab; label: string }[] = [
    { id: 'editor', label: 'Editor' }, { id: 'composition', label: 'Composition' },
    { id: 'atm-v2', label: 'Atmosphere' }, { id: 'interior', label: 'Interior' },
    { id: 'climate', label: 'Climate' }, { id: 'atmosphere', label: 'Atm (basic)' },
    { id: 'models', label: 'Models' },
  ];

  /* ════════════════════════ Render ═════════════════════════ */
  return (
    <div className="sf">
      {/* ═══ Header Bar ═══ */}
      <div className="sf-header">
        <button className="sf-back" onClick={onBack}>← Map</button>
        <h2 className="sf-title">{systemData?.star?.main_id ?? systemId}</h2>
        {systemData?.star?.spectral_class && (
          <span className="sf-badge" style={{ background: starColor, color: '#0a0e17' }}>
            {systemData.star.spectral_class}
          </span>
        )}
        {arch && <span className="sf-badge sf-arch">{arch.class}</span>}
        {systemData?.star?.distance_ly != null && (
          <span className="sf-dim">{systemData.star.distance_ly.toFixed(1)} ly</span>
        )}
        <span className="sf-dim">{planets.length} planet{planets.length !== 1 ? 's' : ''}</span>
        {belts.length > 0 && <span className="sf-dim">{belts.length} belt{belts.length !== 1 ? 's' : ''}</span>}
        <div style={{ flex: 1 }} />
        <div className="sf-speed">
          {[0, 0.25, 0.5, 1, 2, 4].map(s => (
            <button key={s}
              className={`sf-speed-btn${orbitSpeed === s ? ' active' : ''}`}
              onClick={() => { _orbit.speed = s; setOrbitSpeed(s); }}>
              {s === 0 ? '⏸' : s < 1 ? `${s}×` : `${s}×`}
            </button>
          ))}
        </div>

        {/* ── Map Controls submenu ── */}
        <div className="sf-map-controls">
          <button className={`sf-map-toggle${mapMenuOpen ? ' active' : ''}`}
            onClick={() => setMapMenuOpen(!mapMenuOpen)}>
            ⚙ Map
          </button>
          {mapMenuOpen && (
            <div className="sf-map-menu">
              <div className="sf-map-menu-row">
                <button className={`sf-map-btn${showTemp ? ' active' : ''}`}
                  onClick={() => setShowTemp(!showTemp)}>
                  🌡 Temp
                </button>
                <button className={`sf-map-btn${showRad ? ' active' : ''}`}
                  onClick={() => setShowRad(!showRad)}>
                  ☢ RAD
                </button>
              </div>
              {(view.depth === 'planet' || view.depth === 'moon') && (
                <div className="sf-map-menu-row">
                  <button className={`sf-map-btn sf-map-btn-planet${showPlanetTempMap ? ' active' : ''}`}
                    onClick={() => { setShowPlanetTempMap(!showPlanetTempMap); setShowPlanetMineralMap(false); }}>
                    🌡 Surface Temp
                  </button>
                  <button className={`sf-map-btn sf-map-btn-planet${showPlanetMineralMap ? ' active' : ''}`}
                    onClick={() => { setShowPlanetMineralMap(!showPlanetMineralMap); setShowPlanetTempMap(false); }}>
                    ⛏ Minerals
                  </button>
                </div>
              )}
              <div className="sf-map-menu-row">
                <label className="sf-map-slider-label">
                  Scale: {orreryScale.toFixed(2)}
                </label>
                <input type="range" className="sf-map-slider"
                  min={0.3} max={1.2} step={0.05}
                  value={orreryScale}
                  onChange={(e) => setOrreryScale(parseFloat(e.target.value))} />
              </div>
  {/* ── Ship controls ── */}
            <button
              className={`sf-colony-toggle${shipMode ? ' active' : ''}`}
              onClick={() => { setShipMode(!shipMode); if (!shipMode) setBuildMode(false); }}
              style={{ marginTop: 4 }}
            >
              {shipMode ? '✕ Exit Navy' : '⚓ Navy'}
            </button>
            {shipMode && (
              <div className="sf-colony-toggles" style={{ fontSize: '0.72rem', opacity: 0.8 }}>
                {selectedShipId
                  ? <span>Click water to move <b>{ships.find(s => s.id === selectedShipId)?.name || 'ship'}</b></span>
                  : <span>Click water to place ship, or click a ship to select</span>}
              </div>
            )}
            {ships.length > 0 && (
              <span className="sf-colony-count">
                {ships.length} ship{ships.length !== 1 ? 's' : ''}
                {ships.some(s => s.targetLat != null) && (
                  <span style={{ color: '#44ddff', marginLeft: 4, fontSize: '0.7rem' }}>⛵ moving</span>
                )}
                <button className="sf-colony-clear"
                  onClick={() => { setShipsMap(prev => ({ ...prev, [worldKey]: [] })); setSelectedShipId(null); }}
                  title="Clear all ships on this world"
                >🗑</button>
              </span>
            )}
          
            </div>
          )}
        </div>
        {/* ── Colony Builder (planet + moon depth) ── */}
        {(view.depth === 'planet' || view.depth === 'moon') && (
          <div className="sf-colony-controls">
            <button
              className={`sf-colony-toggle${buildMode ? ' active' : ''}`}
              onClick={() => setBuildMode(!buildMode)}
            >
              {buildMode ? '✕ Exit Build' : '🏗 Colony'}
            </button>
            {buildMode && (
              <div className="sf-colony-types">
                {(['dome', 'tower', 'mine', 'pad'] as BuildingType[]).map(bt => (
                  <button key={bt}
                    className={`sf-colony-type-btn${selectedBuildingType === bt ? ' active' : ''}`}
                    onClick={() => setSelectedBuildingType(bt)}
                    title={bt.charAt(0).toUpperCase() + bt.slice(1)}
                  >
                    {bt === 'dome'  ? '🏠' :
                     bt === 'tower' ? '📡' :
                     bt === 'mine'  ? '⛏'  : '🛬'}
                  </button>
                ))}
                {/* Admin mode: import GLB */}
                {adminMode && (
                  <>
                    <button
                      className={`sf-colony-type-btn${selectedBuildingType === 'custom' ? ' active' : ''}`}
                      onClick={() => fileInputRef.current?.click()}
                      title="Import .GLB model"
                    >📦</button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".glb,.gltf"
                      style={{ display: 'none' }}
                      onChange={handleGLBImport}
                    />
                  </>
                )}
                {selectedBuildingType === 'custom' && customModelName && (
                  <span className="sf-colony-custom-name" title={customModelName}>
                    {customModelName.length > 12 ? customModelName.slice(0, 12) + '…' : customModelName}
                  </span>
                )}
              </div>
            )}
            {buildMode && (
              <div className="sf-colony-toggles">
                <button
                  className={`sf-colony-mini-btn${adminMode ? ' active' : ''}`}
                  onClick={() => setAdminMode(!adminMode)}
                  title="Admin mode — import custom GLB models"
                >⚙</button>
                <button
                  className={`sf-colony-mini-btn${showRoads ? ' active' : ''}`}
                  onClick={() => setShowRoads(!showRoads)}
                  title="Toggle roads between buildings"
                >🛤</button>
                <button
                  className={`sf-colony-mini-btn${showZones ? ' active' : ''}`}
                  onClick={() => setShowZones(!showZones)}
                  title="Toggle zones of control"
                >🏴</button>
              </div>
            )}
            {colonyBuildings.length > 0 && (
              <span className="sf-colony-count">
                {colonyBuildings.length} bldg{colonyBuildings.length !== 1 ? 's' : ''}
                <button className="sf-colony-clear"
                  onClick={() => setColonyBuildingsMap(prev => ({ ...prev, [worldKey]: [] }))}
                  title="Clear all buildings on this world"
                >🗑</button>
              </span>
            )}
          </div>
        )}
        {campaign.activeCampaign && !isSystemExplored && (
          <button className="sf-explore" onClick={() => campaign.exploreSystem(systemId)}>⬡ Explore</button>
        )}
        {campaign.activeCampaign && isSystemExplored && (
          <span className="sf-explored">✓ Explored</span>
        )}
        {campaign.devMode && (
          <button className="sf-dev-btn" onClick={() => {
            setTexturesV2(null); setTexStatus('idle'); setUsePBR(false);
            setRegenCounter(c => c + 1);
          }}>↻ Regen</button>
        )}
      </div>

      {/* ═══ Full Viewport ═══ */}
      <div className="sf-viewport">

        {/* ── 3D Canvas (ALWAYS mounted — never destroyed) ── */}
        <div className="sf-canvas-wrap">
          <ErrorBoundary label="Orrery">
            <Canvas camera={{ position: [0, 8, 14], fov: 45 }}
              gl={{ antialias: true, alpha: false }}
              style={{ background: '#020408' }}>
              <Suspense fallback={null}>
                <OrbitClock />
                <SmoothCamera depth={view.depth} />
                <Starfield />

                {/* ═══ SYSTEM DEPTH ═══ */}
                <group visible={view.depth === 'system'}>
                    <OrreryStar color={starColor} size={starVisRadius(systemData?.star?.luminosity ?? 1)} teff={systemData?.star?.teff} />
                    <pointLight position={[0, 0, 0]} intensity={3} color={starColor} distance={40} />
                    {/* Hemisphere light: star tint above, deep space blue below */}
                    <hemisphereLight args={[starColor, '#040810', 0.04]} />

                    {hz && <HabitableZone inner={hz.inner_au} outer={hz.outer_au}
                      starVisR={STAR_VIS_R} maxSma={maxSma} />}

                    {showTemp && systemData?.star && (
                      <TemperatureZone
                        starTeff={systemData.star.teff || 5778}
                        starLum={systemData.star.luminosity || 1}
                        starVisR={STAR_VIS_R}
                        maxSma={maxSma}
                      />
                    )}

                    {showRad && systemData?.star && (
                      <RadiationZone
                        starLum={systemData.star.luminosity || 1}
                        starVisR={STAR_VIS_R}
                        maxSma={maxSma}
                      />
                    )}

                    {(showTemp || showRad) && systemData?.star && (
                      <FrostLine
                        starLum={systemData.star.luminosity || 1}
                        starVisR={STAR_VIS_R}
                        maxSma={maxSma}
                      />
                    )}

                    {belts.map((b: any, i: number) => (
                      <React.Fragment key={`belt-${i}`}>
                        <BeltParticles belt={b}
                          starVisR={STAR_VIS_R} maxSma={maxSma} />
                        <BeltAsteroids belt={b}
                          starVisR={STAR_VIS_R} maxSma={maxSma} />
                      </React.Fragment>
                    ))}

                    {planets.map((p: any, i: number) => {
                      const sma = p.semi_major_axis_au ?? p.pl_orbsmax ?? (0.5 + i * 0.8);
                      const oR = logOrbitRadius(sma, STAR_VIS_R, maxSma);
                      const period = p.orbital_period_days ?? p.pl_orbper ?? (10 + i * 8);
                      const vp = vizPeriod(period, minPeriod);
                      // Venus-type detection: rocky + thick_atmosphere + greenhouse_runaway
                      const rawType = p.planet_type || 'rocky';
                      const flags: string[] = p.sub_type_flags || [];
                      const ptype = (rawType === 'rocky' && flags.includes('thick_atmosphere') && flags.includes('greenhouse_runaway'))
                        ? 'venus' : rawType;
                      const pr = Math.max(0.08, Math.min(0.35, (p.radius_earth ?? p.pl_rade ?? 1) * 0.08)) * orreryScale;
                      const pc = PT_COLOR[ptype] || '#aaa';
                      const isActive = i === view.planetIdx && view.depth !== 'system';
                      return (
                        <group key={`planet-${i}`}>
                          <mesh rotation={[-Math.PI / 2, 0, 0]}>
                            <ringGeometry args={[oR - 0.015, oR + 0.015, 80]} />
                            <meshBasicMaterial
                              color={isActive ? '#4d9fff' : '#3a5a8a'}
                              transparent opacity={isActive ? 0.7 : 0.35}
                              depthWrite={false} />
                          </mesh>
                          <OrreryBody
                            orbitR={oR} r={pr} color={pc}
                            active={isActive}
                            vizPrd={vp}
                            startAngle={i * 1.3}
                            onClick={() => handleDrillPlanet(i)}
                            label={shortName(p.planet_name, i)}
                            ringSystem={p.ring_system}
                            moonHints={p.moons?.map((m: any) => ({
                              color: MOON_COLOR[m.moon_type] || '#888',
                            }))}
                            planetType={ptype}
                            planetSeed={hashStr(p.planet_name || `planet-${i}`)}
                            temperature={p.temp_calculated_k ?? 288}
                            mass={p.mass_earth}
                            starSpectralClass={starSpec}
                          />
                        </group>
                      );
                    })}
                </group>

                {/* ═══ PLANET DEPTH — planet at center, moons orbit ═══ */}
                <group visible={view.depth === 'planet'}>
                  {/* Lighting: star-colored key + hemisphere fill */}
                  <directionalLight position={[-1, 0.5, 0.5]} intensity={1.4} color={starColor} />
                  <hemisphereLight args={[starColor, '#020408', 0.02]} />
                  {/* Planetshine — colored reflected light from parent onto moons */}
                  {curPlanet && (() => {
                    const ps = planetShineFromType(curPlanet.planet_type);
                    const psHex = '#' + [ps[0], ps[1], ps[2]].map(
                      v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
                    return <pointLight position={[0, 0, 0]} intensity={0.6} color={psHex} distance={12} />;
                  })()}
                  {curPlanet && (<>
                    <RotatingSurfaceGroup rotationSpeed={curPlanet?.rotation_period_days
                      ? 0.04 * (1.0 / Math.max(curPlanet.rotation_period_days, 0.1))
                      : 0.04}>
                    {showPBR ? (
                      <PlanetSurfaceV2 textures={texturesV2!}
                        sunDirection={[-1, 0.5, 0.5]}
                        starTeff={systemData?.star?.teff ?? 5778}
                        starLuminosity={systemData?.star?.luminosity ?? 1}
                        radius={1} resolution={32} />
                    ) : (
                      <LODPlanet
                        planetType={globeType}
                        temperature={globeTemp}
                        seed={globeSeed}
                        sunDirection={[-1, 0.5, 0.5]}
                        rotationSpeed={0}
                        mass={curPlanet?.mass_earth}
                        tidalHeating={0}
                        starSpectralClass={starSpec}
                        tidallyLocked={!!curPlanet?.tidally_locked}
                        spinOrbit32={curPlanet?.spin_orbit_resonance === '3:2'}
                        showTempMap={showPlanetTempMap}
                        showMineralMap={showPlanetMineralMap}
                        tempDistribution={curPlanet?.temp_distribution}
                        mineralAbundance={curPlanet?.mineral_abundance}
                        axialTilt={curPlanet?.axial_tilt ?? 0}
                        baseScale={(() => {
                          const re = curPlanet?.radius_earth || 1;
                          return 0.7 + Math.min(Math.log2(1 + re) * 0.25, 0.5);
                        })()}
                        onBiomeClick={(biome) => setSelectedBiome(biome)}
                      />
                    )}

                    {/* Colony buildings on planet surface */}
                    <ColonyOverlay
                      buildings={colonyBuildings}
                      ships={ships}
                      buildMode={buildMode && view.depth === 'planet'}
                      shipMode={shipMode && view.depth === 'planet'}
                      selectedShipId={selectedShipId}
                      selectedType={selectedBuildingType}
                      planetRadius={(() => {
                        const re = curPlanet?.radius_earth || 1;
                        return 0.7 + Math.min(Math.log2(1 + re) * 0.25, 0.5);
                      })()}
                      rotationSpeed={0}
                      showRoads={showRoads}
                      showZones={showZones}
                      terrainParams={terrainParams}
                      onPlace={handleColonyPlace}
                      onRemove={handleColonyRemove}
                      onShipPlace={handleShipPlace}
                      onShipCommand={handleShipCommand}
                      onShipSelect={handleShipSelect}
                    />
                    </RotatingSurfaceGroup>

                    {curPlanet.ring_system?.rings?.length > 0 && (
                      <RingParticles rings={curPlanet.ring_system.rings}
                        tilt={Math.sin((globeSeed || 0) * 47.3) * 0.15} />
                    )}

                    {(() => {
                      if (!moonOrbitData || !curPlanet.moons?.length) return null;
                      // Tidally locked worlds: strip moons (Roche limit / astrodynamics)
                      // Only allow tiny captured irregulars if tidal locked
                      const isTidalLocked = !!curPlanet.tidally_locked;
                      const filteredMoons: any[] = isTidalLocked
                        ? curPlanet.moons.filter((m: any) =>
                            m.moon_type === 'captured-irregular' && (m.radius_earth || 0) < 0.003)
                        : curPlanet.moons;
                      if (!filteredMoons.length) return null;
                      const moonOrbits = layoutMoonOrbits(filteredMoons, moonOrbitData.minR, moonOrbitData.maxAU);
                      const moonRadii = filteredMoons.map((mm: any) => mm.radius_earth || 0.005);
                      const maxMoonRad = Math.max(...moonRadii);
                      // Find original index for each filtered moon
                      const origIndices = filteredMoons.map((m: any) =>
                        curPlanet.moons.indexOf(m));
                      return filteredMoons.map((m: any, fi: number) => {
                      const mi = origIndices[fi];
                      const oR = moonOrbits[fi];

                      const relR = (m.radius_earth || 0.005) / maxMoonRad;
                      const moonR = 0.02 + relR * 0.14;

                      // Potato moon detection: very small bodies (< 50km radius equivalent)
                      const isPotato = (m.radius_earth || 0) < 0.008;

                      // Keplerian period: use orbital_radius_au for period estimate if no data
                      const auOrb = m.orbital_radius_au || 0.001;
                      const estPeriodDays = m.orbital_period_days || Math.pow(auOrb / 0.001, 1.5) * 1.5;
                      const minMoonPeriod = Math.min(...curPlanet.moons.map((mm: any) =>
                        mm.orbital_period_days || Math.pow((mm.orbital_radius_au || 0.001) / 0.001, 1.5) * 1.5
                      ));
                      const period = vizPeriod(estPeriodDays, minMoonPeriod);

                      const moonName = m.moon_name?.split(' ').pop() || `moon-${mi}`;
                      const mType = pickMoonProfile(m, mi);
                      const mSeed = moonSeed(m, view.planetIdx, mi);
                      const mShift = moonColorShift(m, mi);
                      const isActive = view.depth === 'moon' && view.moonIdx === mi;

                      // ── Potato moon visual diversity ──
                      // Deform style from flags
                      const moonFlags: string[] = m.sub_type_flags || [];
                      const potatoDeform: 'generic' | 'miranda' | 'hyperion' | 'eros' =
                        moonFlags.includes('chevron_terrain') || moonFlags.includes('coronae') ? 'miranda' :
                        moonFlags.includes('spongy_pitted') || m.moon_type === 'captured-irregular' && (m.mass_earth || 0) < 0.0003 ? 'hyperion' :
                        moonFlags.includes('elongated') || moonFlags.includes('contact_binary') ? 'eros' :
                        'generic';
                      // Potato color: two-tone based on moon type/profile
                      const potatoColors = isPotato ? pickPotatoColors(m, mType) : undefined;

                      // Atmosphere detection (Titan, etc.)
                      const hasMoonAtm = moonFlags.includes('thick_haze') ||
                        moonFlags.includes('dense_atmosphere') ||
                        m.moon_type === 'atmosphere-moon' ||
                        m.moon_type === 'terrestrial-like';
                      const moonAtmColor = m.moon_type === 'terrestrial-like' ? '#cc8844' :
                        m.moon_type === 'atmosphere-moon' ? '#cc8844' : '#7799bb';

                      return (
                        <group key={`moon-${mi}`}>
                          <MoonOrbitLine radius={oR} active={isActive} />
                          <OrbitingMoon
                            orbitR={oR} r={moonR}
                            vizPrd={period} startAngle={mi * 2.1 + mSeed * 4.0}
                            active={isActive}
                            onClick={() => handleDrillMoon(mi)}
                            label={moonName}
                            planetType={mType}
                            temperature={MOON_TEMP[m.moon_type] || 150}
                            seed={mSeed}
                            colorShift={mShift}
                            mass={m.mass_earth}
                            tidalHeating={m.tidal_heating}
                            isPotato={isPotato}
                            potatoColor={potatoColors?.[0]}
                            potatoColor2={potatoColors?.[1]}
                            potatoDeform={potatoDeform}
                            starSpectralClass={starSpec}
                            hasAtmosphere={hasMoonAtm}
                            atmColor={moonAtmColor}
                            planetShineColor={planetShineFromType(curPlanet?.planet_type)}
                          />
                        </group>
                      );
                    });
                    })()}

                    {/* Shepherd moons near ring edges */}
                    {curPlanet.ring_system?.rings?.map((ring: any, ri: number) => {
                      if (!moonOrbitData) return null;
                      const innerR = ring.inner_radius_re * 0.1;
                      const outerR = ring.outer_radius_re * 0.1;
                      const sSeed = hashStr(`shepherd-${ri}-${curPlanet.planet_name}`);
                      return (
                        <group key={`shepherd-${ri}`}>
                          {/* Inner shepherd */}
                          <OrbitingMoon
                            orbitR={innerR * 0.92}
                            r={0.025}
                            vizPrd={vizPeriod(0.8 + ri * 0.3, 0.8)}
                            startAngle={sSeed * 6.28}
                            active={false}
                            onClick={() => {}}
                            label=""
                            planetType="moon-shepherd"
                            temperature={100}
                            seed={sSeed}
                            colorShift={[0, 0, 0]}
                            isPotato={true}
                            potatoColor="#99aabb"
                            potatoColor2="#686878"
                            potatoDeform="generic"
                          />
                          {/* Outer shepherd */}
                          <OrbitingMoon
                            orbitR={outerR * 1.06}
                            r={0.020}
                            vizPrd={vizPeriod(0.8 + ri * 0.3 + 0.1, 0.8)}
                            startAngle={sSeed * 6.28 + 3.14}
                            active={false}
                            onClick={() => {}}
                            label=""
                            planetType="moon-shepherd"
                            temperature={100}
                            seed={sSeed + 1000}
                            colorShift={[0, 0, 0]}
                            isPotato={true}
                            potatoColor="#aabbcc"
                            potatoColor2="#787888"
                            potatoDeform="eros"
                          />
                        </group>
                      );
                    })}

                    {isSystemExplored && (
                      <>
                        {(curPlanet.sub_type_flags || []).includes('habitable_zone') && (
                          <>
                            <HabitatOrbitRing radius={moonOrbitData ? moonOrbitData.minR * 0.6 : 1.4} />
                            <HabitatStation
                              orbitR={moonOrbitData ? moonOrbitData.minR * 0.6 : 1.4}
                              period={8} startAngle={0.5}
                              type="station" label="Orbital Station" />
                          </>
                        )}
                        {((curPlanet.sub_type_flags || []).includes('global_ocean') ||
                          (curPlanet.sub_type_flags || []).includes('subsurface_ocean')) && (
                          <>
                            <HabitatOrbitRing radius={moonOrbitData ? moonOrbitData.minR * 0.75 : 1.6} />
                            <HabitatStation
                              orbitR={moonOrbitData ? moonOrbitData.minR * 0.75 : 1.6}
                              period={6} startAngle={2.5}
                              type="outpost" label="Research Platform" />
                          </>
                        )}
                      </>
                    )}

                    <directionalLight position={[-1, 0.5, 0.5]} intensity={1.5} color={starColor} />
                    <hemisphereLight args={[starColor, '#020408', 0.02]} />
                    {/* Star billboard — matches orrery OrreryStar, depth-tested so planet occludes it */}
                    <group position={[-36.7, 18.4, 18.4]}>
                      <OrreryStar
                        color={starColor}
                        size={starVisRadius(systemData?.star?.luminosity ?? 1) * 2.8}
                        teff={systemData?.star?.teff}
                        occludable
                      />
                    </group>
                  </>)}
                </group>

                {/* ═══ MOON DEPTH — moon at center, parent planet backdrop ═══ */}
                <group visible={view.depth === 'moon'}>
                  {curMoon && (<>
                    <group scale={(() => {
                      const re = curMoon?.radius_earth || 0.3;
                      const s = 0.7 + Math.min(Math.log2(1 + re) * 0.25, 0.5);
                      return [s, s, s] as [number, number, number];
                    })()}>
                      <RotatingSurfaceGroup rotationSpeed={0.05}>
                      {/* Potato moons keep their irregular shape at moon depth */}
                      {(curMoon.radius_earth || 0) < 0.008 ? (
                        <PotatoMoon
                          seed={moonSeed(curMoon, view.planetIdx, view.moonIdx ?? 0)}
                          color={curMoon.moon_type === 'captured-irregular' ? '#887766' :
                                 curMoon.moon_type === 'shepherd' ? '#99aabb' : '#776655'}
                          detail={4}
                        />
                      ) : (
                        <ProceduralPlanet
                          planetType={globeType}
                          temperature={globeTemp}
                          seed={globeSeed}
                          sunDirection={[-1, 0.5, 0.5]}
                          rotationSpeed={0}
                          colorShift={moonColorShift(curMoon, view.moonIdx ?? 0)}
                          mass={curMoon?.mass_earth}
                          tidalHeating={curMoon?.tidal_heating}
                          starSpectralClass={starSpec}
                          onBiomeClick={(biome) => setSelectedBiome(biome)} />
                      )}

                      {/* Colony buildings on moon surface (inside scale group → radius=1) */}
                      <ColonyOverlay
                        buildings={colonyBuildings}
                        ships={ships}
                        buildMode={buildMode && view.depth === 'moon'}
                        shipMode={shipMode && view.depth === 'moon'}
                        selectedShipId={selectedShipId}
                        selectedType={selectedBuildingType}
                        planetRadius={1}
                        rotationSpeed={0}
                        showRoads={showRoads}
                        showZones={showZones}
                        terrainParams={terrainParams}
                        onPlace={handleColonyPlace}
                        onRemove={handleColonyRemove}
                        onShipPlace={handleShipPlace}
                        onShipCommand={handleShipCommand}
                        onShipSelect={handleShipSelect}
                      />
                      </RotatingSurfaceGroup>

                      {/* Titan-style atmosphere for moons with thick_haze flag */}
                      {((curMoon.sub_type_flags || []).includes('thick_haze') ||
                        (curMoon.sub_type_flags || []).includes('dense_atmosphere') ||
                        curMoon.moon_type === 'terrestrial-like') && (
                        <mesh>
                          <sphereGeometry args={[1.04, 48, 32]} />
                          <meshBasicMaterial
                            color={curMoon.moon_type === 'terrestrial-like' ? '#cc8844' : '#7799bb'}
                            transparent opacity={0.18}
                            side={THREE.FrontSide} depthWrite={false}
                            blending={THREE.AdditiveBlending}
                          />
                        </mesh>
                      )}
                    </group>

                    <group position={[4, 2.5, -8]} scale={[2.8, 2.8, 2.8]}>
                      <ProceduralPlanet
                        planetType={resolveVenusType(curPlanet) || 'rocky'}
                        temperature={curPlanet?.temp_calculated_k ?? 288}
                        seed={hashStr(curPlanet?.planet_name || `parent-${view.planetIdx}`)}
                        sunDirection={[-1, 0.5, 0.5]}
                        rotationSpeed={0.01}
                        mass={curPlanet?.mass_earth}
                        starSpectralClass={starSpec}
                      />
                    </group>
                    {curPlanet?.ring_system && (
                      <mesh position={[4, 2.5, -8]} rotation={[-Math.PI / 2, 0, 0]}>
                        <ringGeometry args={[3.2, 6.5, 48]} />
                        <meshBasicMaterial color="#aabbcc" transparent opacity={0.08}
                          side={THREE.DoubleSide} depthWrite={false} />
                      </mesh>
                    )}

                    {isSystemExplored && (
                      <>
                        <HabitatOrbitRing radius={1.8} />
                        <HabitatStation
                          orbitR={1.8} period={5} startAngle={0}
                          type="outpost"
                          label={curMoon.moon_type === 'ice-shell' ? 'Drilling Platform' :
                                 curMoon.moon_type === 'volcanic' ? 'Monitoring Post' :
                                 curMoon.moon_type === 'ocean-moon' ? 'Deep Probe' :
                                 'Survey Station'} />
                        {curMoon.tidal_heating > 0.5 && (
                          <HabitatStation
                            orbitR={2.2} period={7} startAngle={3.1}
                            type="relay" label="Tidal Sensor" />
                        )}
                      </>
                    )}

                    <directionalLight position={[-1, 0.5, 0.5]} intensity={1.3} color={starColor} />
                    <hemisphereLight args={[starColor, '#020408', 0.02]} />
                    <group position={[-36.7, 18.4, 18.4]}>
                      <OrreryStar
                        color={starColor}
                        size={starVisRadius(systemData?.star?.luminosity ?? 1) * 2.8}
                        teff={systemData?.star?.teff}
                      />
                    </group>
                  </>)}
                </group>

                {/* ═══ ASTEROID DEPTH — single asteroid close-up ═══ */}
                <group visible={view.depth === 'asteroid'}>
                  {(() => {
                    const belt = belts[view.beltIdx ?? 0];
                    if (!belt) return null;
                    const src = view.asteroidSource === 'ice_dwarf' ? belt.ice_dwarfs : belt.major_asteroids;
                    const astData = src?.[view.asteroidIdx ?? 0];
                    if (!astData) return null;
                    const isIcy = view.asteroidSource === 'ice_dwarf' ||
                      belt.belt_type === 'icy-kuiper' || belt.belt_type === 'scattered-disc';
                    const diam = astData.diameter_km || 200;
                    const visualScale = 0.7 + Math.min(Math.log2(1 + diam / 100) * 0.3, 0.6);
                    const astSeed = hashStr(astData.name || `asteroid-${view.asteroidIdx}`);
                    const astColor = isIcy ? '#8899bb' :
                      astData.spectral_class === 'C' ? '#555544' :
                      astData.spectral_class === 'S' ? '#998866' :
                      astData.spectral_class === 'M' ? '#aaaaaa' : '#887755';
                    const astColor2 = isIcy ? '#556688' :
                      astData.spectral_class === 'C' ? '#333322' :
                      astData.spectral_class === 'S' ? '#665540' :
                      astData.spectral_class === 'M' ? '#777777' : '#554433';

                    return (<>
                      <group scale={[visualScale, visualScale, visualScale]}>
                        <PotatoMoon seed={astSeed} color={astColor} color2={astColor2}
                          detail={4} deformStyle={diam < 50 ? 'eros' : 'generic'} />
                      </group>

                      {/* Slow rotation */}
                      <group>
                        <Billboard>
                          <Text position={[0, visualScale + 0.3, 0]} fontSize={0.14}
                            color="#c0d8ff" fillOpacity={0.8}
                            anchorX="center" anchorY="bottom">
                            {astData.name || 'Unnamed'}
                          </Text>
                          <Text position={[0, visualScale + 0.12, 0]} fontSize={0.08}
                            color="#7899bb" fillOpacity={0.6}
                            anchorX="center" anchorY="bottom">
                            {diam.toFixed(0)} km · {isIcy ? 'Icy' : (astData.spectral_class || '?')}-type
                          </Text>
                        </Billboard>
                      </group>

                      <directionalLight position={[-1, 0.5, 0.5]} intensity={1.5} color={starColor} />
                      <hemisphereLight args={[starColor, '#020408', 0.03]} />
                    </>);
                  })()}
                </group>

              </Suspense>
            </Canvas>
          </ErrorBoundary>
          {/* Build mode HUD indicator */}
          {buildMode && (view.depth === 'planet' || view.depth === 'moon') && (
            <div className="sf-build-indicator">
              🏗 BUILD MODE — click surface to place {selectedBuildingType} · right-click to undo
            </div>
          )}
        </div>

        {/* ── Belt chart overlay (over Canvas, not replacing it) ── */}
        {view.depth === 'belt' && curBelt && (
          <div className="sf-belt-overlay">
            <BeltFamilyChart belt={curBelt} />
            <div className="sf-belt-legend">
              {(curBelt.families || []).map((f: any, i: number) => (
                <span key={i} className="sf-belt-legend-item">
                  <span className="sf-belt-legend-dot"
                    style={{ background: SPEC_COLOR[f.spectral_class] || '#888' }} />
                  {f.name} ({f.spectral_class})
                </span>
              ))}
              {(curBelt.resonance_gaps || []).length > 0 && (
                <span className="sf-belt-legend-item">
                  <span className="sf-belt-legend-dot" style={{ background: '#ff4444' }} />
                  Resonance gaps
                </span>
              )}
            </div>
          </div>
        )}

        {/* ── Breadcrumb overlay ── */}
        <DepthBreadcrumb
          view={view}
          systemData={systemData}
          planets={planets}
          belts={belts}
          onNavigate={handleNavigate}
        />

        {/* ═══ PERSISTENT SIDEBAR — system tree + contextual detail ═══ */}
        <div className="sf-sidebar">
          <div className="sf-sidebar-scroll">

            {/* ── Star info (always visible, click to return to system view) ── */}
            <div className="sf-tree-star" style={{ cursor: 'pointer' }}
              onClick={() => handleNavigate({ depth: 'system', planetIdx: 0 })}>
              <div className="sf-tree-star-row">
                <span className="sf-tree-star-dot" style={{ background: starColor, boxShadow: `0 0 6px ${starColor}` }} />
                <span className="sf-tree-star-name">{systemData?.star?.main_id || systemId}</span>
                {systemData?.star?.spectral_class && (
                  <span className="sf-tree-star-spec" style={{ color: starColor }}>
                    {systemData.star.spectral_class}
                  </span>
                )}
              </div>
              {systemData?.star && (
                <div className="sf-tree-star-meta">
                  {systemData.star.teff && <span>{systemData.star.teff} K</span>}
                  {systemData.star.luminosity != null && <span>{systemData.star.luminosity.toFixed(2)} L☉</span>}
                  {systemData.star.distance_ly != null && <span>{systemData.star.distance_ly.toFixed(1)} ly</span>}
                </div>
              )}
            </div>

            {/* ── Planets tree (always visible, expandable) ── */}
            {planets.length > 0 && (
              <div className="sf-tree-section">
                <div className="sf-tree-label">PLANETS ({planets.length})</div>
                {planets.map((p: any, i: number) => {
                  const pc = PT_COLOR[p.planet_type] || '#667788';
                  const isSelected = (view.depth === 'planet' || view.depth === 'moon') && view.planetIdx === i;
                  const r = p.radius_earth ?? p.pl_rade ?? 1;

                  return (
                    <div key={i} className="sf-tree-group">
                      {/* Planet row — always visible */}
                      <div
                        className={`sf-tree-row${isSelected ? ' active' : ''}`}
                        onClick={() => {
                          if (isSelected && view.depth === 'planet') {
                            handleNavigate({ depth: 'system', planetIdx: 0 });
                          } else {
                            handleDrillPlanet(i);
                          }
                        }}
                      >
                        <span className="sf-nav-dot" style={{ background: pc }} />
                        <span className="sf-tree-name">{shortName(p.planet_name, i)}</span>
                        <span className="sf-tree-type">{p.planet_type}</span>
                        <span className="sf-tree-stat">{r.toFixed(1)} R⊕</span>
                        {p.moons?.length > 0 && !p.tidally_locked && (
                          <span className="sf-tree-badge">{p.moons.length}🌑</span>
                        )}
                        <span className="sf-tree-chevron">{isSelected ? '▾' : '›'}</span>
                      </div>

                      {/* ── Expanded planet detail (inline) ── */}
                      {isSelected && (
                        <div className="sf-tree-detail">
                          {/* Quick stats */}
                          <div className="sf-mini-stats">
                            {p.mass_earth != null && (
                              <span>{p.mass_earth.toFixed(1)} M⊕</span>
                            )}
                            {p.temp_calculated_k != null && (
                              <span>{p.temp_calculated_k} K</span>
                            )}
                            {p.semi_major_axis_au != null && (
                              <span>{p.semi_major_axis_au.toFixed(2)} AU</span>
                            )}
                            {p.orbital_period_days != null && (
                              <span>{p.orbital_period_days.toFixed(1)} d</span>
                            )}
                            {p.eccentricity != null && (
                              <span>e={p.eccentricity.toFixed(3)}</span>
                            )}
                          </div>

                          {/* Flags */}
                          {p.sub_type_flags?.length > 0 && (
                            <div className="sf-flags-compact">
                              {p.sub_type_flags.map((f: string, fi: number) => (
                                <span key={fi} className="sf-flag-sm">
                                  {FLAG_ICON[f] || '•'} {f.replace(/_/g, ' ')}
                                </span>
                              ))}
                            </div>
                          )}

                          {/* Tidal lock + rotation + mining info */}
                          {(p.tidally_locked || p.spin_orbit_resonance || p.mineral_abundance) && (
                            <div className="sf-tree-subsection">
                              {p.tidally_locked && (
                                <div className="sf-tree-sublabel">
                                  🔒 Tidally Locked ({p.spin_orbit_resonance || '1:1'})
                                  {p.rotation_period_days != null && (
                                    <span className="sf-dim"> — {p.rotation_period_days.toFixed(1)}d rot</span>
                                  )}
                                </div>
                              )}
                              {!p.tidally_locked && p.rotation_period_days != null && (
                                <div className="sf-dim" style={{fontSize: '9px'}}>
                                  Rotation: {p.rotation_period_days < 1
                                    ? `${(p.rotation_period_days * 24).toFixed(1)}h`
                                    : `${p.rotation_period_days.toFixed(1)}d`}
                                </div>
                              )}
                              {p.temp_distribution?.pattern && (
                                <div className="sf-dim" style={{fontSize: '9px'}}>
                                  Thermal: {p.temp_distribution.pattern}
                                  {p.temp_distribution.day_night_contrast != null &&
                                    ` (ΔT ${p.temp_distribution.day_night_contrast.toFixed(0)}K)`}
                                </div>
                              )}
                              {p.mineral_abundance?.mining_viability && (
                                <div className="sf-dim" style={{fontSize: '9px'}}>
                                  ⛏ Mining: {p.mineral_abundance.mining_viability.replace(/_/g, ' ')}
                                  {p.mineral_abundance.notable_deposits?.length > 0 && (
                                    <span> — {p.mineral_abundance.notable_deposits.slice(0, 3).join(', ')}</span>
                                  )}
                                </div>
                              )}
                            </div>
                          )}

                          {/* PBR toggle */}
                          {view.depth === 'planet' && (
                            <div className="sf-globe-controls">
                              {texStatus === 'loading' && (
                                <span className="sf-tex-status">
                                  <span className="sf-spinner" /> PBR…
                                </span>
                              )}
                              {texStatus === 'done' && (
                                <button
                                  className={`sf-pbr-toggle${usePBR ? ' active' : ''}`}
                                  onClick={(e) => { e.stopPropagation(); setUsePBR(!usePBR); }}
                                >
                                  {usePBR ? '◆ PBR' : '◇ PBR'}
                                </button>
                              )}
                              {texStatus === 'failed' && (
                                <span className="sf-tex-status sf-tex-fail">PBR n/a</span>
                              )}
                            </div>
                          )}

                          {/* Ring system */}
                          {p.ring_system?.rings?.length > 0 && (
                            <div className="sf-tree-subsection">
                              <div className="sf-tree-sublabel">RINGS</div>
                              {p.ring_system.rings.map((rr: any, ri: number) => (
                                <div key={ri} className="sf-ring-row-compact">
                                  <span>{rr.name || `Ring ${ri + 1}`}</span>
                                  <span className="sf-dim">{rr.composition}</span>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Moons — expandable per-moon */}
                          {p.moons?.length > 0 && (
                            <div className="sf-tree-subsection">
                              <div className="sf-tree-sublabel">MOONS ({p.moons.length})</div>
                              {p.moons.map((m: any, mi: number) => {
                                const mc = MOON_COLOR[m.moon_type] || '#888';
                                const isMoonSel = view.depth === 'moon' && view.moonIdx === mi;

                                return (
                                  <div key={mi} className="sf-tree-moon-group">
                                    <div
                                      className={`sf-tree-row moon${isMoonSel ? ' active' : ''}`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (isMoonSel) {
                                          handleNavigate({ depth: 'planet', planetIdx: view.planetIdx });
                                        } else {
                                          handleDrillMoon(mi);
                                        }
                                      }}
                                    >
                                      <span className="sf-nav-dot" style={{ background: mc, width: 5, height: 5 }} />
                                      <span className="sf-tree-name">
                                        {m.moon_name?.split(' ').pop() || `moon-${mi}`}
                                      </span>
                                      <span className="sf-tree-type" style={{ color: mc }}>
                                        {MOON_ICON[m.moon_type] || '🌑'}
                                      </span>
                                      {m.tidal_heating > 0 && (
                                        <span className="sf-tree-badge">🔥</span>
                                      )}
                                    </div>

                                    {/* Moon expanded detail */}
                                    {isMoonSel && (
                                      <div className="sf-moon-inline">
                                        <div className="sf-mini-stats">
                                          {m.radius_earth != null && (
                                            <span>{m.radius_earth.toFixed(3)} R⊕</span>
                                          )}
                                          {m.orbital_radius_au != null && (
                                            <span>{(m.orbital_radius_au * 149597870.7).toFixed(0)} km</span>
                                          )}
                                          {m.tidal_heating > 0 && (
                                            <span>🔥 {m.tidal_heating.toFixed(2)}</span>
                                          )}
                                          {m.mass_earth != null && (
                                            <span>{m.mass_earth.toFixed(4)} M⊕</span>
                                          )}
                                        </div>
                                        {m.sub_type_flags?.length > 0 && (
                                          <div className="sf-flags-compact">
                                            {m.sub_type_flags.map((f: string, fi: number) => (
                                              <span key={fi} className="sf-flag-sm">
                                                {FLAG_ICON[f] || '•'} {f.replace(/_/g, ' ')}
                                              </span>
                                            ))}
                                          </div>
                                        )}
                                        {MOON_DESC[m.moon_type] && (
                                          <div className="sf-moon-desc-compact">
                                            {MOON_DESC[m.moon_type]}
                                          </div>
                                        )}
                                        {isSystemExplored && (
                                          <div className="sf-habitat-compact">
                                            <span className="sf-habitat-inline">
                                              {m.moon_type === 'ice-shell' ? '⛏️ Drilling Platform' :
                                               m.moon_type === 'volcanic' ? '📡 Monitoring Post' :
                                               m.moon_type === 'ocean-moon' ? '🔬 Deep Probe' :
                                               '🛸 Survey Station'}
                                            </span>
                                            {m.tidal_heating > 0.5 && (
                                              <span className="sf-habitat-inline">📡 Tidal Sensor</span>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {/* Habitat infrastructure */}
                          {isSystemExplored && (
                            <div className="sf-tree-subsection">
                              <div className="sf-tree-sublabel">🛰️ INFRASTRUCTURE</div>
                              {(p.sub_type_flags || []).includes('habitable_zone') && (
                                <div className="sf-habitat-item-compact">🏗️ Orbital Station</div>
                              )}
                              {((p.sub_type_flags || []).includes('global_ocean') ||
                                (p.sub_type_flags || []).includes('subsurface_ocean')) && (
                                <div className="sf-habitat-item-compact">🔬 Research Platform</div>
                              )}
                              <div className="sf-habitat-item-compact dim">🛸 More via Campaign</div>
                            </div>
                          )}

                          {/* Resonances */}
                          {arch?.features?.includes('resonance_chain') &&
                            systemData.resonance_chains?.length > 0 && (
                            <div className="sf-tree-subsection">
                              <div className="sf-tree-sublabel">RESONANCES</div>
                              {systemData.resonance_chains.map((rc: any, rci: number) => (
                                <div key={rci} className="sf-dim" style={{ fontSize: 10, marginBottom: 1 }}>
                                  {rc.inner} ↔ {rc.outer} ({rc.ratio})
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Science panels */}
                          {view.depth === 'planet' && (
                            <div className="sf-tree-subsection">
                              <button className="sf-science-toggle"
                                onClick={(e) => { e.stopPropagation(); setScienceOpen(!scienceOpen); }}>
                                {scienceOpen ? '▾' : '▸'} Science
                                {science.loading && <span className="sf-computing">computing…</span>}
                              </button>
                              {scienceOpen && (
                                <div className="sf-science">
                                  <div className="sf-sci-tabs">
                                    {TABS.map(t => (
                                      <button key={t.id}
                                        onClick={(e) => { e.stopPropagation(); setActiveTab(t.id); }}
                                        className={`sf-sci-tab${activeTab === t.id ? ' active' : ''}`}>
                                        {t.label}
                                      </button>
                                    ))}
                                  </div>
                                  <div className="science-panel sf-sci-content">
                                    {activeTab === 'editor' && (
                                      <PlanetEditorPanel systemId={systemId}
                                        planetIndex={view.planetIdx}
                                        planet={curPlanet}
                                        starTeff={systemData?.star?.teff ?? 5778}
                                        starLuminosity={systemData?.star?.luminosity ?? 1}
                                        onTexturesGenerated={(tex) => {
                                          setTexturesV2(tex as any);
                                          setTexStatus('done');
                                        }}
                                        onStatusChange={() => {}} />
                                    )}
                                    {activeTab === 'composition' && (
                                      <CompositionPanel planet={curPlanet} textures={null}
                                        systemData={systemData} />
                                    )}
                                    {activeTab === 'atmosphere' && (
                                      <AtmospherePanel planet={curPlanet} textures={null} />
                                    )}
                                    {activeTab === 'atm-v2' && (
                                      <AtmosphereV2Panel profile={science.atmosphereV2}
                                        planetName={curPlanet?.planet_name} />
                                    )}
                                    {activeTab === 'interior' && (
                                      <InteriorPanel profile={science.interior}
                                        planetName={curPlanet?.planet_name} />
                                    )}
                                    {activeTab === 'climate' && (
                                      <ClimatePanel climate={science.climate}
                                        smaAu={curPlanet?.semi_major_axis_au}
                                        planetName={curPlanet?.planet_name} />
                                    )}
                                    {activeTab === 'models' && (
                                      <ModelManifestPanel science={science} />
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── Belts tree (always visible, expandable) ── */}
            {belts.length > 0 && (
              <div className="sf-tree-section">
                <div className="sf-tree-label">BELTS ({belts.length})</div>
                {belts.map((b: any, i: number) => {
                  const isActive = view.depth === 'belt' && view.beltIdx === i;
                  return (
                    <div key={i} className="sf-tree-group">
                      <div
                        className={`sf-tree-row${isActive ? ' active' : ''}`}
                        onClick={() => {
                          if (isActive) {
                            handleNavigate({ depth: 'system', planetIdx: 0 });
                          } else {
                            handleDrillBelt(i);
                          }
                        }}
                      >
                        <span className="sf-tree-name">
                          {BELT_TYPE_LABEL[b.belt_type] || b.belt_type}
                        </span>
                        <span className="sf-tree-stat">
                          {b.inner_radius_au?.toFixed(1)}–{b.outer_radius_au?.toFixed(1)} AU
                        </span>
                        <span className="sf-tree-chevron">{isActive ? '▾' : '›'}</span>
                      </div>

                      {isActive && (
                        <div className="sf-tree-detail">
                          <div className="sf-mini-stats">
                            <span>{(b.estimated_bodies || 0).toLocaleString()} bodies</span>
                            <span>{b.confidence || '?'} conf</span>
                          </div>

                          {b.families?.length > 0 && (
                            <div className="sf-tree-subsection">
                              <div className="sf-tree-sublabel">FAMILIES ({b.families.length})</div>
                              <div className="sf-belt-families">
                                {b.families.map((f: any, fi: number) => (
                                  <div key={fi} className="sf-belt-fam-item">
                                    <span className="sf-belt-fam-dot"
                                      style={{ background: SPEC_COLOR[f.spectral_class] || '#888' }} />
                                    <span className="sf-belt-fam-name">{f.name}</span>
                                    <span className="sf-belt-fam-spec">{f.spectral_class}-type</span>
                                    <span className="sf-dim">{f.member_count}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {b.resonance_gaps?.length > 0 && (
                            <div className="sf-tree-subsection">
                              <div className="sf-tree-sublabel">GAPS ({b.resonance_gaps.length})</div>
                              <div className="sf-belt-families">
                                {b.resonance_gaps.map((g: any, gi: number) => (
                                  <div key={gi} className="sf-belt-fam-item gap">
                                    <span className="sf-belt-fam-name">{g.resonance}</span>
                                    <span className="sf-dim">{g.position_au?.toFixed(3)} AU</span>
                                    <span className="sf-dim">{g.width_class}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {b.major_asteroids?.length > 0 && (
                            <div className="sf-tree-subsection">
                              <div className="sf-tree-sublabel">MAJOR BODIES</div>
                              <div className="sf-belt-families">
                                {b.major_asteroids.map((a: any, ai: number) => (
                                  <div key={ai} className="sf-belt-fam-item sf-clickable"
                                    onClick={(e) => { e.stopPropagation(); handleDrillAsteroid(i, ai, 'major'); }}
                                    title="Click to view close-up">
                                    <span className="sf-belt-fam-dot"
                                      style={{ background: SPEC_COLOR[a.spectral_class] || '#ccc' }} />
                                    <span className="sf-belt-fam-name">{a.name}</span>
                                    <span className="sf-dim">{a.diameter_km?.toFixed(0)} km</span>
                                    <span className="sf-dim" style={{ color: '#4d9fff', fontSize: 9 }}>🔍</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {b.ice_dwarfs?.length > 0 && (
                            <div className="sf-tree-subsection">
                              <div className="sf-tree-sublabel">ICE DWARFS</div>
                              <div className="sf-belt-families">
                                {b.ice_dwarfs.map((d: any, di: number) => (
                                  <div key={di} className="sf-belt-fam-item sf-clickable"
                                    onClick={(e) => { e.stopPropagation(); handleDrillAsteroid(i, di, 'ice_dwarf'); }}
                                    title="Click to view close-up">
                                    <span className="sf-belt-fam-dot"
                                      style={{ background: d.surface_type === 'nitrogen-ice' ? '#aaccff' :
                                        d.surface_type === 'methane-frost' ? '#ffccaa' : '#99ddff' }} />
                                    <span className="sf-belt-fam-name">{d.name}</span>
                                    <span className="sf-dim">{d.diameter_km?.toFixed(0)} km</span>
                                    {d.has_companion && <span className="sf-dim">⚭</span>}
                                    <span className="sf-dim" style={{ color: '#4d9fff', fontSize: 9 }}>🔍</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── Architecture ── */}
            {arch?.features?.length > 0 && (
              <div className="sf-tree-section">
                <div className="sf-tree-label">ARCHITECTURE</div>
                <div className="sf-arch-class">{arch.class}</div>
                <div className="sf-flags-compact">
                  {arch.features.map((f: string, i: number) => (
                    <span key={i} className="sf-flag-sm">{f.replace(/_/g, ' ')}</span>
                  ))}
                </div>
              </div>
            )}

            {view.depth === 'system' && (
              <div className="sf-depth-hint">
                Click a planet in the orrery or tree to explore
              </div>
            )}

          </div>
        </div>

        {/* Loading state */}
        {!systemData && (
          <div className="sf-empty-overlay">Loading system…</div>
        )}

        {/* Biome info panel — shown when a biome region is selected */}
        {selectedBiome && view.depth === 'planet' && (
          <BiomeInfoPanel biome={selectedBiome} onClose={() => setSelectedBiome(null)} />
        )}

      </div>
    </div>
  );
}
