/**
 * General Settings Tab
 *
 * Structured row layout aligned with the settings design system.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Keyboard, Info, RefreshCw, Download, RotateCcw, Type, Sun, Moon, SunMoon, Sparkles, Image, Trash2, SlidersHorizontal, ChevronDown, ChevronUp, Power, PanelTop, X, ShieldAlert, Wand2, FileArchive, FolderTree, Command, Link2, StickyNote, Puzzle, BrainCircuit } from 'lucide-react';
import HotkeyRecorder from './HotkeyRecorder';
import type { AppSettings, AppUpdaterStatus, RaycastImportPreview, RaycastImportProgress, RaycastImportResult, RaycastImportSelections } from '../../types/electron';
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

const IMPORT_CATEGORY_META: Array<{
  key: keyof RaycastImportSelections;
  title: string;
  description: string;
  icon: React.ReactNode;
  countKey: keyof RaycastImportPreview['counts'];
}> = [
  { key: 'settings', title: 'App settings', description: 'Launcher mode, global hotkey, navigation style, and core mapped preferences.', icon: <Wand2 className="w-4 h-4" />, countKey: 'settings' },
  { key: 'disabledCommands', title: 'Disabled commands', description: 'Extension and script command disabled state.', icon: <ShieldAlert className="w-4 h-4" />, countKey: 'disabledCommands' },
  { key: 'scriptCommandFolders', title: 'Script folders', description: 'Imported Raycast script-command directories.', icon: <FolderTree className="w-4 h-4" />, countKey: 'scriptCommandFolders' },
  { key: 'commandHotkeys', title: 'Command hotkeys', description: 'Per-command hotkeys mapped onto SuperCmd commands.', icon: <Command className="w-4 h-4" />, countKey: 'commandHotkeys' },
  { key: 'commandAliases', title: 'Aliases', description: 'Best-effort alias migration from exported search terms.', icon: <Command className="w-4 h-4" />, countKey: 'commandAliases' },
  { key: 'pinnedCommands', title: 'Favorites', description: 'Pinned commands and favorites when Raycast exports them.', icon: <Sparkles className="w-4 h-4" />, countKey: 'pinnedCommands' },
  { key: 'aiChats', title: 'AI chats', description: 'Conversation history mapped into the existing SuperCmd chat UI.', icon: <BrainCircuit className="w-4 h-4" />, countKey: 'aiChats' },
  { key: 'quicklinks', title: 'Quicklinks', description: 'Saved links and templates.', icon: <Link2 className="w-4 h-4" />, countKey: 'quicklinks' },
  { key: 'snippets', title: 'Snippets', description: 'Text expansions and snippet content.', icon: <Type className="w-4 h-4" />, countKey: 'snippets' },
  { key: 'notes', title: 'Notes', description: 'Raycast notes imported into SuperCmd notes.', icon: <StickyNote className="w-4 h-4" />, countKey: 'notes' },
  { key: 'extensions', title: 'Extensions', description: 'Install missing Raycast Store extensions.', icon: <Puzzle className="w-4 h-4" />, countKey: 'extensions' },
  { key: 'extensionPreferences', title: 'Extension prefs', description: 'Mapped extension preference values for imported and installed extensions.', icon: <Puzzle className="w-4 h-4" />, countKey: 'extensionPreferences' },
];

const GeneralTab: React.FC = () => {
  const { t } = useI18n();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [updaterStatus, setUpdaterStatus] = useState<AppUpdaterStatus | null>(null);
  const [updaterActionError, setUpdaterActionError] = useState('');
  const [shortcutStatus, setShortcutStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [themePreference, setThemePreference] = useState<ThemePreference>(() => getThemePreference());
  const [uiStyle, setUiStyle] = useState<UiStylePreference>('default');
  const [launcherViewMode, setLauncherViewMode] = useState<'expanded' | 'compact'>('expanded');
  const [launcherBackgroundBusy, setLauncherBackgroundBusy] = useState(false);
  const [launcherBackgroundControlsExpanded, setLauncherBackgroundControlsExpanded] = useState(false);
  const [raycastImportBusy, setRaycastImportBusy] = useState(false);
  const [raycastImportPreview, setRaycastImportPreview] = useState<RaycastImportPreview | null>(null);
  const [raycastImportSelections, setRaycastImportSelections] = useState<RaycastImportSelections | null>(null);
  const [raycastImportConflictMode, setRaycastImportConflictMode] = useState<'skip' | 'overwrite'>('skip');
  const [raycastImportProgress, setRaycastImportProgress] = useState<RaycastImportProgress | null>(null);
  const [raycastImportLog, setRaycastImportLog] = useState<Array<RaycastImportProgress>>([]);
  const [raycastImportResult, setRaycastImportResult] = useState<RaycastImportResult | null>(null);

  useEffect(() => {
    window.electron.getSettings().then((nextSettings) => {
      const normalizedFontSize = nextSettings.fontSize || getDefaultAppFontSize();
      applyAppFontSize(normalizedFontSize);
      setSettings({
        ...nextSettings,
        fontSize: normalizedFontSize,
      });
      setUiStyle(normalizeUiStyle(nextSettings.uiStyle));
      setLauncherViewMode(nextSettings.launcherViewMode || 'expanded');
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
      setLauncherViewMode(nextSettings.launcherViewMode || 'expanded');
    });
    return cleanup;
  }, []);

  useEffect(() => {
    return window.electron.onRaycastImportProgress((payload) => {
      setRaycastImportProgress(payload);
      setRaycastImportLog((prev) => [...prev.slice(-11), payload]);
    });
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

  const handleRaycastImport = async () => {
    if (raycastImportBusy) return;
    setRaycastImportBusy(true);
    try {
      const preview = await window.electron.previewRaycastConfigImport();
      setRaycastImportProgress(null);
      setRaycastImportLog([]);
      setRaycastImportPreview(preview);
      setRaycastImportSelections(preview.canceled ? null : preview.selections);
    } catch (error: any) {
      setRaycastImportPreview(null);
      setRaycastImportSelections(null);
      setRaycastImportResult({
        canceled: false,
        settingsImported: false,
        disabledCommandsImported: 0,
        scriptCommandFoldersImported: 0,
        commandHotkeysImported: 0,
        commandAliasesImported: 0,
        pinnedCommandsImported: 0,
        aiChats: { found: 0, imported: 0, skipped: 0, failed: 0 },
        quicklinks: { found: 0, imported: 0, skipped: 0, failed: 1 },
        snippets: { found: 0, imported: 0, skipped: 0, failed: 0 },
        notes: { found: 0, imported: 0, skipped: 0, failed: 0 },
        extensions: { found: 0, imported: 0, skipped: 0, failed: 0 },
        importedExtensionPreferenceExtensions: [],
        unsupported: [],
        warnings: [String(error?.message || error || 'Raycast import failed.')],
      });
    } finally {
      setRaycastImportBusy(false);
    }
  };

  const handleApplyRaycastImport = async () => {
    if (raycastImportBusy || !raycastImportPreview?.sessionId || !raycastImportSelections) return;
    setRaycastImportBusy(true);
    try {
      setRaycastImportProgress(null);
      setRaycastImportLog([]);
      const result = await window.electron.applyRaycastConfigImport({
        sessionId: raycastImportPreview.sessionId,
        conflictMode: raycastImportConflictMode,
        selections: raycastImportSelections,
      });
      setRaycastImportResult(result);
      setRaycastImportPreview(null);
      setRaycastImportSelections(null);
    } catch (error: any) {
      setRaycastImportResult({
        canceled: false,
        settingsImported: false,
        disabledCommandsImported: 0,
        scriptCommandFoldersImported: 0,
        commandHotkeysImported: 0,
        commandAliasesImported: 0,
        pinnedCommandsImported: 0,
        aiChats: { found: 0, imported: 0, skipped: 0, failed: 0 },
        quicklinks: { found: 0, imported: 0, skipped: 0, failed: 1 },
        snippets: { found: 0, imported: 0, skipped: 0, failed: 0 },
        notes: { found: 0, imported: 0, skipped: 0, failed: 0 },
        extensions: { found: 0, imported: 0, skipped: 0, failed: 0 },
        importedExtensionPreferenceExtensions: [],
        unsupported: [],
        warnings: [String(error?.message || error || 'Raycast import failed.')],
      });
    } finally {
      setRaycastImportBusy(false);
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
  const selectedImportCategoryCount = raycastImportSelections
    ? Object.values(raycastImportSelections).filter(Boolean).length
    : 0;
  const selectedImportItemCount = raycastImportSelections && raycastImportPreview
    ? IMPORT_CATEGORY_META.reduce((count, category) => (
        raycastImportSelections[category.key]
          ? count + (raycastImportPreview.counts[category.countKey] || 0)
          : count
      ), 0)
    : 0;
  const raycastImportOverallPercent = raycastImportProgress
    ? Math.max(
        0,
        Math.min(
          100,
          raycastImportProgress.totalSteps > 0
            ? (raycastImportProgress.completedSteps / raycastImportProgress.totalSteps) * 100
            : 0
        )
      )
    : 0;
  const raycastImportByteLabel = raycastImportProgress && raycastImportProgress.downloadedBytes !== undefined
    ? `${formatBytes(raycastImportProgress.downloadedBytes)}${raycastImportProgress.totalBytes ? ` / ${formatBytes(raycastImportProgress.totalBytes)}` : ''}`
    : '';

  return (
    <>
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
          icon={<PanelTop className="w-4 h-4" />}
          title={t('settings.general.launcherMode.title')}
          description={t('settings.general.launcherMode.description')}
        >
          <div className="inline-flex items-center gap-0.5 rounded-lg border border-[var(--ui-divider)] bg-[var(--ui-segment-bg)] p-0.5">
            {([
              { id: 'expanded' as const, label: t('settings.general.launcherMode.expanded') },
              { id: 'compact' as const, label: t('settings.general.launcherMode.compact') },
            ]).map((option) => {
              const active = launcherViewMode === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={async () => {
                    if (!settings) return;
                    const prev = launcherViewMode;
                    setLauncherViewMode(option.id);
                    setSettings((s) => (s ? { ...s, launcherViewMode: option.id } : s));
                    try {
                      await window.electron.saveSettings({ launcherViewMode: option.id });
                    } catch {
                      setLauncherViewMode(prev);
                      setSettings((s) => (s ? { ...s, launcherViewMode: prev } : s));
                    }
                  }}
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
          icon={<Download className="w-4 h-4" />}
          title="Import Raycast Backup"
          description="Import settings and supported data from an encrypted Raycast .rayconfig backup."
        >
          <div className="w-full space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void handleRaycastImport()}
                disabled={raycastImportBusy}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-[var(--ui-divider)] bg-[var(--ui-segment-bg)] text-[0.75rem] font-semibold text-[var(--text-primary)] hover:border-[var(--ui-segment-border)] hover:bg-[var(--ui-segment-hover-bg)] disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              >
                <Download className={`w-3.5 h-3.5 ${raycastImportBusy ? 'animate-pulse' : ''}`} />
                {raycastImportBusy ? 'Importing…' : 'Choose Backup'}
              </button>
              {raycastImportResult?.filePath ? (
                <span className="text-[0.75rem] text-[var(--text-subtle)] truncate">
                  {getFileName(raycastImportResult.filePath)}
                </span>
              ) : null}
            </div>

            {raycastImportResult?.canceled ? (
              <p className="text-[0.75rem] text-[var(--text-subtle)]">
                Import canceled.
              </p>
            ) : null}

            {!raycastImportResult?.canceled && raycastImportResult ? (
              <div className="space-y-1">
                <p className="text-[0.75rem] text-[var(--text-secondary)]">
                  {[
                    raycastImportResult.settingsImported ? 'settings imported' : null,
                    `${raycastImportResult.aiChats.imported}/${raycastImportResult.aiChats.found} AI chats`,
                    `${raycastImportResult.quicklinks.imported}/${raycastImportResult.quicklinks.found} quicklinks`,
                    `${raycastImportResult.snippets.imported}/${raycastImportResult.snippets.found} snippets`,
                    `${raycastImportResult.notes.imported}/${raycastImportResult.notes.found} notes`,
                    `${raycastImportResult.extensions.imported}/${raycastImportResult.extensions.found} extensions`,
                  ].filter(Boolean).join(' · ')}
                </p>
                {raycastImportResult.disabledCommandsImported > 0 ? (
                  <p className="text-[0.75rem] text-[var(--text-subtle)]">
                    Imported {raycastImportResult.disabledCommandsImported} disabled command mapping{raycastImportResult.disabledCommandsImported === 1 ? '' : 's'}.
                  </p>
                ) : null}
                {raycastImportResult.commandHotkeysImported > 0 ? (
                  <p className="text-[0.75rem] text-[var(--text-subtle)]">
                    Imported {raycastImportResult.commandHotkeysImported} command hotkey{raycastImportResult.commandHotkeysImported === 1 ? '' : 's'}.
                  </p>
                ) : null}
                {raycastImportResult.commandAliasesImported > 0 ? (
                  <p className="text-[0.75rem] text-[var(--text-subtle)]">
                    Imported {raycastImportResult.commandAliasesImported} alias{raycastImportResult.commandAliasesImported === 1 ? '' : 'es'}.
                  </p>
                ) : null}
                {raycastImportResult.pinnedCommandsImported > 0 ? (
                  <p className="text-[0.75rem] text-[var(--text-subtle)]">
                    Imported {raycastImportResult.pinnedCommandsImported} favorite{raycastImportResult.pinnedCommandsImported === 1 ? '' : 's'} into pinned commands.
                  </p>
                ) : null}
                {raycastImportResult.scriptCommandFoldersImported > 0 ? (
                  <p className="text-[0.75rem] text-[var(--text-subtle)]">
                    Imported {raycastImportResult.scriptCommandFoldersImported} script command folder path{raycastImportResult.scriptCommandFoldersImported === 1 ? '' : 's'}.
                  </p>
                ) : null}
                {raycastImportResult.unsupported.length > 0 ? (
                  <p className="text-[0.75rem] text-[var(--text-subtle)]">
                    Skipped: {raycastImportResult.unsupported.join(', ')}.
                  </p>
                ) : null}
                {raycastImportResult.warnings.length > 0 ? (
                  <p className="text-[0.75rem] text-amber-300">
                    {raycastImportResult.warnings[0]}
                  </p>
                ) : null}
              </div>
            ) : null}
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
    {raycastImportPreview && !raycastImportPreview.canceled && raycastImportSelections ? (
      <div className="fixed inset-0 z-[120] flex items-center justify-center px-5 py-8">
        <button
          type="button"
          aria-label="Close import preview"
          className="absolute inset-0 bg-[rgba(5,8,12,0.62)] backdrop-blur-md"
          onClick={() => {
            if (raycastImportBusy) return;
            setRaycastImportPreview(null);
            setRaycastImportSelections(null);
          }}
        />
        <div className={`relative w-full overflow-hidden border shadow-[0_18px_60px_rgba(0,0,0,0.28)] ${
          raycastImportBusy
            ? 'max-w-[430px] rounded-[18px] border-[rgba(255,255,255,0.12)] bg-[linear-gradient(180deg,rgba(18,22,30,0.98),rgba(10,12,18,0.98))]'
            : 'max-w-[460px] rounded-[18px] border-[var(--ui-panel-border)] bg-[var(--settings-panel-bg)]'
        }`}>
          {!raycastImportBusy ? (
            <>
              <div className="border-b border-[var(--ui-divider)] px-4 py-3.5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="inline-flex items-center gap-2 rounded-full border border-[var(--ui-divider)] bg-[var(--ui-segment-bg)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-secondary)]">
                      <FileArchive className="w-3 h-3" />
                      Raycast Import
                    </div>
                    <h3 className="mt-2.5 text-[0.95rem] font-semibold text-[var(--text-primary)]">Choose what to import</h3>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[0.7rem] text-[var(--text-subtle)]">
                      {raycastImportPreview.filePath ? <span>{getFileName(raycastImportPreview.filePath)}</span> : null}
                      {raycastImportPreview.raycastVersion ? <span>Raycast {raycastImportPreview.raycastVersion}</span> : null}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setRaycastImportPreview(null);
                      setRaycastImportSelections(null);
                    }}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[var(--ui-divider)] bg-[var(--ui-segment-bg)] text-[var(--text-secondary)] hover:bg-[var(--ui-segment-hover-bg)]"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="px-4 py-3.5">
                <div className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
                  {IMPORT_CATEGORY_META.map((category) => {
                    const count = raycastImportPreview.counts[category.countKey] || 0;
                    const selected = raycastImportSelections[category.key];
                    const disabled = count === 0;
                    return (
                      <button
                        key={category.key}
                        type="button"
                        disabled={disabled}
                        onClick={() => {
                          if (disabled) return;
                          setRaycastImportSelections((prev) => (
                            prev ? { ...prev, [category.key]: !prev[category.key] } : prev
                          ));
                        }}
                        className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                          disabled
                            ? 'cursor-not-allowed border-[var(--ui-divider)] bg-[var(--ui-segment-bg)] opacity-45'
                            : selected
                              ? 'border-cyan-400/40 bg-cyan-400/10'
                              : 'border-[var(--ui-divider)] bg-[var(--ui-segment-bg)] hover:border-[var(--ui-segment-border)] hover:bg-[var(--ui-segment-hover-bg)]'
                        }`}
                      >
                        <div className={`inline-flex h-7 w-7 items-center justify-center rounded-lg ${
                          selected ? 'bg-cyan-400/18 text-cyan-200' : 'bg-[var(--ui-segment-active-bg)] text-[var(--text-secondary)]'
                        }`}>
                          {category.icon}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[0.77rem] font-medium text-[var(--text-primary)]">{category.title}</div>
                          <div className="mt-0.5 text-[0.68rem] text-[var(--text-muted)]">{category.description}</div>
                        </div>
                        <div className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          selected ? 'bg-cyan-400/16 text-cyan-200' : 'bg-[var(--ui-segment-active-bg)] text-[var(--text-secondary)]'
                        }`}>
                          {count}
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="mt-3 rounded-xl border border-[var(--ui-divider)] bg-[var(--ui-segment-bg)] p-2">
                  <div className="text-[0.7rem] font-medium text-[var(--text-primary)]">If something already exists</div>
                  <div className="mt-2 inline-flex w-full rounded-lg border border-[var(--ui-divider)] bg-[var(--ui-segment-bg)] p-0.5">
                    {([
                      { id: 'skip' as const, label: 'Keep existing', description: 'Merge safely' },
                      { id: 'overwrite' as const, label: 'Overwrite', description: 'Use backup values' },
                    ]).map((option) => {
                      const active = raycastImportConflictMode === option.id;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => setRaycastImportConflictMode(option.id)}
                          className={`flex-1 rounded-md px-3 py-2 text-left transition-colors ${
                            active
                              ? 'bg-[var(--ui-segment-active-bg)] text-[var(--text-primary)]'
                              : 'text-[var(--text-secondary)] hover:bg-[var(--ui-segment-hover-bg)]'
                          }`}
                        >
                          <div className="text-[0.72rem] font-medium">{option.label}</div>
                          <div className="text-[0.66rem] opacity-80">{option.description}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {raycastImportPreview.unsupported.length > 0 ? (
                  <div className="mt-3 rounded-xl border border-amber-300/18 bg-amber-300/10 px-3 py-2.5">
                    <div className="text-[0.68rem] font-medium text-amber-100">Not imported yet</div>
                    <p className="mt-1 text-[0.69rem] leading-relaxed text-amber-100/85">
                      {raycastImportPreview.unsupported.join(', ')}
                    </p>
                  </div>
                ) : null}
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-[var(--ui-divider)] px-4 py-3.5">
                <div className="text-[0.72rem] text-[var(--text-muted)]">
                  <span className="font-semibold text-[var(--text-primary)]">{selectedImportItemCount}</span> items across{' '}
                  <span className="font-semibold text-[var(--text-primary)]">{selectedImportCategoryCount}</span> categories
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setRaycastImportPreview(null);
                      setRaycastImportSelections(null);
                    }}
                    className="inline-flex items-center justify-center rounded-lg border border-[var(--ui-divider)] px-3 py-2 text-[0.73rem] font-medium text-[var(--text-secondary)] hover:bg-[var(--ui-segment-hover-bg)]"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleApplyRaycastImport()}
                    disabled={selectedImportCategoryCount === 0}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--ui-segment-active-bg)] px-3 py-2 text-[0.73rem] font-medium text-[var(--text-primary)] shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Import
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="px-4 py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-200">
                    <Download className="w-3 h-3" />
                    Importing
                  </div>
                  <h3 className="mt-2.5 text-[0.96rem] font-semibold text-white">
                    {raycastImportProgress?.extensionName || 'Bringing data over'}
                  </h3>
                  <p className="mt-1 text-[0.72rem] leading-relaxed text-[rgba(214,224,237,0.72)]">
                    {raycastImportProgress?.message || 'Preparing import…'}
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-[0.65rem] uppercase tracking-[0.12em] text-[rgba(214,224,237,0.52)]">Progress</div>
                  <div className="mt-1 text-[1.2rem] font-semibold text-white">{Math.round(raycastImportOverallPercent)}%</div>
                </div>
              </div>

              <div className="mt-3 rounded-[16px] border border-[rgba(255,255,255,0.09)] bg-[rgba(255,255,255,0.04)] p-3">
                <div className="flex items-center justify-between gap-3 text-[0.69rem] text-[rgba(214,224,237,0.74)]">
                  <span>
                    Step {Math.min(raycastImportProgress?.completedSteps || 0, raycastImportProgress?.totalSteps || 0)} / {raycastImportProgress?.totalSteps || 0}
                  </span>
                  {raycastImportProgress?.stage === 'extension' && raycastImportProgress?.extensionName ? (
                    <span className="truncate text-right">{raycastImportProgress.extensionName}</span>
                  ) : null}
                </div>
                <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-[rgba(255,255,255,0.08)]">
                  <div
                    className="h-full rounded-full bg-[linear-gradient(90deg,#5edfff,#238bff)] transition-all"
                    style={{ width: `${raycastImportOverallPercent}%` }}
                  />
                </div>
                {raycastImportProgress?.stage === 'extension' ? (
                  <div className="mt-3 rounded-xl border border-[rgba(255,255,255,0.08)] bg-[rgba(4,8,14,0.35)] px-3 py-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate text-[0.73rem] font-medium text-white">
                        {raycastImportProgress.extensionName || 'Extension'}
                      </span>
                      <span className="shrink-0 text-[0.7rem] text-cyan-200">
                        {raycastImportByteLabel || 'Preparing…'}
                      </span>
                    </div>
                    {raycastImportProgress.downloadedBytes !== undefined ? (
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[rgba(255,255,255,0.08)]">
                        <div
                          className="h-full rounded-full bg-[linear-gradient(90deg,#88e6ff,#33a8ff)] transition-all"
                          style={{
                            width: `${raycastImportProgress.totalBytes && raycastImportProgress.totalBytes > 0
                              ? Math.max(2, Math.min(100, (raycastImportProgress.downloadedBytes / raycastImportProgress.totalBytes) * 100))
                              : 18}%`,
                          }}
                        />
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>

              {raycastImportLog.length > 0 ? (
                <div className="mt-3 rounded-[16px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-3 py-2.5">
                  <div className="text-[0.66rem] font-semibold uppercase tracking-[0.12em] text-[rgba(214,224,237,0.55)]">Live activity</div>
                  <div className="mt-2 max-h-[120px] space-y-1.5 overflow-y-auto">
                    {raycastImportLog.slice().reverse().map((entry, index) => (
                      <div key={`${entry.message}-${index}`} className="flex items-start justify-between gap-3 text-[0.69rem] leading-relaxed text-[rgba(214,224,237,0.76)]">
                        <span className="min-w-0 flex-1">
                          {entry.message}
                          {entry.stage === 'extension' && entry.downloadedBytes !== undefined ? (
                            <span className="text-[rgba(214,224,237,0.48)]">
                              {` ${formatBytes(entry.downloadedBytes)}${entry.totalBytes ? ` / ${formatBytes(entry.totalBytes)}` : ''}`}
                            </span>
                          ) : null}
                        </span>
                        {entry.currentItem && entry.totalItems ? (
                          <span className="shrink-0 text-[rgba(214,224,237,0.48)]">{entry.currentItem}/{entry.totalItems}</span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    ) : null}
    </>
  );
};

export default GeneralTab;
