import React, { useEffect, useState } from 'react';
import { getRunsManifest, getHealth } from '../services/api';
import type { IngestRun, HealthResponse } from '../types/api';
import './PageShell.css';

export default function AdminPage() {
  const [runs, setRuns] = useState<IngestRun[]>([]);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [runsData, healthData] = await Promise.allSettled([
          getRunsManifest(20),
          getHealth(),
        ]);
        if (runsData.status === 'fulfilled') setRuns(runsData.value.runs);
        if (healthData.status === 'fulfilled') setHealth(healthData.value);
      } catch {
        setError('Failed to load admin data');
      }
    }
    load();
  }, []);

  return (
    <div className="page-shell">
      <div className="page-header">
        <h1>Admin Dashboard</h1>
        <p className="page-subtitle">System health, pipeline runs, and configuration</p>
      </div>

      <div className="page-grid">
        {/* Health card */}
        <div className="panel">
          <h3 className="panel-title">System Health</h3>
          {health ? (
            <div className="stat-grid">
              <div className="stat">
                <div className="stat-label">Database</div>
                <div className={`stat-value ${health.db_status.connected ? 'text-green' : 'text-red'}`}>
                  {health.db_status.connected ? '● Connected' : '● Disconnected'}
                </div>
              </div>
              <div className="stat">
                <div className="stat-label">Persona</div>
                <div className="stat-value">{health.persona}</div>
              </div>
              <div className="stat">
                <div className="stat-label">Routes</div>
                <div className="stat-value">{health.routes_count}</div>
              </div>
            </div>
          ) : (
            <p className="muted">Loading…</p>
          )}
        </div>

        {/* Recent runs */}
        <div className="panel" style={{ gridColumn: 'span 2' }}>
          <h3 className="panel-title">Recent Pipeline Runs</h3>
          {error && <p className="text-red">{error}</p>}
          {runs.length === 0 ? (
            <p className="muted">No runs recorded yet. Run the Phase 01 pipeline to populate.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Run ID</th>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Started</th>
                  <th>Finished</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.run_id}>
                    <td className="mono">{r.run_id.slice(0, 8)}…</td>
                    <td>{r.run_name}</td>
                    <td>
                      <span className={`badge ${r.status === 'completed' ? 'badge-green' : r.status === 'running' ? 'badge-amber' : 'badge-red'}`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="mono">{r.started_at}</td>
                    <td className="mono">{r.finished_at ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
