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
  hasRings?: boolean;       // true → shader casts equatorial ring-plane shadow
  ringInner?: number;       // ring inner radius in planet radii (default 1.30)
  ringOuter?: number;       // ring outer radius in planet radii (default 2.25)

  // ── v2: Stellar environment ──────────────────────────────────
  /** Primary star spectral tint [r,g,b] — white = G2V Sun, orange = K/M, blue = A/F */
  starColor?: [number, number, number];
  /** Second star color (circumbinary systems) */
  starColor2?: [number, number, number];
  /** Second sun direction (circumbinary) */
  sunDir2?: [number, number, number];
  /** Primary sun brightness scale (default 1.0) */
  sunBrightness?: number;
  /** Second sun brightness (0 = no second sun) */
  sunBrightness2?: number;
  /** Rayleigh sky tint derived from stellar spectrum — M-dwarf = purple-pink, A = blue-white */
  rayleighColor?: [number, number, number];
  /** Stratospheric haze color */
  hazeColor?: [number, number, number];
  /** Stratospheric haze height 0-1 */
  hazeHeight?: number;

  // ── v2: Storm systems ───────────────────────────────────────
  /** Storm vortex latitude in radians (signed: positive = north) */
  stormLat?: number;
  /** Storm vortex longitude in radians */
  stormLon?: number;
  /** Storm size 0-1 (0.3 = moderate hurricane, 0.6 = great red spot) */
  stormSize?: number;
  /** Storm intensity 0-1 */
  stormIntensity?: number;

  // ── v2: Surface & atmosphere physics ────────────────────────
  /** USP / hot-rock dayside thermal emission (0-1). Drives red-hot dayside glow. */
  thermalGlow?: number;
  /** Explicit metallic surface (0=rock, 1=pure metal) — bypasses mineral-driven path */
  metallic?: number;
  /** Gas giant cloud deck temperature regime: 0=NH₃, 1=NH₄SH, 2=H₂O, 3=silicate */
  cloudRegime?: number;
  /** Hot Jupiter night-side cloud fraction (0-1) — bright reflective night side */
  nightCloudFraction?: number;
  /** Resonance chain tidal heat glow strength (0-1) */
  resonanceHeat?: number;
  /** Subsurface ocean world (Europa-type): 0=none, 1=full ice shell over liquid ocean */
  subsurfaceOcean?: number;

  // ── v2: Environment & special lighting ──────────────────────
  /** Aurora intensity scale (0-1, stacks on top of tectonics-driven aurora) */
  auroraStrength?: number;
  /** Aurora spectral color [r,g,b] — green for O/N₂ atm, red for CO₂, cyan for H */
  auroraColor?: [number, number, number];
  /** Post-main-sequence ambient light [r,g,b] — red giant warmth, WD blue-white, pulsar violet */
  postMsAmbient?: [number, number, number];
  /** Moon rendering flag: 1.0 = apply moon-specific surface (regolith, ray systems, sharp terminator) */
  isMoon?: number;
}

export type { BiomeInfo } from './zones';
export type { ZoneTexSet, TextureTriplet } from './textures';
