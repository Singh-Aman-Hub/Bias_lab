import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 300,
          padding: 48,
          gap: 16,
          color: 'var(--text-secondary)',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 48, color: 'var(--warning)' }}>!</div>
          <h2 style={{ color: 'var(--text-primary)', fontSize: '1.2rem' }}>Unexpected error</h2>
          <p style={{ maxWidth: 400, fontSize: '0.85rem', lineHeight: 1.6 }}>
            Something went wrong rendering this view. The application state is preserved.
          </p>
          <button
            className="btn btn-primary"
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{ marginTop: 8 }}
          >
            Dismiss and retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
