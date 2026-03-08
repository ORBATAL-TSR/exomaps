/**
 * SearchBar – Ctrl+K command-palette style search for star systems.
 *
 * Features:
 *   - Global Ctrl+K hotkey to open
 *   - Fuzzy matching on main_id
 *   - Keyboard navigation (arrow keys + Enter)
 *   - Fly-to on selection
 *   - Escape to close
 */
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import type { StarSystemFull } from '../types/api';

interface SearchBarProps {
  systems: StarSystemFull[];
  onSelect: (id: string) => void;
  isOpen: boolean;
  onClose: () => void;
}

const MAX_RESULTS = 12;

/** Simple fuzzy match: checks if all chars in query appear in order in target */
function fuzzyMatch(query: string, target: string): { match: boolean; score: number } {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  
  // Exact substring match gets highest score
  if (t.includes(q)) {
    return { match: true, score: 100 - t.indexOf(q) };
  }

  // Fuzzy: all chars in order
  let qi = 0;
  let score = 0;
  let prevIdx = -1;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      // Bonus for consecutive chars
      score += (prevIdx === ti - 1) ? 10 : 1;
      prevIdx = ti;
      qi++;
    }
  }
  return { match: qi === q.length, score };
}

export default function SearchBar({ systems, onSelect, isOpen, onClose }: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  /* ── Focus on open ───────────────────────────────── */
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setActiveIdx(0);
      // Small delay to ensure DOM is ready
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  /* ── Filtered results ────────────────────────────── */
  const results = useMemo(() => {
    if (!query.trim()) return [];
    const matches: { sys: StarSystemFull; score: number }[] = [];
    for (const sys of systems) {
      const { match, score } = fuzzyMatch(query, sys.main_id);
      if (match) {
        matches.push({ sys, score });
      }
    }
    matches.sort((a, b) => b.score - a.score);
    return matches.slice(0, MAX_RESULTS).map((m) => m.sys);
  }, [query, systems]);

  /* ── Keep activeIdx in bounds ────────────────────── */
  useEffect(() => {
    if (activeIdx >= results.length) {
      setActiveIdx(Math.max(0, results.length - 1));
    }
  }, [results.length, activeIdx]);

  /* ── Keyboard navigation ─────────────────────────── */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((prev) => Math.min(prev + 1, results.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter' && results[activeIdx]) {
        onSelect(results[activeIdx].main_id);
        onClose();
      }
    },
    [results, activeIdx, onSelect, onClose],
  );

  if (!isOpen) return null;

  /** Harvard spectral class → hex color */
  const SPECTRAL_HEX: Record<string, string> = {
    O: '#9bb0ff', B: '#aabfff', A: '#cad7ff', F: '#f8f7ff',
    G: '#fff4ea', K: '#ffd2a1', M: '#ffb56c', L: '#ff8c42', T: '#ff6b35',
  };

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: 80,
        background: 'rgba(6,10,18,0.6)',
        zIndex: 100,
        backdropFilter: 'blur(4px)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: 460,
          background: 'rgba(17,24,39,0.96)',
          border: '1px solid #374151',
          borderRadius: 12,
          overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5), 0 0 40px rgba(34,211,238,0.08)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '12px 16px',
            borderBottom: '1px solid #1f2937',
          }}
        >
          <span style={{ color: '#22d3ee', marginRight: 10, fontSize: 16 }}>⌖</span>
          <input
            ref={inputRef}
            type="text"
            placeholder="Search star systems…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            style={{
              flex: 1,
              background: 'none',
              border: 'none',
              outline: 'none',
              color: '#f3f4f6',
              fontSize: 15,
              fontFamily: 'Inter, sans-serif',
            }}
          />
          <kbd
            style={{
              color: '#6b7280',
              fontSize: 10,
              padding: '2px 6px',
              border: '1px solid #374151',
              borderRadius: 3,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            ESC
          </kbd>
        </div>

        {/* Results list */}
        {results.length > 0 && (
          <div style={{ maxHeight: 360, overflowY: 'auto' }}>
            {results.map((sys, i) => {
              const cls = sys.spectral_class?.[0]?.toUpperCase() || '?';
              const badgeColor = SPECTRAL_HEX[cls] ?? '#6b7280';
              return (
                <div
                  key={sys.main_id}
                  onMouseEnter={() => setActiveIdx(i)}
                  onClick={() => {
                    onSelect(sys.main_id);
                    onClose();
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '8px 16px',
                    gap: 10,
                    cursor: 'pointer',
                    background: i === activeIdx ? 'rgba(34,211,238,0.08)' : 'transparent',
                    borderLeft: i === activeIdx ? '2px solid #22d3ee' : '2px solid transparent',
                    transition: 'background 0.1s',
                  }}
                >
                  {/* Spectral badge */}
                  <span
                    style={{
                      display: 'inline-block',
                      width: 24,
                      textAlign: 'center',
                      background: badgeColor,
                      color: '#111',
                      borderRadius: 3,
                      padding: '1px 0',
                      fontSize: 9,
                      fontWeight: 700,
                    }}
                  >
                    {cls}
                  </span>
                  {/* Star name */}
                  <span
                    style={{
                      flex: 1,
                      color: '#e5e7eb',
                      fontSize: 13,
                      fontFamily: "'JetBrains Mono', 'Fira Code', Inter, monospace",
                    }}
                  >
                    {sys.main_id}
                  </span>
                  {/* Distance */}
                  <span style={{ color: '#6b7280', fontSize: 11 }}>
                    {sys.distance_ly.toFixed(1)} ly
                  </span>
                  {/* Planet indicator */}
                  {sys.planet_count > 0 && (
                    <span style={{ color: '#22d3ee', fontSize: 10 }}>
                      {sys.planet_count}🜨
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Empty state */}
        {query.trim() && results.length === 0 && (
          <div style={{ padding: '20px 16px', color: '#6b7280', fontSize: 13, textAlign: 'center' }}>
            No matching star systems
          </div>
        )}

        {/* Hint */}
        {!query.trim() && (
          <div
            style={{
              padding: '16px',
              color: '#4b5563',
              fontSize: 11,
              textAlign: 'center',
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            Type a star name (e.g. "Proxima", "TRAPPIST", "Sirius")
          </div>
        )}
      </div>
    </div>
  );
}
