/**
 * CampaignPanel — Side-panel widget for campaign management.
 *
 * Shows:
 *   - Active campaign name + stats
 *   - Create / switch / archive campaigns
 *   - Fog-of-war stats (systems explored, planets surveyed)
 *   - Simulation controls (init, tick, snapshot)
 *   - Dev-mode toggle
 */

import { useState, useCallback } from 'react';
import { useCampaign } from '../hooks/useCampaign';

/* ── Inline pill badge ───────────────────────────── */
function Badge({ children, color = '#4d9fff' }: { children: React.ReactNode; color?: string }) {
  return (
    <span style={{
      fontSize: 10, padding: '1px 7px', borderRadius: 4,
      background: `${color}22`, color, fontWeight: 600,
      letterSpacing: '0.3px',
    }}>
      {children}
    </span>
  );
}

/* ── Sub-sections ─────────────────────────────────── */

function SectionHeader({ label }: { label: string }) {
  return (
    <div style={{
      fontSize: 10, color: '#556677', textTransform: 'uppercase',
      letterSpacing: '1.5px', fontWeight: 600, marginBottom: 6, marginTop: 14,
    }}>
      {label}
    </div>
  );
}

/* ── Main component ───────────────────────────────── */

export function CampaignPanel() {
  const campaign = useCampaign();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newSeed, setNewSeed] = useState('');
  const [creating, setCreating] = useState(false);
  const [simResult, setSimResult] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);

  const handleCreate = useCallback(async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await campaign.createCampaign(
        newName.trim(),
        newSeed ? parseInt(newSeed, 10) : undefined,
      );
      setNewName('');
      setNewSeed('');
      setShowCreate(false);
    } catch (err) {
      console.error('[CampaignPanel] Create failed:', err);
    } finally {
      setCreating(false);
    }
  }, [newName, newSeed, campaign]);

  const handleInitSim = useCallback(async () => {
    try {
      await campaign.initSimulation();
      setSimResult('Simulation initialized');
    } catch (err: any) {
      setSimResult(`Error: ${err.message}`);
    }
  }, [campaign]);

  const handleTick = useCallback(async (n: number) => {
    try {
      const result = await campaign.tickSimulation(n);
      setSimResult(`+${result.ticks_executed} ticks → year ${result.simulated_year} (${result.events_generated} events)`);
    } catch (err: any) {
      setSimResult(`Error: ${err.message}`);
    }
  }, [campaign]);

  const active = campaign.activeCampaign;
  const explored = campaign.exploredSystems.size;

  return (
    <div style={{ fontSize: 12 }}>

      {/* ── Active campaign header ─────────────── */}
      <SectionHeader label="Campaign" />

      {active ? (
        <div style={{
          background: 'linear-gradient(135deg, rgba(22,32,48,0.8), rgba(15,25,35,0.9))',
          border: '1px solid rgba(77,159,255,0.2)',
          borderRadius: 8, padding: 12, marginBottom: 8,
        }}>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            marginBottom: 6,
          }}>
            <span style={{ fontWeight: 600, color: '#e8edf5', fontSize: 14 }}>
              {active.name}
            </span>
            <Badge color="#4caf50">{active.status}</Badge>
          </div>

          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4,
            fontSize: 11, color: '#8899aa',
          }}>
            <div>
              <div style={{ color: '#556677', fontSize: 9 }}>EXPLORED</div>
              <div style={{ color: '#a8c8ff', fontWeight: 600 }}>{active.systems_explored}</div>
            </div>
            <div>
              <div style={{ color: '#556677', fontSize: 9 }}>PLANETS</div>
              <div style={{ color: '#a8c8ff', fontWeight: 600 }}>{active.planets_surveyed}</div>
            </div>
            <div>
              <div style={{ color: '#556677', fontSize: 9 }}>FACTIONS</div>
              <div style={{ color: '#a8c8ff', fontWeight: 600 }}>{active.factions}</div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button onClick={() => setShowPicker(p => !p)} style={btnStyle('#334455')}>
              Switch
            </button>
            <button onClick={() => campaign.deleteCampaign(active.id)} style={btnStyle('#663333')}>
              Archive
            </button>
          </div>
        </div>
      ) : (
        <div style={{
          color: '#556677', padding: '12px 0', fontSize: 11,
          textAlign: 'center', fontStyle: 'italic',
        }}>
          No active campaign — create one to begin exploring
        </div>
      )}

      {/* ── Campaign picker ────────────────────── */}
      {showPicker && (
        <div style={{ marginBottom: 8 }}>
          {campaign.loadingCampaigns ? (
            <div style={{ color: '#556677', fontSize: 11 }}>Loading…</div>
          ) : campaign.campaigns.length === 0 ? (
            <div style={{ color: '#556677', fontSize: 11 }}>No campaigns yet</div>
          ) : (
            campaign.campaigns.map(c => (
              <div
                key={c.id}
                onClick={() => { campaign.selectCampaign(c.id); setShowPicker(false); }}
                style={{
                  padding: '6px 10px', borderRadius: 6, cursor: 'pointer',
                  background: c.id === campaign.activeCampaignId
                    ? 'rgba(77,159,255,0.12)' : 'transparent',
                  border: c.id === campaign.activeCampaignId
                    ? '1px solid rgba(77,159,255,0.3)' : '1px solid transparent',
                  marginBottom: 3, fontSize: 12, color: '#c0c8d4',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => {
                  if (c.id !== campaign.activeCampaignId)
                    e.currentTarget.style.background = 'rgba(30,48,80,0.3)';
                }}
                onMouseLeave={e => {
                  if (c.id !== campaign.activeCampaignId)
                    e.currentTarget.style.background = 'transparent';
                }}
              >
                <div style={{ fontWeight: 500 }}>{c.name}</div>
                <div style={{ fontSize: 10, color: '#556677' }}>
                  {c.systems_explored} systems · {c.planets_surveyed} planets
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Create new campaign ────────────────── */}
      {showCreate ? (
        <div style={{
          background: 'rgba(22,32,48,0.6)', borderRadius: 8,
          padding: 10, marginBottom: 8,
          border: '1px solid rgba(30,48,80,0.6)',
        }}>
          <input
            type="text" placeholder="Campaign name"
            value={newName} onChange={e => setNewName(e.target.value)}
            style={inputStyle}
            autoFocus
            onKeyDown={e => e.key === 'Enter' && handleCreate()}
          />
          <input
            type="text" placeholder="Seed (optional)"
            value={newSeed} onChange={e => setNewSeed(e.target.value)}
            style={{ ...inputStyle, marginTop: 6 }}
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button onClick={handleCreate} disabled={creating} style={btnStyle('#1e4d2e')}>
              {creating ? 'Creating…' : 'Create'}
            </button>
            <button onClick={() => setShowCreate(false)} style={btnStyle('#334455')}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setShowCreate(true)} style={{
          ...btnStyle('#1c2a3e'), width: '100%', marginBottom: 8,
          borderColor: 'rgba(77,159,255,0.3)', color: '#4d9fff',
        }}>
          + New Campaign
        </button>
      )}

      {/* ── Fog-of-war stats ───────────────────── */}
      {active && (
        <>
          <SectionHeader label="Fog of War" />
          <div style={{
            fontSize: 11, color: '#8899aa',
            display: 'flex', gap: 12, alignItems: 'center',
          }}>
            <span>
              <span style={{ color: '#4d9fff', fontWeight: 600 }}>{explored}</span> systems revealed
            </span>
            {campaign.loadingMap && <span style={{ color: '#556677' }}>refreshing…</span>}
          </div>
        </>
      )}

      {/* ── Simulation controls ────────────────── */}
      {active && (
        <>
          <SectionHeader label="World Engine" />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button onClick={handleInitSim} style={btnStyle('#1e3050')}>
              Init Sim
            </button>
            <button onClick={() => handleTick(1)} style={btnStyle('#1e3050')}>
              +1 Tick
            </button>
            <button onClick={() => handleTick(10)} style={btnStyle('#1e3050')}>
              +10 Ticks
            </button>
            <button onClick={() => handleTick(100)} style={btnStyle('#1e3050')}>
              +100 Ticks
            </button>
          </div>
          {simResult && (
            <div style={{
              fontSize: 10, color: simResult.startsWith('Error') ? '#f87171' : '#6ee7b7',
              marginTop: 4, fontFamily: 'monospace',
            }}>
              {simResult}
            </div>
          )}
        </>
      )}

      {/* ── Dev mode toggle ────────────────────── */}
      <SectionHeader label="Developer" />
      <label style={{
        display: 'flex', alignItems: 'center', gap: 8,
        cursor: 'pointer', fontSize: 12, color: '#8899aa',
      }}>
        <input
          type="checkbox"
          checked={campaign.devMode}
          onChange={campaign.toggleDevMode}
          style={{ accentColor: '#f59e0b' }}
        />
        <span>Dev Mode</span>
        {campaign.devMode && <Badge color="#f59e0b">ON</Badge>}
      </label>
      {campaign.devMode && (
        <div style={{ fontSize: 10, color: '#665533', marginTop: 4 }}>
          Exploration restrictions lifted. Planet regeneration enabled.
        </div>
      )}
    </div>
  );
}

/* ── Shared styles ────────────────────────────────── */

const btnStyle = (bg: string): React.CSSProperties => ({
  padding: '5px 12px', fontSize: 11, fontWeight: 500,
  background: bg, border: '1px solid rgba(77,159,255,0.2)',
  color: '#c0c8d4', borderRadius: 5, cursor: 'pointer',
  transition: 'opacity 0.15s',
});

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '7px 10px', fontSize: 12,
  background: 'rgba(15,22,35,0.8)', border: '1px solid rgba(30,48,80,0.6)',
  borderRadius: 5, color: '#e8edf5', outline: 'none',
  boxSizing: 'border-box' as const,
};
