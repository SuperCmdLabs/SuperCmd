import React, { useEffect, useState } from 'react';
import { Palette, Bug } from 'lucide-react';
import type { AppSettings } from '../../types/electron';
import { applyBaseColor, normalizeBaseColorHex } from '../utils/base-color';

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

const AdvancedTab: React.FC = () => {
  const [settings, setSettings] = useState<AppSettings | null>(null);

  useEffect(() => {
    window.electron.getSettings().then((next) => {
      setSettings(next);
      applyBaseColor(next.baseColor || '#101113');
    });
  }, []);

  if (!settings) {
    return <div className="p-6 text-white/50 text-[12px]">Loading advanced settings...</div>;
  }

  const handleBaseColorPreview = (value: string) => {
    const normalized = normalizeBaseColorHex(value);
    setSettings((prev) => (prev ? { ...prev, baseColor: normalized } : prev));
    applyBaseColor(normalized);
  };

  const handleBaseColorCommit = async (value: string) => {
    const normalized = normalizeBaseColorHex(value);
    handleBaseColorPreview(normalized);
    const updated = await window.electron.saveSettings({ baseColor: normalized });
    setSettings(updated);
  };

  return (
    <div className="w-full max-w-[980px] mx-auto space-y-3">
      <h2 className="text-[15px] font-semibold text-white">Advanced</h2>

      <div className="overflow-hidden rounded-xl border border-white/[0.10] bg-[rgba(20,20,20,0.34)]">
        {/* Hyper Key UI is temporarily disabled. */}
        {/* <SettingsRow
          icon={<Command className="w-4 h-4" />}
          title="Hyper Key"
          description="Choose which key should act as Hyper in your external remapper setup."
          withBorder={false}
        >
          <div className="w-full space-y-3">
            <select
              value={settings.hyperKeySource || 'none'}
              onChange={(e) => { void handleHyperKeySourceChange(e.target.value as AppSettings['hyperKeySource']); }}
              className="w-full max-w-[520px] bg-white/[0.04] border border-white/[0.12] rounded-lg px-3 py-2.5 text-sm text-white/92 outline-none"
            >
              {HYPER_KEY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>

            {settings.hyperKeySource === 'none' ? (
              <label className="inline-flex items-center gap-2 text-sm text-white/82">
                <input
                  type="checkbox"
                  checked={Boolean(settings.hyperReplaceModifierGlyphsWithHyper)}
                  onChange={(e) => { void handleHyperReplaceGlyphsChange(e.target.checked); }}
                  className="w-4 h-4 rounded border border-white/[0.18] bg-transparent"
                />
                Replace occurrences of ^⌥⇧⌘ with ✦
              </label>
            ) : (
              <>
                <label className="inline-flex items-center gap-2 text-sm text-white/82">
                  <input
                    type="checkbox"
                    checked={Boolean(settings.hyperKeyIncludeShift)}
                    onChange={(e) => { void handleHyperIncludeShiftChange(e.target.checked); }}
                    className="w-4 h-4 rounded border border-white/[0.18] bg-transparent"
                  />
                  Include shift in Hyper Key
                </label>
                <p className="text-[12px] text-white/52 max-w-[700px]">
                  Pressing the {HYPER_KEY_OPTIONS.find((o) => o.value === settings.hyperKeySource)?.label || 'selected key'} will instead register presses of all four ^⌥⇧⌘ left modifier keys.
                </p>
                {settings.hyperKeySource === 'caps-lock' ? (
                  <div className="space-y-2">
                    <div className="text-[13px] font-semibold text-white/90">Quick Press</div>
                    <select
                      value={settings.hyperKeyQuickPressAction || 'toggle-caps-lock'}
                      onChange={(e) => { void handleHyperQuickPressActionChange(e.target.value as AppSettings['hyperKeyQuickPressAction']); }}
                      className="w-full max-w-[520px] bg-white/[0.04] border border-white/[0.12] rounded-lg px-3 py-2.5 text-sm text-white/92 outline-none"
                    >
                      <option value="none">Does Nothing</option>
                      <option value="toggle-caps-lock">Toggles Caps Lock</option>
                      <option value="escape">Triggers Esc</option>
                    </select>
                  </div>
                ) : null}
                <p className="text-[12px] text-white/58">Hyper Key shortcuts will be shown with ✦.</p>
              </>
            )}
          </div>
        </SettingsRow> */}

        <SettingsRow
          icon={<Bug className="w-4 h-4" />}
          title="Debug Mode"
          description="Show detailed logs when extensions fail to load or build."
        >
          <label className="inline-flex items-center gap-2.5 text-[13px] text-white/85 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.debugMode ?? false}
              onChange={async (e) => {
                const debugMode = e.target.checked;
                setSettings((prev) => (prev ? { ...prev, debugMode } : prev));
                await window.electron.saveSettings({ debugMode });
              }}
              className="w-4 h-4 rounded accent-cyan-400"
            />
            Enable debug mode
          </label>
        </SettingsRow>

        <SettingsRow
          icon={<Palette className="w-4 h-4" />}
          title="Base Color"
          description="Changes only the core glass base color. Preview updates live while you drag."
          withBorder={false}
        >
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={normalizeBaseColorHex(settings.baseColor || '#101113')}
              onInput={(e) => handleBaseColorPreview((e.target as HTMLInputElement).value)}
              onChange={(e) => { void handleBaseColorCommit((e.target as HTMLInputElement).value); }}
              className="w-12 h-8 rounded border border-white/[0.14] bg-transparent cursor-pointer"
            />
            <input
              type="text"
              value={normalizeBaseColorHex(settings.baseColor || '#101113')}
              onChange={(e) => handleBaseColorPreview(e.target.value)}
              onBlur={(e) => { void handleBaseColorCommit(e.target.value); }}
              className="w-28 bg-white/[0.05] border border-white/[0.10] rounded-md px-2.5 py-1.5 text-xs text-white/90 outline-none"
            />
          </div>
        </SettingsRow>
      </div>
    </div>
  );
};

export default AdvancedTab;
