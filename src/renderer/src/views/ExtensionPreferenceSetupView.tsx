/**
 * ExtensionPreferenceSetupView.tsx
 *
 * Preference and argument collection form for Raycast-compatible extensions.
 * Shown when an extension is launched but has missing required preferences or
 * command arguments that must be filled before the extension can run.
 * - Renders fields for extension-level preferences (EXT_PREFS) and command-level
 *   preferences (CMD_PREFS), plus any required command arguments
 * - Also surfaces "critical" optional preferences that are strongly recommended
 * - Persists values to localStorage via persistExtensionPreferences / persistCommandArguments
 * - "Continue" fires onLaunchExtension or onLaunchMenuBar with the completed bundle
 * - Back arrow returns to the launcher without launching
 *
 * Shown by App.tsx when extensionPreferenceSetup is non-null.
 */

import React from 'react';
import type { ExtensionBundle } from '../../types/electron';
import type { ExtensionPreferenceSetup } from '../hooks/useAppViewManager';
import {
  getMissingRequiredPreferences,
  getMissingRequiredArguments,
  getUnsetCriticalPreferences,
  persistExtensionPreferences,
  persistCommandArguments,
} from '../utils/extension-preferences';

interface ExtensionPreferenceSetupViewProps {
  setup: ExtensionPreferenceSetup;
  alwaysMountedRunners: React.ReactNode;
  onBack: () => void;
  onLaunchExtension: (bundle: ExtensionBundle) => void;
  onLaunchMenuBar: (bundle: ExtensionBundle, action: 'toggle') => void;
  setExtensionPreferenceSetup: React.Dispatch<React.SetStateAction<ExtensionPreferenceSetup | null>>;
}

export default function ExtensionPreferenceSetupView({
  setup,
  alwaysMountedRunners,
  onBack,
  onLaunchExtension,
  onLaunchMenuBar,
  setExtensionPreferenceSetup,
}: ExtensionPreferenceSetupViewProps) {
  const bundle = setup.bundle;
  const defs = (bundle.preferenceDefinitions || []).filter((d) => d?.name);
  const argDefs = (bundle.commandArgumentDefinitions || []).filter((d) => d?.name);
  const missingPrefs = getMissingRequiredPreferences(bundle, setup.values);
  const missingArgs = getMissingRequiredArguments(bundle, setup.argumentValues);
  const criticalUnsetPrefs = getUnsetCriticalPreferences(bundle, setup.values);
  const hasBlockingMissing =
    missingPrefs.length > 0 ||
    missingArgs.length > 0;
  const displayName = (bundle as any).extensionDisplayName || bundle.extensionName || bundle.extName || 'Extension';

  return (
    <>
      {alwaysMountedRunners}
      <div className="w-full h-full">
        <div className="glass-effect overflow-hidden h-full flex flex-col">
          <div className="flex items-center gap-2 px-5 py-3.5 border-b border-white/[0.06]">
            <button
              onClick={() => {
                onBack();
              }}
              className="text-white/30 hover:text-white/60 transition-colors flex-shrink-0 p-0.5"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
            </button>
            <div className="text-white/85 text-[15px] font-medium truncate">
              Configure {displayName}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            <p className="text-sm text-white/55">Configure command inputs and preferences before running.</p>
            {criticalUnsetPrefs.length > 0 ? (
              <p className="text-xs text-amber-300/80">
                Some important preferences are empty: {criticalUnsetPrefs.map((p) => p.title || p.name).join(', ')}.
              </p>
            ) : null}
            {argDefs.length > 0 ? (
              <div className="space-y-3">
                <div className="text-xs uppercase tracking-wide text-white/35">Arguments</div>
                {argDefs.map((arg) => {
                  const value = setup.argumentValues?.[arg.name];
                  const argType = arg.type || 'text';
                  return (
                    <div key={`arg:${arg.name}`} className="space-y-1">
                      <label className="text-xs text-white/70 font-medium">
                        {arg.title || arg.name}
                        {arg.required ? <span className="text-red-400"> *</span> : null}
                      </label>
                      {argType === 'dropdown' ? (
                        <select
                          value={typeof value === 'string' ? value : ''}
                          onChange={(e) => {
                            const v = e.target.value;
                            setExtensionPreferenceSetup((prev) => prev ? {
                              ...prev,
                              argumentValues: { ...prev.argumentValues, [arg.name]: v },
                            } : prev);
                          }}
                          className="w-full bg-white/[0.05] border border-white/[0.1] rounded-md px-3 py-2 text-sm text-white/90 outline-none"
                        >
                          <option value="">Select an option</option>
                          {(arg.data || []).map((opt) => (
                            <option key={opt?.value || opt?.title} value={opt?.value || ''}>
                              {opt?.title || opt?.value || ''}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type={argType === 'password' ? 'password' : 'text'}
                          value={value ?? ''}
                          placeholder={arg.placeholder || ''}
                          onChange={(e) => {
                            const v = e.target.value;
                            setExtensionPreferenceSetup((prev) => prev ? {
                              ...prev,
                              argumentValues: { ...prev.argumentValues, [arg.name]: v },
                            } : prev);
                          }}
                          className="w-full bg-white/[0.05] border border-white/[0.1] rounded-md px-3 py-2 text-sm text-white/90 placeholder-white/30 outline-none"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            ) : null}
            {defs.length > 0 ? <div className="text-xs uppercase tracking-wide text-white/35">Preferences</div> : null}
            {defs.map((def) => {
              const value = setup.values?.[def.name];
              const type = def.type || 'textfield';
              return (
                <div key={`${def.scope}:${def.name}`} className="space-y-1">
                  <label className="text-xs text-white/70 font-medium">
                    {def.title || def.name}
                    {def.required ? <span className="text-red-400"> *</span> : null}
                  </label>
                  {type === 'checkbox' ? (
                    <label className="inline-flex items-center gap-2 text-sm text-white/80">
                      <input
                        type="checkbox"
                        checked={Boolean(value)}
                        onChange={(e) => {
                          setExtensionPreferenceSetup((prev) => prev ? {
                            ...prev,
                            values: { ...prev.values, [def.name]: e.target.checked },
                          } : prev);
                        }}
                      />
                      <span>Enabled</span>
                    </label>
                  ) : type === 'dropdown' ? (
                    <select
                      value={typeof value === 'string' ? value : ''}
                      onChange={(e) => {
                        const v = e.target.value;
                        setExtensionPreferenceSetup((prev) => prev ? {
                          ...prev,
                          values: { ...prev.values, [def.name]: v },
                        } : prev);
                      }}
                      className="w-full bg-white/[0.05] border border-white/[0.1] rounded-md px-3 py-2 text-sm text-white/90 outline-none"
                    >
                      <option value="">Select an option</option>
                      {(def.data || []).map((opt) => (
                        <option key={opt?.value || opt?.title} value={opt?.value || ''}>
                          {opt?.title || opt?.value || ''}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={type === 'password' ? 'password' : 'text'}
                      value={value ?? ''}
                      placeholder={def.placeholder || ''}
                      onChange={(e) => {
                        const v = e.target.value;
                        setExtensionPreferenceSetup((prev) => prev ? {
                          ...prev,
                          values: { ...prev.values, [def.name]: v },
                        } : prev);
                      }}
                      className="w-full bg-white/[0.05] border border-white/[0.1] rounded-md px-3 py-2 text-sm text-white/90 placeholder-white/30 outline-none"
                    />
                  )}
                  {def.description ? (
                    <p className="text-xs text-white/40">{def.description}</p>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div className="sc-glass-footer px-4 py-3.5 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                const extName = bundle.extName || bundle.extensionName || '';
                const cmdName = bundle.cmdName || bundle.commandName || '';
                if (!extName || !cmdName) return;
                persistExtensionPreferences(extName, cmdName, defs, setup.values);
                if (bundle.mode === 'no-view') {
                  persistCommandArguments(extName, cmdName, setup.argumentValues || {});
                }
                const updatedBundle: ExtensionBundle = {
                  ...bundle,
                  preferences: { ...(bundle.preferences || {}), ...(setup.values || {}) },
                  launchArguments: { ...((bundle as any).launchArguments || {}), ...(setup.argumentValues || {}) } as any,
                };

                if (updatedBundle.mode === 'menu-bar') {
                  onLaunchMenuBar(updatedBundle, 'toggle');
                  return;
                }

                onLaunchExtension(updatedBundle);
              }}
              disabled={hasBlockingMissing}
              className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                hasBlockingMissing
                  ? 'bg-white/[0.08] text-white/35 cursor-not-allowed'
                  : 'bg-white/[0.16] hover:bg-white/[0.22] text-white'
              }`}
            >
              Continue
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
