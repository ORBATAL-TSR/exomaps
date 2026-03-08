/**
 * PlanetSurfaceView — Immersive PBR planet surface renderer for web client.
 *
 * Renders a detailed planet globe with:
 *   - Procedural PBR Cook-Torrance BRDF shading
 *   - Atmosphere scattering shell (Rayleigh + Mie)
 *   - Orbital camera with mouse-drag rotation + zoom
 *   - Slow auto-rotation
 *   - Planet type-specific surface generation (6 types)
 *
 * Designed as a fullscreen or panel-embedded component shown when clicking
 * a planet in the SystemViewerPage orrery.
 */

import React, { useMemo, useRef, Suspense } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { Planet, HabitableZone } from '../types/api';
import {
  proceduralPbrVertexShader,
  proceduralPbrFragmentShader,
  atmosphereShellVertexShader,
  atmosphereShellFragmentShader,
  PLANET_TYPE_CODE,
} from '../shaders/pbrSurfaceShaders';

/* ── Helpers ──────────────────────────────────────── */

function nameSeed(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  return Math.abs(h % 10000) / 10000;
}

/** Spectral class → approximate atmosphere color. */
const SPECTRAL_ATMO_COLOR: Record<string, [number, number, number]> = {
  O: [0.4, 0.5, 0.9],
  B: [0.45, 0.55, 0.85],
  A: [0.5, 0.6, 0.8],
  F: [0.5, 0.6, 0.85],
  G: [0.4, 0.55, 0.9],   // Earth-like blue
  K: [0.45, 0.5, 0.75],
  M: [0.5, 0.4, 0.65],
  L: [0.4, 0.35, 0.5],
  T: [0.35, 0.3, 0.45],
};

/** Approximate atmosphere thickness from planet type & temperature. */
function estimateAtmosphere(planet: Planet): { color: [number, number, number]; thickness: number } {
  const mass = planet.mass_earth ?? 1;
  const ptype = planet.planet_type;

  if (ptype === 'sub-earth') return { color: [0.4, 0.4, 0.5], thickness: 0.02 };
  if (ptype === 'rocky') return { color: [0.5, 0.45, 0.6], thickness: mass > 0.5 ? 0.15 : 0.05 };
  if (ptype === 'super-earth') {
    const temp = planet.temp_calculated_k ?? 300;
    if (temp > 200 && temp < 400) return { color: [0.4, 0.55, 0.9], thickness: 0.6 }; // Earth-like
    return { color: [0.6, 0.5, 0.4], thickness: 0.4 };
  }
  if (ptype === 'neptune-like') return { color: [0.3, 0.5, 0.85], thickness: 0.85 };
  if (ptype === 'gas-giant') return { color: [0.5, 0.4, 0.3], thickness: 0.95 };
  if (ptype === 'super-jupiter') return { color: [0.5, 0.35, 0.25], thickness: 0.98 };
  return { color: [0.4, 0.4, 0.5], thickness: 0.1 };
}

/* ── Spinning Planet Globe ────────────────────────── */

function PlanetGlobe({
  planet,
  hz,
  starSpectralClass,
}: {
  planet: Planet;
  hz: HabitableZone;
  starSpectralClass?: string;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const seed = useMemo(() => nameSeed(planet.planet_name), [planet.planet_name]);

  const typeCode = PLANET_TYPE_CODE[planet.planet_type] ?? 1;
  const inHZ =
    planet.semi_major_axis_au != null &&
    planet.semi_major_axis_au >= hz.inner_au &&
    planet.semi_major_axis_au <= hz.outer_au
      ? 1.0
      : 0.0;

  const atmo = useMemo(() => estimateAtmosphere(planet), [planet]);
  const sunColor = useMemo(() => {
    const sc = starSpectralClass?.[0]?.toUpperCase() ?? 'G';
    const colors: Record<string, [number, number, number]> = {
      O: [0.6, 0.7, 1.0], B: [0.7, 0.8, 1.0], A: [0.85, 0.88, 1.0],
      F: [1.0, 0.98, 0.95], G: [1.0, 0.96, 0.89], K: [1.0, 0.82, 0.65],
      M: [1.0, 0.7, 0.5], L: [1.0, 0.55, 0.35], T: [1.0, 0.45, 0.25],
    };
    const c = colors[sc] ?? [1, 0.96, 0.89];
    return new THREE.Color(c[0], c[1], c[2]);
  }, [starSpectralClass]);

  const surfaceUniforms = useMemo(
    () => ({
      uPlanetType: { value: typeCode },
      uTemperature: { value: planet.temp_calculated_k ?? 280 },
      uSeed: { value: seed },
      uInHZ: { value: inHZ },
      uTime: { value: 0 },
      uMass: { value: planet.mass_earth ?? 1 },
      uRadius: { value: planet.radius_earth ?? 1 },
      uSunDirection: { value: new THREE.Vector3(1, 0.3, 0.5).normalize() },
      uSunColor: { value: sunColor },
      uSunIntensity: { value: 1.2 },
      uAtmosphereColor: { value: new THREE.Color(...atmo.color) },
      uAtmosphereThickness: { value: atmo.thickness },
    }),
    [typeCode, planet, seed, inHZ, sunColor, atmo],
  );

  const atmosUniforms = useMemo(
    () => ({
      uSunDirection: { value: new THREE.Vector3(1, 0.3, 0.5).normalize() },
      uSunColor: { value: sunColor },
      uSunIntensity: { value: 1.2 },
      uAtmosphereColor: { value: new THREE.Color(...atmo.color) },
      uAtmosphereThickness: { value: atmo.thickness },
      uAtmosphereFalloff: { value: 3.0 },
    }),
    [sunColor, atmo],
  );

  useFrame((_, dt) => {
    if (groupRef.current) groupRef.current.rotation.y += dt * 0.08;
    if (matRef.current) {
      matRef.current.uniforms.uTime.value += dt;
      matRef.current.uniformsNeedUpdate = true;
    }
  });

  const atmosScale = 1.0 + atmo.thickness * 0.06;
  const showAtmo = atmo.thickness > 0.03;

  return (
    <group ref={groupRef}>
      {/* Planet surface */}
      <mesh>
        <sphereGeometry args={[1, 128, 96]} />
        <shaderMaterial
          ref={matRef}
          vertexShader={proceduralPbrVertexShader}
          fragmentShader={proceduralPbrFragmentShader}
          uniforms={surfaceUniforms}
        />
      </mesh>

      {/* Atmosphere shell */}
      {showAtmo && (
        <mesh scale={[atmosScale, atmosScale, atmosScale]}>
          <sphereGeometry args={[1, 64, 48]} />
          <shaderMaterial
            vertexShader={atmosphereShellVertexShader}
            fragmentShader={atmosphereShellFragmentShader}
            uniforms={atmosUniforms}
            transparent
            side={THREE.BackSide}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      )}
    </group>
  );
}

/* ── Info overlay ─────────────────────────────────── */

const PLANET_TYPE_LABEL: Record<string, string> = {
  'sub-earth': 'Sub-Earth',
  rocky: 'Rocky',
  'super-earth': 'Super-Earth',
  'neptune-like': 'Neptune-like',
  'gas-giant': 'Gas Giant',
  'super-jupiter': 'Super-Jupiter',
  unknown: 'Unknown',
};

function InfoOverlay({ planet, hz }: { planet: Planet; hz: HabitableZone }) {
  const inHZ =
    planet.semi_major_axis_au != null &&
    planet.semi_major_axis_au >= hz.inner_au &&
    planet.semi_major_axis_au <= hz.outer_au;

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 12,
        left: 12,
        right: 12,
        background: 'rgba(3,7,18,0.85)',
        border: '1px solid rgba(75,85,99,0.4)',
        borderRadius: 8,
        padding: '10px 14px',
        color: '#e5e7eb',
        fontFamily: 'Inter, sans-serif',
        pointerEvents: 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 15, fontWeight: 700 }}>
          {planet.planet_name.replace(' (inferred)', '')}
        </span>
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            background: 'rgba(99,102,241,0.2)',
            color: '#818cf8',
            borderRadius: 3,
            padding: '1px 6px',
            textTransform: 'uppercase',
          }}
        >
          {PLANET_TYPE_LABEL[planet.planet_type] ?? planet.planet_type}
        </span>
        {inHZ && (
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              background: 'rgba(34,197,94,0.15)',
              color: '#22c55e',
              borderRadius: 3,
              padding: '1px 6px',
            }}
          >
            HABITABLE ZONE
          </span>
        )}
        {planet.confidence === 'inferred' && (
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              background: 'rgba(251,191,36,0.15)',
              color: '#fbbf24',
              borderRadius: 3,
              padding: '1px 6px',
            }}
          >
            INFERRED
          </span>
        )}
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
          gap: '2px 16px',
          fontSize: 10,
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        {planet.mass_earth != null && (
          <span>
            <span style={{ color: '#6b7280' }}>Mass: </span>
            {planet.mass_earth.toFixed(2)} M⊕
          </span>
        )}
        {planet.radius_earth != null && (
          <span>
            <span style={{ color: '#6b7280' }}>Radius: </span>
            {planet.radius_earth.toFixed(2)} R⊕
          </span>
        )}
        {planet.semi_major_axis_au != null && (
          <span>
            <span style={{ color: '#6b7280' }}>SMA: </span>
            {planet.semi_major_axis_au.toFixed(3)} AU
          </span>
        )}
        {planet.temp_calculated_k != null && (
          <span>
            <span style={{ color: '#6b7280' }}>Temp: </span>
            {Math.round(planet.temp_calculated_k)} K
          </span>
        )}
        {planet.eccentricity != null && (
          <span>
            <span style={{ color: '#6b7280' }}>Ecc: </span>
            {planet.eccentricity.toFixed(3)}
          </span>
        )}
        {planet.orbital_period_days != null && (
          <span>
            <span style={{ color: '#6b7280' }}>Period: </span>
            {planet.orbital_period_days.toFixed(1)} d
          </span>
        )}
        {planet.moons.length > 0 && (
          <span>
            <span style={{ color: '#6b7280' }}>Moons: </span>
            {planet.moons.length}
          </span>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   ██  Main export: PlanetSurfaceView
   ═══════════════════════════════════════════════════════ */

interface PlanetSurfaceViewProps {
  planet: Planet;
  hz: HabitableZone;
  starSpectralClass?: string;
  onClose?: () => void;
  height?: number | string;
  width?: number | string;
}

export default function PlanetSurfaceView({
  planet,
  hz,
  starSpectralClass,
  onClose,
  height = '100%',
  width = '100%',
}: PlanetSurfaceViewProps) {
  return (
    <div
      style={{
        position: 'relative',
        width,
        height,
        background: 'radial-gradient(ellipse at center, #0a0f1a 0%, #030712 100%)',
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      <Canvas
        camera={{ position: [0, 0.3, 2.8], fov: 40, near: 0.01, far: 50 }}
        gl={{ antialias: true, alpha: false }}
        style={{ background: 'transparent' }}
      >
        <ambientLight intensity={0.01} />
        <Suspense fallback={null}>
          <PlanetGlobe
            planet={planet}
            hz={hz}
            starSpectralClass={starSpectralClass}
          />
        </Suspense>
        <OrbitControls
          enablePan={false}
          enableZoom
          minDistance={1.5}
          maxDistance={8}
          autoRotate={false}
          makeDefault
        />
      </Canvas>

      {/* Close button */}
      {onClose && (
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            background: 'rgba(17,24,39,0.8)',
            border: '1px solid #374151',
            borderRadius: 4,
            color: '#9ca3af',
            cursor: 'pointer',
            padding: '2px 8px',
            fontSize: 12,
            fontWeight: 600,
            zIndex: 10,
          }}
          title="Close planet view (Esc)"
        >
          ✕
        </button>
      )}

      {/* Planet info */}
      <InfoOverlay planet={planet} hz={hz} />

      {/* Label */}
      <div
        style={{
          position: 'absolute',
          top: 6,
          left: 8,
          fontSize: 9,
          color: '#4b5563',
          fontFamily: "'JetBrains Mono', monospace",
          letterSpacing: 0.5,
          pointerEvents: 'none',
        }}
      >
        PBR SURFACE VIEW
      </div>
    </div>
  );
}
