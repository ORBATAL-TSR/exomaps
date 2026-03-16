/**
 * derive.ts — World visual derivation and genome system.
 *
 * Exports:
 *   deriveWorldVisuals() — physical parameter derivation
 *   applyGasGenome()     — gas giant color mutation
 *   applyWorldGenome()   — solid world combinatorial genome
 *   NO_GENOME            — set of types that skip genome override
 */

import type { WorldVisuals } from './types';

const GAS_TYPES_LOCAL = new Set([
  'gas-giant', 'super-jupiter', 'hot-jupiter',
  'neptune-like', 'warm-neptune', 'mini-neptune', 'sub-neptune',
]);

/** Derive world visuals from physical parameters — universal across planets and moons */
export function deriveWorldVisuals(base: WorldVisuals, params: {
  temperature?: number; mass?: number; tidalHeating?: number;
  starSpectralClass?: string;
}): WorldVisuals {
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
  // Below ~180K: worlds should look increasingly icy, not rocky-brown.
  // AIRLESS WORLDS: no atmosphere → no condensation cycle → no polar ice sheets.
  //   Surface stays cold regolith; only subtle frost tint, no white caps.
  const isAirless = v.atmThickness < 0.05;
  if (temp < 200 && !v.isIce && v.oceanLevel < 0.5) {
    const coldFactor = 1.0 - Math.max(0, Math.min(1, (temp - 60) / 140)); // 0 at 200K, 1 at 60K
    // Ice tint: shift colors toward ice-white/blue-grey
    // Airless worlds: subtle grey-blue tint only (no bright ice colours)
    const iceC1: [number, number, number] = isAirless ? [0.62, 0.64, 0.68] : [0.78, 0.82, 0.88];
    const iceC2: [number, number, number] = isAirless ? [0.42, 0.44, 0.50] : [0.55, 0.60, 0.70];
    const iceC3: [number, number, number] = isAirless ? [0.72, 0.74, 0.78] : [0.90, 0.92, 0.96];
    const blend = coldFactor * (isAirless ? 0.35 : 0.85);
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
    // Airless: only trace polar frost in deep craters (max 0.12), not bright polar caps
    const maxIce = isAirless ? 0.12 : 0.95;
    v.iceCaps = Math.max(v.iceCaps, Math.min(maxIce, 0.45 + coldFactor * 0.50));
    v.crackIntensity = Math.max(v.crackIntensity ?? 0, coldFactor * (isAirless ? 0.15 : 0.35));
    v.volcanism = Math.min(v.volcanism ?? 0, 0.10 * (1 - coldFactor));
    v.isIce = !isAirless && coldFactor > 0.5;
    if (temp < 120 && !isAirless && !v.atmThickness) {
      v.atmColor = [0.50, 0.55, 0.72];
      v.atmThickness = Math.max(v.atmThickness, 0.02);
    }
  } else if (temp < 100 && !v.isIce) {
    v.iceCaps = Math.max(v.iceCaps, isAirless ? 0.08 : 0.55);
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
  if (mass > 0.8 && mass < 8 && !GAS_TYPES_LOCAL.has('') && v.volcanism === undefined) {
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
  // Tectonics: mass-driven (plate tectonics onset ~0.5 M⊕), boosted by tidal heating
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
  // ── Vivid surface regimes (wider color gamut) ──
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

/** Types where genome should NOT override visuals (highly specific identity).
 *
 * All moon-* types are excluded: their profiles are already hand-tuned to
 * represent specific real-world analog bodies (Europa, Titan, Io, Luna…).
 * The random rocky/basaltic surface genome overrides would darken icy moons
 * to near-black, defeating the carefully chosen color palettes.
 * Moon diversity comes from 20+ distinct type profiles, not genome blending.
 */
export const NO_GENOME = new Set([
  // Planets with very specific compositions
  'lava-world', 'iron-planet', 'carbon-planet', 'eyeball-world',
  // All moon types — hand-tuned, genome would corrupt icy/exotic surfaces
  'moon-volcanic', 'moon-magma-ocean', 'moon-carbon-soot',
  'moon-ice-shell', 'moon-ocean', 'moon-nitrogen-ice', 'moon-co2-frost',
  'moon-ammonia-slush', 'moon-silicate-frost', 'moon-binary',
  'moon-atmosphere', 'moon-hydrocarbon', 'moon-tholin',
  'moon-cratered', 'moon-iron-rich', 'moon-olivine', 'moon-basalt',
  'moon-regolith', 'moon-captured', 'moon-thin-atm', 'moon-shepherd',
  'moon-sulfate', 'moon-rocky', 'moon-sulfur',
]);

/** Gas giant genome — seed-driven HSV color mutation for band/storm diversity */
export function applyGasGenome(vis: WorldVisuals, seed: number): void {
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
export function applyWorldGenome(vis: WorldVisuals, seed: number, temp: number, mass: number): void {
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
