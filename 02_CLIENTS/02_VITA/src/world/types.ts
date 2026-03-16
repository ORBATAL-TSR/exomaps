/**
 * types.ts — Shared TypeScript interfaces for all world rendering.
 *
 * Import BiomeInfo, ZoneTexSet, TextureTriplet from their canonical modules
 * and re-export so consumers can import everything from one place.
 */

export interface WorldVisuals {
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

export type { BiomeInfo } from './zones';
export type { ZoneTexSet, TextureTriplet } from './textures';
