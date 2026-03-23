/**
 * ChunkErrorBoundary — catches two distinct failure modes:
 *
 *   ChunkLoadError   A Vite/Rollup chunk failed to download (network hiccup,
 *                    deploy mismatch, or Flask incorrectly returning index.html
 *                    for a missing asset). User sees "Retry" + "Return to map".
 *
 *   RenderError      A runtime JS error inside a scene component (null deref,
 *                    bad shader uniform, etc.). Logs to console with label for
 *                    easy triage. User sees the same recovery UI.
 *
 * Usage:
 *   <ChunkErrorBoundary label="SystemFocusView" onBack={() => navigate('/')}>
 *     <Suspense fallback={<LoadingSpinner />}>
 *       <SystemFocusView ... />
 *     </Suspense>
 *   </ChunkErrorBoundary>
 */

import React from 'react';

// Patterns that identify a chunk-load failure vs. a render error
const CHUNK_ERROR_PATTERNS = [
  /Loading chunk/i,
  /Failed to fetch/i,
  /ChunkLoadError/i,
  /dynamically imported module/i,
  /Importing a module script failed/i,
];

function isChunkError(err: Error): boolean {
  return CHUNK_ERROR_PATTERNS.some(p => p.test(err.message));
}

// ── Recovery UI ──────────────────────────────────────────────────────────────
function RecoveryPanel({
  error,
  isChunk,
  label,
  onRetry,
  onBack,
}: {
  error: Error | null;
  isChunk: boolean;
  label?: string;
  onRetry: () => void;
  onBack?: () => void;
}) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 2000,
      background: '#020408',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: 20, padding: '0 32px',
      fontFamily: 'monospace',
    }}>
      <div style={{ fontSize: 10, letterSpacing: '0.25em', color: 'rgba(255,100,100,0.5)' }}>
        EXOMAPS · {isChunk ? 'CHUNK LOAD FAILURE' : 'RENDER ERROR'}
      </div>

      <div style={{ fontSize: 13, color: '#ff8888', maxWidth: 520, textAlign: 'center', lineHeight: 1.6 }}>
        {isChunk
          ? 'A scene module failed to load. This usually resolves with a retry.'
          : `An error occurred in ${label ?? 'the scene'}.`}
      </div>

      {error && (
        <pre style={{
          fontSize: 9, color: 'rgba(255,100,100,0.45)',
          maxWidth: 520, overflow: 'hidden', textOverflow: 'ellipsis',
          whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          borderLeft: '2px solid rgba(255,100,100,0.2)',
          padding: '6px 10px', maxHeight: 80,
        }}>
          {error.message}
        </pre>
      )}

      <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
        <button
          onClick={onRetry}
          style={{
            fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.12em',
            padding: '8px 20px', cursor: 'pointer',
            background: 'transparent',
            border: '1px solid rgba(77,159,255,0.5)',
            color: '#4d9fff', borderRadius: 3,
          }}
        >
          RETRY
        </button>
        {onBack && (
          <button
            onClick={onBack}
            style={{
              fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.12em',
              padding: '8px 20px', cursor: 'pointer',
              background: 'transparent',
              border: '1px solid rgba(120,120,160,0.35)',
              color: 'rgba(180,190,220,0.6)', borderRadius: 3,
            }}
          >
            ← STAR MAP
          </button>
        )}
      </div>
    </div>
  );
}

// ── Class boundary ───────────────────────────────────────────────────────────
interface Props {
  children: React.ReactNode;
  label?: string;
  onBack?: () => void;
}
interface State {
  hasError: boolean;
  isChunk: boolean;
  error: Error | null;
}

export class ChunkErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, isChunk: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, isChunk: isChunkError(error), error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    const label = this.props.label ?? 'unknown';
    if (isChunkError(error)) {
      console.error(`[ChunkError] ${label}: chunk failed to load —`, error.message);
    } else {
      console.error(`[RenderError] ${label}:`, error.message, '\n', info.componentStack?.slice(0, 400));
    }
  }

  retry = () => {
    this.setState({ hasError: false, isChunk: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <RecoveryPanel
          error={this.state.error}
          isChunk={this.state.isChunk}
          label={this.props.label}
          onRetry={this.retry}
          onBack={this.props.onBack}
        />
      );
    }
    return this.props.children;
  }
}
