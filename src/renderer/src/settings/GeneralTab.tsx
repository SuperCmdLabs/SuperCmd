/**
 * General Settings Tab
 *
 * Allows the user to configure the global launcher shortcut.
 */

import React, { useState, useEffect } from 'react';
import { Keyboard, Info } from 'lucide-react';
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
    <div className="p-8 max-w-2xl">
      <h2 className="text-xl font-semibold text-white mb-8">General</h2>

      <div className="space-y-6">
        {/* Shortcut Section */}
        <div className="bg-white/[0.03] rounded-xl border border-white/[0.06] p-5">
          <div className="flex items-center gap-2 mb-1">
            <Keyboard className="w-4 h-4 text-white/50" />
            <h3 className="text-sm font-medium text-white/90">
              SuperCommand Shortcut
            </h3>
          </div>
          <p className="text-xs text-white/40 mb-4 ml-6">
            The keyboard shortcut to open and close the launcher.
          </p>

          <div className="flex items-center gap-4 ml-6">
            <HotkeyRecorder
              value={settings.globalShortcut}
              onChange={handleShortcutChange}
            />
            {shortcutStatus === 'success' && (
              <span className="text-xs text-green-400">
                ✓ Shortcut updated
              </span>
            )}
            {shortcutStatus === 'error' && (
              <span className="text-xs text-red-400">
                ✗ Failed — shortcut may be in use by another app
              </span>
            )}
          </div>
        </div>

        {/* About Section */}
        <div className="bg-white/[0.03] rounded-xl border border-white/[0.06] p-5">
          <div className="flex items-center gap-2 mb-1">
            <Info className="w-4 h-4 text-white/50" />
            <h3 className="text-sm font-medium text-white/90">About</h3>
          </div>
          <p className="text-xs text-white/40 ml-6">
            SuperCommand v1.0.0 — A fast, Raycast-inspired launcher for macOS.
          </p>
        </div>
      </div>
    </div>
  );
};

export default GeneralTab;



