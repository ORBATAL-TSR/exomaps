/**
 * ColonyTerrain — Heightmap sampling, A* pathfinding, and territory flood-fill
 * for colony overlays on procedural planets.
 *
 * This module mirrors the GLSL vertex shader noise exactly so that
 * terrain-aware roads, sea routes, and natural territory borders
 * align with the visible planet surface.
 *
 * Results are cached per planet/moon to avoid recomputation.
 */

/* ══════════════════════════════════════════════════════
   Grid Constants
   ══════════════════════════════════════════════════════ */

export const GRID_W = 256;   // longitude cells
export const GRID_H = 128;   // latitude cells
export const CELL_LAT = 180 / GRID_H;  // degrees per cell vertically
export const CELL_LON = 360 / GRID_W;  // degrees per cell horizontally

/* ══════════════════════════════════════════════════════
   Terrain Parameters
   ══════════════════════════════════════════════════════ */

export interface TerrainParams {
  seed: number;
  noiseScale: number;
  oceanLevel: number;
  mountainHeight: number;
  valleyDepth: number;
  volcanism: number;
  planetRadiusKm?: number;  // real planet radius in km (default ~6371 for Earth)
}

/* ══════════════════════════════════════════════════════
   Ship / Naval Unit Types
   ══════════════════════════════════════════════════════ */

export interface Ship {
  id: string;
  lat: number;        // current position
  lon: number;
  targetLat?: number; // movement destination (if moving)
  targetLon?: number;
  progress: number;   // 0-1 travel progress
  speed: number;      // degrees per second of travel
  name: string;
}

/* ══════════════════════════════════════════════════════
   Noise Functions — exact port of GLSL vertex shader
   ══════════════════════════════════════════════════════ */

function fract(x: number): number { return x - Math.floor(x); }
function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function hash3(x: number, y: number, z: number): number {
  let px = fract(x * 0.3183099 + 0.71);
  let py = fract(y * 0.3183099 + 0.113);
  let pz = fract(z * 0.3183099 + 0.419);
  px *= 17; py *= 17; pz *= 17;
  return fract(px * py * pz * (px + py + pz));
}

function noise3(x: number, y: number, z: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  let fx = x - ix, fy = y - iy, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  fz = fz * fz * (3 - 2 * fz);
  return lerp(
    lerp(
      lerp(hash3(ix, iy, iz),     hash3(ix+1, iy, iz),     fx),
      lerp(hash3(ix, iy+1, iz),   hash3(ix+1, iy+1, iz),   fx), fy),
    lerp(
      lerp(hash3(ix, iy, iz+1),   hash3(ix+1, iy, iz+1),   fx),
      lerp(hash3(ix, iy+1, iz+1), hash3(ix+1, iy+1, iz+1), fx), fy), fz);
}

function fbm5(px: number, py: number, pz: number): number {
  let f = 0, amp = 0.5;
  for (let i = 0; i < 5; i++) {
    f += amp * noise3(px, py, pz);
    px *= 2.03; py *= 2.03; pz *= 2.03;
    amp *= 0.48;
  }
  return f;
}

function warpedFbm(px: number, py: number, pz: number): number {
  const qx = fbm5(px, py, pz);
  const qy = fbm5(px + 5.2, py + 1.3, pz + 2.8);
  const qz = fbm5(px + 1.7, py + 9.2, pz + 3.4);
  return fbm5(px + qx * 1.5, py + qy * 1.5, pz + qz * 1.5);
}

function ridged4(px: number, py: number, pz: number): number {
  let f = 0, amp = 0.5;
  for (let i = 0; i < 4; i++) {
    const n = 1 - Math.abs(noise3(px, py, pz) * 2 - 1);
    f += n * n * amp;
    px *= 2.1; py *= 2.1; pz *= 2.1;
    amp *= 0.45;
  }
  return f;
}

/** Sample terrain height at a unit-sphere direction — mirrors GLSL vertexHeight() */
export function sampleHeight(
  dx: number, dy: number, dz: number,
  seed: number, noiseScale: number,
  mountainHeight: number, valleyDepth: number, volcanism: number,
): number {
  // GLSL uses uSeedV = seed * 137.0 — must match here
  const s = seed * 137.0;
  const px = dx * noiseScale + s;
  const py = dy * noiseScale + s;
  const pz = dz * noiseScale + s;
  let h = warpedFbm(px, py, pz);

  if (mountainHeight > 0.01) {
    h += ridged4(
      dx * 3.5 + s * 0.7,
      dy * 3.5 + s * 0.7,
      dz * 3.5 + s * 0.7,
    ) * mountainHeight * 0.35;
  }
  if (valleyDepth > 0.01) {
    let v = Math.abs(
      noise3(dx * 4 + s * 1.3, dy * 4 + s * 1.3, dz * 4 + s * 1.3) * 2 - 1,
    );
    v = Math.pow(v, 0.3);
    h -= (1 - v) * valleyDepth * 0.20;
  }
  if (volcanism > 0.01) {
    const fx = fract(dx * 2.5 + s) - 0.5;
    const fy = fract(dy * 2.5 + s) - 0.5;
    const fz = fract(dz * 2.5 + s) - 0.5;
    const len = Math.sqrt(fx * fx + fy * fy + fz * fz);
    h += (1 - smoothstep(0, 0.25, len)) * volcanism * 0.18;
  }
  return h;
}

/* ══════════════════════════════════════════════════════
   Coordinate Helpers
   ══════════════════════════════════════════════════════ */

function latLonToDir(lat: number, lon: number): [number, number, number] {
  const phi = (90 - lat) * Math.PI / 180;
  const theta = (lon + 180) * Math.PI / 180;
  return [
    -Math.sin(phi) * Math.cos(theta),
     Math.cos(phi),
     Math.sin(phi) * Math.sin(theta),
  ];
}

export function cellCenter(row: number, col: number): [number, number] {
  const lat = 90 - (row + 0.5) * CELL_LAT;
  const lon = -180 + (col + 0.5) * CELL_LON;
  return [lat, lon];
}

export function latLonToCell(lat: number, lon: number): [number, number] {
  const row = Math.max(0, Math.min(GRID_H - 1, Math.floor((90 - lat) / CELL_LAT)));
  const col = ((Math.floor((lon + 180) / CELL_LON) % GRID_W) + GRID_W) % GRID_W;
  return [row, col];
}

export function cellIdx(row: number, col: number): number { return row * GRID_W + col; }

export function isOcean(height: number, oceanLevel: number): boolean {
  return oceanLevel > 0.01 && height < oceanLevel;
}

/** Convert lat/lon to 3D position on sphere at given radius */
export function toSpherePos(
  lat: number, lon: number, r: number = 1.002,
): [number, number, number] {
  const phi = (90 - lat) * Math.PI / 180;
  const theta = (lon + 180) * Math.PI / 180;
  return [
    -r * Math.sin(phi) * Math.cos(theta),
     r * Math.cos(phi),
     r * Math.sin(phi) * Math.sin(theta),
  ];
}

/** Convert lat/lon to 3D position projected onto terrain surface.
 *  Matches the GLSL vertex shader: r = 1 + (max(h, oceanLevel) - 0.5) * displacement + offset */
export function toTerrainSpherePos(
  lat: number, lon: number,
  hm: Float32Array, tp: TerrainParams,
  displacement: number = 0.055, offset: number = 0.003,
): [number, number, number] {
  const [row, col] = latLonToCell(lat, lon);
  const h = hm[cellIdx(row, col)];
  const terrain = Math.max(h, tp.oceanLevel);
  const r = 1 + (terrain - 0.5) * displacement + offset;
  return toSpherePos(lat, lon, r);
}

/* ══════════════════════════════════════════════════════
   Heightmap Generation
   ══════════════════════════════════════════════════════ */

function generateHeightMap(tp: TerrainParams): Float32Array {
  const map = new Float32Array(GRID_W * GRID_H);
  for (let r = 0; r < GRID_H; r++) {
    for (let c = 0; c < GRID_W; c++) {
      const [lat, lon] = cellCenter(r, c);
      const [dx, dy, dz] = latLonToDir(lat, lon);
      map[cellIdx(r, c)] = sampleHeight(
        dx, dy, dz,
        tp.seed, tp.noiseScale, tp.mountainHeight, tp.valleyDepth, tp.volcanism,
      );
    }
  }
  return map;
}

/* ══════════════════════════════════════════════════════
   A* Pathfinding
   ══════════════════════════════════════════════════════ */

class MinHeap {
  private data: { idx: number; cost: number }[] = [];
  push(idx: number, cost: number) {
    this.data.push({ idx, cost });
    this._up(this.data.length - 1);
  }
  pop(): { idx: number; cost: number } | null {
    if (this.data.length === 0) return null;
    const top = this.data[0];
    const last = this.data.pop()!;
    if (this.data.length > 0) { this.data[0] = last; this._down(0); }
    return top;
  }
  get length() { return this.data.length; }
  private _up(i: number) {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.data[p].cost <= this.data[i].cost) break;
      [this.data[p], this.data[i]] = [this.data[i], this.data[p]];
      i = p;
    }
  }
  private _down(i: number) {
    const n = this.data.length;
    while (true) {
      let s = i;
      const l = 2 * i + 1, r = 2 * i + 2;
      if (l < n && this.data[l].cost < this.data[s].cost) s = l;
      if (r < n && this.data[r].cost < this.data[s].cost) s = r;
      if (s === i) break;
      [this.data[s], this.data[i]] = [this.data[i], this.data[s]];
      i = s;
    }
  }
}

const DIRS = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
const SQRT2 = Math.SQRT2;

/** Deterministic per-cell jitter for organic pathfinding (0-1 range) */
function cellJitter(r: number, c: number, seed: number): number {
  // Simple hash → always same value for same cell+seed
  const x = Math.sin(r * 127.1 + c * 311.7 + seed * 53.3) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * A* on heightmap grid.
 * mode='land': roads stay on land, avoid water.
 * mode='sea':  routes stay on water, avoid land.
 * seed drives slight random-walk bias for organic feel.
 */
function astar(
  hm: Float32Array, oceanLevel: number,
  sr: number, sc: number, er: number, ec: number,
  mode: 'land' | 'sea',
  seed: number = 0,
  existingRoadCells?: Set<number>,
): [number, number][] | null {
  const start = cellIdx(sr, sc);
  const end = cellIdx(er, ec);
  if (start === end) return [cellCenter(sr, sc)];

  const heuristic = (r: number, c: number) => {
    const dr = Math.abs(r - er);
    const dc = Math.min(Math.abs(c - ec), GRID_W - Math.abs(c - ec));
    return Math.max(dr, dc);
  };

  const gCost = new Float32Array(GRID_W * GRID_H).fill(Infinity);
  const parent = new Int32Array(GRID_W * GRID_H).fill(-1);
  const closed = new Uint8Array(GRID_W * GRID_H);

  gCost[start] = 0;
  const open = new MinHeap();
  open.push(start, heuristic(sr, sc));

  let visited = 0;
  const MAX_VISITS = 24000; // safety limit (scaled with 256×128 grid)

  while (open.length > 0) {
    const cur = open.pop()!;
    const ci = cur.idx;
    if (ci === end) break;
    if (closed[ci]) continue;
    closed[ci] = 1;
    if (++visited > MAX_VISITS) return null;

    const cr = (ci / GRID_W) | 0;
    const cc = ci % GRID_W;

    for (const [dr, dc] of DIRS) {
      const nr = cr + dr;
      if (nr < 0 || nr >= GRID_H) continue;
      const nc = ((cc + dc) % GRID_W + GRID_W) % GRID_W;
      const ni = cellIdx(nr, nc);
      if (closed[ni]) continue;

      const nh = hm[ni];
      const ch = hm[ci];
      const nWet = isOcean(nh, oceanLevel);

      if (mode === 'land' && nWet) continue;
      if (mode === 'sea' && !nWet) continue;

      const baseDist = (dr !== 0 && dc !== 0) ? SQRT2 : 1.0;
      // Organic jitter: slight random-walk influence so roads meander naturally
      const jitter = cellJitter(nr, nc, seed) * 0.6; // 0 – 0.6 random cost
      let moveCost = baseDist + jitter;
      if (mode === 'land') {
        const slope = Math.abs(nh - ch);
        moveCost += slope * 18;
        moveCost += Math.max(0, (nh - oceanLevel)) * 2;
      }
      // Road-awareness: prefer cells already used by existing roads
      if (existingRoadCells && existingRoadCells.has(ni)) {
        moveCost *= 0.3; // 70% discount for reusing existing road cells
      }

      const tentG = gCost[ci] + moveCost;
      if (tentG < gCost[ni]) {
        gCost[ni] = tentG;
        parent[ni] = ci;
        open.push(ni, tentG + heuristic(nr, nc));
      }
    }
  }

  if (parent[end] === -1 && start !== end) return null;
  const path: [number, number][] = [];
  let cur = end;
  while (cur !== -1) {
    const r = (cur / GRID_W) | 0;
    const c = cur % GRID_W;
    path.push(cellCenter(r, c));
    cur = parent[cur];
  }
  path.reverse();
  return path;
}

/** Find nearest ocean cell from a land position (for sea route endpoints) */
function findNearestCoast(
  hm: Float32Array, oceanLevel: number, sr: number, sc: number,
): [number, number] | null {
  const visited = new Uint8Array(GRID_W * GRID_H);
  const queue: [number, number][] = [[sr, sc]];
  visited[cellIdx(sr, sc)] = 1;
  let steps = 0;
  while (queue.length > 0 && steps++ < 600) {
    const [r, c] = queue.shift()!;
    for (const [dr, dc] of DIRS) {
      const nr = r + dr;
      if (nr < 0 || nr >= GRID_H) continue;
      const nc = ((c + dc) % GRID_W + GRID_W) % GRID_W;
      const ni = cellIdx(nr, nc);
      if (visited[ni]) continue;
      visited[ni] = 1;
      if (isOcean(hm[ni], oceanLevel)) return [nr, nc];
      queue.push([nr, nc]);
    }
  }
  return null;
}

/* ══════════════════════════════════════════════════════
   Territory Flood-Fill
   ══════════════════════════════════════════════════════ */

const TERRITORY_MAX_COST = 28.0;

/** Multi-source Dijkstra from all building cells — expands naturally along terrain.
 *  Uses seed-based jitter + occasional lat/lon snapping for organic borders. */
function floodFillTerritory(
  hm: Float32Array, oceanLevel: number,
  buildingCells: [number, number][],
  seed: number = 0,
): Set<number> {
  const territory = new Set<number>();
  const cost = new Float32Array(GRID_W * GRID_H).fill(Infinity);
  const heap = new MinHeap();

  for (const [r, c] of buildingCells) {
    const idx = cellIdx(r, c);
    cost[idx] = 0;
    heap.push(idx, 0);
    territory.add(idx);
  }

  while (heap.length > 0) {
    const cur = heap.pop()!;
    const ci = cur.idx;
    if (cur.cost > cost[ci]) continue;
    const cr = (ci / GRID_W) | 0;
    const cc = ci % GRID_W;

    for (const [dr, dc] of DIRS) {
      const nr = cr + dr;
      if (nr < 0 || nr >= GRID_H) continue;
      const nc = ((cc + dc) % GRID_W + GRID_W) % GRID_W;
      const ni = cellIdx(nr, nc);
      const nh = hm[ni];
      if (isOcean(nh, oceanLevel)) continue; // water blocks territory

      const ch = hm[ci];
      // Cardinal (lat/lon aligned) moves are sometimes cheaper → natural grid-snap
      const isDiag = (dr !== 0 && dc !== 0);
      const cardinalBonus = isDiag ? 0 : -0.15;
      const baseDist = (isDiag ? SQRT2 : 1.0) + cardinalBonus;
      // Organic jitter so territory edges aren't perfectly smooth
      const jitter = cellJitter(nr, nc, seed + 7.77) * 0.7;
      const slope = Math.abs(nh - ch);
      const slopeCost = slope * 30;          // mountains = hard barrier
      const heightCost = Math.max(0, (nh - oceanLevel)) * 3;
      const moveCost = baseDist + jitter + slopeCost + heightCost;

      const tentCost = cost[ci] + moveCost;
      if (tentCost < TERRITORY_MAX_COST && tentCost < cost[ni]) {
        cost[ni] = tentCost;
        heap.push(ni, tentCost);
        territory.add(ni);
      }
    }
  }
  return territory;
}

/* ══════════════════════════════════════════════════════
   Maritime Territory — Coastal + Ship-Extended
   ══════════════════════════════════════════════════════ */

/** Maximum coastal water territory distance in grid cells.
 *  200 km ÷ cell size. Cell size ≈ (planet circumference / GRID_W).
 *  For Earth (R=6371km): circumference ~40030km, cell ≈ 156km → ~1.3 cells.
 *  We use a dynamic calculation based on planet radius. */
function coastalMaxCells(planetRadiusKm: number): number {
  const circumKm = 2 * Math.PI * planetRadiusKm;
  const cellKm = circumKm / GRID_W;
  return Math.max(1, Math.ceil(200 / cellKm));  // 200km coastal limit
}

/** Flood-fill maritime territory from coastal land territory out into adjacent ocean.
 *  Limited to ~200km from the coast. Returns set of ocean cell indices. */
function floodFillCoastalTerritory(
  hm: Float32Array, oceanLevel: number,
  landTerritory: Set<number>,
  planetRadiusKm: number = 6371,
  seed: number = 0,
): Set<number> {
  const maritime = new Set<number>();
  if (oceanLevel < 0.01 || landTerritory.size === 0) return maritime;

  const maxCells = coastalMaxCells(planetRadiusKm);
  const cost = new Float32Array(GRID_W * GRID_H).fill(Infinity);
  const heap = new MinHeap();

  // Seed from land territory cells that border ocean
  for (const idx of landTerritory) {
    const r = (idx / GRID_W) | 0;
    const c = idx % GRID_W;
    let bordersOcean = false;
    for (const [dr, dc] of DIRS) {
      const nr = r + dr;
      if (nr < 0 || nr >= GRID_H) continue;
      const nc = ((c + dc) % GRID_W + GRID_W) % GRID_W;
      if (isOcean(hm[cellIdx(nr, nc)], oceanLevel)) { bordersOcean = true; break; }
    }
    if (bordersOcean) {
      cost[idx] = 0;
      heap.push(idx, 0);
    }
  }

  while (heap.length > 0) {
    const cur = heap.pop()!;
    const ci = cur.idx;
    if (cur.cost > cost[ci]) continue;
    const cr = (ci / GRID_W) | 0;
    const cc = ci % GRID_W;

    for (const [dr, dc] of DIRS) {
      const nr = cr + dr;
      if (nr < 0 || nr >= GRID_H) continue;
      const nc = ((cc + dc) % GRID_W + GRID_W) % GRID_W;
      const ni = cellIdx(nr, nc);
      if (!isOcean(hm[ni], oceanLevel)) continue; // only expand into water
      if (landTerritory.has(ni)) continue;         // don't re-add land cells

      const isDiag = (dr !== 0 && dc !== 0);
      const baseDist = isDiag ? SQRT2 : 1.0;
      const jitter = cellJitter(nr, nc, seed + 13.37) * 0.3;
      const moveCost = baseDist + jitter;

      const tentCost = cost[ci] + moveCost;
      if (tentCost < maxCells && tentCost < cost[ni]) {
        cost[ni] = tentCost;
        heap.push(ni, tentCost);
        maritime.add(ni);
      }
    }
  }
  return maritime;
}

/** Flood-fill territory from ship positions into surrounding ocean cells.
 *  Radius is based on ship "influence" ~similar to building territory but on water. */
const SHIP_TERRITORY_COST = 18.0;

function floodFillShipTerritory(
  hm: Float32Array, oceanLevel: number,
  shipCells: [number, number][],
  seed: number = 0,
): Set<number> {
  const territory = new Set<number>();
  if (shipCells.length === 0) return territory;

  const cost = new Float32Array(GRID_W * GRID_H).fill(Infinity);
  const heap = new MinHeap();

  for (const [r, c] of shipCells) {
    const idx = cellIdx(r, c);
    cost[idx] = 0;
    heap.push(idx, 0);
    territory.add(idx);
  }

  while (heap.length > 0) {
    const cur = heap.pop()!;
    const ci = cur.idx;
    if (cur.cost > cost[ci]) continue;
    const cr = (ci / GRID_W) | 0;
    const cc = ci % GRID_W;

    for (const [dr, dc] of DIRS) {
      const nr = cr + dr;
      if (nr < 0 || nr >= GRID_H) continue;
      const nc = ((cc + dc) % GRID_W + GRID_W) % GRID_W;
      const ni = cellIdx(nr, nc);
      if (!isOcean(hm[ni], oceanLevel)) continue; // ships only on water

      const isDiag = (dr !== 0 && dc !== 0);
      const baseDist = isDiag ? SQRT2 : 1.0;
      const jitter = cellJitter(nr, nc, seed + 21.21) * 0.4;
      const moveCost = baseDist + jitter;

      const tentCost = cost[ci] + moveCost;
      if (tentCost < SHIP_TERRITORY_COST && tentCost < cost[ni]) {
        cost[ni] = tentCost;
        heap.push(ni, tentCost);
        territory.add(ni);
      }
    }
  }
  return territory;
}

/** Compute a sea route path for ship movement using A* on water cells */
export function computeShipRoute(
  tp: TerrainParams,
  fromLat: number, fromLon: number,
  toLat: number, toLon: number,
): [number, number][] | null {
  const hm = getHeightMap(tp);
  const [sr, sc] = latLonToCell(fromLat, fromLon);
  const [er, ec] = latLonToCell(toLat, toLon);

  // Verify both endpoints are in water
  if (!isOcean(hm[cellIdx(sr, sc)], tp.oceanLevel)) return null;
  if (!isOcean(hm[cellIdx(er, ec)], tp.oceanLevel)) return null;

  const path = astar(hm, tp.oceanLevel, sr, sc, er, ec, 'sea', tp.seed);
  if (!path) return null;
  return catmullRomSmooth(path);
}

/* ══════════════════════════════════════════════════════
   Border Extraction
   ══════════════════════════════════════════════════════ */

/** Extract perimeter line segments from territory mask (raw grid-aligned).
 *  Returns [lat1, lon1, lat2, lon2] per segment. */
function extractBorderRaw(territory: Set<number>): [number, number, number, number][] {
  const segs: [number, number, number, number][] = [];
  for (const idx of territory) {
    const r = (idx / GRID_W) | 0;
    const c = idx % GRID_W;
    const lat0 = 90 - r * CELL_LAT;
    const lat1 = 90 - (r + 1) * CELL_LAT;
    const lon0 = -180 + c * CELL_LON;
    const lon1 = -180 + (c + 1) * CELL_LON;
    // North
    if (r === 0 || !territory.has(cellIdx(r - 1, c)))
      segs.push([lat0, lon0, lat0, lon1]);
    // South
    if (r === GRID_H - 1 || !territory.has(cellIdx(r + 1, c)))
      segs.push([lat1, lon0, lat1, lon1]);
    // West
    const wc = ((c - 1) % GRID_W + GRID_W) % GRID_W;
    if (!territory.has(cellIdx(r, wc)))
      segs.push([lat0, lon0, lat1, lon0]);
    // East
    const ec = (c + 1) % GRID_W;
    if (!territory.has(cellIdx(r, ec)))
      segs.push([lat0, lon1, lat1, lon1]);
  }
  return segs;
}

/** Smooth raw border segments — jitter shared corners + add midpoint curves.
 *  Produces organic, non-grid-aligned borders. */
function extractBorder(territory: Set<number>, seed: number): [number, number, number, number][] {
  const raw = extractBorderRaw(territory);
  if (raw.length === 0) return raw;

  // Cache jittered positions for cell corners (consistency at shared vertices)
  const cornerCache = new Map<string, [number, number]>();
  const cornerKey = (lat: number, lon: number) =>
    `${Math.round(lat * 100)},${Math.round(lon * 100)}`;

  const jitterCorner = (lat: number, lon: number): [number, number] => {
    const key = cornerKey(lat, lon);
    if (cornerCache.has(key)) return cornerCache.get(key)!;
    const vr = Math.round((90 - lat) / CELL_LAT);
    const vc = Math.round((lon + 180) / CELL_LON);
    const j1 = cellJitter(vr, vc, seed + 3.14);
    const j2 = cellJitter(vr + 97, vc + 131, seed + 6.28);
    const result: [number, number] = [
      lat + (j1 - 0.5) * CELL_LAT * 0.5,
      lon + (j2 - 0.5) * CELL_LON * 0.5,
    ];
    cornerCache.set(key, result);
    return result;
  };

  const result: [number, number, number, number][] = [];
  for (const [lat1, lon1, lat2, lon2] of raw) {
    const [a1, a2] = jitterCorner(lat1, lon1);
    const [b1, b2] = jitterCorner(lat2, lon2);

    // Midpoint with extra curvature jitter
    const midLat = (a1 + b1) / 2;
    const midLon = (a2 + b2) / 2;
    const mr = Math.round((90 - midLat) / CELL_LAT * 2);
    const mc = Math.round((midLon + 180) / CELL_LON * 2);
    const mj1 = cellJitter(mr + 41, mc + 73, seed + 9.42);
    const mj2 = cellJitter(mr + 59, mc + 113, seed + 7.77);
    const mLat = midLat + (mj1 - 0.5) * CELL_LAT * 0.3;
    const mLon = midLon + (mj2 - 0.5) * CELL_LON * 0.3;

    result.push([a1, a2, mLat, mLon], [mLat, mLon, b1, b2]);
  }
  return result;
}

/* ══════════════════════════════════════════════════════
   Road Path Smoothing — Catmull-Rom Spline
   ══════════════════════════════════════════════════════ */

/** Smooth a path of [lat, lon] points using Catmull-Rom interpolation.
 *  Produces 3 intermediate points per segment for organic curved roads. */
function catmullRomSmooth(pts: [number, number][], subs: number = 3): [number, number][] {
  if (pts.length < 3) return pts;
  const result: [number, number][] = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(i - 1, 0)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(i + 2, pts.length - 1)];
    for (let t = 1; t <= subs; t++) {
      const s = t / subs;
      const s2 = s * s;
      const s3 = s2 * s;
      const lat = 0.5 * (
        (2 * p1[0]) +
        (-p0[0] + p2[0]) * s +
        (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * s2 +
        (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * s3
      );
      const lon = 0.5 * (
        (2 * p1[1]) +
        (-p0[1] + p2[1]) * s +
        (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * s2 +
        (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * s3
      );
      result.push([lat, lon]);
    }
  }
  return result;
}

/* ══════════════════════════════════════════════════════
   Coastline Extraction
   ══════════════════════════════════════════════════════ */

/** Extract ocean/land boundary as line segments for rendering */
export function extractCoastline(
  hm: Float32Array, oceanLevel: number,
): [number, number, number, number][] {
  if (oceanLevel < 0.01) return [];
  const segs: [number, number, number, number][] = [];
  const CL = 180 / GRID_H;
  const CLN = 360 / GRID_W;
  for (let r = 0; r < GRID_H; r++) {
    for (let c = 0; c < GRID_W; c++) {
      const wet = isOcean(hm[cellIdx(r, c)], oceanLevel);
      // East neighbor
      const ec = (c + 1) % GRID_W;
      if (wet !== isOcean(hm[cellIdx(r, ec)], oceanLevel)) {
        const lon = -180 + (c + 1) * CLN;
        segs.push([90 - r * CL, lon, 90 - (r + 1) * CL, lon]);
      }
      // South neighbor
      if (r < GRID_H - 1 && wet !== isOcean(hm[cellIdx(r + 1, c)], oceanLevel)) {
        const lat = 90 - (r + 1) * CL;
        segs.push([lat, -180 + c * CLN, lat, -180 + (c + 1) * CLN]);
      }
    }
  }
  return segs;
}

/* ══════════════════════════════════════════════════════
   Cache
   ══════════════════════════════════════════════════════ */

interface CachedColonyData {
  landRoads: [number, number][][];
  seaRoutes: [number, number][][];
  territory: Set<number>;
  maritimeTerritory: Set<number>;
  shipTerritory: Set<number>;
  borderSegments: [number, number, number, number][];
  maritimeBorderSegments: [number, number, number, number][];
  coastline: [number, number, number, number][];
  buildingHash: string;
}

const heightMapCache = new Map<string, Float32Array>();
const colonyCache = new Map<string, CachedColonyData>();

function terrainKey(tp: TerrainParams): string {
  return `${tp.seed.toFixed(1)}_${tp.noiseScale}_${tp.oceanLevel.toFixed(3)}_${tp.mountainHeight}_${tp.valleyDepth}_${tp.volcanism}`;
}

function buildingHash(buildings: { lat: number; lon: number }[]): string {
  return buildings.map(b => `${b.lat.toFixed(1)},${b.lon.toFixed(1)}`).join('|');
}

/** Get or generate heightmap (cached per terrain params) */
export function getHeightMap(tp: TerrainParams): Float32Array {
  const key = terrainKey(tp);
  let cached = heightMapCache.get(key);
  if (!cached) {
    cached = generateHeightMap(tp);
    heightMapCache.set(key, cached);
    if (heightMapCache.size > 8) {
      const oldest = heightMapCache.keys().next().value;
      if (oldest) heightMapCache.delete(oldest);
    }
  }
  return cached;
}

/* ══════════════════════════════════════════════════════
   Main Entry Point
   ══════════════════════════════════════════════════════ */

/** Compute all colony geometry data — roads, sea routes, territory, borders.
 *  Cached per planet+buildings; only recomputes when buildings change. */
export function computeColonyData(
  tp: TerrainParams,
  buildings: { lat: number; lon: number }[],
  maxRoadDeg: number = 30,
  ships: Ship[] = [],
): {
  landRoads: [number, number][][];
  seaRoutes: [number, number][][];
  territory: Set<number>;
  maritimeTerritory: Set<number>;
  shipTerritory: Set<number>;
  borderSegments: [number, number, number, number][];
  maritimeBorderSegments: [number, number, number, number][];
  coastline: [number, number, number, number][];
  heightMap: Float32Array;
} {
  const hm = getHeightMap(tp);
  const bHash = buildingHash(buildings) + '|S:' + ships.map(s => `${s.lat.toFixed(1)},${s.lon.toFixed(1)}`).join(';');
  const cKey = terrainKey(tp) + '|' + bHash;

  let cached = colonyCache.get(cKey);
  if (!cached) {
    const cells = buildings.map(b => latLonToCell(b.lat, b.lon));

    // ── Territory first (roads depend on it) ──
    const territory = buildings.length > 0
      ? floodFillTerritory(hm, tp.oceanLevel, cells, tp.seed)
      : new Set<number>();

    // ── Roads + sea routes — MST-based: connect buildings via minimum spanning tree ──
    //    This prevents redundant overlapping roads (no N² full-mesh connections)
    const landRoads: [number, number][][] = [];
    const seaRoutes: [number, number][][] = [];
    const roadCells = new Set<number>(); // accumulated road cells for road-awareness
    const roadSegmentSet = new Set<string>(); // dedup segment keys

    // Check if two buildings are connected via territory (BFS on territory grid)
    const canReachInTerritory = (ai: number, bi: number): boolean => {
      if (territory.size === 0) return false;
      const [ra, ca] = cells[ai];
      const [rb, cb] = cells[bi];
      const startIdx = cellIdx(ra, ca);
      const endIdx = cellIdx(rb, cb);
      if (!territory.has(startIdx) || !territory.has(endIdx)) return false;
      if (startIdx === endIdx) return true;
      // BFS within territory cells only
      const visited = new Set<number>();
      const queue = [startIdx];
      visited.add(startIdx);
      while (queue.length > 0) {
        const ci = queue.shift()!;
        if (ci === endIdx) return true;
        const cr = (ci / GRID_W) | 0;
        const cc = ci % GRID_W;
        for (const [dr, dc] of DIRS) {
          const nr = cr + dr;
          if (nr < 0 || nr >= GRID_H) continue;
          const nc = ((cc + dc) % GRID_W + GRID_W) % GRID_W;
          const ni = cellIdx(nr, nc);
          if (!visited.has(ni) && territory.has(ni)) {
            visited.add(ni);
            queue.push(ni);
          }
        }
      }
      return false;
    };

    // Build edges sorted by great-circle distance (for MST/Kruskal)
    type Edge = { i: number; j: number; dist: number };
    const edges: Edge[] = [];
    for (let i = 0; i < buildings.length; i++) {
      for (let j = i + 1; j < buildings.length; j++) {
        const dLat = Math.abs(buildings[i].lat - buildings[j].lat);
        const dLon = Math.min(
          Math.abs(buildings[i].lon - buildings[j].lon),
          360 - Math.abs(buildings[i].lon - buildings[j].lon),
        );
        const dist = Math.sqrt(dLat * dLat + dLon * dLon);
        if (dist <= maxRoadDeg) {
          edges.push({ i, j, dist });
        }
      }
    }
    edges.sort((a, b) => a.dist - b.dist);

    // Union-Find for Kruskal MST
    const ufParent = Array.from({ length: buildings.length }, (_, k) => k);
    const ufRank = new Uint8Array(buildings.length);
    function ufFind(x: number): number {
      while (ufParent[x] !== x) { ufParent[x] = ufParent[ufParent[x]]; x = ufParent[x]; }
      return x;
    }
    function ufUnion(a: number, b: number): boolean {
      const ra = ufFind(a), rb = ufFind(b);
      if (ra === rb) return false;
      if (ufRank[ra] < ufRank[rb]) ufParent[ra] = rb;
      else if (ufRank[ra] > ufRank[rb]) ufParent[rb] = ra;
      else { ufParent[rb] = ra; ufRank[ra]++; }
      return true;
    }

    // Helper: add cells from a raw path to existing road set, dedup segments
    function addRoadPath(rawPath: [number, number][]) {
      // Record cells used by this road
      for (const [lt, ln] of rawPath) {
        const [pr, pc] = latLonToCell(lt, ln);
        roadCells.add(cellIdx(pr, pc));
      }
      // Smooth and deduplicate segments
      const smoothed = catmullRomSmooth(rawPath);
      const deduped: [number, number][] = [smoothed[0]];
      for (let k = 1; k < smoothed.length; k++) {
        const segKey = `${smoothed[k-1][0].toFixed(2)},${smoothed[k-1][1].toFixed(2)}-${smoothed[k][0].toFixed(2)},${smoothed[k][1].toFixed(2)}`;
        const segKeyRev = `${smoothed[k][0].toFixed(2)},${smoothed[k][1].toFixed(2)}-${smoothed[k-1][0].toFixed(2)},${smoothed[k-1][1].toFixed(2)}`;
        if (!roadSegmentSet.has(segKey) && !roadSegmentSet.has(segKeyRev)) {
          roadSegmentSet.add(segKey);
          deduped.push(smoothed[k]);
        }
      }
      if (deduped.length > 1) landRoads.push(deduped);
    }

    // MST pass: connect buildings with minimum spanning tree (no redundant roads)
    for (const edge of edges) {
      if (ufUnion(edge.i, edge.j)) {
        if (canReachInTerritory(edge.i, edge.j)) {
          const [ri, ci2] = cells[edge.i];
          const [rj, cj] = cells[edge.j];
          const land = astar(hm, tp.oceanLevel, ri, ci2, rj, cj, 'land', tp.seed, roadCells);
          if (land && land.length > 1) {
            addRoadPath(land);
          } else if (tp.oceanLevel > 0.05) {
            const coastI = findNearestCoast(hm, tp.oceanLevel, ri, ci2);
            const coastJ = findNearestCoast(hm, tp.oceanLevel, rj, cj);
            if (coastI && coastJ) {
              const sea = astar(hm, tp.oceanLevel, coastI[0], coastI[1], coastJ[0], coastJ[1], 'sea', tp.seed);
              if (sea && sea.length > 1) {
                seaRoutes.push(catmullRomSmooth([
                  cellCenter(ri, ci2), ...sea, cellCenter(rj, cj),
                ]));
              }
            }
          }
        } else if (tp.oceanLevel > 0.05) {
          // Not territory-connected — try sea route
          const [ri, ci2] = cells[edge.i];
          const [rj, cj] = cells[edge.j];
          const coastI = findNearestCoast(hm, tp.oceanLevel, ri, ci2);
          const coastJ = findNearestCoast(hm, tp.oceanLevel, rj, cj);
          if (coastI && coastJ) {
            const sea = astar(hm, tp.oceanLevel, coastI[0], coastI[1], coastJ[0], coastJ[1], 'sea', tp.seed);
            if (sea && sea.length > 1) {
              seaRoutes.push(catmullRomSmooth([
                cellCenter(ri, ci2), ...sea, cellCenter(rj, cj),
              ]));
            }
          }
        }
      }
    }

    // ── Border (smoothed — jittered corners + midpoint curves) ──
    const borderSegments = extractBorder(territory, tp.seed);

    // ── Maritime territory (200km from coast into ocean) ──
    const planetR = tp.planetRadiusKm || 6371;
    const maritimeTerritory = floodFillCoastalTerritory(hm, tp.oceanLevel, territory, planetR, tp.seed);

    // ── Ship territory (water-based influence around ships) ──
    const shipCells = ships.map(s => latLonToCell(s.lat, s.lon));
    const shipTerritory = floodFillShipTerritory(hm, tp.oceanLevel, shipCells, tp.seed);
    // Merge ship territory into maritime
    for (const idx of shipTerritory) maritimeTerritory.add(idx);

    // ── Maritime border ──
    const maritimeBorderSegments = maritimeTerritory.size > 0
      ? extractBorder(maritimeTerritory, tp.seed + 42)
      : [];

    // ── Coastline ──
    const coastline = extractCoastline(hm, tp.oceanLevel);

    cached = { landRoads, seaRoutes, territory, maritimeTerritory, shipTerritory,
               borderSegments, maritimeBorderSegments, coastline, buildingHash: bHash };
    colonyCache.set(cKey, cached);
    if (colonyCache.size > 16) {
      const oldest = colonyCache.keys().next().value;
      if (oldest) colonyCache.delete(oldest);
    }
  }

  return { ...cached, heightMap: hm };
}
