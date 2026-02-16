/**
 * General Settings Tab
 *
 * Allows the user to configure the global launcher shortcut.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Keyboard, Info, Bug, RefreshCw, Download, RotateCcw } from 'lucide-react';
import HotkeyRecorder from './HotkeyRecorder';
import type { AppSettings, AppUpdaterStatus } from '../../types/electron';

function formatBytes(bytes?: number): string {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  const scaled = value / Math.pow(1024, exponent);
  const precision = scaled >= 100 || exponent === 0 ? 0 : 1;
  return `${scaled.toFixed(precision)} ${units[exponent]}`;
}

const GeneralTab: React.FC = () => {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [updaterStatus, setUpdaterStatus] = useState<AppUpdaterStatus | null>(null);
  const [updaterActionError, setUpdaterActionError] = useState('');
  const [shortcutStatus, setShortcutStatus] = useState<
    'idle' | 'success' | 'error'
  >('idle');

  useEffect(() => {
    window.electron.getSettings().then(setSettings);
  }, []);

  useEffect(() => {
    let disposed = false;
    window.electron.appUpdaterGetStatus()
      .then((status) => {
        if (!disposed) setUpdaterStatus(status);
      })
      .catch(() => {});
    const disposeUpdater = window.electron.onAppUpdaterStatus((status) => {
      if (!disposed) setUpdaterStatus(status);
    });
    return () => {
      disposed = true;
      disposeUpdater();
    };
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

  const handleCheckForUpdates = async () => {
    setUpdaterActionError('');
    try {
      const status = await window.electron.appUpdaterCheckForUpdates();
      setUpdaterStatus(status);
    } catch (error: any) {
      setUpdaterActionError(String(error?.message || error || 'Failed to check for updates.'));
    }
  };

  const handleDownloadUpdate = async () => {
    setUpdaterActionError('');
    try {
      const status = await window.electron.appUpdaterDownloadUpdate();
      setUpdaterStatus(status);
    } catch (error: any) {
      setUpdaterActionError(String(error?.message || error || 'Failed to download update.'));
    }
  };

  const handleRestartToInstall = async () => {
    setUpdaterActionError('');
    try {
      const ok = await window.electron.appUpdaterQuitAndInstall();
      if (!ok) {
        setUpdaterActionError('Update is not ready to install yet.');
      }
    } catch (error: any) {
      setUpdaterActionError(String(error?.message || error || 'Failed to restart for update.'));
    }
  };

  const updaterProgress = Math.max(0, Math.min(100, Number(updaterStatus?.progressPercent || 0)));
  const updaterState = updaterStatus?.state || 'idle';
  const updaterSupported = updaterStatus?.supported !== false;
  const currentVersion = updaterStatus?.currentVersion || '1.0.0';
  const updaterPrimaryMessage = useMemo(() => {
    if (!updaterStatus) return 'Check for new versions and install updates from Settings.';
    if (updaterStatus.message) return updaterStatus.message;
    switch (updaterStatus.state) {
      case 'unsupported':
        return 'Updates are only available in packaged builds.';
      case 'checking':
        return 'Checking for updates...';
      case 'available':
        return `Update v${updaterStatus.latestVersion || 'latest'} is available.`;
      case 'not-available':
        return 'You are already on the latest version.';
      case 'downloading':
        return 'Downloading update...';
      case 'downloaded':
        return 'Update downloaded. Restart to install.';
      case 'error':
        return 'Could not complete the update action.';
      default:
        return 'Check for new versions and install updates from Settings.';
    }
  }, [updaterStatus]);

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
          <RefreshCw className={`w-4 h-4 text-white/50 ${updaterState === 'checking' ? 'animate-spin' : ''}`} />
          <h3 className="text-sm font-medium text-white/90">App Updates</h3>
        </div>
        <p className="text-sm text-white/45 mb-1">
          {updaterPrimaryMessage}
        </p>
        <p className="text-xs text-white/40">
          Current version: v{currentVersion}
          {updaterStatus?.latestVersion ? ` · Latest: v${updaterStatus.latestVersion}` : ''}
        </p>

        {updaterState === 'downloading' && (
          <div className="mt-3">
            <div className="w-full h-1.5 rounded-full bg-white/[0.08] overflow-hidden">
              <div
                className="h-full bg-cyan-400 transition-all duration-200"
                style={{ width: `${updaterProgress}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-white/45">
              {updaterProgress.toFixed(0)}% · {formatBytes(updaterStatus?.transferredBytes)} / {formatBytes(updaterStatus?.totalBytes)}
            </p>
          </div>
        )}

        {(updaterActionError || updaterState === 'error') && (
          <p className="mt-2 text-xs text-red-400">
            {updaterActionError || updaterStatus?.message || 'Update failed.'}
          </p>
        )}

        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={handleCheckForUpdates}
            disabled={!updaterSupported || updaterState === 'checking' || updaterState === 'downloading'}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm border border-white/[0.14] text-white/90 hover:bg-white/[0.06] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${updaterState === 'checking' ? 'animate-spin' : ''}`} />
            Check for Updates
          </button>

          <button
            type="button"
            onClick={handleDownloadUpdate}
            disabled={!updaterSupported || (updaterState !== 'available' && updaterState !== 'downloading')}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm border border-cyan-400/40 text-cyan-200 hover:bg-cyan-400/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Download className={`w-4 h-4 ${updaterState === 'downloading' ? 'animate-pulse' : ''}`} />
            {updaterState === 'downloading' ? 'Downloading...' : 'Download Update'}
          </button>

          <button
            type="button"
            onClick={handleRestartToInstall}
            disabled={!updaterSupported || updaterState !== 'downloaded'}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm border border-emerald-400/40 text-emerald-200 hover:bg-emerald-400/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
            Restart to Install
          </button>
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
          SuperCmd v{currentVersion} — A fast, Raycast-inspired launcher for macOS.
        </p>
      </div>
    </div>
  );
};

export default GeneralTab;

