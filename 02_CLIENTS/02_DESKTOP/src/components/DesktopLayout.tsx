/**
 * DesktopLayout — Main two-pane layout: 3D star map + side panel.
 *
 * Fetches 1,600+ star systems from the gateway API, renders them
 * as GPU-instanced GL_POINTS in the 3D viewport with spectral-type
 * colors, twinkling, and neighborhood dimming.
 */

import { useState, useCallback, useEffect, useMemo, Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Stars } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import type { TauriGPUHook } from '../hooks/useTauriGPU';
import { ErrorBoundary } from './ErrorBoundary';
import { StarField, type StarSystem } from './StarField';
import { SolMarker } from './SolMarker';
import { DistanceRings } from './DistanceRings';
import { SystemListPanel } from './SystemListPanel';
import { PlanetGenCard } from './PlanetGenCard';
import { CampaignPanel } from './CampaignPanel';
import { useCampaign } from '../hooks/useCampaign';

interface Props {
  gpu: TauriGPUHook;
  onSystemFocus: (mainId: string) => void;
}

/** Spectral class → badge color */
const SPECTRAL_HEX: Record<string, string> = {
  O: '#9bb0ff', B: '#aabfff', A: '#cad7ff', F: '#f8f7ff',
  G: '#fff4ea', K: '#ffd2a1', M: '#ffb56c', L: '#ff8c42', T: '#ff6b35',
};

export function DesktopLayout({ gpu, onSystemFocus }: Props) {
  const [systems, setSystems] = useState<StarSystem[]>([]);
  const [loadingStars, setLoadingStars] = useState(true);
  const [selectedSystem, setSelectedSystem] = useState<string | null>(null);
  const [hoveredSystem, setHoveredSystem] = useState<StarSystem | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const campaign = useCampaign();

  /* ── Build explored-IDs set for fog-of-war ───── */
  const exploredIds = useMemo<Set<string> | null>(() => {
    if (!campaign.activeCampaign) return null;
    return new Set(campaign.exploredSystems.keys());
  }, [campaign.activeCampaign, campaign.exploredSystems]);
  /* ── Fetch star systems on mount ─────────────── */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch('/api/world/systems/full');
        const data = await resp.json();
        if (!cancelled && data?.systems) {
          setSystems(data.systems);
        }
      } catch (err) {
        console.error('[DesktopLayout] Failed to fetch systems:', err);
      } finally {
        if (!cancelled) setLoadingStars(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleStarSelect = useCallback((id: string | null) => {
    setSelectedSystem(id);
  }, []);

  const handleStarHover = useCallback((sys: StarSystem | null) => {
    setHoveredSystem(sys);
  }, []);

  const handleSystemClick = useCallback((mainId: string) => {
    setSelectedSystem(mainId);
  }, []);

  const handleOpenSystem = useCallback((mainId: string) => {
    onSystemFocus(mainId);
  }, [onSystemFocus]);

  const selected = systems.find(s => s.main_id === selectedSystem);

  return (
    <div className="desktop-layout">
      {/* Main 3D viewport */}
      <div className="map-viewport">
        <ErrorBoundary label="3D Star Map">
        <Canvas
          camera={{ position: [4, 3, 4], fov: 55, near: 0.01, far: 2000 }}
          gl={{ antialias: true, alpha: false, toneMapping: 4 /* ACESFilmic */ }}
          style={{ background: '#030508' }}
          raycaster={{ params: { Points: { threshold: 0.3 } } as any }}
        >
          <Suspense fallback={null}>
            {/* Deep-space background particles (three layers for depth) */}
            <Stars radius={400} depth={120} count={7000} factor={4} saturation={0.12} fade speed={0} />
            <Stars radius={120} depth={60} count={2500} factor={2} saturation={0.06} fade speed={0} />
            <Stars radius={40} depth={20} count={800} factor={0.8} saturation={0.02} fade speed={0} />

            {/* Distance reference rings */}
            <DistanceRings />

            {/* Sol origin marker */}
            <SolMarker />

            {/* Star systems */}
            {systems.length > 0 && (
              <StarField
                systems={systems}
                selectedId={selectedSystem}
                onSelect={handleStarSelect}
                onHover={handleStarHover}
                exploredIds={exploredIds}
              />
            )}

            <ambientLight intensity={0.08} />
          </Suspense>

          {/* Post-processing: bloom makes stars glow beautifully */}
          <EffectComposer>
            <Bloom
              intensity={0.8}
              luminanceThreshold={0.15}
              luminanceSmoothing={0.4}
              mipmapBlur
            />
            <Vignette darkness={0.45} offset={0.3} />
          </EffectComposer>

          <OrbitControls
            enableDamping
            dampingFactor={0.06}
            minDistance={0.5}
            maxDistance={500}
            rotateSpeed={0.5}
            zoomSpeed={1.2}
          />
        </Canvas>
        </ErrorBoundary>

        {/* HUD overlays */}
        <div style={{
          position: 'absolute', bottom: 12, left: 12,
          fontSize: 10, color: '#445566', pointerEvents: 'none',
          fontFamily: 'monospace', letterSpacing: '0.5px',
          display: 'flex', gap: 12, alignItems: 'center',
        }}>
          <span style={{ color: '#334455' }}>⬡</span>
          {loadingStars ? 'LOADING STAR SYSTEMS…' : `${systems.length} SYSTEMS CATALOGUED`}
          <span style={{ color: '#1e3050' }}>|</span>
          {campaign.activeCampaign ? (
            <span style={{ color: '#4caf50' }}>
              CAMPAIGN: {campaign.activeCampaign.name.toUpperCase()} · {campaign.exploredSystems.size} EXPLORED
            </span>
          ) : (
            <span>FREE EXPLORATION</span>
          )}
          <span style={{ color: '#1e3050' }}>|</span>
          <span>EXOMAPS v0.2</span>
        </div>

        {/* Hover tooltip */}
        {hoveredSystem && (
          <div style={{
            position: 'absolute', top: 12, left: 12,
            background: 'linear-gradient(135deg, rgba(10,14,23,0.95), rgba(15,25,35,0.92))',
            border: '1px solid rgba(77,159,255,0.25)',
            borderRadius: 8, padding: '10px 14px', fontSize: 12,
            pointerEvents: 'none', maxWidth: 300,
            backdropFilter: 'blur(8px)',
            boxShadow: '0 4px 24px rgba(0,0,0,0.5), inset 0 1px 0 rgba(77,159,255,0.08)',
          }}>
            <div style={{
              fontWeight: 600, color: '#e8edf5', marginBottom: 6,
              fontSize: 14, letterSpacing: '0.3px',
            }}>
              {hoveredSystem.main_id}
            </div>
            <div style={{
              color: '#8899aa', fontSize: 11,
              display: 'grid', gridTemplateColumns: 'auto auto', gap: '3px 12px',
            }}>
              <span style={{ color: '#556677' }}>Spectral</span>
              <span style={{ color: SPECTRAL_HEX[hoveredSystem.spectral_class?.[0]] ?? '#888', fontWeight: 500 }}>
                {hoveredSystem.spectral_class}
              </span>
              <span style={{ color: '#556677' }}>Distance</span>
              <span>{hoveredSystem.distance_ly.toFixed(2)} ly</span>
              {hoveredSystem.planet_count > 0 && (<>
                <span style={{ color: '#556677' }}>Planets</span>
                <span style={{ color: '#a8c8ff' }}>{hoveredSystem.planet_count}</span>
              </>)}
              {hoveredSystem.multiplicity > 1 && (<>
                <span style={{ color: '#556677' }}>System</span>
                <span style={{ color: '#7eb8ff' }}>
                  {hoveredSystem.multiplicity === 2 ? 'Binary' : `${hoveredSystem.multiplicity}-body`}
                </span>
              </>)}
              <span style={{ color: '#556677' }}>Luminosity</span>
              <span>{hoveredSystem.luminosity.toFixed(3)} L☉</span>
              <span style={{ color: '#556677' }}>Teff</span>
              <span>{hoveredSystem.teff} K</span>
            </div>
          </div>
        )}
      </div>

      {/* Side panel */}
      <div className="side-panel">
        {/* Campaign management */}
        <CampaignPanel />

        <div style={{ borderTop: '1px solid rgba(30,48,80,0.4)', marginTop: 8 }} />

        {/* Header */}
        <div style={{
          marginBottom: 16, paddingBottom: 12,
          borderBottom: '1px solid rgba(30,48,80,0.5)',
        }}>
          <div style={{
            fontSize: 10, color: '#445566', textTransform: 'uppercase',
            letterSpacing: '1.5px', marginBottom: 8, fontWeight: 600,
          }}>
            Star Catalogue
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search by name, spectral class…"
            style={{
              width: '100%', padding: '8px 12px',
              background: 'rgba(22,32,48,0.6)', border: '1px solid rgba(30,48,80,0.6)',
              borderRadius: 6, color: '#e8edf5', fontSize: 13,
              outline: 'none', boxSizing: 'border-box',
              transition: 'border-color 0.2s, box-shadow 0.2s',
            }}
            onFocus={e => {
              e.currentTarget.style.borderColor = 'rgba(77,159,255,0.4)';
              e.currentTarget.style.boxShadow = '0 0 12px rgba(77,159,255,0.08)';
            }}
            onBlur={e => {
              e.currentTarget.style.borderColor = 'rgba(30,48,80,0.6)';
              e.currentTarget.style.boxShadow = 'none';
            }}
          />
        </div>

        {/* Selected system quick-info */}
        {selected && (
          <div style={{
            background: 'linear-gradient(135deg, rgba(22,32,48,0.8), rgba(15,25,35,0.9))',
            border: '1px solid rgba(77,159,255,0.2)',
            borderRadius: 8, padding: 14, marginBottom: 14,
            boxShadow: '0 2px 16px rgba(0,0,0,0.3), inset 0 1px 0 rgba(77,159,255,0.06)',
          }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between',
              alignItems: 'center', marginBottom: 8,
            }}>
              <span style={{ fontWeight: 600, fontSize: 15, color: '#e8edf5', letterSpacing: '0.2px' }}>
                {selected.main_id}
              </span>
              <span style={{
                fontSize: 10, padding: '2px 8px', borderRadius: 4,
                background: SPECTRAL_HEX[selected.spectral_class?.[0]] ?? '#555',
                color: '#0a0e17', fontWeight: 700, letterSpacing: '0.5px',
              }}>
                {selected.spectral_class}
              </span>
            </div>

            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr',
              gap: '4px 12px', fontSize: 11, marginBottom: 10,
            }}>
              <div>
                <span style={{ color: '#556677' }}>Distance </span>
                <span style={{ color: '#c0c8d4' }}>{selected.distance_ly.toFixed(2)} ly</span>
              </div>
              <div>
                <span style={{ color: '#556677' }}>Planets </span>
                <span style={{ color: '#a8c8ff' }}>{selected.planet_count}</span>
              </div>
              <div>
                <span style={{ color: '#556677' }}>Teff </span>
                <span style={{ color: '#c0c8d4' }}>{selected.teff} K</span>
              </div>
              <div>
                <span style={{ color: '#556677' }}>Lum </span>
                <span style={{ color: '#c0c8d4' }}>{selected.luminosity.toFixed(3)} L☉</span>
              </div>
            </div>

            <button
              onClick={() => onSystemFocus(selected.main_id)}
              style={{
                width: '100%', padding: '8px 0', fontSize: 12, fontWeight: 500,
                background: 'linear-gradient(135deg, rgba(28,42,62,0.9), rgba(20,30,48,0.9))',
                border: '1px solid rgba(77,159,255,0.5)',
                color: '#4d9fff', borderRadius: 6, cursor: 'pointer',
                transition: 'all 0.2s',
                letterSpacing: '0.5px',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'rgba(77,159,255,0.15)';
                e.currentTarget.style.borderColor = '#4d9fff';
                e.currentTarget.style.boxShadow = '0 0 16px rgba(77,159,255,0.15)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'linear-gradient(135deg, rgba(28,42,62,0.9), rgba(20,30,48,0.9))';
                e.currentTarget.style.borderColor = 'rgba(77,159,255,0.5)';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              Open System →
            </button>

            {/* Explore button — only in campaign mode, for unexplored systems */}
            {campaign.activeCampaign && !campaign.isExplored(selected.main_id) && (
              <button
                onClick={() => campaign.exploreSystem(selected.main_id)}
                style={{
                  width: '100%', padding: '8px 0', fontSize: 12, fontWeight: 500,
                  marginTop: 6,
                  background: 'linear-gradient(135deg, rgba(30,60,40,0.9), rgba(20,45,30,0.9))',
                  border: '1px solid rgba(76,175,80,0.5)',
                  color: '#4caf50', borderRadius: 6, cursor: 'pointer',
                  transition: 'all 0.2s',
                  letterSpacing: '0.5px',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = 'rgba(76,175,80,0.15)';
                  e.currentTarget.style.borderColor = '#4caf50';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'linear-gradient(135deg, rgba(30,60,40,0.9), rgba(20,45,30,0.9))';
                  e.currentTarget.style.borderColor = 'rgba(76,175,80,0.5)';
                }}
              >
                ⬡ Explore System
              </button>
            )}
            {campaign.activeCampaign && campaign.isExplored(selected.main_id) && (
              <div style={{
                width: '100%', padding: '6px 0', fontSize: 11,
                color: '#4caf50', textAlign: 'center', marginTop: 6,
                fontWeight: 500, letterSpacing: '0.3px',
              }}>
                ✓ Explored
              </div>
            )}
          </div>
        )}

        {/* System list */}
        <SystemListPanel
          searchQuery={searchQuery}
          selectedSystem={selectedSystem}
          onSelect={handleSystemClick}
          onOpen={handleOpenSystem}
        />

        {/* GPU generation queue */}
        {gpu.generations.size > 0 && (
          <div style={{ marginTop: 16 }}>
            <h3 style={{
              fontSize: 10, color: '#556677', textTransform: 'uppercase',
              letterSpacing: '1.5px', marginBottom: 8, fontWeight: 600,
            }}>
              Generation Queue
            </h3>
            {Array.from(gpu.generations.values()).map(gen => (
              <PlanetGenCard key={gen.planetId} generation={gen} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
