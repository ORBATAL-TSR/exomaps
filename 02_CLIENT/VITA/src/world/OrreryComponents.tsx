/**
 * OrreryComponents — Sub-components and helpers for SystemFocusView.
 *
 * Extracted from SystemFocusView to keep that file manageable.
 * Contains: OrbitClock, OrreryBody, OrreryStar, PotatoMoon,
 * CapturedMiniMoon, OrbitingMoon, MoonOrbitLine, KuiperDustGlow,
 * BeltGapRings, and all associated constants/utilities.
 */

import React, { useRef, useMemo, useState, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { ProceduralPlanet } from '../components/ProceduralPlanet';
import type { BiomeInfo } from '../components/ProceduralPlanet';
import type { TauriGPUHook } from '../hooks/useTauriGPU';
import { getStarData, bvToRGB, STAR_COUNT, FIELDS_PER_STAR } from '../data/hygStarCatalog';

/* ━━ Orbit Time Accumulator (shared across all orbiting components) ━━ */
export const _orbit = { time: 0, speed: 1.0 };

/** Accumulates orbit time with speed scaling — place inside Canvas */
export function OrbitClock() {
  useFrame((_, delta) => {
    _orbit.time += delta * _orbit.speed;
    // Expose orbit speed globally so ProceduralPlanet can read it for rotation/shader time
    (globalThis as any).__exomaps_orbit_speed = _orbit.speed;
  });
  return null;
}

/* ━━ Types ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

export interface Props {
  systemId: string;
  gpu: TauriGPUHook;
  onBack: () => void;
  onLoadStage?: (stage: 'connecting' | 'data' | 'scene' | 'ready') => void;
  /** Sub-progress within the current stage (0–1) for fine-grained bar updates */
  onSubProgress?: (p: number) => void;
  /** When false the View stops scissor-rendering (visible=false) but keeps all
   *  Three.js objects and compiled shaders alive in the shared WebGL context.
   *  Prevents D3D11 TDR from shader recompilation on re-navigation. */
  active?: boolean;
}

export type ScienceTab = 'editor' | 'composition' | 'atmosphere' | 'interior' | 'climate' | 'atm-v2' | 'models';

export type ViewDepth = 'system' | 'planet' | 'moon' | 'belt' | 'asteroid';

export interface ViewState {
  depth: ViewDepth;
  planetIdx: number;
  moonIdx?: number;
  beltIdx?: number;
  asteroidIdx?: number;  // index into major_asteroids or ice_dwarfs
  asteroidSource?: 'major' | 'ice_dwarf';  // which list the asteroid comes from
}

/* ━━ Color & Label Maps ━━━━━━━━━━━━━━━━━━━━━━━━━ */

export const STAR_COLOR: Record<string, string> = {
  O: '#9bb0ff', B: '#aabfff', A: '#cad7ff', F: '#f8f7ff',
  G: '#fff4ea', K: '#ffd2a1', M: '#ffb56c', L: '#ff8c42', T: '#ff6b35',
};

export const PT_COLOR: Record<string, string> = {
  'hot-jupiter': '#ff4500', 'gas-giant': '#9370db', 'super-jupiter': '#7b68ee',
  'neptune-like': '#4682b4', 'warm-neptune': '#5f9ea0', 'mini-neptune': '#6495ed',
  'sub-neptune': '#5c7caa', 'super-earth': '#4caf50', 'earth-like': '#3da5d9',
  'rocky': '#b8860b', 'venus': '#daa520', 'eyeball-world': '#2196f3', 'ocean-world': '#00bcd4',
  'desert-world': '#d2691e', 'lava-world': '#ff6347', 'carbon-planet': '#696969',
  'iron-planet': '#a0522d', 'hycean': '#00ced1', 'ice-dwarf': '#b0c4de',
  'chthonian': '#8b4513', 'sub-earth': '#778899',
};

/** Planet/moon types that are explicitly airless — no atmosphere rim in OrreryBody. */
export const AIRLESS_TYPES = new Set([
  'rocky', 'sub-earth', 'iron-planet', 'chthonian', 'barren', 'dead-rock',
  'moon-cratered', 'moon-basalt', 'moon-iron-rich', 'moon-olivine',
  'moon-regolith', 'moon-sulfate', 'moon-carbon-soot', 'moon-tholin',
  'moon-captured', 'moon-shepherd', 'moon-binary',
  'moon-silicate-frost', 'moon-co2-frost', 'moon-ice-shell', 'moon-ocean',
]);

export const MOON_COLOR: Record<string, string> = {
  'volcanic': '#ff6347', 'ice-shell': '#add8e6', 'atmosphere-moon': '#daa520',
  'ocean-moon': '#00bfff', 'cratered-airless': '#a89880', 'captured-irregular': '#7a6a5e',
  'shepherd': '#99aabb', 'binary-moon': '#8a8895',
};

/**
 * Smart moon profile selector: uses moon_type as base, then refines with
 * geology flags, tidal heating, mass, and orbital properties to pick from
 * all 20 moon profiles. Guarantees diverse appearance within a planet's moons.
 */
export function pickMoonProfile(m: any, moonIdx: number): string {
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
export function pickPotatoColors(_m: any, profile: string): [string, string] {
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

export const MOON_TEMP: Record<string, number> = {
  'volcanic': 350, 'ice-shell': 100, 'atmosphere-moon': 94,
  'ocean-moon': 120, 'cratered-airless': 160, 'captured-irregular': 120,
  'shepherd': 100, 'binary-moon': 150,
};

export const MOON_ICON: Record<string, string> = {
  'volcanic': '🌋', 'ice-shell': '🧊', 'atmosphere-moon': '🌫️',
  'ocean-moon': '🌊', 'cratered-airless': '🌑', 'captured-irregular': '☄️',
  'shepherd': '🛡️', 'binary-moon': '⚭',
};

export const FLAG_ICON: Record<string, string> = {
  habitable_zone: '🌍', tidally_locked: '🔒', possible_biosignatures: '🧬',
  subsurface_ocean: '🌊', magma_ocean: '🌋', resonance_locked: '⚛',
  banded_atmosphere: '🪐', great_storm: '🌀', terminator_habitable: '☀️',
  global_ocean: '💧', thick_atmosphere: '☁️', greenhouse_runaway: '🔥',
  plate_tectonics: '🏔️', polar_ice_caps: '❄️', stripped_mantle: '⚙️',
  metallic_surface: '🪙', ancient_ocean: '🏜️', sulfur_eruptions: '💨',
  nitrogen_geysers: '💎', extreme_axial_tilt: '↗️',
};

/* Color each flag for scannable chip display */
export const FLAG_COLOR: Record<string, string> = {
  habitable_zone:        '#44cc66',
  possible_biosignatures:'#22ff88',
  global_ocean:          '#2299dd',
  subsurface_ocean:      '#3388cc',
  ocean_world:           '#11aaee',
  terminator_habitable:  '#88cc44',
  polar_ice_caps:        '#88aacc',
  thick_atmosphere:      '#6699aa',
  plate_tectonics:       '#aa9955',
  ancient_ocean:         '#5588aa',
  nitrogen_geysers:      '#88ccff',
  magma_ocean:           '#ff4422',
  greenhouse_runaway:    '#ff6622',
  sulfur_eruptions:      '#ddaa22',
  banded_atmosphere:     '#8866dd',
  great_storm:           '#7755ee',
  tidally_locked:        '#ff9944',
  resonance_locked:      '#8ab4e8',
  stripped_mantle:       '#cc8855',
  metallic_surface:      '#ccaa66',
  extreme_axial_tilt:    '#ffcc44',
};

export const SPEC_COLOR: Record<string, string> = {
  S: '#4488ee', V: '#ee5533', C: '#44ccaa', M: '#cc8844',
  D: '#aa66cc', X: '#999', B: '#55bbcc', P: '#887766',
};

export const BELT_TYPE_LABEL: Record<string, string> = {
  'rocky-asteroid': '🪨 Asteroid Belt',
  'icy-kuiper': '🧊 Kuiper Belt',
  'scattered-disc': '💫 Scattered Disc',
  'trojan-swarm': '⚔️ Trojan Swarm',
};

export const MOON_DESC: Record<string, string> = {
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

export function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h) / 2147483647;
}

export function shortName(name: string | undefined, idx: number): string {
  if (!name) return String.fromCharCode(98 + idx);
  return name.split(' ').pop()?.replace('(inferred)', '').trim() || String.fromCharCode(98 + idx);
}

export function formatPeriod(days: number): string {
  if (days < 0.5)  return `${(days * 24).toFixed(1)} h`;
  if (days < 1)    return `${(days * 24).toFixed(0)} h`;
  if (days < 365)  return `${days.toFixed(1)} d`;
  return `${(days / 365.25).toFixed(2)} yr`;
}

/** Surface gravity in Earth g-units: g = M / R². Returns formatted string or null. */
export function surfaceG(massEarth: number | undefined, radiusEarth: number | undefined): string | null {
  if (massEarth == null || radiusEarth == null || radiusEarth <= 0) return null;
  return (massEarth / (radiusEarth * radiusEarth)).toFixed(2) + 'g';
}

/** Derive lifecycle label from spectral class string or luminosity. */
export function starLifecycle(spectralClass: string | undefined, luminosity: number | undefined): string {
  const s = spectralClass || '';
  if (/Ia|Ib|II(?!I)/.test(s) || (luminosity ?? 0) > 200) return 'Supergiant';
  if (/III/.test(s) || (luminosity ?? 0) > 30) return 'Giant';
  if (/IV/.test(s) || (luminosity ?? 0) > 3) return 'Subgiant';
  if (/VI|sd/.test(s) || s.startsWith('sd')) return 'Subdwarf';
  return 'Main Sequence';
}

/* ---------- Shared radial-glow texture (soft circle, no hard square edges) ---------- */
let _glowTex: THREE.Texture | null = null;
export function getGlowTexture(): THREE.Texture {
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
export function vizPeriod(periodDays: number, minPeriodDays: number): number {
  const ratio = Math.max(periodDays, 1) / Math.max(minPeriodDays, 1);
  return 18 * Math.pow(ratio, 0.55);
}

export const STAR_VIS_R = 0.22;
/** Luminosity-scaled star visual radius for the orrery */
export const starVisRadius = (luminosity: number) =>
  Math.max(0.22, Math.min(0.85, 0.24 + Math.pow(luminosity, 0.30) * 0.20));

/**
 * Logarithmic orbit scaling for system depth.
 * Maps SMA (AU) → visual radius, guaranteeing innermost planet outside star.
 */
export function logOrbitRadius(smaAU: number, starVisR: number, maxSma: number): number {
  const padding = (isFinite(starVisR) ? starVisR : 0.22) * 1.8;
  const k = 8 / Math.max(isFinite(maxSma) ? maxSma : 1, 0.5);
  const spread = 7;
  const safeSma = isFinite(smaAU) && smaAU > 0 ? smaAU : 0;
  return padding + Math.log2(1 + safeSma * k) * spread;
}

export function logBeltRadius(auVal: number, starVisR: number, maxSma: number): number {
  return logOrbitRadius(auVal, starVisR, maxSma);
}

// ── Spectral-class → particle color ───────────────────────────────────────
// Based on measured asteroid albedos and spectral reflectance curves.
export function spectralColor(cls: string | undefined): THREE.Color {
  switch ((cls || '').toUpperCase().charAt(0)) {
    case 'C': return new THREE.Color(0.28, 0.24, 0.22);  // dark carbonaceous
    case 'S': return new THREE.Color(0.54, 0.44, 0.30);  // silicate/stony
    case 'M': return new THREE.Color(0.60, 0.58, 0.52);  // metallic
    case 'D': return new THREE.Color(0.42, 0.22, 0.18);  // dark reddish
    case 'P': return new THREE.Color(0.34, 0.28, 0.22);  // primitive dark
    case 'B': return new THREE.Color(0.38, 0.42, 0.52);  // blue-gray
    case 'V': return new THREE.Color(0.62, 0.54, 0.40);  // basaltic/vestan
    case 'X': return new THREE.Color(0.50, 0.46, 0.40);  // ambiguous
    default:  return new THREE.Color(0.53, 0.46, 0.34);  // generic rocky
  }
}

// ── KuiperDustGlow — faint scattered-light disc for icy/KBO belts ──────────
// Represents the diffuse sunlight glow from trillions of unresolved ice grains.
// Two overlapping discs: outer ring haze + central translucent fog.
export function KuiperDustGlow({ belt, starVisR, maxSma }: {
  belt: any; starVisR: number; maxSma: number;
}) {
  const isIcy = belt.belt_type === 'icy-kuiper' || belt.belt_type === 'scattered-disc';
  if (!isIcy) return null;

  const inner = logBeltRadius(belt.inner_radius_au ?? 30, starVisR, maxSma);
  const outer = logBeltRadius(belt.outer_radius_au ?? 55, starVisR, maxSma);
  const mid   = (inner + outer) * 0.5;
  const halfW = (outer - inner) * 0.5;

  // Use a ring geometry for the diffuse halo with slight inclination tilt
  // Two layers: wide dim outer glow + narrower inner fog
  const isScattered = belt.belt_type === 'scattered-disc';
  // Scattered-disc warps at ~15° — represents high-inclination population
  const discTilt = isScattered ? Math.PI / 2 + 0.26 : Math.PI / 2;

  const mat1 = useMemo(() => new THREE.MeshBasicMaterial({
    color: new THREE.Color(0.42, 0.58, 0.82),
    transparent: true, opacity: 0.010,
    side: THREE.DoubleSide, depthWrite: false,
    blending: THREE.AdditiveBlending,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  const mat2 = useMemo(() => new THREE.MeshBasicMaterial({
    color: new THREE.Color(0.62, 0.70, 0.90),
    transparent: true, opacity: 0.006,
    side: THREE.DoubleSide, depthWrite: false,
    blending: THREE.AdditiveBlending,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  // Outer tholin fringe — faint rust-red at belt outer edge (redistributed organics)
  const mat3 = useMemo(() => new THREE.MeshBasicMaterial({
    color: new THREE.Color(0.50, 0.18, 0.06),
    transparent: true, opacity: 0.007,
    side: THREE.DoubleSide, depthWrite: false,
    blending: THREE.AdditiveBlending,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  return (
    <group rotation={[discTilt, 0, 0]}>
      {/* Wide outer glow — icy blue-white tint */}
      <mesh material={mat1} renderOrder={0}>
        <ringGeometry args={[inner, outer + halfW * 0.6, 128]} />
      </mesh>
      {/* Denser inner band centered on belt mid-plane */}
      <mesh material={mat2} renderOrder={0}>
        <ringGeometry args={[mid - halfW * 0.7, mid + halfW * 0.7, 128]} />
      </mesh>
      {/* Outer tholin fringe — organic redistribution at belt outer edge */}
      <mesh material={mat3} renderOrder={0}>
        <ringGeometry args={[mid + halfW * 0.4, outer + halfW * 1.0, 128]} />
      </mesh>
    </group>
  );
}

// ── Resonance gap rings (3D dark disc outlines at gap positions) ───────────
export function BeltGapRings({ belt, starVisR, maxSma }: {
  belt: any; starVisR: number; maxSma: number;
}) {
  const rings = useMemo(() => {
    const gaps = belt.resonance_gaps || [];
    return gaps.map((g: any) => ({
      r: logBeltRadius(g.position_au, starVisR, maxSma),
      w: Math.max(0.003, logBeltRadius(g.position_au + g.width_au * 0.5, starVisR, maxSma)
           - logBeltRadius(g.position_au - g.width_au * 0.5, starVisR, maxSma)),
    }));
  }, [belt, starVisR, maxSma]);

  if (rings.length === 0) return null;

  return (
    <>
      {rings.map((g: { r: number; w: number }, i: number) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[g.r - g.w * 0.5, g.r + g.w * 0.5, 64]} />
          <meshBasicMaterial
            color="#0a0806"
            side={THREE.DoubleSide}
            transparent
            opacity={0.55}
            depthWrite={false}
          />
        </mesh>
      ))}
    </>
  );
}

/**
 * Collision-aware moon orbit layout for planet depth.
 * First pass: logarithmic mapping. Second pass: push apart any overlapping moons.
 * Returns array of scene-unit orbit radii guaranteed not to overlap.
 */
export function layoutMoonOrbits(
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

/** Detect orbital resonance between two adjacent moons (returns label or null) */
export function detectResonance(period1: number, period2: number): string | null {
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
export function moonSeed(m: any, planetIdx: number, moonIdx: number): number {
  const nameH = hashStr(m.moon_name ?? '');
  const orbH  = hashStr(String(m.orbital_radius_au ?? 0));
  const massH = hashStr(String(m.mass_earth ?? 0));
  return (nameH * 0.4 + orbH * 0.35 + massH * 0.25 + moonIdx * 0.017 + planetIdx * 0.0031) % 1.0;
}

/** Geology-driven RGB color shift so each moon looks distinct */
export function moonColorShift(m: any, mi: number): [number, number, number] {
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
export function planetShineFromType(pType: string | undefined): [number, number, number] {
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
export function MiniMoonDot({ r, orbitR, color, period, startAngle }: {
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
export function OrreryBody({
  orbitR, r, color, active, vizPrd, startAngle, onClick, label,
  ringSystem, moonHints, planetType, planetSeed, temperature, mass,
  compOrbitR, compVizPrd, sunBrightness2,
}: {
  orbitR: number; r: number; color: string; active: boolean;
  vizPrd: number; startAngle: number; onClick: () => void;
  label: string; ringSystem?: any; moonHints?: { color: string }[];
  planetType?: string; planetSeed?: number; temperature?: number;
  mass?: number; starSpectralClass?: string;
  compOrbitR?: number; compVizPrd?: number;
  sunBrightness?: number; sunBrightness2?: number;
}) {
  const grp = useRef<THREE.Group>(null!);
  const glow = useRef<THREE.Mesh>(null!);
  // Mutable arrays — mutated each frame, ProceduralPlanet reads these by reference.
  const sunDirArray  = useRef<[number, number, number]>([-1, 0.05, 0]);
  const sunDir2Array = useRef<[number, number, number]>([-1, 0.05, 0]);

  useFrame(({ clock }) => {
    const t = _orbit.time;
    const a = startAngle + (t * Math.PI * 2) / Math.max(vizPrd, 2);
    if (grp.current) {
      grp.current.position.x = Math.cos(a) * orbitR;
      grp.current.position.z = Math.sin(a) * orbitR;
      // Direction from planet toward primary star (at origin)
      const px = grp.current.position.x;
      const pz = grp.current.position.z;
      const len = Math.sqrt(px * px + pz * pz);
      if (len > 0.001) {
        sunDirArray.current[0] = -px / len;
        sunDirArray.current[1] = 0.05;
        sunDirArray.current[2] = -pz / len;
      }
      // Direction toward companion star (circumbinary / close binary)
      if (compOrbitR && (sunBrightness2 ?? 0) > 0) {
        const a2 = (t * Math.PI * 2) / Math.max(compVizPrd ?? 10, 4);
        const cx = Math.cos(a2) * compOrbitR;
        const cz = Math.sin(a2) * compOrbitR;
        const dx = cx - px, dz = cz - pz;
        const len2 = Math.sqrt(dx * dx + dz * dz);
        if (len2 > 0.001) {
          sunDir2Array.current[0] = dx / len2;
          sunDir2Array.current[1] = 0.05;
          sunDir2Array.current[2] = dz / len2;
        }
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
      {/* System-depth: always use simple sphere — ProceduralPlanet's 3300-line shader
          compiled N times simultaneously (one per planet) kills the WebGL context.
          The full shader only fires when the user drills into planet depth. */}
      <mesh>
        <sphereGeometry args={[r, 32, 32]} />
        <meshStandardMaterial
          color={color}
          emissive={active ? color : '#000'}
          emissiveIntensity={active ? 0.6 : 0}
          roughness={0.6} metalness={0.2}
        />
      </mesh>

      {active && (
        <mesh ref={glow}>
          <sphereGeometry args={[r * 2.5, 16, 16]} />
          <meshBasicMaterial color="#4d9fff" transparent opacity={0.18}
            depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
      )}

      {/* Atmosphere rim — only worlds with enough mass and a known atmosphere.
          Uses same thresholds as ProceduralWorld: mass >= 0.05, temp > 80K,
          and not an explicitly airless planet type. */}
      {(temperature ?? 200) > 80 && (mass ?? 0) >= 0.05 &&
       !AIRLESS_TYPES.has(planetType ?? '') && (
        <mesh>
          <sphereGeometry args={[r * 1.10, 20, 20]} />
          <meshBasicMaterial
            color={(() => {
              const T = temperature ?? 280;
              if (T > 900) return '#ff7722';
              if (T > 500) return '#ffcc88';
              if (T > 200) return '#aaccff';
              return '#8899cc';
            })()}
            transparent
            opacity={Math.min(0.10, (mass ?? 0.05) * 0.028 + 0.022)}
            depthWrite={false}
            side={THREE.BackSide}
            blending={THREE.AdditiveBlending}
          />
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

      <Html position={[0, r + 0.18, 0]} center style={{
        fontSize: '11px', color: active ? '#c0d8ff' : '#7899bb',
        opacity: active ? 1 : 0.65, pointerEvents: 'none',
        whiteSpace: 'nowrap', userSelect: 'none',
      }}>
        {label}
      </Html>
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
// ── Hapke BRDF shaders (Lommel-Seeliger law + opposition surge) ─────────────
// Used for airless rocky/icy bodies — more physically accurate than Lambert.
export const HAPKE_VERT = /* glsl */`
varying vec3 vColor;
varying vec3 vNormal;
varying vec3 vWorldPos;
void main() {
  vColor    = color;
  // World-space normal — mat3(modelMatrix) is correct for uniform-scale groups
  vNormal   = normalize(mat3(modelMatrix) * normal);
  vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
export const HAPKE_FRAG = /* glsl */`
uniform vec3  uSunDir;
uniform vec3  uCamPos;
uniform float uAlbedo;
varying vec3  vColor;
varying vec3  vNormal;
varying vec3  vWorldPos;
void main() {
  vec3  N  = normalize(vNormal);
  vec3  L  = normalize(uSunDir);
  vec3  V  = normalize(uCamPos - vWorldPos);
  float mu0 = max(dot(N, L), 0.0);
  float mu  = max(dot(N, V), 0.0);
  // Lommel-Seeliger: dominant scattering law for regolith-covered airless surfaces
  float hapke = mu0 / (mu0 + mu + 0.025);
  // Opposition surge: narrow brightness spike at zero phase (shadow-hiding effect)
  float cosPhase = dot(L, V);
  float phase    = acos(clamp(cosPhase, -1.0, 1.0));
  float surge    = 1.0 + 0.70 * exp(-phase * phase * 160.0);
  float light    = hapke * surge;
  // Dim cosmic ambient (zodiacal light)
  float ambient  = 0.012;
  vec3  col = vColor * uAlbedo * (light + ambient);
  col = pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2));
  gl_FragColor = vec4(col, 1.0);
}`;

export function PotatoMoon({ seed, color, color2, roughness = 0.92, metalness = 0.05, detail = 4,
    deformStyle = 'generic', hapkeAlbedo, sunDir }: {
  seed: number; color: string; color2?: string; roughness?: number; metalness?: number; detail?: number;
  deformStyle?: 'generic' | 'miranda' | 'hyperion' | 'eros';
  hapkeAlbedo?: number;      // if set, uses Hapke BRDF instead of meshStandard
  sunDir?: THREE.Vector3;    // required when hapkeAlbedo is set
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

  const hapkeMat = useMemo(() => {
    if (hapkeAlbedo == null) return null;
    return new THREE.ShaderMaterial({
      vertexShader:   HAPKE_VERT,
      fragmentShader: HAPKE_FRAG,
      vertexColors:   true,
      uniforms: {
        uSunDir:  { value: sunDir ?? new THREE.Vector3(1, 0.5, 0.3).normalize() },
        uCamPos:  { value: new THREE.Vector3(0, 3, 7) },
        uAlbedo:  { value: hapkeAlbedo },
      },
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hapkeAlbedo]);

  const meshRef = useRef<THREE.Mesh>(null!);
  useFrame(({ camera }) => {
    if (hapkeMat) {
      (hapkeMat.uniforms.uCamPos.value as THREE.Vector3).copy(camera.position);
      if (sunDir) (hapkeMat.uniforms.uSunDir.value as THREE.Vector3).copy(sunDir);
    }
  });

  return (
    <mesh ref={meshRef} geometry={geo} material={hapkeMat ?? undefined}>
      {!hapkeMat && (
        <meshStandardMaterial vertexColors roughness={roughness} metalness={metalness} />
      )}
    </mesh>
  );
}

/* ━━ Deterministic LCG — sequential calls yield decorrelated 0..1 values ━━ */
export function seededRng(seed: number): () => number {
  let s = (Math.floor(Math.abs(seed * 134775813)) ^ 0xdeadbeef) | 1;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) | 0;
    return (s >>> 0) / 4294967296;
  };
}

/* ━━ Faint inclined orbit ring for a captured-moon family ━━━━━━━━━━━━━━━━
 * Shows the tilted orbital plane of each irregular family — much more
 * expressive than individual dots alone. Very low opacity to not clutter. */
export function IrregularFamilyRing({ radius, color }: { radius: number; color: string }) {
  const lineObj = useMemo(() => {
    if (!isFinite(radius) || radius <= 0) return null;
    const segs = 96;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
    });
    return new THREE.Line(geo, mat);
  }, [radius, color]);

  if (!lineObj) return null;
  return <primitive object={lineObj} />;
}

/* ━━ Captured Asteroid Mini-Moon ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Single tumbling irregular body. Inclination applied by parent groups
 * (LAN rotation + orbital tilt). Handles in-plane orbit + chaotic spin.
 * Uses Hapke BRDF for physically accurate airless-body scattering. */
export function CapturedMiniMoon({
  orbitR, r, period, startAngle, seed, color, color2,
  spinRate, deformStyle, hapkeAlbedo,
}: {
  orbitR: number; r: number; period: number;
  startAngle: number; seed: number;
  color: string; color2: string; spinRate: number;
  deformStyle: 'generic' | 'hyperion' | 'eros';
  hapkeAlbedo: number;
}) {
  const grp    = useRef<THREE.Group>(null!);
  const body   = useRef<THREE.Group>(null!);
  const sunRef = useRef(new THREE.Vector3(-1, 0.5, 0.5).normalize());

  // Unique off-axis spin per body — tumbling on eccentric axis
  const spinAxis = useMemo(() => new THREE.Vector3(
    Math.cos(seed * 6.28), Math.sin(seed * 9.42 + 1.3), Math.cos(seed * 3.77 + 2.1),
  ).normalize(), [seed]);

  useFrame(() => {
    const a = startAngle + (_orbit.time * Math.PI * 2) / Math.max(period, 3);
    if (grp.current) {
      grp.current.position.x = Math.cos(a) * orbitR;
      grp.current.position.z = Math.sin(a) * orbitR;
    }
    if (body.current) body.current.rotateOnAxis(spinAxis, spinRate);
  });

  return (
    <group ref={grp}>
      <group ref={body} scale={[r, r, r]}>
        <PotatoMoon
          seed={seed} color={color} color2={color2}
          deformStyle={deformStyle} detail={3}
          roughness={0.95} metalness={0.02}
          hapkeAlbedo={hapkeAlbedo} sunDir={sunRef.current}
        />
      </group>
    </group>
  );
}

/* ━━ Captured Mini-Moon Swarm ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Outer irregular population — 2-4 orbital families modelling real groups
 * (Jupiter: Himalia/Ananke/Carme/Pasiphae, Saturn: Inuit/Norse/Gallic,
 * Neptune: Triton captured KBO family, etc.).
 *
 * Each family shares:
 *   - A common orbital inclination ± small scatter (family origin from
 *     a common parent body)
 *   - A spectral class (C/D/P-type dark or icy KBO-class for outer giants)
 *   - A faint inclined orbit ring marking its tilted plane
 *
 * Body sizes follow a power law (many tiny, few large "anchor" bodies).
 * Deform styles vary: eros (elongated/contact binary), hyperion (pitted),
 * generic (lumpy). Hapke BRDF gives physically correct dark-surface shading. */
export function CapturedMiniMoonSwarm({
  seed, outerR, planetMass, planetType,
}: {
  seed: number; outerR: number; planetMass: number; planetType: string;
}) {
  const GAS_TYPES = new Set([
    'gas-giant','super-jupiter','neptune-like','warm-neptune','mini-neptune',
    'sub-neptune','hot-jupiter','cloudless-hot-jupiter','night-cloud-giant',
    'water-cloud-giant','nh4sh-cloud-giant',
  ]);
  const isGasGiant = GAS_TYPES.has(planetType) || planetMass > 15;
  const isOuterGiant = isGasGiant && (
    planetType === 'neptune-like' || planetType === 'warm-neptune' ||
    planetType === 'mini-neptune' || planetMass > 200
  );

  // Outer ice giants & super-Jupiters get an extra icy family (captured KBO class)
  const nFamilies  = isGasGiant ? (isOuterGiant ? 4 : 3) : 2;
  const familySizes = isGasGiant
    ? (isOuterGiant ? [5, 6, 4, 3] : [5, 4, 6, 0])
    : [4, 3, 0, 0];

  // Spectral classes — each family inherits one. C-heavy, some D/P, icy for outer.
  type FamilyClass = 'C' | 'D' | 'P' | 'ICY';
  const CLASS_PALETTES: Record<FamilyClass, { colors: [string,string][]; albedo: number }> = {
    C:   { colors: [['#2a2520','#141210'],['#322c26','#1a1612'],['#1e1c1a','#0e0c0a']], albedo: 0.06 },
    D:   { colors: [['#3e2818','#1e0e06'],['#4a3020','#26160a'],['#502818','#281408']], albedo: 0.05 },
    P:   { colors: [['#2e2018','#16100a'],['#382418','#1c120c'],['#261a14','#12100a']], albedo: 0.04 },
    ICY: { colors: [['#aabccc','#6880a0'],['#c0d0e0','#8098c0'],['#b8c8dc','#7090b8']], albedo: 0.38 },
  };

  // Family class distribution: C-type most common for inner gas giants,
  // outer giants get one icy family
  const familyClasses: FamilyClass[] = isOuterGiant
    ? ['C', 'D', 'P', 'ICY']
    : ['C', 'D', 'C', 'C'];

  // Deform style weights: [eros, hyperion, generic] probabilities (cumulative)
  const DEFORM_THRESH = [0.20, 0.62]; // <0.20 → eros, <0.62 → hyperion, else → generic

  const data = useMemo(() => {
    const rng  = seededRng(seed + 7919);
    const base = outerR + 0.42;

    const families: {
      familyR: number; LAN: number; incl: number; ringColor: string;
      bodies: {
        orbitR: number; LAN: number; incl: number;
        period: number; startAngle: number; seed: number;
        r: number; color: string; color2: string;
        spinRate: number; deformStyle: 'generic' | 'hyperion' | 'eros';
        hapkeAlbedo: number;
      }[];
    }[] = [];

    for (let f = 0; f < nFamilies; f++) {
      if (familySizes[f] === 0) continue;
      const cls       = familyClasses[f];
      const pal       = CLASS_PALETTES[cls];
      const familyR   = base + f * 0.62 + rng() * 0.32;
      const inclSign  = rng() > 0.40 ? 1 : -1;    // ~40% retrograde
      const inclMag   = 0.44 + rng() * 2.58;       // 25–148°
      const familyIncl= inclSign * inclMag;
      const familyLAN = rng() * Math.PI * 2;
      // Ring color hint matches spectral class
      const ringColor = cls === 'ICY' ? '#7aaccc'
        : cls === 'D' ? '#7a5040'
        : cls === 'P' ? '#504438'
        : '#607080';

      const bodyList: typeof families[0]['bodies'] = [];
      for (let i = 0; i < familySizes[f]; i++) {
        // Power-law size: most bodies tiny, occasional larger anchor
        const u = rng();
        const r = 0.009 * Math.pow(0.030 / 0.009, u * u);  // power-law 0.009–0.030

        // Deform style per body
        const dv = rng();
        const ds: 'generic' | 'hyperion' | 'eros' =
          dv < DEFORM_THRESH[0] ? 'eros'
          : dv < DEFORM_THRESH[1] ? 'hyperion'
          : 'generic';

        // Family color + slight per-body variation
        const palIdx = Math.floor(rng() * pal.colors.length);
        bodyList.push({
          orbitR:      familyR + (rng() - 0.5) * 0.30,
          LAN:         familyLAN + (rng() - 0.5) * 0.35,
          incl:        familyIncl + (rng() - 0.5) * 0.20,
          period:      10 + rng() * 26,
          startAngle:  rng() * Math.PI * 2,
          seed:        seed * 7919 + f * 397 + i,
          r,
          color:       pal.colors[palIdx][0],
          color2:      pal.colors[palIdx][1],
          spinRate:    0.005 + rng() * 0.016,
          deformStyle: ds,
          hapkeAlbedo: pal.albedo * (0.8 + rng() * 0.4),
        });
      }
      families.push({ familyR, LAN: familyLAN, incl: familyIncl, ringColor, bodies: bodyList });
    }
    return families;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed, outerR, nFamilies]);

  return (
    <>
      {data.map((fam, fi) => (
        <group key={`cmm-fam-${fi}`} rotation={[0, fam.LAN, 0]}>
          <group rotation={[fam.incl, 0, 0]}>
            {/* Faint orbit ring marks the family's inclined plane */}
            <IrregularFamilyRing radius={fam.familyR} color={fam.ringColor} />
            {fam.bodies.map((b, bi) => (
              <group key={`cmm-${fi}-${bi}`} rotation={[0, b.LAN - fam.LAN, 0]}>
                <group rotation={[b.incl - fam.incl, 0, 0]}>
                  <CapturedMiniMoon
                    orbitR={b.orbitR} r={b.r}
                    period={b.period} startAngle={b.startAngle}
                    seed={b.seed} color={b.color} color2={b.color2}
                    spinRate={b.spinRate} deformStyle={b.deformStyle}
                    hapkeAlbedo={b.hapkeAlbedo}
                  />
                </group>
              </group>
            ))}
          </group>
        </group>
      ))}
    </>
  );
}

/** Orbiting moon — simple sphere at planet depth (full shader only at moon depth) */
export function OrbitingMoon({
  orbitR, r, vizPrd, startAngle, active, onClick, label,
  seed,
  isPotato, potatoColor, potatoColor2, potatoDeform,
  hasAtmosphere, atmColor,
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
          // Simple sphere for orbiting moons — ProceduralPlanet's shader compiled
          // per-moon simultaneously blows the WebGL context. Full shader only at moon depth.
          <mesh>
            <sphereGeometry args={[1, 24, 24]} />
            <meshStandardMaterial
              color={potatoColor || '#9988aa'}
              emissive={active ? (potatoColor || '#9988aa') : '#000'}
              emissiveIntensity={active ? 0.3 : 0}
              roughness={0.8} metalness={0.05}
            />
          </mesh>
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
      <Html position={[0, r + 0.12, 0]} center style={{
        fontSize: '9px', color: active ? '#c0d8ff' : '#7899bb',
        opacity: active ? 1 : 0.55, pointerEvents: 'none',
        whiteSpace: 'nowrap', userSelect: 'none',
      }}>
        {label}
      </Html>
    </group>
  );
}

/* ---- Star surface shader with solar granulation, limb darkening, sunspots ---- */
export const STAR_VERT = `
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

export const STAR_FRAG = `
precision mediump float;
uniform float uTime;
uniform vec3  uColor;
uniform vec3  uHotColor;
uniform float uHot;
varying vec3 vNormal;
varying vec3 vPosition;

// Loop-free star surface — limb darkening + subtle hash-noise shimmer.
// Replaces the Voronoi convection version which caused D3D11 TDR on Windows.
float h(float n) { return fract(sin(n) * 43758.5453); }

void main() {
  vec3  N  = normalize(vNormal);
  vec3  V  = normalize(cameraPosition - vPosition);
  float mu = max(dot(N, V), 0.0);

  // Limb darkening (Eddington approximation)
  float limb = max(1.0 - 0.40*(1.0-mu) - 0.12*(1.0-mu*mu), 0.20);
  float ef   = (1.0 - mu) * (1.0 - uHot * 0.55);
  vec3  limbTint = vec3(1.0 + ef*0.10, 1.0 - ef*0.05, 1.0 - ef*0.20);

  // Temperature color blend: cool orange → hot blue-white
  vec3 mPeak = vec3(1.00, 0.44, 0.08);
  vec3 gPeak = vec3(1.00, 0.86, 0.48);
  vec3 aPeak = vec3(0.95, 0.98, 1.00);
  float t1 = smoothstep(0.0, 0.5, uHot);
  float t2 = smoothstep(0.5, 1.0, uHot);
  vec3 peakCol = mix(mix(mPeak, gPeak, t1), aPeak, t2);

  // Subtle brightness shimmer from hash noise on surface normal (no loops)
  vec3 sp = normalize(vNormal);
  float n0 = h(floor(sp.x*8.0 + sp.y*13.0 + sp.z*7.0 + uTime * 0.4) + 0.1);
  float n1 = h(floor(sp.x*5.0 + sp.y*11.0 + sp.z*9.0 + uTime * 0.3) + 0.7);
  float shimmer = 0.92 + 0.08 * mix(n0, n1, 0.5);

  // Chromospheric edge brightening at limb
  float mu3    = (1.0 - mu) * (1.0 - mu) * (1.0 - mu);
  float chromo = mu3 * mix(0.55, 0.18, uHot);

  vec3 surfCol = peakCol * (limb * limbTint * shimmer * 1.5 + chromo * 0.8);
  surfCol     *= 1.0 + 0.008*sin(uTime*1.8) + 0.004*sin(uTime*3.1);

  gl_FragColor = vec4(clamp(surfCol, 0.0, 2.0), 1.0);
}`;

/* ---- Corona billboard shader — 2D filaments, prominences, streamer rays ---- */
export const CORONA_BILLBOARD_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

export const CORONA_FRAG = `
precision mediump float;
uniform float uTime;
uniform vec3  uColor;
varying vec2  vUv;

// Loop-free corona — replaces the FBM+streamer-loop version that caused D3D11 TDR.
const float starR = 0.125;

void main() {
  vec2  c     = vUv - 0.5;
  float r     = length(c);
  if (r < starR * 0.90) discard;

  float angle = atan(c.y, c.x);
  float d     = max(r - starR, 0.0) / (0.5 - starR);
  float mask  = smoothstep(starR * 0.88, starR * 1.08, r);

  // Radial corona falloff
  float base = (exp(-d*d*5.5) + exp(-d*4.0)*0.45) * mask;

  // Loop-free streamer: sum of 4 sin terms (unrolled)
  float s  = sin(angle*1.7  + uTime*0.007) * 1.000
           + sin(angle*3.4  + uTime*0.011) * 0.500
           + sin(angle*8.5  + uTime*0.020) * 0.250
           + sin(angle*11.9 + uTime*0.016) * 0.167;
  float streamer = s * 0.5 / 1.917 + 0.5;
  streamer = 0.30 + 0.70 * streamer * streamer;

  // Chromosphere ring
  float chromD = (r - starR) / starR;
  float chrom  = exp(-chromD*chromD*85.0) * 2.8 * mask;

  float hotFrac = dot(uColor, vec3(0.15,0.30,0.55));
  vec3 innerCol = mix(vec3(1.0,0.94,0.82), vec3(0.92,0.96,1.0), hotFrac);
  vec3 outerCol = mix(uColor * 1.15, vec3(0.55,0.68,1.0), hotFrac * 0.5);
  vec3 coronaCol= mix(innerCol, outerCol, smoothstep(0.0, 0.50, d));
  vec3 chromCol = mix(vec3(1.0,0.62,0.28), vec3(0.9,0.95,1.0), hotFrac);

  float pulse = 0.85 + 0.15 * sin(uTime*0.38 + angle*1.4);
  float baseA = base * streamer * pulse * 0.65;
  float chromA= chrom * 0.60;
  float finalA= baseA + chromA;
  if (finalA < 0.004) discard;

  vec3 finalCol = coronaCol * baseA * (1.0 + 0.04*sin(uTime*3.2 + angle*2.1))
                + chromCol  * chromA;
  gl_FragColor  = vec4(finalCol, finalA);
}`;

// ── Procedural solar granulation texture ─────────────────────────────────────
// Generates a DataTexture approximating photospheric convection cells via FBM.
// Two instances with different seeds are used as rotating layers.
/* ---- Seamless procedural granulation layers (use vObjNormal, no UV seam) ---- */
// LAYER_VERT / LAYER_FRAG removed — used 5-octave FBM loops that caused D3D11 TDR.

/* ---- Inner rim glow billboard — bright at disk edge, transparent toward center ---- */
export const RIM_GLOW_FRAG = `
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

export function OrreryStar({ color, size, teff, occludable = false }: { color: string; size: number; teff?: number; occludable?: boolean }) {
  const matRef = useRef<THREE.ShaderMaterial>(null!);
  const coronaRef = useRef<THREE.ShaderMaterial>(null!);
  const glowRef = useRef<THREE.Group>(null!);

  const starCol = useMemo(() => new THREE.Color(color), [color]);
  const hotCol = useMemo(() => {
    const c = new THREE.Color(color);
    const t = teff ?? 5778;
    const whiteTarget = t > 7500 ? '#e8eeff' : t > 5500 ? '#fffbe8' : t > 4000 ? '#ffe8c0' : '#ffd0a0';
    const whiteFrac = t > 7500 ? 0.7 : t > 5500 ? 0.6 : t > 4000 ? 0.4 : 0.25;
    c.lerp(new THREE.Color(whiteTarget), whiteFrac);
    return c;
  }, [color, teff]);

  const hotFrac = useMemo(() => {
    const t = teff ?? 5778;
    return Math.min(1.0, Math.max(0.0, (t - 3000) / 9000));
  }, [teff]);

  const starUniforms = useMemo(() => ({
    uTime:     { value: 0 },
    uColor:    { value: starCol },
    uHotColor: { value: hotCol },
    uHot:      { value: hotFrac },
  }), [starCol, hotCol, hotFrac]);

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
    if (glowRef.current) glowRef.current.quaternion.copy(camera.quaternion);
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

      {/* Granulation layer meshes removed — LAYER_FRAG used 5-octave FBM loop
          which caused D3D11 TDR (GPU timeout) on Windows/ANGLE. */}

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

/** Companion star in circumbinary / wide binary systems — orbits the origin */
export function CompanionStar({ orbitR, color, size, teff, vizPrd }: {
  orbitR: number; color: string; size: number; teff?: number; vizPrd: number;
}) {
  const grp = useRef<THREE.Group>(null!);
  useFrame(() => {
    const t = _orbit.time;
    const a = (t * Math.PI * 2) / Math.max(vizPrd, 4);
    if (grp.current) {
      grp.current.position.x = Math.cos(a) * orbitR;
      grp.current.position.z = Math.sin(a) * orbitR;
    }
  });
  return (
    <group ref={grp}>
      <OrreryStar color={color} size={size} teff={teff} />
    </group>
  );
}

/** Animated point light that follows the companion star position each frame */
export function CompanionLight({ orbitR, color, vizPrd }: { orbitR: number; color: string; vizPrd: number }) {
  const lightRef = useRef<THREE.PointLight>(null!);
  useFrame(() => {
    const t = _orbit.time;
    const a = (t * Math.PI * 2) / Math.max(vizPrd, 4);
    if (lightRef.current) {
      lightRef.current.position.set(Math.cos(a) * orbitR, 0.3, Math.sin(a) * orbitR);
    }
  });
  return <pointLight ref={lightRef} intensity={1.2} color={color} distance={35} />;
}

/** Distant parent star visible from planet/moon depth — bright disc with animated convection */

export function HabitableZone({ inner, outer, starVisR, maxSma }: {
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

export function BeltParticles({ belt, starVisR, maxSma }: {
  belt: any; starVisR: number; maxSma: number;
}) {
  const groupRef = useRef<THREE.Group>(null!);

  const data = useMemo(() => {
    const inner = logBeltRadius(belt.inner_radius_au || 2, starVisR, maxSma);
    const outer = logBeltRadius(belt.outer_radius_au || 4, starVisR, maxSma);

    const isTrojan        = belt.belt_type === 'trojan-swarm';
    const isIcy           = belt.belt_type === 'icy-kuiper' || belt.belt_type === 'scattered-disc';
    const isScatteredDisc = belt.belt_type === 'scattered-disc';
    // Icy belts get 20% more particles; scattered disc gets 30% more (denser outer cloud)
    const icyBonus = isScatteredDisc ? 1.30 : isIcy ? 1.20 : 1.0;
    const count = Math.min(Math.floor((belt.estimated_bodies || 1000) / 120 * icyBonus), 600);
    const pos  = new Float32Array(count * 3);
    const col  = new Float32Array(count * 3);
    const sz   = new Float32Array(count);          // per-particle size
    const ang  = new Float32Array(count);          // initial orbital angle (for animation)
    const spd  = new Float32Array(count);          // orbital angular speed (Kepler)

    let s = 42 + Math.round((belt.inner_radius_au || 0) * 997);
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };

    const baseA       = isTrojan ? (belt.angular_offset_deg || 60) * Math.PI / 180 : 0;
    const spread      = isTrojan ? (belt.angular_spread_deg || 15) * Math.PI / 180 : Math.PI * 2;
    const beltWidth   = outer - inner;

    const gaps = (belt.resonance_gaps || []).map((g: any) => ({
      lo: logBeltRadius(g.position_au - g.width_au / 2, starVisR, maxSma),
      hi: logBeltRadius(g.position_au + g.width_au / 2, starVisR, maxSma),
    }));

    // Build spectral-class palette from families (falls back to belt-type color)
    const families: { spectral_class?: string }[] = belt.families || [];
    // KBO/icy palette: tholins, methane ice, water ice, dark organics
    const KBO_PALETTE = [
      new THREE.Color(0.55, 0.22, 0.08),  // tholin rust-red (Sedna-like)
      new THREE.Color(0.90, 0.82, 0.78),  // methane frost pale pink-white
      new THREE.Color(0.38, 0.52, 0.72),  // water ice blue-grey
      new THREE.Color(0.18, 0.13, 0.11),  // amorphous carbon (very dark)
      new THREE.Color(0.72, 0.62, 0.50),  // mixed ice/tholin mid-tone
    ];
    const palette: THREE.Color[] = families.length > 0
      ? families.map((f) => spectralColor(f.spectral_class))
      : isIcy ? KBO_PALETTE
      : belt.belt_type === 'trojan-swarm' ? [new THREE.Color(0.52, 0.62, 0.38)]
      : [new THREE.Color(0.53, 0.46, 0.34)];

    // Azimuthal clump centres — asteroid families cluster in angle space
    const clumpCount = Math.max(1, Math.min(families.length, 6));
    const clumpAngles = Array.from({ length: clumpCount }, (_, i) =>
      (i / clumpCount) * Math.PI * 2 + rnd() * 0.8
    );

    let placed = 0, att = 0;
    while (placed < count && att < count * 8) {
      att++;

      // Radial position — slight density peak in belt midpoint (triangular pdf)
      const u1 = rnd(), u2 = rnd();
      const rFrac = u1 < 0.5 ? Math.sqrt(u1 * 2) * 0.5 : 1.0 - Math.sqrt((1 - u1) * 2) * 0.5;
      const r = inner + rFrac * beltWidth;

      if (gaps.some((g: { lo: number; hi: number }) => r >= g.lo && r <= g.hi)) continue;

      const a = isTrojan
        ? baseA + (rnd() - 0.5) * spread
        : rnd() * Math.PI * 2;

      // Azimuthal clumping: bias color toward nearest clump family
      let nearestClump = 0, nearestDist = Infinity;
      for (let ci = 0; ci < clumpCount; ci++) {
        const diff = Math.abs(a - clumpAngles[ci]);
        const d = Math.min(diff, Math.PI * 2 - diff);
        if (d < nearestDist) { nearestDist = d; nearestClump = ci; }
      }
      const clumpStr = Math.max(0, 1.0 - nearestDist / (Math.PI / clumpCount));
      const familyCol = palette[nearestClump % palette.length].clone();
      let c: THREE.Color;
      if (isIcy) {
        // Radial gradient: inner = water ice/mixed, outer = tholins + dark organics
        const radialT = Math.max(0, Math.min(1, (r - inner) / Math.max(beltWidth, 0.001)));
        // Water ice (blue-grey) at inner edge → tholin (rust-red) at outer edge
        const waterIce  = new THREE.Color(0.38, 0.52, 0.72);
        const tholin    = new THREE.Color(0.55, 0.22, 0.08);
        const baseCol   = waterIce.lerp(tholin, radialT * 0.65);
        c = baseCol.lerp(familyCol, 0.35 + clumpStr * 0.35);
        // Radial dimming: outer-belt particles receive less sunlight
        const brightFall = 1.0 - radialT * 0.35;
        c.multiplyScalar((0.55 + rnd() * 0.50) * brightFall);
      } else {
        const baseCol = new THREE.Color(0.53, 0.46, 0.34);
        c = baseCol.lerp(familyCol, 0.45 + clumpStr * 0.40);
        c.multiplyScalar(0.65 + rnd() * 0.40);
      }

      // Inclination: scattered disc dramatically more vertical (30°+ inclinations common)
      const inclFactor = isScatteredDisc ? 0.60 : isIcy ? 0.35 : 0.12;
      const y = (rnd() - 0.5) * beltWidth * inclFactor * (0.5 + (r - inner) / beltWidth);

      // Power-law size distribution: most particles small, a few large
      // KBO particles are genuinely larger (100–2400 km) → bigger point sizes
      const powSize = Math.pow(rnd(), 2.2);   // skewed toward small
      const pSize   = isIcy
        ? 3.5 + powSize * 9.0                 // KBO range 3.5–12.5 px
        : 2.5 + powSize * 6.5;               // rocky range 2.5–9.0 px

      // Orbital speed: v ∝ 1/√r (Keplerian — outer belt slower)
      const kepSpeed = 0.0004 / Math.sqrt(Math.max(r, 0.01));

      pos[placed * 3]     = Math.cos(a) * r;
      pos[placed * 3 + 1] = y;
      pos[placed * 3 + 2] = Math.sin(a) * r;
      col[placed * 3]     = c.r;
      col[placed * 3 + 1] = c.g;
      col[placed * 3 + 2] = c.b;
      sz[placed]  = pSize;
      ang[placed] = a;
      spd[placed] = kepSpeed * u2 * 0.3 + kepSpeed * 0.85;  // slight speed spread
      placed++;
    }

    return {
      pos:  pos.slice(0, placed * 3),
      col:  col.slice(0, placed * 3),
      sz:   sz.slice(0, placed),
      ang:  ang.slice(0, placed),
      spd:  spd.slice(0, placed),
      n:    placed,
    };
  }, [belt, starVisR, maxSma]);

  // Orbital animation: rotate the whole belt group (approximation — avoids per-vertex updates)
  // Each orbit speed is different, but we animate the group at the median speed for visual effect.
  const medianSpd = useMemo(() => {
    if (data.n === 0) return 0;
    const sorted = [...data.spd].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }, [data]);

  useFrame((_, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * medianSpd * 0.5;
    }
  });

  const beltShader = useMemo(() => ({
    vertexShader: `
      attribute vec3 color;
      attribute float aSize;
      varying vec3 vColor;
      varying float vLit;
      void main() {
        vColor = color;
        vec3 toStar = -normalize(position);
        vec3 toCam  = normalize(cameraPosition - position);
        float NdotL = dot(toCam, toStar);
        vLit = NdotL * 0.35 + 0.65;
        vec4 mvp = modelViewMatrix * vec4(position, 1.0);
        // Perspective scale: clamp prevents runaway size when camera is close
        float ps = aSize * (80.0 / max(-mvp.z, 1.0));
        gl_PointSize = clamp(ps, 0.5, 10.0);
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
        float soft = 1.0 - smoothstep(0.06, 0.25, d);
        gl_FragColor = vec4(vColor * vLit * 0.85, soft * 0.60);
      }
    `,
  }), []);

  if (data.n === 0) return null;
  return (
    <group ref={groupRef}>
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[data.pos, 3]} />
          <bufferAttribute attach="attributes-color"   args={[data.col, 3]} />
          <bufferAttribute attach="attributes-aSize"   args={[data.sz,  1]} />
        </bufferGeometry>
        <shaderMaterial
          vertexShader={beltShader.vertexShader}
          fragmentShader={beltShader.fragmentShader}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
    </group>
  );
}

export function Starfield() {
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
              gl_PointSize = clamp(aSize * (280.0 / max(-mv.z, 8.0)), 0.3, 4.0);
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

export function HabitatStation({ orbitR, period, startAngle, type, label }: {
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
      <Html position={[0, cR + 0.08, 0]} center style={{
        fontSize: '8px', color: '#4d9fff',
        opacity: 0.55, pointerEvents: 'none',
        whiteSpace: 'nowrap', userSelect: 'none',
      }}>
        {label}
      </Html>
    </group>
  );
}

/* ━━ Habitat orbit ring indicator ━━ */

export function HabitatOrbitRing({ radius }: { radius: number }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[radius - 0.003, radius + 0.003, 64]} />
      <meshBasicMaterial color="#4d9fff" transparent opacity={0.08}
        depthWrite={false} blending={THREE.AdditiveBlending} />
    </mesh>
  );
}

/* ━━ Temperature Zone Overlay ━━ */
export function TemperatureZone({ starTeff, starLum, starVisR, maxSma }: {
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
export function RadiationZone({ starLum, starVisR, maxSma }: {
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
export function FrostLine({ starLum, starVisR, maxSma }: {
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
export function ProceduralAsteroid({ seed, size, position: pos, color, tumbleAxis, roughness = 0.94, metalness = 0.04 }: {
  seed: number; size: number; position: [number, number, number]; color: string;
  tumbleAxis: THREE.Vector3; roughness?: number; metalness?: number;
}) {
  const meshRef = useRef<THREE.Mesh>(null!);
  const tumbleSpeed = useMemo(() => 0.15 + (seed % 1.0) * 0.55, [seed]);

  const geo = useMemo(() => {
    const g = new THREE.IcosahedronGeometry(1, 3);  // subdiv 3 for rounder base
    const p = g.attributes.position;
    const s = seed * 173 + 31;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      // Multi-frequency deformation — blobby irregular shape
      const n1 = Math.sin(x * 2.3 + s) * Math.cos(y * 3.1 + s * 0.6) * Math.sin(z * 1.9 + s * 1.4) * 0.32;
      const n2 = Math.sin(x * 5.7 + s * 2.1) * Math.cos(y * 4.3 + s * 1.8) * 0.16;
      const n3 = Math.sin(x * 11 + y * 9 + z * 7 + s * 3) * 0.05;
      // Elongation axis (most asteroids are elongated 2:1)
      const elongate = 0.65 + Math.abs(Math.sin(s * 0.37)) * 0.70;
      const sc = 0.52 + n1 + n2 + n3;
      // Crater dimples: a few vertices get pushed inward
      const dimple = (Math.sin(x * 8.3 + s * 4.7) > 0.78 && Math.cos(y * 7.1 + s * 2.3) > 0.72)
        ? 0.82 : 1.0;
      p.setXYZ(i, x * sc * elongate * dimple, y * sc * 0.78 * dimple, z * sc * dimple);
    }
    p.needsUpdate = true;
    g.computeVertexNormals();
    return g;
  }, [seed]);

  useFrame((_, delta) => {
    if (meshRef.current) {
      meshRef.current.rotateOnAxis(tumbleAxis, delta * tumbleSpeed);
    }
  });

  return (
    <mesh ref={meshRef} geometry={geo} position={pos} scale={[size, size, size]}>
      <meshStandardMaterial color={color} roughness={roughness} metalness={metalness} />
    </mesh>
  );
}

/* ━━ Belt Asteroid Field (visible 3D asteroids) ━━ */
export function BeltAsteroids({ belt, starVisR, maxSma }: {
  belt: any; starVisR: number; maxSma: number;
}) {
  const asteroids = useMemo(() => {
    const inner = logBeltRadius(belt.inner_radius_au || 2, starVisR, maxSma);
    const outer = logBeltRadius(belt.outer_radius_au || 4, starVisR, maxSma);
    const beltWidth = outer - inner;
    const count = Math.min(Math.floor((belt.estimated_bodies || 1000) / 600), 80);
    let s = 77 + Math.round((belt.inner_radius_au || 0) * 1337);
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const isTrojan = belt.belt_type === 'trojan-swarm';
    const baseA = isTrojan ? (belt.angular_offset_deg || 60) * Math.PI / 180 : 0;
    const spread = isTrojan ? (belt.angular_spread_deg || 15) * Math.PI / 180 : Math.PI * 2;
    const isIcy           = belt.belt_type === 'icy-kuiper' || belt.belt_type === 'scattered-disc';
    const isScatteredDisc = belt.belt_type === 'scattered-disc';
    const inclFactor = isScatteredDisc ? 0.60 : isIcy ? 0.32 : 0.14;

    // Gaps to avoid (same as BeltParticles)
    const gaps = (belt.resonance_gaps || []).map((g: any) => ({
      lo: logBeltRadius(g.position_au - g.width_au / 2, starVisR, maxSma),
      hi: logBeltRadius(g.position_au + g.width_au / 2, starVisR, maxSma),
    }));

    // Spectral palette + material props from families
    const families: { spectral_class?: string }[] = belt.families || [];
    const KBO_PALETTE_3D = [
      new THREE.Color(0.55, 0.22, 0.08),  // tholin rust-red
      new THREE.Color(0.90, 0.82, 0.78),  // methane frost pale
      new THREE.Color(0.38, 0.52, 0.72),  // water ice blue-grey
      new THREE.Color(0.20, 0.14, 0.12),  // dark organics
      new THREE.Color(0.70, 0.58, 0.46),  // mixed ice/tholin
    ];
    const palette: THREE.Color[] = families.length > 0
      ? families.map((f) => spectralColor(f.spectral_class))
      : isIcy ? KBO_PALETTE_3D
      : belt.belt_type === 'trojan-swarm' ? [new THREE.Color(0.50, 0.60, 0.36)]
      : [new THREE.Color(0.55, 0.48, 0.36)];

    // Per-family roughness/metalness for PBR fidelity
    const famSpecs = families.map((f) => {
      const c = (f.spectral_class || '').toUpperCase().charAt(0);
      return c === 'M' ? [0.28, 0.80]   // metallic sheen
           : c === 'V' ? [0.70, 0.10]   // basaltic, slightly specular
           : c === 'S' ? [0.88, 0.06]   // silicate rock
           : c === 'C' ? [0.97, 0.01]   // dark carbonaceous, very matte
           : c === 'D' ? [0.95, 0.02]   // dark organic Trojans
           :              [0.93, 0.04];  // default
    });
    const defaultMat = isIcy ? [0.60, 0.02] : [0.93, 0.04];

    const result: {
      pos: [number, number, number]; seed: number; size: number;
      color: string; tumbleAxis: THREE.Vector3; roughness: number; metalness: number;
    }[] = [];
    let placed = 0, att = 0;
    while (placed < count && att < count * 8) {
      att++;
      // Power-law radial distribution — density peak at midpoint
      const u1 = rnd();
      const rFrac = u1 < 0.5 ? Math.sqrt(u1 * 2) * 0.5 : 1.0 - Math.sqrt((1 - u1) * 2) * 0.5;
      const r = inner + rFrac * beltWidth;

      if (gaps.some((g: { lo: number; hi: number }) => r >= g.lo && r <= g.hi)) continue;

      const a = isTrojan ? baseA + (rnd() - 0.5) * spread : rnd() * Math.PI * 2;
      const y = (rnd() - 0.5) * beltWidth * inclFactor;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;

      // Power-law size: most small, a few large (Dohnanyi distribution)
      const powSz = Math.pow(rnd(), 2.8);
      const sz = 0.012 + powSz * 0.065;

      // Pick spectral color with slight variation; icy bodies blend radially
      const fi = placed % palette.length;
      let col = palette[fi].clone();
      if (isIcy && families.length === 0) {
        // Radial tint: inner → water ice, outer → tholins
        const radialT = Math.max(0, Math.min(1, (r - inner) / Math.max(beltWidth, 0.001)));
        const waterIce = new THREE.Color(0.38, 0.52, 0.72);
        const tholin   = new THREE.Color(0.55, 0.22, 0.08);
        col = waterIce.lerp(tholin, radialT * 0.60).lerp(col, 0.40);
        // Outer bodies receive less sunlight (inverse-square falloff)
        const brightFall = 1.0 - radialT * 0.30;
        col.multiplyScalar((0.60 + rnd() * 0.45) * brightFall);
      } else {
        col.multiplyScalar(0.60 + rnd() * 0.45);
      }
      const hex = '#' + col.getHexString();
      const [ro, me] = famSpecs[fi] ?? defaultMat;

      // Random tumble axis (normalized)
      const ta = new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize();

      result.push({ pos: [x, y, z], seed: rnd() * 1000, size: sz, color: hex,
        tumbleAxis: ta, roughness: ro, metalness: me });
      placed++;
    }
    return result;
  }, [belt, starVisR, maxSma]);

  return (
    <group>
      {asteroids.map((a, i) => (
        <ProceduralAsteroid key={i} seed={a.seed} size={a.size} position={a.pos}
          color={a.color} tumbleAxis={a.tumbleAxis} roughness={a.roughness} metalness={a.metalness} />
      ))}
    </group>
  );
}

/* ━━ Regolith dust halo around close-up asteroid ━━ */
export function RegolithDust({ radius }: { radius: number }) {
  const matRef = useRef<THREE.ShaderMaterial>(null!);
  const data = useMemo(() => {
    const COUNT = 220;
    const pos = new Float32Array(COUNT * 3);
    let s = 91;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < COUNT; i++) {
      // Random point in a shell radius 1.15–2.2× asteroid radius
      const r = radius * (1.15 + rnd() * 1.05);
      const theta = Math.acos(2 * rnd() - 1);
      const phi   = rnd() * Math.PI * 2;
      pos[i * 3]     = r * Math.sin(theta) * Math.cos(phi);
      pos[i * 3 + 1] = r * Math.sin(theta) * Math.sin(phi);
      pos[i * 3 + 2] = r * Math.cos(theta);
    }
    return pos;
  }, [radius]);

  useFrame(({ clock }) => {
    if (matRef.current) matRef.current.uniforms.uTime.value = clock.elapsedTime;
  });

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[data, 3]} />
      </bufferGeometry>
      <shaderMaterial ref={matRef}
        vertexShader={`
          uniform float uTime;
          void main() {
            // Gentle drift — each particle drifts slowly outward over time
            vec3 p = position;
            float phase = dot(normalize(p), vec3(1.0, 0.7, 0.3));
            p += normalize(p) * sin(uTime * 0.18 + phase * 6.28) * 0.04;
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_PointSize = 1.5 * (200.0 / -mv.z);
            gl_Position  = projectionMatrix * mv;
          }
        `}
        fragmentShader={`
          void main() {
            vec2 c = gl_PointCoord - 0.5;
            if (dot(c,c) > 0.25) discard;
            float a = 1.0 - smoothstep(0.05, 0.25, dot(c,c));
            gl_FragColor = vec4(0.72, 0.68, 0.60, a * 0.18);
          }
        `}
        uniforms={{ uTime: { value: 0 } }}
        transparent depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

/* ━━ Binary companion in slow orbit ━━ */
export function CompanionOrbit({ orbitR, compScale, seed, color, roughness, metalness, hapkeAlbedo, sunDir }: {
  orbitR: number; compScale: number; seed: number;
  color: string; roughness: number; metalness: number;
  hapkeAlbedo: number; sunDir: THREE.Vector3;
}) {
  const ref = useRef<THREE.Group>(null!);
  const speed = 0.04 + (seed % 300) / 300 * 0.06;
  const initAngle = (seed % 628) / 100;
  useFrame((_, delta) => { if (ref.current) ref.current.rotation.y += delta * speed; });
  return (
    <group ref={ref}>
      <group position={[orbitR, 0, 0]}>
        <group scale={[compScale, compScale, compScale]}>
          <PotatoMoon seed={seed ^ 0x2b4d} color={color} roughness={roughness} metalness={metalness}
            detail={3} deformStyle="generic" hapkeAlbedo={hapkeAlbedo} sunDir={sunDir} />
        </group>
      </group>
      {/* Faint orbit ring */}
      <mesh rotation={[Math.PI / 2, 0, initAngle]}>
        <ringGeometry args={[orbitR - 0.01, orbitR + 0.01, 64]} />
        <meshBasicMaterial color="#445566" transparent opacity={0.18} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
    </group>
  );
}

/* ━━ Asteroid Close-up (tumbling Hapke-shaded body + dust halo) ━━ */
export function AsteroidCloseupGroup({
  seed, visualScale, color, color2, roughness, metalness,
  deformStyle, diam, isIcy, specClass, name, starColor, binaryType, axisRatio,
}: {
  seed: number; visualScale: number;
  color: string; color2: string; roughness: number; metalness: number;
  deformStyle: 'generic' | 'miranda' | 'hyperion' | 'eros';
  diam: number; isIcy: boolean; specClass: string; name: string;
  starColor: string;
  binaryType?: string | null;
  axisRatio?: number; // reserved for future mesh-level elongation scaling
}) {
  void axisRatio;
  const groupRef = useRef<THREE.Group>(null!);

  // Deterministic tumble axis from seed
  const [tumbleAxis, tumbleSpeed] = useMemo(() => {
    const s = (seed % 1000) * 0.001;
    const axis = new THREE.Vector3(
      Math.sin(s * 137.5) * 0.5 + 0.1,
      Math.cos(s * 83.1) * 0.3 + 0.9,
      Math.sin(s * 211.7) * 0.4,
    ).normalize();
    const speed = 0.06 + (seed % 500) / 500 * 0.16;
    return [axis, speed];
  }, [seed]);

  // Hapke albedo per spectral class (geometric albedo)
  const hapkeAlbedo = isIcy ? 0.55
    : specClass === 'C' ? 0.045
    : specClass === 'S' ? 0.18
    : specClass === 'M' ? 0.14
    : specClass === 'D' ? 0.04
    : specClass === 'V' ? 0.34
    : specClass === 'P' ? 0.04
    : specClass === 'B' ? 0.09
    : 0.12;

  // Sun direction — fixed offset to show interesting terminator on open
  const sunDir = useMemo(
    () => new THREE.Vector3(-1.4, 0.7, 0.9).normalize(),
    [],
  );

  useFrame((_, delta) => {
    if (groupRef.current) groupRef.current.rotateOnAxis(tumbleAxis, delta * tumbleSpeed);
  });

  const isContactBinary = binaryType === 'contact';

  // Secondary lobe size for contact binary (0.55–0.85 of primary)
  const secondaryFrac = 0.55 + (seed % 1000) / 1000 * 0.30;

  const typeLabel = isIcy
    ? binaryType === 'contact' ? 'KBO · Contact binary'
    : binaryType === 'wide' || binaryType === 'close' ? 'KBO · Binary system'
    : 'Icy KBO'
    : binaryType === 'contact' ? `${specClass || '?'}-type · Contact binary`
    : binaryType ? `${specClass || '?'}-type · Binary`
    : specClass === 'C' ? 'C-type · Carbonaceous'
    : specClass === 'S' ? 'S-type · Silicaceous'
    : specClass === 'M' ? 'M-type · Metallic'
    : specClass === 'D' ? 'D-type · Primitive'
    : specClass === 'V' ? 'V-type · Basaltic'
    : specClass === 'P' ? 'P-type · Primitive dark'
    : specClass === 'B' ? 'B-type · Primitive blue'
    : specClass === 'X' ? 'X-type · Unknown'
    : `${specClass || '?'}-type`;

  return (<>
    {/* Tumbling body — contact binary = two lobes, else single body */}
    <group ref={groupRef} scale={[visualScale, visualScale, visualScale]}>
      {isContactBinary ? (<>
        {/* Primary lobe */}
        <group position={[-0.42, 0, 0]}>
          <PotatoMoon seed={seed} color={color} color2={color2}
            roughness={roughness} metalness={metalness}
            detail={4} deformStyle="generic"
            hapkeAlbedo={hapkeAlbedo} sunDir={sunDir} />
        </group>
        {/* Secondary lobe — slightly smaller, distinct seed so shapes differ */}
        <group position={[0.44, 0, 0]}
          scale={[secondaryFrac, secondaryFrac, secondaryFrac]}>
          <PotatoMoon seed={seed ^ 0xf3c7} color={color} color2={color2}
            roughness={roughness} metalness={metalness}
            detail={4} deformStyle="generic"
            hapkeAlbedo={hapkeAlbedo} sunDir={sunDir} />
        </group>
      </>) : (
        <PotatoMoon
          seed={seed} color={color} color2={color2}
          roughness={roughness} metalness={metalness}
          detail={4} deformStyle={deformStyle}
          hapkeAlbedo={hapkeAlbedo} sunDir={sunDir}
        />
      )}
    </group>

    {/* Wide/close binary: small companion in slow orbit */}
    {(binaryType === 'wide' || binaryType === 'close') && (() => {
      const compFrac = 0.25 + (seed % 500) / 500 * 0.30; // 25–55% of primary
      const orbitR = binaryType === 'wide' ? visualScale * 2.8 : visualScale * 1.6;
      const compScale = visualScale * compFrac;
      return (
        <group>
          <CompanionOrbit
            orbitR={orbitR} compScale={compScale}
            seed={seed} color={color} roughness={roughness} metalness={metalness}
            hapkeAlbedo={hapkeAlbedo * 0.85} sunDir={sunDir}
          />
        </group>
      );
    })()}

    {/* Regolith dust halo */}
    <RegolithDust radius={isContactBinary ? visualScale * 1.2 : visualScale} />

    {/* Billboard label — outside the tumbling group so it stays upright */}
    <Html position={[0, visualScale + 0.24, 0]} center style={{
      pointerEvents: 'none', userSelect: 'none', textAlign: 'center',
    }}>
      <div style={{ fontSize: '11px', color: '#c8dcff', opacity: 0.85, whiteSpace: 'nowrap' }}>{name || 'Unnamed'}</div>
      <div style={{ fontSize: '8px', color: '#7a9abb', opacity: 0.65, whiteSpace: 'nowrap' }}>{diam.toFixed(0)} km · {typeLabel}</div>
    </Html>

    {/* Lighting: no directional light needed — Hapke shader handles sun internally */}
    <hemisphereLight args={[starColor, '#010306', 0.01]} />
  </>);
}

/* ━━ Named Belt Bodies — data-driven major asteroids + ice dwarfs in 3D ━━ */
// Placed at their true semi-major axes with deterministic azimuth, clickable.
export function NamedBeltBodies({ belt, beltIdx, starVisR, maxSma, onDrill }: {
  belt: any; beltIdx: number; starVisR: number; maxSma: number;
  onDrill: (beltIdx: number, idx: number, src: 'major' | 'ice_dwarf') => void;
}) {
  const bodies = useMemo(() => {
    const result: {
      orbitR: number; initAz: number; initY: number;
      seed: number; scale: number;
      color: string; color2: string; name: string;
      idx: number; src: 'major' | 'ice_dwarf';
      kepSpeed: number;
    }[] = [];

    const addGroup = (arr: any[] | undefined, src: 'major' | 'ice_dwarf') => {
      if (!arr?.length) return;
      for (let i = 0; i < arr.length; i++) {
        const a = arr[i];
        const r = logBeltRadius(a.semi_major_axis_au ?? belt.inner_radius_au ?? 2, starVisR, maxSma);
        const incl = ((a.inclination_deg ?? 5) * Math.PI / 180) * 0.4; // visual tilt
        // Deterministic azimuth from name hash
        const seed = hashStr(a.name ?? `${src}-${i}`);
        const az = seed * Math.PI * 2;
        const isIcy = src === 'ice_dwarf';
        const specClass = (a.spectral_class || '').toUpperCase().charAt(0);

        const [col1, col2] = isIcy
          ? (a.surface_type === 'nitrogen-ice' ? ['#b8d0ee', '#708aaa']
          : a.surface_type === 'methane-frost' ? ['#e0c898', '#907858']
          : ['#9ab8d8', '#5c7898'])
          : specClass === 'C' ? ['#4a4438', '#2a2418']
          : specClass === 'S' ? ['#a09070', '#6a5840']
          : specClass === 'M' ? ['#c8c2b8', '#888880']
          : specClass === 'D' ? ['#6a5038', '#3e2e20']
          : specClass === 'V' ? ['#907060', '#604840']
          : ['#887755', '#554433'];

        const diam = a.diameter_km ?? 200;
        // Visual scale: logarithmic, so even small bodies are visible
        // Ice dwarfs (Pluto, Eris, etc.) are genuinely larger → ×1.4 boost
        const scaleMult = isIcy ? 1.4 : 1.0;
        const vizScale = (0.028 + Math.min(Math.log10(1 + diam / 100) * 0.018, 0.055)) * scaleMult;

        const py = Math.sin(az + 1.1) * r * Math.sin(incl);

        result.push({
          orbitR: r,
          initAz: az,
          initY: py,
          seed: seed * 9999,
          scale: vizScale,
          color: col1, color2: col2,
          name: a.name ?? (src === 'ice_dwarf' ? 'Ice Dwarf' : 'Asteroid'),
          idx: i, src,
          kepSpeed: 0.00035 / Math.sqrt(Math.max(r, 0.1)),
        });
      }
    };

    addGroup(belt.major_asteroids, 'major');
    addGroup(belt.ice_dwarfs, 'ice_dwarf');
    return result;
  }, [belt, starVisR, maxSma]);

  if (bodies.length === 0) return null;

  return (
    <>
      {bodies.map((b, i) => (
        <NamedBody key={i} body={b} beltIdx={beltIdx} onDrill={onDrill} />
      ))}
    </>
  );
}

export function NamedBody({ body: b, beltIdx, onDrill }: {
  body: {
    orbitR: number; initAz: number; initY: number; seed: number; scale: number;
    color: string; color2: string; name: string;
    idx: number; src: 'major' | 'ice_dwarf'; kepSpeed: number;
  };
  beltIdx: number;
  onDrill: (beltIdx: number, idx: number, src: 'major' | 'ice_dwarf') => void;
}) {
  const ref = useRef<THREE.Group>(null!);
  const angle = useRef(b.initAz);  // starting orbital phase

  useFrame((_, delta) => {
    angle.current += delta * b.kepSpeed;
    if (ref.current) {
      ref.current.position.set(
        Math.cos(angle.current) * b.orbitR,
        b.initY,
        Math.sin(angle.current) * b.orbitR,
      );
    }
  });

  return (
    <group ref={ref}
      onClick={(e) => { e.stopPropagation(); onDrill(beltIdx, b.idx, b.src); }}
      onPointerEnter={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer'; }}
      onPointerLeave={() => { document.body.style.cursor = ''; }}
    >
      <group scale={[b.scale, b.scale, b.scale]}>
        <PotatoMoon seed={b.seed} color={b.color} color2={b.color2} detail={2} deformStyle="generic" />
      </group>
      <Html position={[0, b.scale + 0.06, 0]} center style={{
        fontSize: '7px', color: '#a8c0e0',
        opacity: 0.75, pointerEvents: 'none',
        whiteSpace: 'nowrap', userSelect: 'none',
      }}>
        {b.name}
      </Html>
    </group>
  );
}

/* ━━ Ring Particle System (disc of particles instead of flat ring) ━━ */
export function RingParticles({ rings, tilt = 0.12, rePerSceneUnit = 10 }: {
  rings: any[]; tilt?: number;
  /** How many Earth-radii equal 1 scene unit. System depth: ~10 (planet r≈0.1su).
   *  Planet depth: pass (planet.radius_earth / baseScale) so rings sit outside globe. */
  rePerSceneUnit?: number;
}) {
  const data = useMemo(() => {
    const allPos: number[] = [];
    const allCol: number[] = [];
    const allSize: number[] = [];
    let s = 77;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const scale = 1.0 / rePerSceneUnit;

    for (const ring of rings) {
      const iR = ring.inner_radius_re * scale;
      const oR = ring.outer_radius_re * scale;
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
export function MoonOrbitLine({ radius, active = false }: { radius: number; active?: boolean }) {
  const lineObj = useMemo(() => {
    if (!isFinite(radius) || radius <= 0) return null;
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

  if (!lineObj) return null;
  return (
    <group>
      <primitive object={lineObj} />
    </group>
  );
}

/* ━━ LOD-aware planet wrapper (increases segments when zoomed in) ━━ */
export function LODPlanet({ planetType, temperature, seed, sunDirection, rotationSpeed,
  mass, tidalHeating, starSpectralClass, colorShift, baseScale,
  tidallyLocked, spinOrbit32, showTempMap, showMineralMap, showBorders, tempDistribution, mineralAbundance,
  axialTilt, onBiomeClick, onReady,
  sunDirection2, sunBrightness, sunBrightness2,
}: {
  planetType: string; temperature: number; seed: number;
  sunDirection: [number, number, number]; rotationSpeed: number;
  mass?: number; tidalHeating?: number; starSpectralClass?: string;
  colorShift?: [number, number, number]; baseScale: number;
  tidallyLocked?: boolean; spinOrbit32?: boolean;
  showTempMap?: boolean; showMineralMap?: boolean; showBorders?: boolean;
  tempDistribution?: any; mineralAbundance?: any;
  axialTilt?: number;
  onBiomeClick?: (biome: BiomeInfo, hitPoint: THREE.Vector3) => void;
  onReady?: () => void;
  /** Circumbinary / dual-sun v2 props */
  sunDirection2?: [number, number, number];
  sunBrightness?: number;
  sunBrightness2?: number;
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
        showBorders={showBorders}
        tempDistribution={tempDistribution}
        mineralAbundance={mineralAbundance}
        axialTilt={axialTilt}
        onBiomeClick={onBiomeClick}
        onReady={onReady}
        sunDirection2={sunDirection2}
        sunBrightness={sunBrightness}
        sunBrightness2={sunBrightness2}
      />
    </group>
  );
}

/** Shared rotation group — planet mesh + colony overlay rotate as one.
 *  Eliminates floating-point drift between independent useFrame accumulators. */
export function RotatingSurfaceGroup({ children, rotationSpeed }: {
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

export function SmoothCamera({ depth }: { depth: ViewDepth }) {
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

export function BeltFamilyChart({ belt, highlightSma, highlightInc }: {
  belt: any; highlightSma?: number; highlightInc?: number;
}) {
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
      // Binary / elongated indicators
      if (a.binary_type === 'contact') {
        // Second lobe offset to show bilobed shape
        ctx.fillStyle = col; ctx.globalAlpha = 0.7;
        ctx.beginPath(); ctx.moveTo(x + 5, y - 3); ctx.lineTo(x + 7, y);
        ctx.lineTo(x + 5, y + 3); ctx.lineTo(x + 3, y); ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 1;
      } else if (a.binary_type) {
        ctx.strokeStyle = col; ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.stroke();
      }
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
      const kboCol = d.surface_type === 'nitrogen-ice' ? '#aaccff' :
        d.surface_type === 'methane-frost' ? '#ffccaa' : '#99ddff';
      ctx.fillStyle = kboCol;
      ctx.globalAlpha = 0.7;
      ctx.beginPath(); ctx.arc(x, y, rPx, 0, Math.PI * 2); ctx.fill();
      // Contact binary: draw a second lobe
      if (d.binary_type === 'contact') {
        ctx.beginPath(); ctx.arc(x + rPx * 1.3, y, rPx * 0.75, 0, Math.PI * 2); ctx.fill();
      } else if (d.has_companion) {
        ctx.globalAlpha = 0.4; ctx.strokeStyle = kboCol; ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.arc(x, y, rPx + 3, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#c0d0e0';
      ctx.font = '9px Inter, sans-serif';
      ctx.textAlign = 'left';
      const label = d.name + (d.binary_type ? ' ⚭' : '') + (d.is_elongated ? ' ↔' : '');
      ctx.fillText(label, x + rPx + 3, y + 3);
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

    // ── Highlight crosshair for active asteroid ─────────────────────────────
    if (highlightSma != null && highlightSma >= xMin && highlightSma <= xMax) {
      const hx = toX(highlightSma);
      const hy = highlightInc != null ? toY(Math.abs(highlightInc)) : pad.t + ch * 0.55;
      ctx.save();
      ctx.strokeStyle = 'rgba(255,120,60,0.80)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(hx, pad.t); ctx.lineTo(hx, pad.t + ch); ctx.stroke();
      if (highlightInc != null) {
        ctx.beginPath(); ctx.moveTo(pad.l, hy); ctx.lineTo(pad.l + cw, hy); ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.strokeStyle = '#ff8855';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(hx, hy, 7, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#ffaa77';
      ctx.beginPath(); ctx.arc(hx, hy, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

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
  }, [belt, highlightSma, highlightInc]);

  return (
    <div className="sf-belt-chart">
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Depth Breadcrumb Overlay
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

export function DepthBreadcrumb({ view, systemData, planets, belts, onNavigate }: {
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

export function ResourceBar({ label, value, color }: { label: string; value: number; color: string }) {
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

export function BiomeInfoPanel({ biome, onClose }: { biome: BiomeInfo; onClose: () => void }) {
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
