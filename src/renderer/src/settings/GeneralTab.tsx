/**
 * General Settings Tab
 *
 * Structured row layout aligned with the settings design system.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Keyboard, Info, RefreshCw, Download, RotateCcw, Type, Sun, Moon, SunMoon, Sparkles, Image, Trash2, SlidersHorizontal, ChevronDown, ChevronUp, Power } from 'lucide-react';
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
import { useI18n } from '../i18n';

type FontSizeOption = NonNullable<AppSettings['fontSize']>;
type LauncherBackgroundPercentField =
  | 'launcherBackgroundImageBlurPercent'
  | 'launcherBackgroundImageOpacityPercent';

const DEFAULT_LAUNCHER_BACKGROUND_BLUR_PERCENT = 25;
const DEFAULT_LAUNCHER_BACKGROUND_OPACITY_PERCENT = 45;

const FONT_SIZE_OPTIONS: FontSizeOption[] = ['extra-small', 'small', 'medium', 'large', 'extra-large'];

function getFileName(filePath: string): string {
  const normalizedPath = String(filePath || '').trim().replace(/\/+$/, '');
  if (!normalizedPath) return '';
  const segments = normalizedPath.split('/');
  return segments[segments.length - 1] || normalizedPath;
}

function clampPercentage(value: number, fallback: number): number {
  const parsedValue = Number(value);
  if (!Number.isFinite(parsedValue)) return fallback;
  return Math.max(0, Math.min(100, Math.round(parsedValue)));
}

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
  const { t } = useI18n();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [updaterStatus, setUpdaterStatus] = useState<AppUpdaterStatus | null>(null);
  const [updaterActionError, setUpdaterActionError] = useState('');
  const [shortcutStatus, setShortcutStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [themePreference, setThemePreference] = useState<ThemePreference>(() => getThemePreference());
  const [uiStyle, setUiStyle] = useState<UiStylePreference>('default');
  const [launcherBackgroundBusy, setLauncherBackgroundBusy] = useState(false);
  const [launcherBackgroundControlsExpanded, setLauncherBackgroundControlsExpanded] = useState(false);

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
      const normalizedFontSize = nextSettings.fontSize || getDefaultAppFontSize();
      setSettings({
        ...nextSettings,
        fontSize: normalizedFontSize,
      });
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

  const handleOpenAtLoginChange = async (enabled: boolean) => {
    if (!settings) return;
    const previous = settings.openAtLogin ?? false;
    if (previous === enabled) return;
    setSettings((prev) => (prev ? { ...prev, openAtLogin: enabled } : prev));
    try {
      const ok = await window.electron.setOpenAtLogin(enabled);
      if (!ok) {
        setSettings((prev) => (prev ? { ...prev, openAtLogin: previous } : prev));
      }
    } catch {
      setSettings((prev) => (prev ? { ...prev, openAtLogin: previous } : prev));
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
      setUpdaterActionError(String(error?.message || error || t('settings.general.updates.failed')));
    }
  };

  const handleDownloadUpdate = async () => {
    setUpdaterActionError('');
    try {
      const status = await window.electron.appUpdaterDownloadUpdate();
      setUpdaterStatus(status);
    } catch (error: any) {
      setUpdaterActionError(String(error?.message || error || t('settings.general.updates.failed')));
    }
  };

  const handleRestartToInstall = async () => {
    setUpdaterActionError('');
    try {
      const ok = await window.electron.appUpdaterQuitAndInstall();
      if (!ok) {
        setUpdaterActionError(t('settings.general.updates.error'));
      }
    } catch (error: any) {
      setUpdaterActionError(String(error?.message || error || t('settings.general.updates.failed')));
    }
  };

  const updaterProgress = Math.max(0, Math.min(100, Number(updaterStatus?.progressPercent || 0)));
  const updaterState = updaterStatus?.state || 'idle';
  const updaterSupported = updaterStatus?.supported !== false;
  const currentVersion = updaterStatus?.currentVersion || '1.0.0';
  const updaterAction = useMemo(() => {
    if (updaterState === 'downloaded') {
      return {
        label: t('settings.general.updates.restart'),
        onClick: handleRestartToInstall,
        icon: RotateCcw,
        disabled: !updaterSupported,
        className:
          'border border-emerald-400/30 bg-[var(--ui-segment-bg)] text-emerald-200 hover:border-emerald-400/45 hover:bg-[var(--ui-segment-hover-bg)]',
      };
    }
    if (updaterState === 'available' || updaterState === 'downloading') {
      return {
        label: updaterState === 'downloading'
          ? t('settings.general.updates.downloadingButton')
          : t('settings.general.updates.download'),
        onClick: handleDownloadUpdate,
        icon: Download,
        disabled: !updaterSupported || updaterState === 'downloading',
        className:
          'border border-cyan-400/30 bg-[var(--ui-segment-bg)] text-cyan-200 hover:border-cyan-400/45 hover:bg-[var(--ui-segment-hover-bg)]',
      };
    }
    return {
      label: t('settings.general.updates.check'),
      onClick: handleCheckForUpdates,
      icon: RefreshCw,
      disabled: !updaterSupported || updaterState === 'checking',
      className:
        'border border-[var(--ui-divider)] bg-[var(--ui-segment-bg)] text-[var(--text-primary)] hover:border-[var(--ui-segment-border)] hover:bg-[var(--ui-segment-hover-bg)]',
    };
  }, [handleCheckForUpdates, handleDownloadUpdate, handleRestartToInstall, t, updaterState, updaterSupported]);
  const updaterPrimaryMessage = useMemo(() => {
    if (!updaterStatus) return t('settings.general.updates.defaultMessage');
    switch (updaterStatus.state) {
      case 'unsupported':
        return t('settings.general.updates.unsupported');
      case 'checking':
        return t('settings.general.updates.checking');
      case 'available':
        return t('settings.general.updates.available', {
          version: updaterStatus.latestVersion || 'latest',
        });
      case 'not-available':
        return t('settings.general.updates.notAvailable');
      case 'downloading':
        return t('settings.general.updates.downloading');
      case 'downloaded':
        return t('settings.general.updates.downloaded');
      case 'error':
        return t('settings.general.updates.error');
      default:
        return updaterStatus.message || t('settings.general.updates.defaultMessage');
    }
  }, [t, updaterStatus]);
  const UpdaterActionIcon = updaterAction.icon;

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

  const handleSelectLauncherBackgroundImage = async () => {
    if (!settings || launcherBackgroundBusy) return;
    setLauncherBackgroundBusy(true);
    try {
      const selectedPath = await window.electron.pickLauncherBackgroundImage();
      if (!selectedPath) return;
      const nextSettings = await window.electron.saveSettings({ launcherBackgroundImagePath: selectedPath });
      setSettings(nextSettings);
    } finally {
      setLauncherBackgroundBusy(false);
    }
  };

  const handleClearLauncherBackgroundImage = async () => {
    if (!settings || launcherBackgroundBusy || !settings.launcherBackgroundImagePath) return;
    setLauncherBackgroundBusy(true);
    try {
      const nextSettings = await window.electron.saveSettings({ launcherBackgroundImagePath: '' });
      setSettings(nextSettings);
      setLauncherBackgroundControlsExpanded(false);
    } finally {
      setLauncherBackgroundBusy(false);
    }
  };

  const handleLauncherBackgroundEverywhereChange = async (enabled: boolean) => {
    if (!settings) return;
    setSettings((prev) => (prev ? { ...prev, launcherBackgroundImageEverywhere: enabled } : prev));
    try {
      await window.electron.saveSettings({ launcherBackgroundImageEverywhere: enabled });
    } catch {
      setSettings((prev) => (
        prev ? { ...prev, launcherBackgroundImageEverywhere: !enabled } : prev
      ));
    }
  };

  const handleLauncherBackgroundPercentChange = async (
    field: LauncherBackgroundPercentField,
    value: number
  ) => {
    if (!settings) return;
    const fallback =
      field === 'launcherBackgroundImageBlurPercent'
        ? DEFAULT_LAUNCHER_BACKGROUND_BLUR_PERCENT
        : DEFAULT_LAUNCHER_BACKGROUND_OPACITY_PERCENT;
    const previousValue = clampPercentage(settings[field], fallback);
    const nextValue = clampPercentage(value, fallback);
    if (nextValue === previousValue) return;

    setSettings((prev) => (prev ? { ...prev, [field]: nextValue } : prev));

    try {
      const nextSettings = await window.electron.saveSettings({ [field]: nextValue } as Partial<AppSettings>);
      setSettings(nextSettings);
    } catch {
      setSettings((prev) => (prev ? { ...prev, [field]: previousValue } : prev));
    }
  };

  if (!settings) {
    return <div className="p-6 text-[var(--text-muted)] text-[0.75rem]">{t('settings.general.loading')}</div>;
  }

  const selectedFontSize = settings.fontSize || getDefaultAppFontSize();
  const launcherBackgroundFileName = getFileName(settings.launcherBackgroundImagePath);
  const launcherBackgroundBlurPercent = clampPercentage(
    settings.launcherBackgroundImageBlurPercent,
    DEFAULT_LAUNCHER_BACKGROUND_BLUR_PERCENT
  );
  const launcherBackgroundOpacityPercent = clampPercentage(
    settings.launcherBackgroundImageOpacityPercent,
    DEFAULT_LAUNCHER_BACKGROUND_OPACITY_PERCENT
  );

  return (
    <div className="w-full max-w-[980px] mx-auto space-y-3">
      <h2 className="text-[0.9375rem] font-semibold text-[var(--text-primary)]">{t('settings.general.title')}</h2>

      <div className="overflow-hidden rounded-xl border border-[var(--ui-panel-border)] bg-[var(--settings-panel-bg)]">
        <SettingsRow
          icon={<Keyboard className="w-4 h-4" />}
          title={t('settings.general.launcherShortcut.title')}
          description={t('settings.general.launcherShortcut.description')}
        >
          <div className="flex flex-wrap items-center gap-4">
            <HotkeyRecorder value={settings.globalShortcut} onChange={handleShortcutChange} large />
            {shortcutStatus === 'success' && <span className="text-[0.75rem] text-green-400">{t('settings.general.launcherShortcut.updated')}</span>}
            {shortcutStatus === 'error' && (
              <span className="text-[0.75rem] text-red-400">{t('settings.general.launcherShortcut.failed')}</span>
            )}
          </div>
        </SettingsRow>

        <SettingsRow
          icon={<Power className="w-4 h-4" />}
          title={t('settings.general.startAtLogin.title')}
          description={t('settings.general.startAtLogin.description')}
        >
          <label className="inline-flex items-center gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.openAtLogin ?? false}
              onChange={(event) => {
                void handleOpenAtLoginChange(event.target.checked);
              }}
              className="settings-checkbox"
            />
            <span className="text-[0.75rem] text-[var(--text-secondary)]">
              {settings.openAtLogin
                ? t('settings.general.startAtLogin.enabled')
                : t('settings.general.startAtLogin.disabled')}
            </span>
          </label>
        </SettingsRow>

        <SettingsRow
          icon={<Type className="w-4 h-4" />}
          title={t('settings.general.fontSize.title')}
          description={t('settings.general.fontSize.description')}
        >
          <div className="inline-flex items-center gap-0.5 rounded-lg border border-[var(--ui-divider)] bg-[var(--ui-segment-bg)] p-0.5">
            {FONT_SIZE_OPTIONS.map((option) => {
              const active = selectedFontSize === option;
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => void handleFontSizeChange(option)}
                  className={`px-3 py-1.5 rounded-md text-[0.75rem] font-semibold transition-colors ${
                    active
                      ? 'bg-[var(--ui-segment-active-bg)] text-[var(--text-primary)]'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--ui-segment-hover-bg)]'
                  }`}
                >
                  {t(`settings.general.fontSize.${option}`)}
                </button>
              );
            })}
          </div>
        </SettingsRow>

        <SettingsRow
          icon={<SunMoon className="w-4 h-4" />}
          title={t('settings.general.appearance.title')}
          description={t('settings.general.appearance.description')}
        >
          <div className="inline-flex items-center gap-0.5 rounded-lg border border-[var(--ui-divider)] bg-[var(--ui-segment-bg)] p-0.5">
            {([
              { id: 'light', label: t('settings.general.appearance.light'), icon: <Sun className="w-3.5 h-3.5" /> },
              { id: 'system', label: t('settings.general.appearance.system'), icon: <SunMoon className="w-3.5 h-3.5" /> },
              { id: 'dark', label: t('settings.general.appearance.dark'), icon: <Moon className="w-3.5 h-3.5" /> },
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
          title={t('settings.general.visualStyle.title')}
          description={t('settings.general.visualStyle.description')}
        >
          <div className="inline-flex items-center gap-0.5 rounded-lg border border-[var(--ui-divider)] bg-[var(--ui-segment-bg)] p-0.5">
            {([
              { id: 'default', label: t('settings.general.visualStyle.default') },
              { id: 'glassy', label: t('settings.general.visualStyle.glassy') },
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
          icon={<Image className="w-4 h-4" />}
          title={t('settings.general.background.title')}
          description={t('settings.general.background.description')}
        >
          <div className="w-full flex flex-col items-start gap-3">
            {!launcherBackgroundFileName ? (
              <p className="text-[0.75rem] text-[var(--text-subtle)]">
                {t('settings.general.background.empty')}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void handleSelectLauncherBackgroundImage()}
                disabled={launcherBackgroundBusy}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-[var(--ui-divider)] bg-[var(--ui-segment-bg)] text-[0.75rem] font-semibold text-[var(--text-primary)] hover:border-[var(--ui-segment-border)] hover:bg-[var(--ui-segment-hover-bg)] disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              >
                <Image className="w-3.5 h-3.5" />
                {launcherBackgroundFileName
                  ? t('settings.general.background.change')
                  : t('settings.general.background.choose')}
              </button>

              {launcherBackgroundFileName ? (
                <button
                  type="button"
                  onClick={() => void handleClearLauncherBackgroundImage()}
                  disabled={launcherBackgroundBusy}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-[var(--ui-divider)] bg-transparent text-[0.75rem] font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--ui-segment-hover-bg)] disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {t('settings.general.background.remove')}
                </button>
              ) : null}
            </div>

            {launcherBackgroundFileName ? (
              <p className="max-w-full truncate text-[0.75rem] font-semibold text-[var(--text-muted)]">
                {launcherBackgroundFileName}
              </p>
            ) : null}

            {launcherBackgroundFileName ? (
              <div className="w-full max-w-[420px]">
                <button
                  type="button"
                  onClick={() => setLauncherBackgroundControlsExpanded((prev) => !prev)}
                  className="inline-flex items-center gap-1.5 text-[0.75rem] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                  {t('settings.general.background.appearance')}
                  <span className="text-[var(--text-subtle)]">
                    {t('settings.general.background.summary', {
                      blur: launcherBackgroundBlurPercent,
                      opacity: launcherBackgroundOpacityPercent,
                    })}
                  </span>
                  {launcherBackgroundControlsExpanded ? (
                    <ChevronUp className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                </button>

                {launcherBackgroundControlsExpanded ? (
                  <div className="mt-2 space-y-2 rounded-lg border border-[var(--ui-divider)] bg-[var(--ui-segment-bg)] px-3 py-2.5">
                    <div className="grid grid-cols-[56px_minmax(0,1fr)_42px] items-center gap-2">
                      <span className="text-[0.72rem] font-medium text-[var(--text-secondary)]">{t('settings.general.background.blur')}</span>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        step="1"
                        value={launcherBackgroundBlurPercent}
                        onChange={(event) => {
                          void handleLauncherBackgroundPercentChange(
                            'launcherBackgroundImageBlurPercent',
                            Number(event.target.value)
                          );
                        }}
                        className="w-full"
                        style={{ accentColor: 'var(--accent-color)' }}
                      />
                      <span className="text-right text-[0.72rem] font-semibold text-[var(--text-muted)]">
                        {launcherBackgroundBlurPercent}%
                      </span>
                    </div>

                    <div className="grid grid-cols-[56px_minmax(0,1fr)_42px] items-center gap-2">
                      <span className="text-[0.72rem] font-medium text-[var(--text-secondary)]">{t('settings.general.background.opacity')}</span>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        step="1"
                        value={launcherBackgroundOpacityPercent}
                        onChange={(event) => {
                          void handleLauncherBackgroundPercentChange(
                            'launcherBackgroundImageOpacityPercent',
                            Number(event.target.value)
                          );
                        }}
                        className="w-full"
                        style={{ accentColor: 'var(--accent-color)' }}
                      />
                      <span className="text-right text-[0.72rem] font-semibold text-[var(--text-muted)]">
                        {launcherBackgroundOpacityPercent}%
                      </span>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            <label className="inline-flex items-center gap-2.5 text-[0.75rem] text-[var(--text-secondary)] cursor-pointer">
              <input
                type="checkbox"
                checked={settings.launcherBackgroundImageEverywhere ?? false}
                onChange={(event) => {
                  void handleLauncherBackgroundEverywhereChange(event.target.checked);
                }}
                className="settings-checkbox"
                disabled={!launcherBackgroundFileName}
              />
              {t('settings.general.background.useEverywhere')}
            </label>
          </div>
        </SettingsRow>

        <SettingsRow
          icon={<RefreshCw className={`w-4 h-4 ${updaterState === 'checking' ? 'animate-spin' : ''}`} />}
          title={t('settings.general.updates.title')}
          description={t('settings.general.updates.description')}
        >
          <div className="w-full space-y-2">
            <div>
              <p className="text-[0.8125rem] font-semibold text-[var(--text-primary)] leading-snug">
                {updaterPrimaryMessage}
              </p>
              <p className="text-[0.75rem] text-[var(--text-subtle)] mt-0.5 leading-tight">
                {t('settings.general.updates.currentVersion', { version: currentVersion })}
                {updaterStatus?.latestVersion
                  ? ` · ${t('settings.general.updates.latestVersion', { version: updaterStatus.latestVersion })}`
                  : ''}
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
                  {t('settings.general.updates.progress', {
                    progress: updaterProgress.toFixed(0),
                    transferred: formatBytes(updaterStatus?.transferredBytes),
                    total: formatBytes(updaterStatus?.totalBytes),
                  })}
                </p>
              </div>
            )}

            {(updaterActionError || updaterState === 'error') && (
              <p className="text-[0.75rem] text-red-400">
                {updaterActionError || updaterStatus?.message || t('settings.general.updates.failed')}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={updaterAction.onClick}
                disabled={updaterAction.disabled}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-[0.75rem] disabled:opacity-60 disabled:cursor-not-allowed disabled:border-[var(--ui-divider)] disabled:bg-[var(--ui-segment-bg)] transition-colors ${updaterAction.className}`}
              >
                <UpdaterActionIcon
                  className={`w-3.5 h-3.5 ${
                    updaterState === 'checking'
                      ? 'animate-spin'
                      : updaterState === 'downloading'
                        ? 'animate-pulse'
                        : ''
                  }`}
                />
                {updaterAction.label}
              </button>
            </div>
          </div>
        </SettingsRow>

        <SettingsRow
          icon={<Info className="w-4 h-4" />}
          title={t('settings.general.about.title')}
          description={t('settings.general.about.description')}
          withBorder={false}
        >
          <p className="text-[0.8125rem] font-semibold text-[var(--text-primary)] leading-snug">
            {t('settings.general.about.version', { version: currentVersion })}
          </p>
        </SettingsRow>
      </div>
    </div>
  );
};

export default GeneralTab;
