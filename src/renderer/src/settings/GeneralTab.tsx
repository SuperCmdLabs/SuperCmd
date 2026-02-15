/**
 * General Settings Tab
 *
 * Allows the user to configure the global launcher shortcut.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Keyboard, Info, Bug } from 'lucide-react';
import HotkeyRecorder from './HotkeyRecorder';
import type { AppSettings } from '../../types/electron';

const GeneralTab: React.FC = () => {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [shortcutStatus, setShortcutStatus] = useState<
    'idle' | 'success' | 'error'
  >('idle');

  useEffect(() => {
    window.electron.getSettings().then(setSettings);
  }, []);

  const handleShortcutChange = async (newShortcut: string) => {
    if (!newShortcut) return;
    setShortcutStatus('idle');

    const success = await window.electron.updateGlobalShortcut(newShortcut);
    if (success) {
      setSettings((prev) =>
        prev ? { ...prev, globalShortcut: newShortcut } : prev
      );
      setShortcutStatus('success');
      setTimeout(() => setShortcutStatus('idle'), 2000);
    } else {
      setShortcutStatus('error');
      setTimeout(() => setShortcutStatus('idle'), 3000);
    }
  };

  if (!settings) {
    return (
      <div className="p-8 text-white/50 text-sm">Loading settings...</div>
    );
  }

  return (
    <div className="p-4 w-full max-w-5xl space-y-4">
      <h2 className="text-xl font-semibold text-white">General</h2>

      <div className="bg-white/[0.03] rounded-xl border border-white/[0.06] p-6">
        <div className="flex items-center gap-2 mb-2">
          <Keyboard className="w-5 h-5 text-white/60" />
          <h3 className="text-base font-semibold text-white/95">Launcher Shortcut</h3>
        </div>
        <p className="text-sm text-white/45 mb-5">
          Set the global shortcut to open and close SuperCmd.
        </p>

        <div className="flex items-center gap-4">
          <HotkeyRecorder value={settings.globalShortcut} onChange={handleShortcutChange} large />
          {shortcutStatus === 'success' && <span className="text-sm text-green-400">Shortcut updated</span>}
          {shortcutStatus === 'error' && (
            <span className="text-sm text-red-400">Failed — shortcut may be used by another app</span>
          )}
        </div>
      </div>

      <div className="bg-white/[0.03] rounded-xl border border-white/[0.06] p-5">
        <div className="flex items-center gap-2 mb-1">
          <Bug className="w-4 h-4 text-white/50" />
          <h3 className="text-sm font-medium text-white/90">Debug Mode</h3>
        </div>
        <p className="text-sm text-white/45 mb-3">
          Show detailed error messages when extensions fail to load or build.
        </p>
        <label className="inline-flex items-center gap-2 text-sm text-white/70 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.debugMode ?? false}
            onChange={async (e) => {
              const debugMode = e.target.checked;
              setSettings((prev) => prev ? { ...prev, debugMode } : prev);
              await window.electron.saveSettings({ debugMode });
            }}
            className="accent-cyan-400"
          />
          Enable debug mode
        </label>
      </div>

      <div className="bg-white/[0.03] rounded-xl border border-white/[0.06] p-5">
        <div className="flex items-center gap-2 mb-1">
          <Info className="w-4 h-4 text-white/50" />
          <h3 className="text-sm font-medium text-white/90">About</h3>
        </div>
        <p className="text-sm text-white/45">
          SuperCmd v1.0.0 — A fast, Raycast-inspired launcher for macOS.
        </p>
      </div>
    </div>
  );
};

export default GeneralTab;


