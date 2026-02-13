/**
 * ScriptCommandOutputView.tsx
 *
 * Read-only output viewer for script commands that run in "inline" mode (output
 * rendered directly in the launcher rather than in a terminal or notification).
 * - Displays stdout / stderr from the completed script run
 * - Shows exit code for non-zero results
 * - Back arrow / Escape returns to the launcher
 *
 * Shown by App.tsx when scriptCommandOutput is non-null.
 */

import React from 'react';
import type { ScriptCommandOutput } from '../hooks/useAppViewManager';

interface ScriptCommandOutputViewProps {
  output: ScriptCommandOutput;
  alwaysMountedRunners: React.ReactNode;
  onBack: () => void;
}

const ScriptCommandOutputView: React.FC<ScriptCommandOutputViewProps> = ({
  output,
  alwaysMountedRunners,
  onBack,
}) => {
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
              {output.command.title}
            </div>
            <div className={`ml-auto text-[11px] font-semibold ${output.exitCode === 0 ? 'text-emerald-300/80' : 'text-red-300/80'}`}>
              {output.exitCode === 0 ? 'Success' : `Exit ${output.exitCode}`}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-5">
            <pre className="text-xs leading-relaxed text-white/80 whitespace-pre-wrap break-words font-mono">
              {output.output || '(No output)'}
            </pre>
          </div>
        </div>
      </div>
    </>
  );
};

export default ScriptCommandOutputView;
