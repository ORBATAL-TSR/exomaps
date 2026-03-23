/**
 * IcebergField — Instanced 3D ice floe geometries that slowly drift
 * across the polar ocean surface, mimicking real ocean-gyre circulation.
 *
 * Density is zone-weighted:
 *   POLAR_ICE  — packed (full density)
 *   SHELF      — dense  (continental shelf calving)
 *   ANTISTELLAR— moderate (cold dark side)
 *   TERMINATOR — sparse
 *   open water — very sparse (distant calved bergs only)
 *
 * Look:
 *   top face   — pure snow-white, slightly warm-tinted in centre
 *   side faces — ice blue-cyan at waterline → compressed deep-navy at base,
 *                semi-transparent so ocean colour shows through
 *   bottom     — hidden below surface (dark safety colour)
 */

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { ZONE_ROLE } from './zones';

interface Props {
  iceCaps:      number;            // 0–1
  oceanLevel:   number;            // 0–1, matches uOceanLevel
  seed:         number;
  displacement: number;            // total vertex displacement scale (matches uDisplacement)
  zoneCenters:  THREE.Vector3[];   // Voronoi zone centre positions (unit sphere)
  zoneRoles:    number[];          // parallel array of ZONE_ROLE values
}

interface BergData {
  lon0:   number;
  absY:   number;
  hemi:   number;   // +1 north, -1 south
  gyreHz: number;
  angle:  number;
  sc:     number;
}

// ── Geometry ──────────────────────────────────────────────────────────────
// 7-sided irregular flat prism.
// Vertex colours drive the look:
//   top centre   pure white, slight warm tint
//   top ring     cool glacier-white
//   side top     bright aqua-cyan (waterline melt)
//   side base    deep compressed-ice navy
//   bottom       near-black (submerged, usually hidden)
function createFloeGeometry(): THREE.BufferGeometry {
  const SIDES  = 7;
  const HALF_H = 0.10;

  const positions: number[] = [];
  const normals:   number[] = [];
  const colors:    number[] = [];
  const indices:   number[] = [];

  const ring: [number, number][] = [];
  for (let i = 0; i < SIDES; i++) {
    const a = (i / SIDES) * Math.PI * 2;
    const r = 0.68
            + Math.sin(a * 2.3 + 1.1) * 0.20
            + Math.cos(a * 3.7 + 0.8) * 0.12;
    ring.push([Math.cos(a) * r, Math.sin(a) * r]);
  }

  // ── Top face ─────────────────────────────────────────────────────────
  const tBase = 0;
  positions.push(0, HALF_H, 0);  normals.push(0, 1, 0);
  colors.push(0.99, 0.99, 1.00);   // centre: near-pure white, barely cool
  for (const [x, z] of ring) {
    positions.push(x, HALF_H, z);  normals.push(0, 1, 0);
    colors.push(0.94, 0.96, 1.00); // ring: glacier-white, hint of cool blue
  }
  for (let i = 0; i < SIDES; i++) {
    indices.push(tBase, tBase + 1 + i, tBase + 1 + ((i + 1) % SIDES));
  }

  // ── Bottom face ───────────────────────────────────────────────────────
  const bBase = SIDES + 1;
  positions.push(0, -HALF_H, 0);  normals.push(0, -1, 0);
  colors.push(0.03, 0.08, 0.20);
  for (const [x, z] of ring) {
    positions.push(x, -HALF_H, z);  normals.push(0, -1, 0);
    colors.push(0.03, 0.08, 0.20);
  }
  for (let i = 0; i < SIDES; i++) {
    indices.push(bBase, bBase + 1 + ((i + 1) % SIDES), bBase + 1 + i);
  }

  // ── Side faces — waterline (bright aqua) → base (deep navy) ──────────
  for (let i = 0; i < SIDES; i++) {
    const [x0, z0] = ring[i];
    const [x1, z1] = ring[(i + 1) % SIDES];
    const mx = x0 + x1, mz = z0 + z1;
    const ml = Math.sqrt(mx * mx + mz * mz) || 1;
    const nx = mx / ml, nz = mz / ml;
    const si = positions.length / 3;

    positions.push(x0,  HALF_H, z0);  normals.push(nx, 0, nz);
    colors.push(0.55, 0.82, 0.96);   // waterline: bright aqua-cyan

    positions.push(x1,  HALF_H, z1);  normals.push(nx, 0, nz);
    colors.push(0.55, 0.82, 0.96);

    positions.push(x0, -HALF_H, z0);  normals.push(nx, 0, nz);
    colors.push(0.06, 0.28, 0.62);   // base: deep compressed-ice navy

    positions.push(x1, -HALF_H, z1);  normals.push(nx, 0, nz);
    colors.push(0.06, 0.28, 0.62);

    indices.push(si, si + 2, si + 1);
    indices.push(si + 1, si + 2, si + 3);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal',   new THREE.Float32BufferAttribute(normals,   3));
  geo.setAttribute('color',    new THREE.Float32BufferAttribute(colors,    3));
  geo.setIndex(indices);
  return geo;
}

// ── Deterministic pseudo-random ───────────────────────────────────────────
function rand(s: number): number {
  const x = Math.sin(s + 1.0) * 43758.5453;
  return x - Math.floor(x);
}

// ── Zone-role accept probability ─────────────────────────────────────────
function zoneAcceptProb(role: number): number {
  if (role === ZONE_ROLE.POLAR_ICE)   return 1.00;   // full density — ice shelf zone
  if (role === ZONE_ROLE.SHELF)       return 0.70;   // continental shelf calving
  if (role === ZONE_ROLE.ANTISTELLAR) return 0.42;   // cold dark side
  if (role === ZONE_ROLE.TERMINATOR)  return 0.16;   // sparse near terminator
  return 0.06;                                        // open water — rare long-distance bergs
}

// ── Component ─────────────────────────────────────────────────────────────
export function IcebergField({
  iceCaps, oceanLevel, seed, displacement, zoneCenters, zoneRoles,
}: Props) {
  const meshRef = useRef<THREE.InstancedMesh>(null!);

  // Pre-allocated scratch — zero GC every frame
  const scratch = useMemo(() => ({
    m:   new THREE.Matrix4(),
    up:  new THREE.Vector3(),
    ref: new THREE.Vector3(),
    fwd: new THREE.Vector3(),
    rgt: new THREE.Vector3(),
    rf:  new THREE.Vector3(),
    rr:  new THREE.Vector3(),
    pos: new THREE.Vector3(),
  }), []);

  const { geo, count, bergData, sR } = useMemo(() => {
    const geometry = createFloeGeometry();

    const iceLine   = 1.0 - iceCaps * 0.14;
    const beltOuter = Math.min(iceLine,        0.98);
    const beltInner = Math.max(iceLine - 0.12, 0.40);

    // Match vertex shader: ocean surface = 1.0 + (oceanLevel - 0.5) * displacement
    const sphereR = 1.0 + (oceanLevel - 0.5) * displacement + 0.005;

    // Generate ~500 candidates per hemisphere; filter via zone acceptance.
    // Gives dense packing at polar/shelf zones, sparse elsewhere.
    const CANDIDATES = Math.min(Math.floor(iceCaps * 500 + 100), 500);
    const data: BergData[] = [];

    for (let h = 0; h < 2; h++) {
      const hemiSign = h === 0 ? 1.0 : -1.0;

      for (let idx = 0; idx < CANDIDATES; idx++) {
        const base = h * CANDIDATES + idx;
        const r0 = rand(seed * 1.71 + base * 13.13 + 0.11);
        const r1 = rand(seed * 2.37 + base *  7.79 + 0.22);
        const r2 = rand(seed * 3.13 + base * 11.31 + 0.33);
        const r3 = rand(seed * 4.79 + base * 17.97 + 0.44);
        const r4 = rand(seed * 6.07 + base * 23.71 + 0.55);  // accept gate

        const absY = beltInner + r0 * (beltOuter - beltInner);
        const lon0 = r1 * Math.PI * 2;
        const xzR  = Math.sqrt(Math.max(0, 1 - absY * absY));
        const lat  = absY * hemiSign;

        // ── Zone-weighted density ───────────────────────────────────────
        let nearestRole: number = ZONE_ROLE.DEFAULT;
        if (zoneCenters.length > 0) {
          let minD2 = Infinity;
          const bx = Math.cos(lon0) * xzR;
          const by = lat;
          const bz = Math.sin(lon0) * xzR;
          for (let z = 0; z < zoneCenters.length; z++) {
            const zc = zoneCenters[z];
            const dx = zc.x - bx, dy = zc.y - by, dz = zc.z - bz;
            const d2 = dx*dx + dy*dy + dz*dz;
            if (d2 < minD2) { minD2 = d2; nearestRole = zoneRoles[z] ?? 0; }
          }
        }
        if (r4 > zoneAcceptProb(nearestRole)) continue;

        const gyreHz = Math.cos(lat * Math.PI)    * 0.0075
                     + Math.sin(lat * Math.PI * 2) * 0.0028
                     + Math.sin(lat * 11.0)         * 0.0009;

        data.push({
          lon0, absY, hemi: hemiSign, gyreHz,
          angle: r3 * Math.PI * 2,
          sc:    0.010 + r2 * 0.022,
        });
      }
    }

    return { geo: geometry, count: data.length, bergData: data, sR: sphereR };
  // zoneCenters/zoneRoles change ref only when zones recompute — safe dep
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iceCaps, oceanLevel, seed, displacement, zoneCenters, zoneRoles]);

  // ── Per-frame drift ────────────────────────────────────────────────────
  useFrame((state) => {
    if (!meshRef.current) return;
    const { m, up, ref, fwd, rgt, rf, rr, pos } = scratch;
    const t = state.clock.getElapsedTime();

    for (let i = 0; i < bergData.length; i++) {
      const b = bergData[i];
      const lon = b.lon0 + b.gyreHz * t;
      const xzR = Math.sqrt(Math.max(0, 1 - b.absY * b.absY));

      up.set(
        Math.cos(lon) * xzR,
        b.absY * b.hemi,
        Math.sin(lon) * xzR,
      ).normalize();
      pos.copy(up).multiplyScalar(sR);

      if (Math.abs(up.y) > 0.9) ref.set(1, 0, 0);
      else                        ref.set(0, 1, 0);
      fwd.crossVectors(ref, up).normalize();
      rgt.crossVectors(up, fwd).normalize();

      const ca = Math.cos(b.angle), sa = Math.sin(b.angle);
      rf.copy(fwd).multiplyScalar(ca).addScaledVector(rgt,  sa);
      rr.copy(fwd).multiplyScalar(-sa).addScaledVector(rgt, ca);

      const sc = b.sc;
      m.set(
        rf.x * sc, up.x * sc, rr.x * sc, pos.x,
        rf.y * sc, up.y * sc, rr.y * sc, pos.y,
        rf.z * sc, up.z * sc, rr.z * sc, pos.z,
        0,         0,         0,          1,
      );
      meshRef.current.setMatrixAt(i, m);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  if (iceCaps < 0.05 || count === 0) return null;

  return (
    <instancedMesh ref={meshRef} args={[geo, undefined, count]} renderOrder={1}>
      <meshStandardMaterial
        vertexColors={true}
        roughness={0.22}
        metalness={0.0}
        transparent={true}
        opacity={0.86}
        side={THREE.DoubleSide}
      />
    </instancedMesh>
  );
}
