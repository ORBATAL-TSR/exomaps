/**
 * DesktopLayout v2 — Full-screen star map with floating overlays.
 *
 * Layout (nothing blocks the stars):
 *   top-left     Hover tooltip (ephemeral, star hover)
 *   top-right    Search pill + dropdown list
 *   left drawer  Campaign panel (slide-in, triggered from HUD)
 *   bottom-right Selected system card (slide-up on click)
 *   bottom strip HUD — system count · campaign · version
 *   top-right    GPU generation queue (when active)
 */

import { useState, useCallback, useEffect, useMemo, useRef, Suspense } from 'react';
import { useFrame } from '@react-three/fiber';
import { View, OrbitControls, Stars, PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';
import type { TauriGPUHook } from '../hooks/useTauriGPU';
import { ErrorBoundary } from './ErrorBoundary';
import { StarField, type StarSystem } from './StarField';
import { SolMarker } from './SolMarker';
import { DistanceRings } from './DistanceRings';
import { SystemListPanel } from './SystemListPanel';
import { PlanetGenCard } from './PlanetGenCard';
import { CampaignPanel } from './CampaignPanel';
import { useCampaign } from '../hooks/useCampaign';

import { useSystemsList } from '../hooks/useSystemsList';

interface Props {
  gpu: TauriGPUHook;
  onSystemFocus: (mainId: string, meta?: { name: string; starClass?: string }) => void;
  /** When false the Canvas pauses rendering (frameloop="never") while SFV is active. */
  active?: boolean;
}

/** Spectral class → color hex */
const SPECTRAL_HEX: Record<string, string> = {
  O: '#9bb0ff', B: '#aabfff', A: '#cad7ff', F: '#f8f7ff',
  G: '#fff4ea', K: '#ffd2a1', M: '#ffb56c', L: '#ff8c42', T: '#ff6b35',
};

/* ━━ BinaryLanes ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Animated shimmering lines between wide companion star pairs.
 */
const BINARY_LANE_VERT = /* glsl */`
  attribute float aT;
  varying float vT;
  void main() {
    vT = aT;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const BINARY_LANE_FRAG = /* glsl */`
  uniform float uTime;
  varying float vT;
  void main() {
    float edgeFade = smoothstep(0.0, 0.14, vT) * smoothstep(1.0, 0.86, vT);
    float wave = 0.5 + 0.5 * sin(vT * 14.0 - uTime * 3.8);
    float alpha = edgeFade * (0.22 + wave * 0.18);
    vec3 col = mix(vec3(1.00, 0.88, 0.52), vec3(0.62, 0.80, 1.00), vT);
    gl_FragColor = vec4(col, alpha);
  }
`;

function BinaryLanes({ systems }: { systems: StarSystem[] }) {
  const matRef = useRef<THREE.ShaderMaterial>(null!);

  const geometry = useMemo(() => {
    const posMap = new Map<string, [number, number, number]>();
    for (const s of systems) posMap.set(s.main_id, [s.x, s.y, s.z]);
    const verts: number[] = [];
    const tVals: number[] = [];
    const seen = new Set<string>();
    for (const s of systems) {
      if (!s.companions?.length) continue;
      for (const comp of s.companions) {
        const key = [s.main_id, comp.name].sort().join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        const posB = posMap.get(comp.name);
        if (!posB) continue;
        const [ax, ay, az] = [s.x, s.y, s.z];
        const [bx, by, bz] = posB;
        const d = Math.sqrt((bx - ax) ** 2 + (by - ay) ** 2 + (bz - az) ** 2);
        if (d < 0.005) continue;
        verts.push(ax, ay, az); tVals.push(0.0);
        verts.push(bx, by, bz); tVals.push(1.0);
      }
    }
    if (verts.length === 0) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
    geo.setAttribute('aT',       new THREE.BufferAttribute(new Float32Array(tVals), 1));
    return geo;
  }, [systems]);

  useFrame(({ clock }) => {
    if (matRef.current) matRef.current.uniforms.uTime.value = clock.getElapsedTime();
  });

  if (!geometry) return null;
  return (
    <lineSegments geometry={geometry}>
      <shaderMaterial
        ref={matRef}
        vertexShader={BINARY_LANE_VERT}
        fragmentShader={BINARY_LANE_FRAG}
        uniforms={{ uTime: { value: 0 } }}
        transparent depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </lineSegments>
  );
}

/* ━━ Main component ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

export function DesktopLayout({ gpu, onSystemFocus }: Props) {
  const { systems: catalogSystems, loading: loadingStars } = useSystemsList();
  const [systems,       setSystems]       = useState<StarSystem[]>([]);
  const [selectedSystem,setSelectedSystem]= useState<string | null>(null);
  const [hoveredSystem, setHoveredSystem] = useState<StarSystem | null>(null);
  const [searchQuery,   setSearchQuery]   = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [showCampaign,  setShowCampaign]  = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const campaign = useCampaign();

  /* ── Explored-IDs set for fog-of-war ──────────────────────────────── */
  const exploredIds = useMemo<Set<string> | null>(() => {
    if (!campaign.activeCampaign) return null;
    return new Set(campaign.exploredSystems.keys());
  }, [campaign.activeCampaign, campaign.exploredSystems]);

  /* ── Sync catalog into local state; try live API first ─────────────── */
  useEffect(() => {
    // Immediately show the catalog from useSystemsList (may be from cache).
    if (catalogSystems.length) setSystems(catalogSystems);
  }, [catalogSystems]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { verifiedFetch } = await import('../utils/verifiedFetch');
        const resp = await verifiedFetch('/api/world/systems/full');
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        if (!cancelled && data?.systems?.length) {
          setSystems(data.systems);
        }
      } catch { /* catalog fallback already applied above */ }
    })();
    return () => { cancelled = true; };
  }, []);

  /* ── Callbacks ─────────────────────────────────────────────────────── */
  const handleStarSelect = useCallback((id: string | null) => setSelectedSystem(id), []);
  const handleStarHover  = useCallback((sys: StarSystem | null) => {
    setHoveredSystem(sys);
    // Prefetch the orrery chunk while the user is still hovering — by click
    // time it's already cached. Dynamic import is idempotent: N calls = 1 fetch.
    if (sys) import('./SystemFocusView');
  }, []);
  const handleSystemClick = useCallback((id: string) => setSelectedSystem(id), []);
  const handleOpenSystem  = useCallback((mainId: string) => {
    const sys = systems.find(s => s.main_id === mainId);
    onSystemFocus(mainId, { name: mainId, starClass: sys?.spectral_class?.charAt(0) });
  }, [onSystemFocus, systems]);

  /* ── Search focus/blur with delay (allows list clicks to register) ── */
  const handleSearchFocus = () => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    setSearchFocused(true);
  };
  const handleSearchBlur = () => {
    blurTimer.current = setTimeout(() => setSearchFocused(false), 160);
  };

  const searchListOpen = searchFocused || searchQuery.trim().length > 0;
  const selected = systems.find(s => s.main_id === selectedSystem);
  const specColor = selected ? (SPECTRAL_HEX[selected.spectral_class?.[0]] ?? '#888888') : '#888888';

  return (
    <div className="dl-root">

      {/* ── Full-screen 3D viewport — renders into the shared App Canvas ── */}
      <div className="dl-viewport">
        <ErrorBoundary label="3D Star Map">
          <View style={{ position: 'absolute', inset: 0 }}>
            <PerspectiveCamera makeDefault position={[4, 3, 4]} fov={55} near={0.01} far={2000} />
            <color attach="background" args={['#030508']} />
            <Suspense fallback={null}>
              <Stars radius={400} depth={120} count={7000} factor={4}   saturation={0.12} fade speed={0} />
              <Stars radius={120} depth={60}  count={2500} factor={2}   saturation={0.06} fade speed={0} />
              <Stars radius={40}  depth={20}  count={800}  factor={0.8} saturation={0.02} fade speed={0} />
              <DistanceRings />
              <SolMarker />
              {systems.length > 0 && (
                <StarField
                  systems={systems}
                  selectedId={selectedSystem}
                  onSelect={handleStarSelect}
                  onHover={handleStarHover}
                  exploredIds={exploredIds}
                />
              )}
              {systems.length > 0 && <BinaryLanes systems={systems} />}
              <ambientLight intensity={0.05} />
            </Suspense>
            <OrbitControls enableDamping dampingFactor={0.06} minDistance={0.5} maxDistance={500} rotateSpeed={0.5} zoomSpeed={1.2} />
          </View>
        </ErrorBoundary>
      </div>

      {/* ── Hover tooltip — top-left ─────────────────────────────────── */}
      {hoveredSystem && (
        <div className="dl-tooltip">
          <div className="dl-tooltip-name">{hoveredSystem.main_id}</div>
          <div className="dl-tooltip-grid">
            <span className="dl-tooltip-key">Spectral</span>
            <span style={{ color: SPECTRAL_HEX[hoveredSystem.spectral_class?.[0]] ?? '#888', fontWeight: 500 }}>
              {hoveredSystem.spectral_class}
            </span>
            <span className="dl-tooltip-key">Distance</span>
            <span>{hoveredSystem.distance_ly.toFixed(2)} ly</span>
            {hoveredSystem.planet_count > 0 && <>
              <span className="dl-tooltip-key">Planets</span>
              <span style={{ color: '#a8c8ff' }}>{hoveredSystem.planet_count}</span>
            </>}
            {hoveredSystem.multiplicity > 1 && <>
              <span className="dl-tooltip-key">System</span>
              <span style={{ color: '#7eb8ff' }}>
                {hoveredSystem.multiplicity === 2 ? 'Binary' : `${hoveredSystem.multiplicity}-body`}
              </span>
            </>}
            <span className="dl-tooltip-key">Luminosity</span>
            <span>{hoveredSystem.luminosity.toFixed(3)} L☉</span>
            <span className="dl-tooltip-key">Teff</span>
            <span>{hoveredSystem.teff} K</span>
          </div>
        </div>
      )}

      {/* ── Search — top-right ───────────────────────────────────────── */}
      <div className={`dl-search${searchListOpen ? ' dl-search--open' : ''}`}>
        <span className="dl-search-icon">⌕</span>
        <input
          className="dl-search-input"
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search systems…"
          onFocus={handleSearchFocus}
          onBlur={handleSearchBlur}
          onKeyDown={e => e.key === 'Escape' && setSearchQuery('')}
        />
        {searchListOpen && (
          <div className="dl-search-list">
            <SystemListPanel
              searchQuery={searchQuery}
              selectedSystem={selectedSystem}
              onSelect={handleSystemClick}
              onOpen={handleOpenSystem}
            />
          </div>
        )}
      </div>

      {/* ── Campaign drawer — left slide-in ─────────────────────────── */}
      {showCampaign && (
        <div className="dl-campaign-drawer">
          <div className="dl-campaign-drawer-hdr">
            <span>Campaign</span>
            <button className="dl-campaign-drawer-close" onClick={() => setShowCampaign(false)}>✕</button>
          </div>
          <div className="dl-campaign-drawer-body">
            <CampaignPanel />
          </div>
        </div>
      )}

      {/* ── Selected system card — bottom-right ─────────────────────── */}
      {selected && (
        <div className="dl-system-card">
          <div className="dl-card-hdr">
            <span className="dl-card-name">{selected.main_id}</span>
            <span className="dl-card-spec" style={{ background: `${specColor}22`, color: specColor }}>
              {selected.spectral_class}
            </span>
          </div>
          <div className="dl-card-body">
            <div className="dl-card-stat">
              <span className="dl-card-stat-k">Distance</span>
              <span className="dl-card-stat-v">{selected.distance_ly.toFixed(2)} ly</span>
            </div>
            <div className="dl-card-stat">
              <span className="dl-card-stat-k">Planets</span>
              <span className="dl-card-stat-v" style={{ color: '#a8c8ff' }}>{selected.planet_count}</span>
            </div>
            <div className="dl-card-stat">
              <span className="dl-card-stat-k">Teff</span>
              <span className="dl-card-stat-v">{selected.teff} K</span>
            </div>
            <div className="dl-card-stat">
              <span className="dl-card-stat-k">Luminosity</span>
              <span className="dl-card-stat-v">{selected.luminosity.toFixed(3)} L☉</span>
            </div>
            {selected.multiplicity > 1 && (
              <div className="dl-card-stat" style={{ gridColumn: '1 / -1' }}>
                <span className="dl-card-stat-k">System</span>
                <span className="dl-card-stat-v" style={{ color: '#e0c060' }}>
                  {selected.multiplicity === 2 ? 'Binary' : `${selected.multiplicity}-body`}
                </span>
              </div>
            )}
          </div>
          <div className="dl-card-actions">
            <button
              className="dl-card-btn dl-card-btn--primary"
              onClick={() => onSystemFocus(selected.main_id, { name: selected.main_id, starClass: selected.spectral_class?.charAt(0) })}
            >
              Open System →
            </button>
            {campaign.activeCampaign && !campaign.isExplored(selected.main_id) && (
              <button
                className="dl-card-btn dl-card-btn--explore"
                onClick={() => campaign.exploreSystem(selected.main_id)}
              >
                ⬡ Explore System
              </button>
            )}
            {campaign.activeCampaign && campaign.isExplored(selected.main_id) && (
              <div className="dl-card-explored">✓ Explored</div>
            )}
          </div>
        </div>
      )}

      {/* ── HUD strip — bottom ──────────────────────────────────────── */}
      <div className="dl-hud">
        <span className="dl-hud-hex">⬡</span>
        <span className="dl-hud-sep">|</span>
        {loadingStars
          ? <span>LOADING STAR SYSTEMS…</span>
          : <span>{systems.length} SYSTEMS CATALOGUED</span>
        }
        <span className="dl-hud-sep">|</span>
        <button
          className={`dl-hud-campaign-btn${showCampaign ? ' active' : ''}`}
          onClick={() => setShowCampaign(p => !p)}
        >
          ⬡ {campaign.activeCampaign ? campaign.activeCampaign.name.toUpperCase() : 'CAMPAIGN'}
        </button>
        {campaign.activeCampaign && <>
          <span className="dl-hud-sep">·</span>
          <span style={{ color: '#4caf50' }}>{campaign.exploredSystems.size} EXPLORED</span>
        </>}
        <span className="dl-hud-spacer" />
        <span className="dl-hud-ver">EXOMAPS v0.2</span>
      </div>

      {/* ── GPU generation queue — top-right below search ───────────── */}
      {gpu.generations.size > 0 && (
        <div className="dl-gen-queue">
          <div className="dl-gen-queue-label">Generation Queue</div>
          {Array.from(gpu.generations.values()).map(gen => (
            <PlanetGenCard key={gen.planetId} generation={gen} />
          ))}
        </div>
      )}

    </div>
  );
}
