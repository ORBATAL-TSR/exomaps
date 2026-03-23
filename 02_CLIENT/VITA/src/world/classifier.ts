/**
 * classifier.ts — Probabilistic world type resolver (v7 astrophysical cascade).
 *
 * Takes physical parameters derived from the astrophysical cascade (stellar →
 * orbital → planetary) and returns a WorldTypeId by sampling a weighted
 * condition table. Every world type is a probability, not a deterministic label.
 *
 * Usage:
 *   import { classifyWorld } from './classifier';
 *   const type = classifyWorld({ mass: 1.0, temperature: 288, density: 5.5,
 *                                 atmPressure: 1.0, habitableZone: true }, seed);
 *
 * The caller is responsible for deriving inputs from stellar/orbital data.
 * See VITA_RENDERER_V7_ASTROPHYSICAL.md §1 for the derivation pipeline.
 */

// ── Input parameters ──────────────────────────────────────────────────────

export interface WorldPhysicalParams {
  /** Planet mass in Earth masses (M⊕) */
  mass: number;
  /** Surface temperature in Kelvin (after greenhouse correction) */
  temperature: number;
  /** Bulk density in g/cm³ */
  density?: number;
  /** Surface atmospheric pressure in bar */
  atmPressure?: number;
  /** Tidal heating intensity 0–1 */
  tidalHeating?: number;
  /** Host star metallicity [Fe/H] — negative = metal-poor */
  metallicity?: number;
  /** Orbital period in days */
  orbitalPeriod?: number;
  /** Is planet in the habitable zone of its star? */
  habitableZone?: boolean;
  /** Is the planet tidally locked? */
  tidallyLocked?: boolean;
  /** Is the body a moon of a gas giant? */
  moonOfGasGiant?: boolean;
  /** Is the body a moon of a rocky planet? */
  moonOfRocky?: boolean;
  /** Has a detected magnetic field (proxy: mass > 0.3 M⊕ and not ancient)? */
  hasMagneticField?: boolean;
  /** Volatile fraction 0–1 (ice/water/organics — inferred from bulk density) */
  volatileFraction?: number;
}

// ── Type condition table entry ─────────────────────────────────────────────

interface TypeCondition {
  type: string;

  // ── Physical range gates — all present gates must pass ──
  massRange?:    [number, number];   // M⊕
  tempRange?:    [number, number];   // K surface temp
  densityRange?: [number, number];   // g/cm³
  atmRange?:     [number, number];   // bar
  tidalMin?:     number;             // minimum tidal heating
  metalRange?:   [number, number];   // [Fe/H]
  orbitalMax?:   number;             // max orbital period (days)

  // ── Boolean condition gates ──
  habitableZone?: boolean;
  frozenOut?:     boolean;           // temperature < 150 K
  tidallyLocked?: boolean;
  moonOfGasGiant?: boolean;
  moonOfRocky?:   boolean;
  requiresAtm?:   boolean;          // atmPressure > 0.05 required
  requiresLowAtm?: boolean;         // atmPressure < 0.01 required (airless)
  requiresHighVol?: boolean;        // volatileFraction > 0.35 required

  /** Sampling weight — higher = more probable when conditions pass */
  weight: number;
}

// ── Seeded random ─────────────────────────────────────────────────────────

function seededRand(seed: number, salt: number): number {
  const x = Math.sin(seed * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

// ── Condition table ───────────────────────────────────────────────────────

const CONDITIONS: TypeCondition[] = [

  // ═══ GAS GIANTS ════════════════════════════════════════════════════════

  { type: 'hot-jupiter',      massRange: [95,  5000], tempRange: [900, 5000], orbitalMax: 10,   weight: 2.5 },
  { type: 'cloudless-hot-jupiter', massRange: [150, 5000], tempRange: [1800, 5000], orbitalMax: 5, weight: 0.8 },
  { type: 'night-cloud-giant', massRange: [95, 2000], tempRange: [800, 1800], orbitalMax: 15,   weight: 0.6 },
  { type: 'water-cloud-giant', massRange: [30,  800], tempRange: [150,  600],                   weight: 1.5 },
  { type: 'nh4sh-cloud-giant', massRange: [50, 2000], tempRange: [100,  250],                   weight: 1.2 },
  { type: 'gas-giant',         massRange: [95, 5000], tempRange: [60,   900],                   weight: 3.0 },
  { type: 'super-jupiter',     massRange: [2000, 20000], tempRange: [60, 2000],                 weight: 0.4 },
  { type: 'warm-neptune',      massRange: [10,   95], tempRange: [400, 1200], orbitalMax: 30,   weight: 1.0 },
  { type: 'neptune-like',      massRange: [10,   95], tempRange: [40,   400],                   weight: 2.0 },
  { type: 'mini-neptune',      massRange: [2,    15], tempRange: [80,   600],  requiresHighVol: true, weight: 2.5 },
  { type: 'sub-neptune',       massRange: [1.5,  10], tempRange: [100,  700],  requiresHighVol: true, weight: 1.5 },

  // ═══ HABITABLE ZONE ROCKY WORLDS ════════════════════════════════════════

  { type: 'earth-like',
    massRange: [0.4, 2.5], tempRange: [265, 315], densityRange: [4.0, 6.5],
    atmRange: [0.3, 5.0], habitableZone: true, weight: 3.0 },

  { type: 'ocean-world',
    massRange: [0.3, 4.0], tempRange: [265, 340], densityRange: [2.5, 5.0],
    requiresHighVol: true, habitableZone: true, weight: 2.0 },

  { type: 'hycean',
    massRange: [1.0, 5.0], tempRange: [270, 430], densityRange: [2.2, 4.0],
    atmRange: [10, 300], requiresHighVol: true, weight: 1.2 },

  { type: 'super-earth',
    massRange: [2.0, 10.0], tempRange: [220, 400], densityRange: [4.0, 7.5],
    atmRange: [0.5, 10.0], weight: 2.5 },

  { type: 'temperate',
    massRange: [0.3, 2.0], tempRange: [240, 300], densityRange: [3.5, 6.5],
    atmRange: [0.1, 3.0], habitableZone: true, weight: 1.5 },

  { type: 'water-world',
    massRange: [0.2, 3.0], tempRange: [270, 360], densityRange: [1.8, 4.0],
    requiresHighVol: true, weight: 1.0 },

  { type: 'eyeball-world',
    massRange: [0.3, 5.0], tempRange: [200, 400], tidallyLocked: true,
    habitableZone: true, weight: 2.0 },

  // ═══ HOT / ARID ROCKY ════════════════════════════════════════════════════

  { type: 'desert-world',
    massRange: [0.1, 5.0], tempRange: [280, 550], densityRange: [3.5, 7.0],
    requiresLowAtm: false, weight: 2.5 },

  { type: 'desert',
    massRange: [0.05, 2.0], tempRange: [250, 480], weight: 1.5 },

  { type: 'lava-world',
    massRange: [0.02, 5.0], tempRange: [1200, 5000], weight: 1.8 },

  { type: 'lava-ocean',
    massRange: [0.5, 8.0], tempRange: [800, 2000], weight: 0.8 },

  { type: 'chthonian',
    massRange: [30, 300], tempRange: [800, 3000], orbitalMax: 5, weight: 0.6 },

  { type: 'volcanic',
    massRange: [0.1, 3.0], tempRange: [350, 900], tidalMin: 0.2, weight: 1.5 },

  // ═══ COLD / ICY ══════════════════════════════════════════════════════════

  { type: 'ice-dwarf',
    massRange: [0.0001, 0.05], tempRange: [20, 150], frozenOut: true, weight: 3.0 },

  { type: 'moon-ice-shell',
    massRange: [0.0005, 0.05], tempRange: [50, 200], moonOfGasGiant: true,
    tidalMin: 0.05, weight: 2.5 },

  { type: 'moon-ocean',
    massRange: [0.001, 0.15], tempRange: [60, 250], moonOfGasGiant: true, weight: 2.0 },

  { type: 'moon-nitrogen-ice',
    massRange: [0.0001, 0.03], tempRange: [20, 80], frozenOut: true, weight: 1.5 },

  { type: 'moon-co2-frost',
    massRange: [0.0005, 0.05], tempRange: [60, 160], moonOfGasGiant: true, weight: 1.5 },

  { type: 'moon-ammonia-slush',
    massRange: [0.01, 0.20], tempRange: [60, 180], moonOfGasGiant: true,
    requiresHighVol: true, weight: 1.0 },

  { type: 'moon-silicate-frost',
    massRange: [0.0001, 0.10], tempRange: [60, 250], weight: 2.0 },

  // ═══ AIRLESS ROCKY ════════════════════════════════════════════════════════

  { type: 'rocky',
    massRange: [0.01, 1.5], requiresLowAtm: true, weight: 3.5 },

  { type: 'sub-earth',
    massRange: [0.001, 0.5], requiresLowAtm: true, weight: 2.0 },

  { type: 'iron-planet',
    massRange: [0.05, 5.0], densityRange: [6.5, 15.0], requiresLowAtm: true, weight: 0.8 },

  { type: 'carbon-planet',
    massRange: [0.1, 10.0], metalRange: [0.2, 2.0], weight: 0.4 },

  // ═══ SPECIAL / EXOTIC ════════════════════════════════════════════════════

  { type: 'usp-rocky',
    massRange: [0.01, 3.0], orbitalMax: 1, tempRange: [1000, 5000], weight: 1.5 },

];

// ── Gate evaluation ───────────────────────────────────────────────────────

function conditionPasses(c: TypeCondition, p: WorldPhysicalParams): boolean {
  if (c.massRange    && (p.mass < c.massRange[0]                 || p.mass > c.massRange[1]))    return false;
  if (c.tempRange    && (p.temperature < c.tempRange[0]          || p.temperature > c.tempRange[1])) return false;
  if (c.densityRange && p.density !== undefined &&
                         (p.density < c.densityRange[0]          || p.density > c.densityRange[1])) return false;
  if (c.atmRange     && p.atmPressure !== undefined &&
                         (p.atmPressure < c.atmRange[0]          || p.atmPressure > c.atmRange[1])) return false;
  if (c.tidalMin     !== undefined && (p.tidalHeating ?? 0) < c.tidalMin)   return false;
  if (c.metalRange   && p.metallicity !== undefined &&
                         (p.metallicity < c.metalRange[0]        || p.metallicity > c.metalRange[1])) return false;
  if (c.orbitalMax   !== undefined && p.orbitalPeriod !== undefined &&
                          p.orbitalPeriod > c.orbitalMax)                    return false;

  // Boolean gates
  if (c.habitableZone  !== undefined && !!p.habitableZone  !== c.habitableZone)  return false;
  if (c.tidallyLocked  !== undefined && !!p.tidallyLocked  !== c.tidallyLocked)  return false;
  if (c.moonOfGasGiant !== undefined && !!p.moonOfGasGiant !== c.moonOfGasGiant) return false;
  if (c.moonOfRocky    !== undefined && !!p.moonOfRocky    !== c.moonOfRocky)    return false;

  if (c.frozenOut !== undefined) {
    const isFrozen = p.temperature < 150;
    if (isFrozen !== c.frozenOut) return false;
  }
  if (c.requiresAtm     && (p.atmPressure ?? 0) < 0.05)  return false;
  if (c.requiresLowAtm  && (p.atmPressure ?? 0) > 0.01)  return false;
  if (c.requiresHighVol && (p.volatileFraction ?? 0) < 0.35) return false;

  return true;
}

// ── Public resolver ───────────────────────────────────────────────────────

/**
 * Probabilistically resolve a world type from physical parameters.
 *
 * @param params  Physical parameters from the astrophysical cascade.
 * @param seed    Deterministic seed (planet system seed) for reproducibility.
 * @returns       WorldTypeId string (e.g. 'earth-like', 'hot-jupiter', 'ice-dwarf').
 */
export function classifyWorld(params: WorldPhysicalParams, seed: number): string {
  const eligible = CONDITIONS
    .filter(c => conditionPasses(c, params))
    .map(c => ({ type: c.type, weight: c.weight }));

  if (eligible.length === 0) return 'rocky';

  const total = eligible.reduce((s, e) => s + e.weight, 0);
  const r     = seededRand(seed, 9001) * total;
  let   acc   = 0;
  for (const e of eligible) {
    acc += e.weight;
    if (r < acc) return e.type;
  }
  return eligible[eligible.length - 1].type;
}

/**
 * Debug helper — returns all eligible types with their probability %.
 */
export function classifyWorldDebug(
  params: WorldPhysicalParams,
): Array<{ type: string; weight: number; prob: number }> {
  const eligible = CONDITIONS
    .filter(c => conditionPasses(c, params))
    .map(c => ({ type: c.type, weight: c.weight }));

  const total = eligible.reduce((s, e) => s + e.weight, 0) || 1;
  return eligible
    .map(e => ({ ...e, prob: Math.round((e.weight / total) * 1000) / 10 }))
    .sort((a, b) => b.prob - a.prob);
}
