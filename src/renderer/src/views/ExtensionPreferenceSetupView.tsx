/**
 * ExtensionPreferenceSetupView.tsx
 *
 * Preference and argument collection form for Raycast-compatible extensions.
 * Shown when an extension is launched but has missing required preferences or
 * command arguments that must be filled before the extension can run.
 * - Renders only required/missing extension preferences and command arguments
 * - Persists values to localStorage via persistExtensionPreferences / persistCommandArguments
 * - "Continue" fires onLaunchExtension or onLaunchMenuBar with the completed bundle
 * - Back arrow returns to the launcher without launching
 */

import React from 'react';
import type { ExtensionBundle } from '../../types/electron';
import type { ExtensionPreferenceSetup } from '../hooks/useAppViewManager';
import {
  getMissingRequiredPreferences,
  getMissingRequiredArguments,
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
  // Keep all required fields visible while configuring so inputs don't disappear
  // as soon as the user types a value.
  const setupPrefs = defs.filter((def) => Boolean(def.required));
  const setupArgs = argDefs.filter((arg) => Boolean(arg.required));
  const hasBlockingMissing = missingPrefs.length > 0 || missingArgs.length > 0;
  const displayName = (bundle as any).extensionDisplayName || bundle.extensionName || bundle.extName || 'Extension';
  const handleContinue = () => {
    const extName = bundle.extName || bundle.extensionName || '';
    const cmdName = bundle.cmdName || bundle.commandName || '';
    if (!extName || !cmdName) return;
    persistExtensionPreferences(extName, cmdName, setupPrefs, setup.values);
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
  };

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter') return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (hasBlockingMissing) return;
      event.preventDefault();
      handleContinue();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hasBlockingMissing, handleContinue]);

  return (
    <>
      {alwaysMountedRunners}
      <div className="w-full h-full">
        <div className="glass-effect sc-command-setup-shell overflow-hidden h-full flex flex-col">
          <div className="flex h-[56px] items-center gap-2 px-4 border-b border-[var(--ui-divider)]">
            <button
              onClick={() => {
                onBack();
              }}
              className="text-[var(--text-subtle)] hover:text-[var(--text-secondary)] transition-colors flex-shrink-0 p-0.5"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
            </button>
            <div className="text-[var(--text-primary)] text-[15px] font-medium truncate">
              Configure {displayName}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3">
            <div className="max-w-[620px] w-full mx-auto space-y-3">
              <p className="text-[13px] text-[var(--text-muted)]">Add required settings before running this command.</p>
              {setupArgs.length > 0 ? (
                <div className="space-y-2.5">
                  <div className="text-[11px] uppercase tracking-wide text-[var(--text-subtle)]">Arguments</div>
                  {setupArgs.map((arg) => {
                    const value = setup.argumentValues?.[arg.name];
                    const argType = arg.type || 'text';
                    return (
                      <div key={`arg:${arg.name}`} className="space-y-1">
                        <label className="text-[12px] text-[var(--text-secondary)] font-medium">
                          {arg.title || arg.name}
                          {arg.required ? <span className="text-red-400"> *</span> : null}
                        </label>
                        {argType === 'dropdown' ? (
                          <select
                            value={typeof value === 'string' ? value : ''}
                            onChange={(e) => {
                              const v = e.target.value;
                              setExtensionPreferenceSetup((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      argumentValues: { ...prev.argumentValues, [arg.name]: v },
                                    }
                                  : prev
                              );
                            }}
                            className="w-full bg-[var(--ui-segment-bg)] border border-[var(--ui-segment-border)] rounded-md px-2.5 py-1.5 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--border-strong)]"
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
                              setExtensionPreferenceSetup((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      argumentValues: { ...prev.argumentValues, [arg.name]: v },
                                    }
                                  : prev
                              );
                            }}
                            className="w-full bg-[var(--ui-segment-bg)] border border-[var(--ui-segment-border)] rounded-md px-2.5 py-1.5 text-[13px] text-[var(--text-primary)] placeholder:text-[color:var(--text-subtle)] outline-none focus:border-[var(--border-strong)]"
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : null}

              {setupPrefs.length > 0 ? (
                <div className="text-[11px] uppercase tracking-wide text-[var(--text-subtle)]">Preferences</div>
              ) : null}
              {setupPrefs.map((def) => {
                const value = setup.values?.[def.name];
                const type = def.type || 'textfield';
                return (
                  <div key={`${def.scope}:${def.name}`} className="space-y-1">
                    <label className="text-[12px] text-[var(--text-secondary)] font-medium">
                      {def.title || def.name}
                      {def.required ? <span className="text-red-400"> *</span> : null}
                    </label>
                    {type === 'checkbox' ? (
                      <label className="inline-flex items-center gap-2 text-[13px] text-[var(--text-secondary)]">
                        <input
                          type="checkbox"
                          checked={Boolean(value)}
                          onChange={(e) => {
                            setExtensionPreferenceSetup((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    values: { ...prev.values, [def.name]: e.target.checked },
                                  }
                                : prev
                            );
                          }}
                        />
                        <span>Enabled</span>
                      </label>
                    ) : type === 'dropdown' ? (
                      <select
                        value={typeof value === 'string' ? value : ''}
                        onChange={(e) => {
                          const v = e.target.value;
                          setExtensionPreferenceSetup((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  values: { ...prev.values, [def.name]: v },
                                }
                              : prev
                          );
                        }}
                        className="w-full bg-[var(--ui-segment-bg)] border border-[var(--ui-segment-border)] rounded-md px-2.5 py-1.5 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--border-strong)]"
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
                          setExtensionPreferenceSetup((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  values: { ...prev.values, [def.name]: v },
                                }
                              : prev
                          );
                        }}
                        className="w-full bg-[var(--ui-segment-bg)] border border-[var(--ui-segment-border)] rounded-md px-2.5 py-1.5 text-[13px] text-[var(--text-primary)] placeholder:text-[color:var(--text-subtle)] outline-none focus:border-[var(--border-strong)]"
                      />
                    )}
                    {def.description ? <p className="text-[12px] text-[var(--text-subtle)]">{def.description}</p> : null}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="sc-glass-footer sc-launcher-footer flex items-center px-4 py-2.5">
            <div className="flex items-center gap-2 text-[var(--text-subtle)] text-xs flex-1 min-w-0 font-normal">
              {(bundle as any).extensionIconDataUrl ? (
                <img
                  src={(bundle as any).extensionIconDataUrl}
                  alt=""
                  className="w-4 h-4 rounded-sm object-contain flex-shrink-0"
                />
              ) : null}
              <span className="truncate">Configure {displayName}</span>
            </div>
            <button
              type="button"
              onClick={handleContinue}
              disabled={hasBlockingMissing}
              className={`flex items-center gap-2 transition-colors ${
                hasBlockingMissing
                  ? 'text-[var(--text-disabled)] cursor-not-allowed'
                  : 'text-[var(--text-primary)] hover:text-[var(--text-secondary)]'
              }`}
            >
              <span className="text-xs font-semibold">Continue</span>
              <kbd
                className={`inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded text-[11px] font-medium ${
                  hasBlockingMissing
                    ? 'bg-[var(--ui-segment-bg)] text-[var(--text-disabled)]'
                    : 'bg-[var(--kbd-bg)] text-[var(--text-subtle)]'
                }`}
              >
                ↩
              </kbd>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
