/**
 * PlanetEditorPanel — Edit planet parameters, regenerate with new seeds,
 * browse generation history, and manage cached textures.
 *
 * Features:
 *   - Parameter sliders: mass, radius, SMA, eccentricity, temperature
 *   - Planet type dropdown
 *   - Seed control: pin/randomize/manual entry
 *   - Resolution picker (256, 512, 1024)
 *   - Habitable zone toggle
 *   - Regenerate button with instant feedback
 *   - Generation history timeline with favorites + labels
 *   - Cache stats display
 *   - Reset to catalog defaults
 */

import { useState, useEffect, useCallback } from 'react';
import type { PlanetTexturesV2 } from './PlanetSurfaceV2';

/* ── Types ──────────────────────────────────────────── */

interface GenerationRecord {
  id: number;
  system_id: string;
  planet_index: number;
  seed: number;
  resolution: number;
  planet_type: string;
  mass_earth: number;
  radius_earth: number;
  semi_major_axis_au: number;
  eccentricity: number;
  star_teff: number;
  star_luminosity: number;
  temperature_k: number;
  in_habitable_zone: boolean;
  ocean_level: number;
  render_time_ms: number;
  created_at: string;
  is_favorite: boolean;
  label: string | null;
}

interface PlanetOverrides {
  mass_earth?: number | null;
  radius_earth?: number | null;
  semi_major_axis_au?: number | null;
  eccentricity?: number | null;
  planet_type?: string | null;
  temperature_k?: number | null;
  in_habitable_zone?: boolean | null;
  seed?: number | null;
  texture_resolution?: number | null;
  label?: string | null;
}

interface CacheStats {
  total_generations: number;
  total_planets: number;
  total_systems: number;
  cache_size_bytes: number;
}

interface CachedGeneration {
  record: GenerationRecord;
  result: PlanetTexturesV2;
}

interface Props {
  systemId: string;
  planetIndex: number;
  planet: any; // catalog planet data
  starTeff: number;
  starLuminosity: number;
  onTexturesGenerated: (textures: PlanetTexturesV2) => void;
  onStatusChange: (status: string) => void;
}

/* ── Planet Types ───────────────────────────────────── */

const PLANET_TYPES = [
  'rocky', 'super-earth', 'mini-neptune', 'neptune-like',
  'gas-giant', 'super-jupiter', 'lava-world', 'ice-world',
  'water-world', 'desert-world',
];

const RESOLUTIONS = [
  { value: 256, label: '256 (fast)' },
  { value: 512, label: '512 (default)' },
  { value: 1024, label: '1024 (high)' },
];

/* ── Styles ─────────────────────────────────────────── */

const S = {
  panel: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 12,
    fontSize: 11,
    color: '#c8d6e5',
  },
  section: {
    background: '#0a1020',
    border: '1px solid #1e3050',
    borderRadius: 4,
    padding: 10,
  },
  sectionTitle: {
    fontSize: 10,
    fontWeight: 700,
    color: '#4d9fff',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    marginBottom: 8,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  label: {
    color: '#8899aa',
    fontSize: 10,
    minWidth: 80,
  },
  slider: {
    flex: 1,
    marginLeft: 8,
    marginRight: 8,
    accentColor: '#4d9fff',
    height: 4,
  },
  value: {
    fontSize: 10,
    color: '#4d9fff',
    minWidth: 55,
    textAlign: 'right' as const,
    fontFamily: 'monospace',
  },
  select: {
    background: '#0d1a2e',
    border: '1px solid #1e3050',
    color: '#c8d6e5',
    borderRadius: 3,
    padding: '3px 6px',
    fontSize: 10,
  },
  btn: {
    padding: '5px 12px',
    fontSize: 10,
    borderRadius: 3,
    border: '1px solid #1e3050',
    cursor: 'pointer',
    fontWeight: 600,
    transition: 'all 0.15s',
  },
  btnPrimary: {
    background: '#1a3a6a',
    color: '#4d9fff',
    border: '1px solid #4d9fff',
  },
  btnDanger: {
    background: '#2a1020',
    color: '#ff6b6b',
    border: '1px solid #ff6b6b40',
  },
  btnGhost: {
    background: 'transparent',
    color: '#8899aa',
    border: '1px solid #1e3050',
  },
  historyItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 6px',
    borderRadius: 3,
    cursor: 'pointer',
    transition: 'background 0.1s',
    fontSize: 10,
  },
  tag: {
    display: 'inline-block',
    padding: '1px 5px',
    borderRadius: 2,
    fontSize: 9,
    fontWeight: 600,
  },
};

/* ── Helpers ────────────────────────────────────────── */

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(ms: number): string {
  return ms < 1000 ? `${ms.toFixed(0)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function safeInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
    return Promise.reject(new Error(`Tauri IPC not available`));
  }
  return (window as any).__TAURI_INTERNALS__.invoke(cmd, args);
}

/* ── Component ──────────────────────────────────────── */

export function PlanetEditorPanel({
  systemId,
  planetIndex,
  planet,
  starTeff,
  starLuminosity,
  onTexturesGenerated,
  onStatusChange,
}: Props) {
  // Catalog defaults
  const catalogMass = planet?.pl_bmasse ?? 1.0;
  const catalogRadius = planet?.pl_rade ?? 1.0;
  const catalogSma = planet?.pl_orbsmax ?? 1.0;
  const catalogEcc = planet?.pl_orbeccen ?? 0.0;
  const catalogType = planet?.planet_type || 'super-earth';

  // Editable state (start with catalog values)
  const [mass, setMass] = useState(catalogMass);
  const [radius, setRadius] = useState(catalogRadius);
  const [sma, setSma] = useState(catalogSma);
  const [ecc, setEcc] = useState(catalogEcc);
  const [planetType, setPlanetType] = useState(catalogType);
  const [temperature, setTemperature] = useState(288.0);
  const [inHz, setInHz] = useState(catalogSma > 0.85 && catalogSma < 1.7);
  const [resolution, setResolution] = useState(512);
  const [seed, setSeed] = useState<number | null>(null); // null = auto
  const [generating, setGenerating] = useState(false);

  // History
  const [history, setHistory] = useState<GenerationRecord[]>([]);
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);
  const [hasOverrides, setHasOverrides] = useState(false);

  // Load history + overrides on mount/planet change
  useEffect(() => {
    loadHistory();
    loadOverrides();
    loadStats();
  }, [systemId, planetIndex]);

  // Sync catalog values when planet changes
  useEffect(() => {
    setMass(catalogMass);
    setRadius(catalogRadius);
    setSma(catalogSma);
    setEcc(catalogEcc);
    setPlanetType(catalogType);
    setInHz(catalogSma > 0.85 && catalogSma < 1.7);
  }, [catalogMass, catalogRadius, catalogSma, catalogEcc, catalogType]);

  const loadHistory = useCallback(async () => {
    try {
      const h = await safeInvoke<GenerationRecord[]>('list_generation_history', {
        systemId, planetIndex,
      });
      setHistory(h);
    } catch { /* silent */ }
  }, [systemId, planetIndex]);

  const loadOverrides = useCallback(async () => {
    try {
      const o = await safeInvoke<PlanetOverrides | null>('get_planet_overrides', {
        systemId, planetIndex,
      });
      if (o) {
        setHasOverrides(true);
        if (o.mass_earth != null) setMass(o.mass_earth);
        if (o.radius_earth != null) setRadius(o.radius_earth);
        if (o.semi_major_axis_au != null) setSma(o.semi_major_axis_au);
        if (o.eccentricity != null) setEcc(o.eccentricity);
        if (o.planet_type != null) setPlanetType(o.planet_type);
        if (o.temperature_k != null) setTemperature(o.temperature_k);
        if (o.in_habitable_zone != null) setInHz(o.in_habitable_zone);
        if (o.texture_resolution != null) setResolution(o.texture_resolution);
        if (o.seed != null) setSeed(o.seed);
      } else {
        setHasOverrides(false);
      }
    } catch { /* silent */ }
  }, [systemId, planetIndex]);

  const loadStats = useCallback(async () => {
    try {
      const s = await safeInvoke<CacheStats>('get_cache_stats', {});
      setCacheStats(s);
    } catch { /* silent */ }
  }, []);

  // ── Actions ──

  const handleRegenerate = useCallback(async () => {
    setGenerating(true);
    onStatusChange('Regenerating...');
    try {
      const result = await safeInvoke<PlanetTexturesV2>('regenerate_planet', {
        request: {
          system_id: systemId,
          planet_index: planetIndex,
          mass_earth: mass,
          radius_earth: radius,
          semi_major_axis_au: sma,
          eccentricity: ecc,
          star_teff: starTeff,
          star_luminosity: starLuminosity,
          planet_type: planetType,
          temperature_k: temperature,
          in_habitable_zone: inHz,
          texture_resolution: resolution,
        },
        seedOverride: seed,
      });
      onTexturesGenerated(result);
      onStatusChange(`Regenerated (${formatTime(result.render_time_ms)})`);
      loadHistory();
      loadStats();
    } catch (err: any) {
      onStatusChange(`Error: ${err?.message || err}`);
    } finally {
      setGenerating(false);
    }
  }, [systemId, planetIndex, mass, radius, sma, ecc, planetType, temperature, inHz, resolution, seed, starTeff, starLuminosity, onTexturesGenerated, onStatusChange, loadHistory, loadStats]);

  const handleSaveOverrides = useCallback(async () => {
    const overrides: PlanetOverrides = {};
    if (Math.abs(mass - catalogMass) > 0.001) overrides.mass_earth = mass;
    if (Math.abs(radius - catalogRadius) > 0.001) overrides.radius_earth = radius;
    if (Math.abs(sma - catalogSma) > 0.001) overrides.semi_major_axis_au = sma;
    if (Math.abs(ecc - catalogEcc) > 0.001) overrides.eccentricity = ecc;
    if (planetType !== catalogType) overrides.planet_type = planetType;
    if (resolution !== 512) overrides.texture_resolution = resolution;
    if (seed != null) overrides.seed = seed;

    try {
      await safeInvoke('save_planet_overrides', {
        systemId, planetIndex, overrides,
      });
      setHasOverrides(true);
      onStatusChange('Overrides saved');
    } catch (err: any) {
      onStatusChange(`Save failed: ${err?.message || err}`);
    }
  }, [mass, radius, sma, ecc, planetType, resolution, seed, catalogMass, catalogRadius, catalogSma, catalogEcc, catalogType, systemId, planetIndex, onStatusChange]);

  const handleResetDefaults = useCallback(async () => {
    try {
      await safeInvoke('clear_planet_overrides', { systemId, planetIndex });
      setMass(catalogMass);
      setRadius(catalogRadius);
      setSma(catalogSma);
      setEcc(catalogEcc);
      setPlanetType(catalogType);
      setTemperature(288.0);
      setInHz(catalogSma > 0.85 && catalogSma < 1.7);
      setResolution(512);
      setSeed(null);
      setHasOverrides(false);
      onStatusChange('Reset to catalog defaults');
    } catch { /* silent */ }
  }, [systemId, planetIndex, catalogMass, catalogRadius, catalogSma, catalogEcc, catalogType, onStatusChange]);

  const handleLoadGeneration = useCallback(async (genId: number) => {
    onStatusChange('Loading cached generation...');
    try {
      const cached = await safeInvoke<CachedGeneration | null>('load_generation', {
        generationId: genId,
      });
      if (cached) {
        onTexturesGenerated(cached.result);
        onStatusChange(`Loaded gen #${genId} (${formatTime(cached.record.render_time_ms)})`);
      }
    } catch (err: any) {
      onStatusChange(`Load failed: ${err?.message || err}`);
    }
  }, [onTexturesGenerated, onStatusChange]);

  const handleToggleFavorite = useCallback(async (genId: number) => {
    try {
      await safeInvoke('toggle_generation_favorite', { generationId: genId });
      loadHistory();
    } catch { /* silent */ }
  }, [loadHistory]);

  const handleDeleteGeneration = useCallback(async (genId: number) => {
    try {
      await safeInvoke('delete_generation', { generationId: genId });
      loadHistory();
      loadStats();
    } catch { /* silent */ }
  }, [loadHistory, loadStats]);

  // Check if params differ from catalog
  const isModified = Math.abs(mass - catalogMass) > 0.001
    || Math.abs(radius - catalogRadius) > 0.001
    || Math.abs(sma - catalogSma) > 0.001
    || Math.abs(ecc - catalogEcc) > 0.001
    || planetType !== catalogType;

  return (
    <div style={S.panel}>
      {/* ── Parameter Sliders ── */}
      <div style={S.section}>
        <div style={S.sectionTitle}>
          Planet Parameters
          {isModified && (
            <span style={{ ...S.tag, background: '#f59e0b30', color: '#f59e0b', marginLeft: 8 }}>
              Modified
            </span>
          )}
          {hasOverrides && (
            <span style={{ ...S.tag, background: '#4d9fff30', color: '#4d9fff', marginLeft: 4 }}>
              Saved
            </span>
          )}
        </div>

        {/* Mass */}
        <div style={S.row}>
          <span style={S.label}>Mass (M⊕)</span>
          <input
            type="range"
            min={0.01} max={1000} step={0.01}
            value={Math.log10(mass) * 100}
            onChange={e => setMass(Math.pow(10, Number(e.target.value) / 100))}
            style={S.slider}
          />
          <span style={S.value}>{mass.toFixed(2)}</span>
        </div>

        {/* Radius */}
        <div style={S.row}>
          <span style={S.label}>Radius (R⊕)</span>
          <input
            type="range"
            min={0.3} max={25} step={0.01}
            value={radius}
            onChange={e => setRadius(Number(e.target.value))}
            style={S.slider}
          />
          <span style={S.value}>{radius.toFixed(2)}</span>
        </div>

        {/* Semi-major axis */}
        <div style={S.row}>
          <span style={S.label}>SMA (AU)</span>
          <input
            type="range"
            min={-2} max={2.5} step={0.01}
            value={Math.log10(sma)}
            onChange={e => setSma(Math.pow(10, Number(e.target.value)))}
            style={S.slider}
          />
          <span style={S.value}>{sma.toFixed(3)}</span>
        </div>

        {/* Eccentricity */}
        <div style={S.row}>
          <span style={S.label}>Eccentricity</span>
          <input
            type="range"
            min={0} max={0.95} step={0.01}
            value={ecc}
            onChange={e => setEcc(Number(e.target.value))}
            style={S.slider}
          />
          <span style={S.value}>{ecc.toFixed(2)}</span>
        </div>

        {/* Planet Type */}
        <div style={S.row}>
          <span style={S.label}>Type</span>
          <select
            value={planetType}
            onChange={e => setPlanetType(e.target.value)}
            style={{ ...S.select, flex: 1, marginLeft: 8 }}
          >
            {PLANET_TYPES.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>

        {/* Habitable zone */}
        <div style={S.row}>
          <span style={S.label}>In HZ</span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input type="checkbox" checked={inHz} onChange={e => setInHz(e.target.checked)} />
            <span style={{ fontSize: 10, color: inHz ? '#22c55e' : '#8899aa' }}>
              {inHz ? 'Yes' : 'No'}
            </span>
          </label>
        </div>
      </div>

      {/* ── Generation Controls ── */}
      <div style={S.section}>
        <div style={S.sectionTitle}>Generation</div>

        {/* Resolution */}
        <div style={S.row}>
          <span style={S.label}>Resolution</span>
          <select
            value={resolution}
            onChange={e => setResolution(Number(e.target.value))}
            style={{ ...S.select, flex: 1, marginLeft: 8 }}
          >
            {RESOLUTIONS.map(r => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>

        {/* Seed */}
        <div style={S.row}>
          <span style={S.label}>Seed</span>
          <input
            type="number"
            value={seed ?? ''}
            placeholder="auto"
            onChange={e => {
              const v = e.target.value;
              setSeed(v === '' ? null : Number(v));
            }}
            style={{ ...S.select, flex: 1, marginLeft: 8, fontFamily: 'monospace' }}
          />
          <button
            onClick={() => setSeed(Math.floor(Math.random() * 999999))}
            style={{ ...S.btn, ...S.btnGhost, marginLeft: 4, padding: '3px 6px' }}
            title="Random seed"
          >
            🎲
          </button>
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <button
            onClick={handleRegenerate}
            disabled={generating}
            style={{
              ...S.btn,
              ...S.btnPrimary,
              flex: 1,
              opacity: generating ? 0.5 : 1,
            }}
          >
            {generating ? '⏳ Generating...' : '🔄 Regenerate'}
          </button>
          <button
            onClick={handleSaveOverrides}
            disabled={!isModified}
            style={{
              ...S.btn,
              ...S.btnGhost,
              opacity: isModified ? 1 : 0.3,
            }}
            title="Save current params as overrides"
          >
            💾
          </button>
          {hasOverrides && (
            <button
              onClick={handleResetDefaults}
              style={{ ...S.btn, ...S.btnDanger }}
              title="Reset to catalog defaults"
            >
              ↩
            </button>
          )}
        </div>
      </div>

      {/* ── Generation History ── */}
      {history.length > 0 && (
        <div style={S.section}>
          <div style={S.sectionTitle}>
            History ({history.length})
          </div>
          <div style={{ maxHeight: 200, overflowY: 'auto' }}>
            {history.map(gen => (
              <div
                key={gen.id}
                style={{
                  ...S.historyItem,
                  background: gen.is_favorite ? '#1a2a40' : 'transparent',
                }}
              >
                <button
                  onClick={() => handleToggleFavorite(gen.id)}
                  style={{ ...S.btn, padding: '1px 4px', fontSize: 10, background: 'transparent', border: 'none' }}
                  title={gen.is_favorite ? 'Unfavorite' : 'Favorite'}
                >
                  {gen.is_favorite ? '⭐' : '☆'}
                </button>
                <span
                  onClick={() => handleLoadGeneration(gen.id)}
                  style={{ flex: 1, cursor: 'pointer' }}
                  title={`Load generation #${gen.id}`}
                >
                  <span style={{ color: '#667788', fontFamily: 'monospace' }}>
                    #{gen.id}
                  </span>
                  {' '}
                  <span style={{ color: '#c8d6e5' }}>
                    seed={gen.seed}
                  </span>
                  {' '}
                  <span style={{ color: '#4d9fff' }}>
                    {formatTime(gen.render_time_ms)}
                  </span>
                  {' '}
                  <span style={{ color: '#667788' }}>
                    {gen.resolution}px
                  </span>
                  {gen.label && (
                    <span style={{ ...S.tag, background: '#4d9fff20', color: '#4d9fff', marginLeft: 4 }}>
                      {gen.label}
                    </span>
                  )}
                </span>
                <button
                  onClick={() => handleDeleteGeneration(gen.id)}
                  style={{ ...S.btn, padding: '1px 4px', fontSize: 9, background: 'transparent', border: 'none', color: '#ff6b6b40' }}
                  title="Delete"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Cache Stats ── */}
      {cacheStats && (
        <div style={S.section}>
          <div style={S.sectionTitle}>Cache</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
            <span style={S.label}>Generations:</span>
            <span style={S.value}>{cacheStats.total_generations}</span>
            <span style={S.label}>Planets:</span>
            <span style={S.value}>{cacheStats.total_planets}</span>
            <span style={S.label}>Systems:</span>
            <span style={S.value}>{cacheStats.total_systems}</span>
            <span style={S.label}>Size:</span>
            <span style={S.value}>{formatBytes(cacheStats.cache_size_bytes)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default PlanetEditorPanel;
