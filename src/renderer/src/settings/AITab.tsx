/**
 * AI Settings Tab
 *
 * Configure LLM provider, API keys, and default model.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  AlertCircle,
  Brain,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import HotkeyRecorder from './HotkeyRecorder';
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
};

const CURATED_OLLAMA_MODELS = [
  { name: 'llama3.2', label: 'Llama 3.2', size: '2.0 GB', description: 'Meta general-purpose (3B)' },
  { name: 'llama3.2:1b', label: 'Llama 3.2 (1B)', size: '1.3 GB', description: 'Small and fast' },
  { name: 'mistral', label: 'Mistral 7B', size: '4.1 GB', description: 'Efficient general-purpose' },
  { name: 'codellama', label: 'Code Llama', size: '3.8 GB', description: 'Code generation & completion' },
  { name: 'phi3', label: 'Phi-3', size: '2.3 GB', description: 'Microsoft small language model' },
  { name: 'gemma2', label: 'Gemma 2', size: '5.4 GB', description: 'Google open model (9B)' },
  { name: 'qwen2.5', label: 'Qwen 2.5', size: '4.7 GB', description: 'Alibaba multilingual model (7B)' },
  { name: 'deepseek-r1', label: 'DeepSeek R1', size: '4.7 GB', description: 'Reasoning-focused model (7B)' },
];

const WHISPER_SPEAK_TOGGLE_COMMAND_ID = 'system-supercommand-whisper-speak-toggle';

const AITab: React.FC = () => {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [showOpenAIKey, setShowOpenAIKey] = useState(false);
  const [showAnthropicKey, setShowAnthropicKey] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved'>('idle');

  const [ollamaRunning, setOllamaRunning] = useState<boolean | null>(null);
  const [localModels, setLocalModels] = useState<Set<string>>(new Set());
  const [pullingModel, setPullingModel] = useState<string | null>(null);
  const [pullProgress, setPullProgress] = useState<{ status: string; percent: number }>({ status: '', percent: 0 });
  const [deletingModel, setDeletingModel] = useState<string | null>(null);
  const [ollamaError, setOllamaError] = useState<string | null>(null);

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

  const refreshOllamaStatus = useCallback(() => {
    setOllamaRunning(null);
    window.electron.ollamaStatus().then((result) => {
      setOllamaRunning(result.running);
      if (result.running) {
        const names = new Set(result.models.map((m: any) => m.name.replace(':latest', '')));
        setLocalModels(names);
      } else {
        setLocalModels(new Set());
      }
    });
  }, []);

  useEffect(() => {
    if (!settings) return;
    refreshOllamaStatus();
  }, [settings?.ai?.ollamaBaseUrl, refreshOllamaStatus]);

  useEffect(() => {
    window.electron.onOllamaPullProgress((data) => {
      const percent = data.total > 0 ? Math.round((data.completed / data.total) * 100) : 0;
      setPullProgress({ status: data.status, percent });
    });
    window.electron.onOllamaPullDone(() => {
      setPullingModel(null);
      setPullProgress({ status: '', percent: 0 });
      refreshOllamaStatus();
    });
    window.electron.onOllamaPullError((data) => {
      setPullingModel(null);
      setPullProgress({ status: '', percent: 0 });
      setOllamaError(data.error);
      setTimeout(() => setOllamaError(null), 5000);
    });
  }, [refreshOllamaStatus]);

  const handlePull = (modelName: string) => {
    const requestId = `ollama-pull-${Date.now()}`;
    setPullingModel(modelName);
    setPullProgress({ status: 'Starting download...', percent: 0 });
    setOllamaError(null);
    window.electron.ollamaPull(requestId, modelName);
  };

  const handleDelete = async (modelName: string) => {
    setDeletingModel(modelName);
    setOllamaError(null);
    const result = await window.electron.ollamaDelete(modelName);
    if (result.success) {
      setLocalModels((prev) => {
        const next = new Set(prev);
        next.delete(modelName);
        return next;
      });
    } else {
      setOllamaError(result.error || 'Failed to delete model');
      setTimeout(() => setOllamaError(null), 5000);
    }
    setDeletingModel(null);
  };

  const handleWhisperHotkeyChange = async (commandId: string, hotkey: string) => {
    const success = await window.electron.updateCommandHotkey(commandId, hotkey);
    if (!success) return;
    setSettings((prev) => {
      if (!prev) return prev;
      const nextHotkeys = { ...(prev.commandHotkeys || {}) };
      if (hotkey) {
        nextHotkeys[commandId] = hotkey;
      } else {
        delete nextHotkeys[commandId];
      }
      return { ...prev, commandHotkeys: nextHotkeys };
    });
    setSaveStatus('saved');
    setTimeout(() => setSaveStatus('idle'), 2000);
  };

  if (!settings) {
    return <div className="p-8 text-white/50 text-sm">Loading settings...</div>;
  }

  const ai = settings.ai;
  const models = ai.provider === 'ollama' && ollamaRunning
    ? Array.from(localModels).map((name) => ({
        id: `ollama-${name}`,
        label: CURATED_OLLAMA_MODELS.find((m) => m.name === name)?.label || name,
      }))
    : MODELS_BY_PROVIDER[ai.provider] || [];

  return (
    <div className="p-4 w-full">
      <h2 className="text-lg font-semibold text-white mb-4">AI</h2>

      <div className="space-y-4">
        <div className="bg-white/[0.03] rounded-lg border border-white/[0.06] p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Brain className="w-4 h-4 text-white/50" />
              <div>
                <h3 className="text-sm font-medium text-white/90">Enable AI</h3>
                <p className="text-xs text-white/40 mt-0.5">
                  Enable LLM features.
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
          <div className="bg-white/[0.03] rounded-lg border border-white/[0.06] p-3">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-5 h-5 rounded-full bg-blue-500/20 text-[11px] text-blue-300 flex items-center justify-center font-semibold">1</div>
              <Brain className="w-4 h-4 text-blue-300/80" />
              <div>
                <h3 className="text-sm font-medium text-white/90">Generic LLMs</h3>
                <p className="text-xs text-white/40">Provider, API credentials, and default chat model.</p>
              </div>
            </div>

            <div className={`grid gap-4 ${ai.provider === 'ollama' ? 'grid-cols-[minmax(0,58%)_1fr]' : 'grid-cols-1'}`}>
              <div className="space-y-4">
                <div className="bg-white/[0.02] rounded-lg border border-white/[0.05] p-3">
                  <h3 className="text-sm font-medium text-white/90 mb-2.5">Provider</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {PROVIDER_OPTIONS.map((p) => (
                      <label
                        key={p.id}
                        className={`flex min-h-[86px] items-center gap-3 p-2.5 rounded-md cursor-pointer transition-colors ${
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
                          {ai.provider === p.id && <div className="w-2 h-2 rounded-full bg-blue-500" />}
                        </div>
                        <div>
                          <span className="text-sm text-white/90">{p.label}</span>
                          <p className="text-xs text-white/40">{p.description}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="bg-white/[0.02] rounded-lg border border-white/[0.05] p-3">
                  <h3 className="text-sm font-medium text-white/90 mb-3">API Keys</h3>
                  <div className="space-y-2.5">
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

                    <div>
                      <label className="text-xs text-white/50 mb-1.5 block">Ollama Server URL</label>
                      <input
                        type="text"
                        value={ai.ollamaBaseUrl}
                        onChange={(e) => updateAI({ ollamaBaseUrl: e.target.value.trim() })}
                        placeholder="http://localhost:11434"
                        className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white/90 placeholder-white/30 focus:outline-none focus:border-blue-500/50"
                      />
                    </div>
                  </div>
                </div>

                <div className="bg-white/[0.02] rounded-lg border border-white/[0.05] p-3">
                  <h3 className="text-sm font-medium text-white/90 mb-1">Default Model</h3>
                  <p className="text-xs text-white/40 mb-3">Used when extensions do not specify a model.</p>
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
              </div>

              {ai.provider === 'ollama' && (
                <div className="bg-white/[0.02] rounded-lg border border-white/[0.05] p-3 self-start">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-medium text-white/90">Ollama Models</h3>
                    {ollamaRunning && (
                      <button
                        onClick={refreshOllamaStatus}
                        className="flex items-center gap-1.5 px-2 py-1 text-xs text-white/40 hover:text-white/70 rounded transition-colors"
                      >
                        <RefreshCw className="w-3 h-3" />
                        Refresh
                      </button>
                    )}
                  </div>

                  {ollamaRunning === null && (
                    <div className="flex items-center gap-2 text-white/40 text-sm py-4">
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Checking Ollama status...
                    </div>
                  )}

                  {ollamaRunning === false && (
                    <div className="text-center py-6">
                      <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-3">
                        <AlertCircle className="w-5 h-5 text-red-400/70" />
                      </div>
                      <p className="text-sm text-white/60 mb-1">Ollama is not running</p>
                      <p className="text-xs text-white/30 mb-4">Download and install Ollama to run AI models locally.</p>
                      <button
                        onClick={() => window.electron.ollamaOpenDownload()}
                        className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 rounded-lg transition-colors"
                      >
                        <Download className="w-4 h-4" />
                        Download Ollama
                        <ExternalLink className="w-3 h-3 text-blue-400/50" />
                      </button>
                    </div>
                  )}

                  {ollamaRunning === true && (
                    <>
                      <div className="flex items-center gap-2 mb-4">
                        <div className="w-2 h-2 rounded-full bg-green-400" />
                        <span className="text-xs text-green-400/70">Ollama is running</span>
                      </div>

                      {ollamaError && (
                        <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 mb-3">
                          <p className="text-xs text-red-400">{ollamaError}</p>
                        </div>
                      )}

                      <div className="space-y-0.5">
                        {CURATED_OLLAMA_MODELS.map((model) => {
                          const installed = localModels.has(model.name);
                          const isPulling = pullingModel === model.name;
                          const isDeleting = deletingModel === model.name;

                          return (
                            <div key={model.name}>
                              <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/[0.03] transition-colors group">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm text-white/90">{model.label}</span>
                                    <span className="text-[11px] text-white/25">{model.size}</span>
                                    {installed && (
                                      <span className="text-[10px] px-1.5 py-0.5 bg-green-500/15 text-green-400/80 rounded">Installed</span>
                                    )}
                                  </div>
                                  <p className="text-xs text-white/35 mt-0.5">{model.description}</p>
                                </div>

                                <div className="flex-shrink-0">
                                  {isPulling ? (
                                    <div className="flex items-center gap-1.5 px-3 py-1 text-xs text-white/40">
                                      <RefreshCw className="w-3 h-3 animate-spin" />
                                      {pullProgress.percent > 0 ? `${pullProgress.percent}%` : 'Starting...'}
                                    </div>
                                  ) : isDeleting ? (
                                    <div className="flex items-center gap-1.5 px-3 py-1 text-xs text-white/40">
                                      <RefreshCw className="w-3 h-3 animate-spin" />
                                      Removing...
                                    </div>
                                  ) : installed ? (
                                    <button
                                      onClick={() => handleDelete(model.name)}
                                      disabled={!!pullingModel}
                                      className="flex items-center gap-1.5 px-3 py-1 text-xs text-red-400/60 hover:text-red-400 hover:bg-red-500/10 rounded-md transition-all opacity-0 group-hover:opacity-100"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                      Remove
                                    </button>
                                  ) : (
                                    <button
                                      onClick={() => handlePull(model.name)}
                                      disabled={!!pullingModel}
                                      className="flex items-center gap-1.5 px-3 py-1 text-xs text-blue-400 hover:text-blue-300 bg-blue-500/10 hover:bg-blue-500/20 rounded-md transition-colors disabled:opacity-40"
                                    >
                                      <Download className="w-3 h-3" />
                                      Download
                                    </button>
                                  )}
                                </div>
                              </div>

                              {isPulling && pullProgress.percent > 0 && (
                                <div className="px-3 pb-2">
                                  <div className="w-full h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                                    <div
                                      className="h-full bg-blue-500 rounded-full transition-all duration-300"
                                      style={{ width: `${pullProgress.percent}%` }}
                                    />
                                  </div>
                                  <p className="text-[11px] text-white/30 mt-1 truncate">{pullProgress.status}</p>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="bg-white/[0.03] rounded-lg border border-white/[0.06] p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium text-white/90">Whisper</h3>
              <p className="text-xs text-white/40 mt-0.5">
                Configure voice post-processing and speaking controls.
              </p>
            </div>
            <button
              onClick={() => updateAI({ speechCorrectionEnabled: !ai.speechCorrectionEnabled })}
              className={`relative w-10 h-6 rounded-full transition-colors ${
                ai.speechCorrectionEnabled ? 'bg-blue-500' : 'bg-white/10'
              }`}
              aria-label="Toggle voice post-processing"
              title="Voice Post-processing"
            >
              <span
                className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                  ai.speechCorrectionEnabled ? 'left-5' : 'left-1'
                }`}
              />
            </button>
          </div>

          <p className="text-xs text-white/35 mt-3 mb-3">
            Voice post-processing uses your selected LLM to clean dictated text and remove filler words.
          </p>

          <p className="text-xs text-white/35 mb-3">
            Open Whisper hotkey is configured in Extensions. These hotkeys only control speaking.
          </p>

          <div className="grid grid-cols-1 gap-3">
            <div className="bg-white/[0.02] rounded-md border border-white/[0.06] p-2.5">
              <p className="text-xs text-white/45 mb-1.5">Start/Stop Speaking Hotkey</p>
              <HotkeyRecorder
                value={(settings.commandHotkeys || {})[WHISPER_SPEAK_TOGGLE_COMMAND_ID] || 'Command+.'}
                onChange={(hotkey) => { void handleWhisperHotkeyChange(WHISPER_SPEAK_TOGGLE_COMMAND_ID, hotkey); }}
                compact
              />
            </div>
          </div>
        </div>

        {saveStatus === 'saved' && (
          <p className="text-xs text-green-400 text-center">Settings saved</p>
        )}
      </div>
    </div>
  );
};

export default AITab;
