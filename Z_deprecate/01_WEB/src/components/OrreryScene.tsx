/**
 * OrreryScene v2 – Enhanced 3D orrery with visual upgrades
 *
 * Improvements over v1:
 *   - Protoplanetary / debris disc visualisation (glowing annulus with particle scatter)
 *   - Particle-based asteroid & kuiper belts (replacing flat annuli)
 *   - Moon orbits + tiny moon spheres orbiting planets
 *   - Eccentricity-driven elliptical orbits
 *   - Planet axial tilt indicator lines
 *   - Planet shadow cones on rings
 *   - Enhanced HZ with soft glow
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
  for (let i = 0; i < name.length; i++) {
    h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  }
  return Math.abs(h % 10000) / 10000;
}

/* ── Star sphere (central body) ────────────────────── */
function StarBody({ color }: { color: string }) {
  const ref = useRef<THREE.Mesh>(null!);
  const matRef = useRef<THREE.MeshBasicMaterial>(null!);
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (matRef.current) matRef.current.opacity = 0.85 + 0.15 * Math.sin(t * 1.5);
  });
  return (
    <mesh ref={ref}>
      <sphereGeometry args={[0.15, 16, 16]} />
      <meshBasicMaterial ref={matRef} color={color} transparent opacity={0.9} />
    </mesh>
  );
}

function StarGlow({ color }: { color: string }) {
  return (
    <mesh>
      <sphereGeometry args={[0.25, 16, 16]} />
      <meshBasicMaterial color={color} transparent opacity={0.12} depthWrite={false} />
    </mesh>
  );
}

/* ── Orbital ring — now supports eccentricity ──────── */
/* Improvement #7: elliptical orbits */
function OrbitRing({
  semiMajor,
  eccentricity = 0,
  opacity = 0.2,
  color = '#4b5563',
}: {
  semiMajor: number;
  eccentricity?: number;
  opacity?: number;
  color?: string;
}) {
  const lineObj = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    const segments = 80;
    const e = Math.min(eccentricity, 0.95);
    const a = semiMajor;
    const b = a * Math.sqrt(1 - e * e);
    const cx = -a * e; // focus offset
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

/* ── Habitable Zone annulus with soft glow ─────────── */
function HZRing({ inner, outer }: { inner: number; outer: number }) {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[inner, outer, 64]} />
        <meshBasicMaterial color="#22c55e" transparent opacity={0.08} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      {/* Soft glow edges */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[inner * 0.95, inner, 64]} />
        <meshBasicMaterial color="#22c55e" transparent opacity={0.04} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[outer, outer * 1.05, 64]} />
        <meshBasicMaterial color="#22c55e" transparent opacity={0.04} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
    </group>
  );
}

/* ── Particle-based Belt ──────────────────────────── */
/* Improvement #5: particle scatter instead of flat annulus */
function ParticleBelt({ inner, outer, isIcy, count = 400 }: { inner: number; outer: number; isIcy: boolean; count?: number }) {
  const color = isIcy ? '#93c5fd' : '#d1a37a';

  const { positions, sizes } = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const sz = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const r = inner + Math.random() * (outer - inner);
      const theta = Math.random() * Math.PI * 2;
      const yDisp = (Math.random() - 0.5) * (outer - inner) * 0.15;
      pos[i * 3] = Math.cos(theta) * r;
      pos[i * 3 + 1] = yDisp;
      pos[i * 3 + 2] = Math.sin(theta) * r;
      sz[i] = 0.5 + Math.random() * 1.5;
    }
    return { positions: pos, sizes: sz };
  }, [inner, outer, count]);

  const groupRef = useRef<THREE.Points>(null!);
  useFrame(({ clock }) => {
    if (groupRef.current) groupRef.current.rotation.y = clock.getElapsedTime() * 0.01;
  });

  return (
    <points ref={groupRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-size" args={[sizes, 1]} />
      </bufferGeometry>
      <pointsMaterial
        color={color}
        size={0.02}
        transparent
        opacity={0.35}
        depthWrite={false}
        sizeAttenuation
      />
    </points>
  );
}

/* ── Protoplanetary / Debris Disc ─────────────────── */
/* Improvement #4 & #20: disc shader */
function ProtoDisk({ disc }: { disc: ProtoplanetaryDisc }) {
  const inner = auToScene(disc.inner_radius_au);
  const outer = auToScene(disc.outer_radius_au);

  const colorMap: Record<string, string> = {
    protoplanetary: '#c084fc',
    transitional: '#818cf8',
    debris: '#78716c',
  };
  const particleColor = colorMap[disc.disc_type] ?? '#a78bfa';
  const density = disc.density;

  // Particle scatter for the disc
  const particleCount = Math.floor(200 + density * 600);
  const { positions, sizes } = useMemo(() => {
    const pos = new Float32Array(particleCount * 3);
    const sz = new Float32Array(particleCount);
    for (let i = 0; i < particleCount; i++) {
      const r = inner + Math.pow(Math.random(), 0.8) * (outer - inner);
      const theta = Math.random() * Math.PI * 2;
      const yDisp = (Math.random() - 0.5) * (outer - inner) * 0.08 * (1 + density);
      pos[i * 3] = Math.cos(theta) * r;
      pos[i * 3 + 1] = yDisp;
      pos[i * 3 + 2] = Math.sin(theta) * r;
      sz[i] = 0.8 + Math.random() * 2.0;
    }
    return { positions: pos, sizes: sz };
  }, [inner, outer, particleCount, density]);

  const groupRef = useRef<THREE.Group>(null!);
  useFrame(({ clock }) => {
    if (groupRef.current) groupRef.current.rotation.y = clock.getElapsedTime() * 0.005;
  });

  return (
    <group ref={groupRef}>
      {/* Semi-transparent annulus base */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[inner, outer, 64]} />
        <meshBasicMaterial
          color={particleColor}
          transparent
          opacity={density * 0.12}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      {/* Particle scatter on top */}
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
          <bufferAttribute attach="attributes-size" args={[sizes, 1]} />
        </bufferGeometry>
        <pointsMaterial
          color={particleColor}
          size={0.025}
          transparent
          opacity={0.25 + density * 0.2}
          depthWrite={false}
          sizeAttenuation
        />
      </points>
    </group>
  );
}

/* ── Moon sphere orbiting a planet ─────────────────── */
/* Improvement #6: moon orbits + tiny moon spheres */
function MoonOrbit({
  planet,
  parentOrbitRadius,
  parentAngleRef,
}: {
  planet: Planet;
  parentOrbitRadius: number;
  parentAngleRef: React.MutableRefObject<number>;
}) {
  const moons = useMemo(() => {
    return planet.moons.map((moon, i) => {
      const ms = nameSeed(moon.moon_name);
      const orbitR = 0.15 + i * 0.08 + ms * 0.05;
      const speed = 2.0 + ms * 3.0;
      const startAngle = ms * Math.PI * 2;
      const color = moon.moon_type === 'icy' ? '#93c5fd' : '#d1a37a';
      const size = Math.max(0.015, Math.min(0.04, (moon.radius_earth ?? 0.01) * 3));
      return { moon, orbitR, speed, startAngle, color, size };
    });
  }, [planet.moons]);

  const groupRef = useRef<THREE.Group>(null!);

  useFrame(() => {
    if (groupRef.current) {
      // Follow parent planet position
      const pAngle = parentAngleRef.current;
      groupRef.current.position.x = Math.cos(pAngle) * parentOrbitRadius;
      groupRef.current.position.z = Math.sin(pAngle) * parentOrbitRadius;
    }
  });

  if (moons.length === 0) return null;

  return (
    <group ref={groupRef}>
      {moons.map((m) => (
        <MoonSphere key={m.moon.moon_name} {...m} />
      ))}
    </group>
  );
}

function MoonSphere({
  orbitR, speed, startAngle, color, size,
}: {
  orbitR: number; speed: number; startAngle: number; color: string; size: number;
  moon: any;
}) {
  const meshRef = useRef<THREE.Mesh>(null!);
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const angle = startAngle + t * speed;
    if (meshRef.current) {
      meshRef.current.position.x = Math.cos(angle) * orbitR;
      meshRef.current.position.z = Math.sin(angle) * orbitR;
    }
  });
  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[size, 8, 8]} />
      <meshBasicMaterial color={color} transparent opacity={0.6} />
    </mesh>
  );
}

/* ── Procgen Planet Sphere ─────────────────────────── */
function ProcPlanet({
  planet,
  orbitRadius,
  eccentricity,
  hz,
  onHover,
  onUnhover,
  angleRef,
}: {
  planet: Planet;
  orbitRadius: number;
  eccentricity: number;
  hz: HabitableZone;
  onHover: (name: string) => void;
  onUnhover: () => void;
  angleRef: React.MutableRefObject<number>;
}) {
  const meshRef = useRef<THREE.Mesh>(null!);
  const matRef = useRef<THREE.ShaderMaterial>(null!);
  const seed = useMemo(() => nameSeed(planet.planet_name), [planet.planet_name]);
  const startAngle = useMemo(() => seed * Math.PI * 2, [seed]);
  const orbitalSpeed = useMemo(() => 0.15 / Math.max(Math.sqrt(orbitRadius), 0.5), [orbitRadius]);

  const pRadius = useMemo(
    () => planetRadius(planet.radius_earth, planet.planet_type),
    [planet.radius_earth, planet.planet_type],
  );

  const typeCode = PLANET_TYPE_CODE[planet.planet_type] ?? 1;
  const inHZ = planet.semi_major_axis_au != null
    && planet.semi_major_axis_au >= hz.inner_au
    && planet.semi_major_axis_au <= hz.outer_au
    ? 1.0 : 0.0;
  const hasRings = typeCode >= 3 && seed > 0.3 ? 1.0 : 0.0;

  const uniforms = useMemo(
    () => ({
      uPlanetType: { value: typeCode },
      uTemperature: { value: planet.temp_calculated_k ?? 0 },
      uAlbedo: { value: planet.geometric_albedo ?? 0.3 },
      uSeed: { value: seed },
      uInHZ: { value: inHZ },
      uConfidence: { value: planet.confidence === 'observed' ? 1.0 : 0.0 },
      uTime: { value: 0 },
      uHasRings: { value: hasRings },
    }),
    [typeCode, planet.temp_calculated_k, planet.geometric_albedo, seed, inHZ, planet.confidence, hasRings],
  );

  const ringUniforms = useMemo(
    () => ({ uSeed: { value: seed }, uPlanetType: { value: typeCode } }),
    [seed, typeCode],
  );

  // Eccentricity orbit math
  const e = Math.min(eccentricity, 0.95);
  const a = orbitRadius;
  const b = a * Math.sqrt(1 - e * e);
  const cx = -a * e;

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const angle = startAngle + t * orbitalSpeed;
    angleRef.current = angle;
    if (meshRef.current) {
      meshRef.current.position.x = cx + Math.cos(angle) * a;
      meshRef.current.position.z = Math.sin(angle) * b;
    }
    if (matRef.current) matRef.current.uniforms.uTime.value = t;
  });

  /* Improvement #8: planet axial tilt line */
  const tiltAngle = useMemo(() => (seed * 0.5 + 0.1) * Math.PI * 0.2, [seed]);

  return (
    <group ref={meshRef}>
      <mesh
        onPointerEnter={(e) => { e.stopPropagation(); onHover(planet.planet_name); }}
        onPointerLeave={(e) => { e.stopPropagation(); onUnhover(); }}
      >
        <sphereGeometry args={[pRadius, 24, 24]} />
        <shaderMaterial
          ref={matRef}
          vertexShader={planetVertexShader}
          fragmentShader={planetFragmentShader}
          uniforms={uniforms}
          transparent
          depthWrite={planet.confidence === 'observed'}
        />
      </mesh>

      {/* Rings for gas/ice giants */}
      {hasRings > 0.5 && (
        <mesh rotation={[Math.PI * 0.38 + seed * 0.3, 0, seed * 0.5]}>
          <ringGeometry args={[pRadius * 1.4, pRadius * 2.2, 48]} />
          <shaderMaterial
            vertexShader={ringVertexShader}
            fragmentShader={ringFragmentShader}
            uniforms={ringUniforms}
            transparent
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      )}

      {/* Axial tilt indicator */}
      <TiltLine radius={pRadius} angle={tiltAngle} />
    </group>
  );
}

/* ── Axial tilt indicator line ─────────────────────── */
/* Improvement #8 */
function TiltLine({ radius, angle }: { radius: number; angle: number }) {
  const lineObj = useMemo(() => {
    const len = radius * 1.8;
    const pts = [
      new THREE.Vector3(0, -len, 0),
      new THREE.Vector3(0, len, 0),
    ];
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color: '#6b7280', transparent: true, opacity: 0.2, depthWrite: false });
    return new THREE.Line(geo, mat);
  }, [radius]);
  return (
    <primitive object={lineObj} rotation={[0, 0, angle]} />
  );
}

/* ── Scene contents (inside Canvas) ────────────────── */
function OrreryContents({
  planets, belts, hz, disc, starColor, onHover, onUnhover,
}: {
  planets: Planet[];
  belts: Belt[];
  hz: HabitableZone;
  disc: ProtoplanetaryDisc | null;
  starColor: string;
  onHover: (name: string) => void;
  onUnhover: () => void;
}) {
  const groupRef = useRef<THREE.Group>(null!);
  useFrame(({ clock }) => {
    if (groupRef.current) groupRef.current.rotation.y = clock.getElapsedTime() * 0.03;
  });

  // Create angle refs for all planets so moons can follow
  const angleRefs = useRef<Record<string, React.MutableRefObject<number>>>({});
  const getAngleRef = useCallback((name: string) => {
    if (!angleRefs.current[name]) {
      angleRefs.current[name] = { current: 0 };
    }
    return angleRefs.current[name];
  }, []);

  return (
    <group ref={groupRef}>
      <StarBody color={starColor} />
      <StarGlow color={starColor} />

      {/* Habitable zone */}
      <HZRing inner={auToScene(hz.inner_au)} outer={auToScene(hz.outer_au)} />

      {/* Protoplanetary / debris disc */}
      {disc && <ProtoDisk disc={disc} />}

      {/* Belt zones — particle scatter */}
      {belts.map((b) => (
        <ParticleBelt
          key={b.belt_id}
          inner={auToScene(b.inner_radius_au)}
          outer={auToScene(b.outer_radius_au)}
          isIcy={b.belt_type === 'icy-kuiper'}
          count={Math.min(600, Math.max(200, b.estimated_bodies / 100))}
        />
      ))}

      {/* Orbit rings + planets + moons */}
      {planets.map((p) => {
        if (p.semi_major_axis_au == null || p.semi_major_axis_au <= 0) return null;
        const r = auToScene(p.semi_major_axis_au);
        const ecc = p.eccentricity ?? 0;
        const aRef = getAngleRef(p.planet_name);
        return (
          <React.Fragment key={p.planet_name}>
            <OrbitRing
              semiMajor={r}
              eccentricity={ecc}
              opacity={p.confidence === 'observed' ? 0.22 : 0.10}
              color={p.confidence === 'observed' ? '#4b5563' : '#374151'}
            />
            <ProcPlanet
              planet={p}
              orbitRadius={r}
              eccentricity={ecc}
              hz={hz}
              onHover={onHover}
              onUnhover={onUnhover}
              angleRef={aRef}
            />
            {/* Moon orbits */}
            {p.moons.length > 0 && (
              <MoonOrbit
                planet={p}
                parentOrbitRadius={r}
                parentAngleRef={aRef}
              />
            )}
          </React.Fragment>
        );
      })}
    </group>
  );
}

/* ── Tooltip overlay ──────────────────────────────── */
function Tooltip({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 6,
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'rgba(17,24,39,0.92)',
        border: '1px solid #374151',
        borderRadius: 4,
        padding: '2px 8px',
        fontSize: 10,
        color: '#e5e7eb',
        fontFamily: 'Inter, sans-serif',
        fontWeight: 500,
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
        zIndex: 10,
      }}
    >
      {text}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   ██  Main export: OrreryScene
   ═══════════════════════════════════════════════════════ */

interface OrrerySceneProps {
  planets: Planet[];
  belts: Belt[];
  hz: HabitableZone;
  disc?: ProtoplanetaryDisc | null;
  starColor?: string;
}

export default function OrreryScene({ planets, belts, hz, disc = null, starColor = '#fbbf24' }: OrrerySceneProps) {
  const [hoveredPlanet, setHoveredPlanet] = useState<string | null>(null);
  const handleHover = useCallback((name: string) => setHoveredPlanet(name), []);
  const handleUnhover = useCallback(() => setHoveredPlanet(null), []);

  const maxAU = useMemo(() => {
    const smas = planets.map((p) => p.semi_major_axis_au).filter((v): v is number => v != null && v > 0);
    const beltOuters = belts.map((b) => b.outer_radius_au);
    const discOuter = disc?.outer_radius_au ?? 0;
    return Math.max(...smas, ...beltOuters, discOuter, hz.outer_au * 2, 2);
  }, [planets, belts, hz, disc]);

  const cameraZ = useMemo(() => auToScene(maxAU) * 1.6 + 2, [maxAU]);

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: 220,
        borderRadius: 6,
        overflow: 'hidden',
        background: 'rgba(3,7,18,0.9)',
        border: '1px solid #1f2937',
        marginBottom: 8,
      }}
    >
      <Canvas
        camera={{
          position: [cameraZ * 0.4, cameraZ * 0.7, cameraZ * 0.6],
          fov: 45, near: 0.01, far: 200,
        }}
        gl={{ antialias: true, alpha: true }}
        style={{ background: 'transparent' }}
      >
        <ambientLight intensity={0.05} />
        <Suspense fallback={null}>
          <OrreryContents
            planets={planets} belts={belts} hz={hz} disc={disc}
            starColor={starColor}
            onHover={handleHover} onUnhover={handleUnhover}
          />
        </Suspense>
        <OrbitControls
          enablePan={false} enableZoom={true}
          minDistance={1} maxDistance={cameraZ * 3}
          autoRotate={false} makeDefault
        />
      </Canvas>
      <Tooltip text={hoveredPlanet} />
      <div
        style={{
          position: 'absolute', top: 4, right: 6,
          fontSize: 8, color: '#4b5563',
          fontFamily: "'JetBrains Mono', monospace",
          letterSpacing: 0.5, pointerEvents: 'none',
        }}
      >
        ORRERY
      </div>
    </div>
  );
}
