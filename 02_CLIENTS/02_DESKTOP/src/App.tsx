/**
 * ExoMaps Desktop — Main application.
 *
 * Tauri WebView frontend that reuses the web client's R3F star map
 * and adds desktop-specific features:
 *   - Native GPU planet generation (via Tauri IPC)
 *   - Multi-viewport layout
 *   - Offline mode with SQLite cache
 *   - System-focused "game mode"
 */

import { useState, useCallback, useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { DesktopLayout } from './components/DesktopLayout';
import { GpuStatusBar } from './components/GpuStatusBar';
import { SystemFocusView } from './components/SystemFocusView';
import { useTauriGPU } from './hooks/useTauriGPU';
import { useOfflineCache } from './hooks/useOfflineCache';
import { CampaignProvider } from './hooks/useCampaign';
import { GameModeProvider } from './hooks/useGameMode';

import './App.css';

/** Detect whether we're running inside a Tauri WebView. */
function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export default function App() {
  const gpu = useTauriGPU();
  const cache = useOfflineCache();
  const [focusedSystem, setFocusedSystem] = useState<string | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);

  // Simple boot diagnostics
  useEffect(() => {
    console.log('[ExoMaps] App mounting...');
    console.log('[ExoMaps] Tauri runtime:', isTauri() ? 'yes' : 'no');
    console.log('[ExoMaps] User agent:', navigator.userAgent);

    // Check WebGL support
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      if (gl) {
        const dbg = (gl as WebGLRenderingContext).getExtension('WEBGL_debug_renderer_info');
        const renderer = dbg ? (gl as WebGLRenderingContext).getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown';
        console.log('[ExoMaps] WebGL:', renderer);
      } else {
        console.warn('[ExoMaps] WebGL NOT available — 3D viewports will not work');
        setBootError('WebGL is not available in this WebView. 3D features are disabled.');
      }
    } catch (e) {
      console.warn('[ExoMaps] WebGL detection failed:', e);
    }
  }, []);

  const handleSystemFocus = useCallback((mainId: string) => {
    setFocusedSystem(mainId);
  }, []);

  const handleBackToMap = useCallback(() => {
    setFocusedSystem(null);
  }, []);

  return (
    <ErrorBoundary label="App Root">
      <GameModeProvider>
      <CampaignProvider>
      <BrowserRouter>
        <div className="desktop-app">
          {/* GPU status bar at the top */}
          <GpuStatusBar gpu={gpu} cache={cache} />

          {bootError && (
            <div style={{
              background: '#1a1500',
              color: '#f59e0b',
              padding: '6px 16px',
              fontSize: 11,
              borderBottom: '1px solid #3d3000',
            }}>
              ⚠ {bootError}
            </div>
          )}

          <div className="desktop-content">
            <Routes>
              <Route
                path="/"
                element={
                  focusedSystem ? (
                    <ErrorBoundary label="SystemFocusView">
                      <SystemFocusView
                        systemId={focusedSystem}
                        gpu={gpu}
                        onBack={handleBackToMap}
                      />
                    </ErrorBoundary>
                  ) : (
                    <ErrorBoundary label="DesktopLayout">
                      <DesktopLayout
                        gpu={gpu}
                        onSystemFocus={handleSystemFocus}
                      />
                    </ErrorBoundary>
                  )
                }
              />
            </Routes>
          </div>
        </div>
      </BrowserRouter>
      </CampaignProvider>
      </GameModeProvider>
    </ErrorBoundary>
  );
}
