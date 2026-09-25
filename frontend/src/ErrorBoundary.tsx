import React from 'react';

interface Props {
  section: string;
  children: React.ReactNode;
}

interface State {
  crashed: boolean;
}

/**
 * Catches render crashes inside a section (queue, admin panel) and shows
 * a retry card instead of white-screening the whole app.
 */
export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { crashed: false };

  static getDerivedStateFromError(): State {
    return { crashed: true };
  }

  componentDidCatch(error: unknown) {
    console.error(`[ErrorBoundary:${this.props.section}]`, error);
  }

  render() {
    if (this.state.crashed) {
      return (
        <div className="card" style={{ borderLeft: '4px solid var(--danger)' }}>
          <h3 className="card-title">Something went wrong</h3>
          <p className="muted" style={{ fontSize: '0.85rem' }}>
            The {this.props.section} section crashed. The rest of the app is fine.
          </p>
          <button
            onClick={() => this.setState({ crashed: false })}
            style={{
              border: '1px solid var(--border)', background: 'var(--card)', borderRadius: '10px',
              padding: '0.5rem 0.9rem', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 700,
              color: 'var(--blue)', marginTop: '0.5rem',
            }}
          >
            ↻ Retry {this.props.section}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
