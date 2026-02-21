/**
 * AgentChatView.tsx
 *
 * Full-screen agent chat panel. Shows structured conversation with:
 * - User messages
 * - Agent thinking, tool calls, tool results
 * - Confirmation dialogs for dangerous actions
 * - Final answer text
 *
 * Replaces AiChatView when agent mode is enabled.
 */

import React, { useState } from 'react';
import {
  X,
  Sparkles,
  Terminal,
  FileText,
  Clipboard,
  Globe,
  Brain,
  AppWindow,
  ChevronDown,
  ChevronRight,
  Check,
  XCircle,
  Shield,
  Loader2,
} from 'lucide-react';
import type { AgentStep, AgentConversationTurn, UseAgentChatReturn } from '../hooks/useAgentChat';

// ─── Tool icon mapping ──────────────────────────────────────────────

const TOOL_ICONS: Record<string, React.ReactNode> = {
  exec_command: <Terminal className="w-3.5 h-3.5" />,
  run_applescript: <Terminal className="w-3.5 h-3.5" />,
  read_file: <FileText className="w-3.5 h-3.5" />,
  write_file: <FileText className="w-3.5 h-3.5" />,
  create_directory: <FileText className="w-3.5 h-3.5" />,
  copy_path: <FileText className="w-3.5 h-3.5" />,
  move_path: <FileText className="w-3.5 h-3.5" />,
  rename_path: <FileText className="w-3.5 h-3.5" />,
  delete_path: <FileText className="w-3.5 h-3.5" />,
  read_dir: <FileText className="w-3.5 h-3.5" />,
  path_info: <FileText className="w-3.5 h-3.5" />,
  find_paths: <FileText className="w-3.5 h-3.5" />,
  search_file_content: <FileText className="w-3.5 h-3.5" />,
  replace_in_file: <FileText className="w-3.5 h-3.5" />,
  top_largest_entries: <FileText className="w-3.5 h-3.5" />,
  clipboard_read: <Clipboard className="w-3.5 h-3.5" />,
  clipboard_write: <Clipboard className="w-3.5 h-3.5" />,
  http_request: <Globe className="w-3.5 h-3.5" />,
  memory_search: <Brain className="w-3.5 h-3.5" />,
  memory_add: <Brain className="w-3.5 h-3.5" />,
  get_frontmost_application: <AppWindow className="w-3.5 h-3.5" />,
  get_applications: <AppWindow className="w-3.5 h-3.5" />,
};

function getToolIcon(name: string): React.ReactNode {
  return TOOL_ICONS[name] || <Terminal className="w-3.5 h-3.5" />;
}

function formatToolName(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Collapsible Section ────────────────────────────────────────────

const Collapsible: React.FC<{
  label: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}> = ({ label, defaultOpen = false, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-[10px] text-white/30 hover:text-white/50 transition-colors"
      >
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        {label}
      </button>
      {open && <div className="mt-1">{children}</div>}
    </div>
  );
};

// ─── Tool Call Card ─────────────────────────────────────────────────

const ToolCallCard: React.FC<{ step: AgentStep; isRunning: boolean }> = ({ step, isRunning }) => {
  const tc = step.toolCall;
  if (!tc) return null;

  // Find matching result in parent — we render inline
  return (
    <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="text-purple-400/70">{getToolIcon(tc.name)}</span>
        <span className="text-[12px] text-white/70 font-medium flex-1">
          {formatToolName(tc.name)}
        </span>
        {tc.dangerous && (
          <span className="text-[9px] text-amber-400/60 bg-amber-400/10 px-1.5 py-0.5 rounded-full flex items-center gap-1">
            <Shield className="w-2.5 h-2.5" />
            Requires approval
          </span>
        )}
      </div>
      {Object.keys(tc.args).length > 0 && (
        <div className="px-3 pb-2">
          <Collapsible label="Arguments">
            <pre className="text-[10px] text-white/40 bg-white/[0.02] rounded p-2 overflow-x-auto max-h-[120px] overflow-y-auto custom-scrollbar">
              {JSON.stringify(tc.args, null, 2)}
            </pre>
          </Collapsible>
        </div>
      )}
    </div>
  );
};

// ─── Tool Result Card ───────────────────────────────────────────────

const ToolResultCard: React.FC<{ step: AgentStep }> = ({ step }) => {
  const tr = step.toolResult;
  if (!tr) return null;

  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.01] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <span className="text-purple-400/50">{getToolIcon(tr.name)}</span>
        {tr.success ? (
          <Check className="w-3 h-3 text-green-400/70" />
        ) : (
          <XCircle className="w-3 h-3 text-red-400/70" />
        )}
        <span className="text-[11px] text-white/50 flex-1">
          {formatToolName(tr.name)}
        </span>
        <span className="text-[9px] text-white/20">{tr.durationMs}ms</span>
      </div>
      <div className="px-3 pb-2">
        <Collapsible label={`Output (${tr.output.length} chars)`} defaultOpen={true}>
          <pre className="text-[10px] text-white/40 bg-white/[0.02] rounded p-2 overflow-x-auto max-h-[200px] overflow-y-auto custom-scrollbar whitespace-pre-wrap">
            {tr.output}
          </pre>
        </Collapsible>
      </div>
    </div>
  );
};

// ─── Confirmation Dialog ────────────────────────────────────────────

const ConfirmationDialog: React.FC<{
  confirmation: NonNullable<UseAgentChatReturn['pendingConfirmation']>;
  onConfirm: (toolCallId: string, approved: boolean) => void;
}> = ({ confirmation, onConfirm }) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="rounded-xl border border-white/[0.12] bg-[rgba(28,28,30,0.95)] shadow-2xl max-w-md w-full mx-4 overflow-hidden">
        <div className="px-5 pt-5 pb-3">
          <div className="flex items-center gap-2 mb-3">
            <Shield className="w-5 h-5 text-amber-400" />
            <h3 className="text-[14px] font-semibold text-white/90">
              Action Requires Approval
            </h3>
          </div>
          <p className="text-[12px] text-white/60 leading-relaxed whitespace-pre-wrap">
            {confirmation.message}
          </p>
        </div>
        <div className="flex items-center gap-2 px-5 py-4 border-t border-white/[0.08]">
          <button
            onClick={() => onConfirm(confirmation.toolCallId, true)}
            className="flex-1 px-4 py-2 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 text-[12px] font-medium transition-colors"
          >
            Allow
          </button>
          <button
            onClick={() => onConfirm(confirmation.toolCallId, false)}
            className="flex-1 px-4 py-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.10] text-white/60 text-[12px] font-medium transition-colors"
          >
            Deny
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Step Renderer ──────────────────────────────────────────────────

const StepRenderer: React.FC<{ step: AgentStep; isRunning: boolean }> = ({ step, isRunning }) => {
  switch (step.type) {
    case 'thinking':
      return (
        <div className="text-[11px] text-white/30 italic leading-relaxed">
          {step.text}
        </div>
      );
    case 'status':
      return (
        <div className="flex items-center gap-2 text-[11px] text-white/30">
          {isRunning && <Loader2 className="w-3 h-3 animate-spin text-purple-400/50" />}
          {step.text}
        </div>
      );
    case 'tool_call':
      return <ToolCallCard step={step} isRunning={isRunning} />;
    case 'tool_result':
      return <ToolResultCard step={step} />;
    case 'error':
      return (
        <div className="rounded-lg border border-red-400/[0.10] bg-red-400/[0.06] overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2.5">
            <XCircle className="w-3.5 h-3.5 text-red-400/70 flex-shrink-0" />
            <span className="text-[12px] text-red-400/80 flex-1">
              {step.text}
            </span>
          </div>
        </div>
      );
    default:
      return null;
  }
};

// ─── Conversation Turn ──────────────────────────────────────────────

const TurnRenderer: React.FC<{
  turn: AgentConversationTurn;
  isRunning: boolean;
  isLast: boolean;
  onRetry?: () => void;
}> = ({ turn, isRunning, isLast, onRetry }) => {
  if (turn.role === 'user') {
    return (
      <div className="flex justify-end mb-3">
        <div className="bg-purple-500/15 rounded-xl rounded-br-sm px-4 py-2.5 max-w-[85%]">
          <p className="text-[13px] text-white/80 leading-relaxed">{turn.query}</p>
        </div>
      </div>
    );
  }

  // Assistant turn
  const showRunningIndicator = isLast && isRunning && turn.steps.length === 0;
  const hasError = turn.steps.some((s) => s.type === 'error');
  const showRetry = isLast && !isRunning && hasError && !turn.finalAnswer && onRetry;

  return (
    <div className="mb-4">
      {/* Steps */}
      {turn.steps.length > 0 && (
        <div className="flex flex-col gap-2 mb-2">
          {turn.steps.map((step, i) => (
            <StepRenderer
              key={i}
              step={step}
              isRunning={isLast && isRunning && i === turn.steps.length - 1}
            />
          ))}
        </div>
      )}

      {/* Retry button when ended with error */}
      {showRetry && (
        <button
          onClick={onRetry}
          className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-500/10 hover:bg-purple-500/20 text-purple-400/70 hover:text-purple-400 text-[11px] font-medium transition-colors"
        >
          Try again
        </button>
      )}

      {/* Thinking indicator */}
      {showRunningIndicator && (
        <div className="flex items-center gap-2 text-white/40 text-sm">
          <div className="flex gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-400/60 animate-pulse" />
            <span className="w-1.5 h-1.5 rounded-full bg-purple-400/60 animate-pulse" style={{ animationDelay: '0.2s' }} />
            <span className="w-1.5 h-1.5 rounded-full bg-purple-400/60 animate-pulse" style={{ animationDelay: '0.4s' }} />
          </div>
          Thinking...
        </div>
      )}

      {/* Final answer */}
      {turn.finalAnswer && (
        <div className="text-white/80 text-[13px] leading-relaxed whitespace-pre-wrap font-light mt-2">
          {turn.finalAnswer}
        </div>
      )}
    </div>
  );
};

// ─── Main View ──────────────────────────────────────────────────────

interface AgentChatViewProps {
  alwaysMountedRunners: React.ReactNode;
  conversation: AgentConversationTurn[];
  isRunning: boolean;
  pendingConfirmation: UseAgentChatReturn['pendingConfirmation'];
  agentQuery: string;
  setAgentQuery: (value: string) => void;
  submitQuery: (query: string) => void;
  confirmTool: (toolCallId: string, approved: boolean) => void;
  cancelAgent: () => void;
  exitAgentMode: () => void;
  inputRef: React.RefObject<HTMLInputElement>;
  scrollRef: React.RefObject<HTMLDivElement>;
}

const AgentChatView: React.FC<AgentChatViewProps> = ({
  alwaysMountedRunners,
  conversation,
  isRunning,
  pendingConfirmation,
  agentQuery,
  setAgentQuery,
  submitQuery,
  confirmTool,
  cancelAgent,
  exitAgentMode,
  inputRef,
  scrollRef,
}) => {
  const [inputValue, setInputValue] = useState('');

  const handleSubmit = () => {
    const query = inputValue.trim();
    if (!query) return;
    submitQuery(query);
    setInputValue('');
  };

  return (
    <>
      {alwaysMountedRunners}
      <div className="w-full h-full">
        <div className="glass-effect overflow-hidden h-full flex flex-col">
          {/* Header */}
          <div className="flex items-center gap-3 px-5 py-3.5 border-b border-white/[0.06]">
            <div className="flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-purple-400 flex-shrink-0" />
              <span className="text-[10px] text-purple-400/60 font-medium uppercase tracking-wider">Agent</span>
            </div>
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && inputValue.trim()) {
                  e.preventDefault();
                  handleSubmit();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  if (isRunning) {
                    window.electron.agentCancel(`agent-${Date.now()}`);
                  } else {
                    exitAgentMode();
                  }
                }
              }}
              placeholder={conversation.length === 0 ? 'Ask the agent to do something...' : 'Follow up...'}
              className="flex-1 bg-transparent border-none outline-none text-white/90 placeholder-white/30 text-[15px] font-light tracking-wide min-w-0"
              autoFocus
              disabled={isRunning}
            />
            {inputValue.trim() && !isRunning && (
              <button
                onClick={handleSubmit}
                className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-purple-500/15 hover:bg-purple-500/25 transition-colors flex-shrink-0 group"
              >
                <span className="text-[11px] text-purple-400/70 group-hover:text-purple-400 transition-colors">Run</span>
                <kbd className="text-[10px] text-purple-400/40 bg-purple-500/10 px-1 py-0.5 rounded font-mono leading-none">Enter</kbd>
              </button>
            )}
            {isRunning && (
              <button
                onClick={cancelAgent}
                className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-red-500/10 hover:bg-red-500/20 transition-colors flex-shrink-0"
              >
                <span className="text-[11px] text-red-400/70">Stop</span>
              </button>
            )}
            <button
              onClick={exitAgentMode}
              className="text-white/30 hover:text-white/60 transition-colors flex-shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Conversation */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto custom-scrollbar p-5"
          >
            {conversation.length === 0 && !isRunning ? (
              <div className="flex flex-col items-center justify-center h-full text-white/20">
                <Sparkles className="w-8 h-8 mb-3 text-purple-400/30" />
                <p className="text-[13px]">Ask the agent to help with anything</p>
                <p className="text-[11px] mt-1 text-white/15">
                  It can run commands, read/write files, fetch URLs, and more
                </p>
              </div>
            ) : (
              conversation.map((turn, i) => {
                // Find the user query for this turn (previous user turn)
                const prevUserTurn = i > 0 && conversation[i - 1]?.role === 'user'
                  ? conversation[i - 1]
                  : null;
                return (
                  <TurnRenderer
                    key={i}
                    turn={turn}
                    isRunning={isRunning}
                    isLast={i === conversation.length - 1}
                    onRetry={
                      turn.role === 'assistant' && prevUserTurn?.query
                        ? () => submitQuery(prevUserTurn.query!)
                        : undefined
                    }
                  />
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="sc-glass-footer px-4 py-3.5 flex items-center justify-between text-xs text-white/40 font-medium">
            <span>
              {isRunning
                ? 'Agent working...'
                : conversation.length > 0
                  ? 'Agent ready'
                  : 'SuperCmd Agent'}
            </span>
            <div className="flex items-center gap-2">
              <kbd className="text-[10px] text-white/20 bg-white/[0.06] px-1.5 py-0.5 rounded font-mono">Enter</kbd>
              <span className="text-[10px] text-white/20">Send</span>
              <kbd className="text-[10px] text-white/20 bg-white/[0.06] px-1.5 py-0.5 rounded font-mono">Esc</kbd>
              <span className="text-[10px] text-white/20">{isRunning ? 'Stop' : 'Back'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Confirmation overlay */}
      {pendingConfirmation && (
        <ConfirmationDialog
          confirmation={pendingConfirmation}
          onConfirm={confirmTool}
        />
      )}
    </>
  );
};

export default AgentChatView;
