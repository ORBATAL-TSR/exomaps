import React, { useState } from 'react';
import { simStep, simPause, simResume } from '../services/api';
import './PageShell.css';

export default function SimulationPage() {
  const [runId, setRunId] = useState('');
  const [snapshot, setSnapshot] = useState<any>(null);
  const [status, setStatus] = useState<string>('idle');
  const [error, setError] = useState<string | null>(null);

  async function handleStep() {
    if (!runId) return;
    setError(null);
    try {
      const data = await simStep(runId, 10);
      setSnapshot(data.snapshot);
      setStatus('stepped');
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Step failed');
    }
  }

  async function handlePause() {
    if (!runId) return;
    try {
      await simPause(runId);
      setStatus('paused');
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Pause failed');
    }
  }

  async function handleResume() {
    if (!runId) return;
    try {
      await simResume(runId);
      setStatus('running');
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Resume failed');
    }
  }

  return (
    <div className="page-shell">
      <div className="page-header">
        <h1>Simulation Control</h1>
        <p className="page-subtitle">
          Manage deterministic simulation runs — step, pause, resume, and inspect state
        </p>
      </div>

      <div className="page-grid">
        <div className="panel">
          <h3 className="panel-title">Run Control</h3>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input
              type="text"
              placeholder="Run ID"
              value={runId}
              onChange={(e) => setRunId(e.target.value)}
              className="input"
              style={{ flex: 1 }}
            />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" onClick={handleStep}>
              ▶ Step +10
            </button>
            <button className="btn btn-secondary" onClick={handlePause}>
              ⏸ Pause
            </button>
            <button className="btn btn-secondary" onClick={handleResume}>
              ⏵ Resume
            </button>
          </div>
          {error && <p className="text-red" style={{ marginTop: 8 }}>{error}</p>}
          <div className="stat" style={{ marginTop: 12 }}>
            <div className="stat-label">Status</div>
            <div className="stat-value">{status}</div>
          </div>
        </div>

        <div className="panel" style={{ gridColumn: 'span 2' }}>
          <h3 className="panel-title">Snapshot</h3>
          {snapshot ? (
            <pre className="code-block">{JSON.stringify(snapshot, null, 2)}</pre>
          ) : (
            <p className="muted">
              No active simulation. Enter a run ID and press Step to begin.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
