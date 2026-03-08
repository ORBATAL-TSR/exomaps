/**
 * CompositionPanel — Displays bulk composition data from the
 * GPU inference pipeline (Zeng et al. 2019 mass-radius relations).
 */

import React from 'react';
import type { PlanetTextures } from '../hooks/useTauriGPU';

interface Props {
  planet: any;
  textures: PlanetTextures | null;
  systemData: any;
}

const COMP_COLORS: Record<string, string> = {
  iron: '#a0522d',
  silicate: '#b8860b',
  volatile: '#4682b4',
  h_he: '#9370db',
};

const COMP_LABELS: Record<string, string> = {
  iron: 'Iron Core',
  silicate: 'Silicate Mantle',
  volatile: 'Volatiles / Water',
  h_he: 'H/He Envelope',
};

export function CompositionPanel({ planet, textures, systemData: _systemData }: Props) {
  if (!planet) {
    return (
      <div style={{ color: '#556677', fontSize: 12 }}>
        No planet selected
      </div>
    );
  }

  const comp = textures?.composition;

  return (
    <div style={{ fontSize: 12  }}>
      {/* Planet properties */}
      <h3 style={{ fontSize: 14, marginBottom: 12, color: '#e8edf5' }}>
        {planet.pl_name || 'Unknown Planet'}
      </h3>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          <PropertyRow label="Type" value={textures?.planet_type ?? planet.planet_type ?? '—'} />
          <PropertyRow
            label="Mass"
            value={planet.pl_bmasse != null ? `${planet.pl_bmasse.toFixed(2)} M⊕` : '—'}
          />
          <PropertyRow
            label="Radius"
            value={planet.pl_rade != null ? `${planet.pl_rade.toFixed(2)} R⊕` : '—'}
          />
          <PropertyRow
            label="Orbital Period"
            value={planet.pl_orbper != null ? `${planet.pl_orbper.toFixed(2)} d` : '—'}
          />
          <PropertyRow
            label="Semi-major Axis"
            value={planet.pl_orbsmax != null ? `${planet.pl_orbsmax.toFixed(4)} AU` : '—'}
          />
          <PropertyRow
            label="Eccentricity"
            value={planet.pl_orbeccen != null ? planet.pl_orbeccen.toFixed(4) : '—'}
          />
          {planet.pl_eqt != null && (
            <PropertyRow label="Equilibrium Temp" value={`${Math.round(planet.pl_eqt)} K`} />
          )}
        </tbody>
      </table>

      {/* Composition breakdown */}
      {comp && (
        <div style={{ marginTop: 16 }}>
          <h4 style={{ fontSize: 12, color: '#8899aa', marginBottom: 8 }}>
            Bulk Composition (inferred)
          </h4>

          {/* Visual bar */}
          <div
            style={{
              height: 16,
              borderRadius: 8,
              overflow: 'hidden',
              display: 'flex',
              marginBottom: 8,
            }}
          >
            {(['iron', 'silicate', 'volatile', 'h_he'] as const).map(key => {
              const frac = comp[`${key}_fraction` as keyof typeof comp] as number;
              if (frac < 0.01) return null;
              return (
                <div
                  key={key}
                  style={{
                    flex: frac,
                    background: COMP_COLORS[key],
                    transition: 'flex 0.5s ease',
                  }}
                />
              );
            })}
          </div>

          {/* Legend */}
          {(['iron', 'silicate', 'volatile', 'h_he'] as const).map(key => {
            const frac = comp[`${key}_fraction` as keyof typeof comp] as number;
            if (frac < 0.01) return null;
            return (
              <div
                key={key}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: 4,
                }}
              >
                <div
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 2,
                    background: COMP_COLORS[key],
                  }}
                />
                <span style={{ color: '#aabbcc' }}>
                  {COMP_LABELS[key]}
                </span>
                <span style={{ marginLeft: 'auto', color: '#e8edf5' }}>
                  {(frac * 100).toFixed(1)}%
                </span>
              </div>
            );
          })}

          <div style={{ marginTop: 8, color: '#556677', fontSize: 10 }}>
            Confidence: {((comp.confidence ?? 0) * 100).toFixed(0)}% ·
            Dominant: {comp.dominant_component}
          </div>
        </div>
      )}

      {!comp && (
        <div style={{ marginTop: 16, color: '#556677', fontSize: 11 }}>
          Generating composition data…
        </div>
      )}
    </div>
  );
}

function PropertyRow({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <td style={{ padding: '3px 0', color: '#8899aa' }}>{label}</td>
      <td style={{ padding: '3px 0', textAlign: 'right', color: '#e8edf5' }}>
        {value}
      </td>
    </tr>
  );
}
