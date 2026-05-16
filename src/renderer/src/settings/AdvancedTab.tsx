import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bug, Cloud, FolderOpen, FolderSearch, FolderSync, Globe, Keyboard, Languages, RotateCcw, Sparkles, Timer, Undo2 } from 'lucide-react';
import type {
  AppNavigationStyle,
  AppSettings,
  BrowserSearchEntry,
  BrowserSearchImportableProfile,
  BrowserSearchSettings,
  HyperKeySourceKey,
  HyperKeyCapsLockTapBehavior,
  RelocateMode,
} from '../../types/electron';
import { APP_LANGUAGE_OPTIONS, DEFAULT_APP_LANGUAGE, type AppLanguageSetting, useI18n } from '../i18n';
import RaycastImportSection from './RaycastImportSection';

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
        <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">{title}</h3>
        <p className="mt-0.5 text-[12px] text-[var(--text-muted)] leading-snug">{description}</p>
      </div>
    </div>
    <div className="flex items-center min-h-[32px]">{children}</div>
  </div>
);

const selectClassName =
  'sc-select';

const SOURCE_KEY_OPTIONS: { value: HyperKeySourceKey; label: string }[] = [
  { value: 'caps-lock', label: 'Caps Lock (⇪)' },
  { value: 'left-control', label: 'Left Control (⌃)' },
  { value: 'left-shift', label: 'Left Shift (⇧)' },
  { value: 'left-option', label: 'Left Option (⌥)' },
  { value: 'left-command', label: 'Left Command (⌘)' },
  { value: 'right-control', label: 'Right Control (⌃)' },
  { value: 'right-shift', label: 'Right Shift (⇧)' },
  { value: 'right-option', label: 'Right Option (⌥)' },
  { value: 'right-command', label: 'Right Command (⌘)' },
];

const CAPS_LOCK_TAP_OPTIONS: { value: HyperKeyCapsLockTapBehavior; label: string }[] = [
  { value: 'nothing', label: 'Do Nothing' },
  { value: 'escape', label: 'Simulate Escape' },
  { value: 'toggle', label: 'Toggles Caps Lock' },
];

const NAVIGATION_STYLE_OPTIONS: { value: AppNavigationStyle; labelKey: string }[] = [
  { value: 'vim', labelKey: 'settings.advanced.navigationStyle.option.vim' },
  { value: 'macos', labelKey: 'settings.advanced.navigationStyle.option.macos' },
];

const BROWSER_SEARCH_RETENTION_OPTIONS: { value: number | null; labelKey: string }[] = [
  { value: 7, labelKey: 'settings.advanced.browserSearch.retention.option.7d' },
  { value: 30, labelKey: 'settings.advanced.browserSearch.retention.option.30d' },
  { value: 90, labelKey: 'settings.advanced.browserSearch.retention.option.90d' },
  { value: 180, labelKey: 'settings.advanced.browserSearch.retention.option.180d' },
  { value: 365, labelKey: 'settings.advanced.browserSearch.retention.option.365d' },
  { value: null, labelKey: 'settings.advanced.browserSearch.retention.option.forever' },
];

const CHROMIUM_BROWSER_IDS = new Set(['helium', 'chrome', 'arc', 'brave', 'edge', 'vivaldi']);

const AUTO_QUIT_TIMEOUT_OPTIONS: { value: number; label: string }[] = [
  { value: 60, label: '1m' },
  { value: 120, label: '2m' },
  { value: 180, label: '3m' },
  { value: 300, label: '5m' },
  { value: 600, label: '10m' },
  { value: 900, label: '15m' },
  { value: 1800, label: '30m' },
];

interface BrowserSearchSectionProps {
  settings: BrowserSearchSettings;
  onChange: (next: BrowserSearchSettings) => void;
}

const BrowserSearchSection: React.FC<BrowserSearchSectionProps> = ({ settings, onChange }) => {
  const { t } = useI18n();
  const [profiles, setProfiles] = useState<BrowserSearchImportableProfile[]>([]);
  const [entries, setEntries] = useState<BrowserSearchEntry[]>([]);
  const [busyProfileId, setBusyProfileId] = useState<string>('');
  const [statusMessage, setStatusMessage] = useState<string>('');

  const refreshBrowserData = useCallback(async () => {
    try {
      const [profileList, entryList] = await Promise.all([
        window.electron.browserSearchListProfiles(),
        window.electron.browserSearchListEntries(),
      ]);
      setProfiles(profileList);
      setEntries(entryList);
    } catch {
      setProfiles([]);
      setEntries([]);
    }
  }, []);

  useEffect(() => {
    void refreshBrowserData();
  }, [refreshBrowserData]);

  useEffect(() => {
    return window.electron.onBrowserSearchHistoryChanged(() => {
      void refreshBrowserData();
    });
  }, [refreshBrowserData]);

  useEffect(() => {
    if (!statusMessage) return;
    const id = window.setTimeout(() => setStatusMessage(''), 4000);
    return () => window.clearTimeout(id);
  }, [statusMessage]);

  const handleClear = useCallback(async () => {
    try {
      await window.electron.browserSearchClearHistory();
      await refreshBrowserData();
      setStatusMessage(t('settings.advanced.browserSearch.status.cleared'));
    } catch {
      setStatusMessage(t('settings.advanced.browserSearch.status.failed'));
    }
  }, [refreshBrowserData, t]);

  const importProfile = useCallback(async (profileId: string) => {
    if (!profileId) return null;
    setBusyProfileId(profileId);
    setStatusMessage('');
    try {
      const result = await window.electron.browserSearchImportProfile(profileId);
      if (result.reason) {
        setStatusMessage(result.reason);
      } else {
        setStatusMessage(
          t('settings.advanced.browserSearch.status.imported', {
            count: String(result.imported),
            total: String(result.total),
          })
        );
      }
      await refreshBrowserData();
      return result;
    } catch (e: any) {
      setStatusMessage(e?.message || t('settings.advanced.browserSearch.status.failed'));
      return null;
    } finally {
      setBusyProfileId('');
    }
  }, [refreshBrowserData, t]);

  const handleAddProfile = useCallback(async (profileId: string) => {
    const currentProfileIds = Array.isArray(settings.profileSourceIds) ? settings.profileSourceIds : [];
    if (!currentProfileIds.includes(profileId)) {
      onChange({ ...settings, profileSourceIds: [...currentProfileIds, profileId] });
    }
    await importProfile(profileId);
  }, [importProfile, onChange, settings]);

  const handleRemoveProfile = useCallback((profileId: string) => {
    if (!profileId) return;
    const currentProfileIds = Array.isArray(settings.profileSourceIds) ? settings.profileSourceIds : [];
    onChange({
      ...settings,
      profileSourceIds: currentProfileIds.filter((id) => id !== profileId),
    });
  }, [onChange, settings]);

  const enabled = settings.enabled;
  const availableProfiles = profiles.filter((profile) => profile.available);
  const enabledProfileIds = new Set(settings.profileSourceIds || []);
  const chromiumProfiles = availableProfiles.filter((profile) => CHROMIUM_BROWSER_IDS.has(profile.browserId));
  const detectedProfiles = chromiumProfiles.filter((profile) => !enabledProfileIds.has(profile.id));
  const profileById = new Map(chromiumProfiles.map((profile) => [profile.id, profile]));
  const addedProfiles = (settings.profileSourceIds || [])
    .map((id) => profileById.get(id))
    .filter((profile): profile is BrowserSearchImportableProfile => Boolean(profile));
  const historyCountByProfileId = entries.reduce((counts, entry) => {
    if (entry.type !== 'url' || !entry.sourceProfileId) return counts;
    const profileSourceId = `${entry.source}:${entry.sourceProfileId}`;
    counts.set(profileSourceId, (counts.get(profileSourceId) || 0) + 1);
    return counts;
  }, new Map<string, number>());
  const bookmarkCountByProfileId = entries.reduce((counts, entry) => {
    if (entry.type !== 'bookmark' || !entry.sourceProfileId) return counts;
    const profileSourceId = `${entry.source}:${entry.sourceProfileId}`;
    counts.set(profileSourceId, (counts.get(profileSourceId) || 0) + 1);
    return counts;
  }, new Map<string, number>());

  return (
    <div className="grid gap-3 px-4 py-3.5 md:px-5 md:grid-cols-[220px_minmax(0,1fr)] border-b border-[var(--ui-divider)]">
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 text-[var(--text-muted)] shrink-0">
          <Globe className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">
            {t('settings.advanced.browserSearch.title')}
          </h3>
          <p className="mt-0.5 text-[12px] text-[var(--text-muted)] leading-snug">
            {t('settings.advanced.browserSearch.description')}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label className="inline-flex items-center gap-2.5 text-[13px] text-white/85 cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onChange({ ...settings, enabled: e.target.checked })}
            className="settings-checkbox"
          />
          {t('settings.advanced.browserSearch.enableLabel')}
        </label>

        {enabled ? (
          <>
            <div>
              <label className="text-[0.75rem] text-[var(--text-muted)] mb-1 block">
                {t('settings.advanced.browserSearch.retention.label')}
              </label>
              <div className="flex items-center gap-2">
                <div className="w-full max-w-[320px]">
                  <select
                    value={settings.historyRetentionDays === null ? 'forever' : String(settings.historyRetentionDays)}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const next = raw === 'forever' ? null : Number(raw);
                      onChange({ ...settings, historyRetentionDays: next });
                    }}
                    className="sc-select"
                  >
                    {BROWSER_SEARCH_RETENTION_OPTIONS.map((opt) => (
                      <option key={opt.labelKey} value={opt.value === null ? 'forever' : String(opt.value)}>
                        {t(opt.labelKey)}
                      </option>
                    ))}
                  </select>
                </div>
                <button type="button" onClick={handleClear} className="sc-button shrink-0 !py-1 !px-2.5 !text-[12px]">
                  {t('settings.advanced.browserSearch.clearButton')}
                </button>
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between gap-3">
                <label className="text-[0.75rem] text-[var(--text-muted)] block">
                  {t('settings.advanced.browserSearch.import.availableHeading')}
                </label>
                <span className="text-[11px] text-[var(--text-muted)] tabular-nums">{detectedProfiles.length}</span>
              </div>
              <p className="mb-2 text-[11px] text-[var(--text-muted)] leading-snug">
                {t('settings.advanced.browserSearch.import.profileSupportNote')}
              </p>
              <div className="overflow-hidden rounded-md border border-[var(--ui-divider)] bg-white/[0.03]">
                {detectedProfiles.length === 0 ? (
                  <div className="px-3 py-2.5 text-[12px] text-[var(--text-muted)]">
                    {t('settings.advanced.browserSearch.import.noneFound')}
                  </div>
                ) : (
                  <div className="divide-y divide-[var(--ui-divider)]">
                    {detectedProfiles.map((profile) => (
                      <div key={profile.id} className="grid gap-2 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                        <div className="min-w-0">
                          <div className="truncate text-[13px] font-medium text-[var(--text-primary)]">
                            {profile.browserName} - {profile.profileName}
                          </div>
                          <div className="mt-0.5 truncate text-[11px] text-[var(--text-muted)]">{profile.id}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleAddProfile(profile.id)}
                          disabled={Boolean(busyProfileId)}
                          className="sc-button shrink-0 !py-1 !px-2.5 !text-[12px]"
                        >
                          {busyProfileId === profile.id
                            ? t('settings.advanced.browserSearch.import.running')
                            : t('settings.advanced.browserSearch.import.add')}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between gap-3">
                <label className="text-[0.75rem] text-[var(--text-muted)] block">
                  {t('settings.advanced.browserSearch.import.addedHeading')}
                </label>
                <span className="text-[11px] text-[var(--text-muted)] tabular-nums">{addedProfiles.length}</span>
              </div>
              <p className="mb-2 text-[11px] text-[var(--text-muted)] leading-snug">
                {t('settings.advanced.browserSearch.import.enabledProfiles', {
                  count: String(enabledProfileIds.size),
                })}
              </p>
              <div className="overflow-hidden rounded-md border border-[var(--ui-divider)] bg-white/[0.03]">
                {addedProfiles.length === 0 ? (
                  <div className="px-3 py-2.5 text-[12px] text-[var(--text-muted)]">
                    {t('settings.advanced.browserSearch.import.noneAdded')}
                  </div>
                ) : (
                  <div className="divide-y divide-[var(--ui-divider)]">
                    {addedProfiles.map((profile) => (
                      <div key={profile.id} className="grid gap-2 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                        <div className="min-w-0">
                          <div className="truncate text-[13px] font-medium text-[var(--text-primary)]">
                            {profile.browserName} - {profile.profileName}
                          </div>
                          <div className="mt-0.5 truncate text-[11px] text-[var(--text-muted)]">
                            {t('settings.advanced.browserSearch.import.profileRowDetail', {
                              historyCount: String(historyCountByProfileId.get(profile.id) || 0),
                              bookmarkCount: String(bookmarkCountByProfileId.get(profile.id) || 0),
                            })}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => importProfile(profile.id)}
                            disabled={Boolean(busyProfileId)}
                            className="sc-button shrink-0 !py-1 !px-2.5 !text-[12px]"
                          >
                            {busyProfileId === profile.id
                              ? t('settings.advanced.browserSearch.import.running')
                              : t('settings.advanced.browserSearch.import.refresh')}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemoveProfile(profile.id)}
                            disabled={Boolean(busyProfileId)}
                            className="sc-button shrink-0 !py-1 !px-2.5 !text-[12px]"
                          >
                            {t('settings.advanced.browserSearch.import.remove')}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {statusMessage ? (
              <p className="text-[11px] text-[var(--text-muted)] leading-snug">{statusMessage}</p>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
};

const POP_TO_ROOT_TIMEOUT_OPTIONS: { value: number; labelKey: string }[] = [
  { value: 0, labelKey: 'settings.advanced.popToRootSearch.option.immediately' },
  { value: 5, labelKey: 'settings.advanced.popToRootSearch.option.5s' },
  { value: 15, labelKey: 'settings.advanced.popToRootSearch.option.15s' },
  { value: 30, labelKey: 'settings.advanced.popToRootSearch.option.30s' },
  { value: 60, labelKey: 'settings.advanced.popToRootSearch.option.60s' },
  { value: 90, labelKey: 'settings.advanced.popToRootSearch.option.90s' },
  { value: 120, labelKey: 'settings.advanced.popToRootSearch.option.120s' },
];

const DEFAULT_POP_TO_ROOT_TIMEOUT_SECONDS = 90;

function normalizePopToRootTimeoutValue(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return DEFAULT_POP_TO_ROOT_TIMEOUT_SECONDS;
  const allowed = POP_TO_ROOT_TIMEOUT_OPTIONS.map((opt) => opt.value);
  return allowed.includes(Math.trunc(num)) ? Math.trunc(num) : DEFAULT_POP_TO_ROOT_TIMEOUT_SECONDS;
}

function getSettingsFolderBaseName(filePath: string): string {
  const normalizedPath = String(filePath || '').trim().replace(/\/+$/, '');
  if (!normalizedPath) return '';
  const segments = normalizedPath.split('/');
  return segments[segments.length - 1] || normalizedPath;
}

const AdvancedTab: React.FC = () => {
  const { t } = useI18n();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [settingsLocation, setSettingsLocation] = useState<{ path: string | null; defaultPath: string } | null>(null);
  const [settingsFolderBusy, setSettingsFolderBusy] = useState(false);
  const [settingsFolderStatus, setSettingsFolderStatus] = useState<{ type: 'idle' | 'success' | 'error'; text: string }>({ type: 'idle', text: '' });
  // The two folder modals are mutually exclusive — combined into one
  // discriminated state to make that constraint explicit.
  type FolderModal =
    | { kind: 'conflict'; targetDir: string }
    | { kind: 'reset' }
    | null;
  const [folderModal, setFolderModal] = useState<FolderModal>(null);

  useEffect(() => {
    window.electron.getSettings().then((next) => {
      setSettings(next);
    });
  }, []);

  useEffect(() => {
    let disposed = false;
    const refreshLocation = () => {
      window.electron.getSettingsLocation?.().then((next) => {
        if (!disposed) setSettingsLocation(next);
      }).catch(() => {});
    };
    refreshLocation();
    // Re-pull the location on every settings broadcast so the row stays
    // accurate after a relocate/reset (which broadcasts settings-updated).
    // Also adopt the new settings payload so controls don't render stale
    // values after "use existing settings".
    const cleanup = window.electron.onSettingsUpdated?.((nextSettings) => {
      if (!disposed && nextSettings) setSettings(nextSettings);
      refreshLocation();
    });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  const applySettingsPatch = useCallback(async (patch: Partial<AppSettings>) => {
    setSettings((prev) => (prev ? { ...prev, ...patch } : prev));
    try {
      await window.electron.saveSettings(patch);
    } catch {
      try {
        const next = await window.electron.getSettings();
        setSettings(next);
      } catch {}
    }
  }, []);

  const statusClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (statusClearTimerRef.current) clearTimeout(statusClearTimerRef.current);
  }, []);

  const showSettingsFolderStatus = (type: 'success' | 'error', text: string, durationMs = 2200) => {
    setSettingsFolderStatus({ type, text });
    if (statusClearTimerRef.current) clearTimeout(statusClearTimerRef.current);
    statusClearTimerRef.current = setTimeout(() => {
      statusClearTimerRef.current = null;
      setSettingsFolderStatus({ type: 'idle', text: '' });
    }, durationMs);
  };

  const performRelocate = async (targetDir: string, mode: RelocateMode) => {
    setSettingsFolderBusy(true);
    try {
      const result = await window.electron.relocateSettings({ targetDir, mode });
      if (!result?.ok) {
        showSettingsFolderStatus('error', result?.error || t('settings.advanced.settingsFolder.status.failed'));
        return;
      }
      const successKey = mode === 'adopt'
        ? 'settings.advanced.settingsFolder.status.adopted'
        : 'settings.advanced.settingsFolder.status.moved';
      showSettingsFolderStatus('success', t(successKey));
    } catch (error: any) {
      showSettingsFolderStatus('error', String(error?.message || error || t('settings.advanced.settingsFolder.status.failed')));
    } finally {
      setSettingsFolderBusy(false);
      setFolderModal(null);
    }
  };

  const handlePickSettingsFolder = async () => {
    if (settingsFolderBusy) return;
    let picked: { path: string; hasExisting: boolean } | null = null;
    try {
      picked = await window.electron.pickSettingsFolder();
    } catch (error: any) {
      showSettingsFolderStatus('error', String(error?.message || error || t('settings.advanced.settingsFolder.status.failed')));
      return;
    }
    if (!picked || !picked.path) return;
    if (picked.hasExisting) {
      setFolderModal({ kind: 'conflict', targetDir: picked.path });
      return;
    }
    await performRelocate(picked.path, 'move');
  };

  const handleResetSettingsFolder = async () => {
    if (settingsFolderBusy) return;
    setSettingsFolderBusy(true);
    try {
      const result = await window.electron.resetSettingsLocation();
      if (!result?.ok) {
        showSettingsFolderStatus('error', result?.error || t('settings.advanced.settingsFolder.status.failed'));
        return;
      }
      showSettingsFolderStatus('success', t('settings.advanced.settingsFolder.status.reset'));
    } catch (error: any) {
      showSettingsFolderStatus('error', String(error?.message || error || t('settings.advanced.settingsFolder.status.failed')));
    } finally {
      setSettingsFolderBusy(false);
      setFolderModal(null);
    }
  };

  if (!settings) {
    return <div className="p-6 text-[var(--text-muted)] text-[12px]">{t('settings.advanced.loading')}</div>;
  }

  const usingCustomSettingsLocation = Boolean(settingsLocation?.path);
  const settingsLocationDisplay = usingCustomSettingsLocation
    ? settingsLocation!.path!
    : t('settings.advanced.settingsFolder.defaultLabel');
  const settingsLocationTooltip = usingCustomSettingsLocation
    ? settingsLocation!.path!
    : settingsLocation?.defaultPath || '';
  const conflictModal = folderModal?.kind === 'conflict' ? folderModal : null;
  const showResetConfirm = folderModal?.kind === 'reset';
  const settingsFolderConflictBaseName = conflictModal
    ? getSettingsFolderBaseName(conflictModal.targetDir) || conflictModal.targetDir
    : '';

  const hyperKey = settings.hyperKey ?? { enabled: false, sourceKey: 'caps-lock' as const, capsLockTapBehavior: 'escape' as const };
  const hyperEnabled = hyperKey.enabled;
  const showCapsLockTap = hyperEnabled && hyperKey.sourceKey === 'caps-lock';

  return (
    <div className="w-full max-w-[980px] mx-auto space-y-3">
      <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">{t('settings.advanced.title')}</h2>

      <div className="overflow-hidden rounded-xl border border-[var(--ui-panel-border)] bg-[var(--settings-panel-bg)]">
        <SettingsRow
          icon={<Cloud className="w-4 h-4" />}
          title="Cloud Sync"
          description={t('settings.advanced.settingsFolder.description')}
        >
          <div className="w-full space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void handlePickSettingsFolder()}
                disabled={settingsFolderBusy}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-[var(--ui-divider)] bg-[var(--ui-segment-bg)] text-[12px] font-semibold text-[var(--text-primary)] hover:border-[var(--ui-segment-border)] hover:bg-[var(--ui-segment-hover-bg)] disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                {usingCustomSettingsLocation
                  ? t('settings.advanced.settingsFolder.changeButton')
                  : t('settings.advanced.settingsFolder.chooseButton')}
              </button>

              {usingCustomSettingsLocation ? (
                <button
                  type="button"
                  onClick={() => setFolderModal({ kind: 'reset' })}
                  disabled={settingsFolderBusy}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-[var(--ui-divider)] bg-transparent text-[12px] font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--ui-segment-hover-bg)] disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  {t('settings.advanced.settingsFolder.resetButton')}
                </button>
              ) : null}
            </div>

            <p
              className="max-w-full truncate text-[12px] font-medium text-[var(--text-muted)]"
              title={settingsLocationTooltip}
            >
              {settingsLocationDisplay}
            </p>

            {settingsFolderStatus.type === 'success' ? (
              <p className="text-[12px] text-emerald-300/90">{settingsFolderStatus.text}</p>
            ) : null}
            {settingsFolderStatus.type === 'error' ? (
              <p className="text-[12px] text-red-400">{settingsFolderStatus.text}</p>
            ) : null}
          </div>
        </SettingsRow>

        {/* Hyper Key */}
        <div className={`grid gap-3 px-4 py-3.5 md:px-5 md:grid-cols-[220px_minmax(0,1fr)] border-b border-[var(--ui-divider)]`}>
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 text-[var(--text-muted)] shrink-0">
              <Sparkles className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">Hyper Key</h3>
              <p className="mt-0.5 text-[12px] text-[var(--text-muted)] leading-snug">
                Choose which key should act as Hyper in your remapper setup.
              </p>
            </div>
          </div>

          <div className={`flex flex-col gap-3 ${!hyperEnabled ? 'justify-center min-h-[48px]' : ''}`}>
            <label className="inline-flex items-center gap-2.5 text-[13px] text-white/85 cursor-pointer">
              <input
                type="checkbox"
                checked={hyperEnabled}
                onChange={(event) => {
                  void applySettingsPatch({
                    hyperKey: { ...hyperKey, enabled: event.target.checked },
                  });
                }}
                className="settings-checkbox"
              />
              Enable Hyper Key
            </label>

            {hyperEnabled && (
              <>
                <div className="w-full max-w-[320px]">
                  <select
                    value={hyperKey.sourceKey}
                    onChange={(event) => {
                      void applySettingsPatch({
                        hyperKey: { ...hyperKey, sourceKey: event.target.value as HyperKeySourceKey },
                      });
                    }}
                    className={selectClassName}
                  >
                    {SOURCE_KEY_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                {showCapsLockTap && (
                  <div className="w-full max-w-[320px]">
                    <label className="text-[0.75rem] text-[var(--text-muted)] mb-1 block">
                      Quick Press
                    </label>
                    <select
                      value={hyperKey.capsLockTapBehavior}
                      onChange={(event) => {
                        void applySettingsPatch({
                          hyperKey: { ...hyperKey, capsLockTapBehavior: event.target.value as HyperKeyCapsLockTapBehavior },
                        });
                      }}
                      className={selectClassName}
                    >
                      {CAPS_LOCK_TAP_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <p className="text-[11px] text-[var(--text-muted)] leading-snug">
                  Hyper Key shortcuts will be shown in SuperCmd with ✦
                </p>
              </>
            )}
          </div>
        </div>

        {/* Debug Mode */}
        <SettingsRow
          icon={<Languages className="w-4 h-4" />}
          title={t('settings.general.language.title')}
          description={t('settings.general.language.description')}
        >
          <div className="w-full max-w-[320px]">
            <select
              value={settings.appLanguage || DEFAULT_APP_LANGUAGE}
              onChange={(event) => {
                void applySettingsPatch({ appLanguage: event.target.value as AppLanguageSetting });
              }}
              className="sc-select"
            >
              {APP_LANGUAGE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option === 'system' ? t('settings.general.language.system') : t(`settings.general.language.${option}`)}
                </option>
              ))}
            </select>
          </div>
        </SettingsRow>

        <BrowserSearchSection
          settings={settings.browserSearch ?? { enabled: true, historyRetentionDays: 90, profileSourceIds: [] }}
          onChange={(next) => {
            void applySettingsPatch({ browserSearch: next });
          }}
        />

        <SettingsRow
          icon={<FolderSearch className="w-4 h-4" />}
          title={t('settings.advanced.disableFileSearch.title')}
          description={t('settings.advanced.disableFileSearch.description')}
        >
          <label className="inline-flex items-center gap-2.5 text-[13px] text-white/85 cursor-pointer">
            <input
              type="checkbox"
              checked={settings?.disableFileSearchResults ?? false}
              onChange={(e) => {
                void applySettingsPatch({ disableFileSearchResults: e.target.checked });
              }}
              className="settings-checkbox"
            />
            {t('settings.advanced.disableFileSearch.label')}
          </label>
        </SettingsRow>

        <SettingsRow
          icon={<Keyboard className="w-4 h-4" />}
          title={t('settings.advanced.navigationStyle.title')}
          description={t('settings.advanced.navigationStyle.description')}
        >
          <div className="w-full max-w-[320px]">
            <select
              value={settings.navigationStyle || 'vim'}
              onChange={(event) => {
                void applySettingsPatch({ navigationStyle: event.target.value as AppNavigationStyle });
              }}
              className={selectClassName}
            >
              {NAVIGATION_STYLE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {t(opt.labelKey)}
                </option>
              ))}
            </select>
          </div>
        </SettingsRow>

        <SettingsRow
          icon={<Undo2 className="w-4 h-4" />}
          title={t('settings.advanced.popToRootSearch.title')}
          description={t('settings.advanced.popToRootSearch.description')}
        >
          <div className="w-full max-w-[320px]">
            <select
              value={normalizePopToRootTimeoutValue(settings.popToRootSearchTimeoutSeconds)}
              onChange={(event) => {
                void applySettingsPatch({
                  popToRootSearchTimeoutSeconds: normalizePopToRootTimeoutValue(event.target.value),
                });
              }}
              className={selectClassName}
            >
              {POP_TO_ROOT_TIMEOUT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {t(opt.labelKey)}
                </option>
              ))}
            </select>
          </div>
        </SettingsRow>

        <SettingsRow
          icon={<Timer className="w-4 h-4" />}
          title={t('settings.general.autoQuit.title')}
          description={t('settings.general.autoQuit.description')}
        >
          <div className="inline-flex flex-wrap items-center gap-0.5 rounded-lg border border-[var(--ui-divider)] bg-[var(--ui-segment-bg)] p-0.5">
            {AUTO_QUIT_TIMEOUT_OPTIONS.map((option) => {
              const active = (settings.autoQuitDefaultTimeoutSeconds ?? 180) === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    void window.electron.autoQuitSetDefaultTimeout(option.value);
                    setSettings({ ...settings, autoQuitDefaultTimeoutSeconds: option.value });
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

        <RaycastImportSection />

        <SettingsRow
          icon={<Bug className="w-4 h-4" />}
          title={t('settings.advanced.debugMode.title')}
          description={t('settings.advanced.debugMode.description')}
          withBorder={false}
        >
          <label className="inline-flex items-center gap-2.5 text-[13px] text-white/85 cursor-pointer">
            <input
              type="checkbox"
              checked={settings?.debugMode ?? false}
              onChange={(e) => {
                void applySettingsPatch({ debugMode: e.target.checked });
              }}
              className="settings-checkbox"
            />
            {t('settings.advanced.debugMode.label')}
          </label>
        </SettingsRow>
      </div>

      {conflictModal ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/12"
          onClick={() => {
            if (!settingsFolderBusy) setFolderModal(null);
          }}
        >
          <div
            className="glass-effect w-[340px] max-w-[86vw] rounded-xl border border-[var(--ui-panel-border)] p-3.5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-md bg-[var(--ui-segment-bg)] border border-[var(--ui-divider)]">
              <FolderSync className="h-4.5 w-4.5 text-[var(--text-muted)]" />
            </div>

            <div className="text-center text-[18px] font-semibold leading-tight text-[var(--text-primary)]">
              {t('settings.advanced.settingsFolder.conflict.title')}
            </div>
            <p className="mt-1 text-center text-[11px] leading-snug text-[var(--text-subtle)]">
              {t('settings.advanced.settingsFolder.conflict.body', { folder: settingsFolderConflictBaseName })}
            </p>

            <div className="mt-3 space-y-2">
              <button
                type="button"
                disabled={settingsFolderBusy}
                onClick={() => void performRelocate(conflictModal.targetDir, 'adopt')}
                className="w-full rounded-md border border-[var(--accent-color)]/30 bg-[var(--accent-color)]/15 px-3 py-2 text-left text-[12px] font-semibold text-[var(--text-primary)] hover:bg-[var(--accent-color)]/25 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <div>{t('settings.advanced.settingsFolder.conflict.useExisting')}</div>
                <div className="mt-0.5 text-[11px] font-normal text-[var(--text-subtle)]">
                  {t('settings.advanced.settingsFolder.conflict.useExistingHint')}
                </div>
              </button>

              <button
                type="button"
                disabled={settingsFolderBusy}
                onClick={() => void performRelocate(conflictModal.targetDir, 'replace')}
                className="w-full rounded-md border border-[var(--ui-segment-border)] bg-[var(--ui-segment-bg)] px-3 py-2 text-left text-[12px] font-semibold text-[var(--text-primary)] hover:bg-[var(--ui-segment-hover-bg)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <div>{t('settings.advanced.settingsFolder.conflict.replace')}</div>
                <div className="mt-0.5 text-[11px] font-normal text-[var(--text-subtle)]">
                  {t('settings.advanced.settingsFolder.conflict.replaceHint')}
                </div>
              </button>

              <button
                type="button"
                disabled={settingsFolderBusy}
                onClick={() => setFolderModal(null)}
                className="w-full rounded-md px-3 py-1.5 text-[12px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {t('settings.advanced.settingsFolder.conflict.cancel')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showResetConfirm ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/12"
          onClick={() => {
            if (!settingsFolderBusy) setFolderModal(null);
          }}
        >
          <div
            className="glass-effect w-[340px] max-w-[86vw] rounded-xl border border-[var(--ui-panel-border)] p-3.5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-md bg-[var(--ui-segment-bg)] border border-[var(--ui-divider)]">
              <RotateCcw className="h-4.5 w-4.5 text-[var(--text-muted)]" />
            </div>

            <div className="text-center text-[18px] font-semibold leading-tight text-[var(--text-primary)]">
              {t('settings.advanced.settingsFolder.resetConfirm.title')}
            </div>
            <p className="mt-1 text-center text-[11px] leading-snug text-[var(--text-subtle)]">
              {t('settings.advanced.settingsFolder.resetConfirm.body')}
            </p>

            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                disabled={settingsFolderBusy}
                onClick={() => setFolderModal(null)}
                className="flex-1 rounded-md border border-[var(--ui-segment-border)] bg-[var(--ui-segment-bg)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--text-secondary)] hover:bg-[var(--ui-segment-hover-bg)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {t('settings.advanced.settingsFolder.resetConfirm.cancel')}
              </button>
              <button
                type="button"
                disabled={settingsFolderBusy}
                onClick={() => void handleResetSettingsFolder()}
                className="flex-1 rounded-md border border-[var(--accent-color)]/30 bg-[var(--accent-color)]/15 px-2.5 py-1.5 text-[12px] font-semibold text-[var(--text-primary)] hover:bg-[var(--accent-color)]/25 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {t('settings.advanced.settingsFolder.resetConfirm.confirm')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default AdvancedTab;
