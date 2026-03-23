/**
 * ClimatePanel — Displays global climate equilibrium state
 * from the Rust ice-albedo + HZ solver.
 *
 * Features:
 *   - Climate regime badge (Snowball/Temperate/Runaway etc.)
 *   - Habitable zone boundaries
 *   - Temperature distribution (day/night, pole/equator)
 *   - Ice coverage visualization
 */

import type { ClimateState } from '../hooks/useScience';

interface Props {
  climate: ClimateState | null;
  smaAu?: number;
  planetName?: string;
}

const REGIME_STYLES: Record<string, { bg: string; fg: string; icon: string }> = {
  Snowball:     { bg: '#1e3a5f', fg: '#93c5fd', icon: '🧊' },
  PartialIce:   { bg: '#1e3050', fg: '#7dd3fc', icon: '❄️' },
  Temperate:    { bg: '#14532d', fg: '#4ade80', icon: '🌍' },
  MoistGreenhouse: { bg: '#713f12', fg: '#fbbf24', icon: '🌡️' },
  RunawayGreenhouse: { bg: '#7f1d1d', fg: '#f87171', icon: '🔥' },
  NoAtmosphere: { bg: '#1c1917', fg: '#78716c', icon: '🌑' },
  GasGiant:     { bg: '#312e81', fg: '#a5b4fc', icon: '🪐' },
};

export function ClimatePanel({ climate, smaAu, planetName }: Props) {
  if (!climate) {
    return (
      <div style={{ color: '#556677', fontSize: 12, padding: 16 }}>
        No climate data. Select a planet to compute.
      </div>
    );
  }

  const style = REGIME_STYLES[climate.regime] || REGIME_STYLES.Temperate;

  return (
    <div style={{ fontSize: 12 }}>
      <h3 style={{ fontSize: 14, marginBottom: 12, color: '#e8edf5' }}>
        Climate {planetName && `— ${planetName}`}
      </h3>

      {/* Regime badge */}
      <div
        style={{
          background: style.bg,
          color: style.fg,
          borderRadius: 8,
          padding: '8px 12px',
          marginBottom: 12,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        <span style={{ fontSize: 20 }}>{style.icon}</span>
        <div>
          <div>{climate.regime.replace(/([A-Z])/g, ' $1').trim()}</div>
          <div style={{ fontSize: 10, opacity: 0.7, fontWeight: 400 }}>
            Kopparapu zone: {climate.kopparapu_zone}
          </div>
        </div>
      </div>

      {/* Habitable Zone diagram */}
      <HZDiagram
        innerAu={climate.hz_inner_au}
        outerAu={climate.hz_outer_au}
        planetAu={smaAu}
        inHZ={climate.in_habitable_zone}
      />

      {/* Temperature summary */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12 }}>
        <tbody>
          <ClimateRow label="Mean Surface Temp" value={formatTemp(climate.surface_temp_mean_k)} />
          <ClimateRow label="Dayside Temp" value={formatTemp(climate.surface_temp_day_k)} />
          <ClimateRow label="Nightside Temp" value={formatTemp(climate.surface_temp_night_k)} />
          <ClimateRow label="Equator Temp" value={formatTemp(climate.equator_temp_k)} />
          <ClimateRow label="Polar Temp" value={formatTemp(climate.polar_temp_k)} />
          <ClimateRow label="Greenhouse Warming" value={`+${Math.round(climate.greenhouse_warming_k)} K`} />
        </tbody>
      </table>

      {/* Ice & habitability */}
      <div style={{ marginTop: 12, borderTop: '1px solid #1e3050', paddingTop: 8 }}>
        <MetricBar label="Ice Coverage" value={climate.ice_fraction} color="#93c5fd" />
        <MetricBar label="Habitable Fraction" value={climate.habitable_fraction} color="#4ade80" />
        <MetricBar label="Bond Albedo" value={climate.bond_albedo_effective} color="#fbbf24" />
      </div>

      {/* Additional data */}
      {climate.tidal_heating_w_m2 > 0 && (
        <div style={{ marginTop: 8, color: '#f97316', fontSize: 11 }}>
          ⚡ Tidal heating: {climate.tidal_heating_w_m2.toFixed(3)} W/m²
        </div>
      )}
    </div>
  );
}

/* ── Habitable Zone mini-diagram ─────────────────── */

function HZDiagram({
  innerAu,
  outerAu,
  planetAu,
  inHZ,
}: {
  innerAu: number;
  outerAu: number;
  planetAu?: number;
  inHZ: boolean;
}) {
  const maxAu = outerAu * 1.8;
  const toX = (au: number) => (au / maxAu) * 100;

  return (
    <div>
      <div style={{ fontSize: 10, color: '#667788', marginBottom: 2 }}>Habitable Zone</div>
      <svg width="100%" height={28} viewBox="0 0 100 28">
        {/* Star */}
        <circle cx={1} cy={14} r={4} fill="#fff5e0" />
        {/* HZ band */}
        <rect
          x={toX(innerAu)}
          y={4}
          width={toX(outerAu) - toX(innerAu)}
          height={20}
          rx={4}
          fill="#14532d"
          opacity={0.4}
        />
        {/* Inner/outer edges */}
        <line x1={toX(innerAu)} y1={2} x2={toX(innerAu)} y2={26} stroke="#4ade80" strokeWidth={0.5} opacity={0.6} />
        <line x1={toX(outerAu)} y1={2} x2={toX(outerAu)} y2={26} stroke="#4ade80" strokeWidth={0.5} opacity={0.6} />
        {/* Planet position */}
        {planetAu != null && (
          <circle
            cx={toX(planetAu)}
            cy={14}
            r={3}
            fill={inHZ ? '#4ade80' : '#f87171'}
            stroke="#0a0e17"
            strokeWidth={1}
          />
        )}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#556677' }}>
        <span>0 AU</span>
        <span>{innerAu.toFixed(2)} AU</span>
        <span>{outerAu.toFixed(2)} AU</span>
      </div>
    </div>
  );
}

/* ── Helpers ─────────────────────────────────────── */

function formatTemp(k: number): string {
  return `${Math.round(k)} K (${Math.round(k - 273.15)}°C)`;
}

function ClimateRow({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <td style={{ padding: '2px 4px', color: '#8899aa' }}>{label}</td>
      <td style={{ padding: '2px 4px', textAlign: 'right', color: '#e8edf5' }}>{value}</td>
    </tr>
  );
}

function MetricBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
        <span style={{ color: '#8899aa' }}>{label}</span>
        <span style={{ color }}>{(value * 100).toFixed(1)}%</span>
      </div>
      <div style={{ height: 4, borderRadius: 2, background: '#1e3050' }}>
        <div
          style={{
            height: '100%',
            borderRadius: 2,
            background: color,
            width: `${Math.min(value * 100, 100)}%`,
            transition: 'width 0.3s ease',
          }}
        />
      </div>
    </div>
  );
}
