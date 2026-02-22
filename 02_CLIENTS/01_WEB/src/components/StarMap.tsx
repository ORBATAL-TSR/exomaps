import React, { useRef, useMemo, useState, useCallback } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Html, Stars as DreiStars, Line } from '@react-three/drei';
import * as THREE from 'three';
import type { StarSystemFull } from '../types/api';
import StarField from './StarField';

/* ── Helpers ───────────────────────────────────────── */

function lyToPc(ly: number): number {
  return ly / 3.26156;
}

/** Harvard spectral class → hex color for HUD badges */
const SPECTRAL_HEX: Record<string, string> = {
  O: '#9bb0ff', B: '#aabfff', A: '#cad7ff', F: '#f8f7ff',
  G: '#fff4ea', K: '#ffd2a1', M: '#ffb56c', L: '#ff8c42', T: '#ff6b35',
};

function spectralBadgeColor(cls: string): string {
  return SPECTRAL_HEX[cls?.[0]?.toUpperCase()] ?? '#6b7280';
}

/** Multiplicity → human label */
function multiplicityLabel(n: number): string {
  if (n <= 1) return 'Single';
  if (n === 2) return 'Binary';
  if (n === 3) return 'Trinary';
  return `${n}-body`;
}

/* ── Sol marker (origin) ──────────────────────────── */

function Sol() {
  const meshRef = useRef<THREE.Mesh>(null!);
  const glowRef = useRef<THREE.Mesh>(null!);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (meshRef.current) {
      meshRef.current.scale.setScalar(1 + 0.08 * Math.sin(t * 2));
    }
    if (glowRef.current) {
      glowRef.current.scale.setScalar(2.2 + 0.3 * Math.sin(t * 1.5));
      (glowRef.current.material as THREE.MeshBasicMaterial).opacity =
        0.12 + 0.04 * Math.sin(t * 1.8);
    }
  });

  return (
    <group position={[0, 0, 0]}>
      {/* Inner core */}
      <mesh ref={meshRef}>
        <sphereGeometry args={[0.35, 24, 24]} />
        <meshBasicMaterial color="#fbbf24" />
      </mesh>
      {/* Outer glow halo */}
      <mesh ref={glowRef}>
        <sphereGeometry args={[0.35, 24, 24]} />
        <meshBasicMaterial color="#fbbf24" transparent opacity={0.12} />
      </mesh>
      <pointLight color="#fbbf24" intensity={0.6} distance={20} />
      <Html position={[0, 0.7, 0]} center style={{ pointerEvents: 'none' }}>
        <div
          style={{
            color: '#fbbf24',
            fontSize: 13,
            fontWeight: 700,
            fontFamily: 'Inter, sans-serif',
            textShadow: '0 0 8px rgba(251,191,36,0.5)',
          }}
        >
          SOL
        </div>
      </Html>
    </group>
  );
}

/* ── Grid plane ───────────────────────────────────── */

function GalacticGrid() {
  return (
    <group>
      <gridHelper args={[80, 40, '#1e3a5f', '#111827']} />
      <polarGridHelper
        args={[40, 12, 8, 64, '#1e3a5f', '#1e3a5f']}
        rotation={[Math.PI / 2, 0, 0]}
      />
    </group>
  );
}

/* ── Distance shells ──────────────────────────────── */

function DistanceShell({ radius, label }: { radius: number; label: string }) {
  const points = useMemo(() => {
    const pts: [number, number, number][] = [];
    const segments = 64;
    for (let i = 0; i <= segments; i++) {
      const theta = (i / segments) * Math.PI * 2;
      pts.push([
        Math.cos(theta) * lyToPc(radius),
        0,
        Math.sin(theta) * lyToPc(radius),
      ]);
    }
    return pts;
  }, [radius]);

  return (
    <group>
      <Line points={points} color="#334155" transparent opacity={0.4} lineWidth={1} />
      <Html
        position={[lyToPc(radius) + 0.5, 0, 0]}
        center
        style={{ pointerEvents: 'none' }}
      >
        <span style={{ color: '#4b5563', fontSize: 10, fontFamily: 'Inter, sans-serif' }}>
          {label}
        </span>
      </Html>
    </group>
  );
}

/* ── Camera controller ────────────────────────────── */

function CameraRig() {
  return (
    <OrbitControls
      enableDamping
      dampingFactor={0.12}
      minDistance={2}
      maxDistance={200}
      rotateSpeed={0.6}
      zoomSpeed={0.8}
    />
  );
}

/* ══════════════════════════════════════════════════════
   ██  Main StarMap component
   ══════════════════════════════════════════════════════ */

interface StarMapProps {
  systems: StarSystemFull[];
  loading?: boolean;
  source?: string;
}

export default function StarMap({ systems, loading, source }: StarMapProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleSelect = useCallback((id: string | null) => {
    setSelectedId(id);
  }, []);

  /* ── Derived stats for HUD ───────────────────────── */
  const stats = useMemo(() => {
    const observed = systems.filter((s) => s.confidence === 'observed').length;
    const binaries = systems.filter((s) => s.multiplicity >= 2).length;
    const withPlanets = systems.filter((s) => s.planet_count > 0).length;
    // Count by spectral class
    const byClass: Record<string, number> = {};
    for (const s of systems) {
      const cls = s.spectral_class?.[0]?.toUpperCase() || '?';
      byClass[cls] = (byClass[cls] || 0) + 1;
    }
    return { observed, inferred: systems.length - observed, binaries, withPlanets, byClass };
  }, [systems]);

  const selectedSystem = useMemo(
    () => systems.find((s) => s.main_id === selectedId) ?? null,
    [systems, selectedId],
  );

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Canvas
        camera={{ position: [15, 10, 15], fov: 55, near: 0.1, far: 1000 }}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}
        onPointerMissed={() => setSelectedId(null)}
      >
        {/* Cosmic background */}
        <color attach="background" args={['#060a12']} />
        <fog attach="fog" args={['#060a12', 80, 180]} />

        {/* Decorative background stars */}
        <DreiStars radius={200} depth={100} count={4000} factor={2} saturation={0} fade speed={0.4} />

        <ambientLight intensity={0.05} />

        {/* Spatial reference */}
        <GalacticGrid />
        <DistanceShell radius={10} label="10 ly" />
        <DistanceShell radius={25} label="25 ly" />
        <DistanceShell radius={50} label="50 ly" />
        <DistanceShell radius={100} label="100 ly" />

        {/* Sol beacon at origin */}
        <Sol />

        {/* ── GPU-instanced star field ──────────────── */}
        <StarField
          systems={systems}
          onSelect={handleSelect}
          selectedId={selectedId}
        />

        <CameraRig />
      </Canvas>

      {/* ── Loading overlay ─────────────────────────── */}
      {loading && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(6,10,18,0.85)',
            color: '#9ca3af',
            fontSize: 14,
            fontFamily: 'Inter, sans-serif',
            zIndex: 10,
          }}
        >
          <div style={{ textAlign: 'center' }}>
            <div style={{ marginBottom: 8, fontSize: 18 }}>✦</div>
            Loading star systems…
          </div>
        </div>
      )}

      {/* ── HUD: bottom-left census ─────────────────── */}
      <div
        style={{
          position: 'absolute',
          bottom: 12,
          left: 12,
          background: 'rgba(17,24,39,0.88)',
          border: '1px solid #374151',
          borderRadius: 8,
          padding: '10px 14px',
          fontSize: 11,
          color: '#9ca3af',
          fontFamily: 'Inter, sans-serif',
          zIndex: 10,
          minWidth: 180,
        }}
      >
        <div style={{ color: '#f3f4f6', fontWeight: 600, marginBottom: 6, fontSize: 12 }}>
          ✦ Stellar Census
        </div>
        <div>{systems.length.toLocaleString()} systems loaded</div>
        <div>
          {stats.observed} observed · {stats.inferred} inferred
        </div>
        <div>{stats.binaries} binary/multiple · {stats.withPlanets} with planets</div>
        {source && (
          <div style={{ marginTop: 4, fontSize: 10, color: '#6b7280' }}>
            source: {source}
          </div>
        )}
        {/* Spectral class mini-bar */}
        <div style={{ display: 'flex', gap: 3, marginTop: 6, flexWrap: 'wrap' }}>
          {Object.entries(stats.byClass)
            .sort(([a], [b]) => 'OBAFGKMLT'.indexOf(a) - 'OBAFGKMLT'.indexOf(b))
            .map(([cls, count]) => (
              <span
                key={cls}
                style={{
                  background: spectralBadgeColor(cls),
                  color: '#111',
                  borderRadius: 3,
                  padding: '1px 5px',
                  fontSize: 9,
                  fontWeight: 700,
                }}
              >
                {cls}:{count}
              </span>
            ))}
        </div>
      </div>

      {/* ── HUD: legend (top-left) ──────────────────── */}
      <div
        style={{
          position: 'absolute',
          top: 12,
          left: 12,
          background: 'rgba(17,24,39,0.80)',
          border: '1px solid #374151',
          borderRadius: 8,
          padding: '8px 12px',
          fontSize: 10,
          color: '#6b7280',
          fontFamily: 'Inter, sans-serif',
          zIndex: 10,
        }}
      >
        <div style={{ fontWeight: 600, color: '#9ca3af', marginBottom: 4 }}>Legend</div>
        <div>
          <span style={{ color: '#ff8c42' }}>●</span> M-type (cool) &nbsp;
          <span style={{ color: '#fff4ea' }}>●</span> G-type (Sol) &nbsp;
          <span style={{ color: '#9bb0ff' }}>●</span> O/B-type (hot)
        </div>
        <div style={{ marginTop: 3 }}>
          <span style={{ color: '#3b82f6' }}>◎</span> Binary ring &nbsp;
          <span style={{ color: '#10b981' }}>◎</span> Trinary ring
        </div>
        <div style={{ marginTop: 3, fontStyle: 'italic' }}>
          Dim = inferred · Bright = observed
        </div>
      </div>

      {/* ── Selected star detail panel ──────────────── */}
      {selectedSystem && (
        <SelectedStarPanel system={selectedSystem} onClose={() => setSelectedId(null)} />
      )}
    </div>
  );
}

/* ── Detail panel (StarSystemFull) ─────────────────── */

function SelectedStarPanel({
  system,
  onClose,
}: {
  system: StarSystemFull;
  onClose: () => void;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 12,
        right: 12,
        width: 300,
        background: 'rgba(17,24,39,0.94)',
        border: '1px solid #374151',
        borderRadius: 8,
        padding: 16,
        fontFamily: 'Inter, sans-serif',
        zIndex: 10,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#f3f4f6' }}>
          {system.main_id}
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: '#6b7280',
            cursor: 'pointer',
            fontSize: 16,
          }}
        >
          ✕
        </button>
      </div>

      {/* Spectral badge */}
      <div style={{ marginTop: 8, display: 'flex', gap: 6, alignItems: 'center' }}>
        <span
          style={{
            background: spectralBadgeColor(system.spectral_class),
            color: '#111',
            borderRadius: 4,
            padding: '2px 8px',
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          {system.spectral_class || '?'}
        </span>
        <span style={{ color: '#9ca3af', fontSize: 11 }}>
          {system.teff > 0 ? `${system.teff.toLocaleString()} K` : ''}
        </span>
        {system.multiplicity >= 2 && (
          <span
            style={{
              background: 'rgba(59,130,246,0.15)',
              border: '1px solid #3b82f6',
              color: '#93c5fd',
              borderRadius: 4,
              padding: '2px 6px',
              fontSize: 10,
              fontWeight: 600,
            }}
          >
            {multiplicityLabel(system.multiplicity)}
          </span>
        )}
      </div>

      {/* Data grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '8px 16px',
          marginTop: 12,
          fontSize: 12,
          color: '#d1d5db',
        }}
      >
        <div>
          <div style={{ color: '#6b7280', fontSize: 10, textTransform: 'uppercase' }}>Distance</div>
          {system.distance_ly.toFixed(2)} ly
        </div>
        <div>
          <div style={{ color: '#6b7280', fontSize: 10, textTransform: 'uppercase' }}>Luminosity</div>
          {system.luminosity.toFixed(3)} L☉
        </div>
        <div>
          <div style={{ color: '#6b7280', fontSize: 10, textTransform: 'uppercase' }}>Confidence</div>
          <span style={{ color: system.confidence === 'observed' ? '#10b981' : '#3b82f6' }}>
            {system.confidence}
          </span>
        </div>
        <div>
          <div style={{ color: '#6b7280', fontSize: 10, textTransform: 'uppercase' }}>Planets</div>
          {system.planet_count > 0 ? system.planet_count : '—'}
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <div style={{ color: '#6b7280', fontSize: 10, textTransform: 'uppercase' }}>
            Position (pc)
          </div>
          x={system.x.toFixed(2)}, y={system.y.toFixed(2)}, z={system.z.toFixed(2)}
        </div>
      </div>
    </div>
  );
}
