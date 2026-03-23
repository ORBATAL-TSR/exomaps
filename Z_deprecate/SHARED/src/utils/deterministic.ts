/**
 * Seeded pseudo-random number generator for deterministic procedural content.
 *
 * Uses mulberry32 (32-bit) — fast, small, deterministic from seed.
 * All clients produce identical results for the same seed, ensuring
 * procedural planets look the same everywhere.
 */

export class SeededRNG {
  private state: number;

  constructor(seed: number) {
    this.state = seed | 0;
  }

  /** Generate next float in [0, 1) */
  next(): number {
    this.state |= 0;
    this.state = (this.state + 0x6D2B79F5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Generate float in [min, max) */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Generate integer in [min, max] inclusive */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  /** Pick a random element from an array */
  pick<T>(arr: T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** Gaussian-distributed random (Box-Muller) */
  gaussian(mean = 0, stddev = 1): number {
    const u1 = this.next();
    const u2 = this.next();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mean + z * stddev;
  }

  /** Clone the RNG state (for branching) */
  clone(): SeededRNG {
    const copy = new SeededRNG(0);
    copy.state = this.state;
    return copy;
  }
}

/**
 * Generate a deterministic seed from a string (e.g. main_id).
 * FNV-1a hash, returns 32-bit unsigned integer.
 */
export function hashString(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Create a seeded RNG from a star's main_id.
 * Ensures the same star always generates the same procedural content.
 */
export function rngForStar(mainId: string): SeededRNG {
  return new SeededRNG(hashString(mainId));
}

/**
 * Create a seeded RNG from a planet name within a system.
 * Combines the star seed + planet index for deterministic branching.
 */
export function rngForPlanet(mainId: string, planetIndex: number): SeededRNG {
  return new SeededRNG(hashString(mainId) ^ (planetIndex * 2654435761));
}
