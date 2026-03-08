/**
 * OrrerySceneFull — Full-viewport 3D orrery for SystemViewerPage
 *
 * Identical rendering to OrreryScene but:
 *   - Takes full parent height
 *   - Accepts selectedPlanet prop for highlight glow
 *   - Slightly different camera defaults
 */

import React, { useRef, useMemo, useState, useCallback, Suspense } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { Planet, Belt, HabitableZone, ProtoplanetaryDisc } from '../types/api';
import {
  planetVertexShader,
  planetFragmentShader,
  ringVertexShader,
  ringFragmentShader,
  PLANET_TYPE_CODE,
} from '../shaders/planetShaders';

/* ── Scale helper ──────────────────────────────────── */
function auToScene(au: number): number {
  if (au <= 0) return 0;
  if (au <= 1) return Math.sqrt(au) * 2.0;
  return 2.0 + Math.log10(au) * 2.5;
}

function planetRadius(radiusEarth: number | null, planetType: string): number {
  const r = radiusEarth ?? 1.0;
  const typeScale: Record<string, number> = {
    'sub-earth': 0.06, rocky: 0.08, 'super-earth': 0.10,
    'neptune-like': 0.16, 'gas-giant': 0.24, 'super-jupiter': 0.30, unknown: 0.08,
  };
  const base = typeScale[planetType] ?? 0.08;
  return base * (0.7 + 0.3 * Math.log10(Math.max(r, 0.1) + 1));
}

function nameSeed(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  return Math.abs(h % 10000) / 10000;
}

/* -- Star body ------------------------------------------------ */
function StarBody({ color }: { color: string }) {
  const matRef = useRef<THREE.MeshBasicMaterial>(null!);
  useFrame(({ clock }) => {
    if (matRef.current) matRef.current.opacity = 0.85 + 0.15 * Math.sin(clock.getElapsedTime() * 1.5);
  });
  return (
    <mesh>
      <sphereGeometry args={[0.2, 24, 24]} />
      <meshBasicMaterial ref={matRef} color={color} transparent opacity={0.9} />
    </mesh>
  );
}

function StarGlow({ color }: { color: string }) {
  return (
    <mesh>
      <sphereGeometry args={[0.35, 24, 24]} />
      <meshBasicMaterial color={color} transparent opacity={0.1} depthWrite={false} />
    </mesh>
  );
}

/* -- Elliptical orbit ring ------------------------------------ */
function OrbitRing({ semiMajor, eccentricity = 0, opacity = 0.2, color = '#4b5563' }: {
  semiMajor: number; eccentricity?: number; opacity?: number; color?: string;
}) {
  const lineObj = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    const segments = 96;
    const e = Math.min(eccentricity, 0.95);
    const a = semiMajor;
    const b = a * Math.sqrt(1 - e * e);
    const cx = -a * e;
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      pts.push(new THREE.Vector3(cx + Math.cos(angle) * a, 0, Math.sin(angle) * b));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
    return new THREE.Line(geo, mat);
  }, [semiMajor, eccentricity, opacity, color]);
  return <primitive object={lineObj} />;
}

/* -- HZ Ring -------------------------------------------------- */
function HZRing({ inner, outer }: { inner: number; outer: number }) {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[inner, outer, 64]} />
        <meshBasicMaterial color="#22c55e" transparent opacity={0.06} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
    </group>
  );
}

/* -- Particle belt -------------------------------------------- */
function ParticleBelt({ inner, outer, isIcy, count = 500 }: { inner: number; outer: number; isIcy: boolean; count?: number }) {
  const color = isIcy ? '#93c5fd' : '#d1a37a';
  const { positions } = useMemo(() => {
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = inner + Math.random() * (outer - inner);
      const theta = Math.random() * Math.PI * 2;
      pos[i * 3] = Math.cos(theta) * r;
      pos[i * 3 + 1] = (Math.random() - 0.5) * (outer - inner) * 0.12;
      pos[i * 3 + 2] = Math.sin(theta) * r;
    }
    return { positions: pos };
  }, [inner, outer, count]);
  const ref = useRef<THREE.Points>(null!);
  useFrame(({ clock }) => { if (ref.current) ref.current.rotation.y = clock.getElapsedTime() * 0.008; });
  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial color={color} size={0.025} transparent opacity={0.3} depthWrite={false} sizeAttenuation />
    </points>
  );
}

/* -- Protoplanetary disc -------------------------------------- */
function ProtoDisk({ disc }: { disc: ProtoplanetaryDisc }) {
  const inner = auToScene(disc.inner_radius_au);
  const outer = auToScene(disc.outer_radius_au);
  const colors: Record<string, string> = { protoplanetary: '#c084fc', transitional: '#818cf8', debris: '#78716c' };
  const pc = colors[disc.disc_type] ?? '#a78bfa';
  const count = Math.floor(300 + disc.density * 700);
  const { positions } = useMemo(() => {
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = inner + Math.pow(Math.random(), 0.8) * (outer - inner);
      const theta = Math.random() * Math.PI * 2;
      pos[i * 3] = Math.cos(theta) * r;
      pos[i * 3 + 1] = (Math.random() - 0.5) * (outer - inner) * 0.08;
      pos[i * 3 + 2] = Math.sin(theta) * r;
    }
    return { positions: pos };
  }, [inner, outer, count]);
  const ref = useRef<THREE.Group>(null!);
  useFrame(({ clock }) => { if (ref.current) ref.current.rotation.y = clock.getElapsedTime() * 0.004; });
  return (
    <group ref={ref}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[inner, outer, 64]} />
        <meshBasicMaterial color={pc} transparent opacity={disc.density * 0.1} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <points>
        <bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]} /></bufferGeometry>
        <pointsMaterial color={pc} size={0.03} transparent opacity={0.2 + disc.density * 0.15} depthWrite={false} sizeAttenuation />
      </points>
    </group>
  );
}

/* -- Planet --------------------------------------------------- */
function ProcPlanet({
  planet, orbitRadius, eccentricity, hz, isSelected, onHover, onUnhover, angleRef,
}: {
  planet: Planet; orbitRadius: number; eccentricity: number; hz: HabitableZone;
  isSelected: boolean;
  onHover: (n: string) => void; onUnhover: () => void;
  angleRef: React.MutableRefObject<number>;
}) {
  const meshRef = useRef<THREE.Mesh>(null!);
  const matRef = useRef<THREE.ShaderMaterial>(null!);
  const seed = useMemo(() => nameSeed(planet.planet_name), [planet.planet_name]);
  const startAngle = seed * Math.PI * 2;
  const orbitalSpeed = 0.15 / Math.max(Math.sqrt(orbitRadius), 0.5);
  const pRadius = planetRadius(planet.radius_earth, planet.planet_type);
  const typeCode = PLANET_TYPE_CODE[planet.planet_type] ?? 1;
  const inHZ = planet.semi_major_axis_au != null && planet.semi_major_axis_au >= hz.inner_au && planet.semi_major_axis_au <= hz.outer_au ? 1.0 : 0.0;
  const hasRings = typeCode >= 3 && seed > 0.3 ? 1.0 : 0.0;

  const uniforms = useMemo(() => ({
    uPlanetType: { value: typeCode },
    uTemperature: { value: planet.temp_calculated_k ?? 0 },
    uAlbedo: { value: planet.geometric_albedo ?? 0.3 },
    uSeed: { value: seed }, uInHZ: { value: inHZ },
    uConfidence: { value: planet.confidence === 'observed' ? 1.0 : 0.0 },
    uTime: { value: 0 }, uHasRings: { value: hasRings },
  }), [typeCode, planet.temp_calculated_k, planet.geometric_albedo, seed, inHZ, planet.confidence, hasRings]);

  const ringUniforms = useMemo(() => ({ uSeed: { value: seed }, uPlanetType: { value: typeCode } }), [seed, typeCode]);

  const e = Math.min(eccentricity, 0.95);
  const a = orbitRadius, b = a * Math.sqrt(1 - e * e), cx = -a * e;

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const angle = startAngle + t * orbitalSpeed;
    angleRef.current = angle;
    if (meshRef.current) { meshRef.current.position.x = cx + Math.cos(angle) * a; meshRef.current.position.z = Math.sin(angle) * b; }
    if (matRef.current) matRef.current.uniforms.uTime.value = t;
  });

  return (
    <group ref={meshRef}>
      {/* Selection glow */}
      {isSelected && (
        <mesh>
          <sphereGeometry args={[pRadius * 2.0, 16, 16]} />
          <meshBasicMaterial color="#22d3ee" transparent opacity={0.08} depthWrite={false} />
        </mesh>
      )}
      <mesh
        onPointerEnter={(e) => { e.stopPropagation(); onHover(planet.planet_name); }}
        onPointerLeave={(e) => { e.stopPropagation(); onUnhover(); }}
      >
        <sphereGeometry args={[pRadius, 32, 32]} />
        <shaderMaterial ref={matRef} vertexShader={planetVertexShader} fragmentShader={planetFragmentShader} uniforms={uniforms} transparent depthWrite={planet.confidence === 'observed'} />
      </mesh>
      {hasRings > 0.5 && (
        <mesh rotation={[Math.PI * 0.38 + seed * 0.3, 0, seed * 0.5]}>
          <ringGeometry args={[pRadius * 1.4, pRadius * 2.2, 48]} />
          <shaderMaterial vertexShader={ringVertexShader} fragmentShader={ringFragmentShader} uniforms={ringUniforms} transparent side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}

/* -- Moon sphere ---------------------------------------------- */
function MoonOrbit({ planet, parentOrbitRadius, parentAngleRef }: {
  planet: Planet; parentOrbitRadius: number; parentAngleRef: React.MutableRefObject<number>;
}) {
  const moons = useMemo(() =>
    planet.moons.map((moon, i) => {
      const ms = nameSeed(moon.moon_name);
      return { moon, orbitR: 0.18 + i * 0.09 + ms * 0.06, speed: 2.0 + ms * 3.0, startAngle: ms * Math.PI * 2, color: moon.moon_type === 'icy' ? '#93c5fd' : '#d1a37a', size: Math.max(0.018, Math.min(0.05, (moon.radius_earth ?? 0.01) * 4)) };
    }), [planet.moons]);
  const ref = useRef<THREE.Group>(null!);
  useFrame(() => { if (ref.current) { const a = parentAngleRef.current; ref.current.position.x = Math.cos(a) * parentOrbitRadius; ref.current.position.z = Math.sin(a) * parentOrbitRadius; } });
  if (moons.length === 0) return null;
  return (
    <group ref={ref}>
      {moons.map((m) => <MoonSphere key={m.moon.moon_name} {...m} />)}
    </group>
  );
}

function MoonSphere({ orbitR, speed, startAngle, color, size }: { orbitR: number; speed: number; startAngle: number; color: string; size: number; moon: any }) {
  const ref = useRef<THREE.Mesh>(null!);
  useFrame(({ clock }) => { const a = startAngle + clock.getElapsedTime() * speed; if (ref.current) { ref.current.position.x = Math.cos(a) * orbitR; ref.current.position.z = Math.sin(a) * orbitR; } });
  return <mesh ref={ref}><sphereGeometry args={[size, 8, 8]} /><meshBasicMaterial color={color} transparent opacity={0.6} /></mesh>;
}

/* -- Scene contents ------------------------------------------- */
function OrreryContents({ planets, belts, hz, disc, starColor, selectedPlanet, onHover, onUnhover }: {
  planets: Planet[]; belts: Belt[]; hz: HabitableZone; disc: ProtoplanetaryDisc | null;
  starColor: string; selectedPlanet: string | null; onHover: (n: string) => void; onUnhover: () => void;
}) {
  const groupRef = useRef<THREE.Group>(null!);
  useFrame(({ clock }) => { if (groupRef.current) groupRef.current.rotation.y = clock.getElapsedTime() * 0.02; });
  const angleRefs = useRef<Record<string, React.MutableRefObject<number>>>({});
  const getAngleRef = useCallback((name: string) => {
    if (!angleRefs.current[name]) angleRefs.current[name] = { current: 0 };
    return angleRefs.current[name];
  }, []);

  return (
    <group ref={groupRef}>
      <StarBody color={starColor} />
      <StarGlow color={starColor} />
      <HZRing inner={auToScene(hz.inner_au)} outer={auToScene(hz.outer_au)} />
      {disc && <ProtoDisk disc={disc} />}
      {belts.map((b) => (
        <ParticleBelt key={b.belt_id} inner={auToScene(b.inner_radius_au)} outer={auToScene(b.outer_radius_au)} isIcy={b.belt_type === 'icy-kuiper'} count={Math.min(800, Math.max(300, b.estimated_bodies / 80))} />
      ))}
      {planets.map((p) => {
        if (p.semi_major_axis_au == null || p.semi_major_axis_au <= 0) return null;
        const r = auToScene(p.semi_major_axis_au);
        const ecc = p.eccentricity ?? 0;
        const aRef = getAngleRef(p.planet_name);
        return (
          <React.Fragment key={p.planet_name}>
            <OrbitRing semiMajor={r} eccentricity={ecc} opacity={p.confidence === 'observed' ? 0.2 : 0.08} color={p.confidence === 'observed' ? '#4b5563' : '#374151'} />
            <ProcPlanet planet={p} orbitRadius={r} eccentricity={ecc} hz={hz} isSelected={selectedPlanet === p.planet_name} onHover={onHover} onUnhover={onUnhover} angleRef={aRef} />
            {p.moons.length > 0 && <MoonOrbit planet={p} parentOrbitRadius={r} parentAngleRef={aRef} />}
          </React.Fragment>
        );
      })}
    </group>
  );
}

/* ═══════════════════════════════════════════════════════
   ██  Main export
   ═══════════════════════════════════════════════════════ */
interface Props {
  planets: Planet[];
  belts: Belt[];
  hz: HabitableZone;
  disc?: ProtoplanetaryDisc | null;
  starColor?: string;
  selectedPlanet?: string | null;
}

export default function OrrerySceneFull({ planets, belts, hz, disc = null, starColor = '#fbbf24', selectedPlanet = null }: Props) {
  const [hoveredPlanet, setHoveredPlanet] = useState<string | null>(null);
  const handleHover = useCallback((name: string) => setHoveredPlanet(name), []);
  const handleUnhover = useCallback(() => setHoveredPlanet(null), []);

  const maxAU = useMemo(() => {
    const smas = planets.map((p) => p.semi_major_axis_au).filter((v): v is number => v != null && v > 0);
    const bo = belts.map((b) => b.outer_radius_au);
    const dOuter = disc?.outer_radius_au ?? 0;
    return Math.max(...smas, ...bo, dOuter, hz.outer_au * 2, 2);
  }, [planets, belts, hz, disc]);
  const cameraZ = auToScene(maxAU) * 1.4 + 2.5;

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Canvas
        camera={{ position: [cameraZ * 0.3, cameraZ * 0.6, cameraZ * 0.5], fov: 42, near: 0.01, far: 300 }}
        gl={{ antialias: true, alpha: true }}
        style={{ background: '#030712' }}
      >
        <ambientLight intensity={0.04} />
        <Suspense fallback={null}>
          <OrreryContents
            planets={planets} belts={belts} hz={hz} disc={disc}
            starColor={starColor} selectedPlanet={selectedPlanet}
            onHover={handleHover} onUnhover={handleUnhover}
          />
        </Suspense>
        <OrbitControls enablePan={true} enableZoom={true} minDistance={0.5} maxDistance={cameraZ * 4} autoRotate={false} makeDefault />
      </Canvas>
      {hoveredPlanet && (
        <div style={{
          position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(17,24,39,0.92)', border: '1px solid #374151', borderRadius: 5,
          padding: '3px 12px', fontSize: 12, color: '#e5e7eb', fontFamily: 'Inter, sans-serif',
          fontWeight: 500, pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: 10,
        }}>
          {hoveredPlanet}
        </div>
      )}
      <div style={{ position: 'absolute', top: 8, right: 10, fontSize: 9, color: '#374151', fontFamily: "'JetBrains Mono', monospace", pointerEvents: 'none', letterSpacing: 0.5 }}>
        SYSTEM VIEWER
      </div>
    </div>
  );
}
