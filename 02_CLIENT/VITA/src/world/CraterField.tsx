/**
 * CraterField — Instanced 3D crater bowl meshes.
 *
 * Three tiers, each with a different polygon budget:
 *   MEGA   — 1–2 per world (10% + 3% chance), 40-seg bowl  — Odysseus/Tethys scale
 *   LARGE  — density-driven,                  28-seg bowl  — Tycho/Moon scale
 *   MEDIUM — density-driven, more numerous,   16-seg bowl
 *
 * Physical sizing: crater radius in km is divided by the estimated planet
 * radius in km so craters visually scale correctly — a 100 km crater looks
 * HUGE on a 500 km moon but subtle on Earth.
 *
 * estimatedRadiusKm = 6371 × mass^0.27   (rocky-planet mass-radius relation)
 *
 * Lighting: a minimal vertex/fragment shader uses the planet's actual sun
 * direction (uSunDir) so craters are lit consistently with the terrain.
 */

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

// ── Shader — simple NdotL + ambient, vertex-colored ──────────────────────
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
varying vec3 vN;
varying vec3 vCol;
void main() {
  float ndl  = max(dot(normalize(vN), normalize(uSunDir)), 0.0);
  float light = 0.18 + 0.82 * ndl;
  gl_FragColor = vec4(vCol * light, 1.0);
}`;

// ── Types ─────────────────────────────────────────────────────────────────
interface Props {
  seed:          number;
  craterDensity: number;
  sphereRadius:  number;
  mass:          number;               // Earth masses — drives physical size scaling
  terrainAge:    number;               // 0=fresh (sharp rims), 1=ancient (eroded saucers)
  sunDirection:  [number,number,number];
  c1: [number, number, number];
  c3: [number, number, number];
}

interface CraterInstance {
  pos:   THREE.Vector3;
  scale: number;   // crater radius in sphere units
  angle: number;
}

type Tier = 'mega' | 'large' | 'medium';
const TIER_SEGS: Record<Tier, number> = { mega: 40, large: 28, medium: 16 };

// ── Crater profile (fractions of crater radius) ───────────────────────────
// Y > 0 = above sphere surface;  Y < 0 = below (inside sphere).
// terrainAge drives erosion: fresh (0) = sharp deep bowl + tall rim,
//                            ancient (1) = shallow saucer + low rounded rim.
// Profile deliberately ends at rf=1.18 — wide ejecta blankets project flat
// onto the sphere and read as a ring from orbit. Keep it tight.
function buildProfile(terrainAge: number): [number, number][] {
  const e     = Math.min(terrainAge, 1.0);
  const rimH  = 0.28 * (1.0 - e * 0.68);   // rim erodes most
  const floor = 0.52 * (1.0 - e * 0.55);   // bowl fills in
  // Profile stops at the rim (rf=1.00) — no outer ejecta disc.
  // The flat ejecta ring (rf=1.10–1.18, Y=0) was projecting as a hula-hoop ring
  // from orbital distance, especially on small moons.
  return [
    [0.18, -floor],
    [0.45, -floor * 0.77],
    [0.65, -floor * 0.38],
    [0.82, -0.05 * (1.0 - e * 0.60)],
    [0.91,  0.00],
    [1.00, +rimH],
  ];
}

const RING_MIX: [number, number][] = [
  [0.28, 0.00],   // floor: dark terrain
  [0.42, 0.00],
  [0.60, 0.00],
  [0.78, 0.00],
  [0.92, 0.00],
  [0.50, 0.50],   // rim: blended, not glowing
];

// ── Geometry factory ──────────────────────────────────────────────────────
function createBowlGeometry(
  segs:    number,
  c1:      [number,number,number],
  c3:      [number,number,number],
  profile: [number,number][],
): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors:    number[] = [];

  // Center floor vertex — Y matches profile floor depth
  const floorY = profile[0][1];
  positions.push(0, floorY, 0);
  colors.push(c1[0] * 0.18, c1[1] * 0.18, c1[2] * 0.18);

  for (let ri = 0; ri < profile.length; ri++) {
    const [rf, hf] = profile[ri];
    const [m1, m3] = RING_MIX[ri];
    const r = Math.min(1, c1[0] * m1 + c3[0] * m3);
    const g = Math.min(1, c1[1] * m1 + c3[1] * m3);
    const b = Math.min(1, c1[2] * m1 + c3[2] * m3);
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      positions.push(Math.cos(a) * rf, hf, Math.sin(a) * rf);
      colors.push(r, g, b);
    }
  }

  const indices: number[] = [];

  // Fan: center → first ring — CCW from outside (+Y up)
  for (let s = 0; s < segs; s++) {
    indices.push(0, 1 + (s + 1) % segs, 1 + s);
  }

  // Ring-to-ring quads — CCW from outside
  for (let ri = 0; ri < profile.length - 1; ri++) {
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

// ── Deterministic rand ────────────────────────────────────────────────────
function rand(s: number): number {
  const x = Math.sin(s + 1.0) * 43758.5453;
  return x - Math.floor(x);
}

// Global size multiplier — keeps craters as small surface pockmarks (not hula-skirt rings).
const CRATER_SIZE_FACTOR = 0.025;

// ── Crater generation — tiered ────────────────────────────────────────────
function generateCraters(
  seed:          number,
  density:       number,
  radiusKm:      number,           // estimated planet radius in km
): Record<Tier, CraterInstance[]> {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const result: Record<Tier, CraterInstance[]> = { mega: [], large: [], medium: [] };

  // Physical radii in km → sphere units, scaled down to surface-pockmark size
  function kmToSphere(km: number): number { return (km / radiusKm) * CRATER_SIZE_FACTOR; }

  // ── MEGA craters — Fibonacci candidates, very rare ────────────────────
  // 10% chance of 1, additional 3% chance of a 2nd
  const megaKm = [400 + rand(seed * 7.11) * 600,    // 400–1000 km radius
                  350 + rand(seed * 9.37) * 500];    // 350–850 km radius
  const megaSeeds = [rand(seed * 3.77), rand(seed * 5.13)];
  const megaCount = megaSeeds[0] < 0.10 ? (megaSeeds[1] < 0.03 ? 2 : 1) : 0;

  for (let i = 0; i < megaCount; i++) {
    const h = rand(seed * 11.3 + i * 17.7);
    const y0 = 1 - h * 2;
    const r0 = Math.sqrt(Math.max(0, 1 - y0 * y0));
    const th = rand(seed * 13.1 + i * 23.3) * Math.PI * 2;
    const pos = new THREE.Vector3(Math.cos(th) * r0, y0, Math.sin(th) * r0).normalize();
    const scale = Math.min(0.008, kmToSphere(megaKm[i]));  // cap at 0.8% of radius
    result.mega.push({ pos, scale, angle: rand(seed * 6.3 + i) * Math.PI * 2 });
    // Secondary craters removed — their fixed-distance annulus created a hula-skirt
    // ring artifact visible from orbit. Regular MEDIUM tier provides coverage instead.
  }

  // ── LARGE & MEDIUM — Fibonacci sphere, density-gated ─────────────────
  const CANDIDATES = 300;
  for (let i = 0; i < CANDIDATES; i++) {
    const y0 = 1 - (i / (CANDIDATES - 1)) * 2;
    const r0 = Math.sqrt(Math.max(0, 1 - y0 * y0));
    const th = golden * i;
    const pos = new THREE.Vector3(Math.cos(th) * r0, y0, Math.sin(th) * r0).normalize();

    const h1 = rand(seed * 1.73 + i * 17.31 + 0.11);  // gate
    const h2 = rand(seed * 2.47 + i * 11.37 + 0.22);  // size
    const h3 = rand(seed * 3.19 + i *  6.71 + 0.33);  // angle
    const h4 = rand(seed * 4.83 + i *  8.53 + 0.44);  // tier split

    if (h1 > density * 0.32) continue;

    if (h4 > 0.35) {
      // MEDIUM  (65% of accepted)
      const km    = 15 + h2 * 55;                          // 15–70 km radius
      const scale = Math.max(0.00015, kmToSphere(km));
      if (scale > 0.006) continue;                          // too big for medium tier
      result.medium.push({ pos, scale, angle: h3 * Math.PI * 2 });
    } else {
      // LARGE  (35% of accepted)
      const km    = 60 + h2 * 180;                          // 60–240 km radius
      const scale = Math.max(0.0004, Math.min(0.004, kmToSphere(km)));
      result.large.push({ pos, scale, angle: h3 * Math.PI * 2 });
    }
  }

  return result;
}

// ── Instance matrix builder ───────────────────────────────────────────────
function buildMatrices(
  craters:      CraterInstance[],
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

  for (const c of craters) {
    up.copy(c.pos);
    if (Math.abs(up.y) > 0.9) ref.set(1, 0, 0);
    else                        ref.set(0, 1, 0);
    fwd.crossVectors(ref, up).normalize();
    rgt.crossVectors(up, fwd).normalize();

    const ca = Math.cos(c.angle), sa = Math.sin(c.angle);
    rf.copy(fwd).multiplyScalar(ca).addScaledVector(rgt,  sa);
    rr.copy(fwd).multiplyScalar(-sa).addScaledVector(rgt, ca);

    const sc = c.scale;
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

// ── Sub-component: one instanced tier ────────────────────────────────────
function CraterTier({
  craters, matrices, geo, sunDir,
}: {
  craters:  CraterInstance[];
  matrices: THREE.Matrix4[];
  geo:      THREE.BufferGeometry;
  sunDir:   THREE.Vector3;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null!);

  const mat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader:   VERT,
    fragmentShader: FRAG,
    vertexColors:   true,
    uniforms: { uSunDir: { value: sunDir } },
    side: THREE.DoubleSide,
  }), [sunDir]);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
  }, [matrices]);

  if (craters.length === 0) return null;

  return (
    <instancedMesh ref={meshRef} args={[geo, mat, craters.length]} renderOrder={0} />
  );
}

// ── Main component ────────────────────────────────────────────────────────
export function CraterField({
  seed, craterDensity, sphereRadius, mass, terrainAge, sunDirection, c1, c3,
}: Props) {
  // Estimate planet radius from mass (rocky-planet mass-radius relation)
  const radiusKm = useMemo(
    () => 6371 * Math.pow(Math.max(0.001, mass), 0.27),
    [mass],
  );

  const sunDir = useMemo(
    () => new THREE.Vector3(...sunDirection).normalize(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sunDirection[0], sunDirection[1], sunDirection[2]],
  );

  const tierData = useMemo(
    () => generateCraters(seed, craterDensity, radiusKm),
    [seed, craterDensity, radiusKm],
  );

  const geos = useMemo(
    () => {
      const profile = buildProfile(terrainAge);
      return {
        mega:   createBowlGeometry(TIER_SEGS.mega,   c1, c3, profile),
        large:  createBowlGeometry(TIER_SEGS.large,  c1, c3, profile),
        medium: createBowlGeometry(TIER_SEGS.medium, c1, c3, profile),
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [terrainAge, c1[0], c1[1], c1[2], c3[0], c3[1], c3[2]],
  );

  const mats = useMemo(() => ({
    mega:   buildMatrices(tierData.mega,   sphereRadius),
    large:  buildMatrices(tierData.large,  sphereRadius),
    medium: buildMatrices(tierData.medium, sphereRadius),
  }), [tierData, sphereRadius]);

  if (craterDensity < 0.12) return null;

  return (
    <>
      <CraterTier craters={tierData.mega}   matrices={mats.mega}   geo={geos.mega}   sunDir={sunDir} />
      <CraterTier craters={tierData.large}  matrices={mats.large}  geo={geos.large}  sunDir={sunDir} />
      <CraterTier craters={tierData.medium} matrices={mats.medium} geo={geos.medium} sunDir={sunDir} />
    </>
  );
}
