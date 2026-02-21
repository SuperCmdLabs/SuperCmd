import type { AISettings } from '../settings-store';
import type { AgentEvent, AgentMessage, AgentSettings } from './types';
import { runAgentLoop } from './agent-runtime';
import {
  finishAgentTask,
  finishAgentTaskAttempt,
  startAgentTask,
  startAgentTaskAttempt,
} from './task-store';

type Provider = AISettings['provider'];

export interface AgentOrchestratorOptions {
  requestId: string;
  prompt: string;
  aiConfig: AISettings;
  agentSettings: AgentSettings;
  signal: AbortSignal;
  sendEvent: (event: AgentEvent) => void;
  waitForConfirmation: (toolCallId: string) => Promise<boolean>;
  conversationHistory?: AgentMessage[];
}

function hasProvider(config: AISettings, provider: Provider): boolean {
  switch (provider) {
    case 'openai':
      return Boolean(config.openaiApiKey);
    case 'anthropic':
      return Boolean(config.anthropicApiKey);
    case 'openai-compatible':
      return Boolean(config.openaiCompatibleApiKey && config.openaiCompatibleBaseUrl);
    case 'ollama':
      return Boolean(config.ollamaBaseUrl);
    default:
      return false;
  }
}

function providerLabel(provider: Provider): string {
  switch (provider) {
    case 'openai': return 'OpenAI';
    case 'anthropic': return 'Anthropic';
    case 'openai-compatible': return 'OpenAI-Compatible';
    case 'ollama': return 'Ollama';
    default: return provider;
  }
}

function providerPlan(config: AISettings): Provider[] {
  const ordered: Provider[] = [config.provider, 'openai', 'anthropic', 'openai-compatible', 'ollama'];
  const dedup: Provider[] = [];
  for (const p of ordered) {
    if (dedup.includes(p)) continue;
    if (!hasProvider(config, p)) continue;
    dedup.push(p);
  }
  return dedup;
}

export async function runAgentOrchestrated(options: AgentOrchestratorOptions): Promise<void> {
  const {
    requestId,
    prompt,
    aiConfig,
    agentSettings,
    signal,
    sendEvent,
    waitForConfirmation,
    conversationHistory,
  } = options;

  const providers = providerPlan(aiConfig);
  if (providers.length === 0) {
    sendEvent({
      requestId,
      type: 'error',
      error: 'No usable AI provider is configured. Add at least one API key in Settings → AI.',
    });
    return;
  }

  startAgentTask(requestId, prompt);

  let lastError = 'Unknown agent failure';
  for (let i = 0; i < providers.length; i++) {
    if (signal.aborted) {
      finishAgentTask(requestId, 'cancelled');
      return;
    }

    const provider = providers[i];
    const attempt = i + 1;
    const total = providers.length;
    startAgentTaskAttempt(requestId, attempt, provider);

    sendEvent({
      requestId,
      type: 'status',
      status: `Attempt ${attempt}/${total} with ${providerLabel(provider)}...`,
      stepNumber: 0,
    });

    const cfg: AISettings = { ...aiConfig, provider, defaultModel: '' };
    const result = await runAgentLoop({
      requestId,
      prompt,
      aiConfig: cfg,
      agentSettings,
      signal,
      sendEvent,
      waitForConfirmation,
      conversationHistory,
      emitTerminalErrorEvent: i === providers.length - 1,
    });

    finishAgentTaskAttempt(requestId, attempt, result.status, result.error);

    if (result.status === 'done') {
      finishAgentTask(requestId, 'done');
      return;
    }
    if (result.status === 'cancelled') {
      finishAgentTask(requestId, 'cancelled');
      return;
    }

    lastError = result.error || lastError;
    if (i < providers.length - 1) {
      sendEvent({
        requestId,
        type: 'status',
        status: `Switching provider after failure: ${lastError.slice(0, 120)}...`,
        stepNumber: 0,
      });
    }
  }

  finishAgentTask(requestId, 'error');
  sendEvent({
    requestId,
    type: 'error',
    error: `I tried all configured providers but couldn't complete this yet. ${lastError}`,
  });
}

