import React, { useEffect, useState, useCallback } from 'react';
import {
  listCampaigns,
  createCampaign,
  archiveCampaign,
  getCampaignMap,
  exploreSystem,
  listFactions,
  createFaction,
  campaignSimInit,
  campaignSimTick,
  campaignSimSnapshot,
} from '../services/api';
import type {
  Campaign,
  CampaignMapSystem,
  Faction,
} from '../types/api';
import './PageShell.css';

export default function CampaignPage() {
  /* ── state ─────────────────────────── */
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [activeCampaign, setActiveCampaign] = useState<Campaign | null>(null);
  const [mapSystems, setMapSystems] = useState<CampaignMapSystem[]>([]);
  const [factions, setFactions] = useState<Faction[]>([]);
  const [simTick, setSimTick] = useState<number | null>(null);
  const [simState, setSimState] = useState<Record<string, unknown> | null>(null);

  /* ── form state ────────────────────── */
  const [newName, setNewName] = useState('');
  const [newSeed, setNewSeed] = useState('');
  const [factionName, setFactionName] = useState('');
  const [factionColor, setFactionColor] = useState('#4d9fff');
  const [exploreId, setExploreId] = useState('');

  /* ── UI state ──────────────────────── */
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /* ── data loaders ──────────────────── */
  const loadCampaigns = useCallback(async () => {
    try {
      const res = await listCampaigns('active');
      setCampaigns(res.campaigns);
    } catch {
      setError('Failed to load campaigns');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadCampaigns(); }, [loadCampaigns]);

  const selectCampaign = useCallback(async (c: Campaign) => {
    setActiveCampaign(c);
    setError(null);
    try {
      const [mapRes, facRes] = await Promise.all([
        getCampaignMap(c.id),
        listFactions(c.id),
      ]);
      setMapSystems(mapRes.systems);
      setFactions(facRes.factions);
    } catch {
      setMapSystems([]);
      setFactions([]);
    }
    // try to load sim state
    try {
      const snap = await campaignSimSnapshot(c.id);
      setSimTick(snap.tick);
      setSimState(snap.state);
    } catch {
      setSimTick(null);
      setSimState(null);
    }
  }, []);

  /* ── actions ───────────────────────── */
  async function handleCreate() {
    if (!newName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const c = await createCampaign(
        newName.trim(),
        newSeed ? Number(newSeed) : undefined,
      );
      setNewName('');
      setNewSeed('');
      await loadCampaigns();
      selectCampaign(c);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Create failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleArchive(id: string) {
    setBusy(true);
    try {
      await archiveCampaign(id);
      if (activeCampaign?.id === id) {
        setActiveCampaign(null);
        setMapSystems([]);
        setFactions([]);
      }
      await loadCampaigns();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Archive failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleExplore() {
    if (!activeCampaign || !exploreId.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await exploreSystem(activeCampaign.id, exploreId.trim());
      setExploreId('');
      const mapRes = await getCampaignMap(activeCampaign.id);
      setMapSystems(mapRes.systems);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Explore failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateFaction() {
    if (!activeCampaign || !factionName.trim()) return;
    setBusy(true);
    try {
      await createFaction(activeCampaign.id, factionName.trim(), factionColor);
      setFactionName('');
      const facRes = await listFactions(activeCampaign.id);
      setFactions(facRes.factions);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Faction create failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleSimInit() {
    if (!activeCampaign) return;
    setBusy(true);
    try {
      const res = await campaignSimInit(activeCampaign.id);
      setSimTick(res.tick);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Sim init failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleSimTick(count: number) {
    if (!activeCampaign) return;
    setBusy(true);
    try {
      const res = await campaignSimTick(activeCampaign.id, count);
      setSimTick(res.tick);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Sim tick failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleSimSnapshot() {
    if (!activeCampaign) return;
    setBusy(true);
    try {
      const snap = await campaignSimSnapshot(activeCampaign.id);
      setSimTick(snap.tick);
      setSimState(snap.state);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Snapshot failed');
    } finally {
      setBusy(false);
    }
  }

  /* ── render ────────────────────────── */
  if (loading) {
    return (
      <div className="page-shell">
        <p className="muted">Loading campaigns…</p>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <div className="page-header">
        <h1>Campaign Dashboard</h1>
        <p className="page-subtitle">
          Create and manage exploration campaigns — fog-of-war, factions, and simulation
        </p>
      </div>

      {error && <p className="text-red" style={{ marginBottom: 12 }}>{error}</p>}

      <div className="page-grid">
        {/* ── Campaigns list ──────────── */}
        <div className="panel">
          <h3 className="panel-title">Campaigns</h3>

          {campaigns.length === 0 ? (
            <p className="muted">No active campaigns. Create one below.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {campaigns.map((c) => (
                <button
                  key={c.id}
                  className={`btn ${activeCampaign?.id === c.id ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => selectCampaign(c)}
                  style={{ textAlign: 'left', fontSize: 12, display: 'flex', justifyContent: 'space-between' }}
                >
                  <span>{c.name}</span>
                  <span className="mono" style={{ opacity: 0.6, fontSize: 10 }}>
                    {c.id.slice(0, 8)}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Create form */}
          <div style={{ marginTop: 16, borderTop: '1px solid var(--border-subtle)', paddingTop: 12 }}>
            <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              <input
                className="input"
                placeholder="Campaign name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                style={{ flex: 1 }}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              />
              <input
                className="input"
                placeholder="Seed"
                type="number"
                value={newSeed}
                onChange={(e) => setNewSeed(e.target.value)}
                style={{ width: 80 }}
              />
            </div>
            <button className="btn btn-primary" onClick={handleCreate} disabled={busy || !newName.trim()}>
              + New Campaign
            </button>
          </div>
        </div>

        {/* ── Active Campaign Detail ──── */}
        <div className="panel" style={{ gridColumn: 'span 2' }}>
          <h3 className="panel-title">
            {activeCampaign ? activeCampaign.name : 'Select a Campaign'}
          </h3>

          {activeCampaign ? (
            <>
              <div className="stat-grid" style={{ marginBottom: 16 }}>
                <div className="stat">
                  <div className="stat-label">ID</div>
                  <div className="stat-value mono" style={{ fontSize: 12 }}>{activeCampaign.id.slice(0, 12)}…</div>
                </div>
                <div className="stat">
                  <div className="stat-label">Seed</div>
                  <div className="stat-value">{activeCampaign.seed ?? '—'}</div>
                </div>
                <div className="stat">
                  <div className="stat-label">Explored</div>
                  <div className="stat-value text-cyan">{mapSystems.length}</div>
                </div>
                <div className="stat">
                  <div className="stat-label">Factions</div>
                  <div className="stat-value">{factions.length}</div>
                </div>
                <div className="stat">
                  <div className="stat-label">Status</div>
                  <div className="stat-value">
                    <span className={`badge ${activeCampaign.status === 'active' ? 'badge-green' : 'badge-amber'}`}>
                      {activeCampaign.status}
                    </span>
                  </div>
                </div>
                <div className="stat">
                  <div className="stat-label">Created</div>
                  <div className="stat-value mono" style={{ fontSize: 11 }}>
                    {new Date(activeCampaign.created_at).toLocaleDateString()}
                  </div>
                </div>
              </div>

              <button
                className="btn btn-secondary"
                onClick={() => handleArchive(activeCampaign.id)}
                disabled={busy}
                style={{ fontSize: 11, opacity: 0.7 }}
              >
                Archive Campaign
              </button>
            </>
          ) : (
            <p className="muted">Select a campaign from the list or create a new one.</p>
          )}
        </div>

        {/* ── Exploration ─────────────── */}
        {activeCampaign && (
          <div className="panel" style={{ gridColumn: 'span 2' }}>
            <h3 className="panel-title">Explored Systems ({mapSystems.length})</h3>

            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              <input
                className="input"
                placeholder="System ID (e.g. Proxima Centauri)"
                value={exploreId}
                onChange={(e) => setExploreId(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleExplore()}
                style={{ flex: 1 }}
              />
              <button className="btn btn-primary" onClick={handleExplore} disabled={busy || !exploreId.trim()}>
                Explore
              </button>
            </div>

            {mapSystems.length === 0 ? (
              <p className="muted">No systems explored yet. Enter a system ID above to start exploring.</p>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>System</th>
                    <th>Scan Level</th>
                    <th>Explored By</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {mapSystems.slice(0, 50).map((s) => (
                    <tr key={s.system_id}>
                      <td className="mono">{s.system_id}</td>
                      <td>
                        <span className={`badge ${s.scan_level >= 3 ? 'badge-green' : s.scan_level >= 2 ? 'badge-amber' : ''}`}>
                          Level {s.scan_level}
                        </span>
                      </td>
                      <td>{s.explored_by ?? '—'}</td>
                      <td className="mono">{new Date(s.explored_at).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {mapSystems.length > 50 && (
              <p className="muted" style={{ marginTop: 8 }}>
                Showing 50 of {mapSystems.length} explored systems.
              </p>
            )}
          </div>
        )}

        {/* ── Factions ───────────────── */}
        {activeCampaign && (
          <div className="panel">
            <h3 className="panel-title">Factions ({factions.length})</h3>

            {factions.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                {factions.map((f) => (
                  <div
                    key={f.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '6px 10px',
                      background: 'var(--bg-surface)',
                      borderRadius: 6,
                      border: '1px solid var(--border-subtle)',
                    }}
                  >
                    <span
                      style={{
                        width: 12,
                        height: 12,
                        borderRadius: '50%',
                        background: f.color,
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>{f.name}</span>
                    <span className="mono muted" style={{ fontSize: 10, marginLeft: 'auto' }}>
                      {f.id.slice(0, 8)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', gap: 6 }}>
              <input
                className="input"
                placeholder="Faction name"
                value={factionName}
                onChange={(e) => setFactionName(e.target.value)}
                style={{ flex: 1 }}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateFaction()}
              />
              <input
                type="color"
                value={factionColor}
                onChange={(e) => setFactionColor(e.target.value)}
                style={{ width: 36, height: 36, border: 'none', background: 'none', cursor: 'pointer' }}
              />
            </div>
            <button
              className="btn btn-secondary"
              onClick={handleCreateFaction}
              disabled={busy || !factionName.trim()}
              style={{ marginTop: 6, width: '100%' }}
            >
              + Add Faction
            </button>
          </div>
        )}

        {/* ── Simulation Control ──────── */}
        {activeCampaign && (
          <div className="panel" style={{ gridColumn: 'span 2' }}>
            <h3 className="panel-title">World Engine Simulation</h3>

            <div className="stat-grid" style={{ marginBottom: 12 }}>
              <div className="stat">
                <div className="stat-label">Current Tick</div>
                <div className="stat-value text-cyan">{simTick ?? '—'}</div>
              </div>
              <div className="stat">
                <div className="stat-label">Status</div>
                <div className="stat-value">{simTick !== null ? 'Initialized' : 'Not Started'}</div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary" onClick={handleSimInit} disabled={busy}>
                Init
              </button>
              <button className="btn btn-secondary" onClick={() => handleSimTick(1)} disabled={busy}>
                +1 Tick
              </button>
              <button className="btn btn-secondary" onClick={() => handleSimTick(10)} disabled={busy}>
                +10
              </button>
              <button className="btn btn-secondary" onClick={() => handleSimTick(100)} disabled={busy}>
                +100
              </button>
              <button className="btn btn-secondary" onClick={handleSimSnapshot} disabled={busy}>
                Snapshot
              </button>
            </div>

            {simState && (
              <pre className="code-block" style={{ marginTop: 12 }}>
                {JSON.stringify(simState, null, 2)}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
