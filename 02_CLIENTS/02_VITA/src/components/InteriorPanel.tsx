/**
 * InteriorPanel — Visualizes the 4-layer planetary interior structure
 * computed by the Rust shooting-method solver.
 *
 * Features:
 *   - Cross-section SVG diagram with radial layers
 *   - Pressure/density/temperature radial profiles
 *   - Layer boundary annotations
 */

import { useMemo } from 'react';
import type { InteriorProfile } from '../hooks/useScience';

interface Props {
  profile: InteriorProfile | null;
  planetName?: string;
}

const LAYER_COLORS: Record<string, string> = {
  'Iron Core': '#a0522d',
  'Silicate Mantle': '#b8860b',
  'Water/Ice Layer': '#4682b4',
  'H/He Envelope': '#9370db',
};

const LAYER_COLORS_BY_INDEX = ['#a0522d', '#b8860b', '#4682b4', '#9370db'];

export function InteriorPanel({ profile, planetName }: Props) {
  if (!profile) {
    return (
      <div style={{ color: '#556677', fontSize: 12, padding: 16 }}>
        No interior structure data. Select a planet to compute.
      </div>
    );
  }

  const layers = useMemo(() => {
    const bounds = profile.layer_boundary_km;
    const maxR = bounds[bounds.length - 1] || 1;
    const names = profile.layer_names;
    return names.map((name, i) => ({
      name,
      innerRadius: i === 0 ? 0 : bounds[i - 1],
      outerRadius: bounds[i],
      fraction: bounds[i] / maxR,
      color: LAYER_COLORS[name] || LAYER_COLORS_BY_INDEX[i] || '#666',
    }));
  }, [profile]);

  const maxRadius = profile.layer_boundary_km[profile.layer_boundary_km.length - 1] || 1;

  return (
    <div style={{ fontSize: 12 }}>
      <h3 style={{ fontSize: 14, marginBottom: 12, color: '#e8edf5' }}>
        Interior Structure {planetName && `— ${planetName}`}
      </h3>

      {/* Cross-section SVG */}
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
        <svg width={180} height={180} viewBox="-100 -100 200 200">
          {[...layers].reverse().map((layer, _i) => {
            const r = (layer.outerRadius / maxRadius) * 85;
            return (
              <circle
                key={layer.name}
                cx={0}
                cy={0}
                r={Math.max(r, 2)}
                fill={layer.color}
                stroke="#0a0e17"
                strokeWidth={1}
                opacity={0.85}
              />
            );
          })}
          {/* Center dot */}
          <circle cx={0} cy={0} r={3} fill="#ffcc44" />
        </svg>
      </div>

      {/* Layer table */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
        <thead>
          <tr style={{ color: '#8899aa', fontSize: 10, textAlign: 'left' }}>
            <th style={{ padding: '2px 4px' }}>Layer</th>
            <th style={{ padding: '2px 4px', textAlign: 'right' }}>Radius (km)</th>
            <th style={{ padding: '2px 4px', textAlign: 'right' }}>Fraction</th>
          </tr>
        </thead>
        <tbody>
          {layers.map(layer => (
            <tr key={layer.name}>
              <td style={{ padding: '2px 4px', display: 'flex', alignItems: 'center', gap: 4 }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: layer.color,
                    display: 'inline-block',
                  }}
                />
                {layer.name}
              </td>
              <td style={{ padding: '2px 4px', textAlign: 'right', color: '#aabbcc' }}>
                {Math.round(layer.outerRadius).toLocaleString()}
              </td>
              <td style={{ padding: '2px 4px', textAlign: 'right', color: '#aabbcc' }}>
                {(layer.fraction * 100).toFixed(1)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Key metrics */}
      <div style={{ borderTop: '1px solid #1e3050', paddingTop: 8 }}>
        <MetricRow label="Core Radius" value={`${(profile.core_radius_fraction * 100).toFixed(1)}% of total`} />
        <MetricRow label="Central Pressure" value={`${profile.central_pressure_gpa.toFixed(0)} GPa`} />
        <MetricRow label="Central Temperature" value={`${Math.round(profile.central_temperature_k).toLocaleString()} K`} />
        <MetricRow label="Surface Gravity" value={`${profile.surface_gravity_m_s2.toFixed(1)} m/s²`} />
        <MetricRow
          label="Convergence"
          value={profile.convergence_info.converged ? '✓ converged' : `✗ (${profile.convergence_info.iterations} iter)`}
          color={profile.convergence_info.converged ? '#4ade80' : '#f97316'}
        />
      </div>

      {/* Mini radial profiles */}
      <div style={{ marginTop: 12 }}>
        <h4 style={{ fontSize: 11, color: '#8899aa', marginBottom: 6 }}>Radial Profiles</h4>
        <ProfileMiniChart
          data={profile.pressure_gpa}
          label="Pressure (GPa)"
          color="#f59e0b"
          maxLabel={`${Math.round(Math.max(...profile.pressure_gpa))} GPa`}
        />
        <ProfileMiniChart
          data={profile.density_kg_m3}
          label="Density (kg/m³)"
          color="#3b82f6"
          maxLabel={`${Math.round(Math.max(...profile.density_kg_m3))} kg/m³`}
        />
        <ProfileMiniChart
          data={profile.temperature_k}
          label="Temperature (K)"
          color="#ef4444"
          maxLabel={`${Math.round(Math.max(...profile.temperature_k))} K`}
        />
      </div>
    </div>
  );
}

function MetricRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
      <span style={{ color: '#8899aa' }}>{label}</span>
      <span style={{ color: color || '#e8edf5' }}>{value}</span>
    </div>
  );
}

function ProfileMiniChart({
  data,
  label,
  color,
  maxLabel,
}: {
  data: number[];
  label: string;
  color: string;
  maxLabel: string;
}) {
  if (!data.length) return null;

  const max = Math.max(...data);
  const step = Math.max(1, Math.floor(data.length / 80));
  const points = data
    .filter((_, i) => i % step === 0)
    .map((v, i, arr) => {
      const x = (i / (arr.length - 1)) * 100;
      const y = 100 - (v / (max || 1)) * 100;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
        <span style={{ color: '#667788' }}>{label}</span>
        <span style={{ color }}>{maxLabel}</span>
      </div>
      <svg width="100%" height={30} viewBox="0 0 100 100" preserveAspectRatio="none">
        <polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}
