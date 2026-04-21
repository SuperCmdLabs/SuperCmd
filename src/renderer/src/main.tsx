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

void loadRoot().then((Root) => {
  root.render(
    <React.StrictMode>
      <I18nProvider>
        <Root />
      </I18nProvider>
    </React.StrictMode>
  );
});
