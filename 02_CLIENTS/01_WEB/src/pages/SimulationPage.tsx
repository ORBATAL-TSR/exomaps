import React, { useState, useEffect, useCallback } from 'react';
import {
  simStep,
  simPause,
  simResume,
  listCampaigns,
  campaignSimInit,
  campaignSimTick,
  campaignSimSnapshot,
} from '../services/api';
import type { Campaign } from '../types/api';
import './PageShell.css';

export default function SimulationPage() {
  /* ── campaign list ─────────────────── */
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState('');
  const [mode, setMode] = useState<'campaign' | 'legacy'>('campaign');

  /* ── legacy mode ───────────────────── */
  const [runId, setRunId] = useState('');

  /* ── shared state ──────────────────── */
  const [snapshot, setSnapshot] = useState<any>(null);
  const [status, setStatus] = useState<string>('idle');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadCampaigns = useCallback(async () => {
    try {
      const res = await listCampaigns('active');
      setCampaigns(res.campaigns);
      if (res.campaigns.length > 0 && !selectedCampaignId) {
        setSelectedCampaignId(res.campaigns[0].id);
      }
    } catch {
      // campaigns API may not be available
    }
  }, [selectedCampaignId]);

  useEffect(() => { loadCampaigns(); }, [loadCampaigns]);

  /* ── campaign sim handlers ─────────── */
  async function handleCampaignInit() {
    if (!selectedCampaignId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await campaignSimInit(selectedCampaignId);
      setStatus(`initialized (tick ${res.tick})`);
      setSnapshot(res);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Campaign sim init failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleCampaignTick(count: number) {
    if (!selectedCampaignId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await campaignSimTick(selectedCampaignId, count);
      setStatus(`tick ${res.tick}`);
      setSnapshot(res);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Campaign tick failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleCampaignSnapshot() {
    if (!selectedCampaignId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await campaignSimSnapshot(selectedCampaignId);
      setSnapshot(res);
      setStatus(`snapshot @ tick ${res.tick}`);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Snapshot failed');
    } finally {
      setBusy(false);
    }
  }

  /* ── legacy handlers ───────────────── */
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

      {/* Mode toggle */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button
          className={`btn ${mode === 'campaign' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setMode('campaign')}
        >
          Campaign Mode
        </button>
        <button
          className={`btn ${mode === 'legacy' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setMode('legacy')}
        >
          Legacy (Run ID)
        </button>
      </div>

      <div className="page-grid">
        <div className="panel">
          <h3 className="panel-title">
            {mode === 'campaign' ? 'Campaign Simulation' : 'Run Control'}
          </h3>

          {mode === 'campaign' ? (
            <>
              <div style={{ marginBottom: 12 }}>
                <select
                  className="input"
                  value={selectedCampaignId}
                  onChange={(e) => setSelectedCampaignId(e.target.value)}
                  style={{ width: '100%' }}
                >
                  <option value="">— Select campaign —</option>
                  {campaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.id.slice(0, 8)})
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn btn-primary" onClick={handleCampaignInit} disabled={busy || !selectedCampaignId}>
                  Init
                </button>
                <button className="btn btn-secondary" onClick={() => handleCampaignTick(1)} disabled={busy || !selectedCampaignId}>
                  +1 Tick
                </button>
                <button className="btn btn-secondary" onClick={() => handleCampaignTick(10)} disabled={busy || !selectedCampaignId}>
                  +10
                </button>
                <button className="btn btn-secondary" onClick={() => handleCampaignTick(100)} disabled={busy || !selectedCampaignId}>
                  +100
                </button>
                <button className="btn btn-secondary" onClick={handleCampaignSnapshot} disabled={busy || !selectedCampaignId}>
                  Snapshot
                </button>
              </div>
            </>
          ) : (
            <>
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
            </>
          )}

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
              {mode === 'campaign'
                ? 'Select a campaign and press Init to begin the simulation.'
                : 'No active simulation. Enter a run ID and press Step to begin.'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
