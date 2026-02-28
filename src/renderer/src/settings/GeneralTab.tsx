/**
 * General Settings Tab
 *
 * Structured row layout aligned with the settings design system.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Keyboard, Info, RefreshCw, Download, RotateCcw, Type, Sun, Moon, SunMoon, Sparkles } from 'lucide-react';
import HotkeyRecorder from './HotkeyRecorder';
import type { AppSettings, AppUpdaterStatus } from '../../types/electron';
import { applyAppFontSize, getDefaultAppFontSize } from '../utils/font-size';
import {
  getThemePreference,
  onThemeChange,
  setThemePreference as applyThemePreference,
  type ThemePreference,
} from '../utils/theme';
import { applyUiStyle, normalizeUiStyle, type UiStylePreference } from '../utils/ui-style';

type FontSizeOption = NonNullable<AppSettings['fontSize']>;

const FONT_SIZE_OPTIONS: Array<{ id: FontSizeOption; label: string }> = [
  { id: 'extra-small', label: 'Extra Small' },
  { id: 'small', label: 'Small' },
  { id: 'medium', label: 'Medium' },
  { id: 'large', label: 'Large' },
  { id: 'extra-large', label: 'Extra Large' },
];

function formatBytes(bytes?: number): string {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  const scaled = value / Math.pow(1024, exponent);
  const precision = scaled >= 100 || exponent === 0 ? 0 : 1;
  return `${scaled.toFixed(precision)} ${units[exponent]}`;
}

type SettingsRowProps = {
  icon: React.ReactNode;
  title: string;
  description: string;
  withBorder?: boolean;
  children: React.ReactNode;
};

const SettingsRow: React.FC<SettingsRowProps> = ({
  icon,
  title,
  description,
  withBorder = true,
  children,
}) => (
  <div
    className={`grid gap-3 px-4 py-3.5 md:px-5 md:grid-cols-[220px_minmax(0,1fr)] ${
      withBorder ? 'border-b border-[var(--ui-divider)]' : ''
    }`}
  >
    <div className="flex items-start gap-2.5">
      <div className="mt-0.5 text-[var(--text-muted)] shrink-0">{icon}</div>
      <div className="min-w-0">
        <h3 className="text-[0.8125rem] font-semibold text-[var(--text-primary)]">{title}</h3>
        <p className="mt-0.5 text-[0.75rem] text-[var(--text-muted)] leading-snug">{description}</p>
      </div>
    </div>
    <div className="flex items-center min-h-[32px]">{children}</div>
  </div>
);

const GeneralTab: React.FC = () => {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [updaterStatus, setUpdaterStatus] = useState<AppUpdaterStatus | null>(null);
  const [updaterActionError, setUpdaterActionError] = useState('');
  const [shortcutStatus, setShortcutStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [themePreference, setThemePreference] = useState<ThemePreference>(() => getThemePreference());
  const [uiStyle, setUiStyle] = useState<UiStylePreference>('default');

  useEffect(() => {
    window.electron.getSettings().then((nextSettings) => {
      const normalizedFontSize = nextSettings.fontSize || getDefaultAppFontSize();
      applyAppFontSize(normalizedFontSize);
      setSettings({
        ...nextSettings,
        fontSize: normalizedFontSize,
      });
      setUiStyle(normalizeUiStyle(nextSettings.uiStyle));
    });
  }, []);

  useEffect(() => {
    const cleanup = window.electron.onSettingsUpdated?.((nextSettings) => {
      setUiStyle(normalizeUiStyle(nextSettings.uiStyle));
    });
    return cleanup;
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

  useEffect(() => {
    const disposeThemeListener = onThemeChange(({ preference }) => {
      setThemePreference(preference);
    });
    return disposeThemeListener;
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

  const handleFontSizeChange = async (nextFontSize: FontSizeOption) => {
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
    if (!updaterStatus) return 'Check for and install packaged-app updates.';
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
        return 'Check for and install packaged-app updates.';
    }
  }, [updaterStatus]);

  const handleThemePreferenceChange = (nextTheme: ThemePreference) => {
    setThemePreference(nextTheme);
    applyThemePreference(nextTheme);
  };

  const handleUiStyleChange = async (nextStyle: UiStylePreference) => {
    if (!settings) return;
    const previousStyle = normalizeUiStyle(settings.uiStyle);
    if (previousStyle === nextStyle) return;
    setUiStyle(nextStyle);
    setSettings((prev) => (prev ? { ...prev, uiStyle: nextStyle } : prev));
    applyUiStyle(nextStyle);
    try {
      await window.electron.saveSettings({ uiStyle: nextStyle });
    } catch {
      setUiStyle(previousStyle);
      setSettings((prev) => (prev ? { ...prev, uiStyle: previousStyle } : prev));
      applyUiStyle(previousStyle);
    }
  };

  if (!settings) {
    return <div className="p-6 text-[var(--text-muted)] text-[0.75rem]">Loading settings...</div>;
  }

  const selectedFontSize = settings.fontSize || getDefaultAppFontSize();

  return (
    <div className="w-full max-w-[980px] mx-auto space-y-3">
      <h2 className="text-[0.9375rem] font-semibold text-[var(--text-primary)]">General</h2>

      <div className="overflow-hidden rounded-xl border border-[var(--ui-panel-border)] bg-[var(--settings-panel-bg)]">
        <SettingsRow
          icon={<Keyboard className="w-4 h-4" />}
          title="Launcher Shortcut"
          description="Set the global shortcut to open and close SuperCmd."
        >
          <div className="flex flex-wrap items-center gap-4">
            <HotkeyRecorder value={settings.globalShortcut} onChange={handleShortcutChange} large />
            {shortcutStatus === 'success' && <span className="text-[0.75rem] text-green-400">Shortcut updated</span>}
            {shortcutStatus === 'error' && (
              <span className="text-[0.75rem] text-red-400">Failed. Shortcut may be used by another app.</span>
            )}
          </div>
        </SettingsRow>

        <SettingsRow
          icon={<Type className="w-4 h-4" />}
          title="Font Size"
          description="Scale text size across the app."
        >
          <div className="inline-flex items-center gap-0.5 rounded-lg border border-[var(--ui-divider)] bg-[var(--ui-segment-bg)] p-0.5">
            {FONT_SIZE_OPTIONS.map((option) => {
              const active = selectedFontSize === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => void handleFontSizeChange(option.id)}
                  className={`px-3 py-1.5 rounded-md text-[0.75rem] font-semibold transition-colors ${
                    active
                      ? 'bg-[var(--ui-segment-active-bg)] text-[var(--text-primary)]'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--ui-segment-hover-bg)]'
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </SettingsRow>

        <SettingsRow
          icon={<SunMoon className="w-4 h-4" />}
          title="Appearance"
          description="Choose Light, Dark, or follow your system preference."
        >
          <div className="inline-flex items-center gap-0.5 rounded-lg border border-[var(--ui-divider)] bg-[var(--ui-segment-bg)] p-0.5">
            {([
              { id: 'light', label: 'Light', icon: <Sun className="w-3.5 h-3.5" /> },
              { id: 'system', label: 'System', icon: <SunMoon className="w-3.5 h-3.5" /> },
              { id: 'dark', label: 'Dark', icon: <Moon className="w-3.5 h-3.5" /> },
            ] as Array<{ id: ThemePreference; label: string; icon: React.ReactNode }>).map((option) => {
              const active = themePreference === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => handleThemePreferenceChange(option.id)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[0.75rem] font-semibold transition-colors ${
                    active
                      ? 'bg-[var(--ui-segment-active-bg)] text-[var(--text-primary)]'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--ui-segment-hover-bg)]'
                  }`}
                >
                  {option.icon}
                  {option.label}
                </button>
              );
            })}
          </div>
        </SettingsRow>

        <SettingsRow
          icon={<Sparkles className="w-4 h-4" />}
          title="Visual Style"
          description="Use Default look or enable a glassy macOS Tahoe-inspired style."
        >
          <div className="inline-flex items-center gap-0.5 rounded-lg border border-[var(--ui-divider)] bg-[var(--ui-segment-bg)] p-0.5">
            {([
              { id: 'default', label: 'Default' },
              { id: 'glassy', label: 'Glassy' },
            ] as Array<{ id: UiStylePreference; label: string }>).map((option) => {
              const active = uiStyle === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => void handleUiStyleChange(option.id)}
                  className={`px-3 py-1.5 rounded-md text-[0.75rem] font-semibold transition-colors ${
                    active
                      ? 'bg-[var(--ui-segment-active-bg)] text-[var(--text-primary)]'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--ui-segment-hover-bg)]'
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
              <p className="text-[0.8125rem] font-semibold text-[var(--text-primary)] leading-snug">
                {updaterPrimaryMessage}
              </p>
              <p className="text-[0.75rem] text-[var(--text-subtle)] mt-0.5 leading-tight">
                Current version: v{currentVersion}
                {updaterStatus?.latestVersion ? ` · Latest: v${updaterStatus.latestVersion}` : ''}
              </p>
            </div>

            {updaterState === 'downloading' && (
              <div>
                <div className="w-full h-1 rounded-full bg-[var(--ui-segment-hover-bg)] overflow-hidden">
                  <div
                    className="h-full bg-cyan-400 transition-all duration-200"
                    style={{ width: `${updaterProgress}%` }}
                  />
                </div>
                <p className="mt-0.5 text-[0.75rem] text-[var(--text-subtle)]">
                  {updaterProgress.toFixed(0)}% · {formatBytes(updaterStatus?.transferredBytes)} / {formatBytes(updaterStatus?.totalBytes)}
                </p>
              </div>
            )}

            {(updaterActionError || updaterState === 'error') && (
              <p className="text-[0.75rem] text-red-400">
                {updaterActionError || updaterStatus?.message || 'Update failed.'}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleCheckForUpdates}
                disabled={!updaterSupported || updaterState === 'checking' || updaterState === 'downloading'}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-[0.75rem] border border-[var(--ui-divider)] text-[var(--text-primary)] hover:bg-[var(--ui-segment-hover-bg)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${updaterState === 'checking' ? 'animate-spin' : ''}`} />
                Check for Updates
              </button>

              <button
                type="button"
                onClick={handleDownloadUpdate}
                disabled={!updaterSupported || (updaterState !== 'available' && updaterState !== 'downloading')}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-[0.75rem] border border-cyan-400/40 text-cyan-200 hover:bg-cyan-400/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Download className={`w-3.5 h-3.5 ${updaterState === 'downloading' ? 'animate-pulse' : ''}`} />
                {updaterState === 'downloading' ? 'Downloading...' : 'Download Update'}
              </button>

              <button
                type="button"
                onClick={handleRestartToInstall}
                disabled={!updaterSupported || updaterState !== 'downloaded'}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-[0.75rem] border border-emerald-400/40 text-emerald-200 hover:bg-emerald-400/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Restart to Install
              </button>
            </div>
          </div>
        </SettingsRow>

        <SettingsRow
          icon={<Info className="w-4 h-4" />}
          title="About"
          description="Version information."
          withBorder={false}
        >
          <p className="text-[0.8125rem] font-semibold text-[var(--text-primary)] leading-snug">
            SuperCmd v{currentVersion}
          </p>
        </SettingsRow>
      </div>
    </div>
  );
};

export default GeneralTab;
