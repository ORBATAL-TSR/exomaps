/**
 * GpuStatusBar — Thin status bar showing GPU adapter, cache info,
 * and online/offline status.
 */

import React from 'react';
import type { TauriGPUHook } from '../hooks/useTauriGPU';
import type { OfflineCacheHook } from '../hooks/useOfflineCache';

interface Props {
  gpu: TauriGPUHook;
  cache: OfflineCacheHook;
}

export function GpuStatusBar({ gpu, cache }: Props) {
  const activeGens = Array.from(gpu.generations.values()).filter(
    g => g.state === 'generating'
  );

  return (
    <div className="gpu-status-bar">
      {/* GPU status */}
      <div className="status-item">
        <span
          className={`status-dot ${gpu.gpuAvailable ? 'active' : gpu.loading ? 'warning' : 'error'}`}
        />
        <span>
          {gpu.loading
            ? 'Probing GPU…'
            : gpu.gpuInfo
              ? `${gpu.gpuInfo.name} (${gpu.gpuInfo.backend})`
              : 'No GPU'}
        </span>
      </div>

      {/* Active generations */}
      {activeGens.length > 0 && (
        <div className="status-item">
          <span className="status-dot warning" />
          <span>Generating {activeGens.length} planet{activeGens.length > 1 ? 's' : ''}…</span>
        </div>
      )}

      <div className="spacer" />

      {/* Cache info */}
      <div className="status-item">
        <span>{cache.cacheCount} cached system{cache.cacheCount !== 1 ? 's' : ''}</span>
      </div>

      {/* Online status */}
      <div className="status-item">
        <span className={`status-dot ${cache.online ? 'active' : 'error'}`} />
        <span>{cache.online ? 'Online' : 'Offline'}</span>
      </div>
    </div>
  );
}
