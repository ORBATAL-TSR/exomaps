/**
 * GpuStatusBar — Thin status bar showing GPU adapter, cache info,
 * online/offline status, and a ⚙ Dev drawer for Admin + Sim panels.
 */

import { useState } from 'react';
import type { TauriGPUHook } from '../hooks/useTauriGPU';
import type { OfflineCacheHook } from '../hooks/useOfflineCache';
import { AdminPanel } from '../panels/AdminPanel';
import { SimPanel } from '../panels/SimPanel';

interface Props {
  gpu: TauriGPUHook;
  cache: OfflineCacheHook;
}

type DevTab = 'admin' | 'sim';

export function GpuStatusBar({ gpu, cache }: Props) {
  const [devOpen, setDevOpen] = useState(false);
  const [devTab, setDevTab] = useState<DevTab>('admin');

  const activeGens = Array.from(gpu.generations.values()).filter(
    g => g.state === 'generating'
  );

  return (
    <>
      <div className="gpu-status-bar">
        {/* GPU status */}
        <div className="status-item">
          <span className={`status-dot ${gpu.gpuAvailable ? 'active' : gpu.loading ? 'warning' : 'info'}`} />
          <span>
            {gpu.loading
              ? 'Probing GPU…'
              : gpu.gpuInfo
                ? `${gpu.gpuInfo.name} (${gpu.gpuInfo.backend})`
                : (window as any).__TAURI__ ? 'No GPU' : 'WebGL (Browser)'}
          </span>
        </div>

        {activeGens.length > 0 && (
          <div className="status-item">
            <span className="status-dot warning" />
            <span>Generating {activeGens.length} planet{activeGens.length > 1 ? 's' : ''}…</span>
          </div>
        )}

        <div className="spacer" />

        <div className="status-item">
          <span>{cache.cacheCount} cached system{cache.cacheCount !== 1 ? 's' : ''}</span>
        </div>

        <div className="status-item">
          <span className={`status-dot ${cache.online ? 'active' : 'error'}`} />
          <span>{cache.online ? 'Online' : 'Offline'}</span>
        </div>

        {/* Dev drawer toggle */}
        <button
          onClick={() => setDevOpen(o => !o)}
          style={{ opacity: devOpen ? 1 : undefined }}
          title="Developer tools"
        >
          ⚙ Dev
        </button>
      </div>

      {/* Dev drawer */}
      {devOpen && (
        <div style={{
          position: 'fixed', top: 28, right: 0, width: 480, maxHeight: 'calc(100vh - 28px)',
          background: '#08111c', borderLeft: '1px solid #1a2a3a', borderBottom: '1px solid #1a2a3a',
          zIndex: 9000, display: 'flex', flexDirection: 'column', overflow: 'hidden',
          boxShadow: '-4px 4px 24px rgba(0,0,0,0.6)',
        }}>
          {/* Drawer tab bar */}
          <div style={{
            display: 'flex', borderBottom: '1px solid #1a2a3a',
            background: '#0c151f', flexShrink: 0,
          }}>
            {(['admin', 'sim'] as DevTab[]).map(tab => (
              <button key={tab} onClick={() => setDevTab(tab)} style={{
                padding: '6px 16px', fontSize: 11, fontWeight: 600,
                background: devTab === tab ? '#0d1e30' : 'transparent',
                border: 'none', borderBottom: devTab === tab ? '2px solid #4d9fff' : '2px solid transparent',
                color: devTab === tab ? '#c8d4e0' : '#4a6070',
                cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.08em',
              }}>
                {tab === 'admin' ? '⚡ Admin' : '▶ Sim'}
              </button>
            ))}
            <div style={{ flex: 1 }} />
            <button onClick={() => setDevOpen(false)} style={{
              padding: '6px 12px', background: 'transparent', border: 'none',
              color: '#4a6070', cursor: 'pointer', fontSize: 14,
            }}>✕</button>
          </div>

          {/* Drawer content */}
          <div style={{ overflow: 'auto', flex: 1 }}>
            {devTab === 'admin' ? <AdminPanel /> : <SimPanel />}
          </div>
        </div>
      )}
    </>
  );
}
