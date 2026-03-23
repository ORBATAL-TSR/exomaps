/**
 * LoadingScreen — Full-viewport overlay shown while SystemFocusView loads.
 *
 * Stages:
 *   connecting   → API handshake
 *   data         → System data fetch
 *   scene        → WebGL scene / shader compile
 *   ready        → Fade out
 *
 * Background: randomly picked space-scene image (public/scenes/) with
 * animated star-field canvas layered over it.
 */

import { useEffect, useRef, useState } from 'react';

// ── Scene image manifest — populated after asset generation ──
const SCENE_IMAGES: string[] = [
  '/scenes/gas-giant.jpg',
  '/scenes/ocean-world.jpg',
  '/scenes/nebula.jpg',
  '/scenes/binary-stars.jpg',
  '/scenes/icy-moon.jpg',
];

type LoadStage = 'connecting' | 'data' | 'scene' | 'ready' | 'failed';

const STAGE_LABELS: Record<LoadStage, string> = {
  connecting: 'CONNECTING TO NETWORK',
  data:       'LOADING SYSTEM DATA',
  scene:      'BUILDING ORRERY',
  ready:      'READY',
  failed:     'CONNECTION FAILED',
};

// Approximate progress % at each stage start
const STAGE_PROGRESS: Record<LoadStage, number> = {
  connecting: 5,
  data:       22,
  scene:      68,
  ready:      100,
  failed:     0,
};

interface LoadingScreenProps {
  systemName: string;
  starClass?: string;
  stage: LoadStage;
  /** 0–1 sub-progress within current stage */
  subProgress?: number;
  visible: boolean;
  onFadeComplete?: () => void;
}

// ── Animated canvas starfield ──────────────────────────────────────────────
function StarCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  const raf = useRef<number>(0);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;

    const resize = () => {
      canvas.width  = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    // Generate stars once
    const N = 320;
    type Star = { x: number; y: number; r: number; speed: number; phase: number; bright: number };
    const stars: Star[] = Array.from({ length: N }, () => ({
      x:      Math.random(),
      y:      Math.random(),
      r:      0.4 + Math.random() * 1.2,
      speed:  0.3 + Math.random() * 0.7,
      phase:  Math.random() * Math.PI * 2,
      bright: 0.3 + Math.random() * 0.7,
    }));

    let t = 0;
    const draw = () => {
      const W = canvas.width, H = canvas.height;
      ctx.clearRect(0, 0, W, H);

      for (const s of stars) {
        const twinkle = 0.6 + 0.4 * Math.sin(t * s.speed + s.phase);
        const alpha = s.bright * twinkle;
        ctx.beginPath();
        ctx.arc(s.x * W, s.y * H, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(200,220,255,${alpha.toFixed(3)})`;
        ctx.fill();
      }

      t += 0.016;
      raf.current = requestAnimationFrame(draw);
    };
    raf.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf.current);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      style={{
        position: 'absolute', inset: 0, width: '100%', height: '100%',
        pointerEvents: 'none',
      }}
    />
  );
}

// ── Scanline overlay for CRT flavour ──────────────────────────────────────
function Scanlines() {
  return (
    <div style={{
      position: 'absolute', inset: 0, pointerEvents: 'none',
      backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.08) 2px, rgba(0,0,0,0.08) 4px)',
      backgroundSize: '100% 4px',
    }} />
  );
}

// ── Progress bar ────────────────────────────────────────────────────────────
function ProgressBar({ pct, stage }: { pct: number; stage: LoadStage }) {
  const isReady = stage === 'ready';
  return (
    <div style={{
      width: '100%', maxWidth: 480,
      margin: '0 auto',
    }}>
      {/* Track */}
      <div style={{
        height: 2,
        background: 'rgba(77,159,255,0.15)',
        borderRadius: 1,
        overflow: 'hidden',
        position: 'relative',
      }}>
        {/* Fill */}
        <div style={{
          position: 'absolute', top: 0, left: 0,
          height: '100%',
          width: `${pct}%`,
          background: isReady
            ? 'linear-gradient(90deg, #4d9fff, #a0d4ff)'
            : 'linear-gradient(90deg, #1a4d99, #4d9fff)',
          transition: 'width 0.6s cubic-bezier(0.4,0,0.2,1)',
          boxShadow: '0 0 8px rgba(77,159,255,0.6)',
        }} />
        {/* Shimmer */}
        {!isReady && (
          <div style={{
            position: 'absolute', top: 0,
            width: 60, height: '100%',
            background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.35), transparent)',
            animation: 'ls-shimmer 1.8s ease-in-out infinite',
          }} />
        )}
      </div>
      {/* Pct label */}
      <div style={{
        marginTop: 6,
        display: 'flex', justifyContent: 'space-between',
        fontSize: 9, letterSpacing: '0.08em', color: 'rgba(77,159,255,0.55)',
        fontFamily: 'monospace',
      }}>
        <span>{STAGE_LABELS[stage]}</span>
        <span>{Math.round(pct)}%</span>
      </div>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────
export function LoadingScreen({
  systemName, starClass, stage, subProgress = 0, visible, onFadeComplete,
}: LoadingScreenProps) {
  const [opacity, setOpacity] = useState(1);
  const [imgSrc] = useState(() => {
    const idx = Math.floor(Math.random() * SCENE_IMAGES.length);
    return SCENE_IMAGES[idx];
  });
  const [imgLoaded, setImgLoaded] = useState(false);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Compute final progress % — all stages driven by real subProgress events from SFV.
  // scene stage milestones: 0=data loaded, 0.5=warmupReady, 1.0=shaderWarmed→ready
  let pct: number;
  if (stage === 'ready') {
    pct = 100;
  } else if (stage === 'failed') {
    pct = 0;
  } else {
    const stageBase = STAGE_PROGRESS[stage];
    const ORDER: LoadStage[] = ['connecting', 'data', 'scene', 'ready'];
    const ni = ORDER.indexOf(stage) + 1;
    const nextBase = ORDER[ni] ? STAGE_PROGRESS[ORDER[ni]] : 100;
    pct = stageBase + (nextBase - stageBase) * subProgress;
  }

  // Fade out when stage hits ready
  useEffect(() => {
    if (stage === 'ready' && visible) {
      fadeTimer.current = setTimeout(() => {
        setOpacity(0);
        setTimeout(() => onFadeComplete?.(), 600);
      }, 400);
    }
    return () => clearTimeout(fadeTimer.current);
  }, [stage, visible, onFadeComplete]);

  if (!visible && opacity === 0) return null;

  return (
    <>
      {/* Keyframe injection */}
      <style>{`
        @keyframes ls-shimmer {
          0%   { left: -60px; }
          100% { left: calc(100% + 60px); }
        }
        @keyframes ls-pulse {
          0%, 100% { opacity: 0.5; }
          50%       { opacity: 1.0; }
        }
        @keyframes ls-spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>

      <div style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        opacity,
        transition: 'opacity 0.6s ease',
        pointerEvents: opacity === 0 ? 'none' : 'all',
      }}>
        {/* Space scene background */}
        {imgLoaded && (
          <div style={{
            position: 'absolute', inset: 0,
            backgroundImage: `url(${imgSrc})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            filter: 'brightness(0.45) saturate(1.3)',
          }} />
        )}
        {/* Dark gradient fallback / vignette */}
        <div style={{
          position: 'absolute', inset: 0,
          background: imgLoaded
            ? 'radial-gradient(ellipse at center, rgba(2,4,10,0.35) 0%, rgba(2,4,10,0.75) 100%)'
            : 'radial-gradient(ellipse at center, #060a18 0%, #020408 100%)',
        }} />

        {/* Animated starfield */}
        <StarCanvas />
        <Scanlines />

        {/* Hidden img for preload — fetchpriority=high so it doesn't queue behind other assets */}
        <img
          src={imgSrc}
          fetchPriority="high"
          style={{ display: 'none' }}
          onLoad={() => setImgLoaded(true)}
          onError={() => setImgLoaded(false)}
          alt=""
        />

        {/* Content */}
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          gap: 28,
          padding: '0 32px',
        }}>
          {/* Logo / tagline */}
          <div style={{
            fontFamily: 'monospace',
            fontSize: 10,
            letterSpacing: '0.25em',
            color: 'rgba(77,159,255,0.4)',
            textTransform: 'uppercase',
          }}>
            EXOMAPS · STELLAR NAVIGATION
          </div>

          {/* System name */}
          <div style={{ textAlign: 'center' }}>
            <div style={{
              fontFamily: 'monospace',
              fontSize: 32,
              fontWeight: 300,
              letterSpacing: '0.12em',
              color: '#c8dcff',
              textShadow: '0 0 40px rgba(77,159,255,0.5)',
              lineHeight: 1.1,
            }}>
              {systemName || '—'}
            </div>
            {starClass && (
              <div style={{
                marginTop: 6,
                fontFamily: 'monospace',
                fontSize: 11,
                letterSpacing: '0.2em',
                color: 'rgba(160,200,255,0.5)',
              }}>
                SPECTRAL CLASS {starClass.toUpperCase()}
              </div>
            )}
          </div>

          {/* Spinner or error icon */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {stage === 'failed' ? (
              <div style={{
                fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.08em',
                color: '#ff6b6b',
                padding: '6px 14px',
                border: '1px solid rgba(255,107,107,0.3)',
                borderRadius: 3,
              }}>
                NO DATA SOURCE AVAILABLE — CHECK GATEWAY
              </div>
            ) : stage !== 'ready' && (
              <div style={{
                width: 14, height: 14,
                border: '1.5px solid rgba(77,159,255,0.2)',
                borderTopColor: '#4d9fff',
                borderRadius: '50%',
                animation: 'ls-spin 0.9s linear infinite',
                flexShrink: 0,
              }} />
            )}
          </div>

          {/* Progress bar */}
          <div style={{ width: '100%', maxWidth: 480 }}>
            <ProgressBar pct={pct} stage={stage} />
          </div>

          {/* Bottom flavour text */}
          <div style={{
            fontFamily: 'monospace',
            fontSize: 9,
            letterSpacing: '0.12em',
            color: 'rgba(77,159,255,0.25)',
            marginTop: 8,
            animation: 'ls-pulse 3s ease-in-out infinite',
          }}>
            {stage === 'connecting' && 'HANDSHAKING WITH GATEWAY…'}
            {stage === 'data'       && 'PULLING STELLAR DATABASE…'}
            {stage === 'scene'      && 'COMPILING ORBITAL MECHANICS…'}
            {stage === 'ready'      && 'ENTERING SYSTEM'}
            {stage === 'failed'     && 'RETRY OR CHECK NETWORK CONNECTION'}
          </div>
        </div>
      </div>
    </>
  );
}

export type { LoadStage };
