/**
 * zones.ts — Biome classification and zone generation for ProceduralWorld.
 *
 * Extracted from lib/planetBiomes.ts with rename:
 *   numBiomeZones → numZones
 *   classifyBiome → kept as alias for getBiomeAt
 */

import * as THREE from 'three';
import type { WorldVisuals } from './types';

export interface BiomeInfo {
  id: string;
  name: string;
  icon: string;
  climate: string;
  geology: string;
  description: string;
  resources: { water: number; minerals: number; energy: number; organics: number };
  habitability: number;
}

export const BIOME_DATA: Record<string, BiomeInfo> = {
  polar_ice:       { id:'polar_ice',       name:'Polar Ice Sheet',        icon:'❄️',  climate:'Cryogenic',       geology:'Water/N₂ ice',        description:'Permanent ice sheet with sublimation weathering and wind-driven accumulation patterns.',         resources:{water:0.95,minerals:0.15,energy:0.10,organics:0.10}, habitability:1 },
  boreal_highland: { id:'boreal_highland', name:'Boreal Highlands',       icon:'🏔️',  climate:'Subarctic',       geology:'Sedimentary upland',   description:'Cold highland terrain with ancient sedimentary layers, frost-weathered outcrops and periglacial drainage.', resources:{water:0.55,minerals:0.65,energy:0.20,organics:0.30}, habitability:4 },
  temperate_plain: { id:'temperate_plain', name:'Temperate Floodplain',   icon:'🌿',  climate:'Temperate',       geology:'Alluvial lowland',     description:'Broad mineral-rich alluvial plains with stable climate bands and moderate precipitation gradients.',       resources:{water:0.70,minerals:0.50,energy:0.45,organics:0.80}, habitability:8 },
  tropical_coast:  { id:'tropical_coast',  name:'Tropical Coastal Zone',  icon:'🌊',  climate:'Humid tropical',  geology:'Carbonate shelf',      description:'High-energy shoreline with carbonate buildups, tidal influence and warm shallow basins.',              resources:{water:0.90,minerals:0.35,energy:0.55,organics:0.90}, habitability:9 },
  equatorial_desert:{ id:'equatorial_desert',name:'Equatorial Dust Belt', icon:'🏜️',  climate:'Hyper-arid',      geology:'Aeolian deposits',     description:'Wind-scoured equatorial plains with dune fields, thermoclines and sparse volatile pockets.',            resources:{water:0.10,minerals:0.75,energy:0.85,organics:0.10}, habitability:2 },
  equatorial_belt: { id:'equatorial_belt', name:'Equatorial Lowlands',    icon:'🌡️',  climate:'Hot humid',       geology:'Volcanic plains',      description:'Low-latitude basaltic plains with aggressive chemical weathering and thick humid air masses.',           resources:{water:0.55,minerals:0.55,energy:0.65,organics:0.50}, habitability:5 },
  arid_badlands:   { id:'arid_badlands',   name:'Arid Badlands',          icon:'🪨',  climate:'Semi-arid',       geology:'Eroded mesas',         description:'Dissected plateau terrain with mesa stacks, ephemeral drainage and exposed mineral horizons.',           resources:{water:0.15,minerals:0.80,energy:0.50,organics:0.15}, habitability:2 },
  highland_range:  { id:'highland_range',  name:'Highland Range',         icon:'⛰️',  climate:'Alpine',          geology:'Metamorphic ridge',    description:'Active or ancient orogenic belt with exposed high-grade metamorphic sequences and glacial cirques.',      resources:{water:0.45,minerals:0.90,energy:0.30,organics:0.20}, habitability:3 },
  highland_craton: { id:'highland_craton', name:'Ancient Craton',         icon:'🗿',  climate:'Continental arid',geology:'Granitic basement',    description:'Stable Archean basement — billions of years old, deeply eroded, with concentrated rare mineral veins.',    resources:{water:0.30,minerals:0.70,energy:0.20,organics:0.10}, habitability:4 },
  rift_valley:     { id:'rift_valley',     name:'Rift Valley System',     icon:'🌋',  climate:'Tectonic humid',  geology:'Sedimentary basin',    description:'Active crustal rift with steep escarpments, hydrothermal activity and thick lacustrine sediments.',         resources:{water:0.65,minerals:0.80,energy:0.75,organics:0.35}, habitability:6 },
  deep_ocean:      { id:'deep_ocean',      name:'Abyssal Plain',          icon:'🔵',  climate:'Hadal',           geology:'Silicic ooze',         description:'Ultra-deep benthic zone with hydrothermal vents, cold-seep communities and polymetallic nodule fields.',   resources:{water:1.00,minerals:0.45,energy:0.35,organics:0.55}, habitability:1 },
  coastal_shelf:   { id:'coastal_shelf',   name:'Continental Shelf',      icon:'🐚',  climate:'Neritic',         geology:'Carbonate platform',   description:'Shallow-water carbonate platform with high productivity, reef structures and deltaic progradation.',        resources:{water:1.00,minerals:0.50,energy:0.40,organics:0.75}, habitability:7 },
  lava_fields:     { id:'lava_fields',     name:'Active Lava Plains',     icon:'🔥',  climate:'Pyroclastic',     geology:'Basaltic flows',       description:'Fresh lava fields with pahoehoe and aa textures, cooling-crack networks and sulfur fumaroles.',            resources:{water:0.00,minerals:0.65,energy:0.95,organics:0.00}, habitability:0 },
  volcanic_wastes: { id:'volcanic_wastes', name:'Volcanic Wastes',        icon:'☁️',  climate:'Ash-fall',        geology:'Tephra sheet',         description:'Thick pyroclastic blanket over subdued topography with buried mineral deposits and geothermal flux.',        resources:{water:0.10,minerals:0.70,energy:0.80,organics:0.00}, habitability:1 },
  cryo_plains:     { id:'cryo_plains',     name:'Cryogenic Plains',       icon:'🧊',  climate:'Cryo-nitrogen',   geology:'CH₄/N₂ frost',        description:'Flat cryogenic terrain with methane frost cycles, tholins and seasonal volatile precipitation.',             resources:{water:0.70,minerals:0.30,energy:0.20,organics:0.25}, habitability:2 },
};

// ── CPU-side noise matching the vertex shader vHash/vNoise/vFbm ──
// Used to classify biomes at a given sphere position on the CPU.
function _fract(x: number): number { return x - Math.floor(x); }
function _lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
function _vHash(px: number, py: number, pz: number): number {
  const ix = _fract(px * 0.3183099 + 0.71) * 17.0;
  const iy = _fract(py * 0.3183099 + 0.113) * 17.0;
  const iz = _fract(pz * 0.3183099 + 0.419) * 17.0;
  return _fract(ix * iy * iz * (ix + iy + iz));
}
function _vNoise(px: number, py: number, pz: number): number {
  const ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz);
  let fx = px - ix, fy = py - iy, fz = pz - iz;
  fx = fx*fx*fx*(fx*(fx*6-15)+10); fy = fy*fy*fy*(fy*(fy*6-15)+10); fz = fz*fz*fz*(fz*(fz*6-15)+10);
  return _lerp(
    _lerp(_lerp(_vHash(ix,iy,iz),    _vHash(ix+1,iy,iz),   fx), _lerp(_vHash(ix,iy+1,iz),   _vHash(ix+1,iy+1,iz),   fx), fy),
    _lerp(_lerp(_vHash(ix,iy,iz+1),  _vHash(ix+1,iy,iz+1), fx), _lerp(_vHash(ix,iy+1,iz+1), _vHash(ix+1,iy+1,iz+1), fx), fy),
    fz);
}
function _vFbm(px: number, py: number, pz: number): number {
  let f = 0, amp = 0.5;
  for (let i = 0; i < 5; i++) { f += amp * _vNoise(px, py, pz); px *= 2.03; py *= 2.03; pz *= 2.03; amp *= 0.48; }
  return f;
}
function _vWarpedFbm(px: number, py: number, pz: number): number {
  const qx = _vFbm(px, py, pz), qy = _vFbm(px+5.2, py+1.3, pz+2.8), qz = _vFbm(px+1.7, py+9.2, pz+3.4);
  return _vFbm(px + qx*1.5, py + qy*1.5, pz + qz*1.5);
}
function _vRidged(px: number, py: number, pz: number): number {
  let f = 0, amp = 0.5;
  for (let i = 0; i < 4; i++) {
    const n = 1.0 - Math.abs(_vNoise(px, py, pz) * 2.0 - 1.0); f += n*n*amp; px *= 2.1; py *= 2.1; pz *= 2.1; amp *= 0.45;
  }
  return f;
}
function _terrainHeight(px: number, py: number, pz: number, vis: WorldVisuals, sx: number): number {
  const sc = vis.noiseScale;
  let h = _vWarpedFbm(px*sc+sx, py*sc+sx, pz*sc+sx);
  if ((vis.mountainHeight ?? 0) > 0.01) h += _vRidged(px*3.5+sx*0.7, py*3.5+sx*0.7, pz*3.5+sx*0.7) * (vis.mountainHeight ?? 0) * 0.35;
  if ((vis.valleyDepth ?? 0) > 0.01) {
    const v = Math.pow(Math.abs(_vNoise(px*4+sx*1.3, py*4+sx*1.3, pz*4+sx*1.3) * 2.0 - 1.0), 0.3);
    h -= v * (vis.valleyDepth ?? 0) * 0.15;
  }
  return h;
}

/** Classify the biome at a unit-sphere position (object space, matches shader pos). */
export function getBiomeAt(
  pos: [number, number, number],
  vis: WorldVisuals,
  seed: number,
  temperature: number,
  worldType: string,
): BiomeInfo {
  const [px, py, pz] = pos;
  const sx = seed * 137.0;
  const absLat = Math.abs(py); // y = sin(lat) on unit sphere

  // Volcanic / lava worlds — override everything
  if ((vis.emissive ?? 0) > 0.3 || worldType === 'lava-world' || worldType === 'moon-volcanic') {
    const lvN = _vFbm(px*5+sx*0.002, py*5+sx*0.002, pz*5+sx*0.002);
    return lvN > 0.52 ? BIOME_DATA.lava_fields : BIOME_DATA.volcanic_wastes;
  }
  // Cryo / very cold
  if (temperature < 140 && (vis.isIce || (vis.iceCaps ?? 0) > 0.4)) {
    return BIOME_DATA.cryo_plains;
  }
  // Polar ice caps
  const iceN = _vFbm(px*2.8+sx*0.0005, py*2.8, pz*2.8) * 0.5 + 0.5;
  const iceEdge = 1.0 - (vis.iceCaps ?? 0) * (0.6 + iceN * 0.4);
  if (absLat > iceEdge && (vis.iceCaps ?? 0) > 0.02) return BIOME_DATA.polar_ice;

  // Terrain height (matches vertex displacement logic)
  const h = _terrainHeight(px, py, pz, vis, sx);
  const ridged = _vRidged(px*3.5+sx*0.7, py*3.5+sx*0.7, pz*3.5+sx*0.7);

  // Ocean zones
  if (h < vis.oceanLevel && vis.oceanLevel > 0.08) {
    const isDeep = h < vis.oceanLevel * 0.55;
    return isDeep ? BIOME_DATA.deep_ocean : BIOME_DATA.coastal_shelf;
  }

  // Mountain ranges (high ridged terrain with configured mountains)
  if (ridged > 0.64 && (vis.mountainHeight ?? 0) > 0.12) return BIOME_DATA.highland_range;

  // Valley / rift (low terrain + high valley depth)
  if ((vis.valleyDepth ?? 0) > 0.22) {
    const valN = _vFbm(px*4+sx*0.003, py*4, pz*4);
    if (valN < 0.38) return BIOME_DATA.rift_valley;
  }

  // ── Atmospheric circulation: wind moisture modifier ─────────────
  // Approximates Earth-like Hadley/Ferrel/Polar cells + trade winds.
  // Trade winds (0–30°): eastern flank of oceans is wetter (ITCZ lifts moisture).
  // Subtropical high (25–35°): descending dry air — deserts on western coasts.
  // Westerlies (35–65°): western flanks of land are wetter.
  // Polar easterlies (65–90°): cold, mostly dry.
  const latDeg  = Math.asin(Math.min(absLat, 1.0)) * 180 / Math.PI;
  const lonAng  = Math.atan2(pz, px);  // -π to π
  const eastExp = Math.sin(lonAng);    // +1 = eastern exposure, -1 = western
  let windMoist = 0.5;                 // neutral baseline
  if (latDeg < 28) {
    // Trade wind belt: easterly → eastern ocean coasts are wetter
    windMoist = 0.50 + eastExp * 0.28;
  } else if (latDeg < 36) {
    // Subtropical dry descent: broad suppression, slight orographic relief on east
    windMoist = 0.22 + eastExp * 0.12;
  } else if (latDeg < 65) {
    // Westerlies: western coasts wetter
    windMoist = 0.55 - eastExp * 0.25;
  } else {
    // Polar easterlies: cold and mostly dry
    windMoist = 0.25 + eastExp * 0.10;
  }
  windMoist = Math.max(0, Math.min(1, windMoist));

  const isHabitable = vis.oceanLevel > 0.08 && temperature > 200 && temperature < 400;
  const isMoist     = windMoist > 0.55 && isHabitable;
  const isDry       = windMoist < 0.35;

  // ── Latitude-based zones + wind moisture ─────────────────────────
  if (absLat > 0.72) {
    // Sub-polar: tundra-like or boreal depending on moisture + temperature
    if (temperature > 215 && isMoist && vis.atmThickness > 0.15) return BIOME_DATA.temperate_plain;
    return BIOME_DATA.boreal_highland;
  }
  if (absLat > 0.42) {
    // Mid-latitudes (Ferrel cell / westerlies zone)
    if (isDry || temperature > 310)  return BIOME_DATA.arid_badlands;
    if (temperature > 220 && temperature < 340 && vis.oceanLevel > 0.2) return BIOME_DATA.temperate_plain;
    if (temperature < 175) return BIOME_DATA.cryo_plains;
    return BIOME_DATA.highland_craton;
  }
  if (absLat < 0.14) {
    // Equatorial belt (Hadley cell — ITCZ)
    if (isMoist && vis.oceanLevel > 0.28 && temperature > 265 && temperature < 390) return BIOME_DATA.tropical_coast;
    if (isDry || temperature > 340) return BIOME_DATA.equatorial_desert;
    return BIOME_DATA.equatorial_belt;
  }
  // Sub-tropical / trade-wind band (20–42° latitude)
  if (isDry && latDeg > 20 && latDeg < 36) return BIOME_DATA.arid_badlands;
  if (isMoist && vis.oceanLevel > 0.32 && temperature > 248 && temperature < 385) return BIOME_DATA.temperate_plain;
  if (temperature > 315) return BIOME_DATA.arid_badlands;
  if (temperature < 175) return BIOME_DATA.cryo_plains;
  return BIOME_DATA.highland_craton;
}

/** Legacy alias for getBiomeAt */
export const classifyBiome = getBiomeAt;

/**
 * Number of Voronoi zones, scaled to world surface area.
 * Anchors: Ceres(0.000157)→5, Moon(0.0123)→28, Mars(0.107)→36,
 *          Earth(1.0)→50, 2×Earth→56, mega→64 (shader hard limit).
 */
export function numZones(mass: number | undefined, isGas: boolean): number {
  if (isGas) return 0;
  const m = mass ?? 1.0;
  if (m < 0.0003) return 5;    // Ceres-class
  if (m < 0.02)   return 28;   // Moon-class
  if (m < 0.12)   return 36;   // Mars-class
  if (m < 0.5)    return 42;   // sub-Earth
  if (m < 1.5)    return 50;   // Earth-class
  if (m < 3.0)    return 56;   // super-Earth
  if (m < 8.0)    return 62;   // mega-Earth
  return 64;                   // near sub-Neptune (shader hard limit)
}

/**
 * Generate Voronoi biome zone centers on the unit sphere.
 * Uses Fibonacci sphere for even distribution, then noise-perturbs for organic shapes.
 */
export function computeZoneCenters(seed: number, count: number): THREE.Vector3[] {
  const sx = seed * 137.0;
  const golden = Math.PI * (3 - Math.sqrt(5));
  const centers: THREE.Vector3[] = [];
  for (let i = 0; i < count; i++) {
    const y0 = 1 - (i / Math.max(count - 1, 1)) * 2;
    const r0 = Math.sqrt(Math.max(0, 1 - y0 * y0));
    const theta = golden * i;
    let x = Math.cos(theta) * r0;
    let y = y0;
    let z = Math.sin(theta) * r0;
    // Power-law zone sizing: every 5th zone is an "anchor" with low perturbation
    // so it claims a large Voronoi cell. Remaining zones pack into the gaps as
    // smaller "satellite" territories. Produces natural continent-vs-microzone look.
    const isAnchor = (i % 5 === 0);
    const perturbAmp = isAnchor ? 0.14 : 0.55;
    const px = x * 2.8 + sx * 0.0031 + i * 5.3;
    const py = y * 2.8 + sx * 0.0031 + i * 3.7;
    const pz = z * 2.8 + sx * 0.0031 + i * 7.1;
    x += (_vFbm(px, py, pz) - 0.5) * perturbAmp;
    y += (_vFbm(px + 4.3, py + 1.9, pz + 6.1) - 0.5) * (perturbAmp * 0.73);
    z += (_vFbm(px + 2.1, py + 7.4, pz + 1.8) - 0.5) * perturbAmp;
    const len = Math.sqrt(x*x + y*y + z*z);
    centers.push(new THREE.Vector3(x / len, y / len, z / len));
  }
  return centers;
}

/** Given a sphere hit point, return the index of the nearest zone center */
export function nearestZone(pos: THREE.Vector3, centers: THREE.Vector3[]): number {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < centers.length; i++) {
    const d = 1 - pos.dot(centers[i]);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

// =============================================================
// ZONE ROLE SYSTEM
// Assigns semantic roles to Voronoi zones based on world type.
// Roles drive texture selection, ice cap placement, eyeball
// hot/cold/terminator rendering in the fragment shader.
// =============================================================

export const ZONE_ROLE = {
  DEFAULT:     0.0,  // standard terrain zone
  POLAR_ICE:   1.0,  // polar ice cap zone
  SUBSTELLAR:  2.0,  // eyeball/tidally-locked: star-facing hot
  ANTISTELLAR: 3.0,  // eyeball/tidally-locked: anti-star cold/ice
  TERMINATOR:  4.0,  // eyeball: terminator ring zone
  CRATON:      5.0,  // ancient stable basement — high elevation, smooth, old
  RIFT:        6.0,  // active rift valley — low, rough, fresh basalt
  SHELF:       7.0,  // continental shelf — shallow ocean, carbonate platform
  RIDGE:       8.0,  // mid-ocean ridge — submarine mountain chain, hydrothermal
  TRENCH:      9.0,  // subduction trench — deepest ocean, hadal zone
  HOTSPOT:    10.0,  // volcanic hotspot — isolated uplift, land or ocean
} as const;

/**
 * Assign semantic roles to zone centers.
 *
 * Science-driven assignment pipeline:
 *   1. Eyeball / tidally-locked: substellar, antistellar, terminator
 *   2. Ice caps: polar zones
 *   3. Ocean bathymetry: shelf, ridge, trench — driven by oceanLevel + tectonics
 *   4. Geology: craton / rift / hotspot — driven by planet conditions, not random hash
 *
 * Returns float[] matching centers array, suitable for uZoneRoles uniform.
 */
export function computeZoneRoles(
  centers: THREE.Vector3[],
  worldType: string,
  tidallyLocked: boolean,
  iceCaps: number,
  seed: number = 0,
  oceanLevel: number = 0,
  volcanism: number = 0,
  temperature: number = 288,
  terrainAge: number = 0.5,
  tectonics: number = 0.5,
  craterDensity: number = 0.0,
  atmThickness: number = 0.3,
  mountainHeight: number = 0.0,
  sunDirection: [number, number, number] = [1, 0, 0],
): number[] {
  const roles: number[] = centers.map(() => ZONE_ROLE.DEFAULT);
  const n = centers.length;

  // ── 1. EYEBALL / TIDAL LOCK ──────────────────────────────────────
  if (tidallyLocked || worldType === 'eyeball-world') {
    // Use actual sun direction so zone labels match the visual light source
    const sun = new THREE.Vector3(sunDirection[0], sunDirection[1], sunDirection[2]).normalize();
    centers.forEach((c, i) => {
      const d = c.dot(sun);
      if (d > 0.68)       roles[i] = ZONE_ROLE.SUBSTELLAR;
      else if (d < -0.58) roles[i] = worldType === 'ocean-eyeball' ? ZONE_ROLE.POLAR_ICE : ZONE_ROLE.ANTISTELLAR;
      else if (Math.abs(d) < 0.38) roles[i] = ZONE_ROLE.TERMINATOR;
    });
  } else if (iceCaps > 0.20) {
    // ── 2. POLAR ICE CAPS ──────────────────────────────────────────
    // Threshold 0.20: airless bodies max at 0.12 (frost in craters only, no zones).
    // Atmosphered cold worlds start at 0.45+ — they get real glacial zones.
    // iceLine matches shader formula: 1.0 - iceCaps * 0.14
    // Each zone centre gets a small seed-driven latitude offset so the
    // ice boundary is irregular (natural glacial lobes), not a perfect band.
    const iceLine = 1.0 - iceCaps * 0.14;
    centers.forEach((c, i) => {
      const absY = Math.abs(c.y);
      // (wobble subsumed into distAboveLine via coldHash probability below)
      // Zone "coldness" character — not every high-lat zone is equally glaciated.
      // Zones closer to the pole are always ice; boundary zones are probabilistic.
      const coldHash = (Math.abs(Math.sin(i * 73.1 + seed * 1.617) * 43758.5453) % 1);
      const distAboveLine = absY - (iceLine - 0.10);
      // Probability of ice: 0% well below the line, 100% very close to pole.
      // Transition band ~0.30 wide where hash decides — creates organic border.
      const iceProb = Math.max(0, Math.min(1, distAboveLine / 0.30));
      if (iceProb > 0 && (coldHash < iceProb || distAboveLine > 0.28)) {
        roles[i] = ZONE_ROLE.POLAR_ICE;
      }
    });
  }

  // ── 3. OCEAN BATHYMETRY ───────────────────────────────────────────
  // For significant ocean worlds, assign shelf/ridge/trench roles to
  // drive realistic ocean floor morphology via terrain height biasing.
  // Fractions scale with oceanLevel so deep water worlds have more ocean zones.
  if (oceanLevel > 0.40 && seed !== 0 && n >= 8) {
    // How many zones to assign — rises with ocean coverage
    const oceanFrac   = Math.min((oceanLevel - 0.40) / 0.50, 1.0);  // 0 at 40%, 1 at 90%
    const nShelf  = Math.max(1, Math.round(n * oceanFrac * 0.14));  // ~14% of zones → shelf
    const nRidge  = Math.max(1, Math.round(n * oceanFrac * 0.08));  // ~8% → mid-ocean ridge
    const nTrench = oceanLevel > 0.55 ? Math.max(1, Math.round(n * oceanFrac * 0.04)) : 0; // ~4% → trench

    // Assign via deterministic hash (not purely index-ordered to spread across sphere)
    let shelfCount = 0, ridgeCount = 0, trenchCount = 0;
    // Two-pass: first trench (deepest, rarest), then ridge, then shelf
    for (let i = 0; i < n && trenchCount < nTrench; i++) {
      if (roles[i] !== ZONE_ROLE.DEFAULT) continue;
      const h1 = Math.abs((Math.sin(i * 197.3 + seed * 1.71) * 43758.5453) % 1);
      if (h1 < (nTrench / n) * 2.2) { roles[i] = ZONE_ROLE.TRENCH; trenchCount++; }
    }
    for (let i = 0; i < n && ridgeCount < nRidge; i++) {
      if (roles[i] !== ZONE_ROLE.DEFAULT) continue;
      const h2 = Math.abs((Math.sin(i * 311.9 + seed * 0.83) * 43758.5453) % 1);
      // Ridges prefer equatorial band (mid-ocean ridges are common there)
      const latPref = 1.0 - Math.abs(centers[i].y) * 0.5;
      if (h2 < (nRidge / n) * 2.5 * latPref) { roles[i] = ZONE_ROLE.RIDGE; ridgeCount++; }
    }
    for (let i = 0; i < n && shelfCount < nShelf; i++) {
      if (roles[i] !== ZONE_ROLE.DEFAULT) continue;
      const h3 = Math.abs((Math.sin(i * 419.7 + seed * 2.13) * 43758.5453) % 1);
      if (h3 < (nShelf / n) * 2.8) { roles[i] = ZONE_ROLE.SHELF; shelfCount++; }
    }
  }

  // ── 4. GEOLOGY: CRATON + RIFT + HOTSPOT (condition-driven) ──────────────
  //
  // Roles are driven by planet-wide physical conditions, not pure randomness:
  //
  //   CRATON:  ancient, stable basement — old worlds (high terrainAge), low tectonics,
  //            heavily cratered, mid-latitude. High/smooth zones only.
  //
  //   RIFT:    active extensional tectonics — young crust (low terrainAge), high
  //            tectonics, rough + low zones. Avoids polar and tight equatorial bands.
  //
  //   HOTSPOT: isolated mantle-plume upwelling — driven purely by volcanism.
  //            Sparse, any latitude below ~65°. Hot/warm worlds only.
  //
  // Atmospheric erosion (atmThickness) blurs the boundaries:
  //   thick atm → weathers away sharp craton/rift contrasts over time.
  //
  // mountainHeight biases toward RIFT/orogenic: active mountain belts form at
  //   convergent margins (rift-adjacent) on tectonically alive worlds.
  //
  if (seed !== 0) {
    // Temperature factors: very hot worlds are geologically active; frozen worlds are inert
    const tempActivity = temperature > 500 ? Math.min(1, (temperature - 500) / 800) : 0;
    const tempInert    = temperature < 180 ? Math.min(1, (180 - temperature) / 100) : 0;

    // Planet-wide stability index: 0=young/active, 1=ancient/dead
    const stability = Math.max(0, Math.min(1,
      terrainAge * 0.45 + craterDensity * 0.30 + (1.0 - tectonics) * 0.20 + 0.05
      - tempActivity * 0.15,
    ));
    // Planet-wide activity index: 0=dead, 1=highly active
    const activity = Math.max(0, Math.min(1,
      tectonics * 0.40 + volcanism * 0.25 + (1.0 - terrainAge) * 0.25
      + (mountainHeight > 0.2 ? mountainHeight * 0.10 : 0)
      + tempActivity * 0.10 - tempInert * 0.30,
    ));
    // Atmospheric weathering: thick atm erodes extremes (less cratons + rifts on water worlds)
    const atmErosion = Math.min(1, atmThickness * 1.4);

    centers.forEach((c, i) => {
      if (roles[i] !== ZONE_ROLE.DEFAULT) return;
      const absLat = Math.abs(c.y);
      const latDeg = Math.asin(Math.min(absLat, 1.0)) * 180 / Math.PI;

      // Hash-derived character axes — must match shader formula exactly
      const ex = Math.abs((Math.sin(i * 127.1 + seed) * 43758.5453) % 1);
      const ey = Math.abs((Math.sin(i * 311.7 + seed * 0.37) * 43758.5453) % 1);
      const ze = ex < 0.5 ? 2*ex*ex : 1-2*(1-ex)*(1-ex);  // elevation 0=basin 1=highland
      const zr = ey < 0.5 ? 2*ey*ey : 1-2*(1-ey)*(1-ey);  // roughness 0=smooth 1=active
      const eh = Math.abs((Math.sin(i * 613.1 + seed * 0.55) * 43758.5453) % 1);

      // ── HOTSPOT ───────────────────────────────────────────────────────────
      // Sparse volcanic upwelling. Drives temperature, so suppress near poles.
      // Present even on cool worlds if volcanism is high.
      const hotLatFactor = latDeg < 62 ? 1.0 : Math.max(0, 1.0 - (latDeg - 62) / 20);
      if (volcanism > 0.20 && eh < volcanism * 0.11 * hotLatFactor) {
        roles[i] = ZONE_ROLE.HOTSPOT;
        return;
      }

      // ── RIFT ──────────────────────────────────────────────────────────────
      // Active extensional basin. Needs young, rough, low ground.
      // Thicker atm reduces rift expression (erosion fills basins).
      // Not at poles or tight equatorial band (where cratons dominate).
      if (activity > 0.25 && ze < 0.38 && zr > 0.52 && latDeg > 8 && latDeg < 72) {
        // Score: how much each condition contributes
        const riftElevScore  = Math.max(0, 0.38 - ze) / 0.38;        // peaks at ze=0
        const riftRoughScore = Math.max(0, zr - 0.52) / 0.48;        // peaks at zr=1
        const riftLatScore   = latDeg > 15 && latDeg < 60 ? 1.0 : 0.65;
        const riftScore = activity * riftElevScore * riftRoughScore * riftLatScore * (1.0 - atmErosion * 0.35);
        if (riftScore > 0.14) {
          roles[i] = ZONE_ROLE.RIFT;
          return;
        }
      }

      // ── CRATON ────────────────────────────────────────────────────────────
      // Ancient stable basement. Needs old, smooth, elevated ground.
      // Common at mid-latitudes on geologically dead worlds.
      // Atmospheric weathering suppresses cratons on young ocean worlds.
      if (stability > 0.25 && ze > 0.55 && zr < 0.42 && latDeg > 15 && latDeg < 78) {
        const cratonElevScore   = Math.max(0, ze - 0.55) / 0.45;     // peaks at ze=1
        const cratonSmoothScore = Math.max(0, 0.42 - zr) / 0.42;     // peaks at zr=0
        const cratonLatScore    = latDeg > 22 && latDeg < 68 ? 1.0 : 0.70;
        const cratonScore = stability * cratonElevScore * cratonSmoothScore * cratonLatScore * (1.0 - atmErosion * 0.25);
        if (cratonScore > 0.16) {
          roles[i] = ZONE_ROLE.CRATON;
          return;
        }
      }
    });
  }

  // ── 4b. TECTONIC LINEAMENTS ──────────────────────────────────────────────
  // Two great-circle fault lines run across the planet. Zones whose center
  // falls within ~15° of a fault line are biased toward RIFT (land) or
  // RIDGE (ocean), reinforcing the linear structures real plate tectonics
  // create. Only applies on geologically active worlds (activity > 0.20).
  if (seed !== 0 && tectonics > 0.25) {
    // Two fault poles — deterministic from seed
    const fa1x = Math.sin(seed * 0.0137) * Math.cos(seed * 0.0073);
    const fa1y = Math.cos(seed * 0.0137);
    const fa1z = Math.sin(seed * 0.0137) * Math.sin(seed * 0.0073);
    const fp1 = new THREE.Vector3(fa1x, fa1y, fa1z).normalize();

    const fa2x = Math.sin(seed * 0.0251 + 1.0) * Math.cos(seed * 0.0193 + 0.7);
    const fa2y = Math.cos(seed * 0.0251 + 1.0);
    const fa2z = Math.sin(seed * 0.0251 + 1.0) * Math.sin(seed * 0.0193 + 0.7);
    const fp2 = new THREE.Vector3(fa2x, fa2y, fa2z).normalize();

    // |dot(c, pole)| = sin(angle between c and the great-circle plane)
    // Zone is "near fault" if that angle < 15°, i.e. |dot| < sin(15°)
    const faultSin = Math.sin(15 * Math.PI / 180);  // ≈ 0.259

    centers.forEach((c, i) => {
      if (roles[i] !== ZONE_ROLE.DEFAULT) return;

      const d1 = Math.abs(c.dot(fp1));
      const d2 = Math.abs(c.dot(fp2));
      const nearFault = d1 < faultSin || d2 < faultSin;
      if (!nearFault) return;

      // Hash for this zone
      const fh = Math.abs((Math.sin(i * 137.1 + seed * 2.31) * 43758.5453) % 1);

      if (oceanLevel > 0.50 && fh < tectonics * 0.55) {
        roles[i] = ZONE_ROLE.RIDGE;  // submarine fault ridge
      } else if (fh < tectonics * 0.40) {
        roles[i] = ZONE_ROLE.RIFT;   // continental rift zone
      }
    });
  }

  // ── 4c. HOTSPOT ADJACENCY CONSTRAINT (#18) ───────────────────────────────
  // Two HOTSPOTs that are nearest neighbours are geologically implausible —
  // mantle plumes are spread across the convection cell. If two HOTSPOTs
  // share a nearest-neighbour relationship, downgrade the weaker one to RIDGE.
  {
    for (let i = 0; i < n; i++) {
      if (roles[i] !== ZONE_ROLE.HOTSPOT) continue;
      const nearest = centers
        .map((c, j) => ({ j, d: 1 - centers[i].dot(c) }))
        .sort((a, b) => a.d - b.d)
        .slice(1, 4);  // 3 nearest
      for (const { j } of nearest) {
        if (roles[j] === ZONE_ROLE.HOTSPOT) {
          // Downgrade the one with fewer hotspot neighbours to a ridge
          roles[j] = ZONE_ROLE.RIDGE;
          break;
        }
      }
    }
  }

  // ── 5. ENCLAVE ELIMINATION ───────────────────────────────────
  // Any zone that has no same-role neighbor within its K nearest zones
  // is topologically an enclave/exclave and will appear as a lone island.
  // Reassign it to the plurality role among its neighbors.
  //
  // Uses K=6 nearest neighbors (spherical dot-product distance).
  // Two passes: single-cell islands are absorbed in pass 1,
  // two-cell islands often collapse in pass 2.
  const K_NEIGH = 6;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) {
      if (roles[i] === ZONE_ROLE.DEFAULT) continue;
      // Build sorted neighbour list for zone i
      const dists = centers.map((c, j) => ({ j, d: 1 - centers[i].dot(c) }));
      dists.sort((a, b) => a.d - b.d);
      const nbrs = dists.slice(1, K_NEIGH + 1).map(x => x.j);
      // Same-role neighbour count
      const sameRoleCount = nbrs.filter(j => roles[j] === roles[i]).length;
      if (sameRoleCount === 0) {
        // Isolated — adopt plurality role among neighbours
        const freq = new Map<number, number>();
        for (const j of nbrs) freq.set(roles[j], (freq.get(roles[j]) ?? 0) + 1);
        const best = [...freq.entries()].sort((a, b) => b[1] - a[1])[0];
        roles[i] = best ? best[0] : ZONE_ROLE.DEFAULT;
      }
    }
  }

  return roles;
}

/**
 * Zone distribution for eyeball/tidally-locked worlds.
 *
 * Layout philosophy:
 *   Day side  (x > 0.55):  1–2 large hot zones — substellar point + inner hot ring
 *   Night side (x < -0.55): 3–4 zones — antistellar + cold/ice flanks
 *   Terminator ring (|x| < 0.55): bulk of zones — compact equatorial territories
 *     arranged in a CONE rather than a flat ring, so Voronoi cells form
 *     roughly square/compact patches rather than long wedge strips.
 *
 * The key improvement: terminator zones are scattered in a BAND (±30° x-axis)
 * rather than exactly on the yz circle, producing compact territories.
 */
export function computeZoneCentersEyeball(seed: number, count: number): THREE.Vector3[] {
  const sx = seed * 137.0;
  const centers: THREE.Vector3[] = [];

  // Substellar cap: 1 central zone + 1 flanking hot zone
  centers.push(new THREE.Vector3(
    0.90 + (_vFbm(sx*0.001, sx*0.002, 0.1) - 0.5) * 0.08,
           (_vFbm(sx*0.003, 0.1, sx*0.004) - 0.5) * 0.18,
           (_vFbm(0.1, sx*0.005, sx*0.006) - 0.5) * 0.18,
  ).normalize());
  // Hot ring zone (just inside day side)
  centers.push(new THREE.Vector3(
    0.60 + (_vFbm(sx*0.031, sx*0.032, 3.1) - 0.5) * 0.12,
           (_vFbm(sx*0.033, 3.1, sx*0.034) - 0.5) * 0.45,
           (_vFbm(3.1, sx*0.035, sx*0.036) - 0.5) * 0.45,
  ).normalize());

  // Antistellar: 3 zones spread across night hemisphere
  for (let ai = 0; ai < 3; ai++) {
    const ang = (ai / 3.0) * Math.PI * 2.0 + 0.3;
    centers.push(new THREE.Vector3(
      -0.80 + (_vFbm(sx*0.04+ai*1.1, sx*0.05+ai*2.3, ai*1.7) - 0.5) * 0.14,
      Math.sin(ang) * 0.50 + (_vFbm(sx*0.06+ai*3.1, ai*0.9, sx*0.07+ai*5.3) - 0.5) * 0.22,
      Math.cos(ang) * 0.50 + (_vFbm(ai*4.7, sx*0.08+ai*1.3, sx*0.09+ai*2.9) - 0.5) * 0.22,
    ).normalize());
  }

  // Terminator belt: remaining zones in a BAND (not a ring) for compact cells.
  // Fibonacci spiral within x ∈ [-0.48, +0.48] and all latitudes — this creates
  // roughly equal-area cells across the habitable belt.
  const termCount = count - 5;
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < termCount; i++) {
    const t   = (i + 0.5) / termCount;
    const ang = golden * i;
    // x ranges from -0.48 to +0.48 for variety (some lean day side, some night)
    const xTarget = (t * 2.0 - 1.0) * 0.48;
    const r = Math.sqrt(Math.max(0, 1 - xTarget * xTarget));
    let x = xTarget + (_vFbm(i*1.7 + sx*0.001, i*0.9 + sx*0.002, i*3.1 + sx*0.003) - 0.5) * 0.22;
    let y = Math.sin(ang) * r + (_vFbm(i*2.3 + sx*0.004, i*4.1 + sx*0.005, i*0.7 + sx*0.006) - 0.5) * 0.22;
    let z = Math.cos(ang) * r + (_vFbm(i*5.9 + sx*0.007, i*1.3 + sx*0.008, i*7.1 + sx*0.009) - 0.5) * 0.22;
    const len = Math.sqrt(x*x + y*y + z*z);
    centers.push(new THREE.Vector3(x / len, y / len, z / len));
  }

  return centers;
}

// =============================================================
// FEATURE 16: ZONE GEOLOGICAL ARCHETYPE
// Maps zone character axes to a named geological identity.
// Used for UI labels alongside the biome display.
// =============================================================

// Role-matched geological archetype name banks.
// Each role gets several sub-labels so adjacent zones of the same role read differently.
const ROLE_ARCHETYPES: Partial<Record<number, readonly string[]>> = {
  [ZONE_ROLE.CRATON]:      ['Ancient Craton', 'Archean Shield', 'Granitic Basement', 'Precambrian Massif', 'Stable Inlier'],
  [ZONE_ROLE.RIFT]:        ['Rift Valley System', 'Extensional Basin', 'Graben Depression', 'Basaltic Rift Basin', 'Crustal Rift Zone'],
  [ZONE_ROLE.SHELF]:       ['Continental Shelf', 'Carbonate Platform', 'Neritic Terrace', 'Shallow Shelf Margin'],
  [ZONE_ROLE.RIDGE]:       ['Mid-Ocean Ridge', 'Spreading Center', 'Axial Volcanic High', 'Submarine Ridge Crest'],
  [ZONE_ROLE.TRENCH]:      ['Subduction Trench', 'Hadal Forearc Basin', 'Trench Axis', 'Deep Subduction Zone'],
  [ZONE_ROLE.HOTSPOT]:     ['Volcanic Hotspot', 'Mantle Plume Upwelling', 'Intraplate Shield Volcano', 'Hotspot Chain'],
  [ZONE_ROLE.POLAR_ICE]:   ['Polar Ice Sheet', 'Glacial Cap Complex', 'Cryogenic Ice Basin', 'Polar Ice Field'],
  [ZONE_ROLE.SUBSTELLAR]:  ['Substellar Desert', 'Thermal Convergence Zone', 'Permanent Noon Desert'],
  [ZONE_ROLE.ANTISTELLAR]: ['Night-Side Ice Plain', 'Cold Trap Basin', 'Dark Hemisphere Tundra'],
  [ZONE_ROLE.TERMINATOR]:  ['Terminator Margin', 'Twilight Plain', 'Habitable Fringe Zone'],
};

// Fallback names for DEFAULT zones — derived from ze/zr/zm character axes.
// Exported as GEOLOGICAL_ARCHETYPES for back-compat with ProceduralPlanet.tsx re-export.
export const GEOLOGICAL_ARCHETYPES = [
  'Abyssal Plain',       // low  + smooth + silicate
  'Basaltic Basin',      // low  + rough  + silicate
  'Oxidised Lowland',    // low  + smooth + iron
  'Pyroclastic Depression', // low + rough + iron
  'Continental Shelf',   // mid  + smooth + silicate
  'Eroded Upland',       // mid  + rough  + silicate
  'Desert Plateau',      // mid  + smooth + iron
  'Volcanic Field',      // mid  + rough  + iron
  'Glacial Plateau',     // high + smooth + silicate
  'Alpine Massif',       // high + rough  + silicate
  'Oxide Ridge',         // high + smooth + iron
  'Volcanic Summit',     // high + rough  + iron
] as const;

/**
 * Geological archetype label for a zone.
 * When a role is provided (from computeZoneRoles), the label is derived from
 * the actual assigned role so the UI label matches the visual appearance.
 * Falls back to character-axis classification for DEFAULT zones.
 */
export function zoneArchetype(zoneIndex: number, seed: number, role?: number): string {
  // Role-matched label — pick sub-variant by zone index for variety
  if (role !== undefined && role !== ZONE_ROLE.DEFAULT) {
    const bank = ROLE_ARCHETYPES[role];
    if (bank && bank.length > 0) {
      const pick = Math.abs(Math.round((Math.sin(zoneIndex * 73.1 + seed * 0.31) * 43758.5453) % bank.length));
      return bank[pick % bank.length];
    }
  }

  // DEFAULT zone: classify from character axes (elevation / roughness / mineral)
  const ex = Math.abs((Math.sin(zoneIndex * 127.1 + seed) * 43758.5453) % 1);
  const ey = Math.abs((Math.sin(zoneIndex * 311.7 + seed * 0.37) * 43758.5453) % 1);
  const ez = Math.abs((Math.sin(zoneIndex * 491.3 + seed * 0.71) * 43758.5453) % 1);
  const ze = ex < 0.5 ? 2*ex*ex : 1-2*(1-ex)*(1-ex);
  const zr = ey < 0.5 ? 2*ey*ey : 1-2*(1-ey)*(1-ey);
  const zm = ez < 0.5 ? 2*ez*ez : 1-2*(1-ez)*(1-ez);
  const elevTier = ze < 0.35 ? 0 : ze < 0.70 ? 1 : 2;
  const idx = elevTier * 4 + (zm > 0.5 ? 2 : 0) + (zr > 0.5 ? 1 : 0);
  return GEOLOGICAL_ARCHETYPES[Math.min(idx, GEOLOGICAL_ARCHETYPES.length - 1)];
}

/**
 * Feature 36: Human-readable labels for a zone's character axes.
 * Uses the same hash formula as the shader so labels match what's rendered.
 */
export function zoneCharLabel(zoneIndex: number, seed: number): {
  elevation: string; roughness: string; mineral: string;
} {
  const ex = Math.abs((Math.sin(zoneIndex * 127.1 + seed) * 43758.5453) % 1);
  const ey = Math.abs((Math.sin(zoneIndex * 311.7 + seed * 0.37) * 43758.5453) % 1);
  const ez = Math.abs((Math.sin(zoneIndex * 491.3 + seed * 0.71) * 43758.5453) % 1);
  const ze = ex < 0.5 ? 2*ex*ex : 1-2*(1-ex)*(1-ex);
  const zr = ey < 0.5 ? 2*ey*ey : 1-2*(1-ey)*(1-ey);
  const zm = ez < 0.5 ? 2*ez*ez : 1-2*(1-ez)*(1-ez);
  const elevation = ze < 0.25 ? 'Deep Basin' : ze < 0.50 ? 'Lowland' : ze < 0.75 ? 'Upland' : 'Highland';
  const roughness = zr < 0.25 ? 'Smooth' : zr < 0.50 ? 'Rolling' : zr < 0.75 ? 'Rugged' : 'Active';
  const mineral   = zm < 0.25 ? 'Silicate' : zm < 0.50 ? 'Mixed'   : zm < 0.75 ? 'Ferrous' : 'Iron-oxide';
  return { elevation, roughness, mineral };
}
