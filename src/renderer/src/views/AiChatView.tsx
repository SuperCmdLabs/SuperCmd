/**
 * AiChatView.tsx
 *
 * Full-screen AI chat panel shown when the launcher is in AI mode.
 * - Editable query input at the top (pre-filled with the search text that triggered AI mode)
 * - Streaming response area that auto-scrolls as chunks arrive
 * - Enter re-submits, Escape exits AI mode
 * - "Ask / Enter" button visible only when the input has content
 *
 * State is managed by useAiChat (hooks/useAiChat.ts); this component is pure UI.
 * Rendered by App.tsx when aiMode === true.
 */

import React from 'react';
import { X, Sparkles } from 'lucide-react';

interface AiChatViewProps {
  alwaysMountedRunners: React.ReactNode;
  aiQuery: string;
  setAiQuery: (query: string) => void;
  aiResponse: string;
  aiStreaming: boolean;
  aiInputRef: React.RefObject<HTMLInputElement>;
  aiResponseRef: React.RefObject<HTMLDivElement>;
  submitAiQuery: (query: string) => void;
  exitAiMode: () => void;
}

const AiChatView: React.FC<AiChatViewProps> = ({
  alwaysMountedRunners,
  aiQuery,
  setAiQuery,
  aiResponse,
  aiStreaming,
  aiInputRef,
  aiResponseRef,
  submitAiQuery,
  exitAiMode,
}) => {
  return (
    <>
      {alwaysMountedRunners}
      <div className="w-full h-full">
        <div className="glass-effect overflow-hidden h-full flex flex-col">
          {/* AI header — editable input */}
          <div className="flex items-center gap-3 px-5 py-3.5 border-b border-[var(--ui-divider)]">
            <Sparkles className="w-4 h-4 text-[var(--accent)] flex-shrink-0" />
            <input
              ref={aiInputRef}
              type="text"
              value={aiQuery}
              onChange={(e) => setAiQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && aiQuery.trim()) {
                  e.preventDefault();
                  submitAiQuery(aiQuery);
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  exitAiMode();
                }
              }}
              placeholder="Ask AI anything..."
              className="flex-1 bg-transparent border-none outline-none text-[var(--text-primary)] placeholder:text-[color:var(--text-muted)] text-[15px] font-light tracking-wide min-w-0"
              autoFocus
            />
            {aiQuery.trim() && (
              <button
                onClick={() => submitAiQuery(aiQuery)}
                className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-[var(--ui-segment-border)] bg-[var(--ui-segment-active-bg)] hover:bg-[var(--ui-segment-hover-bg)] transition-colors flex-shrink-0 group"
              >
                <span className="text-[11px] text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors">Ask</span>
                <kbd className="text-[10px] text-[var(--text-muted)] bg-[var(--kbd-bg)] px-1 py-0.5 rounded font-mono leading-none">Enter</kbd>
              </button>
            )}
            <button
              onClick={exitAiMode}
              className="text-[var(--text-subtle)] hover:text-[var(--text-muted)] transition-colors flex-shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* AI response */}
          <div
            ref={aiResponseRef}
            className="flex-1 overflow-y-auto custom-scrollbar p-5"
          >
            {aiResponse ? (
              <div className="text-[var(--text-primary)] text-sm leading-relaxed whitespace-pre-wrap font-normal">
                {aiResponse}
              </div>
            ) : aiStreaming ? (
              <div className="flex items-center gap-2 text-[var(--text-muted)] text-sm">
                <div className="flex gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse" style={{ animationDelay: '0.2s' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse" style={{ animationDelay: '0.4s' }} />
                </div>
                Thinking...
              </div>
            ) : null}
          </div>

          {/* Footer */}
          <div className="sc-glass-footer px-4 py-2.5 flex items-center justify-between text-xs text-[var(--text-subtle)] font-normal">
            <span>{aiStreaming ? 'Streaming...' : 'AI Response'}</span>
            <div className="flex items-center gap-2">
              <kbd className="text-[10px] text-[var(--text-muted)] bg-[var(--kbd-bg)] px-1.5 py-0.5 rounded font-mono">Enter</kbd>
              <span className="text-[10px] text-[var(--text-muted)]">Ask</span>
              <kbd className="text-[10px] text-[var(--text-muted)] bg-[var(--kbd-bg)] px-1.5 py-0.5 rounded font-mono">Esc</kbd>
              <span className="text-[10px] text-[var(--text-muted)]">Back</span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default AiChatView;
