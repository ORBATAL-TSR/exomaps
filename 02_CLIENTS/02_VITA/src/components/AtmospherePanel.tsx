/**
 * AtmospherePanel — Displays atmospheric and geological data
 * from the GPU inference pipeline.
 */

import React from 'react';
import type { PlanetTextures } from '../hooks/useTauriGPU';

interface Props {
  planet: any;
  textures: PlanetTextures | null;
}

export function AtmospherePanel({ planet, textures }: Props) {
  if (!planet) {
    return (
      <div style={{ color: '#556677', fontSize: 12 }}>
        No planet selected
      </div>
    );
  }

  const atm = textures?.atmosphere;

  return (
    <div style={{ fontSize: 12 }}>
      {/* Atmosphere section */}
      <h3 style={{ fontSize: 14, marginBottom: 12, color: '#e8edf5' }}>
        Atmosphere
      </h3>

      {atm ? (
        <>
          {/* Rayleigh sky color swatch */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 12,
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                background: `rgb(${Math.round(atm.rayleigh_color[0] * 255)}, ${Math.round(atm.rayleigh_color[1] * 255)}, ${Math.round(atm.rayleigh_color[2] * 255)})`,
                border: '1px solid #1e3050',
              }}
            />
            <div>
              <div style={{ color: '#aabbcc' }}>Rayleigh Scattering Color</div>
              <div style={{ color: '#556677', fontSize: 10 }}>
                Dominant gas: {atm.dominant_gas}
              </div>
            </div>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              <AtmRow
                label="Surface Pressure"
                value={formatPressure(atm.surface_pressure_bar)}
              />
              <AtmRow
                label="Surface Temperature"
                value={`${Math.round(atm.surface_temp_k)} K (${Math.round(atm.surface_temp_k - 273.15)}°C)`}
              />
              <AtmRow
                label="Equilibrium Temp"
                value={`${Math.round(atm.equilibrium_temp_k)} K`}
              />
              <AtmRow
                label="Greenhouse ΔT"
                value={`+${Math.round(atm.greenhouse_delta_k)} K`}
              />
              <AtmRow
                label="Scale Height"
                value={`${atm.scale_height_km.toFixed(1)} km`}
              />
              <AtmRow
                label="Mean Molecular Weight"
                value={`${atm.mean_molecular_weight.toFixed(1)} g/mol`}
              />
            </tbody>
          </table>

          {/* Species breakdown */}
          {atm.species.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <h4 style={{ fontSize: 11, color: '#8899aa', marginBottom: 6 }}>
                Atmospheric Composition
              </h4>
              {atm.species.map(sp => (
                <div
                  key={sp.name}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '2px 0',
                    color: '#aabbcc',
                  }}
                >
                  <span>{sp.name}</span>
                  <span style={{ color: '#e8edf5' }}>
                    {sp.fraction >= 0.01
                      ? `${(sp.fraction * 100).toFixed(1)}%`
                      : `${(sp.fraction * 1e6).toFixed(0)} ppm`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <div style={{ color: '#556677', fontSize: 11 }}>
          Generating atmosphere model…
        </div>
      )}

      {/* Habitable zone indicator */}
      {planet.pl_orbsmax != null && (
        <div style={{ marginTop: 16 }}>
          <h4 style={{ fontSize: 11, color: '#8899aa', marginBottom: 6 }}>
            Habitable Zone
          </h4>
          <div
            style={{
              padding: '6px 10px',
              background: '#162030',
              borderRadius: 4,
              color: planet.in_hz ? '#4caf50' : '#ff9800',
              fontSize: 12,
            }}
          >
            {planet.in_hz
              ? '✓ Within conservative habitable zone'
              : planet.hz_optimistic
                ? '◉ Within optimistic habitable zone'
                : '✗ Outside habitable zone'}
          </div>
        </div>
      )}
    </div>
  );
}

function AtmRow({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <td style={{ padding: '3px 0', color: '#8899aa' }}>{label}</td>
      <td style={{ padding: '3px 0', textAlign: 'right', color: '#e8edf5' }}>
        {value}
      </td>
    </tr>
  );
}

function formatPressure(bar: number): string {
  if (bar < 0.001) return `${(bar * 1e6).toFixed(0)} μbar`;
  if (bar < 1) return `${(bar * 1000).toFixed(1)} mbar`;
  if (bar > 1000) return `${(bar / 1000).toFixed(0)} kbar`;
  return `${bar.toFixed(2)} bar`;
}
