/**
 * Canvas App
 *
 * Standalone app for the canvas detached window.
 * Loaded via hash-based routing: #/canvas
 * Lightweight entry point — does NOT load the full App.tsx.
 */

import React, { useEffect, useState } from 'react';
import CanvasEditorView from './CanvasEditorView';
import { applyAppFontSize, getDefaultAppFontSize } from './utils/font-size';
import { applyBaseColor } from './utils/base-color';
import { applyUiStyle } from './utils/ui-style';

function getInitialMode(): 'create' | 'edit' {
  try {
    const hash = window.location.hash || '';
    const idx = hash.indexOf('?');
    if (idx === -1) return 'create';
    const params = new URLSearchParams(hash.slice(idx + 1));
    const mode = params.get('mode');
    if (mode === 'edit') return 'edit';
  } catch {}
  return 'create';
}

function getInitialCanvasId(): string | null {
  try {
    const hash = window.location.hash || '';
    const idx = hash.indexOf('?');
    if (idx === -1) return null;
    const params = new URLSearchParams(hash.slice(idx + 1));
    return params.get('id');
  } catch {}
  return null;
}

const CanvasApp: React.FC = () => {
  const [mode, setMode] = useState(getInitialMode);
  const [canvasId, setCanvasId] = useState<string | null>(getInitialCanvasId);

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

  // Listen for mode changes from main process
  useEffect(() => {
    const cleanup = window.electron.onCanvasMode((payload: any) => {
      if (payload.mode) setMode(payload.mode);
      if (payload.canvasJson) {
        try {
          const data = JSON.parse(payload.canvasJson);
          if (data.id) setCanvasId(data.id);
        } catch {}
      }
    });
    return cleanup;
  }, []);

  return (
    <div className="h-screen glass-effect text-white select-none flex flex-col overflow-hidden">
      <CanvasEditorView mode={mode} canvasId={canvasId} />
    </div>
  );
};

export default CanvasApp;
