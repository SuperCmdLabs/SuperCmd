/**
 * ScriptCommandSetupView.tsx
 *
 * Argument collection form for Raycast-compatible script commands that declare required
 * or optional arguments (the `@argument` header fields in script metadata).
 * - Renders a form field for each declared argument (text, password, dropdown)
 * - Persists entered values to localStorage via getScriptCmdArgsKey so they are
 *   pre-filled on the next run
 * - "Continue" button is blocked while any required argument is empty
 * - Back arrow / Escape returns to the launcher without running the command
 *
 * Shown by App.tsx when scriptCommandSetup is non-null.
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
  const hasBlockingMissing = missing.length > 0;

  return (
    <>
      {alwaysMountedRunners}
      <div className="w-full h-full">
        <div className="glass-effect overflow-hidden h-full flex flex-col">
          <div className="flex items-center gap-2 px-5 py-3.5 border-b border-white/[0.06]">
            <button
              onClick={onBack}
              className="text-white/30 hover:text-white/60 transition-colors flex-shrink-0 p-0.5"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
            </button>
            <div className="text-white/85 text-[15px] font-medium truncate">
              Configure Script Command
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            <p className="text-sm text-white/55">Provide required arguments before running.</p>
            {defs.map((arg) => {
              const value = setup.values?.[arg.name];
              const argType = arg.type || 'text';
              return (
                <div key={`script-arg:${arg.name}`} className="space-y-1">
                  <label className="text-xs text-white/70 font-medium">
                    {arg.title || arg.placeholder || arg.name}
                    {arg.required ? <span className="text-red-400"> *</span> : null}
                  </label>
                  {argType === 'dropdown' ? (
                    <select
                      value={typeof value === 'string' ? value : ''}
                      onChange={(e) => {
                        const v = e.target.value;
                        setScriptCommandSetup((prev) => prev ? {
                          ...prev,
                          values: { ...prev.values, [arg.name]: v },
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
                        setScriptCommandSetup((prev) => prev ? {
                          ...prev,
                          values: { ...prev.values, [arg.name]: v },
                        } : prev);
                      }}
                      className="w-full bg-white/[0.05] border border-white/[0.1] rounded-md px-3 py-2 text-sm text-white/90 placeholder-white/30 outline-none"
                    />
                  )}
                </div>
              );
            })}
          </div>
          <div className="sc-glass-footer px-4 py-3.5 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                writeJsonObject(getScriptCmdArgsKey(command.id), setup.values || {});
                onContinue(command, setup.values || {});
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
