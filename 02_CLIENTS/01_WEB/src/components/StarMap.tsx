import React, { useRef, useMemo, useState, useCallback } from 'react';
import { Canvas, useFrame, useThree, ThreeEvent } from '@react-three/fiber';
import { Html, Stars as DreiStars, Line } from '@react-three/drei';
import { useNavigate } from 'react-router-dom';
import * as THREE from 'three';
import type { StarSystemFull } from '../types/api';
import StarField from './StarField';
import Starlanes, { findKNearest, K_NEIGHBORS } from './Starlanes';
import CompanionBonds from './CompanionBonds';
import StarLabels from './StarLabels';
import CameraController from './CameraController';
import SearchBar from './SearchBar';
import SystemDetailPanel from './SystemDetailPanel';
import { getCommonName, getShortName } from '../utils/commonNames';

/* ── Helpers ───────────────────────────────────────── */

/** All Harvard spectral classes in standard order */
const SPECTRAL_CLASSES = ['O', 'B', 'A', 'F', 'G', 'K', 'M', 'L', 'T'] as const;

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

/* ── Sol marker (origin) – subtle reticle, not a sphere ── */

function Sol() {
  const ringRef = useRef<THREE.Mesh>(null!);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (ringRef.current) {
      ringRef.current.rotation.z = t * 0.2;
      (ringRef.current.material as THREE.MeshBasicMaterial).opacity =
        0.35 + 0.12 * Math.sin(t * 1.4);
    }
  });

  return (
    <group position={[0, 0, 0]}>
      {/* Thin rotating ring — "home" marker */}
      <mesh ref={ringRef} rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.18, 0.22, 32]} />
        <meshBasicMaterial color="#fbbf24" transparent opacity={0.35} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      {/* Crosshair tick-marks */}
      <Line points={[[-0.32, 0, 0], [-0.18, 0, 0]]} color="#fbbf24" lineWidth={1} transparent opacity={0.25} />
      <Line points={[[0.18, 0, 0], [0.32, 0, 0]]} color="#fbbf24" lineWidth={1} transparent opacity={0.25} />
      <Line points={[[0, 0, -0.32], [0, 0, -0.18]]} color="#fbbf24" lineWidth={1} transparent opacity={0.25} />
      <Line points={[[0, 0, 0.18], [0, 0, 0.32]]} color="#fbbf24" lineWidth={1} transparent opacity={0.25} />
      {/* Subtle warm point light */}
      <pointLight color="#fbbf24" intensity={0.3} distance={12} />
    </group>
  );
}

/* ── Grid plane (fades with camera height) ────────── */

function GalacticGrid() {
  const groupRef = useRef<THREE.Group>(null!);
  const { camera } = useThree();

  useFrame(() => {
    if (!groupRef.current) return;
    // Fade grid opacity based on camera Y position (height above plane)
    // Near-plane: dim to reduce clutter; elevated: visible for orientation
    const h = Math.abs(camera.position.y);
    const opacity = THREE.MathUtils.clamp(h / 15, 0.08, 0.7);
    groupRef.current.traverse((child) => {
      if ((child as any).material) {
        (child as any).material.opacity = opacity;
        (child as any).material.transparent = true;
      }
    });
  });

  return (
    <group ref={groupRef}>
      <gridHelper args={[80, 40, '#0f2440', '#0a1525']} />
      <polarGridHelper
        args={[40, 12, 8, 64, '#0f2440', '#0f2440']}
        rotation={[Math.PI / 2, 0, 0]}
      />
    </group>
  );
}

/* ── Origin axis gizmo for spatial orientation ────── */

function AxisGizmo() {
  const AXIS_LEN = 3.5;
  return (
    <group>
      {/* X axis — Red */}
      <Line points={[[0, 0, 0], [AXIS_LEN, 0, 0]]} color="#ef4444" lineWidth={1.5} transparent opacity={0.55} />
      <Html position={[AXIS_LEN + 0.3, 0, 0]} center style={{ pointerEvents: 'none' }}>
        <span style={{ color: '#ef4444', fontSize: 9, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>X</span>
      </Html>
      {/* Y axis — Green */}
      <Line points={[[0, 0, 0], [0, AXIS_LEN, 0]]} color="#22c55e" lineWidth={1.5} transparent opacity={0.55} />
      <Html position={[0, AXIS_LEN + 0.3, 0]} center style={{ pointerEvents: 'none' }}>
        <span style={{ color: '#22c55e', fontSize: 9, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>Y</span>
      </Html>
      {/* Z axis — Blue */}
      <Line points={[[0, 0, 0], [0, 0, AXIS_LEN]]} color="#3b82f6" lineWidth={1.5} transparent opacity={0.55} />
      <Html position={[0, 0, AXIS_LEN + 0.3]} center style={{ pointerEvents: 'none' }}>
        <span style={{ color: '#3b82f6', fontSize: 9, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>Z</span>
      </Html>
    </group>
  );
}

/* ── Distance shells ──────────────────────────────── */

/* ── Semi-transparent galactic reference plane at y=0 ── */

function GalacticPlane() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, 0]}>
      <planeGeometry args={[200, 200]} />
      <meshBasicMaterial
        color="#0e2244"
        transparent
        opacity={0.12}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  );
}

/* ── Star Footprints — thin vertical lines from stars to XY plane ── */

function StarFootprints({ systems, selectedId }: { systems: StarSystemFull[]; selectedId: string | null }) {
  const lineRef = useRef<THREE.LineSegments>(null!);

  const { geometry } = useMemo(() => {
    const positions: number[] = [];
    const cols: number[] = [];
    for (const s of systems) {
      if (Math.abs(s.y) < 0.01) continue; // skip stars already on the plane
      // line from star position to its XY footprint
      positions.push(s.x, s.y, s.z);
      positions.push(s.x, 0, s.z);
      // subtle color — use spectral hint or neutral
      const isSelected = s.main_id === selectedId;
      const alpha = isSelected ? 0.45 : 0.10;
      cols.push(0.14, 0.56, 0.69, alpha); // cyan-ish
      cols.push(0.14, 0.56, 0.69, 0.0);  // fade at plane
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 4));
    return { geometry: geo };
  }, [systems, selectedId]);

  return (
    <lineSegments ref={lineRef} geometry={geometry}>
      <lineBasicMaterial vertexColors transparent depthWrite={false} opacity={0.6} />
    </lineSegments>
  );
}

/* ── Plane Footprint Dots — small dot on XY plane below/above each star ── */

function FootprintDots({ systems }: { systems: StarSystemFull[] }) {
  const geo = useMemo(() => {
    const positions: number[] = [];
    for (const s of systems) {
      if (Math.abs(s.y) < 0.01) continue;
      positions.push(s.x, 0.001, s.z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return g;
  }, [systems]);

  return (
    <points geometry={geo}>
      <pointsMaterial color="#22d3ee" size={0.08} transparent opacity={0.18} depthWrite={false} sizeAttenuation />
    </points>
  );
}

/* ── Camera position tracker (reports position to parent) ── */

function CameraTracker({ onUpdate }: { onUpdate: (pos: THREE.Vector3) => void }) {
  const { camera } = useThree();
  const lastRef = useRef(new THREE.Vector3());
  const frameRef = useRef(0);

  useFrame(() => {
    frameRef.current++;
    if (frameRef.current % 8 === 0) {
      if (lastRef.current.distanceToSquared(camera.position) > 0.1) {
        lastRef.current.copy(camera.position);
        onUpdate(camera.position.clone());
      }
    }
  });

  return null;
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

/* ══════════════════════════════════════════════════════
   ██  Main StarMap component
   ══════════════════════════════════════════════════════ */

interface StarMapProps {
  systems: StarSystemFull[];
  loading?: boolean;
  source?: string;
}

/** Hover state stored in a ref for no-rerender tooltip positioning */
interface HoverState {
  system: StarSystemFull | null;
  x: number;
  y: number;
}

export default function StarMap({ systems, loading, source }: StarMapProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [cameraPos, setCameraPos] = useState<THREE.Vector3>(new THREE.Vector3(3, 2, 3));
  const [visitedHistory, setVisitedHistory] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<'perspective' | 'topdown'>('perspective');

  /* ── Spectral-class filter ────────────────────────── */
  const [hiddenClasses, setHiddenClasses] = useState<Set<string>>(new Set());

  const filteredSystems = useMemo(() => {
    if (hiddenClasses.size === 0) return systems;
    return systems.filter((s) => {
      const cls = s.spectral_class?.[0]?.toUpperCase() || '?';
      return !hiddenClasses.has(cls);
    });
  }, [systems, hiddenClasses]);

  const toggleClass = useCallback((cls: string) => {
    setHiddenClasses((prev) => {
      const next = new Set(prev);
      if (next.has(cls)) next.delete(cls);
      else next.add(cls);
      return next;
    });
  }, []);

  /* ── Hover state: use state for tooltip rendering ── */
  const [hover, setHover] = useState<HoverState>({ system: null, x: 0, y: 0 });

  const handleSelect = useCallback((id: string | null) => {
    setSelectedId(id);
    if (id) setVisitedHistory((prev) => [...prev.filter((v) => v !== id).slice(-19), id]);
  }, []);

  const handleNavigate = useCallback((id: string) => {
    setSelectedId(id);
    setVisitedHistory((prev) => [...prev.filter((v) => v !== id).slice(-19), id]);
  }, []);

  const handleHover = useCallback(
    (system: StarSystemFull | null, event?: ThreeEvent<PointerEvent>) => {
      if (!system) {
        setHover({ system: null, x: 0, y: 0 });
        return;
      }
      if (event) {
        const { clientX, clientY } = event.nativeEvent;
        setHover({ system, x: clientX, y: clientY });
      }
    },
    [],
  );

  /* ── Global keyboard shortcuts ──────────────────── */
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
      if (e.key === 'Escape') {
        if (searchOpen) setSearchOpen(false);
        else setSelectedId(null);
      }
      // Tab: cycle to next nearest neighbor of selected star
      if (e.key === 'Tab' && selectedId && !searchOpen) {
        e.preventDefault();
        const sel = filteredSystems.find((s) => s.main_id === selectedId);
        if (sel) {
          const neighbors = findKNearest(sel, filteredSystems, K_NEIGHBORS);
          if (neighbors.length > 0) {
            const idx = e.shiftKey ? neighbors.length - 1 : 0;
            handleNavigate(neighbors[idx].main_id);
          }
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [searchOpen, selectedId, filteredSystems, handleNavigate]);

  /* ── Derived stats for HUD ───────────────────────── */
  const stats = useMemo(() => {
    const observed = filteredSystems.filter((s) => s.confidence === 'observed').length;
    const binaries = filteredSystems.filter((s) => s.multiplicity >= 2).length;
    const withPlanets = filteredSystems.filter((s) => s.planet_count > 0).length;
    const byClass: Record<string, number> = {};
    for (const s of systems) {
      const cls = s.spectral_class?.[0]?.toUpperCase() || '?';
      byClass[cls] = (byClass[cls] || 0) + 1;
    }
    return { observed, inferred: filteredSystems.length - observed, binaries, withPlanets, byClass };
  }, [systems, filteredSystems]);

  const selectedSystem = useMemo(
    () => systems.find((s) => s.main_id === selectedId) ?? null,
    [systems, selectedId],
  );

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Canvas
        camera={{ position: [3, 2, 3], fov: 55, near: 0.1, far: 1000 }}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}
        onPointerMissed={() => setSelectedId(null)}
        raycaster={{ params: { Points: { threshold: 0.4 } } as any }}
      >
        {/* Cosmic background */}
        <color attach="background" args={['#060a12']} />
        <fog attach="fog" args={['#060a12', 80, 180]} />

        {/* Milky Way: dimmed distant particle cloud for atmosphere */}
        <DreiStars radius={300} depth={150} count={6000} factor={1.8} saturation={0.1} fade speed={0.15} />
        {/* Nearer faint dust */}
        <DreiStars radius={120} depth={60} count={1500} factor={0.6} saturation={0} fade speed={0.3} />

        <ambientLight intensity={0.05} />

        {/* Spatial reference */}
        <GalacticGrid />
        <GalacticPlane />
        <AxisGizmo />
        <DistanceShell radius={10} label="10 ly" />
        <DistanceShell radius={25} label="25 ly" />
        <DistanceShell radius={50} label="50 ly" />
        <DistanceShell radius={100} label="100 ly" />

        {/* Sol beacon at origin */}
        <Sol />

        {/* ── Star footprints on galactic plane ─────── */}
        <StarFootprints systems={filteredSystems} selectedId={selectedId} />
        <FootprintDots systems={filteredSystems} />

        {/* ── GPU-instanced star field ──────────────── */}
        <StarField
          systems={filteredSystems}
          onSelect={handleSelect}
          selectedId={selectedId}
          onHover={handleHover}
        />

        {/* ── Starlanes to nearest neighbors ────────── */}
        <Starlanes
          systems={filteredSystems}
          selectedId={selectedId}
          onNavigate={handleNavigate}
        />

        {/* ── Companion bonds (binary tethers) ──────── */}
        <CompanionBonds systems={filteredSystems} selectedId={selectedId} />

        {/* ── Persistent star name labels ───────────── */}
        <StarLabels systems={filteredSystems} selectedId={selectedId} onNavigate={handleNavigate} />

        {/* ── Camera position tracker ───────────────── */}
        <CameraTracker onUpdate={setCameraPos} />

        {/* ── Animated camera with fly-to ───────────── */}
        <CameraController target={selectedSystem} viewMode={viewMode} />
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

      {/* ── Hover tooltip ───────────────────────────── */}
      {hover.system && (
        <HoverTooltip system={hover.system} x={hover.x} y={hover.y} selectedSystem={selectedSystem} />
      )}

      {/* ── Search bar trigger (top center) ─────────── */}
      <div
        style={{
          position: 'absolute',
          top: 12,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 20,
        }}
      >
        <button
          onClick={() => setSearchOpen(true)}
          style={{
            background: 'rgba(17,24,39,0.80)',
            border: '1px solid #374151',
            borderRadius: 8,
            padding: '6px 18px',
            color: '#6b7280',
            fontSize: 13,
            fontFamily: 'Inter, sans-serif',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            transition: 'border-color 0.2s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#22d3ee')}
          onMouseLeave={(e) => (e.currentTarget.style.borderColor = '#374151')}
        >
          <span style={{ color: '#22d3ee' }}>⌖</span>
          Search stars…
          <kbd
            style={{
              fontSize: 10,
              padding: '1px 5px',
              border: '1px solid #374151',
              borderRadius: 3,
              fontFamily: "'JetBrains Mono', monospace",
              color: '#4b5563',
              marginLeft: 4,
            }}
          >
            Ctrl+K
          </kbd>
        </button>
      </div>

      {/* ── Search overlay ──────────────────────────── */}
      <SearchBar
        systems={systems}
        isOpen={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelect={(id) => {
          setSelectedId(id);
          setSearchOpen(false);
        }}
      />

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
        <div>
          {filteredSystems.length.toLocaleString()} systems
          {hiddenClasses.size > 0 && (
            <span style={{ color: '#6b7280' }}> / {systems.length.toLocaleString()} total</span>
          )}
        </div>
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

      {/* ── HUD: legend + spectral filter (top-left) ── */}
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
        <div style={{ marginTop: 3 }}>
          <span style={{ color: '#f59e0b' }}>━━</span> Close binary &nbsp;
          <span style={{ color: '#22d3ee' }}>╌╌</span> Wide companion
        </div>
        <div style={{ marginTop: 3, fontStyle: 'italic' }}>
          Dim = inferred · Bright = observed
        </div>

        {/* Spectral filter toggles */}
        <div style={{ marginTop: 8, borderTop: '1px solid #1f2937', paddingTop: 6 }}>
          <div style={{ fontWeight: 600, color: '#9ca3af', marginBottom: 4 }}>Filter by class</div>
          <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
            {SPECTRAL_CLASSES.map((cls) => {
              const count = stats.byClass[cls] ?? 0;
              const hidden = hiddenClasses.has(cls);
              return (
                <button
                  key={cls}
                  onClick={() => toggleClass(cls)}
                  style={{
                    background: hidden ? 'rgba(107,114,128,0.15)' : spectralBadgeColor(cls),
                    color: hidden ? '#4b5563' : '#111',
                    border: hidden ? '1px solid #374151' : '1px solid transparent',
                    borderRadius: 3,
                    padding: '1px 5px',
                    fontSize: 9,
                    fontWeight: 700,
                    cursor: 'pointer',
                    opacity: hidden ? 0.5 : 1,
                    textDecoration: hidden ? 'line-through' : 'none',
                    transition: 'all 0.15s',
                  }}
                  title={`${cls}: ${count} systems${hidden ? ' (hidden)' : ''}`}
                >
                  {cls}:{count}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Camera position HUD (bottom-right) ──────── */}
      <div
        style={{
          position: 'absolute',
          bottom: 12,
          right: 12,
          background: 'rgba(17,24,39,0.80)',
          border: '1px solid #374151',
          borderRadius: 8,
          padding: '8px 12px',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 10,
          color: '#6b7280',
          zIndex: 10,
          minWidth: 140,
        }}
      >
        <div style={{ color: '#9ca3af', fontWeight: 600, fontSize: 9, marginBottom: 4, letterSpacing: 0.5 }}>
          CAMERA
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '12px 1fr', gap: 1 }}>
          <span style={{ color: '#ef4444' }}>x</span>
          <span>{cameraPos.x.toFixed(1)} pc</span>
          <span style={{ color: '#22c55e' }}>y</span>
          <span>{cameraPos.y.toFixed(1)} pc</span>
          <span style={{ color: '#3b82f6' }}>z</span>
          <span>{cameraPos.z.toFixed(1)} pc</span>
        </div>
        <div style={{ marginTop: 4, borderTop: '1px solid #1f2937', paddingTop: 3 }}>
          <span style={{ color: '#fbbf24' }}>⊙</span>{' '}
          {(cameraPos.length() * 3.26156).toFixed(1)} ly from Sol
        </div>
        {/* Keyboard hints */}
        <div style={{ marginTop: 4, borderTop: '1px solid #1f2937', paddingTop: 3, color: '#4b5563', fontSize: 9 }}>
          Tab hop · Esc deselect · Ctrl+K search
        </div>
        {/* View mode toggle */}
        <div style={{ marginTop: 4, borderTop: '1px solid #1f2937', paddingTop: 4, display: 'flex', gap: 4 }}>
          <button
            onClick={() => setViewMode('perspective')}
            style={{
              flex: 1, background: viewMode === 'perspective' ? 'rgba(34,211,238,0.15)' : 'transparent',
              border: viewMode === 'perspective' ? '1px solid #22d3ee' : '1px solid #374151',
              borderRadius: 4, padding: '3px 0', color: viewMode === 'perspective' ? '#22d3ee' : '#4b5563',
              fontSize: 9, fontWeight: 600, cursor: 'pointer', fontFamily: "'JetBrains Mono', monospace",
            }}
            title="3D perspective view"
          >
            3D
          </button>
          <button
            onClick={() => setViewMode('topdown')}
            style={{
              flex: 1, background: viewMode === 'topdown' ? 'rgba(34,211,238,0.15)' : 'transparent',
              border: viewMode === 'topdown' ? '1px solid #22d3ee' : '1px solid #374151',
              borderRadius: 4, padding: '3px 0', color: viewMode === 'topdown' ? '#22d3ee' : '#4b5563',
              fontSize: 9, fontWeight: 600, cursor: 'pointer', fontFamily: "'JetBrains Mono', monospace",
            }}
            title="Top-down galactic plane view"
          >
            XY ⊙
          </button>
        </div>
      </div>

      {/* ── Visited history trail (bottom-center) ───── */}
      {visitedHistory.length > 1 && (
        <div
          style={{
            position: 'absolute',
            bottom: 12,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(17,24,39,0.75)',
            border: '1px solid #374151',
            borderRadius: 8,
            padding: '5px 10px',
            zIndex: 10,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            maxWidth: '50vw',
            overflow: 'hidden',
          }}
        >
          <span style={{ color: '#4b5563', fontSize: 9, fontFamily: 'Inter, sans-serif', flexShrink: 0 }}>Trail:</span>
          {visitedHistory.slice(-8).map((id, i, arr) => (
            <React.Fragment key={id}>
              <span
                onClick={() => handleNavigate(id)}
                style={{
                  color: i === arr.length - 1 ? '#22d3ee' : '#6b7280',
                  fontSize: 9,
                  fontFamily: "'JetBrains Mono', monospace",
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
                {getShortName(id)}
              </span>
              {i < arr.length - 1 && <span style={{ color: '#374151', fontSize: 8 }}>→</span>}
            </React.Fragment>
          ))}
        </div>
      )}

      {/* ── Selected star detail panel ──────────────── */}
      {selectedSystem && (
        <SelectedStarPanel
          system={selectedSystem}
          allSystems={systems}
          onClose={() => setSelectedId(null)}
          onNavigate={handleNavigate}
        />
      )}
    </div>
  );
}

/* ── Hover Tooltip ─────────────────────────────────── */

function HoverTooltip({
  system,
  x,
  y,
  selectedSystem,
}: {
  system: StarSystemFull;
  x: number;
  y: number;
  selectedSystem: StarSystemFull | null;
}) {
  const cls = system.spectral_class?.[0]?.toUpperCase() || '?';
  const commonName = getCommonName(system.main_id);
  const showCommonName = commonName !== system.main_id;

  // Distance from currently selected star
  let distFromSelected: number | null = null;
  if (selectedSystem && selectedSystem.main_id !== system.main_id) {
    const dx = system.x - selectedSystem.x;
    const dy = system.y - selectedSystem.y;
    const dz = system.z - selectedSystem.z;
    distFromSelected = Math.sqrt(dx * dx + dy * dy + dz * dz) * 3.26156;
  }

  return (
    <div
      style={{
        position: 'fixed',
        left: x + 14,
        top: y - 10,
        pointerEvents: 'none',
        zIndex: 200,
        background: 'rgba(17,24,39,0.94)',
        border: '1px solid #374151',
        borderRadius: 6,
        padding: '6px 10px',
        fontFamily: 'Inter, sans-serif',
        fontSize: 11,
        color: '#e5e7eb',
        boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
        maxWidth: 280,
        whiteSpace: 'nowrap',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
        <span
          style={{
            background: spectralBadgeColor(system.spectral_class),
            color: '#111',
            borderRadius: 3,
            padding: '0px 5px',
            fontSize: 9,
            fontWeight: 700,
          }}
        >
          {cls}
        </span>
        <span style={{ fontWeight: 600, fontSize: 12, color: '#f3f4f6' }}>
          {showCommonName ? commonName : system.main_id}
        </span>
      </div>
      {showCommonName && (
        <div style={{ color: '#6b7280', fontSize: 9, marginBottom: 2, fontFamily: "'JetBrains Mono', monospace" }}>
          {system.main_id}
        </div>
      )}
      <div style={{ color: '#9ca3af', fontSize: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <span>{system.distance_ly.toFixed(1)} ly from Sol</span>
        <span>{system.teff > 0 ? `${system.teff.toLocaleString()} K` : ''}</span>
        {system.planet_count > 0 && (
          <span style={{ color: '#22d3ee' }}>{system.planet_count} planet{system.planet_count > 1 ? 's' : ''}</span>
        )}
      </div>
      {distFromSelected != null && (
        <div style={{ color: '#fbbf24', fontSize: 10, marginTop: 2 }}>
          ↔ {distFromSelected.toFixed(1)} ly from selection
        </div>
      )}
      {system.system_group && (
        <div style={{ color: '#67e8f9', fontSize: 9, marginTop: 2 }}>
          System: {system.system_group}
        </div>
      )}
    </div>
  );
}

/* ── Rich Expandable Star Card ─────────────────────── */

function SelectedStarPanel({
  system,
  allSystems,
  onClose,
  onNavigate,
}: {
  system: StarSystemFull;
  allSystems: StarSystemFull[];
  onClose: () => void;
  onNavigate: (id: string) => void;
}) {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    system: true,
    planets: false,
    companions: true,
    neighbors: false,
    position: false,
  });

  const toggle = (key: string) =>
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));

  /* ── Nearest neighbors ──────────────────────────── */
  const neighbors = useMemo(
    () => findKNearest(system, allSystems, K_NEIGHBORS),
    [system, allSystems],
  );

  const commonName = getCommonName(system.main_id);
  const showCommonName = commonName !== system.main_id;
  const simbadUrl = `https://simbad.u-strasbg.fr/simbad/sim-basic?Ident=${encodeURIComponent(system.main_id)}`;

  const navigate = useNavigate();
  const handleFullscreen = useCallback(
    (mainId: string) => navigate(`/system/${encodeURIComponent(mainId)}`),
    [navigate],
  );

  return (
    <div
      style={{
        position: 'absolute',
        top: 12,
        right: 12,
        width: 320,
        background: 'rgba(17,24,39,0.96)',
        border: '1px solid #374151',
        borderRadius: 10,
        fontFamily: 'Inter, sans-serif',
        zIndex: 10,
        overflow: 'hidden',
        boxShadow: '0 8px 32px rgba(0,0,0,0.4), 0 0 20px rgba(34,211,238,0.05)',
      }}
    >
      {/* ── Header ──────────────────────────────────── */}
      <div
        style={{
          padding: '14px 16px 10px',
          borderBottom: '1px solid #1f2937',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
        }}
      >
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#f3f4f6', letterSpacing: 0.3 }}>
            {showCommonName ? commonName : system.main_id}
          </div>
          {showCommonName && (
            <div style={{ fontSize: 10, color: '#6b7280', fontFamily: "'JetBrains Mono', monospace", marginTop: 2 }}>
              {system.main_id}
            </div>
          )}
          <div style={{ marginTop: 6, display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>
            <span
              style={{
                background: spectralBadgeColor(system.spectral_class),
                color: '#111',
                borderRadius: 4,
                padding: '2px 8px',
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              {system.spectral_class || '?'}
            </span>
            {system.teff > 0 && (
              <span style={{ color: '#9ca3af', fontSize: 10 }}>
                {system.teff.toLocaleString()} K
              </span>
            )}
            {system.multiplicity >= 2 && (
              <span
                style={{
                  background: 'rgba(59,130,246,0.15)',
                  border: '1px solid #3b82f6',
                  color: '#93c5fd',
                  borderRadius: 4,
                  padding: '1px 6px',
                  fontSize: 9,
                  fontWeight: 600,
                }}
              >
                {multiplicityLabel(system.multiplicity)}
              </span>
            )}
            {system.planet_count > 0 && (
              <span
                style={{
                  background: 'rgba(34,211,238,0.12)',
                  border: '1px solid rgba(34,211,238,0.3)',
                  color: '#67e8f9',
                  borderRadius: 4,
                  padding: '1px 6px',
                  fontSize: 9,
                  fontWeight: 600,
                }}
              >
                {system.planet_count} planet{system.planet_count > 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: '#6b7280',
            cursor: 'pointer',
            fontSize: 16,
            padding: '0 2px',
          }}
        >
          ✕
        </button>
      </div>

      {/* ── Accordion sections ──────────────────────── */}
      <div style={{ maxHeight: 'calc(100vh - 160px)', overflowY: 'auto' }}>
        {/* System Properties */}
        <AccordionSection
          title="System Properties"
          icon="◈"
          expanded={expandedSections.system}
          onToggle={() => toggle('system')}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '8px 12px',
              fontSize: 12,
              color: '#d1d5db',
            }}
          >
            <DataCell label="Distance" value={`${system.distance_ly.toFixed(2)} ly`} />
            <DataCell label="Luminosity" value={`${system.luminosity.toFixed(4)} L☉`} />
            <DataCell
              label="Confidence"
              value={system.confidence}
              valueColor={system.confidence === 'observed' ? '#10b981' : '#3b82f6'}
            />
            <DataCell label="Multiplicity" value={multiplicityLabel(system.multiplicity)} />
          </div>
        </AccordionSection>

        {/* Orbits & Worlds (loaded on demand — includes multi-star tabs) */}
        <SystemDetailPanel
          mainId={system.main_id}
          expanded={expandedSections.planets}
          onToggle={() => toggle('planets')}
          onFullscreen={handleFullscreen}
        />

        {/* Companions / Binary System */}
        {system.companions && system.companions.length > 0 && (
          <AccordionSection
            title={`Companions (${system.companions.length})`}
            icon="⟐"
            expanded={expandedSections.companions}
            onToggle={() => toggle('companions')}
          >
            {system.system_group && (
              <div style={{ fontSize: 10, color: '#9ca3af', marginBottom: 6 }}>
                <span style={{ color: '#22d3ee', fontWeight: 600 }}>{system.system_group}</span>
                {system.group_hierarchy && (
                  <span style={{ marginLeft: 6, color: '#6b7280' }}>
                    {system.group_hierarchy}
                  </span>
                )}
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {system.companions.map((comp) => {
                const bondColor = comp.bond_type === 'close_binary' ? '#f59e0b' : '#22d3ee';
                const bondLabel = comp.bond_type === 'close_binary' ? 'Close binary' : 'Wide companion';
                const sepLabel = comp.separation_au >= 1000
                  ? `${(comp.separation_au / 1000).toFixed(1)} kAU`
                  : `${comp.separation_au.toFixed(1)} AU`;
                // Find companion in allSystems for navigation
                const found = allSystems.find((s) => s.main_id === comp.name);
                return (
                  <div
                    key={comp.name}
                    onClick={() => found && onNavigate(found.main_id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '5px 6px',
                      borderRadius: 4,
                      cursor: found ? 'pointer' : 'default',
                      transition: 'background 0.15s',
                      fontSize: 11,
                      borderLeft: `2px solid ${bondColor}`,
                    }}
                    onMouseEnter={(e) => found && (e.currentTarget.style.background = 'rgba(34,211,238,0.08)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ color: '#d1d5db', fontFamily: "'JetBrains Mono', monospace" }}>
                        {getShortName(comp.name)}
                      </div>
                      <div style={{ color: '#6b7280', fontSize: 9, marginTop: 1 }}>
                        {bondLabel} · {sepLabel}
                      </div>
                    </div>
                    {found && <span style={{ color: '#4b5563', fontSize: 10 }}>→</span>}
                  </div>
                );
              })}
            </div>
          </AccordionSection>
        )}

        {/* Nearest Neighbors */}
        <AccordionSection
          title={`Nearest Neighbors (${K_NEIGHBORS})`}
          icon="⟁"
          expanded={expandedSections.neighbors}
          onToggle={() => toggle('neighbors')}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {neighbors.map((nb) => {
              const dx = nb.x - system.x;
              const dy = nb.y - system.y;
              const dz = nb.z - system.z;
              const distPc = Math.sqrt(dx * dx + dy * dy + dz * dz);
              const distLy = distPc * 3.26156;
              const cls = nb.spectral_class?.[0]?.toUpperCase() || '?';
              return (
                <div
                  key={nb.main_id}
                  onClick={() => onNavigate(nb.main_id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '4px 6px',
                    borderRadius: 4,
                    cursor: 'pointer',
                    transition: 'background 0.15s',
                    fontSize: 11,
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(34,211,238,0.08)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <span
                    style={{
                      background: spectralBadgeColor(nb.spectral_class),
                      color: '#111',
                      borderRadius: 3,
                      padding: '0px 4px',
                      fontSize: 8,
                      fontWeight: 700,
                      minWidth: 16,
                      textAlign: 'center',
                    }}
                  >
                    {cls}
                  </span>
                  <span style={{ flex: 1, color: '#d1d5db', fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>
                    {getShortName(nb.main_id)}
                  </span>
                  <span style={{ color: '#6b7280', fontSize: 10 }}>
                    {distLy.toFixed(1)} ly
                  </span>
                  <span style={{ color: '#4b5563', fontSize: 10 }}>→</span>
                </div>
              );
            })}
          </div>
        </AccordionSection>

        {/* Position */}
        <AccordionSection
          title="Galactic Position"
          icon="◎"
          expanded={expandedSections.position}
          onToggle={() => toggle('position')}
        >
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: '#9ca3af' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '30px 1fr', gap: 2 }}>
              <span style={{ color: '#ef4444' }}>X</span>
              <span>{system.x.toFixed(4)} pc</span>
              <span style={{ color: '#22c55e' }}>Y</span>
              <span>{system.y.toFixed(4)} pc</span>
              <span style={{ color: '#3b82f6' }}>Z</span>
              <span>{system.z.toFixed(4)} pc</span>
            </div>
          </div>
        </AccordionSection>

        {/* SIMBAD link */}
        <div
          style={{
            padding: '10px 16px',
            borderTop: '1px solid #1f2937',
            display: 'flex',
            justifyContent: 'center',
          }}
        >
          <a
            href={simbadUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: '#22d3ee',
              fontSize: 11,
              textDecoration: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 12px',
              border: '1px solid rgba(34,211,238,0.2)',
              borderRadius: 4,
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(34,211,238,0.08)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            ⊕ View on SIMBAD
          </a>
        </div>
      </div>
    </div>
  );
}

/* ── Accordion Section ─────────────────────────────── */

function AccordionSection({
  title,
  icon,
  expanded,
  onToggle,
  children,
}: {
  title: string;
  icon: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div style={{ borderTop: '1px solid #1f2937' }}>
      <button
        onClick={onToggle}
        style={{
          width: '100%',
          background: 'none',
          border: 'none',
          padding: '8px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          cursor: 'pointer',
          color: '#9ca3af',
          fontSize: 11,
          fontWeight: 600,
          fontFamily: 'Inter, sans-serif',
          textAlign: 'left',
        }}
      >
        <span style={{ color: '#22d3ee', fontSize: 12 }}>{icon}</span>
        <span style={{ flex: 1 }}>{title}</span>
        <span
          style={{
            fontSize: 10,
            transition: 'transform 0.2s',
            transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
          }}
        >
          ▸
        </span>
      </button>
      {expanded && (
        <div style={{ padding: '0 16px 12px' }}>{children}</div>
      )}
    </div>
  );
}

/* ── Data cell for the properties grid ─────────────── */

function DataCell({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div>
      <div style={{ color: '#4b5563', fontSize: 9, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5 }}>
        {label}
      </div>
      <div style={{ color: valueColor ?? '#d1d5db', marginTop: 1 }}>{value}</div>
    </div>
  );
}
