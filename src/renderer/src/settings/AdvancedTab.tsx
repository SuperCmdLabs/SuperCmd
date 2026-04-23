import React, { useCallback, useEffect, useState } from 'react';
import { Bug, FolderSearch, Keyboard, Languages, Sparkles } from 'lucide-react';
import type { AppNavigationStyle, AppSettings, HyperKeySourceKey, HyperKeyCapsLockTapBehavior } from '../../types/electron';
import { APP_LANGUAGE_OPTIONS, DEFAULT_APP_LANGUAGE, type AppLanguageSetting, useI18n } from '../i18n';

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
  'w-full bg-[var(--ui-segment-bg)] border border-[var(--ui-divider)] rounded-md px-2.5 py-2 text-sm text-[var(--text-secondary)] focus:outline-none focus:border-blue-500/50';

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

const AdvancedTab: React.FC = () => {
  const { t } = useI18n();
  const [settings, setSettings] = useState<AppSettings | null>(null);

  useEffect(() => {
    window.electron.getSettings().then((next) => {
      setSettings(next);
    });
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

  if (!settings) {
    return <div className="p-6 text-[var(--text-muted)] text-[12px]">{t('settings.advanced.loading')}</div>;
  }

  const hyperKey = settings.hyperKey ?? { enabled: false, sourceKey: 'caps-lock' as const, capsLockTapBehavior: 'escape' as const };
  const hyperEnabled = hyperKey.enabled;
  const showCapsLockTap = hyperEnabled && hyperKey.sourceKey === 'caps-lock';

  return (
    <div className="w-full max-w-[980px] mx-auto space-y-3">
      <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">{t('settings.advanced.title')}</h2>

      <div className="overflow-hidden rounded-xl border border-[var(--ui-panel-border)] bg-[var(--settings-panel-bg)]">
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
                <div>
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
                  <div>
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
              className="w-full bg-[var(--ui-segment-bg)] border border-[var(--ui-divider)] rounded-md px-2.5 py-2 text-sm text-[var(--text-secondary)] focus:outline-none focus:border-blue-500/50"
            >
              {APP_LANGUAGE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option === 'system' ? t('settings.general.language.system') : t(`settings.general.language.${option}`)}
                </option>
              ))}
            </select>
          </div>
        </SettingsRow>

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
    </div>
  );
};

export default AdvancedTab;
