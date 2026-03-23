/**
 * VolcanoField — Instanced 3D shield-volcano meshes on volcanic/hotspot worlds.
 *
 * Geometry: low, wide conical shield with a caldera bowl at the summit.
 * Two tiers:
 *   SHIELD  — broad low-profile shield (Olympus Mons style)  32-seg cone
 *   CINDER  — steeper cinder cone, smaller base radius       20-seg cone
 *
 * Only rendered when segments >= 128 (world-view LOD) and volcanism >= 0.12.
 * Sized physically: shield radius = 80-400 km, cinder = 10-60 km.
 */

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

// ── Shader — NdotL + ambient, vertex-colored ──────────────────────────────
const VERT = /* glsl */`
varying vec3 vN;
varying vec3 vCol;
void main() {
  vN   = normalize(normalMatrix * normal);
  vCol = color;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */`
uniform vec3 uSunDir;
uniform vec3 uLavaGlow;
varying vec3 vN;
varying vec3 vCol;
void main() {
  float ndl   = max(dot(normalize(vN), normalize(uSunDir)), 0.0);
  float light = 0.18 + 0.82 * ndl;
  vec3  col   = vCol * light;
  // Caldera glow: vertices with lava-orange color get an emissive boost
  float lavaBright = smoothstep(0.0, 0.3, uLavaGlow.r);
  col += uLavaGlow * 0.28 * lavaBright * (1.0 - ndl * 0.8);
  gl_FragColor = vec4(col, 1.0);
}`;

// ── Types ──────────────────────────────────────────────────────────────────
interface Props {
  seed:         number;
  volcanism:    number;               // 0–1
  sphereRadius: number;
  mass:         number;
  sunDirection: [number,number,number];
  c1: [number,number,number];         // base terrain color
  c2: [number,number,number];         // mid color (lava field)
}

interface VolcanoInstance {
  pos:   THREE.Vector3;
  scale: number;   // base radius in sphere units
  angle: number;
  type:  'shield' | 'cinder';
}

// ── Deterministic rand ─────────────────────────────────────────────────────
function rand(s: number): number {
  const x = Math.sin(s + 1.0) * 43758.5453;
  return x - Math.floor(x);
}

// ── Geometry: shield volcano ───────────────────────────────────────────────
// A low-angle cone (flank slope ~5°) with a caldera depression at the top.
function createShieldGeometry(
  segs:    number,
  isShield: boolean,
  c1:      [number,number,number],
  c2:      [number,number,number],
): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors:    number[] = [];

  const slopeAngle = isShield ? 0.06 : 0.22;   // rise/run — shield is gentle
  const caldRf     = isShield ? 0.12 : 0.18;    // caldera radius fraction
  const caldDepth  = isShield ? 0.08 : 0.14;    // caldera depth fraction

  // Radial rings from edge to summit, then caldera interior
  // rf=1.0 = edge at sphere surface (Y=0); rf=0 = summit
  const RINGS: [number, number][] = [
    [1.00,  0.000],                              // base edge — at sphere surface
    [0.75,  0.75 * slopeAngle],                  // lower flank
    [0.50,  0.50 * slopeAngle * 1.1],            // mid flank (slight bulge)
    [0.25,  0.25 * slopeAngle * 1.05],           // upper flank
    [caldRf + 0.02,  slopeAngle * 1.0],          // rim of caldera
    [caldRf,         slopeAngle * 1.0 - 0.012],  // caldera inner rim
    [caldRf * 0.50,  slopeAngle * 1.0 - caldDepth * 0.65], // caldera slope
  ];

  // Colors: base = dark lava field (c2 tinted), summit = warm rock, caldera = hot orange
  const RING_COL: [number,number,number][] = [
    [c1[0]*0.55, c1[1]*0.55, c1[2]*0.55],        // base: dark flank
    [c1[0]*0.60, c1[1]*0.58, c1[2]*0.55],
    [c2[0]*0.50, c2[1]*0.48, c2[2]*0.44],        // mid: lava field hint
    [c2[0]*0.55, c2[1]*0.52, c2[2]*0.48],
    [c1[0]*0.72, c1[1]*0.68, c1[2]*0.62],        // upper: rock
    [0.22, 0.10, 0.04],                           // caldera rim: dark cooled lava
    [0.38, 0.14, 0.03],                           // caldera interior: orange glow
  ];

  // Caldera center (floor)
  positions.push(0, slopeAngle * 1.0 - caldDepth, 0);
  colors.push(0.52, 0.20, 0.04);  // hot lava floor

  for (let ri = 0; ri < RINGS.length; ri++) {
    const [rf, h] = RINGS[ri];
    const [cr, cg, cb] = RING_COL[ri];
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      positions.push(Math.cos(a) * rf, h, Math.sin(a) * rf);
      colors.push(cr, cg, cb);
    }
  }

  const indices: number[] = [];

  // Fan: caldera floor → innermost ring
  for (let s = 0; s < segs; s++) {
    indices.push(0, 1 + (s + 1) % segs, 1 + s);
  }

  // Ring quads
  for (let ri = 0; ri < RINGS.length - 1; ri++) {
    const r1 = 1 + ri * segs;
    const r2 = 1 + (ri + 1) * segs;
    for (let s = 0; s < segs; s++) {
      const s2 = (s + 1) % segs;
      indices.push(r1 + s,  r1 + s2, r2 + s);
      indices.push(r1 + s2, r2 + s2, r2 + s);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color',    new THREE.Float32BufferAttribute(colors,    3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// ── Instance placement ─────────────────────────────────────────────────────
function generateVolcanoes(
  seed:      number,
  volcanism: number,
  radiusKm:  number,
): VolcanoInstance[] {
  const golden  = Math.PI * (3 - Math.sqrt(5));
  const result: VolcanoInstance[] = [];
  function kmToSphere(km: number): number { return km / radiusKm; }

  const CANDIDATES = 120;
  for (let i = 0; i < CANDIDATES; i++) {
    const y0 = 1 - (i / (CANDIDATES - 1)) * 2;
    const r0 = Math.sqrt(Math.max(0, 1 - y0 * y0));
    const th = golden * i;
    const pos = new THREE.Vector3(Math.cos(th) * r0, y0, Math.sin(th) * r0).normalize();

    const h1 = rand(seed * 2.13 + i * 13.71);  // gate
    const h2 = rand(seed * 3.57 + i *  9.23);  // size
    const h3 = rand(seed * 5.11 + i *  7.41);  // angle
    const h4 = rand(seed * 7.89 + i *  5.17);  // type

    if (h1 > volcanism * 0.28) continue;

    if (h4 > 0.30) {
      // CINDER — steeper, smaller (70% of accepted)
      const km    = 10 + h2 * 50;
      const scale = Math.max(0.003, Math.min(0.06, kmToSphere(km)));
      result.push({ pos, scale, angle: h3 * Math.PI * 2, type: 'cinder' });
    } else {
      // SHIELD — broad, gentle slope (30% of accepted)
      const km    = 80 + h2 * 320;
      const scale = Math.max(0.012, Math.min(0.15, kmToSphere(km)));
      result.push({ pos, scale, angle: h3 * Math.PI * 2, type: 'shield' });
    }
  }
  return result;
}

// ── Matrix builder — same approach as CraterField ─────────────────────────
function buildMatrices(
  volcanoes:    VolcanoInstance[],
  sphereRadius: number,
): THREE.Matrix4[] {
  const m   = new THREE.Matrix4();
  const up  = new THREE.Vector3();
  const ref = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const rgt = new THREE.Vector3();
  const rf  = new THREE.Vector3();
  const rr  = new THREE.Vector3();
  const out: THREE.Matrix4[] = [];

  for (const v of volcanoes) {
    up.copy(v.pos);
    if (Math.abs(up.y) > 0.9) ref.set(1, 0, 0); else ref.set(0, 1, 0);
    fwd.crossVectors(ref, up).normalize();
    rgt.crossVectors(up,  fwd).normalize();

    const ca = Math.cos(v.angle), sa = Math.sin(v.angle);
    rf.copy(fwd).multiplyScalar(ca).addScaledVector(rgt,  sa);
    rr.copy(fwd).multiplyScalar(-sa).addScaledVector(rgt, ca);

    const sc = v.scale;
    const px = up.x * sphereRadius, py = up.y * sphereRadius, pz = up.z * sphereRadius;
    m.set(
      rf.x * sc,  up.x * sc,  rr.x * sc,  px,
      rf.y * sc,  up.y * sc,  rr.y * sc,  py,
      rf.z * sc,  up.z * sc,  rr.z * sc,  pz,
      0,          0,          0,           1,
    );
    out.push(m.clone());
  }
  return out;
}

// ── Sub-component: one instanced tier ─────────────────────────────────────
function VolcanoTier({
  volcanoes, matrices, geo, sunDir, lavaGlow,
}: {
  volcanoes: VolcanoInstance[];
  matrices:  THREE.Matrix4[];
  geo:       THREE.BufferGeometry;
  sunDir:    THREE.Vector3;
  lavaGlow:  THREE.Vector3;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null!);

  const mat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader:   VERT,
    fragmentShader: FRAG,
    vertexColors:   true,
    uniforms: {
      uSunDir:  { value: sunDir },
      uLavaGlow:{ value: lavaGlow },
    },
    side: THREE.DoubleSide,
  }), [sunDir, lavaGlow]);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
  }, [matrices]);

  if (volcanoes.length === 0) return null;

  return (
    <instancedMesh ref={meshRef} args={[geo, mat, volcanoes.length]} renderOrder={0} />
  );
}

// ── Main component ─────────────────────────────────────────────────────────
export function VolcanoField({
  seed, volcanism, sphereRadius, mass, sunDirection, c1, c2,
}: Props) {
  const radiusKm = useMemo(
    () => 6371 * Math.pow(Math.max(0.001, mass), 0.27),
    [mass],
  );

  const sunDir = useMemo(
    () => new THREE.Vector3(...sunDirection).normalize(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sunDirection[0], sunDirection[1], sunDirection[2]],
  );

  // Lava glow intensity driven by volcanism
  const lavaGlow = useMemo(
    () => new THREE.Vector3(
      0.55 * volcanism, 0.18 * volcanism, 0.03 * volcanism,
    ),
    [volcanism],
  );

  const volcanoes = useMemo(
    () => generateVolcanoes(seed, volcanism, radiusKm),
    [seed, volcanism, radiusKm],
  );

  const shieldGeo = useMemo(
    () => createShieldGeometry(32, true,  c1, c2),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [c1[0], c1[1], c1[2], c2[0], c2[1], c2[2]],
  );
  const cinderGeo = useMemo(
    () => createShieldGeometry(20, false, c1, c2),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [c1[0], c1[1], c1[2], c2[0], c2[1], c2[2]],
  );

  const shields = useMemo(() => volcanoes.filter(v => v.type === 'shield'), [volcanoes]);
  const cinders = useMemo(() => volcanoes.filter(v => v.type === 'cinder'), [volcanoes]);

  const shieldMats = useMemo(() => buildMatrices(shields, sphereRadius), [shields, sphereRadius]);
  const cinderMats = useMemo(() => buildMatrices(cinders, sphereRadius), [cinders, sphereRadius]);

  if (volcanism < 0.12) return null;

  return (
    <>
      <VolcanoTier volcanoes={shields} matrices={shieldMats} geo={shieldGeo} sunDir={sunDir} lavaGlow={lavaGlow} />
      <VolcanoTier volcanoes={cinders} matrices={cinderMats} geo={cinderGeo} sunDir={sunDir} lavaGlow={lavaGlow} />
    </>
  );
}
