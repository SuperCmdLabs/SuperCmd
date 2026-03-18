import React, { useCallback, useEffect, useState } from 'react';
import { Bug, Sparkles } from 'lucide-react';
import type { AppSettings, HyperKeySourceKey, HyperKeyCapsLockTapBehavior } from '../../types/electron';

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

const SOURCE_KEY_OPTIONS: { value: HyperKeySourceKey; label: string }[] = [
  { value: 'caps-lock', label: 'Caps Lock' },
  { value: 'left-shift', label: 'Left Shift' },
  { value: 'right-shift', label: 'Right Shift' },
  { value: 'left-option', label: 'Left Option' },
  { value: 'right-option', label: 'Right Option' },
  { value: 'left-control', label: 'Left Control' },
  { value: 'right-control', label: 'Right Control' },
];

const CAPS_LOCK_TAP_OPTIONS: { value: HyperKeyCapsLockTapBehavior; label: string }[] = [
  { value: 'escape', label: 'Simulate Escape' },
  { value: 'nothing', label: 'Do Nothing' },
  { value: 'toggle', label: 'Toggle Caps Lock' },
];

const AdvancedTab: React.FC = () => {
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
    return <div className="p-6 text-[var(--text-muted)] text-[12px]">Loading advanced settings...</div>;
  }

  const hyperKey = settings.hyperKey ?? { enabled: false, sourceKey: 'caps-lock' as const, capsLockTapBehavior: 'escape' as const };
  const hyperEnabled = hyperKey.enabled;
  const showCapsLockTap = hyperEnabled && hyperKey.sourceKey === 'caps-lock';

  return (
    <div className="w-full max-w-[980px] mx-auto space-y-3">
      <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">Advanced</h2>

      {/* Hyper Key */}
      <div className="overflow-hidden rounded-xl border border-[var(--ui-panel-border)] bg-[var(--settings-panel-bg)]">
        <SettingsRow
          icon={<Sparkles className="w-4 h-4" />}
          title="Hyper Key"
          description="Remap a key to act as a Hyper modifier for custom shortcuts."
          withBorder={hyperEnabled}
        >
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
        </SettingsRow>

        {hyperEnabled && (
          <SettingsRow
            icon={<div className="w-4 h-4" />}
            title="Source Key"
            description="The physical key that becomes the Hyper modifier."
            withBorder={showCapsLockTap}
          >
            <select
              value={hyperKey.sourceKey}
              onChange={(event) => {
                void applySettingsPatch({
                  hyperKey: { ...hyperKey, sourceKey: event.target.value as HyperKeySourceKey },
                });
              }}
              className="settings-select"
            >
              {SOURCE_KEY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </SettingsRow>
        )}

        {showCapsLockTap && (
          <SettingsRow
            icon={<div className="w-4 h-4" />}
            title="Caps Lock Tap"
            description="What happens when Caps Lock is pressed and released alone."
            withBorder={false}
          >
            <select
              value={hyperKey.capsLockTapBehavior}
              onChange={(event) => {
                void applySettingsPatch({
                  hyperKey: { ...hyperKey, capsLockTapBehavior: event.target.value as HyperKeyCapsLockTapBehavior },
                });
              }}
              className="settings-select"
            >
              {CAPS_LOCK_TAP_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </SettingsRow>
        )}
      </div>

      {/* Debug Mode */}
      <div className="overflow-hidden rounded-xl border border-[var(--ui-panel-border)] bg-[var(--settings-panel-bg)]">
        <SettingsRow
          icon={<Bug className="w-4 h-4" />}
          title="Debug Mode"
          description="Show detailed logs when extensions fail to load or build."
          withBorder={false}
        >
          <label className="inline-flex items-center gap-2.5 text-[13px] text-white/85 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.debugMode ?? false}
              onChange={(event) => {
                const debugMode = event.target.checked;
                void applySettingsPatch({ debugMode });
              }}
              className="settings-checkbox"
            />
            Enable debug mode
          </label>
        </SettingsRow>
      </div>
    </div>
  );
};

export default AdvancedTab;
