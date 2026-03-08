/**
 * SystemViewerPage — Fullscreen immersive planetary system viewer
 *
 * Improvement #10: Dedicated fullscreen route /system/:id
 * Improvement #12: Keyboard shortcuts (Esc to return, arrow keys to cycle)
 *
 * Features:
 *   - Full-viewport 3D orrery with expanded controls
 *   - Side info panel with star data, planets, belts, disc
 *   - Multi-star tab support inherited from SystemDetailPanel logic
 *   - Esc key returns to star map
 *   - Arrow keys cycle between planets
 */

import React, { useEffect, useState, useMemo, lazy, Suspense } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type {
  Planet, HabitableZone,
  SystemGroupResponse,
} from '../types/api';
import { getSystemGroup, getSystemDetail } from '../services/api';

const OrrerySceneFull = lazy(() => import('../components/OrrerySceneFull'));

/* ── Colour constants ─────────────────────────────── */
const SPECTRAL_STAR_COLOR: Record<string, string> = {
  O: '#9bb0ff', B: '#aabfff', A: '#cad7ff', F: '#f8f7ff',
  G: '#fff4ea', K: '#ffd2a1', M: '#ffb56c', L: '#ff8c42', T: '#ff6b35',
};
const PLANET_TYPE_COLOR: Record<string, string> = {
  'sub-earth': '#9ca3af', rocky: '#c4a882', 'super-earth': '#34d399',
  'neptune-like': '#60a5fa', 'gas-giant': '#f59e0b', 'super-jupiter': '#ef4444', unknown: '#6b7280',
};
const PLANET_TYPE_EMOJI: Record<string, string> = {
  'sub-earth': '⚬', rocky: '🜨', 'super-earth': '⊕',
  'neptune-like': '♆', 'gas-giant': '♃', 'super-jupiter': '♃', unknown: '?',
};

function fmtNum(v: number | null | undefined, d = 2): string {
  if (v == null) return '—';
  return v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: d });
}
function fmtTemp(v: number | null | undefined): string { return v == null ? '—' : `${Math.round(v)} K`; }

function starColor(spec: string | undefined): string {
  return SPECTRAL_STAR_COLOR[spec?.[0]?.toUpperCase() ?? ''] ?? '#fbbf24';
}

/* ── Planet list sidebar item ─────────────────────── */
function PlanetRow({
  planet, selected, onClick, hz,
}: { planet: Planet; selected: boolean; onClick: () => void; hz: HabitableZone }) {
  const color = PLANET_TYPE_COLOR[planet.planet_type] ?? '#6b7280';
  const emoji = PLANET_TYPE_EMOJI[planet.planet_type] ?? '?';
  const inHZ = planet.semi_major_axis_au != null && planet.semi_major_axis_au >= hz.inner_au && planet.semi_major_axis_au <= hz.outer_au;

  return (
    <button
      onClick={onClick}
      style={{
        width: '100%', background: selected ? `${color}18` : 'transparent',
        border: selected ? `1px solid ${color}40` : '1px solid transparent',
        borderRadius: 5, padding: '6px 10px', cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left',
        transition: 'all 0.15s',
      }}
    >
      <span style={{ fontSize: 16, lineHeight: 1 }}>{emoji}</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#e5e7eb', fontFamily: 'Inter, sans-serif' }}>
          {planet.planet_name.replace(' (inferred)', '')}
        </div>
        <div style={{ fontSize: 9, color: '#6b7280', fontFamily: "'JetBrains Mono', monospace", display: 'flex', gap: 6 }}>
          {planet.semi_major_axis_au != null && <span>{fmtNum(planet.semi_major_axis_au, 3)} AU</span>}
          {planet.radius_earth != null && <span>{fmtNum(planet.radius_earth, 2)} R⊕</span>}
          {planet.temp_calculated_k != null && <span>{fmtTemp(planet.temp_calculated_k)}</span>}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
        <span style={{ background: color + '30', color, borderRadius: 3, padding: '0 5px', fontSize: 8, fontWeight: 700, textTransform: 'capitalize' }}>
          {planet.planet_type}
        </span>
        {inHZ && <span style={{ color: '#22c55e', fontSize: 7, fontWeight: 700 }}>HZ</span>}
      </div>
    </button>
  );
}

/* ── Planet detail card ───────────────────────────── */
function PlanetDetail({ planet, hz }: { planet: Planet; hz: HabitableZone }) {
  const color = PLANET_TYPE_COLOR[planet.planet_type] ?? '#6b7280';
  const inHZ = planet.semi_major_axis_au != null && planet.semi_major_axis_au >= hz.inner_au && planet.semi_major_axis_au <= hz.outer_au;

  return (
    <div style={{ padding: '12px 16px', background: `${color}08`, borderTop: `1px solid ${color}30`, maxHeight: 300, overflow: 'auto' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#f3f4f6', marginBottom: 8 }}>
        {planet.planet_name.replace(' (inferred)', '')}
        {inHZ && <span style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e', borderRadius: 3, padding: '1px 6px', fontSize: 9, fontWeight: 700, marginLeft: 6 }}>IN HABITABLE ZONE</span>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px 12px', fontSize: 10 }}>
        <Stat label="Mass" value={planet.mass_earth != null ? `${fmtNum(planet.mass_earth)} M⊕` : '—'} />
        <Stat label="Radius" value={planet.radius_earth != null ? `${fmtNum(planet.radius_earth)} R⊕` : '—'} />
        <Stat label="SMA" value={planet.semi_major_axis_au != null ? `${fmtNum(planet.semi_major_axis_au, 4)} AU` : '—'} />
        <Stat label="Period" value={planet.orbital_period_days != null ? `${fmtNum(planet.orbital_period_days, 1)} d` : '—'} />
        <Stat label="Ecc" value={fmtNum(planet.eccentricity, 3)} />
        <Stat label="Temp" value={fmtTemp(planet.temp_calculated_k)} />
        <Stat label="Type" value={planet.planet_type} />
        <Stat label="Confidence" value={planet.confidence} />
        {planet.detection_type && <Stat label="Detect" value={planet.detection_type} />}
      </div>
      {planet.moons.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 10 }}>
          <div style={{ color: '#9ca3af', fontWeight: 600, marginBottom: 3 }}>Moons ({planet.moons.length})</div>
          {planet.moons.map((m) => (
            <div key={m.moon_name} style={{ color: '#d1d5db', fontSize: 9, display: 'flex', gap: 8, padding: '1px 0' }}>
              <span style={{ color: m.moon_type === 'icy' ? '#93c5fd' : '#d1a37a' }}>●</span>
              <span>{m.moon_name.replace(' (inferred)', '').split(' ').pop()}</span>
              <span style={{ color: '#6b7280' }}>{fmtNum(m.radius_earth, 3)} R⊕</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ color: '#4b5563', fontSize: 8, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5 }}>{label}</div>
      <div style={{ color: '#d1d5db', marginTop: 1 }}>{value}</div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   ██  SystemViewerPage
   ═══════════════════════════════════════════════════════ */

export default function SystemViewerPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [groupData, setGroupData] = useState<SystemGroupResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeStarIdx, setActiveStarIdx] = useState(0);
  const [selectedPlanetIdx, setSelectedPlanetIdx] = useState<number>(-1);

  const mainId = id ? decodeURIComponent(id) : '';

  // Load data
  useEffect(() => {
    if (!mainId) return;
    setLoading(true);
    getSystemDetail(mainId)
      .then((single) => {
        const group = single.star.system_group;
        if (group) {
          return getSystemGroup(group).then((gr) => {
            setGroupData(gr);
            const idx = gr.stars.findIndex((s) => s.star.main_id === mainId);
            setActiveStarIdx(idx >= 0 ? idx : 0);
            setLoading(false);
          });
        } else {
          setGroupData({
            group_name: mainId,
            hierarchy: null,
            star_count: 1,
            stars: [{
              star: single.star,
              planets: single.planets,
              belts: single.belts,
              habitable_zone: single.habitable_zone,
              protoplanetary_disc: single.protoplanetary_disc,
              summary: single.summary,
            }],
            group_summary: {
              total_stars: 1,
              total_planets: single.summary.total_planets,
              total_moons: single.summary.total_moons,
              total_belts: single.summary.total_belts,
            },
          });
          setActiveStarIdx(0);
          setLoading(false);
        }
      })
      .catch((e: any) => { setError(e?.response?.data?.error ?? 'Failed to load'); setLoading(false); });
  }, [mainId]);

  const activeStar = groupData?.stars[activeStarIdx] ?? null;
  const sortedPlanets = useMemo(
    () => activeStar ? [...activeStar.planets].sort((a, b) => (a.semi_major_axis_au ?? 999) - (b.semi_major_axis_au ?? 999)) : [],
    [activeStar],
  );
  const selectedPlanet = selectedPlanetIdx >= 0 && selectedPlanetIdx < sortedPlanets.length ? sortedPlanets[selectedPlanetIdx] : null;

  // Keyboard shortcuts (Improvement #12)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        navigate('/');
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault();
        setSelectedPlanetIdx((prev) => Math.min(prev + 1, sortedPlanets.length - 1));
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault();
        setSelectedPlanetIdx((prev) => Math.max(prev - 1, -1));
      } else if (e.key === 'Tab' && groupData && groupData.star_count > 1) {
        e.preventDefault();
        setActiveStarIdx((prev) => (prev + 1) % (groupData?.star_count ?? 1));
        setSelectedPlanetIdx(-1);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [sortedPlanets.length, navigate, groupData]);

  if (loading) {
    return (
      <div style={{ width: '100vw', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#030712', color: '#6b7280', fontSize: 14 }}>
        Loading system…
      </div>
    );
  }

  if (error || !groupData || !activeStar) {
    return (
      <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#030712', color: '#ef4444', fontSize: 14, gap: 12 }}>
        <div>{error || 'System not found'}</div>
        <button onClick={() => navigate('/')} style={{ background: 'none', border: '1px solid #374151', color: '#9ca3af', padding: '4px 12px', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>
          ← Return to Star Map
        </button>
      </div>
    );
  }

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', background: '#030712', overflow: 'hidden' }}>
      {/* Left sidebar */}
      <div
        style={{
          width: 280, flexShrink: 0, display: 'flex', flexDirection: 'column',
          background: 'rgba(17,24,39,0.95)', borderRight: '1px solid #1f2937',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{ padding: '12px 14px', borderBottom: '1px solid #1f2937' }}>
          <button
            onClick={() => navigate('/')}
            style={{
              background: 'none', border: 'none', color: '#6b7280', fontSize: 10,
              cursor: 'pointer', padding: 0, marginBottom: 6,
              display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            ← Star Map
          </button>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#f3f4f6', fontFamily: 'Inter, sans-serif' }}>
            {activeStar.star.main_id}
          </div>
          {groupData.hierarchy && (
            <div style={{ fontSize: 9, color: '#6b7280', fontFamily: "'JetBrains Mono', monospace", marginTop: 2 }}>
              {groupData.hierarchy}
            </div>
          )}
          <div style={{ fontSize: 9, color: '#4b5563', marginTop: 4, fontFamily: "'JetBrains Mono', monospace" }}>
            {activeStar.star.spectral_class} · {fmtNum(activeStar.star.distance_ly, 2)} ly · {fmtNum(activeStar.star.luminosity, 4)} L☉
          </div>
        </div>

        {/* Multi-star tabs */}
        {groupData.star_count > 1 && (
          <div style={{ display: 'flex', borderBottom: '1px solid #1f2937' }}>
            {groupData.stars.map((sd, i) => {
              const isActive = i === activeStarIdx;
              const sc = starColor(sd.star.spectral_class);
              return (
                <button
                  key={sd.star.main_id}
                  onClick={() => { setActiveStarIdx(i); setSelectedPlanetIdx(-1); }}
                  style={{
                    flex: 1, background: isActive ? `${sc}15` : 'transparent',
                    border: 'none', borderBottom: isActive ? `2px solid ${sc}` : '2px solid transparent',
                    padding: '6px 4px', cursor: 'pointer',
                    color: isActive ? '#e5e7eb' : '#4b5563', fontSize: 9,
                    fontFamily: 'Inter, sans-serif', fontWeight: isActive ? 700 : 500,
                    transition: 'all 0.15s',
                  }}
                >
                  <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: sc, marginRight: 4 }} />
                  {sd.star.main_id.replace(/^.*\s/, '')}
                </button>
              );
            })}
          </div>
        )}

        {/* Planet list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '6px 4px' }}>
          <div style={{ fontSize: 8, color: '#374151', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, padding: '4px 10px 2px', fontFamily: "'JetBrains Mono', monospace" }}>
            PLANETS ({sortedPlanets.length})
          </div>
          {sortedPlanets.map((p, i) => (
            <PlanetRow
              key={p.planet_name}
              planet={p}
              hz={activeStar.habitable_zone}
              selected={selectedPlanetIdx === i}
              onClick={() => setSelectedPlanetIdx(selectedPlanetIdx === i ? -1 : i)}
            />
          ))}

          {activeStar.belts.length > 0 && (
            <>
              <div style={{ fontSize: 8, color: '#374151', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, padding: '8px 10px 2px', fontFamily: "'JetBrains Mono', monospace" }}>
                BELTS ({activeStar.belts.length})
              </div>
              {activeStar.belts.map((b) => (
                <div key={b.belt_id} style={{ padding: '4px 10px', fontSize: 9, color: '#9ca3af' }}>
                  <span style={{ color: b.belt_type === 'icy-kuiper' ? '#93c5fd' : '#d1a37a' }}>◌ </span>
                  {b.belt_type === 'icy-kuiper' ? 'Kuiper Belt' : 'Asteroid Belt'} — {fmtNum(b.inner_radius_au, 1)}–{fmtNum(b.outer_radius_au, 1)} AU
                </div>
              ))}
            </>
          )}

          {activeStar.protoplanetary_disc && (
            <div style={{ padding: '8px 10px', fontSize: 9, color: '#a78bfa' }}>
              ◎ {activeStar.protoplanetary_disc.disc_type} disc — {fmtNum(activeStar.protoplanetary_disc.inner_radius_au, 1)}–{fmtNum(activeStar.protoplanetary_disc.outer_radius_au, 1)} AU
            </div>
          )}
        </div>

        {/* Selected planet detail */}
        {selectedPlanet && <PlanetDetail planet={selectedPlanet} hz={activeStar.habitable_zone} />}

        {/* Keyboard hint */}
        <div style={{ padding: '6px 14px', borderTop: '1px solid #1f2937', fontSize: 8, color: '#374151', fontFamily: "'JetBrains Mono', monospace" }}>
          ESC return · ↑↓ planets{groupData.star_count > 1 ? ' · TAB stars' : ''}
        </div>
      </div>

      {/* Main viewport — fullscreen orrery */}
      <div style={{ flex: 1, position: 'relative' }}>
        <Suspense fallback={<div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4b5563' }}>Loading orrery…</div>}>
          <OrrerySceneFull
            planets={sortedPlanets}
            belts={activeStar.belts}
            hz={activeStar.habitable_zone}
            disc={activeStar.protoplanetary_disc}
            starColor={starColor(activeStar.star.spectral_class)}
            selectedPlanet={selectedPlanet?.planet_name ?? null}
          />
        </Suspense>
      </div>
    </div>
  );
}
