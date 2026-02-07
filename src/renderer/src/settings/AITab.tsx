/**
 * AI Settings Tab
 *
 * Configure AI provider, API keys, and default model.
 */

import React, { useState, useEffect } from 'react';
import { Brain, Eye, EyeOff } from 'lucide-react';
import type { AppSettings, AISettings } from '../../types/electron';

const PROVIDER_OPTIONS = [
  { id: 'openai' as const, label: 'OpenAI', description: 'GPT-4o, GPT-4o-mini, o1, o3-mini' },
  { id: 'anthropic' as const, label: 'Anthropic', description: 'Claude Opus, Sonnet, Haiku' },
  { id: 'ollama' as const, label: 'Ollama', description: 'Local models (Llama, Mistral, etc.)' },
];

const MODELS_BY_PROVIDER: Record<string, { id: string; label: string }[]> = {
  openai: [
    { id: 'openai-gpt-4o', label: 'GPT-4o' },
    { id: 'openai-gpt-4o-mini', label: 'GPT-4o Mini' },
    { id: 'openai-gpt-4-turbo', label: 'GPT-4 Turbo' },
    { id: 'openai-o1', label: 'o1' },
    { id: 'openai-o3-mini', label: 'o3-mini' },
  ],
  anthropic: [
    { id: 'anthropic-claude-opus', label: 'Claude Opus' },
    { id: 'anthropic-claude-sonnet', label: 'Claude Sonnet' },
    { id: 'anthropic-claude-haiku', label: 'Claude Haiku' },
  ],
  ollama: [
    { id: 'ollama-llama3', label: 'Llama 3' },
    { id: 'ollama-mistral', label: 'Mistral' },
    { id: 'ollama-codellama', label: 'CodeLlama' },
  ],
};

const AITab: React.FC = () => {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [showOpenAIKey, setShowOpenAIKey] = useState(false);
  const [showAnthropicKey, setShowAnthropicKey] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved'>('idle');

  useEffect(() => {
    window.electron.getSettings().then(setSettings);
  }, []);

  const updateAI = async (patch: Partial<AISettings>) => {
    if (!settings) return;
    const newAI = { ...settings.ai, ...patch };
    const updated = await window.electron.saveSettings({ ai: newAI } as any);
    setSettings(updated);
    setSaveStatus('saved');
    setTimeout(() => setSaveStatus('idle'), 2000);
  };

  if (!settings) {
    return <div className="p-8 text-white/50 text-sm">Loading settings...</div>;
  }

  const ai = settings.ai;
  const models = MODELS_BY_PROVIDER[ai.provider] || [];

  return (
    <div className="p-8 max-w-2xl">
      <h2 className="text-xl font-semibold text-white mb-8">AI</h2>

      <div className="space-y-6">
        {/* Enable toggle */}
        <div className="bg-white/[0.03] rounded-xl border border-white/[0.06] p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Brain className="w-4 h-4 text-white/50" />
              <div>
                <h3 className="text-sm font-medium text-white/90">Enable AI</h3>
                <p className="text-xs text-white/40 mt-0.5">
                  Allow extensions to use AI features with your own API keys.
                </p>
              </div>
            </div>
            <button
              onClick={() => updateAI({ enabled: !ai.enabled })}
              className={`relative w-10 h-6 rounded-full transition-colors ${
                ai.enabled ? 'bg-blue-500' : 'bg-white/10'
              }`}
            >
              <span
                className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                  ai.enabled ? 'left-5' : 'left-1'
                }`}
              />
            </button>
          </div>
        </div>

        {ai.enabled && (
          <>
            {/* Provider selector */}
            <div className="bg-white/[0.03] rounded-xl border border-white/[0.06] p-5">
              <h3 className="text-sm font-medium text-white/90 mb-3">Provider</h3>
              <div className="space-y-2">
                {PROVIDER_OPTIONS.map((p) => (
                  <label
                    key={p.id}
                    className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                      ai.provider === p.id
                        ? 'bg-blue-500/10 border border-blue-500/30'
                        : 'bg-white/[0.02] border border-white/[0.04] hover:bg-white/[0.04]'
                    }`}
                  >
                    <input
                      type="radio"
                      name="ai-provider"
                      checked={ai.provider === p.id}
                      onChange={() => updateAI({ provider: p.id, defaultModel: '' })}
                      className="sr-only"
                    />
                    <div
                      className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                        ai.provider === p.id
                          ? 'border-blue-500'
                          : 'border-white/30'
                      }`}
                    >
                      {ai.provider === p.id && (
                        <div className="w-2 h-2 rounded-full bg-blue-500" />
                      )}
                    </div>
                    <div>
                      <span className="text-sm text-white/90">{p.label}</span>
                      <p className="text-xs text-white/40">{p.description}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* API Keys */}
            <div className="bg-white/[0.03] rounded-xl border border-white/[0.06] p-5">
              <h3 className="text-sm font-medium text-white/90 mb-4">API Keys</h3>
              <div className="space-y-4">
                {/* OpenAI */}
                <div>
                  <label className="text-xs text-white/50 mb-1.5 block">OpenAI API Key</label>
                  <div className="relative">
                    <input
                      type={showOpenAIKey ? 'text' : 'password'}
                      value={ai.openaiApiKey}
                      onChange={(e) => updateAI({ openaiApiKey: e.target.value })}
                      placeholder="sk-..."
                      className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 pr-10 text-sm text-white/90 placeholder-white/30 focus:outline-none focus:border-blue-500/50"
                    />
                    <button
                      onClick={() => setShowOpenAIKey(!showOpenAIKey)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70"
                    >
                      {showOpenAIKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Anthropic */}
                <div>
                  <label className="text-xs text-white/50 mb-1.5 block">Anthropic API Key</label>
                  <div className="relative">
                    <input
                      type={showAnthropicKey ? 'text' : 'password'}
                      value={ai.anthropicApiKey}
                      onChange={(e) => updateAI({ anthropicApiKey: e.target.value })}
                      placeholder="sk-ant-..."
                      className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 pr-10 text-sm text-white/90 placeholder-white/30 focus:outline-none focus:border-blue-500/50"
                    />
                    <button
                      onClick={() => setShowAnthropicKey(!showAnthropicKey)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70"
                    >
                      {showAnthropicKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Ollama */}
                <div>
                  <label className="text-xs text-white/50 mb-1.5 block">Ollama Server URL</label>
                  <input
                    type="text"
                    value={ai.ollamaBaseUrl}
                    onChange={(e) => updateAI({ ollamaBaseUrl: e.target.value })}
                    placeholder="http://localhost:11434"
                    className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white/90 placeholder-white/30 focus:outline-none focus:border-blue-500/50"
                  />
                </div>
              </div>
            </div>

            {/* Default model */}
            <div className="bg-white/[0.03] rounded-xl border border-white/[0.06] p-5">
              <h3 className="text-sm font-medium text-white/90 mb-1">Default Model</h3>
              <p className="text-xs text-white/40 mb-3">
                Used when extensions don't specify a model.
              </p>
              <select
                value={ai.defaultModel}
                onChange={(e) => updateAI({ defaultModel: e.target.value })}
                className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white/90 focus:outline-none focus:border-blue-500/50 appearance-none"
              >
                <option value="">Auto (provider default)</option>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}

        {saveStatus === 'saved' && (
          <p className="text-xs text-green-400 text-center">Settings saved</p>
        )}
      </div>
    </div>
  );
};

export default AITab;
