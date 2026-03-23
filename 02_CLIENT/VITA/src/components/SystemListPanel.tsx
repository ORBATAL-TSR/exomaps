/**
 * SystemListPanel — Searchable list of star systems.
 * Rendered inside the search dropdown in DesktopLayout.
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

export function SystemListPanel({ searchQuery, selectedSystem, onSelect, onOpen }: Props) {
  const [systems, setSystems] = useState<SystemEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch('/api/world/systems/full');
        const data = await resp.json();
        const arr = data?.systems ?? (Array.isArray(data) ? data : null);
        if (!cancelled && arr) {
          const entries: SystemEntry[] = arr.map((s: any) => ({
            main_id:     s.main_id,
            hostname:    s.main_id,
            common_name: s.common_name ?? null,
            st_spectype: s.spectral_class ?? s.st_spectype ?? '',
            dist_pc:     s.dist_pc ?? (s.distance_ly != null ? s.distance_ly / 3.26156 : null),
            planet_count:s.planet_count ?? 0,
          }));
          entries.sort((a, b) => (a.dist_pc ?? 9999) - (b.dist_pc ?? 9999));
          setSystems(entries);
        }
      } catch {
        // API unavailable — parent's bundled fallback covers star data; list stays empty
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return systems.slice(0, 100);
    const q = searchQuery.toLowerCase();
    return systems
      .filter(s =>
        s.hostname.toLowerCase().includes(q) ||
        s.main_id.toLowerCase().includes(q) ||
        (s.common_name && s.common_name.toLowerCase().includes(q)) ||
        (s.st_spectype && s.st_spectype.toLowerCase().includes(q))
      )
      .slice(0, 200);
  }, [systems, searchQuery]);

  if (loading) {
    return <div className="sl-loading">Loading systems…</div>;
  }

  return (
    <div className="sl-root">
      <div className="sl-count">
        {filtered.length} of {systems.length} systems
      </div>
      <div>
        {filtered.map(s => {
          const active = s.main_id === selectedSystem;
          return (
            <div
              key={s.main_id}
              className={`sl-row${active ? ' active' : ''}`}
              onClick={() => onSelect(s.main_id)}
              onDoubleClick={() => onOpen(s.main_id)}
            >
              <div className="sl-row-name">{s.common_name ?? s.hostname}</div>
              <div className="sl-row-meta">
                {s.st_spectype && <span>{s.st_spectype}</span>}
                {s.dist_pc != null && <span>{(s.dist_pc * 3.26156).toFixed(1)} ly</span>}
                {s.planet_count > 0 && <span>{s.planet_count}p</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
