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

  // Latitude-based zones
  if (absLat > 0.72) return BIOME_DATA.boreal_highland;
  if (absLat > 0.42) {
    if (temperature > 220 && temperature < 340 && vis.oceanLevel > 0.2) return BIOME_DATA.temperate_plain;
    if (temperature > 310) return BIOME_DATA.arid_badlands;
    return BIOME_DATA.highland_craton;
  }
  if (absLat < 0.14) {
    if (vis.oceanLevel > 0.28 && temperature > 265 && temperature < 390) return BIOME_DATA.tropical_coast;
    if (temperature > 340) return BIOME_DATA.equatorial_desert;
    return BIOME_DATA.equatorial_belt;
  }
  // Mid-latitudes
  if (vis.oceanLevel > 0.32 && temperature > 248 && temperature < 385) return BIOME_DATA.temperate_plain;
  if (temperature > 315) return BIOME_DATA.arid_badlands;
  if (temperature < 175) return BIOME_DATA.cryo_plains;
  return BIOME_DATA.highland_craton;
}

/** Legacy alias for getBiomeAt */
export const classifyBiome = getBiomeAt;

/** Number of zones based on world mass (larger = more, up to 32 max) */
export function numZones(mass: number | undefined, isGas: boolean): number {
  if (isGas) return 0;
  const m = mass ?? 1.0;
  if (m < 0.02) return 10;   // dwarf/moon-sized
  if (m < 0.08) return 14;   // sub-Earth
  if (m < 0.4)  return 18;   // Mars-class
  if (m < 2.0)  return 22;   // Earth-class
  if (m < 6.0)  return 26;   // super-Earth
  return 30;                  // mega-Earth / sub-Neptune
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
    // Noise perturbation for organic irregularity
    const px = x * 2.8 + sx * 0.0031 + i * 5.3;
    const py = y * 2.8 + sx * 0.0031 + i * 3.7;
    const pz = z * 2.8 + sx * 0.0031 + i * 7.1;
    x += (_vFbm(px, py, pz) - 0.5) * 0.55;
    y += (_vFbm(px + 4.3, py + 1.9, pz + 6.1) - 0.5) * 0.40;
    z += (_vFbm(px + 2.1, py + 7.4, pz + 1.8) - 0.5) * 0.55;
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
