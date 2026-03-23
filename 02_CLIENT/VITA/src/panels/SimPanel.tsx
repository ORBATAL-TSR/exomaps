import { useState, useEffect, useCallback } from 'react';
import {
  listCampaigns,
  campaignSimInit,
  campaignSimTick,
  campaignSimSnapshot,
  simStep,
  simPause,
  simResume,
} from '../services/api';
import type { Campaign } from '../services/api';

const S: Record<string, React.CSSProperties> = {
  root:      { padding: '12px 16px', color: '#c8d4e0', fontSize: 12 },
  heading:   { fontSize: 13, fontWeight: 600, color: '#e2eaf2', marginBottom: 10 },
  row:       { display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' as const },
  select:    { flex: 1, background: '#0d1520', border: '1px solid #1e3048', color: '#c8d4e0', borderRadius: 4, padding: '5px 8px', fontSize: 12 },
  input:     { flex: 1, background: '#0d1520', border: '1px solid #1e3048', color: '#c8d4e0', borderRadius: 4, padding: '5px 8px', fontSize: 12 },
  btn:       { padding: '5px 12px', borderRadius: 4, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 500 },
  btnP:      { background: '#1e4d8c', color: '#e2eaf2' },
  btnS:      { background: '#0d1a2a', color: '#7a9ab8', border: '1px solid #1e3048' },
  status:    { marginTop: 8, fontSize: 11, color: '#5a7a9a' },
  error:     { color: '#ef4444', marginTop: 6, fontSize: 11 },
  pre:       { background: '#080e18', border: '1px solid #1a2a3a', borderRadius: 4, padding: 10, fontSize: 10, fontFamily: 'monospace', overflow: 'auto', maxHeight: 260, color: '#7a9ab8', marginTop: 8 },
  tabs:      { display: 'flex', gap: 4, marginBottom: 12 },
  tabA:      { padding: '4px 12px', borderRadius: 4, border: 'none', cursor: 'pointer', fontSize: 11, background: '#1e4d8c', color: '#e2eaf2' },
  tabI:      { padding: '4px 12px', borderRadius: 4, border: '1px solid #1e3048', cursor: 'pointer', fontSize: 11, background: 'transparent', color: '#5a7a9a' },
  muted:     { color: '#4a6070', fontStyle: 'italic' as const, fontSize: 11 },
};

export function SimPanel() {
  const [mode, setMode] = useState<'campaign' | 'legacy'>('campaign');
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [runId, setRunId] = useState('');
  const [snapshot, setSnapshot] = useState<unknown>(null);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadCampaigns = useCallback(async () => {
    try {
      const res = await listCampaigns('active');
      setCampaigns(res.campaigns);
      if (res.campaigns.length > 0 && !selectedId)
        setSelectedId(res.campaigns[0].id);
    } catch { /* API may not be available */ }
  }, [selectedId]);

  useEffect(() => { loadCampaigns(); }, [loadCampaigns]);

  async function wrap(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try { await fn(); } catch (e: any) {
      setError(e?.message ?? 'Request failed');
    } finally { setBusy(false); }
  }

  const handleInit = () => wrap(async () => {
    const res = await campaignSimInit(selectedId) as any;
    setStatus(`initialized (tick ${res.tick})`);
    setSnapshot(res);
  });

  const handleTick = (count: number) => wrap(async () => {
    const res = await campaignSimTick(selectedId, count) as any;
    setStatus(`tick ${res.tick}`);
    setSnapshot(res);
  });

  const handleSnapshot = () => wrap(async () => {
    const res = await campaignSimSnapshot(selectedId) as any;
    setSnapshot(res);
    setStatus(`snapshot @ tick ${res.tick}`);
  });

  const handleStep = () => wrap(async () => {
    const data = await simStep(runId, 10) as any;
    setSnapshot(data.snapshot);
    setStatus('stepped');
  });

  const handlePause = () => wrap(async () => { await simPause(runId); setStatus('paused'); });
  const handleResume = () => wrap(async () => { await simResume(runId); setStatus('running'); });

  return (
    <div style={S.root}>
      <div style={S.heading}>Simulation Control</div>

      <div style={S.tabs}>
        <button style={mode === 'campaign' ? { ...S.tabA } : { ...S.tabI }} onClick={() => setMode('campaign')}>Campaign</button>
        <button style={mode === 'legacy'   ? { ...S.tabA } : { ...S.tabI }} onClick={() => setMode('legacy')}>Legacy Run ID</button>
      </div>

      {mode === 'campaign' ? (
        <>
          <div style={S.row}>
            <select style={S.select} value={selectedId} onChange={e => setSelectedId(e.target.value)}>
              <option value="">— Select campaign —</option>
              {campaigns.map(c => (
                <option key={c.id} value={c.id}>{c.name} ({c.id.slice(0, 8)})</option>
              ))}
            </select>
          </div>
          <div style={S.row}>
            <button style={{ ...S.btn, ...S.btnP }} onClick={handleInit}      disabled={busy || !selectedId}>Init</button>
            <button style={{ ...S.btn, ...S.btnS }} onClick={() => handleTick(1)}   disabled={busy || !selectedId}>+1 Tick</button>
            <button style={{ ...S.btn, ...S.btnS }} onClick={() => handleTick(10)}  disabled={busy || !selectedId}>+10</button>
            <button style={{ ...S.btn, ...S.btnS }} onClick={() => handleTick(100)} disabled={busy || !selectedId}>+100</button>
            <button style={{ ...S.btn, ...S.btnS }} onClick={handleSnapshot}  disabled={busy || !selectedId}>Snapshot</button>
          </div>
        </>
      ) : (
        <>
          <div style={S.row}>
            <input style={S.input} placeholder="Run ID" value={runId} onChange={e => setRunId(e.target.value)} />
          </div>
          <div style={S.row}>
            <button style={{ ...S.btn, ...S.btnP }} onClick={handleStep}   disabled={busy || !runId}>▶ Step +10</button>
            <button style={{ ...S.btn, ...S.btnS }} onClick={handlePause}  disabled={busy || !runId}>⏸ Pause</button>
            <button style={{ ...S.btn, ...S.btnS }} onClick={handleResume} disabled={busy || !runId}>⏵ Resume</button>
          </div>
        </>
      )}

      {error && <div style={S.error}>{error}</div>}
      <div style={S.status}>Status: {status}</div>

      {snapshot ? (
        <pre style={S.pre}>{JSON.stringify(snapshot, null, 2)}</pre>
      ) : (
        <p style={S.muted}>
          {mode === 'campaign'
            ? 'Select a campaign and press Init to begin.'
            : 'Enter a run ID and press Step to begin.'}
        </p>
      )}
    </div>
  );
}
