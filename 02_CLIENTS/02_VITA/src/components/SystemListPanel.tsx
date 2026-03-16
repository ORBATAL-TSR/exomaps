/**
 * SystemListPanel — Searchable list of star systems.
 *
 * Fetches from the gateway API and supports filtering,
 * selection, and double-click to open the system focus view.
 */

import { useEffect, useState, useMemo } from 'react';

interface Props {
  searchQuery: string;
  selectedSystem: string | null;
  onSelect: (mainId: string) => void;
  onOpen: (mainId: string) => void;
}

interface SystemEntry {
  main_id: string;
  hostname: string;
  common_name?: string;
  st_spectype?: string;
  dist_pc?: number;
  planet_count: number;
}

export function SystemListPanel({
  searchQuery,
  selectedSystem,
  onSelect,
  onOpen,
}: Props) {
  const [systems, setSystems] = useState<SystemEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch system list on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch('/api/world/systems/full');
        const data = await resp.json();
        const arr = data?.systems ?? (Array.isArray(data) ? data : null);
        if (!cancelled && arr) {
          const entries: SystemEntry[] = arr.map((s: any) => ({
            main_id: s.main_id,
            hostname: s.main_id,
            common_name: s.common_name ?? null,
            st_spectype: s.spectral_class ?? s.st_spectype ?? '',
            dist_pc: s.dist_pc ?? (s.distance_ly != null ? s.distance_ly / 3.26156 : null),
            planet_count: s.planet_count ?? 0,
          }));
          // Sort by distance
          entries.sort((a, b) => (a.dist_pc ?? 9999) - (b.dist_pc ?? 9999));
          setSystems(entries);
        }
      } catch (err) {
        console.error('[SystemList] Failed to fetch systems:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Filter
  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return systems.slice(0, 200);
    const q = searchQuery.toLowerCase();
    return systems
      .filter(
        s =>
          s.hostname.toLowerCase().includes(q) ||
          s.main_id.toLowerCase().includes(q) ||
          (s.common_name && s.common_name.toLowerCase().includes(q)) ||
          (s.st_spectype && s.st_spectype.toLowerCase().includes(q))
      )
      .slice(0, 200);
  }, [systems, searchQuery]);

  if (loading) {
    return (
      <div style={{ color: '#556677', fontSize: 12, padding: 8 }}>
        Loading systems…
      </div>
    );
  }

  return (
    <div style={{ fontSize: 12 }}>
      <div style={{ color: '#556677', marginBottom: 6 }}>
        {filtered.length} of {systems.length} systems
      </div>
      <div
        style={{
          maxHeight: 'calc(100vh - 260px)',
          overflowY: 'auto',
        }}
      >
        {filtered.map(s => (
          <div
            key={s.main_id}
            onClick={() => onSelect(s.main_id)}
            onDoubleClick={() => onOpen(s.main_id)}
            style={{
              padding: '6px 8px',
              borderRadius: 4,
              cursor: 'pointer',
              background:
                s.main_id === selectedSystem ? '#1c2a3e' : 'transparent',
              borderLeft:
                s.main_id === selectedSystem
                  ? '2px solid #4d9fff'
                  : '2px solid transparent',
              marginBottom: 1,
            }}
          >
            <div
              style={{
                color: s.main_id === selectedSystem ? '#e8edf5' : '#aabbcc',
                fontWeight: s.main_id === selectedSystem ? 500 : 400,
              }}
            >
              {s.common_name ?? s.hostname}
            </div>
            <div style={{ color: '#556677', fontSize: 10, marginTop: 2 }}>
              {s.st_spectype && (
                <span style={{ marginRight: 8 }}>{s.st_spectype}</span>
              )}
              {s.dist_pc != null && (
                <span style={{ marginRight: 8 }}>
                  {(s.dist_pc * 3.26156).toFixed(1)} ly
                </span>
              )}
              {s.planet_count > 0 && (
                <span>
                  {s.planet_count} planet{s.planet_count > 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
