/**
 * General Settings Tab
 *
 * What this file is:
 * - A focused settings surface for app-level controls users access frequently.
 *
 * What it does:
 * - Manages launcher shortcut, UI font size, update actions, launch-at-login, and version info.
 *
 * Why we need it:
 * - Keeps everyday settings in one place while separating advanced controls into dedicated tabs.
 */

import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { Keyboard, Info, RefreshCw, Download, RotateCcw, Type, Power } from 'lucide-react';
import HotkeyRecorder from './HotkeyRecorder';
import type { AppSettings, AppUpdaterStatus } from '../../types/electron';
import { applyAppFontSize, getDefaultAppFontSize } from '../utils/font-size';

type FontSizeOption = NonNullable<AppSettings['fontSize']>;
type ShortcutStatus = 'idle' | 'success' | 'error';

const FONT_SIZE_OPTIONS: Array<{ id: FontSizeOption; label: string }> = [
  { id: 'small', label: 'Small' },
  { id: 'medium', label: 'Medium' },
  { id: 'large', label: 'Large' },
];

/**
 * Formats bytes into a readable unit for updater progress text.
 */
function formatBytes(bytes?: number): string {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  const scaled = value / Math.pow(1024, exponent);
  const precision = scaled >= 100 || exponent === 0 ? 0 : 1;
  return `${scaled.toFixed(precision)} ${units[exponent]}`;
}

/**
 * Maps updater state to a short human-readable summary.
 */
function getUpdaterPrimaryMessage(status: AppUpdaterStatus | null): string {
  if (!status) return 'Check for and install packaged-app updates.';
  if (status.message) return status.message;

  switch (status.state) {
    case 'unsupported':
      return 'Updates are only available in packaged builds.';
    case 'checking':
      return 'Checking for updates...';
    case 'available':
      return `Update v${status.latestVersion || 'latest'} is available.`;
    case 'not-available':
      return 'You are already on the latest version.';
    case 'downloading':
      return 'Downloading update...';
    case 'downloaded':
      return 'Update downloaded. Restart to install.';
    case 'error':
      return 'Could not complete the update action.';
    default:
      return 'Check for and install packaged-app updates.';
  }
}

type SettingsRowProps = {
  icon: React.ReactNode;
  title: string;
  description: string;
  withBorder?: boolean;
  children: React.ReactNode;
};

/**
 * Shared row shell used across settings sections.
 *
 * Why:
 * - Enforces consistent spacing/typography so each setting can stay lean.
 */
const SettingsRow: React.FC<SettingsRowProps> = ({
  icon,
  title,
  description,
  withBorder = true,
  children,
}) => (
  <div
    className={`grid gap-3 px-4 py-3.5 md:px-5 md:grid-cols-[220px_minmax(0,1fr)] ${
      withBorder ? 'border-b border-white/[0.08]' : ''
    }`}
  >
    <div className="flex items-start gap-2.5">
      <div className="mt-0.5 text-white/65 shrink-0">{icon}</div>
      <div className="min-w-0">
        <h3 className="text-[13px] font-semibold text-white/95">{title}</h3>
        <p className="mt-0.5 text-[12px] text-white/50 leading-snug">{description}</p>
      </div>
    </div>
    <div className="flex items-center min-h-[32px]">{children}</div>
  </div>
);

/**
 * Encapsulates async settings/update side effects so render JSX stays focused.
 */
function useGeneralTabController() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [updaterStatus, setUpdaterStatus] = useState<AppUpdaterStatus | null>(null);
  const [updaterActionError, setUpdaterActionError] = useState('');
  const [shortcutStatus, setShortcutStatus] = useState<ShortcutStatus>('idle');

  useEffect(() => {
    window.electron.getSettings().then((nextSettings) => {
      const normalizedFontSize = nextSettings.fontSize || getDefaultAppFontSize();
      applyAppFontSize(normalizedFontSize);
      setSettings({ ...nextSettings, fontSize: normalizedFontSize });
    });
  }, []);

  useEffect(() => {
    let disposed = false;

    window.electron
      .appUpdaterGetStatus()
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

  /**
   * Updates launcher shortcut and provides immediate success/error feedback.
   */
  const handleShortcutChange = useCallback(async (newShortcut: string) => {
    if (!newShortcut) return;
    setShortcutStatus('idle');

    const success = await window.electron.updateGlobalShortcut(newShortcut);
    if (success) {
      setSettings((prev) => (prev ? { ...prev, globalShortcut: newShortcut } : prev));
      setShortcutStatus('success');
      setTimeout(() => setShortcutStatus('idle'), 2000);
      return;
    }

    setShortcutStatus('error');
    setTimeout(() => setShortcutStatus('idle'), 3000);
  }, []);

  /**
   * Applies font size optimistically, then persists it.
   * Reverts UI if persistence fails.
   */
  const handleFontSizeChange = useCallback(
    async (nextFontSize: FontSizeOption) => {
      if (!settings) return;
      const previousFontSize = settings.fontSize || getDefaultAppFontSize();
      if (previousFontSize === nextFontSize) return;

      setSettings((prev) => (prev ? { ...prev, fontSize: nextFontSize } : prev));
      applyAppFontSize(nextFontSize);

      try {
        await window.electron.saveSettings({ fontSize: nextFontSize });
      } catch {
        setSettings((prev) => (prev ? { ...prev, fontSize: previousFontSize } : prev));
        applyAppFontSize(previousFontSize);
      }
    },
    [settings]
  );

  /**
   * Toggles open-at-login and keeps UI state in sync with OS setting.
   */
  const handleOpenAtLoginChange = useCallback(async (openAtLogin: boolean) => {
    setSettings((prev) => (prev ? { ...prev, openAtLogin } : prev));
    await window.electron.setOpenAtLogin(openAtLogin);
  }, []);

  const handleCheckForUpdates = useCallback(async () => {
    setUpdaterActionError('');
    try {
      const status = await window.electron.appUpdaterCheckForUpdates();
      setUpdaterStatus(status);
    } catch (error: any) {
      setUpdaterActionError(String(error?.message || error || 'Failed to check for updates.'));
    }
  }, []);

  const handleDownloadUpdate = useCallback(async () => {
    setUpdaterActionError('');
    try {
      const status = await window.electron.appUpdaterDownloadUpdate();
      setUpdaterStatus(status);
    } catch (error: any) {
      setUpdaterActionError(String(error?.message || error || 'Failed to download update.'));
    }
  }, []);

  const handleRestartToInstall = useCallback(async () => {
    setUpdaterActionError('');
    try {
      const ok = await window.electron.appUpdaterQuitAndInstall();
      if (!ok) {
        setUpdaterActionError('Update is not ready to install yet.');
      }
    } catch (error: any) {
      setUpdaterActionError(String(error?.message || error || 'Failed to restart for update.'));
    }
  }, []);

  return {
    settings,
    updaterStatus,
    updaterActionError,
    shortcutStatus,
    handleShortcutChange,
    handleFontSizeChange,
    handleOpenAtLoginChange,
    handleCheckForUpdates,
    handleDownloadUpdate,
    handleRestartToInstall,
  };
}

/**
 * General settings screen.
 *
 * Why this component exists:
 * - Keeps common global settings easy to discover and change.
 */
const GeneralTab: React.FC = () => {
  const {
    settings,
    updaterStatus,
    updaterActionError,
    shortcutStatus,
    handleShortcutChange,
    handleFontSizeChange,
    handleOpenAtLoginChange,
    handleCheckForUpdates,
    handleDownloadUpdate,
    handleRestartToInstall,
  } = useGeneralTabController();

  const updaterProgress = Math.max(0, Math.min(100, Number(updaterStatus?.progressPercent || 0)));
  const updaterState = updaterStatus?.state || 'idle';
  const updaterSupported = updaterStatus?.supported !== false;
  const currentVersion = updaterStatus?.currentVersion || '1.0.0';
  const updaterPrimaryMessage = useMemo(() => getUpdaterPrimaryMessage(updaterStatus), [updaterStatus]);

  if (!settings) {
    return <div className="p-6 text-white/50 text-[12px]">Loading settings...</div>;
  }

  const selectedFontSize = settings.fontSize || getDefaultAppFontSize();

  return (
    <div className="w-full max-w-[980px] mx-auto space-y-3">
      <h2 className="text-[15px] font-semibold text-white">General</h2>

      <div className="overflow-hidden rounded-xl border border-white/[0.10] bg-[rgba(20,20,20,0.34)]">
        <SettingsRow
          icon={<Keyboard className="w-4 h-4" />}
          title="Launcher Shortcut"
          description="Set the global shortcut to open and close SuperCmd."
        >
          <div className="flex flex-wrap items-center gap-4">
            <HotkeyRecorder value={settings.globalShortcut} onChange={handleShortcutChange} large />
            {shortcutStatus === 'success' && <span className="text-[12px] text-green-400">Shortcut updated</span>}
            {shortcutStatus === 'error' && (
              <span className="text-[12px] text-red-400">Failed. Shortcut may be used by another app.</span>
            )}
          </div>
        </SettingsRow>

        <SettingsRow
          icon={<Type className="w-4 h-4" />}
          title="Font Size"
          description="Scale text size across the app."
        >
          <div className="inline-flex items-center gap-0.5 rounded-lg border border-white/[0.16] bg-white/[0.03] p-0.5">
            {FONT_SIZE_OPTIONS.map((option) => {
              const active = selectedFontSize === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => void handleFontSizeChange(option.id)}
                  className={`px-3 py-1.5 rounded-md text-[12px] font-semibold transition-colors ${
                    active
                      ? 'bg-white/[0.2] text-white'
                      : 'text-white/65 hover:text-white/90 hover:bg-white/[0.08]'
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </SettingsRow>

        <SettingsRow
          icon={<RefreshCw className={`w-4 h-4 ${updaterState === 'checking' ? 'animate-spin' : ''}`} />}
          title="App Updates"
          description="Check for and install packaged-app updates."
        >
          <div className="w-full space-y-2">
            <div>
              <p className="text-[13px] font-semibold text-white/92 leading-snug">{updaterPrimaryMessage}</p>
              <p className="text-[12px] text-white/45 mt-0.5 leading-tight">
                Current version: v{currentVersion}
                {updaterStatus?.latestVersion ? ` · Latest: v${updaterStatus.latestVersion}` : ''}
              </p>
            </div>

            {updaterState === 'downloading' && (
              <div>
                <div className="w-full h-1 rounded-full bg-white/[0.08] overflow-hidden">
                  <div
                    className="h-full bg-cyan-400 transition-all duration-200"
                    style={{ width: `${updaterProgress}%` }}
                  />
                </div>
                <p className="mt-0.5 text-[12px] text-white/45">
                  {updaterProgress.toFixed(0)}% · {formatBytes(updaterStatus?.transferredBytes)} /{' '}
                  {formatBytes(updaterStatus?.totalBytes)}
                </p>
              </div>
            )}

            {(updaterActionError || updaterState === 'error') && (
              <p className="text-[12px] text-red-400">
                {updaterActionError || updaterStatus?.message || 'Update failed.'}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleCheckForUpdates}
                disabled={!updaterSupported || updaterState === 'checking' || updaterState === 'downloading'}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-[12px] border border-white/[0.14] text-white/90 hover:bg-white/[0.06] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${updaterState === 'checking' ? 'animate-spin' : ''}`} />
                Check for Updates
              </button>

              <button
                type="button"
                onClick={handleDownloadUpdate}
                disabled={!updaterSupported || (updaterState !== 'available' && updaterState !== 'downloading')}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-[12px] border border-cyan-400/40 text-cyan-200 hover:bg-cyan-400/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Download className={`w-3.5 h-3.5 ${updaterState === 'downloading' ? 'animate-pulse' : ''}`} />
                {updaterState === 'downloading' ? 'Downloading...' : 'Download Update'}
              </button>

              <button
                type="button"
                onClick={handleRestartToInstall}
                disabled={!updaterSupported || updaterState !== 'downloaded'}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-[12px] border border-emerald-400/40 text-emerald-200 hover:bg-emerald-400/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Restart to Install
              </button>
            </div>
          </div>
        </SettingsRow>

        <SettingsRow
          icon={<Power className="w-4 h-4" />}
          title="Launch at Login"
          description="Automatically start SuperCmd when you log in."
        >
          <label className="inline-flex items-center gap-2 text-[13px] text-white/85 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.openAtLogin ?? false}
              onChange={(e) => {
                void handleOpenAtLoginChange(e.target.checked);
              }}
              className="w-4 h-4 rounded accent-cyan-400"
            />
            Launch at login
          </label>
        </SettingsRow>

        <SettingsRow
          icon={<Info className="w-4 h-4" />}
          title="About"
          description="Version information."
          withBorder={false}
        >
          <p className="text-[13px] font-semibold text-white/88 leading-snug">SuperCmd v{currentVersion}</p>
        </SettingsRow>
      </div>
    </div>
  );
};

export default GeneralTab;
