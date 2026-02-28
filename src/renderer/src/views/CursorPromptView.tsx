/**
 * CursorPromptView.tsx
 *
 * UI for the inline AI cursor prompt (Command+K style).
 * Renders in two variants controlled by the `variant` prop:
 * - "inline": shown inside the main launcher window when no detached portal is available;
 *   shows "Applied in editor" confirmation, no Accept button needed
 * - "portal": rendered in the detached overlay window; shows "Ready to apply" with an
 *   Accept button that calls acceptCursorPrompt() to write the result to the editor
 *
 * State is managed by useCursorPrompt (hooks/useCursorPrompt.ts); this component is pure UI.
 * Rendered by App.tsx both as an inline fallback and as a portal child.
 */

import React from 'react';
import { X, Loader2, CornerDownLeft } from 'lucide-react';

interface CursorPromptViewProps {
  /** 'inline' = fallback in main window, 'portal' = rendered in detached portal */
  variant: 'inline' | 'portal';
  cursorPromptText: string;
  setCursorPromptText: (text: string) => void;
  cursorPromptStatus: string;
  cursorPromptResult: string;
  cursorPromptError: string;
  cursorPromptInputRef: React.RefObject<HTMLTextAreaElement>;
  aiAvailable: boolean;
  submitCursorPrompt: () => void;
  closeCursorPrompt: () => void;
  acceptCursorPrompt: () => void;
  /** Only used when variant='inline' */
  alwaysMountedRunners?: React.ReactNode;
}

export default function CursorPromptView({
  variant,
  cursorPromptText,
  setCursorPromptText,
  cursorPromptStatus,
  cursorPromptResult,
  cursorPromptError,
  cursorPromptInputRef,
  aiAvailable,
  submitCursorPrompt,
  closeCursorPrompt,
  acceptCursorPrompt,
  alwaysMountedRunners,
}: CursorPromptViewProps) {
  const isPortal = variant === 'portal';

  const promptContent = (
    <div className="w-full h-full p-1">
      <div className="cursor-prompt-surface h-full flex flex-col gap-1.5 px-3.5 py-2.5">
        <div className="cursor-prompt-topbar">
          <button
            onClick={() => void closeCursorPrompt()}
            className="cursor-prompt-close"
            aria-label="Close prompt"
            title="Close"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="flex-1 min-w-0">
          <textarea
            ref={cursorPromptInputRef}
            value={cursorPromptText}
            onChange={(e) => setCursorPromptText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void submitCursorPrompt();
              }
            }}
            placeholder="Tell AI what to do with selected text..."
            className="cursor-prompt-textarea w-full bg-transparent border-none outline-none text-white/95 placeholder-white/42 text-[13px] font-medium tracking-[0.003em]"
            autoFocus
          />
          {cursorPromptStatus === 'ready' && cursorPromptResult.trim() && (
            <div className="sr-only">{cursorPromptResult}</div>
          )}
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="cursor-prompt-feedback">
            {cursorPromptStatus === 'processing' && (
              <div className="cursor-prompt-inline-status">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Processing...</span>
              </div>
            )}
            {cursorPromptStatus === 'error' && cursorPromptError && (
              <div className="cursor-prompt-error">{cursorPromptError}</div>
            )}
            {cursorPromptStatus === 'ready' && cursorPromptResult.trim() && (
              <div className="cursor-prompt-success">
                {isPortal ? 'Ready to apply' : 'Applied in editor'}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {isPortal && cursorPromptStatus === 'ready' && cursorPromptResult.trim() && (
              <button
                onClick={() => void acceptCursorPrompt()}
                className="cursor-prompt-submit"
                title="Apply update"
              >
                Accept
              </button>
            )}
            <button
              onClick={() => void submitCursorPrompt()}
              className="cursor-prompt-submit"
              disabled={!cursorPromptText.trim() || cursorPromptStatus === 'processing' || !aiAvailable}
              title="Submit prompt"
            >
              <CornerDownLeft className="w-3 h-3" />
              <span>Enter</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  if (isPortal) {
    return promptContent;
  }

  return (
    <>
      {alwaysMountedRunners}
      {promptContent}
    </>
  );
}
