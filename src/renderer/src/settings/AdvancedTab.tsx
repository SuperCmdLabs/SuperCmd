/**
 * Advanced Settings Tab
 *
 * Hyper Key configuration — remaps a chosen key to the four-modifier
 * combination Control + Option + Command + Shift, system-wide.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Zap, Info, AlertCircle, CheckCircle } from 'lucide-react';
import type { AppSettings, HyperKeyTrigger } from '../../types/electron';

const TRIGGER_KEY_OPTIONS: { value: HyperKeyTrigger; label: string }[] = [
  { value: 'caps_lock',     label: 'Caps Lock' },
  { value: 'left_control',  label: 'Left Control ⌃' },
  { value: 'right_control', label: 'Right Control ⌃' },
  { value: 'left_shift',    label: 'Left Shift ⇧' },
  { value: 'right_shift',   label: 'Right Shift ⇧' },
  { value: 'left_option',   label: 'Left Option ⌥' },
  { value: 'right_option',  label: 'Right Option ⌥' },
  { value: 'left_command',  label: 'Left Command ⌘' },
  { value: 'right_command', label: 'Right Command ⌘' },
];

const AdvancedTab: React.FC = () => {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [status, setStatus] = useState<{ running: boolean; error?: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    window.electron.getSettings().then(setSettings);
    window.electron.getHyperKeyStatus().then(setStatus);
    const dispose = window.electron.onHyperKeyStatus((payload) => {
      setStatus(payload);
    });
    return dispose;
  }, []);

  const applyChange = useCallback(
    async (patch: Partial<AppSettings['hyperKey']>) => {
      if (!settings) return;
      const next = { ...settings.hyperKey, ...patch };
      setSettings((prev) => prev ? { ...prev, hyperKey: next } : prev);
      setSaving(true);
      try {
        await window.electron.updateHyperKeySettings(next);
      } finally {
        setSaving(false);
      }
    },
    [settings]
  );

  if (!settings) {
    return <div className="p-8 text-white/50 text-sm">Loading settings...</div>;
  }

  const hk = settings.hyperKey;
  const isCapsLock = hk.triggerKey === 'caps_lock';

  return (
    <div className="p-4 w-full max-w-5xl space-y-4">
      <h2 className="text-xl font-semibold text-white">Advanced</h2>

      {/* ── Hyper Key card ───────────────────────────────────────────── */}
      <div className="bg-white/[0.03] rounded-xl border border-white/[0.06] p-6 space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-cyan-400" />
            <h3 className="text-base font-semibold text-white/95">Hyper Key</h3>
          </div>
          {/* Status badge */}
          {hk.enabled && (
            <span
              className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border ${
                status?.error
                  ? 'border-red-500/40 text-red-300 bg-red-500/10'
                  : status?.running
                  ? 'border-emerald-500/40 text-emerald-300 bg-emerald-500/10'
                  : 'border-white/20 text-white/50 bg-white/[0.04]'
              }`}
            >
              {status?.error ? (
                <AlertCircle className="w-3 h-3" />
              ) : status?.running ? (
                <CheckCircle className="w-3 h-3" />
              ) : (
                <span className="w-2 h-2 rounded-full bg-white/30" />
              )}
              {status?.error ? 'Error' : status?.running ? 'Active' : 'Starting…'}
            </span>
          )}
        </div>

        <p className="text-sm text-white/50 -mt-2">
          Remap a key to simultaneously trigger{' '}
          <span className="text-white/75 font-mono">⌃ ⌥ ⌘ ⇧</span> — the
          "Hyper" modifier combination — giving you a dedicated namespace for
          system-wide shortcuts in any app.
        </p>

        {/* Enable toggle */}
        <label className="flex items-center gap-3 cursor-pointer select-none w-fit">
          <div
            onClick={() => applyChange({ enabled: !hk.enabled })}
            className={`relative w-10 h-5.5 rounded-full transition-colors cursor-pointer ${
              hk.enabled ? 'bg-cyan-500' : 'bg-white/20'
            }`}
            style={{ width: 40, height: 22 }}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-4.5 h-4.5 rounded-full bg-white shadow transition-transform duration-200 ${
                hk.enabled ? 'translate-x-[18px]' : 'translate-x-0'
              }`}
              style={{ width: 18, height: 18 }}
            />
          </div>
          <span className="text-sm text-white/80">
            {hk.enabled ? 'Enabled' : 'Disabled'}
          </span>
          {saving && <span className="text-xs text-white/40">Saving…</span>}
        </label>

        {/* Options — only shown when enabled */}
        {hk.enabled && (
          <div className="space-y-4 pt-1 border-t border-white/[0.06]">
            {/* Trigger key selector */}
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm text-white/85 font-medium">Trigger Key</p>
                <p className="text-xs text-white/45 mt-0.5">
                  The key that activates the Hyper combination when held.
                </p>
              </div>
              <select
                value={hk.triggerKey}
                onChange={(e) =>
                  applyChange({ triggerKey: e.target.value as HyperKeyTrigger })
                }
                className="bg-white/[0.06] border border-white/[0.12] text-white text-sm rounded-lg px-3 py-1.5 outline-none focus:border-cyan-500/60 cursor-pointer min-w-[160px]"
              >
                {TRIGGER_KEY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value} className="bg-neutral-900">
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Preserve original (only relevant for Caps Lock) */}
            {isCapsLock && (
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm text-white/85 font-medium">
                    Caps Lock with quick press
                  </p>
                  <p className="text-xs text-white/45 mt-0.5">
                    A quick tap still toggles Caps Lock. Holding activates Hyper.
                  </p>
                </div>
                <label className="flex items-center gap-2 cursor-pointer mt-0.5">
                  <input
                    type="checkbox"
                    checked={hk.preserveOriginal}
                    onChange={(e) => applyChange({ preserveOriginal: e.target.checked })}
                    className="accent-cyan-400 w-4 h-4"
                  />
                  <span className="text-sm text-white/70">Enable</span>
                </label>
              </div>
            )}

            {/* Error message */}
            {status?.error && (
              <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3">
                <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                <p className="text-xs text-red-300 leading-relaxed">{status.error}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Info card ────────────────────────────────────────────────── */}
      <div className="bg-white/[0.02] rounded-xl border border-white/[0.05] p-5 space-y-2">
        <div className="flex items-center gap-2 text-white/50">
          <Info className="w-4 h-4" />
          <h4 className="text-sm font-medium">How it works</h4>
        </div>
        <ul className="text-xs text-white/40 space-y-1.5 pl-1 list-disc list-inside">
          <li>
            Your chosen key is intercepted system-wide and replaced with
            <span className="text-white/60 font-mono"> ⌃ ⌥ ⌘ ⇧</span>.
          </li>
          <li>
            Use <span className="text-white/60 font-mono">Hyper + any key</span> as a
            unique shortcut in any application.
          </li>
          <li>
            Requires <strong className="text-white/60">Accessibility</strong> permission
            — grant it in System Settings → Privacy &amp; Security → Accessibility.
          </li>
          <li>
            Disable other remapping tools (Karabiner-Elements, Hyperkey app) to avoid
            conflicts.
          </li>
        </ul>
      </div>
    </div>
  );
};

export default AdvancedTab;
