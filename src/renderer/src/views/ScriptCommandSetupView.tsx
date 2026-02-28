/**
 * ScriptCommandSetupView.tsx
 *
 * Argument collection form for Raycast-compatible script commands that declare required
 * or optional arguments (the `@argument` header fields in script metadata).
 * - Renders only required/missing arguments
 * - Persists entered values to localStorage via getScriptCmdArgsKey
 * - "Continue" button is blocked while any required argument is empty
 * - Back arrow / Escape returns to the launcher without running the command
 */

import React from 'react';
import type { ScriptCommandSetup } from '../hooks/useAppViewManager';
import { writeJsonObject, getScriptCmdArgsKey, getMissingRequiredScriptArguments } from '../utils/extension-preferences';
import type { CommandInfo } from '../../types/electron';

interface ScriptCommandSetupViewProps {
  setup: ScriptCommandSetup;
  alwaysMountedRunners: React.ReactNode;
  onBack: () => void;
  onContinue: (command: CommandInfo, values: Record<string, any>) => void;
  setScriptCommandSetup: React.Dispatch<React.SetStateAction<ScriptCommandSetup | null>>;
}

export default function ScriptCommandSetupView({
  setup,
  alwaysMountedRunners,
  onBack,
  onContinue,
  setScriptCommandSetup,
}: ScriptCommandSetupViewProps) {
  const command = setup.command;
  const defs = (command.commandArgumentDefinitions || []).filter((d) => d?.name);
  const missing = getMissingRequiredScriptArguments(command, setup.values);
  // Keep all required fields visible while configuring so filled fields don't disappear.
  const setupArgs = defs.filter((arg) => Boolean(arg.required));
  const hasBlockingMissing = missing.length > 0;
  const handleContinue = () => {
    writeJsonObject(getScriptCmdArgsKey(command.id), setup.values || {});
    onContinue(command, setup.values || {});
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
              onClick={onBack}
              className="text-[var(--text-subtle)] hover:text-[var(--text-secondary)] transition-colors flex-shrink-0 p-0.5"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
            </button>
            <div className="text-[var(--text-primary)] text-[15px] font-medium truncate">
              Configure Script Command
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3">
            <div className="max-w-[620px] w-full mx-auto space-y-3">
              <p className="text-[13px] text-[var(--text-muted)]">Provide required arguments before running.</p>
              {setupArgs.map((arg) => {
                const value = setup.values?.[arg.name];
                const argType = arg.type || 'text';
                return (
                  <div key={`script-arg:${arg.name}`} className="space-y-1">
                    <label className="text-[12px] text-[var(--text-secondary)] font-medium">
                      {arg.title || arg.placeholder || arg.name}
                      {arg.required ? <span className="text-red-400"> *</span> : null}
                    </label>
                    {argType === 'dropdown' ? (
                      <select
                        value={typeof value === 'string' ? value : ''}
                        onChange={(e) => {
                          const v = e.target.value;
                          setScriptCommandSetup((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  values: { ...prev.values, [arg.name]: v },
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
                          setScriptCommandSetup((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  values: { ...prev.values, [arg.name]: v },
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
          </div>
          <div className="sc-glass-footer sc-launcher-footer flex items-center px-4 py-2.5">
            <div className="flex items-center gap-2 text-[var(--text-subtle)] text-xs flex-1 min-w-0 font-normal">
              <span className="truncate">{command.title || 'Script Command'}</span>
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
