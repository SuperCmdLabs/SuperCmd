/**
 * Agent Runtime — the autonomous agent loop.
 *
 * Reason → call tools → observe results → repeat until done.
 * Sends structured AgentEvent messages to the renderer for live UI updates.
 */

import * as os from 'os';
import type { AISettings } from '../settings-store';
import { loadSettings } from '../settings-store';
import { addMemory, buildMemoryContextSystemPrompt } from '../memory';
import type { AgentEvent, AgentMessage, AgentSettings } from './types';
import { TOOL_DEFINITIONS } from './tool-definitions';
import { chatCompletionWithTools } from './chat-completion';
import { executeAgentTool } from './tool-executor';

// ─── Options ────────────────────────────────────────────────────────

export interface AgentLoopOptions {
  requestId: string;
  prompt: string;
  aiConfig: AISettings;
  agentSettings: AgentSettings;
  signal: AbortSignal;
  sendEvent: (event: AgentEvent) => void;
  waitForConfirmation: (toolCallId: string) => Promise<boolean>;
  conversationHistory?: AgentMessage[];
  emitTerminalErrorEvent?: boolean;
}

export interface AgentLoopResult {
  status: 'done' | 'error' | 'cancelled';
  steps: number;
  error?: string;
}

// ─── Default System Prompt ──────────────────────────────────────────

function buildDefaultPersonality(): string {
  const home = os.homedir();
  const user = os.userInfo().username;
  return `You are SuperCmd Agent, an AI assistant built into a macOS launcher app.
You help users accomplish tasks on their computer using the available tools.

RULES:
1. Be EFFICIENT — complete tasks in as few tool calls as possible.
2. Prefer dedicated filesystem tools for file tasks:
   - top_largest_entries for "what is taking space" questions
   - path_info for metadata/size checks on a path
   - find_paths for locating files/folders by name
   - copy_path, move_path, rename_path, delete_path, create_directory for organizing/cleanup
   - search_file_content and replace_in_file for text refactors
   - read_dir for basic listing
   Use exec_command only when those tools cannot do the task.
3. When a task is complete, ALWAYS include the actual data/results in your final answer. Never just say "I listed the files" — show the files. Present results in a clean, readable format.
4. If a tool call fails or is denied, adapt or ask for guidance.
5. Be concise. No unnecessary commentary.

IMPORTANT context about this user's system:
- Home directory: ${home}
- Username: ${user}
- OS: macOS
- When the user says "my home directory", "my desktop", "my downloads" etc., use the paths: ${home}, ${home}/Desktop, ${home}/Downloads, etc.
- Use ~ or absolute paths in tool calls. NEVER ask the user for their username or home directory path.
- Paths with ~ are automatically resolved (e.g. ~/Desktop works).`;
}

const SKILL_GUIDANCE: Record<string, string> = {
  organize: 'Prefer deterministic file organization with explicit destination folders and clear before/after summaries.',
  cleanup: 'Identify stale/temp/cache artifacts first, propose safe cleanup, then execute with caution and report reclaimed space.',
  coding: 'For code tasks, prefer minimal diffs, preserve style, and validate changes before finalizing.',
  research: 'For research tasks, compare options and return concise recommendations with rationale.',
  automation: 'For repetitive tasks, create reusable steps and predictable outputs.',
};

function buildSkillPrompt(agentSettings: AgentSettings): string {
  const lines: string[] = [];
  const preset = agentSettings.personalityPreset || 'balanced';
  lines.push(`Personality preset: ${preset}.`);
  if (agentSettings.soulPrompt?.trim()) {
    lines.push(`Soul: ${agentSettings.soulPrompt.trim()}`);
  }
  if (agentSettings.enabledSkills?.length) {
    lines.push('Enabled skills:');
    for (const skill of agentSettings.enabledSkills) {
      lines.push(`- ${skill}${SKILL_GUIDANCE[skill] ? `: ${SKILL_GUIDANCE[skill]}` : ''}`);
    }
  }
  if (agentSettings.customSkills?.length) {
    lines.push('Custom skills:');
    for (const skill of agentSettings.customSkills) {
      if (String(skill || '').trim()) lines.push(`- ${String(skill).trim()}`);
    }
  }
  return lines.join('\n');
}

async function maybeLearnUserPreference(prompt: string, enabled: boolean): Promise<void> {
  if (!enabled) return;
  const text = String(prompt || '').trim();
  if (!text) return;
  const looksLikePreference =
    /(^|\b)(i prefer|i like|i want|always|never|my style|for me|please keep|i usually)\b/i.test(text);
  if (!looksLikePreference) return;

  try {
    const settings = loadSettings();
    await addMemory(settings, {
      text: `User preference: ${text}`,
      source: 'agent-preference',
    });
  } catch {
    // Non-fatal.
  }
}

function buildGracefulSteerMessage(params: {
  prompt: string;
  attempts: number;
  failedToolAttempts: Array<{ name: string; output: string }>;
  accessLevel: 'safe' | 'power' | 'ultimate';
}): string {
  const { attempts, failedToolAttempts, accessLevel } = params;
  const uniqueTools = Array.from(new Set(failedToolAttempts.map((f) => f.name)));
  const lastFailure = failedToolAttempts[failedToolAttempts.length - 1];
  const lines: string[] = [];
  lines.push(`I made ${attempts} attempt(s) but couldn't fully complete that task yet.`);
  if (uniqueTools.length) {
    lines.push(`I tried these actions: ${uniqueTools.join(', ')}.`);
  }
  if (lastFailure?.output) {
    const short = String(lastFailure.output).slice(0, 220).replace(/\s+/g, ' ').trim();
    lines.push(`Latest blocker: ${short}`);
  }
  if (accessLevel !== 'ultimate') {
    lines.push('To improve success rate, switch Agent Access Level to Ultimate or enable missing tool categories in Advanced settings.');
  } else {
    lines.push('Please provide one concrete constraint or preferred path, and I can retry with that direction.');
  }
  return lines.join(' ');
}

// ─── Agent Loop ─────────────────────────────────────────────────────

export async function runAgentLoop(options: AgentLoopOptions): Promise<AgentLoopResult> {
  const {
    requestId,
    prompt,
    aiConfig,
    agentSettings,
    signal,
    sendEvent,
    waitForConfirmation,
  } = options;
  const emitTerminalErrorEvent = options.emitTerminalErrorEvent !== false;

  // Resolve enabled tools based on settings
  const accessLevel = agentSettings.accessLevel || 'power';
  const enabledTools = TOOL_DEFINITIONS.filter((t) => {
    if (!agentSettings.enabledToolCategories.includes(t.category)) return false;
    if (accessLevel === 'safe' && (t.dangerous || t.category === 'shell' || t.category === 'applescript')) {
      return false;
    }
    return true;
  });

  // Build system prompt: personality + memory context
  let memoryContext = '';
  try {
    const settings = loadSettings();
    memoryContext = await buildMemoryContextSystemPrompt(settings, prompt, { limit: 6 });
  } catch {
    // Memory unavailable — not fatal
  }

  const defaultPersonality = buildDefaultPersonality();
  const personality = agentSettings.personalityPrompt?.trim()
    ? `${agentSettings.personalityPrompt.trim()}\n\n${defaultPersonality}`
    : defaultPersonality;
  const skillPrompt = buildSkillPrompt(agentSettings);
  const accessPrompt = `Access level: ${accessLevel}. ${accessLevel === 'ultimate'
    ? 'You may use all enabled tools with minimal interruption. Still avoid destructive actions unless needed.'
    : accessLevel === 'safe'
      ? 'Avoid destructive operations and shell/app scripting actions.'
      : 'Use dangerous operations only when necessary and with user confirmation.'}`;
  const systemPrompt = [personality, accessPrompt, skillPrompt, memoryContext].filter(Boolean).join('\n\n');

  // Initialize conversation with prior history + new user message
  const messages: AgentMessage[] = [
    ...(options.conversationHistory || []),
    { role: 'user', content: prompt },
  ];

  const maxSteps = agentSettings.maxSteps || 30;
  let step = 0;
  let consecutiveFailures = 0;
  const failedToolAttempts: Array<{ name: string; output: string }> = [];

  while (step < maxSteps) {
    if (signal.aborted) return { status: 'cancelled', steps: step };
    step++;

    sendEvent({
      requestId,
      type: 'status',
      status: step === 1 ? 'Thinking...' : `Step ${step}...`,
      stepNumber: step,
    });

    // Call LLM with tools
    let response;
    try {
      response = await chatCompletionWithTools(
        aiConfig,
        systemPrompt,
        messages,
        enabledTools,
        signal,
        { autoSelectBestModel: agentSettings.autoSelectBestModel !== false }
      );
      consecutiveFailures = 0;
    } catch (e: any) {
      if (signal.aborted) return { status: 'cancelled', steps: step };
      if (agentSettings.autoRecover !== false && consecutiveFailures < 2) {
        consecutiveFailures += 1;
        sendEvent({
          requestId,
          type: 'status',
          status: 'Recovering from a transient model error...',
          stepNumber: step,
        });
        await new Promise((resolve) => setTimeout(resolve, 1200));
        continue;
      }
      // Clean error message — never show raw JSON to user
      const rawMsg = e?.message || 'LLM request failed';
      const cleanMsg = rawMsg.startsWith('{') || rawMsg.startsWith('HTTP')
        ? buildGracefulSteerMessage({
            prompt,
            attempts: step,
            failedToolAttempts,
            accessLevel,
          })
        : rawMsg;
      if (emitTerminalErrorEvent) {
        sendEvent({ requestId, type: 'error', error: cleanMsg });
      }
      return { status: 'error', steps: step, error: cleanMsg };
    }

    if (signal.aborted) return { status: 'cancelled', steps: step };

    // No tool calls — this is the final answer
    if (!response.toolCalls || response.toolCalls.length === 0) {
      if (response.text) {
        sendEvent({ requestId, type: 'text_chunk', text: response.text });
      }
      messages.push({ role: 'assistant', content: response.text || '' });
      await maybeLearnUserPreference(prompt, agentSettings.adaptiveLearning !== false);
      sendEvent({ requestId, type: 'done' });
      return { status: 'done', steps: step };
    }

    // Assistant message with tool calls — add to conversation
    messages.push({
      role: 'assistant',
      content: response.text || '',
      tool_calls: response.toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.name, arguments: JSON.stringify(tc.args) },
      })),
    });

    // Stream any thinking text the LLM produced alongside tool calls
    if (response.text) {
      sendEvent({ requestId, type: 'thinking', text: response.text });
    }

    // Execute each tool call
    for (const tc of response.toolCalls) {
      if (signal.aborted) return { status: 'cancelled', steps: step };

      const toolDef = TOOL_DEFINITIONS.find((t) => t.name === tc.name);
      const isDangerous =
        accessLevel !== 'ultimate' &&
        toolDef?.dangerous === true &&
        !agentSettings.autoApproveCategories.includes(toolDef.category);

      // Notify renderer of tool call
      sendEvent({
        requestId,
        type: 'tool_call',
        toolCall: {
          id: tc.id,
          name: tc.name,
          args: tc.args,
          dangerous: isDangerous,
          confirmationMessage: isDangerous
            ? toolDef?.confirmationMessage?.(tc.args)
            : undefined,
        },
      });

      // If dangerous and not auto-approved, ask user
      if (isDangerous) {
        sendEvent({
          requestId,
          type: 'confirm_needed',
          confirmation: {
            toolCallId: tc.id,
            toolName: tc.name,
            message:
              toolDef?.confirmationMessage?.(tc.args) || `Allow ${tc.name}?`,
            args: tc.args,
          },
        });

        const approved = await waitForConfirmation(tc.id);

        if (signal.aborted) return { status: 'cancelled', steps: step };

        if (!approved) {
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            name: tc.name,
            content:
              'User denied this action. Try a different approach or ask the user for guidance.',
          });
          sendEvent({
            requestId,
            type: 'tool_result',
            toolResult: {
              id: tc.id,
              name: tc.name,
              success: false,
              output: 'Denied by user',
              durationMs: 0,
            },
          });
          continue;
        }
      }

      // Execute the tool
      const startTime = Date.now();
      let result: { success: boolean; output: string };
      try {
        result = await executeAgentTool(tc.name, tc.args);
      } catch (e: any) {
        result = {
          success: false,
          output: `Error: ${e?.message || 'Tool execution failed'}`,
        };
      }
      const durationMs = Date.now() - startTime;

      if (signal.aborted) return { status: 'cancelled', steps: step };

      // Truncate for LLM context window
      const truncated =
        result.output.length > 4000
          ? result.output.slice(0, 4000) + '\n...(truncated)'
          : result.output;

      // Add tool result to conversation
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        name: tc.name,
        content: truncated,
      });

      if (!result.success) {
        failedToolAttempts.push({ name: tc.name, output: truncated });
      }

      // Notify renderer
      sendEvent({
        requestId,
        type: 'tool_result',
        toolResult: {
          id: tc.id,
          name: tc.name,
          success: result.success,
          output: truncated,
          durationMs,
        },
      });
    }
  }

  // Max steps reached
  const maxStepError = buildGracefulSteerMessage({
    prompt,
    attempts: maxSteps,
    failedToolAttempts,
    accessLevel,
  });
  if (emitTerminalErrorEvent) {
    sendEvent({
      requestId,
      type: 'error',
      error: maxStepError,
    });
  }
  return { status: 'error', steps: maxSteps, error: maxStepError };
}
