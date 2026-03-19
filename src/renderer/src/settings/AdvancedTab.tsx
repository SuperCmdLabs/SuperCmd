import React, { useCallback, useEffect, useState } from 'react';
import { Bug, Languages } from 'lucide-react';
import type { AppSettings } from '../../types/electron';
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

  return (
    <div className="w-full max-w-[980px] mx-auto space-y-3">
      <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">{t('settings.advanced.title')}</h2>

      <div className="overflow-hidden rounded-xl border border-[var(--ui-panel-border)] bg-[var(--settings-panel-bg)]">
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
          icon={<Bug className="w-4 h-4" />}
          title={t('settings.advanced.debugMode.title')}
          description={t('settings.advanced.debugMode.description')}
          withBorder={false}
        >
          <label className="inline-flex items-center gap-2.5 text-[13px] text-white/85 cursor-pointer">
            <input
              type="checkbox"
              checked={settings?.developerMode ?? false}
              onChange={async (e) => {
                await window.electron.updateSettings({ developerMode: e.target.checked });
                setSettings((prev) => (prev ? { ...prev, developerMode: e.target.checked } : null));
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
