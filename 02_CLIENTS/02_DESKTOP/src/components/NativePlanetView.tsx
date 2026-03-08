/**
 * NativePlanetView — Overlay bridge for native wgpu Vulkan planet viewport.
 *
 * Opens a borderless native OS window (wgpu + Vulkan) and keeps it positioned
 * exactly over this component's DOM rectangle. The overlay tracks position via:
 *  - ResizeObserver (size changes / layout shifts)
 *  - MutationObserver (style changes)  
 *  - polling interval (window drags, which produce no DOM events)
 *
 * Transparent background so the native viewport shows through where this div sits.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

interface Props {
  planetKey: string;
  texturesReady: boolean;
  starTeff?: number;
  starLuminosity?: number;
  oceanLevel?: number;
  atmosphereColor?: [number, number, number];
  atmosphereThickness?: number;
  onFrameRendered?: (ms: number) => void;
}

export function NativePlanetView({
  planetKey,
  texturesReady,
  starTeff = 5778,
  starLuminosity = 1.0,
  oceanLevel = 0.4,
  atmosphereColor = [0.3, 0.5, 0.9],
  atmosphereThickness = 0.5,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewportOpen, setViewportOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastPos = useRef({ x: 0, y: 0, w: 0, h: 0 });

  // Sync overlay position: measure div rect + window position → screen coords
  const syncPosition = useCallback(async () => {
    const el = containerRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;

    try {
      const win = getCurrentWindow();
      const [winPos, scaleFactor] = await Promise.all([
        win.innerPosition(),  // content area origin (excludes title bar decorations)
        win.scaleFactor(),
      ]);

      // getBoundingClientRect returns CSS pixels; convert to physical pixels
      const x = Math.round(winPos.x + rect.left * scaleFactor);
      const y = Math.round(winPos.y + rect.top * scaleFactor);
      const w = Math.round(rect.width * scaleFactor);
      const h = Math.round(rect.height * scaleFactor);

      // Only send if changed (avoid spamming the IPC channel)
      const prev = lastPos.current;
      if (prev.x === x && prev.y === y && prev.w === w && prev.h === h) return;
      lastPos.current = { x, y, w, h };

      await invoke('sync_viewport_position', {
        x,
        y,
        width: w,
        height: h,
      });
    } catch (err) {
      // Window may not be ready yet — ignore transient errors
      console.debug('[NativePlanetView] syncPosition error:', err);
    }
  }, []);

  // Open native viewport when textures are ready
  useEffect(() => {
    if (!texturesReady) {
      setViewportOpen(false);
      return;
    }

    invoke('open_planet_viewport', {
      planetKey,
      starTeff,
      starLuminosity,
      oceanLevel,
      atmosphereColor,
      atmosphereThickness,
    })
      .then(() => {
        setViewportOpen(true);
        setError(null);
        // Initial position sync after a short delay to let layout settle
        setTimeout(syncPosition, 50);
      })
      .catch((err) => {
        console.error('[NativePlanetView] Failed to open viewport:', err);
        setError(String(err));
      });
  }, [texturesReady, planetKey, syncPosition]);

  // Update params when they change
  useEffect(() => {
    if (!viewportOpen) return;
    invoke('open_planet_viewport', {
      planetKey,
      starTeff,
      starLuminosity,
      oceanLevel,
      atmosphereColor,
      atmosphereThickness,
    }).catch(() => {});
  }, [starTeff, starLuminosity, oceanLevel, atmosphereColor, atmosphereThickness]);

  // Position tracking: ResizeObserver + polling interval
  useEffect(() => {
    if (!viewportOpen) return;

    const el = containerRef.current;
    if (!el) return;

    // ResizeObserver for layout changes
    const resizeObs = new ResizeObserver(() => {
      syncPosition();
    });
    resizeObs.observe(el);

    // Poll for window moves (no DOM event fires when the OS window is dragged)
    const pollId = setInterval(syncPosition, 200);

    // Initial sync
    syncPosition();

    return () => {
      resizeObs.disconnect();
      clearInterval(pollId);
    };
  }, [viewportOpen, syncPosition]);

  // Track main window focus/blur — hide overlay when user switches to another app
  useEffect(() => {
    if (!viewportOpen) return;

    const win = getCurrentWindow();
    let unlisten: (() => void) | null = null;

    win.onFocusChanged(({ payload: focused }) => {
      if (focused) {
        // Main window regained focus — show the overlay and re-sync position
        invoke('show_planet_viewport').catch(() => {});
        syncPosition();
      } else {
        // Main window lost focus — hide the overlay so it doesn't cover other apps
        invoke('hide_planet_viewport').catch(() => {});
      }
    }).then(fn => { unlisten = fn; });

    return () => {
      if (unlisten) unlisten();
    };
  }, [viewportOpen, syncPosition]);

  // Close viewport on unmount
  useEffect(() => {
    return () => {
      invoke('close_planet_viewport').catch(() => {});
    };
  }, []);

  const containerStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
    position: 'relative',
    // Transparent so the native overlay window shows through
    background: 'transparent',
  };

  const overlayLabelStyle: React.CSSProperties = {
    position: 'absolute',
    bottom: 8,
    right: 10,
    fontSize: 10,
    color: '#4d9fff44',
    fontFamily: 'monospace',
    pointerEvents: 'none',
    zIndex: 1,
  };

  if (error) {
    return (
      <div ref={containerRef} style={{
        ...containerStyle,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#060a12',
      }}>
        <span style={{ color: '#ff4444', fontSize: 12 }}>Viewport error: {error}</span>
      </div>
    );
  }

  if (!texturesReady) {
    return (
      <div ref={containerRef} style={{
        ...containerStyle,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#060a12',
        color: '#667788',
        fontSize: 12,
        fontFamily: 'monospace',
      }}>
        <span>Generating planet textures...</span>
      </div>
    );
  }

  return (
    <div ref={containerRef} style={containerStyle}>
      {/* Label floats in bottom-right corner — the native viewport renders behind/through this div */}
      <span style={overlayLabelStyle}>
        wgpu Vulkan — {planetKey}
      </span>
    </div>
  );
}
