import type { AISettings, Conversation } from '../../types/electron';

export type AiProviderId = AISettings['provider'];

export interface AiModelInfo {
  modelKey: string;
  modelLabel: string;
  providerId: AiProviderId;
  providerLabel: string;
  source: 'conversation' | 'default-model' | 'provider-default' | 'selection';
}

export interface AiModelOption {
  id: string;
  label: string;
  provider: AiProviderId;
  providerLabel: string;
}

const PROVIDER_LABELS: Record<AiProviderId, string> = {
  'chatgpt-account': 'ChatGPT',
  'claude-account': 'Claude',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Gemini',
  ollama: 'Ollama',
  'openai-compatible': 'Custom API',
};

const STATIC_MODEL_OPTIONS: Record<Exclude<AiProviderId, 'ollama' | 'openai-compatible'>, AiModelOption[]> = {
  'chatgpt-account': [
    { id: 'chatgpt-gpt-5', label: 'GPT-5', provider: 'chatgpt-account', providerLabel: PROVIDER_LABELS['chatgpt-account'] },
    { id: 'chatgpt-gpt-5.4', label: 'GPT-5.4', provider: 'chatgpt-account', providerLabel: PROVIDER_LABELS['chatgpt-account'] },
    { id: 'chatgpt-gpt-5.2', label: 'GPT-5.2', provider: 'chatgpt-account', providerLabel: PROVIDER_LABELS['chatgpt-account'] },
    { id: 'chatgpt-gpt-5.1', label: 'GPT-5.1', provider: 'chatgpt-account', providerLabel: PROVIDER_LABELS['chatgpt-account'] },
    { id: 'chatgpt-gpt-5-codex', label: 'GPT-5 Codex', provider: 'chatgpt-account', providerLabel: PROVIDER_LABELS['chatgpt-account'] },
    { id: 'chatgpt-codex-mini', label: 'Codex Mini', provider: 'chatgpt-account', providerLabel: PROVIDER_LABELS['chatgpt-account'] },
    { id: 'chatgpt-gpt-4o', label: 'GPT-4o', provider: 'chatgpt-account', providerLabel: PROVIDER_LABELS['chatgpt-account'] },
  ],
  'claude-account': [
    { id: 'claude-account-sonnet', label: 'Claude Sonnet', provider: 'claude-account', providerLabel: PROVIDER_LABELS['claude-account'] },
    { id: 'claude-account-opus', label: 'Claude Opus', provider: 'claude-account', providerLabel: PROVIDER_LABELS['claude-account'] },
    { id: 'claude-account-haiku', label: 'Claude Haiku', provider: 'claude-account', providerLabel: PROVIDER_LABELS['claude-account'] },
  ],
  openai: [
    { id: 'openai-gpt-4o', label: 'GPT-4o', provider: 'openai', providerLabel: PROVIDER_LABELS.openai },
    { id: 'openai-gpt-4o-mini', label: 'GPT-4o Mini', provider: 'openai', providerLabel: PROVIDER_LABELS.openai },
    { id: 'openai-gpt-4-turbo', label: 'GPT-4 Turbo', provider: 'openai', providerLabel: PROVIDER_LABELS.openai },
    { id: 'openai-gpt-3.5-turbo', label: 'GPT-3.5 Turbo', provider: 'openai', providerLabel: PROVIDER_LABELS.openai },
    { id: 'openai-o1', label: 'o1', provider: 'openai', providerLabel: PROVIDER_LABELS.openai },
    { id: 'openai-o1-mini', label: 'o1-mini', provider: 'openai', providerLabel: PROVIDER_LABELS.openai },
    { id: 'openai-o3-mini', label: 'o3-mini', provider: 'openai', providerLabel: PROVIDER_LABELS.openai },
  ],
  anthropic: [
    { id: 'anthropic-claude-opus', label: 'Claude Opus', provider: 'anthropic', providerLabel: PROVIDER_LABELS.anthropic },
    { id: 'anthropic-claude-sonnet', label: 'Claude Sonnet', provider: 'anthropic', providerLabel: PROVIDER_LABELS.anthropic },
    { id: 'anthropic-claude-haiku', label: 'Claude Haiku', provider: 'anthropic', providerLabel: PROVIDER_LABELS.anthropic },
  ],
  gemini: [
    { id: 'gemini-gemini-2.5-pro', label: 'Gemini 2.5 Pro', provider: 'gemini', providerLabel: PROVIDER_LABELS.gemini },
    { id: 'gemini-gemini-2.5-flash', label: 'Gemini 2.5 Flash', provider: 'gemini', providerLabel: PROVIDER_LABELS.gemini },
    { id: 'gemini-gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite', provider: 'gemini', providerLabel: PROVIDER_LABELS.gemini },
  ],
};

const MODEL_PREFIXES: Array<{ prefix: string; provider: AiProviderId }> = [
  { prefix: 'openai-compatible-', provider: 'openai-compatible' },
  { prefix: 'claude-account-', provider: 'claude-account' },
  { prefix: 'chatgpt-', provider: 'chatgpt-account' },
  { prefix: 'anthropic-', provider: 'anthropic' },
  { prefix: 'gemini-', provider: 'gemini' },
  { prefix: 'ollama-', provider: 'ollama' },
  { prefix: 'openai-', provider: 'openai' },
];

function mapClaudeAccountSettingToKey(modelName: string): string {
  const normalized = String(modelName || '').trim().toLowerCase();
  if (!normalized) return 'claude-account-sonnet';
  if (normalized === 'sonnet' || normalized.includes('sonnet')) return 'claude-account-sonnet';
  if (normalized === 'opus' || normalized.includes('opus')) return 'claude-account-opus';
  if (normalized === 'haiku' || normalized.includes('haiku')) return 'claude-account-haiku';
  return `claude-account-${normalized}`;
}

function getProviderDefaultModelKey(ai: AISettings): string {
  switch (ai.provider) {
    case 'chatgpt-account':
      return `chatgpt-${String(ai.chatgptAccountModel || 'gpt-5').trim() || 'gpt-5'}`;
    case 'claude-account':
      return mapClaudeAccountSettingToKey(ai.claudeAccountModel || 'claude-sonnet-4-5');
    case 'openai':
      return 'openai-gpt-4o-mini';
    case 'anthropic':
      return 'anthropic-claude-haiku';
    case 'gemini':
      return 'gemini-gemini-2.5-flash';
    case 'ollama':
      return 'ollama-llama3';
    case 'openai-compatible':
      return `openai-compatible-${String(ai.openaiCompatibleModel || 'gpt-4o').trim() || 'gpt-4o'}`;
    default:
      return 'openai-gpt-4o-mini';
  }
}

function formatUnknownModelLabel(rawModelName: string): string {
  const trimmed = String(rawModelName || '').trim();
  if (!trimmed) return 'Unknown Model';
  if (trimmed.includes('/')) {
    const segments = trimmed.split('/');
    return segments[segments.length - 1] || trimmed;
  }
  return trimmed;
}

function findStaticOption(modelKey: string): AiModelOption | null {
  const groups = Object.values(STATIC_MODEL_OPTIONS);
  for (const group of groups) {
    const match = group.find((item) => item.id === modelKey);
    if (match) return match;
  }
  return null;
}

function inferProviderFromModelKey(modelKey: string, fallback: AiProviderId): AiProviderId {
  const normalized = String(modelKey || '').trim();
  for (const rule of MODEL_PREFIXES) {
    if (normalized.startsWith(rule.prefix)) return rule.provider;
  }
  return fallback;
}

function stripModelPrefix(modelKey: string): string {
  const normalized = String(modelKey || '').trim();
  for (const rule of MODEL_PREFIXES) {
    if (normalized.startsWith(rule.prefix)) {
      return normalized.slice(rule.prefix.length);
    }
  }
  return normalized;
}

function buildModelOption(modelKey: string, fallbackProvider: AiProviderId): AiModelOption {
  const known = findStaticOption(modelKey);
  if (known) return known;

  const provider = inferProviderFromModelKey(modelKey, fallbackProvider);
  const modelLabel = formatUnknownModelLabel(stripModelPrefix(modelKey));
  return {
    id: modelKey,
    label: modelLabel,
    provider,
    providerLabel: PROVIDER_LABELS[provider],
  };
}

function isProviderConfigured(ai: AISettings, provider: AiProviderId, ollamaModels: string[]): boolean {
  switch (provider) {
    case 'chatgpt-account':
      return Boolean(ai.chatgptAccountTokens?.accessToken);
    case 'claude-account':
      return Boolean(ai.claudeAccountTokens?.authToken);
    case 'openai':
      return Boolean(ai.openaiApiKey);
    case 'anthropic':
      return Boolean(ai.anthropicApiKey);
    case 'gemini':
      return Boolean(ai.geminiApiKey);
    case 'ollama':
      return ollamaModels.length > 0;
    case 'openai-compatible':
      return Boolean(ai.openaiCompatibleBaseUrl && ai.openaiCompatibleApiKey && ai.openaiCompatibleModel);
    default:
      return false;
  }
}

export function getProviderLabel(provider: AiProviderId): string {
  return PROVIDER_LABELS[provider];
}

export function getEffectiveLauncherModel(ai: AISettings): AiModelInfo {
  const explicitModel = String(ai.defaultModel || '').trim();
  const modelKey = explicitModel || getProviderDefaultModelKey(ai);
  const option = buildModelOption(modelKey, ai.provider);
  return {
    modelKey: option.id,
    modelLabel: option.label,
    providerId: option.provider,
    providerLabel: option.providerLabel,
    source: explicitModel ? 'default-model' : 'provider-default',
  };
}

export function getConversationModelInfo(conversation: Pick<Conversation, 'model' | 'provider'> | null, ai: AISettings): AiModelInfo {
  const convoModel = String(conversation?.model || '').trim();
  if (convoModel) {
    const fallbackProvider = (conversation?.provider as AiProviderId) || ai.provider;
    const option = buildModelOption(convoModel, fallbackProvider);
    return {
      modelKey: option.id,
      modelLabel: option.label,
      providerId: option.provider,
      providerLabel: option.providerLabel,
      source: 'conversation',
    };
  }
  return getEffectiveLauncherModel(ai);
}

export function getConfiguredChatModelOptions(
  ai: AISettings,
  options?: { currentModelKey?: string; ollamaModels?: string[] }
): AiModelOption[] {
  const ollamaModels = options?.ollamaModels || [];
  const allOptions: AiModelOption[] = [];

  (Object.keys(PROVIDER_LABELS) as AiProviderId[]).forEach((provider) => {
    if (!isProviderConfigured(ai, provider, ollamaModels)) return;
    if (provider === 'openai-compatible') {
      allOptions.push(buildModelOption(`openai-compatible-${ai.openaiCompatibleModel}`, provider));
      return;
    }
    if (provider === 'ollama') {
      ollamaModels.forEach((modelName) => {
        allOptions.push({
          id: `ollama-${modelName}`,
          label: modelName,
          provider,
          providerLabel: PROVIDER_LABELS[provider],
        });
      });
      return;
    }
    const staticOptions = STATIC_MODEL_OPTIONS[provider as keyof typeof STATIC_MODEL_OPTIONS] || [];
    allOptions.push(...staticOptions);
  });

  const currentModelKey = String(options?.currentModelKey || '').trim();
  if (currentModelKey) {
    allOptions.unshift(buildModelOption(currentModelKey, ai.provider));
  }

  const fallbackModel = getEffectiveLauncherModel(ai).modelKey;
  allOptions.unshift(buildModelOption(fallbackModel, ai.provider));

  const deduped = new Map<string, AiModelOption>();
  allOptions.forEach((option) => {
    if (!deduped.has(option.id)) {
      deduped.set(option.id, option);
    }
  });

  return Array.from(deduped.values());
}
