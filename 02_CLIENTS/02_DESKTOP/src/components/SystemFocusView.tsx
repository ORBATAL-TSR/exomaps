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
import { OrbitControls, Text } from '@react-three/drei';
// Bloom removed — multi-pass FBO causes flickering on Tauri wgpu/Vulkan
import * as THREE from 'three';
import type { TauriGPUHook, PlanetTexturesV2 } from '../hooks/useTauriGPU';
import { useScience } from '../hooks/useScience';
import { useCampaign } from '../hooks/useCampaign';
import { ErrorBoundary } from './ErrorBoundary';
import { ProceduralPlanet, V as PlanetProfiles, deriveWorldVisuals } from './ProceduralPlanet';
import type { TerrainParams } from './ColonyTerrain';
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
  const gap = 0.06; // minimum visual gap between moons

  // Initial logarithmic positions
  const k = 6 / Math.max(maxAU, 0.0001);
  const spread = 1.4;
  const positions: number[] = [];
  for (const s of sorted) {
    const vizR = 0.04 + (s.re / maxMoonRad) * 0.30;
    const logPos = minR + Math.log2(1 + s.au * k) * spread;
    if (positions.length === 0) {
      positions.push(Math.max(logPos, minR + vizR + gap));
    } else {
      const prevVizR = 0.04 + (sorted[positions.length - 1].re / maxMoonRad) * 0.30;
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

  const ringScale = r * 1.2;

  return (
    <group ref={grp} onClick={e => { e.stopPropagation(); onClick(); }}>
      {planetType ? (
        <group scale={[r, r, r]}>
          <ProceduralPlanet
            planetType={planetType}
            temperature={temperature ?? 288}
            seed={planetSeed ?? 0}
            sunDirection={[1, 0.3, 0.5]}
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

      {/* Rings (system depth only — planet depth renders separately) */}
      {ringSystem?.rings?.map((ring: any, ri: number) => (
        <mesh key={ri} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[
            ring.inner_radius_re * ringScale * 0.08,
            ring.outer_radius_re * ringScale * 0.08, 48
          ]} />
          <meshBasicMaterial
            color={ring.composition === 'icy' ? '#aabbdd' :
              ring.composition === 'mixed' ? '#99aa88' : '#887755'}
            transparent opacity={Math.min(ring.optical_depth * 0.3, 0.45)}
            side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      ))}

      {/* Mini moon hints at system depth */}
      {moonHints?.slice(0, 6).map((m, mi) => (
        <MiniMoonDot key={mi}
          r={Math.max(r * 0.16, 0.02)}
          orbitR={r * (2.0 + mi * 0.65)}
          color={m.color}
          period={2.2 + mi * 1.0}
          startAngle={mi * 2.1} />
      ))}

      <Text position={[0, r + 0.18, 0]} fontSize={0.12}
        color={active ? '#c0d8ff' : '#7899bb'}
        fillOpacity={active ? 1 : 0.65}
        anchorX="center" anchorY="bottom">
        {label}
      </Text>
    </group>
  );
}

/** Irregular "potato" geometry for tiny asteroid-like moons (Phobos, Deimos, Hyperion) */
function PotatoMoon({ seed, color, roughness = 0.92, detail = 3 }: {
  seed: number; color: string; roughness?: number; detail?: number;
}) {
  const geo = useMemo(() => {
    const g = new THREE.IcosahedronGeometry(1, detail);
    const pos = g.attributes.position;
    const s = seed * 137;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      // Low-frequency deformation for overall shape
      const n1 = Math.sin(x * 2.1 + s) * Math.cos(y * 3.2 + s * 0.7) * Math.sin(z * 1.8 + s * 1.3);
      // Medium frequency for lumps (reduced from 0.3 to 0.2 — less spiky)
      const n2 = Math.sin(x * 5.3 + s * 2) * Math.cos(y * 4.1 + s * 1.5) * 0.2;
      // High frequency for rough surface (reduced from 0.08 to 0.04 — smoother)
      const n3 = Math.sin(x * 12 + y * 8 + z * 10 + s * 3) * 0.04;
      const scale = 0.65 + n1 * 0.25 + n2 + n3;
      pos.setXYZ(i, x * scale, y * Math.max(0.4, scale * 0.85), z * scale);
    }
    pos.needsUpdate = true;
    g.computeVertexNormals();
    return g;
  }, [seed, detail]);
  return (
    <mesh geometry={geo}>
      <meshStandardMaterial color={color} roughness={roughness} metalness={0.05} />
    </mesh>
  );
}

/** Orbiting moon with ProceduralPlanet shader — used at planet depth */
function OrbitingMoon({
  orbitR, r, vizPrd, startAngle, active, onClick, label,
  planetType, temperature, seed, colorShift,
  mass, tidalHeating, isPotato, potatoColor, starSpectralClass,
  hasAtmosphere, atmColor,
}: {
  orbitR: number; r: number; vizPrd: number; startAngle: number;
  active: boolean; onClick: () => void; label: string;
  planetType: string; temperature: number; seed: number;
  colorShift: [number, number, number];
  mass?: number; tidalHeating?: number;
  isPotato?: boolean; potatoColor?: string;
  starSpectralClass?: string;
  hasAtmosphere?: boolean; atmColor?: string;
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
          <PotatoMoon seed={seed} color={potatoColor || '#887766'} />
        ) : (
          <ProceduralPlanet
            planetType={planetType}
            temperature={temperature}
            seed={seed}
            sunDirection={[1, 0.3, 0.5]}
            rotationSpeed={0.02}
            colorShift={colorShift}
            mass={mass}
            tidalHeating={tidalHeating}
            starSpectralClass={starSpectralClass}
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
      <Text position={[0, r + 0.12, 0]} fontSize={0.08}
        color={active ? '#c0d8ff' : '#7899bb'}
        fillOpacity={active ? 1 : 0.55}
        anchorX="center" anchorY="bottom">
        {label}
      </Text>
    </group>
  );
}

function OrreryStar({ color, size }: { color: string; size: number }) {
  const glowRef = useRef<THREE.Mesh>(null!);
  const coronaRef = useRef<THREE.Mesh>(null!);
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (glowRef.current)
      (glowRef.current.material as THREE.MeshBasicMaterial).opacity =
        0.12 + 0.06 * Math.sin(t * 1.2);
    if (coronaRef.current)
      (coronaRef.current.material as THREE.MeshBasicMaterial).opacity =
        0.04 + 0.02 * Math.sin(t * 0.7 + 1.5);
  });
  return (
    <group>
      {/* Core */}
      <mesh>
        <sphereGeometry args={[size, 32, 32]} />
        <meshBasicMaterial color={color} />
      </mesh>
      {/* Inner glow */}
      <mesh ref={glowRef}>
        <sphereGeometry args={[size * 2.0, 32, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.12}
          depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      {/* Outer corona halo */}
      <mesh ref={coronaRef}>
        <sphereGeometry args={[size * 3.5, 32, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.04}
          depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      {/* Equatorial disc */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[size * 1.05, size * 1.3, 48]} />
        <meshBasicMaterial color={color} transparent opacity={0.04}
          side={THREE.DoubleSide} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
    </group>
  );
}

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
      const c = bc.clone().multiplyScalar(0.5 + rnd() * 0.5);
      col[placed * 3] = c.r; col[placed * 3 + 1] = c.g; col[placed * 3 + 2] = c.b;
      placed++;
    }
    return { pos: pos.slice(0, placed * 3), col: col.slice(0, placed * 3), n: placed };
  }, [belt, starVisR, maxSma]);

  if (data.n === 0) return null;
  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[data.pos, 3]} />
        <bufferAttribute attach="attributes-color" args={[data.col, 3]} />
      </bufferGeometry>
      <pointsMaterial vertexColors size={0.035} transparent opacity={0.55}
        sizeAttenuation depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  );
}

function Starfield() {
  const data = useMemo(() => {
    const n = 1800;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const sizes = new Float32Array(n);
    // Star color palette: blue-white, white, yellow, orange, red-tinted
    const palette = [
      [0.65, 0.72, 0.92], // blue-white (O/B)
      [0.82, 0.85, 0.95], // white (A)
      [0.92, 0.90, 0.80], // yellow-white (F/G)
      [0.95, 0.78, 0.55], // orange (K)
      [0.88, 0.60, 0.50], // red-tinted (M)
    ];
    for (let i = 0; i < n; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 60 + Math.random() * 40;
      pos[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      pos[i * 3 + 2] = r * Math.cos(phi);
      // Spectral color (biased toward blue-white / white, fewer warm)
      const ci = Math.random() < 0.45 ? 0 :
                 Math.random() < 0.55 ? 1 :
                 Math.random() < 0.60 ? 2 :
                 Math.random() < 0.75 ? 3 : 4;
      const c = palette[ci];
      // Brightness variation — most dim, a few bright
      const brightness = 0.25 + Math.pow(Math.random(), 3.0) * 0.75;
      col[i * 3]     = c[0] * brightness;
      col[i * 3 + 1] = c[1] * brightness;
      col[i * 3 + 2] = c[2] * brightness;
      // Size variation — a few bright stars are larger
      sizes[i] = 0.04 + Math.pow(Math.random(), 4.0) * 0.12;
    }
    return { pos, col, sizes };
  }, []);
  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[data.pos, 3]} />
        <bufferAttribute attach="attributes-color" args={[data.col, 3]} />
      </bufferGeometry>
      <pointsMaterial vertexColors size={0.06} transparent opacity={0.65}
        sizeAttenuation={false} depthWrite={false} />
    </points>
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
      <Text position={[0, cR + 0.08, 0]} fontSize={0.05}
        color="#4d9fff" fillOpacity={0.55} anchorX="center" anchorY="bottom">
        {label}
      </Text>
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
    <group rotation={[-Math.PI / 2 + tilt, 0, 0]}>
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
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[radius - 0.005, radius + 0.005, 80]} />
      <meshBasicMaterial
        color={active ? '#4d9fff' : '#2a4060'}
        transparent opacity={active ? 0.45 : 0.22}
        depthWrite={false} />
    </mesh>
  );
}

/* ━━ LOD-aware planet wrapper (increases segments when zoomed in) ━━ */
function LODPlanet({ planetType, temperature, seed, sunDirection, rotationSpeed,
  mass, tidalHeating, starSpectralClass, colorShift, baseScale,
  tidallyLocked, spinOrbit32, showTempMap, showMineralMap, tempDistribution, mineralAbundance,
}: {
  planetType: string; temperature: number; seed: number;
  sunDirection: [number, number, number]; rotationSpeed: number;
  mass?: number; tidalHeating?: number; starSpectralClass?: string;
  colorShift?: [number, number, number]; baseScale: number;
  tidallyLocked?: boolean; spinOrbit32?: boolean;
  showTempMap?: boolean; showMineralMap?: boolean;
  tempDistribution?: any; mineralAbundance?: any;
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

  /* ── Fetch system data ── */
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const r = await fetch(`/api/system/${encodeURIComponent(systemId)}`);
        const d = await r.json();
        if (!dead) setSystemData(d);
      } catch (e) { console.error('[Focus] fetch failed', e); }
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
  }, []);

  const handleDrillMoon = useCallback((moonIdx: number) => {
    setView(prev => ({ depth: 'moon', planetIdx: prev.planetIdx, moonIdx }));
    setScienceOpen(false);
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
                    <OrreryStar color={starColor} size={STAR_VIS_R} />
                    <pointLight position={[0, 0, 0]} intensity={3} color={starColor} distance={40} />
                    <ambientLight intensity={0.06} />

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
                  {/* Lighting for meshStandardMaterial colony buildings */}
                  <directionalLight position={[10, 3, 5]} intensity={1.2} color={starColor} />
                  <ambientLight intensity={0.1} />
                  {curPlanet && (<>
                    <RotatingSurfaceGroup rotationSpeed={curPlanet?.rotation_period_days
                      ? 0.04 * (1.0 / Math.max(curPlanet.rotation_period_days, 0.1))
                      : 0.04}>
                    {showPBR ? (
                      <PlanetSurfaceV2 textures={texturesV2!}
                        sunDirection={[1, 0.3, 0.5]}
                        starTeff={systemData?.star?.teff ?? 5778}
                        starLuminosity={systemData?.star?.luminosity ?? 1}
                        radius={1} resolution={32} />
                    ) : (
                      <LODPlanet
                        planetType={globeType}
                        temperature={globeTemp}
                        seed={globeSeed}
                        sunDirection={[1, 0.3, 0.5]}
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
                        baseScale={(() => {
                          const re = curPlanet?.radius_earth || 1;
                          return 0.7 + Math.min(Math.log2(1 + re) * 0.25, 0.5);
                        })()}
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
                      <RingParticles rings={curPlanet.ring_system.rings} tilt={0} />
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
                      const moonR = 0.04 + relR * 0.30;

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

                      // Potato moon color from profile lookup
                      const potatoColor = isPotato ? (
                        m.moon_type === 'captured-irregular' ? '#887766' :
                        m.moon_type === 'shepherd' ? '#99aabb' : '#776655'
                      ) : undefined;

                      // Atmosphere detection (Titan, etc.)
                      const moonFlags: string[] = m.sub_type_flags || [];
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
                            potatoColor={potatoColor}
                            starSpectralClass={starSpec}
                            hasAtmosphere={hasMoonAtm}
                            atmColor={moonAtmColor}
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

                    <directionalLight position={[10, 3, 5]} intensity={1.5} color={starColor} />
                    <ambientLight intensity={0.12} />
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
                          sunDirection={[1, 0.3, 0.5]}
                          rotationSpeed={0}
                          colorShift={moonColorShift(curMoon, view.moonIdx ?? 0)}
                          mass={curMoon?.mass_earth}
                          tidalHeating={curMoon?.tidal_heating}
                          starSpectralClass={starSpec} />
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
                        planetType={curPlanet?.planet_type || 'rocky'}
                        temperature={curPlanet?.temp_calculated_k ?? 288}
                        seed={hashStr(curPlanet?.planet_name || `parent-${view.planetIdx}`)}
                        sunDirection={[1, 0.3, 0.5]}
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

                    <directionalLight position={[10, 3, 5]} intensity={1.2} color={starColor} />
                    <ambientLight intensity={0.15} />
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

                    return (<>
                      <group scale={[visualScale, visualScale, visualScale]}>
                        <PotatoMoon seed={astSeed} color={astColor} detail={4} />
                      </group>

                      {/* Slow rotation */}
                      <group>
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
                      </group>

                      <directionalLight position={[5, 3, 8]} intensity={1.5} color={starColor} />
                      <ambientLight intensity={0.15} />
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

      </div>
    </div>
  );
}
