/**
 * ExoMaps Desktop — Main application.
 *
 * ONE Canvas lives here forever. DesktopLayout and SystemFocusView each
 * render their 3D content inside a <View> which is scissor-rendered into
 * this shared Canvas by <View.Port>.
 *
 * Mounting/unmounting a View removes React nodes — it never touches the
 * WebGL context. Context loss is therefore impossible during navigation.
 */

import { Suspense, useState, useCallback, useEffect, useRef } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { Canvas } from '@react-three/fiber';
import { View } from '@react-three/drei';
import { ErrorBoundary } from './components/ErrorBoundary';
import { DesktopLayout } from './components/DesktopLayout';
import { GpuStatusBar } from './components/GpuStatusBar';
import { lazyWithRetry } from './app/lazyWithRetry';
import { ChunkErrorBoundary } from './app/ChunkErrorBoundary';
import { useWebGLCleanup } from './app/useWebGLCleanup';

// Lazy-loaded with retry: the orrery chunk downloads when the user first focuses a
// system. lazyWithRetry re-attempts up to 3× on transient LAN network failures.
const SystemFocusView = lazyWithRetry(
  () => import('./components/SystemFocusView').then(m => ({ default: m.SystemFocusView }))
);

// Mounted inside the shared Canvas — disposes Three.js resources on canvas teardown
// (only fires when canvasKey increments after context-loss recovery, not on nav).
function CanvasCleanup() { useWebGLCleanup(); return null; }
import { LoadingScreen } from './components/LoadingScreen';
import type { LoadStage } from './components/LoadingScreen';
import { useTauriGPU } from './hooks/useTauriGPU';
import { useOfflineCache } from './hooks/useOfflineCache';
import { CampaignProvider } from './hooks/useCampaign';
import { GameModeProvider } from './hooks/useGameMode';

import './App.css';

const SCENE_IMAGES = [
  '/scenes/gas-giant.jpg',
  '/scenes/ocean-world.jpg',
  '/scenes/nebula.jpg',
  '/scenes/binary-stars.jpg',
  '/scenes/icy-moon.jpg',
];
SCENE_IMAGES.forEach(href => {
  const link = document.createElement('link');
  link.rel = 'prefetch';
  link.as = 'image';
  link.href = href;
  document.head.appendChild(link);
});

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export default function App() {
  const gpu = useTauriGPU();
  const cache = useOfflineCache();
  /** The Canvas uses this div as its event source so pointer events on HTML
   *  overlays are forwarded into the shared WebGL context for raycasting. */
  const contentRef = useRef<HTMLDivElement>(null!);

  /** Currently focused system ID (null = on star map). */
  const [focusedSystem, setFocusedSystem] = useState<string | null>(null);
  /** Persists after back-navigation so SFV stays mounted and shaders stay compiled.
   *  Cleared only when a NEW system is focused (triggers re-mount with fresh data). */
  const [sfvSystemId, setSfvSystemId] = useState<string | null>(null);
  const [focusedSystemMeta, setFocusedSystemMeta] = useState<{ name: string; starClass?: string } | null>(null);
  const [loadStage, setLoadStage] = useState<LoadStage>('connecting');
  const [loadSubProgress, setLoadSubProgress] = useState(0);
  const [showLoader, setShowLoader] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  // Bumping this key forces a full Canvas + View remount after context restoration.
  const [canvasKey, setCanvasKey] = useState(0);

  useEffect(() => {
    console.log('[ExoMaps] App mounting...');
    console.log('[ExoMaps] Tauri runtime:', isTauri() ? 'yes' : 'no');
    if (!('WebGLRenderingContext' in window)) {
      setBootError('WebGL is not available in this WebView. 3D features are disabled.');
    }
  }, []);

  // ── WebGL context loss detection & recovery ─────────────────────────────
  // Must be attached after the Canvas element exists. We poll for it once
  // with a short delay since the Canvas mounts asynchronously inside R3F.
  useEffect(() => {
    let canvas: HTMLCanvasElement | null = null;
    let lostAt = 0;

    const onLost = (e: Event) => {
      e.preventDefault(); // required — without this the browser won't attempt restoration
      lostAt = performance.now();
      console.error('[GL] webglcontextlost — D3D11 TDR or device reset');
      setBootError('GPU context lost — attempting recovery…');
    };

    const onRestored = () => {
      const ms = (performance.now() - lostAt).toFixed(0);
      console.log(`[GL] webglcontextrestored after ${ms}ms — remounting canvas`);
      setBootError(null);
      // Force full React remount of the Canvas tree so R3F re-initialises cleanly.
      // sfvSystemId is preserved so the user lands back on the same system.
      setCanvasKey(k => k + 1);
    };

    const attach = () => {
      canvas = document.querySelector('canvas');
      if (!canvas) return;
      canvas.addEventListener('webglcontextlost', onLost);
      canvas.addEventListener('webglcontextrestored', onRestored);
    };

    // Canvas may not be in DOM yet on first paint — wait one frame.
    const raf = requestAnimationFrame(attach);
    return () => {
      cancelAnimationFrame(raf);
      if (canvas) {
        canvas.removeEventListener('webglcontextlost', onLost);
        canvas.removeEventListener('webglcontextrestored', onRestored);
      }
    };
  }, [canvasKey]); // re-attach after each remount

  const handleSystemFocus = useCallback((mainId: string, meta?: { name: string; starClass?: string }) => {
    setFocusedSystemMeta(meta ?? { name: mainId });
    setLoadStage('connecting');
    setLoadSubProgress(0);
    setShowLoader(true);
    setSfvSystemId(mainId);   // always set so SFV stays mounted
    setFocusedSystem(mainId);
  }, []);

  const handleBackToMap = useCallback(() => {
    setShowLoader(false);
    setFocusedSystem(null);   // hides SFV UI; sfvSystemId intentionally kept
    setFocusedSystemMeta(null);
  }, []);

  const handleLoadStage = useCallback((stage: LoadStage) => {
    setLoadStage(stage);
    setLoadSubProgress(0);
  }, []);

  const handleSubProgress = useCallback((p: number) => {
    setLoadSubProgress(p);
  }, []);

  const handleLoaderFadeComplete = useCallback(() => {
    setShowLoader(false);
  }, []);

  return (
    <ErrorBoundary label="App Root">
      <GameModeProvider>
      <CampaignProvider>
      <BrowserRouter>
        <div className="desktop-app">
          <GpuStatusBar gpu={gpu} cache={cache} />

          {bootError && (
            <div style={{
              background: '#1a1500', color: '#f59e0b',
              padding: '6px 16px', fontSize: 11,
              borderBottom: '1px solid #3d3000',
            }}>
              ⚠ {bootError}
            </div>
          )}

          {/* ── Shared WebGL context ────────────────────────────────────────
               The Canvas is permanent. DL and SFV render 3D content via
               <View> (scissored regions of this Canvas). Switching scenes
               mounts/unmounts Views — zero WebGL context impact.
               canvasKey is bumped on context restoration to force a clean remount. */}
          <div key={canvasKey} className="desktop-content" ref={contentRef}>

            <Canvas
              eventSource={contentRef}
              style={{ position: 'absolute', inset: 0, zIndex: 0 }}
              gl={{
                antialias: false,
                alpha: false,
                powerPreference: 'high-performance',
                failIfMajorPerformanceCaveat: false,
              }}
              raycaster={{ params: { Points: { threshold: 0.3 } } as any }}>
              <View.Port />
              <CanvasCleanup />
            </Canvas>

            {/* DesktopLayout mounts/unmounts normally — it has no heavy shaders. */}
            {!focusedSystem && (
              <ErrorBoundary label="DesktopLayout">
                <DesktopLayout gpu={gpu} onSystemFocus={handleSystemFocus} />
              </ErrorBoundary>
            )}

            {/* SFV stays mounted once first visited (sfvSystemId never cleared).
                active=false → View.visible=false → scissor stops, shaders STAY compiled.
                Re-visiting the same system = zero TDR risk.
                LoadingScreen covers the chunk download delay, so Suspense fallback=null.
                ChunkErrorBoundary catches chunk-load failures and shows a recovery UI. */}
            <ChunkErrorBoundary label="SystemFocusView" onBack={handleBackToMap}>
              <Suspense fallback={null}>
                {sfvSystemId && (
                  <SystemFocusView
                    systemId={sfvSystemId}
                    active={!!focusedSystem}
                    gpu={gpu}
                    onBack={handleBackToMap}
                    onLoadStage={handleLoadStage}
                    onSubProgress={handleSubProgress}
                  />
                )}
              </Suspense>
            </ChunkErrorBoundary>

          </div>

          {showLoader && focusedSystem && (
            <LoadingScreen
              systemName={focusedSystemMeta?.name ?? focusedSystem ?? ''}
              starClass={focusedSystemMeta?.starClass}
              stage={loadStage}
              subProgress={loadSubProgress}
              visible={showLoader}
              onFadeComplete={handleLoaderFadeComplete}
            />
          )}
        </div>
      </BrowserRouter>
      </CampaignProvider>
      </GameModeProvider>
    </ErrorBoundary>
  );
}
