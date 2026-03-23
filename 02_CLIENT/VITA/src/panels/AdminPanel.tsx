import { useEffect, useState } from 'react';
import { getRunsManifest, getHealth } from '../services/api';
import type { IngestRun, HealthResponse } from '../services/api';

const S: Record<string, React.CSSProperties> = {
  root:       { padding: '12px 16px', color: '#c8d4e0', fontSize: 12 },
  heading:    { fontSize: 13, fontWeight: 600, color: '#e2eaf2', marginBottom: 10 },
  grid:       { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 16 },
  stat:       { background: '#0d1520', borderRadius: 4, padding: '8px 10px' },
  statLabel:  { fontSize: 10, color: '#5a7a9a', textTransform: 'uppercase', letterSpacing: '0.06em' },
  statValue:  { fontSize: 13, fontWeight: 600, marginTop: 2 },
  table:      { width: '100%', borderCollapse: 'collapse' as const, fontSize: 11 },
  th:         { textAlign: 'left' as const, color: '#5a7a9a', padding: '4px 6px', borderBottom: '1px solid #1a2a3a', fontWeight: 400 },
  td:         { padding: '5px 6px', borderBottom: '1px solid #0d1a26', verticalAlign: 'top' as const },
  muted:      { color: '#4a6070', fontStyle: 'italic' },
  error:      { color: '#ef4444', marginBottom: 8 },
};

function badge(status: string) {
  const color = status === 'completed' ? '#22c55e' : status === 'running' ? '#f59e0b' : '#ef4444';
  return <span style={{ color, fontWeight: 600 }}>{status}</span>;
}

export function AdminPanel() {
  const [runs, setRuns] = useState<IngestRun[]>([]);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [runsRes, healthRes] = await Promise.allSettled([
          getRunsManifest(20),
          getHealth(),
        ]);
        if (runsRes.status === 'fulfilled') setRuns(runsRes.value.runs);
        if (healthRes.status === 'fulfilled') setHealth(healthRes.value);
        if (runsRes.status === 'rejected' && healthRes.status === 'rejected')
          setError('Gateway unreachable');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div style={S.root}>
      <div style={S.heading}>Admin Dashboard</div>

      {loading && <p style={S.muted}>Loading…</p>}
      {error && <p style={S.error}>{error}</p>}

      {health && (
        <>
          <div style={{ fontSize: 11, color: '#5a7a9a', marginBottom: 6 }}>Gateway Health</div>
          <div style={S.grid}>
            <div style={S.stat}>
              <div style={S.statLabel}>Database</div>
              <div style={{ ...S.statValue, color: health.db_status.connected ? '#22c55e' : '#ef4444' }}>
                {health.db_status.connected ? '● Connected' : '● Disconnected'}
              </div>
            </div>
            <div style={S.stat}>
              <div style={S.statLabel}>Persona</div>
              <div style={S.statValue}>{health.persona}</div>
            </div>
            <div style={S.stat}>
              <div style={S.statLabel}>Routes</div>
              <div style={S.statValue}>{health.routes_count}</div>
            </div>
          </div>
        </>
      )}

      <div style={{ fontSize: 11, color: '#5a7a9a', marginBottom: 6 }}>Recent Pipeline Runs</div>
      {runs.length === 0 && !loading ? (
        <p style={S.muted}>No runs recorded. Run the Phase 01 pipeline to populate.</p>
      ) : (
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Run ID</th>
              <th style={S.th}>Name</th>
              <th style={S.th}>Status</th>
              <th style={S.th}>Started</th>
              <th style={S.th}>Finished</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.run_id}>
                <td style={{ ...S.td, fontFamily: 'monospace', color: '#7a9ab8' }}>{r.run_id.slice(0, 8)}…</td>
                <td style={S.td}>{r.run_name}</td>
                <td style={S.td}>{badge(r.status)}</td>
                <td style={{ ...S.td, fontFamily: 'monospace', color: '#7a9ab8' }}>{r.started_at}</td>
                <td style={{ ...S.td, fontFamily: 'monospace', color: '#7a9ab8' }}>{r.finished_at ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
