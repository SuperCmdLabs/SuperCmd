import React, { Component, useEffect } from 'react';
import StoreTab from './settings/StoreTab';
import { applyAppFontSize, getDefaultAppFontSize } from './utils/font-size';
import { applyBaseColor } from './utils/base-color';
import { applyUiStyle } from './utils/ui-style';
import { useI18n } from './i18n';

class StoreErrorBoundary extends Component<
  { children: React.ReactNode; errorTitle: string; retryLabel: string },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ExtensionStore] Render error:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="h-full flex flex-col items-center justify-center p-8 text-center">
          <p className="text-sm font-semibold text-[var(--text-primary)] mb-2">
            {this.props.errorTitle}
          </p>
          <p className="text-xs text-[var(--text-subtle)] mb-4 max-w-md break-words">
            {this.state.error.message}
          </p>
          <button
            onClick={() => this.setState({ error: null })}
            className="px-4 py-2 text-xs font-medium rounded-lg border border-[var(--ui-divider)] bg-[var(--ui-segment-bg)] text-[var(--text-secondary)] hover:bg-[var(--ui-segment-hover-bg)] transition-colors"
          >
            {this.props.retryLabel}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const ExtensionStoreApp: React.FC = () => {
  const { t } = useI18n();

  useEffect(() => {
    let disposed = false;
    window.electron.getSettings()
      .then((settings) => {
        if (!disposed) {
          applyAppFontSize(settings.fontSize);
          applyUiStyle(settings.uiStyle || 'default');
          applyBaseColor(settings.baseColor || '#101113');
        }
      })
      .catch(() => {
        if (!disposed) {
          applyAppFontSize(getDefaultAppFontSize());
          applyUiStyle('default');
        }
      });
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    const cleanup = window.electron.onSettingsUpdated?.((settings) => {
      applyAppFontSize(settings.fontSize);
      applyUiStyle(settings.uiStyle || 'default');
      applyBaseColor(settings.baseColor || '#101113');
    });
    return cleanup;
  }, []);

  return (
    <div className="h-screen flex glass-effect text-white select-none">
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="h-11 drag-region flex-shrink-0" />
        <div className="flex-1 overflow-hidden">
          <StoreErrorBoundary
            errorTitle={t('store.errorBoundary.title')}
            retryLabel={t('store.errorBoundary.retry')}
          >
            <StoreTab />
          </StoreErrorBoundary>
        </div>
      </div>
    </div>
  );
};

export default ExtensionStoreApp;
