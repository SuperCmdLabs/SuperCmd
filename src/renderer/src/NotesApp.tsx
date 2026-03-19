/**
 * Notes App
 *
 * Standalone app for the notes detached window.
 * Loaded via hash-based routing: #/notes
 */

import React, { useEffect, useState } from 'react';
import NotesManager from './NotesManager';
import { applyAppFontSize, getDefaultAppFontSize } from './utils/font-size';
import { applyBaseColor } from './utils/base-color';
import { applyUiStyle } from './utils/ui-style';

function getInitialMode(): 'search' | 'create' {
  try {
    const hash = window.location.hash || '';
    const idx = hash.indexOf('?');
    if (idx === -1) return 'search';
    const params = new URLSearchParams(hash.slice(idx + 1));
    const mode = params.get('mode');
    if (mode === 'create') return 'create';
  } catch {}
  return 'search';
}

const NotesApp: React.FC = () => {
  const [initialMode] = useState(getInitialMode);

  // Load settings on mount
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
    return () => { disposed = true; };
  }, []);

  // Listen for settings updates
  useEffect(() => {
    const cleanup = window.electron.onSettingsUpdated?.((settings) => {
      applyAppFontSize(settings.fontSize);
      applyUiStyle(settings.uiStyle || 'default');
      applyBaseColor(settings.baseColor || '#101113');
    });
    return cleanup;
  }, []);

  return (
    <div className="h-screen glass-effect text-white select-none flex flex-col overflow-hidden">
      <NotesManager initialView={initialMode} />
    </div>
  );
};

export default NotesApp;
