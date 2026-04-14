/**
 * ExtensionErrorBoundary
 *
 * React error boundary that catches crashes inside extension renders.
 * Instead of bringing down the whole launcher, it shows a recovery UI
 * that lets the user dismiss the extension or report the error.
 */

import React from 'react';

interface Props {
  extensionName?: string;
  onDismiss?: () => void;
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

export class ExtensionErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    this.setState({ errorInfo });
    console.error('[ExtensionErrorBoundary] Extension crashed:', error, errorInfo);
  }

  render(): React.ReactNode {
    if (!this.state.hasError) return this.props.children;

    const { extensionName, onDismiss } = this.props;
    const { error } = this.state;

    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          padding: '32px',
          gap: '16px',
          textAlign: 'center',
          color: 'var(--sc-text-primary, #fff)',
          background: 'var(--sc-bg, #1a1a1a)',
        }}
      >
        <div style={{ fontSize: '32px' }}>⚠️</div>
        <div style={{ fontSize: '16px', fontWeight: 600 }}>
          {extensionName ? `"${extensionName}" crashed` : 'Extension crashed'}
        </div>
        <div
          style={{
            fontSize: '13px',
            color: 'var(--sc-text-secondary, rgba(255,255,255,0.5))',
            maxWidth: '400px',
            lineHeight: 1.5,
          }}
        >
          {error?.message || 'An unexpected error occurred in this extension.'}
        </div>
        {onDismiss && (
          <button
            onClick={onDismiss}
            style={{
              marginTop: '8px',
              padding: '8px 20px',
              borderRadius: '8px',
              border: 'none',
              background: 'var(--sc-accent, #5865F2)',
              color: '#fff',
              fontSize: '14px',
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            Dismiss
          </button>
        )}
      </div>
    );
  }
}
