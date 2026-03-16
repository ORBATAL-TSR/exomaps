/**
 * AtmosphereV2Panel — Displays the full radiative-convective
 * atmospheric profile from the v2 solver.
 *
 * Features:
 *   - P-T profile (mini chart)
 *   - Species mixing ratios
 *   - OLR / ASR energy balance
 *   - Convergence status
 */

import type { AtmosphericProfile } from '../hooks/useScience';

interface Props {
  profile: AtmosphericProfile | null;
  planetName?: string;
}

export function AtmosphereV2Panel({ profile, planetName }: Props) {
  if (!profile) {
    return (
      <div style={{ color: '#556677', fontSize: 12, padding: 16 }}>
        No atmospheric profile. Select a planet to compute.
      </div>
    );
  }

  const s = profile.summary;

  return (
    <div style={{ fontSize: 12 }}>
      <h3 style={{ fontSize: 14, marginBottom: 12, color: '#e8edf5' }}>
        Atmospheric Profile {planetName && `— ${planetName}`}
      </h3>

      {/* Rayleigh sky color */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: `rgb(${Math.round(s.rayleigh_color[0] * 255)}, ${Math.round(s.rayleigh_color[1] * 255)}, ${Math.round(s.rayleigh_color[2] * 255)})`,
            border: '1px solid #1e3050',
          }}
        />
        <div>
          <div style={{ color: '#aabbcc', fontSize: 11 }}>Sky Color (Rayleigh Scattering)</div>
          <div style={{ color: '#556677', fontSize: 10 }}>Dominant: {s.dominant_gas}</div>
        </div>
      </div>

      {/* Key metrics */}
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          <Row label="Surface Pressure" value={formatPressure(s.surface_pressure_bar)} />
          <Row label="Surface Temperature" value={`${Math.round(s.surface_temp_k)} K (${Math.round(s.surface_temp_k - 273.15)}°C)`} />
          <Row label="Equilibrium Temp" value={`${Math.round(s.equilibrium_temp_k)} K`} />
          <Row label="Greenhouse ΔT" value={`+${Math.round(s.greenhouse_delta_k)} K`} />
          <Row label="Tropopause" value={`${Math.round(s.tropopause_temp_k)} K @ ${s.tropopause_altitude_km.toFixed(1)} km`} />
          <Row label="Scale Height" value={`${s.scale_height_km.toFixed(1)} km`} />
          <Row label="Mean Mol. Weight" value={`${s.mean_molecular_weight.toFixed(1)} g/mol`} />
          <Row label="Bond Albedo" value={s.bond_albedo.toFixed(3)} />
        </tbody>
      </table>

      {/* Energy Balance */}
      <div style={{ marginTop: 12, borderTop: '1px solid #1e3050', paddingTop: 8 }}>
        <h4 style={{ fontSize: 11, color: '#8899aa', marginBottom: 6 }}>Energy Balance</h4>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <div>
            <div style={{ color: '#f59e0b', fontSize: 18, fontWeight: 600 }}>
              {s.asr_w_m2.toFixed(1)}
            </div>
            <div style={{ color: '#667788', fontSize: 9 }}>Absorbed SW (W/m²)</div>
          </div>
          <div style={{ textAlign: 'center', color: '#556677', alignSelf: 'center' }}>⇌</div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ color: '#ef4444', fontSize: 18, fontWeight: 600 }}>
              {s.olr_w_m2.toFixed(1)}
            </div>
            <div style={{ color: '#667788', fontSize: 9 }}>OLR (W/m²)</div>
          </div>
        </div>
        <div style={{ fontSize: 10, color: '#556677', marginTop: 4, textAlign: 'center' }}>
          Imbalance: {profile.convergence.final_imbalance_w_m2.toFixed(3)} W/m²
          {' '}{profile.convergence.converged ? '✓' : '✗'}
          {' '}({profile.convergence.iterations} iter, {profile.convergence.method})
        </div>
      </div>

      {/* P-T profile mini chart */}
      <div style={{ marginTop: 12 }}>
        <h4 style={{ fontSize: 11, color: '#8899aa', marginBottom: 4 }}>P-T Profile</h4>
        <PTChart pressures={profile.pressure_bar} temperatures={profile.temperature_k} />
      </div>

      {/* Species */}
      {s.species.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <h4 style={{ fontSize: 11, color: '#8899aa', marginBottom: 6 }}>Composition</h4>
          {s.species
            .filter(sp => sp.surface_fraction > 0.001)
            .sort((a, b) => b.surface_fraction - a.surface_fraction)
            .map(sp => (
              <div
                key={sp.name}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '1px 0',
                }}
              >
                <span style={{ color: '#aabbcc' }}>{sp.name}</span>
                <span style={{ color: '#e8edf5' }}>
                  {(sp.surface_fraction * 100).toFixed(sp.surface_fraction < 0.01 ? 2 : 1)}%
                </span>
              </div>
            ))}
        </div>
      )}

      {/* Optical depths */}
      <div style={{ marginTop: 8, color: '#556677', fontSize: 10 }}>
        IR optical depth: τ = {profile.total_ir_optical_depth.toFixed(3)} |
        Rayleigh τ₅₅₀: {profile.rayleigh_optical_depth_550.toFixed(3)}
      </div>
    </div>
  );
}

/* ── P-T chart ───────────────────────────────────── */

function PTChart({ pressures, temperatures }: { pressures: number[]; temperatures: number[] }) {
  if (pressures.length < 2) return null;

  const maxT = Math.max(...temperatures);
  const minT = Math.min(...temperatures);
  const maxP = Math.max(...pressures);
  const minP = Math.min(1e-8, ...pressures.filter(p => p > 0));

  const points = pressures.map((p, i) => {
    const x = ((temperatures[i] - minT) / (maxT - minT || 1)) * 100;
    // Log-pressure axis (surface at bottom)
    const logP = p > 0 ? Math.log10(p) : Math.log10(minP);
    const logMax = Math.log10(maxP);
    const logMin = Math.log10(minP);
    const y = ((logP - logMin) / (logMax - logMin)) * 100;
    return `${x},${y}`;
  }).join(' ');

  return (
    <div>
      <svg width="100%" height={60} viewBox="0 0 100 100" preserveAspectRatio="none">
        <polyline
          points={points}
          fill="none"
          stroke="#f59e0b"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#556677' }}>
        <span>{Math.round(minT)} K</span>
        <span>{Math.round(maxT)} K</span>
      </div>
    </div>
  );
}

/* ── Helpers ─────────────────────────────────────── */

function Row({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <td style={{ padding: '2px 4px', color: '#8899aa' }}>{label}</td>
      <td style={{ padding: '2px 4px', textAlign: 'right', color: '#e8edf5' }}>{value}</td>
    </tr>
  );
}

function formatPressure(bar: number): string {
  if (bar < 0.001) return `${(bar * 1e6).toFixed(1)} μbar`;
  if (bar < 1) return `${(bar * 1000).toFixed(1)} mbar`;
  if (bar > 1000) return `${(bar / 1000).toFixed(1)} kbar`;
  return `${bar.toFixed(2)} bar`;
}
