import React from 'react';
import ReactDOM from 'react-dom/client';
import { I18nProvider } from './i18n';
import '../styles/index.css';
import { initializeTheme } from './utils/theme';

// Each BrowserWindow only needs one root app. Static imports of every app
// here forced a single ~8MB bundle into every window (e.g. settings loaded
// the full launcher + raycast-api shim), inflating renderer memory to ~250MB.
// Dynamic import() lets Vite code-split per-app so each window parses only
// the chunk it actually uses.
const hash = window.location.hash;

function loadRoot(): Promise<React.ComponentType> {
  if (hash.includes('/canvas')) return import('./CanvasApp').then((m) => m.default);
  if (hash.includes('/notes')) return import('./NotesApp').then((m) => m.default);
  if (hash.includes('/prompt')) return import('./PromptApp').then((m) => m.default);
  if (hash.includes('/extension-store')) return import('./ExtensionStoreApp').then((m) => m.default);
  if (hash.includes('/settings')) return import('./SettingsApp').then((m) => m.default);
  return import('./App').then((m) => m.default);
}

initializeTheme();

const root = ReactDOM.createRoot(document.getElementById('root')!);

function ChunkLoadFallback({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error ?? 'Unknown error');
  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        padding: 24,
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
        color: 'var(--text-primary, #e5e7eb)',
        background: 'var(--surface-base, #101113)',
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 600 }}>Failed to load SuperCmd</div>
      <div style={{ fontSize: 12, opacity: 0.7, maxWidth: 420 }}>
        A required module could not be loaded. This usually means SuperCmd was updated while
        this window was open. Reloading should fix it.
      </div>
      <div style={{ fontSize: 11, opacity: 0.5, maxWidth: 420, wordBreak: 'break-word' }}>
        {message}
      </div>
      <button
        onClick={() => window.location.reload()}
        style={{
          marginTop: 8,
          padding: '6px 14px',
          fontSize: 12,
          borderRadius: 6,
          border: '1px solid rgba(255,255,255,0.18)',
          background: 'rgba(255,255,255,0.08)',
          color: 'inherit',
          cursor: 'pointer',
        }}
      >
        Reload
      </button>
    </div>
  );
}

loadRoot()
  .then((Root) => {
    root.render(
      <React.StrictMode>
        <I18nProvider>
          <Root />
        </I18nProvider>
      </React.StrictMode>
    );
  })
  .catch((error: unknown) => {
    console.error('Failed to load renderer root chunk:', error);
    root.render(<ChunkLoadFallback error={error} />);
  });
