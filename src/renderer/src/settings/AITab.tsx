/**
 * AI Settings Tab
 *
 * Compact grouped layout with horizontal tabs for:
 * - API Keys & Generic Models
 * - SuperCommand Whisper
 * - SuperCommand Speak
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  AlertCircle,
  Brain,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Mic,
  RefreshCw,
  Trash2,
  Volume2,
} from 'lucide-react';
import HotkeyRecorder from './HotkeyRecorder';
import type { AppSettings, AISettings, EdgeTtsVoice } from '../../types/electron';

const PROVIDER_OPTIONS = [
  { id: 'openai' as const, label: 'OpenAI', description: 'GPT family models' },
  { id: 'anthropic' as const, label: 'Claude', description: 'Anthropic Claude models' },
  { id: 'ollama' as const, label: 'Ollama', description: 'Local models' },
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

const WHISPER_STT_OPTIONS = [
  { id: 'native', label: 'Native (Default)' },
  { id: 'openai-gpt-4o-transcribe', label: 'OpenAI GPT-4o Transcribe' },
  { id: 'openai-whisper-1', label: 'OpenAI Whisper-1' },
  { id: 'elevenlabs-scribe-v1', label: 'ElevenLabs Scribe v1' },
];

const SPEAK_TTS_OPTIONS = [
  { id: 'edge-tts', label: 'Edge TTS (Default)' },
  { id: 'elevenlabs-multilingual-v2', label: 'ElevenLabs Multilingual v2' },
];

type EdgeVoiceGender = 'female' | 'male';

type EdgeVoiceDef = {
  id: string;
  label: string;
  languageCode: string;
  languageLabel: string;
  gender: EdgeVoiceGender;
  style?: string;
};

const EDGE_TTS_FALLBACK_VOICES: EdgeVoiceDef[] = [
  { id: 'ar-EG-SalmaNeural', label: 'Salma', languageCode: 'ar-EG', languageLabel: 'Arabic', gender: 'female' },
  { id: 'ar-EG-ShakirNeural', label: 'Shakir', languageCode: 'ar-EG', languageLabel: 'Arabic', gender: 'male' },
  { id: 'zh-CN-XiaoxiaoNeural', label: 'Xiaoxiao', languageCode: 'zh-CN', languageLabel: 'Chinese (Mandarin)', gender: 'female' },
  { id: 'zh-CN-YunxiNeural', label: 'Yunxi', languageCode: 'zh-CN', languageLabel: 'Chinese (Mandarin)', gender: 'male' },
  { id: 'en-GB-SoniaNeural', label: 'Sonia', languageCode: 'en-GB', languageLabel: 'English (UK)', gender: 'female' },
  { id: 'en-GB-RyanNeural', label: 'Ryan', languageCode: 'en-GB', languageLabel: 'English (UK)', gender: 'male' },
  { id: 'en-US-JennyNeural', label: 'Jenny', languageCode: 'en-US', languageLabel: 'English (US)', gender: 'female' },
  { id: 'en-US-GuyNeural', label: 'Guy', languageCode: 'en-US', languageLabel: 'English (US)', gender: 'male' },
  { id: 'fr-CA-SylvieNeural', label: 'Sylvie', languageCode: 'fr-CA', languageLabel: 'French (Canada)', gender: 'female' },
  { id: 'fr-CA-JeanNeural', label: 'Jean', languageCode: 'fr-CA', languageLabel: 'French (Canada)', gender: 'male' },
  { id: 'fr-FR-DeniseNeural', label: 'Denise', languageCode: 'fr-FR', languageLabel: 'French (France)', gender: 'female' },
  { id: 'fr-FR-HenriNeural', label: 'Henri', languageCode: 'fr-FR', languageLabel: 'French (France)', gender: 'male' },
  { id: 'de-DE-KatjaNeural', label: 'Katja', languageCode: 'de-DE', languageLabel: 'German', gender: 'female' },
  { id: 'de-DE-ConradNeural', label: 'Conrad', languageCode: 'de-DE', languageLabel: 'German', gender: 'male' },
  { id: 'hi-IN-SwaraNeural', label: 'Swara', languageCode: 'hi-IN', languageLabel: 'Hindi', gender: 'female' },
  { id: 'hi-IN-MadhurNeural', label: 'Madhur', languageCode: 'hi-IN', languageLabel: 'Hindi', gender: 'male' },
  { id: 'it-IT-ElsaNeural', label: 'Elsa', languageCode: 'it-IT', languageLabel: 'Italian', gender: 'female' },
  { id: 'it-IT-DiegoNeural', label: 'Diego', languageCode: 'it-IT', languageLabel: 'Italian', gender: 'male' },
  { id: 'ja-JP-NanamiNeural', label: 'Nanami', languageCode: 'ja-JP', languageLabel: 'Japanese', gender: 'female' },
  { id: 'ja-JP-KeitaNeural', label: 'Keita', languageCode: 'ja-JP', languageLabel: 'Japanese', gender: 'male' },
  { id: 'ko-KR-SunHiNeural', label: 'SunHi', languageCode: 'ko-KR', languageLabel: 'Korean', gender: 'female' },
  { id: 'ko-KR-InJoonNeural', label: 'InJoon', languageCode: 'ko-KR', languageLabel: 'Korean', gender: 'male' },
  { id: 'pt-BR-FranciscaNeural', label: 'Francisca', languageCode: 'pt-BR', languageLabel: 'Portuguese (Brazil)', gender: 'female' },
  { id: 'pt-BR-AntonioNeural', label: 'Antonio', languageCode: 'pt-BR', languageLabel: 'Portuguese (Brazil)', gender: 'male' },
  { id: 'ru-RU-SvetlanaNeural', label: 'Svetlana', languageCode: 'ru-RU', languageLabel: 'Russian', gender: 'female' },
  { id: 'ru-RU-DmitryNeural', label: 'Dmitry', languageCode: 'ru-RU', languageLabel: 'Russian', gender: 'male' },
  { id: 'es-MX-DaliaNeural', label: 'Dalia', languageCode: 'es-MX', languageLabel: 'Spanish (Mexico)', gender: 'female' },
  { id: 'es-MX-JorgeNeural', label: 'Jorge', languageCode: 'es-MX', languageLabel: 'Spanish (Mexico)', gender: 'male' },
  { id: 'es-ES-ElviraNeural', label: 'Elvira', languageCode: 'es-ES', languageLabel: 'Spanish (Spain)', gender: 'female' },
  { id: 'es-ES-AlvaroNeural', label: 'Alvaro', languageCode: 'es-ES', languageLabel: 'Spanish (Spain)', gender: 'male' },
];

const WHISPER_SPEAK_TOGGLE_COMMAND_ID = 'system-supercommand-whisper-speak-toggle';

type TabId = 'api-models' | 'whisper' | 'speak';

const AITab: React.FC = () => {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('api-models');

  const [showOpenAIKey, setShowOpenAIKey] = useState(false);
  const [showAnthropicKey, setShowAnthropicKey] = useState(false);
  const [showElevenLabsKey, setShowElevenLabsKey] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved'>('idle');

  const [ollamaRunning, setOllamaRunning] = useState<boolean | null>(null);
  const [localModels, setLocalModels] = useState<Set<string>>(new Set());
  const [pullingModel, setPullingModel] = useState<string | null>(null);
  const [pullProgress, setPullProgress] = useState<{ status: string; percent: number }>({ status: '', percent: 0 });
  const [deletingModel, setDeletingModel] = useState<string | null>(null);
  const [ollamaError, setOllamaError] = useState<string | null>(null);
  const [previewingVoice, setPreviewingVoice] = useState(false);
  const [edgeVoices, setEdgeVoices] = useState<EdgeVoiceDef[]>([]);
  const [edgeVoicesLoading, setEdgeVoicesLoading] = useState(false);

  useEffect(() => {
    window.electron.getSettings().then(setSettings);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setEdgeVoicesLoading(true);
    window.electron.edgeTtsListVoices()
      .then((voices: EdgeTtsVoice[]) => {
        if (cancelled) return;
        if (!Array.isArray(voices) || voices.length === 0) {
          setEdgeVoices([]);
          return;
        }
        const mapped: EdgeVoiceDef[] = voices
          .map((v) => ({
            id: String(v.id || '').trim(),
            label: String(v.label || '').trim(),
            languageCode: String(v.languageCode || '').trim(),
            languageLabel: String(v.languageLabel || '').trim(),
            gender: String(v.gender || '').toLowerCase() === 'male' ? 'male' : 'female',
            style: v.style ? String(v.style).trim() : undefined,
          }))
          .filter((v) => v.id && v.label && v.languageCode);
        setEdgeVoices(mapped);
      })
      .catch(() => {
        if (!cancelled) setEdgeVoices([]);
      })
      .finally(() => {
        if (!cancelled) setEdgeVoicesLoading(false);
      });

    return () => { cancelled = true; };
  }, []);

  const updateAI = async (patch: Partial<AISettings>) => {
    if (!settings) return;
    const newAI = { ...settings.ai, ...patch };
    const updated = await window.electron.saveSettings({ ai: newAI } as any);
    setSettings(updated);
    setSaveStatus('saved');
    setTimeout(() => setSaveStatus('idle'), 1600);
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
    setTimeout(() => setSaveStatus('idle'), 1600);
  };

  if (!settings) {
    return <div className="p-6 text-white/50 text-sm">Loading settings...</div>;
  }

  const ai = settings.ai;
  const genericModels = ai.provider === 'ollama' && ollamaRunning
    ? Array.from(localModels).map((name) => ({
        id: `ollama-${name}`,
        label: CURATED_OLLAMA_MODELS.find((m) => m.name === name)?.label || name,
      }))
    : MODELS_BY_PROVIDER[ai.provider] || [];

  const whisperModelValue = (!ai.speechToTextModel || ai.speechToTextModel === 'default')
    ? 'native'
    : ai.speechToTextModel;

  const speakModelValue = (!ai.textToSpeechModel || ai.textToSpeechModel === 'default' || ai.textToSpeechModel.startsWith('openai-'))
    ? 'edge-tts'
    : ai.textToSpeechModel;

  const correctionModelOptions = genericModels;
  const allEdgeVoices = edgeVoices.length > 0 ? edgeVoices : EDGE_TTS_FALLBACK_VOICES;

  const selectedEdgeVoice = allEdgeVoices.find((v) => v.id === ai.edgeTtsVoice)
    || allEdgeVoices.find((v) => v.id === 'en-US-JennyNeural')
    || allEdgeVoices[0];

  const selectedEdgeLanguageCode = selectedEdgeVoice.languageCode;
  const selectedEdgeGender = selectedEdgeVoice.gender;

  const voicesForLanguage = allEdgeVoices.filter((v) => v.languageCode === selectedEdgeLanguageCode);
  const voicesForLanguageAndGender = voicesForLanguage.filter((v) => v.gender === selectedEdgeGender);
  const edgeLanguageOptions = Array.from(
    new Map(
      allEdgeVoices
        .filter((v) => {
          if (!v.languageCode) return false;
          if (!v.languageCode.toLowerCase().startsWith('en-')) return true;
          return v.languageCode === 'en-US' || v.languageCode === 'en-GB';
        })
        .map((v) => [v.languageCode, v.languageLabel || v.languageCode])
    ),
    ([code, label]) => ({ code, label })
  ).sort((a, b) => a.label.localeCompare(b.label));

  const applyEdgeVoice = (voiceId: string) => {
    updateAI({
      edgeTtsVoice: voiceId,
      textToSpeechModel: 'edge-tts',
    });
  };

  const handleEdgeLanguageChange = (languageCode: string) => {
    const candidates = allEdgeVoices.filter((v) => v.languageCode === languageCode);
    if (candidates.length === 0) return;
    const next = candidates.find((v) => v.gender === selectedEdgeGender) || candidates[0];
    applyEdgeVoice(next.id);
  };

  const handleEdgeGenderChange = (gender: EdgeVoiceGender) => {
    const candidates = allEdgeVoices.filter((v) => v.languageCode === selectedEdgeLanguageCode);
    if (candidates.length === 0) return;
    const next = candidates.find((v) => v.gender === gender) || candidates[0];
    applyEdgeVoice(next.id);
  };

  const TabButton = ({ id, label }: { id: TabId; label: string }) => (
    <button
      onClick={() => setActiveTab(id)}
      className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
        activeTab === id
          ? 'bg-blue-500/25 text-blue-200 border border-blue-400/30'
          : 'bg-white/[0.03] text-white/55 border border-white/[0.08] hover:text-white/80 hover:bg-white/[0.06]'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="w-full max-w-6xl mx-auto">
      <div className="bg-white/[0.03] rounded-lg border border-white/[0.07] p-2.5 mb-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Brain className="w-4 h-4 text-white/55" />
            <div>
              <p className="text-sm text-white/90">Enable AI</p>
              <p className="text-[11px] text-white/40">Master switch for AI features.</p>
            </div>
          </div>
          {saveStatus === 'saved' && <span className="text-[11px] text-green-400 mr-1">Saved</span>}
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

      <div className="flex items-center gap-2 mb-2 overflow-x-auto pb-0.5">
        <TabButton id="api-models" label="API Keys & Models" />
        <TabButton id="whisper" label="SuperCommand Whisper" />
        <TabButton id="speak" label="SuperCommand Speak" />
      </div>

      <div className={!ai.enabled ? 'opacity-65 pointer-events-none select-none space-y-2' : 'space-y-2'}>
        {activeTab === 'api-models' && (
          <div className="grid items-start grid-cols-1 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] gap-2">
            <div className="bg-white/[0.03] rounded-lg border border-white/[0.06] p-3 space-y-3 self-start">
              <div>
                <h3 className="text-sm font-medium text-white/90">API Keys</h3>
                <p className="text-[11px] text-white/40 mt-0.5">ChatGPT, Claude, and ElevenLabs credentials.</p>
              </div>

              <div className="grid grid-cols-1 gap-2.5">
                <div>
                  <label className="text-[11px] text-white/45 mb-1 block">ChatGPT (OpenAI) API Key</label>
                  <div className="relative">
                    <input
                      type={showOpenAIKey ? 'text' : 'password'}
                      value={ai.openaiApiKey}
                      onChange={(e) => updateAI({ openaiApiKey: e.target.value.trim() })}
                      placeholder="sk-..."
                      className="w-full bg-white/[0.04] border border-white/[0.08] rounded-md px-2.5 py-2 pr-9 text-sm text-white/90 placeholder-white/30 focus:outline-none focus:border-blue-500/50"
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
                  <label className="text-[11px] text-white/45 mb-1 block">Claude (Anthropic) API Key</label>
                  <div className="relative">
                    <input
                      type={showAnthropicKey ? 'text' : 'password'}
                      value={ai.anthropicApiKey}
                      onChange={(e) => updateAI({ anthropicApiKey: e.target.value.trim() })}
                      placeholder="sk-ant-..."
                      className="w-full bg-white/[0.04] border border-white/[0.08] rounded-md px-2.5 py-2 pr-9 text-sm text-white/90 placeholder-white/30 focus:outline-none focus:border-blue-500/50"
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
                  <label className="text-[11px] text-white/45 mb-1 block">ElevenLabs API Key</label>
                  <div className="relative">
                    <input
                      type={showElevenLabsKey ? 'text' : 'password'}
                      value={ai.elevenlabsApiKey || ''}
                      onChange={(e) => updateAI({ elevenlabsApiKey: e.target.value.trim() })}
                      placeholder="xi-..."
                      className="w-full bg-white/[0.04] border border-white/[0.08] rounded-md px-2.5 py-2 pr-9 text-sm text-white/90 placeholder-white/30 focus:outline-none focus:border-blue-500/50"
                    />
                    <button
                      onClick={() => setShowElevenLabsKey(!showElevenLabsKey)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70"
                    >
                      {showElevenLabsKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-2 self-start">
              <div className="bg-white/[0.03] rounded-lg border border-white/[0.06] p-3 space-y-3">
                <div>
                  <h3 className="text-sm font-medium text-white/90">Generic Model Selection</h3>
                  <p className="text-[11px] text-white/40 mt-0.5">Used by extensions and model-agnostic AI actions.</p>
                </div>

                <div>
                  <label className="text-[11px] text-white/45 mb-1 block">Provider</label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {PROVIDER_OPTIONS.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => updateAI({ provider: p.id, defaultModel: '' })}
                        className={`rounded-md border px-2 py-2 text-left transition-colors ${
                          ai.provider === p.id
                            ? 'bg-blue-500/15 border-blue-500/35 text-blue-100'
                            : 'bg-white/[0.02] border-white/[0.08] text-white/70 hover:bg-white/[0.05]'
                        }`}
                      >
                        <div className="text-xs font-medium leading-tight">{p.label}</div>
                        <div className="text-[10px] text-white/45 mt-0.5 leading-tight">{p.description}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {ai.provider === 'ollama' && (
                  <div>
                    <label className="text-[11px] text-white/45 mb-1 block">Ollama Server URL</label>
                    <input
                      type="text"
                      value={ai.ollamaBaseUrl}
                      onChange={(e) => updateAI({ ollamaBaseUrl: e.target.value.trim() })}
                      placeholder="http://localhost:11434"
                      className="w-full bg-white/[0.04] border border-white/[0.08] rounded-md px-2.5 py-2 text-sm text-white/90 placeholder-white/30 focus:outline-none focus:border-blue-500/50"
                    />
                  </div>
                )}

                <div>
                  <label className="text-[11px] text-white/45 mb-1 block">Default Model</label>
                  <select
                    value={ai.defaultModel}
                    onChange={(e) => updateAI({ defaultModel: e.target.value })}
                    className="w-full bg-white/[0.04] border border-white/[0.08] rounded-md px-2.5 py-2 text-sm text-white/90 focus:outline-none focus:border-blue-500/50"
                  >
                    <option value="">Auto (provider default)</option>
                    {genericModels.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {ai.provider === 'ollama' && (
                <div className="bg-white/[0.03] rounded-lg border border-white/[0.06] p-3">
                  <div className="flex items-center justify-between mb-2.5">
                    <h3 className="text-sm font-medium text-white/90">Ollama Models</h3>
                    {ollamaRunning && (
                      <button
                        onClick={refreshOllamaStatus}
                        className="flex items-center gap-1 px-2 py-1 text-[11px] text-white/45 hover:text-white/75 rounded-md transition-colors"
                      >
                        <RefreshCw className="w-3 h-3" />
                        Refresh
                      </button>
                    )}
                  </div>

                  {ollamaRunning === null && (
                    <div className="flex items-center gap-2 text-white/40 text-xs py-2">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      Checking Ollama status...
                    </div>
                  )}

                  {ollamaRunning === false && (
                    <div className="text-center py-4">
                      <div className="w-9 h-9 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-2.5">
                        <AlertCircle className="w-4 h-4 text-red-400/70" />
                      </div>
                      <p className="text-xs text-white/60 mb-0.5">Ollama is not running</p>
                      <p className="text-[11px] text-white/35 mb-3">Install and run Ollama to use local models.</p>
                      <button
                        onClick={() => window.electron.ollamaOpenDownload()}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 rounded-md transition-colors"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Download Ollama
                        <ExternalLink className="w-3 h-3 text-blue-300/60" />
                      </button>
                    </div>
                  )}

                  {ollamaRunning === true && (
                    <>
                      <div className="flex items-center gap-2 mb-2.5">
                        <div className="w-2 h-2 rounded-full bg-green-400" />
                        <span className="text-[11px] text-green-400/70">Ollama is running</span>
                      </div>

                      {ollamaError && (
                        <div className="bg-red-500/10 border border-red-500/20 rounded-md px-2.5 py-2 mb-2.5">
                          <p className="text-[11px] text-red-400">{ollamaError}</p>
                        </div>
                      )}

                      <div className="space-y-1 max-h-[min(46vh,360px)] overflow-y-auto pr-1">
                        {CURATED_OLLAMA_MODELS.map((model) => {
                          const installed = localModels.has(model.name);
                          const isPulling = pullingModel === model.name;
                          const isDeleting = deletingModel === model.name;

                          return (
                            <div key={model.name} className="rounded-md border border-white/[0.05] bg-white/[0.01] px-2.5 py-2">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-xs text-white/90">{model.label}</span>
                                    <span className="text-[10px] text-white/30">{model.size}</span>
                                    {installed && (
                                      <span className="text-[10px] px-1.5 py-0.5 bg-green-500/15 text-green-400/80 rounded">Installed</span>
                                    )}
                                  </div>
                                  <p className="text-[11px] text-white/35 mt-0.5">{model.description}</p>
                                </div>

                                {isPulling ? (
                                  <div className="flex items-center gap-1 text-[11px] text-white/50">
                                    <RefreshCw className="w-3 h-3 animate-spin" />
                                    {pullProgress.percent > 0 ? `${pullProgress.percent}%` : '...'}
                                  </div>
                                ) : isDeleting ? (
                                  <div className="flex items-center gap-1 text-[11px] text-white/50">
                                    <RefreshCw className="w-3 h-3 animate-spin" />
                                    Removing
                                  </div>
                                ) : installed ? (
                                  <button
                                    onClick={() => handleDelete(model.name)}
                                    disabled={!!pullingModel}
                                    className="flex items-center gap-1 px-2 py-1 text-[11px] text-red-300/80 hover:text-red-200 hover:bg-red-500/10 rounded-md transition-colors"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                    Remove
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => handlePull(model.name)}
                                    disabled={!!pullingModel}
                                    className="flex items-center gap-1 px-2 py-1 text-[11px] text-blue-300 hover:text-blue-200 bg-blue-500/10 hover:bg-blue-500/20 rounded-md transition-colors disabled:opacity-40"
                                  >
                                    <Download className="w-3 h-3" />
                                    Download
                                  </button>
                                )}
                              </div>

                              {isPulling && pullProgress.percent > 0 && (
                                <div className="mt-2">
                                  <div className="w-full h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                                    <div
                                      className="h-full bg-blue-500 rounded-full transition-all duration-300"
                                      style={{ width: `${pullProgress.percent}%` }}
                                    />
                                  </div>
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

        {activeTab === 'whisper' && (
          <div className="grid items-start grid-cols-1 xl:grid-cols-2 gap-2">
            <div className="bg-white/[0.03] rounded-lg border border-white/[0.06] p-3 space-y-3">
              <div className="flex items-center gap-2">
                <Mic className="w-4 h-4 text-white/55" />
                <div>
                  <h3 className="text-sm font-medium text-white/90">SuperCommand Whisper</h3>
                  <p className="text-[11px] text-white/40">Speech-to-text and transcript cleanup.</p>
                </div>
              </div>

              <div>
                <label className="text-[11px] text-white/45 mb-1 block">Transcription Model</label>
                <select
                  value={whisperModelValue}
                  onChange={(e) => updateAI({ speechToTextModel: e.target.value })}
                  className="w-full bg-white/[0.04] border border-white/[0.08] rounded-md px-2.5 py-2 text-sm text-white/90 focus:outline-none focus:border-blue-500/50"
                >
                  {WHISPER_STT_OPTIONS.map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
              </div>

              {whisperModelValue.startsWith('openai-') && !ai.openaiApiKey && (
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-md px-2.5 py-2">
                  <p className="text-[11px] text-amber-300">OpenAI Whisper selected. Add OpenAI API key in API Keys & Models.</p>
                </div>
              )}

              {whisperModelValue.startsWith('elevenlabs-') && (
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-md px-2.5 py-2">
                  <p className="text-[11px] text-amber-300">ElevenLabs Whisper option is shown for planning, but Native/OpenAI are currently the supported runtime paths.</p>
                </div>
              )}
            </div>

            <div className="bg-white/[0.03] rounded-lg border border-white/[0.06] p-3 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium text-white/90">Smooth Output</h3>
                  <p className="text-[11px] text-white/40 mt-0.5">Clean up filler words and self-corrections.</p>
                </div>
                <button
                  onClick={() => updateAI({ speechCorrectionEnabled: !ai.speechCorrectionEnabled })}
                  className={`relative w-10 h-6 rounded-full transition-colors ${
                    ai.speechCorrectionEnabled ? 'bg-blue-500' : 'bg-white/10'
                  }`}
                  aria-label="Toggle whisper smoothing"
                >
                  <span
                    className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                      ai.speechCorrectionEnabled ? 'left-5' : 'left-1'
                    }`}
                  />
                </button>
              </div>

              {ai.speechCorrectionEnabled && (
                <div>
                  <label className="text-[11px] text-white/45 mb-1 block">Smoothing Model</label>
                  <select
                    value={ai.speechCorrectionModel || ''}
                    onChange={(e) => updateAI({ speechCorrectionModel: e.target.value })}
                    className="w-full bg-white/[0.04] border border-white/[0.08] rounded-md px-2.5 py-2 text-sm text-white/90 focus:outline-none focus:border-blue-500/50"
                  >
                    <option value="">Use Generic Default Model</option>
                    {correctionModelOptions.map((m) => (
                      <option key={m.id} value={m.id}>{m.label}</option>
                    ))}
                  </select>
                  <p className="text-[11px] text-white/35 mt-1">Uses your current provider models.</p>
                </div>
              )}

              <div className="bg-white/[0.02] rounded-md border border-white/[0.06] p-2.5">
                <p className="text-[11px] text-white/45 mb-1.5">Start/Stop Speaking Hotkey</p>
                <HotkeyRecorder
                  value={(settings.commandHotkeys || {})[WHISPER_SPEAK_TOGGLE_COMMAND_ID] || 'Command+.'}
                  onChange={(hotkey) => { void handleWhisperHotkeyChange(WHISPER_SPEAK_TOGGLE_COMMAND_ID, hotkey); }}
                  compact
                />
              </div>
            </div>
          </div>
        )}

        {activeTab === 'speak' && (
          <div className="grid items-start grid-cols-1 xl:grid-cols-2 gap-2">
            <div className="bg-white/[0.03] rounded-lg border border-white/[0.06] p-3 space-y-3">
              <div className="flex items-center gap-2">
                <Volume2 className="w-4 h-4 text-white/55" />
                <div>
                  <h3 className="text-sm font-medium text-white/90">SuperCommand Speak</h3>
                  <p className="text-[11px] text-white/40">Read selected text aloud.</p>
                </div>
              </div>

              <div>
                <label className="text-[11px] text-white/45 mb-1 block">Speech Provider</label>
                <select
                  value={speakModelValue}
                  onChange={(e) => {
                    const nextModel = e.target.value;
                    if (nextModel === 'edge-tts') {
                      updateAI({ textToSpeechModel: 'edge-tts' });
                      return;
                    }
                    updateAI({ textToSpeechModel: nextModel });
                  }}
                  className="w-full bg-white/[0.04] border border-white/[0.08] rounded-md px-2.5 py-2 text-sm text-white/90 focus:outline-none focus:border-blue-500/50"
                >
                  {SPEAK_TTS_OPTIONS.map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
              </div>

              {speakModelValue === 'edge-tts' && (
                <div className="bg-white/[0.02] rounded-md border border-white/[0.06] p-2.5 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] text-white/45">Edge TTS Voice</p>
                    {edgeVoicesLoading && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-white/40">
                        <RefreshCw className="w-3 h-3 animate-spin" />
                        Fetching full voice list...
                      </span>
                    )}
                  </div>

                  <div>
                    <label className="text-[11px] text-white/45 mb-1 block">Language</label>
                    <select
                      value={selectedEdgeLanguageCode}
                      onChange={(e) => handleEdgeLanguageChange(e.target.value)}
                      className="w-full bg-white/[0.04] border border-white/[0.08] rounded-md px-2.5 py-2 text-sm text-white/90 focus:outline-none focus:border-blue-500/50"
                    >
                      {edgeLanguageOptions.map((lang) => (
                        <option key={lang.code} value={lang.code}>{lang.label}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-[11px] text-white/45 mb-1 block">Voice Gender</label>
                    <select
                      value={selectedEdgeGender}
                      onChange={(e) => handleEdgeGenderChange(e.target.value as EdgeVoiceGender)}
                      className="w-full bg-white/[0.04] border border-white/[0.08] rounded-md px-2.5 py-2 text-sm text-white/90 focus:outline-none focus:border-blue-500/50"
                    >
                      <option value="female">Female</option>
                      <option value="male">Male</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-[11px] text-white/45 mb-1 block">Voice</label>
                    <select
                      value={selectedEdgeVoice.id}
                      onChange={(e) => applyEdgeVoice(e.target.value)}
                      className="w-full bg-white/[0.04] border border-white/[0.08] rounded-md px-2.5 py-2 text-sm text-white/90 focus:outline-none focus:border-blue-500/50"
                    >
                      {(voicesForLanguageAndGender.length > 0 ? voicesForLanguageAndGender : voicesForLanguage).map((voice) => (
                        <option key={voice.id} value={voice.id}>
                          {voice.style ? `${voice.label} (${voice.style})` : voice.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <button
                    type="button"
                    disabled={previewingVoice}
                    onClick={async () => {
                      try {
                        setPreviewingVoice(true);
                        const intro = `Hi, this is ${selectedEdgeVoice.label}. This is my voice in SuperCommand.`;
                        await window.electron.speakPreviewVoice({
                          voice: selectedEdgeVoice.id,
                          text: intro,
                        });
                      } catch {
                        // Keep silent for compact UX; failures are non-blocking preview only.
                      } finally {
                        setPreviewingVoice(false);
                      }
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs text-blue-200 bg-blue-500/15 border border-blue-400/25 hover:bg-blue-500/25 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {previewingVoice ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Volume2 className="w-3 h-3" />}
                    {previewingVoice ? 'Playing sample...' : 'Play Sample Voice'}
                  </button>
                </div>
              )}

              {speakModelValue.startsWith('elevenlabs-') && (
                <div className="bg-white/[0.02] rounded-md border border-white/[0.06] p-2.5">
                  <p className="text-[11px] text-white/45 mb-1">ElevenLabs TTS Model</p>
                  <input
                    type="text"
                    value={ai.textToSpeechModel}
                    onChange={(e) => updateAI({ textToSpeechModel: e.target.value.trim() || 'elevenlabs-multilingual-v2' })}
                    placeholder="elevenlabs-multilingual-v2"
                    className="w-full bg-white/[0.04] border border-white/[0.08] rounded-md px-2.5 py-2 text-sm text-white/90 placeholder-white/30 focus:outline-none focus:border-blue-500/50"
                  />
                </div>
              )}
            </div>

            <div className="bg-white/[0.03] rounded-lg border border-white/[0.06] p-3">
              <h3 className="text-sm font-medium text-white/90">Notes</h3>
              <div className="mt-2 space-y-1.5 text-[11px] text-white/45 leading-relaxed">
                <p>Whisper default is Native for fast local dictation.</p>
                <p>Speak default is Edge TTS with per-language male/female voice selection.</p>
                <p>English voice options are intentionally limited to US and UK variants.</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AITab;
