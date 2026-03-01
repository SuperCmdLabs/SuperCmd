import React, { useCallback, useEffect, useState } from 'react';
import { Bug, Command, Info, Power } from 'lucide-react';
import type { AppSettings } from '../../types/electron';
import SearchableDropdown, { type SearchableDropdownOption } from '../components/SearchableDropdown';

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

const CAPS_LOCK_KEY_CODE = 57;
const NO_HYPER_KEY_VALUE = '__none__';

const SETTINGS_DROPDOWN_TRIGGER_CLASS =
  'w-full max-w-[520px] bg-[var(--ui-segment-bg)] border border-[var(--ui-segment-border)] rounded-lg px-3 py-2.5 text-sm text-white/92 outline-none hover:border-[var(--snippet-divider-strong)] transition-colors text-left flex items-center justify-between gap-2';

const HYPER_KEY_OPTIONS: Array<{ keyCode: number | null; label: string; searchText?: string }> = [
  { keyCode: null, label: '-', searchText: 'none disable off' },
  { keyCode: 57, label: 'Caps Lock (⇪)' },
  { keyCode: 59, label: 'Left Control (^)' },
  { keyCode: 56, label: 'Left Shift (⇧)' },
  { keyCode: 58, label: 'Left Option (⌥)' },
  { keyCode: 55, label: 'Left Command (⌘)' },
  { keyCode: 62, label: 'Right Control (^)' },
  { keyCode: 60, label: 'Right Shift (⇧)' },
  { keyCode: 61, label: 'Right Option (⌥)' },
  { keyCode: 54, label: 'Right Command (⌘)' },
  { keyCode: 122, label: 'F1' },
  { keyCode: 120, label: 'F2' },
  { keyCode: 99, label: 'F3' },
  { keyCode: 118, label: 'F4' },
  { keyCode: 96, label: 'F5' },
  { keyCode: 97, label: 'F6' },
  { keyCode: 98, label: 'F7' },
  { keyCode: 100, label: 'F8' },
  { keyCode: 101, label: 'F9' },
  { keyCode: 109, label: 'F10' },
  { keyCode: 103, label: 'F11' },
  { keyCode: 111, label: 'F12' },
  { keyCode: 90, label: 'F20' },
];

const QUICK_PRESS_OPTIONS: SearchableDropdownOption[] = [
  { value: 'none', label: 'Does Nothing' },
  { value: 'toggle-caps-lock', label: 'Toggles Caps Lock' },
  { value: 'escape', label: 'Triggers Esc' },
];

const HYPER_KEY_DROPDOWN_OPTIONS: SearchableDropdownOption[] = HYPER_KEY_OPTIONS.map((option) => ({
  value: option.keyCode === null ? NO_HYPER_KEY_VALUE : String(option.keyCode),
  label: option.label,
  searchText: option.searchText || option.label,
}));

function findHyperKeyOptionByCode(keyCode: number | null | undefined): (typeof HYPER_KEY_OPTIONS)[number] | undefined {
  if (keyCode === null || keyCode === undefined) return HYPER_KEY_OPTIONS.find((option) => option.keyCode === null);
  return HYPER_KEY_OPTIONS.find((option) => option.keyCode === keyCode);
}

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

  const handleOpenAtLoginChange = useCallback(async (enabled: boolean) => {
    setSettings((prev) => (prev ? { ...prev, openAtLogin: enabled } : prev));
    try {
      const ok = await window.electron.setOpenAtLogin(enabled);
      if (!ok) {
        const next = await window.electron.getSettings();
        setSettings(next);
      }
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

  const selectedHyperKeyOption = findHyperKeyOptionByCode(settings.hyperKeySource);
  const selectedHyperKeyCode = settings.hyperKeySource;
  const hasHyperKeySelection = selectedHyperKeyCode !== null && selectedHyperKeyCode !== undefined;
  const isCapsLockSelected = selectedHyperKeyCode === CAPS_LOCK_KEY_CODE;

  return (
    <div className="w-full max-w-[980px] mx-auto space-y-3">
      <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">Advanced</h2>

      <div className="overflow-hidden rounded-xl border border-[var(--ui-panel-border)] bg-[var(--settings-panel-bg)]">
        <SettingsRow
          icon={<Command className="w-4 h-4" />}
          title="Hyper Key"
          description="Choose which key should act as Hyper in your remapper setup."
        >
          <div className="w-full space-y-3">
            <div className="w-full flex items-center gap-2">
              <SearchableDropdown
                value={selectedHyperKeyCode === null ? NO_HYPER_KEY_VALUE : String(selectedHyperKeyCode)}
                options={HYPER_KEY_DROPDOWN_OPTIONS}
                onChange={(nextValue) => {
                  const keyCode = nextValue === NO_HYPER_KEY_VALUE ? null : Number(nextValue);
                  void applySettingsPatch({ hyperKeySource: Number.isFinite(keyCode) ? keyCode : null });
                }}
                searchPlaceholder="Search..."
                noResultsText="No keys found"
                triggerClassName={SETTINGS_DROPDOWN_TRIGGER_CLASS}
                listMaxHeight={380}
                minMenuWidth={520}
                renderTriggerContent={(selected) => (
                  <span className="truncate">{selected?.label || '-'}</span>
                )}
              />
              <Info className="w-4 h-4 text-[var(--text-muted)] shrink-0" />
            </div>

            {hasHyperKeySelection ? (
              <>
                <label className="inline-flex items-center gap-2.5 text-[13px] text-white/85 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(settings.hyperKeyIncludeShift)}
                    onChange={(event) => {
                      void applySettingsPatch({ hyperKeyIncludeShift: event.target.checked });
                    }}
                    className="settings-checkbox"
                  />
                  Include shift in Hyper Key
                </label>
                <p className="text-[12px] text-white/65 max-w-[700px] leading-snug">
                  Pressing the {selectedHyperKeyOption?.label || 'selected key'} key will instead register presses of all four ^⌥⇧⌘ left modifier keys.
                </p>

                {isCapsLockSelected ? (
                  <div className="space-y-2 pt-0.5">
                    <div className="text-[13px] font-semibold text-[var(--text-primary)]">Quick Press</div>
                    <div className="w-full flex items-center gap-2">
                      <SearchableDropdown
                        value={settings.hyperKeyQuickPressAction || 'toggle-caps-lock'}
                        options={QUICK_PRESS_OPTIONS}
                        onChange={(nextValue) => {
                          const action = nextValue as AppSettings['hyperKeyQuickPressAction'];
                          void applySettingsPatch({ hyperKeyQuickPressAction: action });
                        }}
                        searchPlaceholder="Search..."
                        noResultsText="No actions found"
                        triggerClassName={SETTINGS_DROPDOWN_TRIGGER_CLASS}
                        listMaxHeight={220}
                        minMenuWidth={520}
                      />
                      <Info className="w-4 h-4 text-[var(--text-muted)] shrink-0" />
                    </div>
                  </div>
                ) : null}

                <p className="text-[12px] text-white/58">Hyper Key shortcuts will be shown in SuperCmd with ✦</p>
              </>
            ) : null}
          </div>
        </SettingsRow>

        <SettingsRow
          icon={<Power className="w-4 h-4" />}
          title="Start at Login"
          description="Launch SuperCmd automatically when you sign in."
        >
          <label className="inline-flex items-center gap-2.5 text-[13px] text-white/85 cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(settings.openAtLogin)}
              onChange={(event) => {
                void handleOpenAtLoginChange(event.target.checked);
              }}
              className="settings-checkbox"
            />
            Start SuperCmd at login
          </label>
        </SettingsRow>

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
