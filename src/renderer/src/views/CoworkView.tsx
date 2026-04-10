/**
 * CoworkView.tsx
 *
 * Local AI code assistant panel — multi-turn conversation with Gemma via Ollama.
 * - Conversation history displayed as a message list (user / assistant bubbles)
 * - Input at the bottom; Enter submits, Shift+Enter inserts newline
 * - Escape exits, Cmd+K clears conversation
 * - Streaming indicator while the model is responding
 *
 * State is managed by useCowork (hooks/useCowork.ts); this component is pure UI.
 * Rendered by App.tsx when showCowork === true.
 */

import React from 'react';
import { X, Terminal, Trash2 } from 'lucide-react';
import type { CoworkMessage } from '../hooks/useCowork';

interface CoworkViewProps {
  alwaysMountedRunners: React.ReactNode;
  messages: CoworkMessage[];
  currentInput: string;
  setCurrentInput: (value: string) => void;
  isStreaming: boolean;
  inputRef: React.RefObject<HTMLInputElement>;
  messagesEndRef: React.RefObject<HTMLDivElement>;
  submitMessage: (text: string) => void;
  clearConversation: () => void;
  exitCowork: () => void;
}

const CoworkView: React.FC<CoworkViewProps> = ({
  alwaysMountedRunners,
  messages,
  currentInput,
  setCurrentInput,
  isStreaming,
  inputRef,
  messagesEndRef,
  submitMessage,
  clearConversation,
  exitCowork,
}) => {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (currentInput.trim() && !isStreaming) {
        submitMessage(currentInput);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      exitCowork();
    } else if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      clearConversation();
    }
  };

  return (
    <>
      {alwaysMountedRunners}
      <div className="w-full h-full">
        <div className="glass-effect overflow-hidden h-full flex flex-col">

          {/* Header */}
          <div className="flex items-center gap-3 px-5 py-3.5 border-b border-[var(--ui-divider)] flex-shrink-0">
            <Terminal className="w-4 h-4 text-[var(--accent)] flex-shrink-0" />
            <span className="flex-1 text-[var(--text-primary)] text-[15px] font-light tracking-wide">
              Cowork
              <span className="ml-2 text-[11px] text-[var(--text-muted)] font-normal">local AI</span>
            </span>
            {messages.length > 0 && (
              <button
                onClick={clearConversation}
                title="Clear conversation (⌘K)"
                className="text-[var(--text-subtle)] hover:text-[var(--text-muted)] transition-colors flex-shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              onClick={exitCowork}
              className="text-[var(--text-subtle)] hover:text-[var(--text-muted)] transition-colors flex-shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto custom-scrollbar p-4 flex flex-col gap-4">
            {messages.length === 0 && !isStreaming && (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
                <Terminal className="w-8 h-8 text-[var(--text-subtle)]" />
                <p className="text-[var(--text-muted)] text-sm">Ask anything — code, shell commands, debugging</p>
                <p className="text-[var(--text-subtle)] text-xs">Powered by local Ollama model</p>
              </div>
            )}

            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex flex-col gap-1 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
              >
                <span className="text-[10px] text-[var(--text-subtle)] px-1">
                  {msg.role === 'user' ? 'You' : 'Gemma'}
                </span>
                <div
                  className={`max-w-[85%] px-3 py-2 rounded-lg text-sm leading-relaxed whitespace-pre-wrap font-normal ${
                    msg.role === 'user'
                      ? 'bg-[var(--accent)] text-white rounded-tr-sm'
                      : 'bg-[var(--ui-segment-active-bg)] text-[var(--text-primary)] rounded-tl-sm'
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}

            {isStreaming && messages[messages.length - 1]?.role !== 'assistant' && (
              <div className="flex flex-col gap-1 items-start">
                <span className="text-[10px] text-[var(--text-subtle)] px-1">Gemma</span>
                <div className="bg-[var(--ui-segment-active-bg)] px-3 py-2 rounded-lg rounded-tl-sm">
                  <div className="flex gap-1 items-center">
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse" style={{ animationDelay: '0.2s' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse" style={{ animationDelay: '0.4s' }} />
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="border-t border-[var(--ui-divider)] px-4 py-3 flex-shrink-0">
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                type="text"
                value={currentInput}
                onChange={(e) => setCurrentInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={isStreaming ? 'Responding...' : 'Ask a coding question...'}
                disabled={isStreaming}
                className="flex-1 bg-transparent border-none outline-none text-[var(--text-primary)] placeholder:text-[color:var(--text-muted)] text-sm min-w-0 disabled:opacity-50"
                autoFocus
              />
              {currentInput.trim() && !isStreaming && (
                <button
                  onClick={() => submitMessage(currentInput)}
                  className="flex items-center gap-1 px-2 py-1 rounded-md border border-[var(--ui-segment-border)] bg-[var(--ui-segment-active-bg)] hover:bg-[var(--ui-segment-hover-bg)] transition-colors flex-shrink-0"
                >
                  <kbd className="text-[10px] text-[var(--text-muted)] font-mono leading-none">↵</kbd>
                </button>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="sc-glass-footer px-4 py-2 flex items-center justify-between text-xs text-[var(--text-subtle)] flex-shrink-0">
            <span>{isStreaming ? 'Streaming...' : `${messages.length} message${messages.length !== 1 ? 's' : ''}`}</span>
            <div className="flex items-center gap-2">
              <kbd className="text-[10px] text-[var(--text-muted)] bg-[var(--kbd-bg)] px-1.5 py-0.5 rounded font-mono">⌘K</kbd>
              <span className="text-[10px] text-[var(--text-muted)]">Clear</span>
              <kbd className="text-[10px] text-[var(--text-muted)] bg-[var(--kbd-bg)] px-1.5 py-0.5 rounded font-mono">Esc</kbd>
              <span className="text-[10px] text-[var(--text-muted)]">Back</span>
            </div>
          </div>

        </div>
      </div>
    </>
  );
};

export default CoworkView;
