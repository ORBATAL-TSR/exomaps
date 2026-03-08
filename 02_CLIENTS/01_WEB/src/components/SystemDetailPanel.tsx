/**
 * SystemDetailPanel v2 — Multi-star tabbed system viewer
 *
 * Major improvements:
 *  1. Multi-star tab navigation (each star = top tab, planets = sub-content)
 *  2. System census icon strip showing composition at a glance
 *  3. Comparative planet scale bar (relative to Earth + Jupiter)
 *  4. Orbital period timeline visualization
 *  5. Protoplanetary/debris disc display
 *  6. Animated accordion transitions
 *  7. Breadcrumb trail: Star Map > System Group > Star > Planet
 *  8. Fullscreen toggle button
 *  9. Planet detail flyout on click
 * 10. Polished UX: flowing animations, hover states, keyboard nav
 */

import React, { useEffect, useState, useMemo, useCallback, lazy, Suspense } from 'react';
import type {
  Planet, Belt, HabitableZone, ProtoplanetaryDisc,
  StarSystemData, SystemGroupResponse,
} from '../types/api';
import { getSystemGroup, getSystemDetail } from '../services/api';

const OrreryScene = lazy(() => import('./OrreryScene'));

/* ── Planet-type colour coding ────────────────────── */
const PLANET_TYPE_COLOR: Record<string, string> = {
  'sub-earth': '#9ca3af',
  rocky: '#c4a882',
  'super-earth': '#34d399',
  'neptune-like': '#60a5fa',
  'gas-giant': '#f59e0b',
  'super-jupiter': '#ef4444',
  unknown: '#6b7280',
};

const PLANET_TYPE_EMOJI: Record<string, string> = {
  'sub-earth': '⚬',
  rocky: '🜨',
  'super-earth': '⊕',
  'neptune-like': '♆',
  'gas-giant': '♃',
  'super-jupiter': '♃',
  unknown: '?',
};

const CONFIDENCE_BADGE: Record<string, { bg: string; fg: string; label: string }> = {
  observed: { bg: 'rgba(16,185,129,0.15)', fg: '#10b981', label: 'OBS' },
  inferred: { bg: 'rgba(59,130,246,0.15)', fg: '#3b82f6', label: 'INF' },
};

const SPECTRAL_STAR_COLOR: Record<string, string> = {
  O: '#9bb0ff', B: '#aabfff', A: '#cad7ff', F: '#f8f7ff',
  G: '#fff4ea', K: '#ffd2a1', M: '#ffb56c', L: '#ff8c42', T: '#ff6b35',
};

/* ── Helpers ──────────────────────────────────────── */

function fmtNum(v: number | null | undefined, decimals = 2): string {
  if (v == null) return '—';
  return v.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

function fmtTemp(v: number | null | undefined): string {
  if (v == null) return '—';
  return `${Math.round(v)} K`;
}

function isInHZ(sma: number | null, hz: HabitableZone): boolean {
  if (sma == null) return false;
  return sma >= hz.inner_au && sma <= hz.outer_au;
}

function starColor(spectralClass: string | undefined): string {
  return SPECTRAL_STAR_COLOR[spectralClass?.[0]?.toUpperCase() ?? ''] ?? '#fbbf24';
}

/* ── System Census Strip ─────────────────────────── */
/* Improvement #17: Icon strip showing system composition */

function SystemCensus({ stars }: { stars: StarSystemData[] }) {
  const totals = useMemo(() => {
    let planets = 0, moons = 0, belts = 0, discs = 0;
    for (const sd of stars) {
      planets += sd.planets.length;
      moons += sd.planets.reduce((a: number, p: Planet) => a + p.moons.length, 0);
      belts += sd.belts.length;
      if (sd.protoplanetary_disc) discs++;
    }
    return { stars: stars.length, planets, moons, belts, discs };
  }, [stars]);

  const items = [
    { icon: '★', count: totals.stars, label: 'star', color: '#fbbf24' },
    { icon: '⊕', count: totals.planets, label: 'planet', color: '#22d3ee' },
    { icon: '●', count: totals.moons, label: 'moon', color: '#9ca3af' },
    { icon: '◌', count: totals.belts, label: 'belt', color: '#d1a37a' },
    ...(totals.discs > 0 ? [{ icon: '◎', count: totals.discs, label: 'disc', color: '#a78bfa' }] : []),
  ];

  return (
    <div style={{ display: 'flex', gap: 2, padding: '4px 0' }}>
      {items.map((item) => (
        <div
          key={item.label}
          title={`${item.count} ${item.label}${item.count !== 1 ? 's' : ''}`}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 3,
            padding: '2px 6px',
            borderRadius: 4,
            background: `${item.color}12`,
            fontSize: 9,
            fontWeight: 600,
            color: item.color,
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          <span style={{ fontSize: 10 }}>{item.icon}</span>
          {item.count}
        </div>
      ))}
    </div>
  );
}

/* ── Star Tab Pills ───────────────────────────────── */
/* Improvement #13: Segmented control for multi-star systems */

function StarTabs({
  stars,
  activeIndex,
  onSelect,
}: {
  stars: StarSystemData[];
  activeIndex: number;
  onSelect: (i: number) => void;
}) {
  if (stars.length <= 1) return null;

  return (
    <div
      style={{
        display: 'flex',
        gap: 2,
        padding: '4px 0 6px',
        borderBottom: '1px solid #1f2937',
      }}
    >
      {stars.map((sd, i) => {
        const isActive = i === activeIndex;
        const sp = sd.star.spectral_class?.[0]?.toUpperCase() || '?';
        const sc = SPECTRAL_STAR_COLOR[sp] ?? '#6b7280';
        const name = sd.star.main_id.replace(/^.*\s/, ''); // last word

        return (
          <button
            key={sd.star.main_id}
            onClick={() => onSelect(i)}
            style={{
              flex: 1,
              background: isActive ? `${sc}18` : 'transparent',
              border: isActive ? `1px solid ${sc}50` : '1px solid transparent',
              borderRadius: 5,
              padding: '5px 4px',
              cursor: 'pointer',
              transition: 'all 0.2s',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 2,
            }}
          >
            {/* Spectral dot */}
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: sc,
                boxShadow: isActive ? `0 0 6px ${sc}` : 'none',
                display: 'inline-block',
              }}
            />
            <span
              style={{
                fontSize: 9,
                fontWeight: isActive ? 700 : 500,
                color: isActive ? '#f3f4f6' : '#6b7280',
                fontFamily: 'Inter, sans-serif',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: 80,
              }}
            >
              {name}
            </span>
            <span style={{ fontSize: 7, color: '#4b5563', fontFamily: "'JetBrains Mono', monospace" }}>
              {sp} · {sd.summary.total_planets}p
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ── Breadcrumb Trail ─────────────────────────────── */
/* Improvement #16 */

function Breadcrumbs({
  groupName,
  starName,
  planetName,
  onNavigateGroup,
  onNavigateStar,
  onClearPlanet,
}: {
  groupName: string | null;
  starName: string;
  planetName: string | null;
  onNavigateGroup?: () => void;
  onNavigateStar?: () => void;
  onClearPlanet?: () => void;
}) {
  const crumbs = [
    ...(groupName ? [{ label: groupName, onClick: onNavigateGroup }] : []),
    { label: starName.replace(/^.*\s/, ''), onClick: onNavigateStar },
    ...(planetName ? [{ label: planetName.replace(' (inferred)', '').split(' ').pop() || '', onClick: onClearPlanet }] : []),
  ];

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 8, color: '#4b5563', padding: '2px 0' }}>
      <span style={{ color: '#374151' }}>⊙</span>
      {crumbs.map((c, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span style={{ color: '#374151' }}>›</span>}
          <span
            onClick={c.onClick}
            style={{
              cursor: c.onClick ? 'pointer' : 'default',
              color: i === crumbs.length - 1 ? '#9ca3af' : '#6b7280',
              fontWeight: i === crumbs.length - 1 ? 600 : 400,
              ...(c.onClick ? { borderBottom: '1px dotted #374151' } : {}),
            }}
          >
            {c.label}
          </span>
        </React.Fragment>
      ))}
    </div>
  );
}

/* ── Comparative Planet Scale ─────────────────────── */
/* Improvement #18: Show planet sizes relative to Earth/Jupiter */

function PlanetScaleBar({ planets }: { planets: Planet[] }) {
  const withRadius = planets.filter((p) => p.radius_earth != null && p.radius_earth > 0);
  if (withRadius.length === 0) return null;

  const maxR = Math.max(...withRadius.map((p) => p.radius_earth!));
  const barWidth = 272;
  const jupiterR = 11.2;
  const scaleMax = Math.max(maxR, jupiterR) * 1.1;

  return (
    <div style={{ position: 'relative', height: 24, width: barWidth, margin: '4px 0' }}>
      {/* Scale track */}
      <div style={{ position: 'absolute', top: 11, left: 0, width: barWidth, height: 2, background: '#1f2937', borderRadius: 1 }} />
      {/* Earth marker */}
      <div
        style={{
          position: 'absolute',
          top: 6,
          left: (1 / scaleMax) * barWidth - 0.5,
          width: 1,
          height: 12,
          background: '#22c55e44',
        }}
        title="Earth (1 R⊕)"
      />
      <div style={{ position: 'absolute', top: 18, left: (1 / scaleMax) * barWidth - 4, fontSize: 6, color: '#22c55e', fontFamily: "'JetBrains Mono', monospace" }}>
        E
      </div>
      {/* Jupiter marker */}
      {jupiterR <= scaleMax && (
        <>
          <div
            style={{
              position: 'absolute',
              top: 6,
              left: (jupiterR / scaleMax) * barWidth - 0.5,
              width: 1,
              height: 12,
              background: '#f59e0b44',
            }}
            title="Jupiter (11.2 R⊕)"
          />
          <div style={{ position: 'absolute', top: 18, left: (jupiterR / scaleMax) * barWidth - 4, fontSize: 6, color: '#f59e0b', fontFamily: "'JetBrains Mono', monospace" }}>
            J
          </div>
        </>
      )}
      {/* Planet dots */}
      {withRadius.map((p, i) => {
        const x = (p.radius_earth! / scaleMax) * barWidth;
        const color = PLANET_TYPE_COLOR[p.planet_type] ?? '#6b7280';
        return (
          <div
            key={p.planet_name + i}
            style={{
              position: 'absolute',
              top: 8,
              left: x - 3,
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: color,
              border: p.confidence === 'observed' ? `1px solid ${color}` : `1px dashed ${color}88`,
            }}
            title={`${p.planet_name}: ${fmtNum(p.radius_earth, 2)} R⊕`}
          />
        );
      })}
      {/* Label */}
      <div style={{ position: 'absolute', top: -2, right: 0, fontSize: 7, color: '#374151', fontFamily: "'JetBrains Mono', monospace" }}>
        RADIUS
      </div>
    </div>
  );
}

/* ── Orbital Period Timeline ──────────────────────── */
/* Improvement #19 */

function PeriodTimeline({ planets }: { planets: Planet[] }) {
  const withPeriod = planets.filter((p) => p.orbital_period_days != null && p.orbital_period_days > 0);
  if (withPeriod.length === 0) return null;

  const maxP = Math.max(...withPeriod.map((p) => p.orbital_period_days!));
  const barWidth = 272;

  // Use log scale
  const minP = 0.5;
  const logMin = Math.log10(minP);
  const logMax = Math.log10(Math.max(maxP, 366));
  const logScale = (v: number) => (Math.log10(Math.max(v, minP)) - logMin) / (logMax - logMin);

  return (
    <div style={{ position: 'relative', height: 24, width: barWidth, margin: '4px 0' }}>
      <div style={{ position: 'absolute', top: 11, left: 0, width: barWidth, height: 2, background: '#1f2937', borderRadius: 1 }} />
      {/* 1-year Earth marker */}
      <div
        style={{
          position: 'absolute',
          top: 6,
          left: logScale(365.25) * barWidth - 0.5,
          width: 1,
          height: 12,
          background: '#22c55e44',
        }}
        title="1 Earth year"
      />
      <div style={{ position: 'absolute', top: 18, left: logScale(365.25) * barWidth - 6, fontSize: 6, color: '#22c55e', fontFamily: "'JetBrains Mono', monospace" }}>
        1yr
      </div>
      {/* Planet markers */}
      {withPeriod.map((p, i) => {
        const x = logScale(p.orbital_period_days!) * barWidth;
        const color = PLANET_TYPE_COLOR[p.planet_type] ?? '#6b7280';
        return (
          <div
            key={p.planet_name + i}
            style={{
              position: 'absolute',
              top: 8,
              left: x - 3,
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: color,
              border: p.confidence === 'observed' ? `1px solid ${color}` : `1px dashed ${color}88`,
            }}
            title={`${p.planet_name}: ${fmtNum(p.orbital_period_days, 1)} days`}
          />
        );
      })}
      <div style={{ position: 'absolute', top: -2, right: 0, fontSize: 7, color: '#374151', fontFamily: "'JetBrains Mono', monospace" }}>
        PERIOD
      </div>
    </div>
  );
}

/* ── Protoplanetary Disc Card ─────────────────────── */
/* Improvement #5 & #20 */

function DiscCard({ disc }: { disc: ProtoplanetaryDisc }) {
  const typeLabel: Record<string, string> = {
    protoplanetary: 'Protoplanetary Disc',
    transitional: 'Transitional Disc',
    debris: 'Debris Disc',
  };
  const typeColor: Record<string, string> = {
    protoplanetary: '#a78bfa',
    transitional: '#818cf8',
    debris: '#6b7280',
  };
  const color = typeColor[disc.disc_type] ?? '#6b7280';

  return (
    <div
      style={{
        background: `${color}10`,
        border: `1px solid ${color}30`,
        borderRadius: 5,
        padding: '6px 10px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
        <span style={{ color, fontSize: 12 }}>◎</span>
        <span style={{ fontSize: 10, fontWeight: 600, color: '#e5e7eb' }}>
          {typeLabel[disc.disc_type] ?? 'Disc'}
        </span>
        <span style={{ fontSize: 7, color: '#3b82f6', background: 'rgba(59,130,246,0.15)', padding: '0 4px', borderRadius: 3, fontWeight: 700 }}>
          INF
        </span>
      </div>
      <div style={{ fontSize: 9, color: '#9ca3af', fontFamily: "'JetBrains Mono', monospace", display: 'flex', gap: 8 }}>
        <span>{fmtNum(disc.inner_radius_au, 1)}–{fmtNum(disc.outer_radius_au, 1)} AU</span>
        <span>density: {(disc.density * 100).toFixed(0)}%</span>
      </div>
    </div>
  );
}

/* ── HZ bar visualisation ─────────────────────────── */

function OrbitalOverview({ planets, belts, hz }: { planets: Planet[]; belts: Belt[]; hz: HabitableZone }) {
  const allSMAs = planets.map((p) => p.semi_major_axis_au).filter((v): v is number => v != null && v > 0);
  const beltOuters = belts.map((b) => b.outer_radius_au);
  const maxAU = Math.max(...allSMAs, ...beltOuters, hz.outer_au * 2, 5);
  const minAU = 0.01;
  const logScale = (au: number) => {
    if (au <= minAU) return 0;
    return (Math.log10(au) - Math.log10(minAU)) / (Math.log10(maxAU) - Math.log10(minAU));
  };
  const barWidth = 272;

  return (
    <div style={{ position: 'relative', width: barWidth, height: 36, margin: '4px 0' }}>
      <div style={{ position: 'absolute', top: 14, left: 0, width: barWidth, height: 6, background: '#1f2937', borderRadius: 3 }} />
      {/* HZ zone */}
      <div
        style={{
          position: 'absolute', top: 12,
          left: logScale(hz.inner_au) * barWidth,
          width: (logScale(hz.outer_au) - logScale(hz.inner_au)) * barWidth,
          height: 10, background: 'rgba(34,197,94,0.2)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 2,
        }}
        title={`HZ: ${fmtNum(hz.inner_au, 2)}–${fmtNum(hz.outer_au, 2)} AU`}
      />
      {/* Belts */}
      {belts.map((b) => (
        <div
          key={b.belt_id}
          style={{
            position: 'absolute', top: 13,
            left: logScale(b.inner_radius_au) * barWidth,
            width: Math.max(2, (logScale(b.outer_radius_au) - logScale(b.inner_radius_au)) * barWidth),
            height: 8,
            background: b.belt_type === 'icy-kuiper' ? 'rgba(147,197,253,0.15)' : 'rgba(209,163,122,0.15)',
            borderRadius: 2,
          }}
          title={`${b.belt_type}: ${fmtNum(b.inner_radius_au, 1)}–${fmtNum(b.outer_radius_au, 1)} AU`}
        />
      ))}
      {/* Star dot */}
      <div style={{ position: 'absolute', top: 13, left: -2, width: 8, height: 8, borderRadius: '50%', background: '#fbbf24', boxShadow: '0 0 6px #fbbf24' }} />
      {/* Planet dots */}
      {planets.map((p, i) => {
        if (p.semi_major_axis_au == null) return null;
        const color = PLANET_TYPE_COLOR[p.planet_type] ?? '#6b7280';
        const x = logScale(p.semi_major_axis_au) * barWidth;
        const sz = Math.max(4, Math.min(10, (p.radius_earth ?? 1) * 2.5));
        return (
          <div
            key={p.planet_name + i}
            style={{
              position: 'absolute', top: 17 - sz / 2, left: x - sz / 2, width: sz, height: sz,
              borderRadius: '50%', background: color,
              border: p.confidence === 'observed' ? `1.5px solid ${color}` : `1px dashed ${color}88`,
              opacity: p.confidence === 'observed' ? 1 : 0.7,
            }}
            title={`${p.planet_name}: ${fmtNum(p.semi_major_axis_au, 3)} AU`}
          />
        );
      })}
      {/* AU labels */}
      {[0.1, 1, 10, 100].filter((v) => v <= maxAU * 1.2).map((au) => (
        <div
          key={au}
          style={{ position: 'absolute', top: 24, left: logScale(au) * barWidth - 6, fontSize: 7, color: '#4b5563', fontFamily: "'JetBrains Mono', monospace" }}
        >
          {au}
        </div>
      ))}
      <div style={{ position: 'absolute', top: -2, right: 0, fontSize: 7, color: '#374151', fontFamily: "'JetBrains Mono', monospace" }}>
        ORBIT
      </div>
    </div>
  );
}

/* ── Planet Card ──────────────────────────────────── */

function PlanetCard({ planet, hz, isSelected, onSelect }: { planet: Planet; hz: HabitableZone; isSelected: boolean; onSelect: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const color = PLANET_TYPE_COLOR[planet.planet_type] ?? '#6b7280';
  const emoji = PLANET_TYPE_EMOJI[planet.planet_type] ?? '?';
  const conf = CONFIDENCE_BADGE[planet.confidence] ?? CONFIDENCE_BADGE.inferred;
  const inHZ = isInHZ(planet.semi_major_axis_au, hz);

  return (
    <div
      style={{
        background: isSelected ? `${color}12` : 'rgba(31,41,55,0.6)',
        border: `1px solid ${isSelected ? color + '60' : expanded ? color + '40' : '#374151'}`,
        borderRadius: 6,
        overflow: 'hidden',
        transition: 'all 0.2s ease',
        transform: isSelected ? 'scale(1.01)' : 'scale(1)',
      }}
    >
      {/* Header */}
      <button
        onClick={() => { setExpanded(!expanded); onSelect(); }}
        style={{
          width: '100%', background: 'none', border: 'none', padding: '6px 10px',
          display: 'flex', alignItems: 'center', gap: 6,
          cursor: 'pointer', color: '#d1d5db', fontFamily: 'Inter, sans-serif', fontSize: 11, textAlign: 'left',
        }}
      >
        <span style={{ fontSize: 14, lineHeight: 1 }}>{emoji}</span>
        <span style={{ flex: 1, fontWeight: 600, color: '#f3f4f6', fontSize: 11 }}>
          {planet.planet_name.replace(' (inferred)', '')}
        </span>
        <span style={{ background: conf.bg, color: conf.fg, borderRadius: 3, padding: '0 4px', fontSize: 8, fontWeight: 700 }}>{conf.label}</span>
        {inHZ && (
          <span style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e', borderRadius: 3, padding: '0 4px', fontSize: 8, fontWeight: 700 }} title="In habitable zone">HZ</span>
        )}
        <span style={{ background: color + '30', color, borderRadius: 3, padding: '0 5px', fontSize: 8, fontWeight: 700, textTransform: 'capitalize' }}>{planet.planet_type}</span>
        <span style={{ fontSize: 10, transition: 'transform 0.2s', transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', color: '#6b7280' }}>▸</span>
      </button>

      {/* Quick stats */}
      <div style={{ padding: '0 10px 6px', display: 'flex', gap: 10, fontSize: 9, color: '#9ca3af', fontFamily: "'JetBrains Mono', monospace" }}>
        {planet.semi_major_axis_au != null && <span>{fmtNum(planet.semi_major_axis_au, 3)} AU</span>}
        {planet.orbital_period_days != null && <span>{fmtNum(planet.orbital_period_days, 1)} d</span>}
        {planet.mass_earth != null && <span>{fmtNum(planet.mass_earth, 2)} M⊕</span>}
        {planet.radius_earth != null && <span>{fmtNum(planet.radius_earth, 2)} R⊕</span>}
        {planet.temp_calculated_k != null && <span>{fmtTemp(planet.temp_calculated_k)}</span>}
      </div>

      {/* Expanded detail with animated height */}
      <div
        style={{
          maxHeight: expanded ? 500 : 0,
          overflow: 'hidden',
          transition: 'max-height 0.3s ease',
        }}
      >
        <div style={{ padding: '6px 10px 10px', borderTop: '1px solid #1f2937', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px 8px', fontSize: 10 }}>
          <DetailRow label="Mass" value={planet.mass_earth != null ? `${fmtNum(planet.mass_earth)} M⊕` : '—'} />
          <DetailRow label="Radius" value={planet.radius_earth != null ? `${fmtNum(planet.radius_earth)} R⊕` : '—'} />
          <DetailRow label="SMA" value={planet.semi_major_axis_au != null ? `${fmtNum(planet.semi_major_axis_au, 4)} AU` : '—'} />
          <DetailRow label="Period" value={planet.orbital_period_days != null ? `${fmtNum(planet.orbital_period_days, 1)} d` : '—'} />
          <DetailRow label="Eccentricity" value={fmtNum(planet.eccentricity, 3)} />
          <DetailRow label="Inclination" value={planet.inclination_deg != null ? `${fmtNum(planet.inclination_deg, 1)}°` : '—'} />
          <DetailRow label="Temp" value={fmtTemp(planet.temp_calculated_k)} />
          <DetailRow label="Albedo" value={fmtNum(planet.geometric_albedo, 3)} />
          {planet.detection_type && <DetailRow label="Detection" value={planet.detection_type} span2 />}
          {planet.molecules && <DetailRow label="Molecules" value={planet.molecules} span2 />}
          {planet.discovered && <DetailRow label="Discovered" value={planet.discovered} />}
          {planet.mass_source && <DetailRow label="Mass src" value={planet.mass_source.replace('_', ' ')} />}

          {/* Moons */}
          {planet.moons.length > 0 && (
            <div style={{ gridColumn: '1 / -1', marginTop: 4 }}>
              <div style={{ color: '#9ca3af', fontSize: 9, fontWeight: 600, marginBottom: 3, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Moons ({planet.moons.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {planet.moons.map((moon) => {
                  const mc = CONFIDENCE_BADGE[moon.confidence] ?? CONFIDENCE_BADGE.inferred;
                  return (
                    <div key={moon.moon_name} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 4px', borderRadius: 3, background: 'rgba(55,65,81,0.4)', fontSize: 9 }}>
                      <span style={{ color: moon.moon_type === 'icy' ? '#93c5fd' : '#d1a37a' }}>●</span>
                      <span style={{ flex: 1, color: '#d1d5db' }}>{moon.moon_name.replace(' (inferred)', '').split(' ').pop()}</span>
                      <span style={{ color: '#6b7280', fontFamily: "'JetBrains Mono', monospace" }}>{fmtNum(moon.radius_earth, 3)} R⊕</span>
                      <span style={{ color: mc.fg, fontSize: 7 }}>{mc.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function BeltCard({ belt }: { belt: Belt }) {
  const [expanded, setExpanded] = useState(false);
  const isKuiper = belt.belt_type === 'icy-kuiper';
  const color = isKuiper ? '#93c5fd' : '#d1a37a';

  return (
    <div
      style={{
        background: 'rgba(31,41,55,0.4)',
        border: `1px solid ${expanded ? color + '60' : '#1f2937'}`,
        borderRadius: 5,
        transition: 'border-color 0.2s',
      }}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          width: '100%', background: 'none', border: 'none', padding: '5px 10px',
          display: 'flex', alignItems: 'center', gap: 6,
          cursor: 'pointer', color: '#d1d5db', fontFamily: 'Inter, sans-serif', fontSize: 10, textAlign: 'left',
        }}
      >
        <span style={{ color, fontSize: 12 }}>◌</span>
        <span style={{ flex: 1, fontWeight: 600, color: '#e5e7eb', fontSize: 10 }}>
          {isKuiper ? 'Kuiper Belt' : 'Asteroid Belt'}
        </span>
        <span style={{ color: '#6b7280', fontSize: 9, fontFamily: "'JetBrains Mono', monospace" }}>
          {fmtNum(belt.inner_radius_au, 1)}–{fmtNum(belt.outer_radius_au, 1)} AU
        </span>
        <span style={{ fontSize: 10, transition: 'transform 0.2s', transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', color: '#6b7280' }}>▸</span>
      </button>
      <div style={{ maxHeight: expanded ? 300 : 0, overflow: 'hidden', transition: 'max-height 0.3s ease' }}>
        <div style={{ padding: '4px 10px 8px', borderTop: '1px solid #1f2937' }}>
          <div style={{ fontSize: 9, color: '#6b7280', marginBottom: 4 }}>~{belt.estimated_bodies.toLocaleString()} bodies</div>
          {belt.major_asteroids.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {belt.major_asteroids.slice(0, 8).map((a) => (
                <div key={a.name} style={{ display: 'flex', gap: 6, fontSize: 9, color: '#9ca3af', fontFamily: "'JetBrains Mono', monospace" }}>
                  <span style={{ color, minWidth: 8 }}>·</span>
                  <span style={{ flex: 1, color: '#d1d5db' }}>{a.name}</span>
                  <span>{fmtNum(a.diameter_km, 0)} km</span>
                  <span style={{ color: '#6b7280' }}>{a.spectral_class}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value, span2 }: { label: string; value: string; span2?: boolean }) {
  return (
    <div style={span2 ? { gridColumn: '1 / -1' } : undefined}>
      <div style={{ color: '#4b5563', fontSize: 8, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5 }}>{label}</div>
      <div style={{ color: '#d1d5db', marginTop: 1, fontSize: 10 }}>{value}</div>
    </div>
  );
}

/* ── Single Star Content ─────────────────────────── */
/* The content panel for one star within the system group */

function StarContent({
  starData,
  selectedPlanet,
  onSelectPlanet,
  onFullscreen,
}: {
  starData: StarSystemData;
  selectedPlanet: string | null;
  onSelectPlanet: (name: string | null) => void;
  onFullscreen?: () => void;
}) {
  const { planets, belts, habitable_zone: hz, protoplanetary_disc: disc, summary } = starData;

  const sortedPlanets = useMemo(
    () => [...planets].sort((a, b) => (a.semi_major_axis_au ?? 999) - (b.semi_major_axis_au ?? 999)),
    [planets],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {/* Summary badges */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {summary.observed_planets > 0 && (
          <span style={{ background: 'rgba(16,185,129,0.12)', color: '#10b981', borderRadius: 4, padding: '1px 6px', fontSize: 9, fontWeight: 600 }}>
            {summary.observed_planets} observed
          </span>
        )}
        {summary.inferred_planets > 0 && (
          <span style={{ background: 'rgba(59,130,246,0.12)', color: '#3b82f6', borderRadius: 4, padding: '1px 6px', fontSize: 9, fontWeight: 600 }}>
            {summary.inferred_planets} inferred
          </span>
        )}
        {belts.length > 0 && (
          <span style={{ background: 'rgba(209,163,122,0.12)', color: '#d1a37a', borderRadius: 4, padding: '1px 6px', fontSize: 9, fontWeight: 600 }}>
            {belts.length} belt{belts.length > 1 ? 's' : ''}
          </span>
        )}
        {disc && (
          <span style={{ background: 'rgba(167,139,250,0.12)', color: '#a78bfa', borderRadius: 4, padding: '1px 6px', fontSize: 9, fontWeight: 600 }}>
            {disc.disc_type}
          </span>
        )}
      </div>

      {/* 3D Orrery scene */}
      {sortedPlanets.length > 0 && (
        <div style={{ position: 'relative' }}>
          <Suspense
            fallback={<div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4b5563', fontSize: 10 }}>Loading orrery…</div>}
          >
            <OrreryScene
              planets={sortedPlanets}
              belts={belts}
              hz={hz}
              disc={disc}
              starColor={starColor(starData.star.spectral_class)}
            />
          </Suspense>
          {/* Fullscreen button */}
          {onFullscreen && (
            <button
              onClick={onFullscreen}
              title="Open fullscreen system viewer"
              style={{
                position: 'absolute', top: 4, left: 6,
                background: 'rgba(17,24,39,0.85)', border: '1px solid #374151',
                borderRadius: 4, padding: '2px 6px',
                cursor: 'pointer', color: '#6b7280', fontSize: 10,
                transition: 'color 0.2s',
                zIndex: 5,
              }}
              onMouseEnter={(e) => ((e.target as HTMLElement).style.color = '#e5e7eb')}
              onMouseLeave={(e) => ((e.target as HTMLElement).style.color = '#6b7280')}
            >
              ⛶
            </button>
          )}
        </div>
      )}

      {/* Visualisation strips */}
      {sortedPlanets.length > 0 && (
        <>
          <OrbitalOverview planets={sortedPlanets} belts={belts} hz={hz} />
          <PlanetScaleBar planets={sortedPlanets} />
          <PeriodTimeline planets={sortedPlanets} />
        </>
      )}

      {/* HZ info */}
      <div style={{ fontSize: 9, color: '#6b7280', fontFamily: "'JetBrains Mono', monospace" }}>
        Habitable zone: {fmtNum(hz.inner_au, 2)}–{fmtNum(hz.outer_au, 2)} AU
      </div>

      {/* Disc card */}
      {disc && <DiscCard disc={disc} />}

      {/* Planet cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {sortedPlanets.map((p, i) => (
          <PlanetCard
            key={p.planet_name + i}
            planet={p}
            hz={hz}
            isSelected={selectedPlanet === p.planet_name}
            onSelect={() => onSelectPlanet(selectedPlanet === p.planet_name ? null : p.planet_name)}
          />
        ))}
      </div>

      {/* Belt cards */}
      {belts.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {belts.map((b) => <BeltCard key={b.belt_id} belt={b} />)}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   ██  Main SystemDetailPanel v2
   ═══════════════════════════════════════════════════════ */

interface Props {
  mainId: string;
  expanded: boolean;
  onToggle: () => void;
  /** Called when user clicks fullscreen button */
  onFullscreen?: (mainId: string) => void;
}

export default function SystemDetailPanel({ mainId, expanded, onToggle, onFullscreen }: Props) {
  const [groupData, setGroupData] = useState<SystemGroupResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeStarIndex, setActiveStarIndex] = useState(0);
  const [selectedPlanet, setSelectedPlanet] = useState<string | null>(null);
  const [lastMainId, setLastMainId] = useState<string | null>(null);

  // Load system group data (or single star fallback)
  useEffect(() => {
    if (!expanded) return;
    if (groupData && lastMainId === mainId) return;

    setLoading(true);
    setError(null);

    // First try to get the star to check for system_group
    getSystemDetail(mainId)
      .then((singleResp) => {
        const group = singleResp.star.system_group;
        if (group) {
          // Multi-star: load group
          return getSystemGroup(group).then((groupResp) => {
            setGroupData(groupResp);
            // Set active tab to the selected star
            const idx = groupResp.stars.findIndex((sd) => sd.star.main_id === mainId);
            setActiveStarIndex(idx >= 0 ? idx : 0);
            setLastMainId(mainId);
            setLoading(false);
          });
        } else {
          // Single star: wrap in group-like structure
          setGroupData({
            group_name: mainId,
            hierarchy: null,
            star_count: 1,
            stars: [{
              star: singleResp.star,
              planets: singleResp.planets,
              belts: singleResp.belts,
              habitable_zone: singleResp.habitable_zone,
              protoplanetary_disc: singleResp.protoplanetary_disc,
              summary: singleResp.summary,
            }],
            group_summary: {
              total_stars: 1,
              total_planets: singleResp.summary.total_planets,
              total_moons: singleResp.summary.total_moons,
              total_belts: singleResp.summary.total_belts,
            },
          });
          setActiveStarIndex(0);
          setLastMainId(mainId);
          setLoading(false);
        }
      })
      .catch((err: any) => {
        setError(err?.response?.data?.error ?? 'Failed to load system detail');
        setLoading(false);
      });
  }, [mainId, expanded]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset when star changes
  useEffect(() => {
    if (mainId !== lastMainId) {
      setGroupData(null);
      setError(null);
      setSelectedPlanet(null);
    }
  }, [mainId]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeStar = groupData?.stars[activeStarIndex] ?? null;

  const totalSummary = useMemo(() => {
    if (!groupData) return null;
    return groupData.group_summary;
  }, [groupData]);

  const handleFullscreen = useCallback(() => {
    if (onFullscreen && activeStar) {
      onFullscreen(activeStar.star.main_id);
    }
  }, [onFullscreen, activeStar]);

  return (
    <div style={{ borderTop: '1px solid #1f2937' }}>
      {/* Accordion header */}
      <button
        onClick={onToggle}
        style={{
          width: '100%', background: 'none', border: 'none', padding: '8px 16px',
          display: 'flex', alignItems: 'center', gap: 6,
          cursor: 'pointer', color: '#9ca3af', fontSize: 11, fontWeight: 600,
          fontFamily: 'Inter, sans-serif', textAlign: 'left',
        }}
      >
        <span style={{ color: '#22d3ee', fontSize: 12 }}>⊙</span>
        <span style={{ flex: 1 }}>
          Orbits &amp; Worlds
          {totalSummary && (
            <span style={{ fontWeight: 400, color: '#6b7280', marginLeft: 4, fontSize: 10 }}>
              ({totalSummary.total_planets} planet{totalSummary.total_planets !== 1 ? 's' : ''}
              {groupData && groupData.star_count > 1 ? ` · ${groupData.star_count} stars` : ''}
              {totalSummary.total_moons > 0 ? ` · ${totalSummary.total_moons} moon${totalSummary.total_moons !== 1 ? 's' : ''}` : ''})
            </span>
          )}
        </span>
        <span style={{ fontSize: 10, transition: 'transform 0.2s', transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>▸</span>
      </button>

      {/* Expanded body — animated */}
      <div
        style={{
          maxHeight: expanded ? 3000 : 0,
          overflow: 'hidden',
          transition: 'max-height 0.4s ease',
        }}
      >
        <div style={{ padding: '0 16px 12px' }}>
          {loading && <div style={{ color: '#6b7280', fontSize: 10, padding: '8px 0' }}>Loading planetary system…</div>}
          {error && <div style={{ color: '#ef4444', fontSize: 10, padding: '8px 0' }}>{error}</div>}
          {groupData && !loading && (
            <>
              {/* Breadcrumbs */}
              <Breadcrumbs
                groupName={groupData.star_count > 1 ? groupData.group_name : null}
                starName={activeStar?.star.main_id ?? ''}
                planetName={selectedPlanet}
                onClearPlanet={() => setSelectedPlanet(null)}
              />

              {/* System census strip */}
              <SystemCensus stars={groupData.stars} />

              {/* Hierarchy badge for multi-star */}
              {groupData.hierarchy && (
                <div style={{
                  fontSize: 9, color: '#6b7280', padding: '2px 6px',
                  background: 'rgba(59,130,246,0.06)', borderRadius: 4,
                  fontFamily: "'JetBrains Mono', monospace", marginBottom: 4,
                  display: 'inline-block',
                }}>
                  {groupData.hierarchy}
                </div>
              )}

              {/* Star tabs for multi-star systems */}
              <StarTabs
                stars={groupData.stars}
                activeIndex={activeStarIndex}
                onSelect={(i) => { setActiveStarIndex(i); setSelectedPlanet(null); }}
              />

              {/* Active star content */}
              {activeStar && (
                <div style={{ paddingTop: 6 }}>
                  <StarContent
                    starData={activeStar}
                    selectedPlanet={selectedPlanet}
                    onSelectPlanet={setSelectedPlanet}
                    onFullscreen={onFullscreen ? handleFullscreen : undefined}
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
