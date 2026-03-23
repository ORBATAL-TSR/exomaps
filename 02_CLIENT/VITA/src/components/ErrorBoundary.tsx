/**
 * ErrorBoundary — Catches React render errors and displays
 * a fallback UI instead of a blank screen.
 */

import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  fallback?: ReactNode;
  label?: string;
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`[ErrorBoundary${this.props.label ? ` (${this.props.label})` : ''}]`, error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div
          style={{
            padding: 24,
            color: '#ff6b6b',
            background: '#1a0a0a',
            borderRadius: 6,
            margin: 8,
            fontSize: 13,
            fontFamily: 'monospace',
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 14 }}>
            {this.props.label ? `Error in ${this.props.label}` : 'Component Error'}
          </div>
          <div style={{ color: '#cc5555' }}>
            {this.state.error?.message ?? 'Unknown error'}
          </div>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              marginTop: 12,
              padding: '4px 12px',
              background: '#2a1515',
              border: '1px solid #552222',
              color: '#ff8888',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
