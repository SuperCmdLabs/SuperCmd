/**
 * Agent Types — shared between main process and renderer.
 */

// ─── Agent Events (main → renderer) ─────────────────────────────────

export type AgentEventType =
  | 'thinking'
  | 'tool_call'
  | 'tool_result'
  | 'confirm_needed'
  | 'text_chunk'
  | 'done'
  | 'error'
  | 'status';

export interface AgentEvent {
  requestId: string;
  type: AgentEventType;
  text?: string;
  toolCall?: {
    id: string;
    name: string;
    args: Record<string, any>;
    dangerous: boolean;
    confirmationMessage?: string;
  };
  toolResult?: {
    id: string;
    name: string;
    success: boolean;
    output: string;
    durationMs: number;
  };
  confirmation?: {
    toolCallId: string;
    toolName: string;
    message: string;
    args: Record<string, any>;
  };
  error?: string;
  status?: string;
  stepNumber?: number;
}

// ─── Conversation Messages (LLM context) ────────────────────────────

export interface AgentMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  name?: string;
}

// ─── Agent Settings ─────────────────────────────────────────────────

export interface AgentSettings {
  enabled: boolean;
  accessLevel: 'safe' | 'power' | 'ultimate';
  soulPrompt: string;
  personalityPrompt: string;
  personalityPreset: 'balanced' | 'operator' | 'builder' | 'analyst';
  enabledSkills: string[];
  customSkills: string[];
  adaptiveLearning: boolean;
  autoRecover: boolean;
  autoSelectBestModel: boolean;
  enabledToolCategories: string[];
  autoApproveCategories: string[];
  maxSteps: number;
}

export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  enabled: true,
  accessLevel: 'power',
  soulPrompt: '',
  personalityPrompt: '',
  personalityPreset: 'balanced',
  enabledSkills: ['organize', 'cleanup', 'coding', 'research'],
  customSkills: [],
  adaptiveLearning: true,
  autoRecover: true,
  autoSelectBestModel: true,
  enabledToolCategories: [
    'shell',
    'filesystem',
    'clipboard',
    'applescript',
    'http',
    'app_control',
    'memory',
  ],
  autoApproveCategories: ['clipboard', 'memory', 'http', 'app_control'],
  maxSteps: 30,
};
