/**
 * AI Settings Tab
 *
 * Compact grouped layout with horizontal tabs for:
 * - API Keys
 * - LLM
 * - SuperCmd Whisper
 * - SuperCmd Read
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
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
import type { AppSettings, AISettings, EdgeTtsVoice, ElevenLabsVoice } from '../../types/electron';
import {
  clearElevenLabsVoiceCache,
  getCachedElevenLabsVoices,
  setCachedElevenLabsVoices,
} from '../utils/voice-cache';

const PROVIDER_OPTIONS = [
  { id: 'openai' as const, label: 'OpenAI', description: 'GPT family models' },
  { id: 'anthropic' as const, label: 'Claude', description: 'Anthropic Claude models' },
  { id: 'ollama' as const, label: 'Ollama', description: 'Local models' },
  { id: 'openai-compatible' as const, label: 'Custom (OpenAI-compatible)', description: 'Any OpenAI-compatible API (OpenRouter, Together, etc.)' },
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
  { id: 'elevenlabs-scribe-v2', label: 'ElevenLabs Scribe v2' },
];

const SPEAK_TTS_OPTIONS = [
  { id: 'edge-tts', label: 'Edge TTS (Default)' },
  { id: 'elevenlabs-multilingual-v2', label: 'ElevenLabs Multilingual v2' },
  { id: 'elevenlabs-flash-v2-5', label: 'ElevenLabs Flash v2.5' },
  { id: 'elevenlabs-turbo-v2-5', label: 'ElevenLabs Turbo v2.5' },
  { id: 'elevenlabs-v3', label: 'ElevenLabs v3 (Alpha)' },
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

type ElevenLabsVoiceDef = {
  id: string;
  label: string;
};

const ELEVENLABS_VOICES: ElevenLabsVoiceDef[] = [
  { id: '21m00Tcm4TlvDq8ikWAM', label: 'Rachel' },
  { id: 'AZnzlk1XvdvUeBnXmlld', label: 'Domi' },
  { id: 'EXAVITQu4vr4xnSDxMaL', label: 'Bella' },
  { id: 'ErXwobaYiN019PkySvjV', label: 'Antoni' },
  { id: 'MF3mGyEYCl7XYWbV9V6O', label: 'Elli' },
  { id: 'TxGEqnHWrfWFTfGW9XjX', label: 'Josh' },
  { id: 'VR6AewLTigWG4xSOukaG', label: 'Arnold' },
  { id: 'pNInz6obpgDQGcFmaJgB', label: 'Adam' },
  { id: 'yoZ06aMxZJJ28mfd3POQ', label: 'Sam' },
];

const DEFAULT_ELEVENLABS_VOICE_ID = ELEVENLABS_VOICES[0].id;

function parseElevenLabsSpeakModel(raw: string): { model: string; voiceId: string } {
  const value = String(raw || '').trim();
  const explicitVoice = /@([A-Za-z0-9]{8,})$/.exec(value)?.[1];
  const modelOnly = explicitVoice ? value.replace(/@[A-Za-z0-9]{8,}$/, '') : value;
  const model = modelOnly.startsWith('elevenlabs-') ? modelOnly : 'elevenlabs-multilingual-v2';
  const voiceId = explicitVoice || DEFAULT_ELEVENLABS_VOICE_ID;
  return { model, voiceId };
}

function buildElevenLabsSpeakModel(model: string, voiceId: string): string {
  const normalizedModel = String(model || '').trim() || 'elevenlabs-multilingual-v2';
  const normalizedVoice = String(voiceId || '').trim() || DEFAULT_ELEVENLABS_VOICE_ID;
  return `${normalizedModel}@${normalizedVoice}`;
}

function normalizeOllamaModelName(raw: string): string {
  return String(raw || '').trim().replace(/:latest$/i, '');
}

const EDGE_TTS_FALLBACK_VOICES: EdgeVoiceDef[] = [
  { id: 'ar-EG-SalmaNeural', label: 'Salma', languageCode: 'ar-EG', languageLabel: 'Arabic', gender: 'female' },
  { id: 'ar-EG-ShakirNeural', label: 'Shakir', languageCode: 'ar-EG', languageLabel: 'Arabic', gender: 'male' },
  { id: 'zh-CN-XiaoxiaoNeural', label: 'Xiaoxiao', languageCode: 'zh-CN', languageLabel: 'Chinese (Mandarin)', gender: 'female' },
  { id: 'zh-CN-YunxiNeural', label: 'Yunxi', languageCode: 'zh-CN', languageLabel: 'Chinese (Mandarin)', gender: 'male' },
  { id: 'en-GB-SoniaNeural', label: 'Sonia', languageCode: 'en-GB', languageLabel: 'English (UK)', gender: 'female' },
  { id: 'en-GB-RyanNeural', label: 'Ryan', languageCode: 'en-GB', languageLabel: 'English (UK)', gender: 'male' },
  { id: 'en-US-JennyNeural', label: 'Jenny', languageCode: 'en-US', languageLabel: 'English (US)', gender: 'female' },
  { id: 'en-US-EricNeural', label: 'Eric', languageCode: 'en-US', languageLabel: 'English (US)', gender: 'male' },
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

const WHISPER_SPEAK_TOGGLE_COMMAND_ID = 'system-supercmd-whisper-speak-toggle';

type TabId = 'api-keys' | 'llm' | 'whisper' | 'speak';

const AITab: React.FC = () => {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('api-keys');

  const [showOpenAIKey, setShowOpenAIKey] = useState(false);
  const [showAnthropicKey, setShowAnthropicKey] = useState(false);
  const [showElevenLabsKey, setShowElevenLabsKey] = useState(false);
  const [showSupermemoryKey, setShowSupermemoryKey] = useState(false);
  const [showOpenAICompatibleKey, setShowOpenAICompatibleKey] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved'>('idle');
  const [hotkeyStatus, setHotkeyStatus] = useState<{
    type: 'idle' | 'success' | 'error';
    text: string;
  }>({ type: 'idle', text: '' });

  const [ollamaRunning, setOllamaRunning] = useState<boolean | null>(null);
  const [localModels, setLocalModels] = useState<Set<string>>(new Set());
  const [pullingModel, setPullingModel] = useState<string | null>(null);
  const [pullProgress, setPullProgress] = useState<{ status: string; percent: number }>({ status: '', percent: 0 });
  const [deletingModel, setDeletingModel] = useState<string | null>(null);
  const [ollamaError, setOllamaError] = useState<string | null>(null);
  const [previewingVoice, setPreviewingVoice] = useState(false);
  const [edgeVoices, setEdgeVoices] = useState<EdgeVoiceDef[]>([]);
  const [edgeVoicesLoading, setEdgeVoicesLoading] = useState(false);
  const [elevenLabsVoices, setElevenLabsVoices] = useState<ElevenLabsVoice[]>([]);
  const [elevenLabsVoicesLoading, setElevenLabsVoicesLoading] = useState(false);
  const [elevenLabsVoicesError, setElevenLabsVoicesError] = useState<string | null>(null);
  const settingsRef = useRef<AppSettings | null>(null);
  const pullingModelRef = useRef<string | null>(null);
  const selectingOllamaDefaultRef = useRef(false);

  useEffect(() => {
    window.electron.getSettings().then(setSettings);
  }, []);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

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
            gender: (String(v.gender || '').toLowerCase() === 'male' ? 'male' : 'female') as EdgeVoiceGender,
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

  // Fetch ElevenLabs voices when API key is present and tab is speak
  useEffect(() => {
    let cancelled = false;
    const fetchVoices = async () => {
      if (!settings?.ai?.elevenlabsApiKey || activeTab !== 'speak') {
        setElevenLabsVoices([]);
        setElevenLabsVoicesError(null);
        return;
      }

      // Check shared cache first
      const cached = getCachedElevenLabsVoices();
      if (cached) {
        setElevenLabsVoices(cached);
        setElevenLabsVoicesLoading(false);
        return;
      }

      setElevenLabsVoicesLoading(true);
      setElevenLabsVoicesError(null);
      try {
        const result = await window.electron.elevenLabsListVoices();
        if (cancelled) return;
        if (result.error) {
          clearElevenLabsVoiceCache();
          setElevenLabsVoicesError(result.error);
          setElevenLabsVoices([]);
        } else {
          setElevenLabsVoices(result.voices);
          // Update shared cache
          setCachedElevenLabsVoices(result.voices);
        }
      } catch {
        if (!cancelled) {
          setElevenLabsVoicesError('Failed to fetch voices.');
          setElevenLabsVoices([]);
        }
      } finally {
        if (!cancelled) setElevenLabsVoicesLoading(false);
      }
    };
    fetchVoices();
    return () => { cancelled = true; };
  }, [settings?.ai?.elevenlabsApiKey, activeTab]);

  const updateAI = async (patch: Partial<AISettings>) => {
    if (!settings) return;
    const newAI = { ...settings.ai, ...patch };
    const updated = await window.electron.saveSettings({ ai: newAI } as any);
    setSettings(updated);
    setSaveStatus('saved');
    setTimeout(() => setSaveStatus('idle'), 1600);
  };

  const maybeSelectOllamaDefaultModel = useCallback((availableNames: string[], preferredName?: string) => {
    const currentSettings = settingsRef.current;
    if (!currentSettings) return;
    if (currentSettings.ai.provider !== 'ollama') return;
    if (availableNames.length === 0) return;

    const configuredDefault = String(currentSettings.ai.defaultModel || '').trim();
    const configuredName = configuredDefault.startsWith('ollama-')
      ? normalizeOllamaModelName(configuredDefault.slice('ollama-'.length))
      : '';
    if (configuredName && availableNames.includes(configuredName)) return;

    const preferred = normalizeOllamaModelName(preferredName || '');
    const targetName = preferred && availableNames.includes(preferred)
      ? preferred
      : availableNames[0];
    const nextDefault = `ollama-${targetName}`;
    if (configuredDefault === nextDefault || selectingOllamaDefaultRef.current) return;

    selectingOllamaDefaultRef.current = true;
    window.electron.saveSettings({
      ai: {
        ...currentSettings.ai,
        defaultModel: nextDefault,
      },
    } as any).then((updated) => {
      settingsRef.current = updated;
      setSettings(updated);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 1600);
    }).catch(() => {}).finally(() => {
      selectingOllamaDefaultRef.current = false;
    });
  }, []);

  const refreshOllamaStatus = useCallback((preferredModelName?: string) => {
    setOllamaRunning(null);
    window.electron.ollamaStatus().then((result) => {
      setOllamaRunning(result.running);
      if (result.running) {
        const names = Array.from(new Set(
          result.models
            .map((m: any) => normalizeOllamaModelName(m?.name))
            .filter(Boolean)
        ));
        setLocalModels(new Set(names));
        maybeSelectOllamaDefaultModel(names, preferredModelName);
      } else {
        setLocalModels(new Set());
      }
    });
  }, [maybeSelectOllamaDefaultModel]);

  useEffect(() => {
    if (!settings) return;
    refreshOllamaStatus();
  }, [settings?.ai?.ollamaBaseUrl, settings?.ai?.provider, refreshOllamaStatus]);

  useEffect(() => {
    window.electron.onOllamaPullProgress((data) => {
      const percent = data.total > 0 ? Math.round((data.completed / data.total) * 100) : 0;
      setPullProgress({ status: data.status, percent });
    });
    window.electron.onOllamaPullDone(() => {
      const preferredModel = pullingModelRef.current || undefined;
      pullingModelRef.current = null;
      setPullingModel(null);
      setPullProgress({ status: '', percent: 0 });
      refreshOllamaStatus(preferredModel);
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
    pullingModelRef.current = modelName;
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
    const result = await window.electron.updateCommandHotkey(commandId, hotkey);
    if (!result.success) {
      const message = result.error === 'duplicate'
        ? 'Hotkey already used by another SuperCmd command.'
        : 'Hotkey unavailable. It may be used by macOS or another app.';
      setHotkeyStatus({ type: 'error', text: message });
      setTimeout(() => setHotkeyStatus({ type: 'idle', text: '' }), 3200);
      return;
    }
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
    setHotkeyStatus({ type: 'success', text: hotkey ? 'Hotkey updated.' : 'Hotkey removed.' });
    setTimeout(() => setHotkeyStatus({ type: 'idle', text: '' }), 1800);
    setSaveStatus('saved');
    setTimeout(() => setSaveStatus('idle'), 1600);
  };

  if (!settings) {
    return <div className="p-5 text-white/50 text-[12px]">Loading settings...</div>;
  }

  const ai = settings.ai;
  const genericModels = ai.provider === 'ollama' && ollamaRunning
    ? Array.from(localModels).map((name) => ({
        id: `ollama-${name}`,
        label: CURATED_OLLAMA_MODELS.find((m) => m.name === name)?.label || name,
      }))
    : ai.provider === 'openai-compatible' && ai.openaiCompatibleModel
      ? [{
          id: `openai-compatible-${ai.openaiCompatibleModel}`,
          label: ai.openaiCompatibleModel,
        }]
      : MODELS_BY_PROVIDER[ai.provider] || [];

  const whisperModelValue = (!ai.speechToTextModel || ai.speechToTextModel === 'default')
    ? 'native'
    : ai.speechToTextModel;

  const parsedElevenLabsSpeak = parseElevenLabsSpeakModel(ai.textToSpeechModel);
  const speakModelValue = (!ai.textToSpeechModel || ai.textToSpeechModel === 'default' || ai.textToSpeechModel.startsWith('openai-'))
    ? 'edge-tts'
    : ai.textToSpeechModel.startsWith('elevenlabs-')
      ? parsedElevenLabsSpeak.model
      : ai.textToSpeechModel;
  const isValidVoiceId = ELEVENLABS_VOICES.some((voice) => voice.id === parsedElevenLabsSpeak.voiceId) ||
    elevenLabsVoices.some((voice) => voice.id === parsedElevenLabsSpeak.voiceId);
  const selectedElevenLabsVoiceId = isValidVoiceId
    ? parsedElevenLabsSpeak.voiceId
    : DEFAULT_ELEVENLABS_VOICE_ID;

  const correctionModelOptions = genericModels;
  const allEdgeVoices = edgeVoices.length > 0 ? edgeVoices : EDGE_TTS_FALLBACK_VOICES;

  const selectedEdgeVoice = allEdgeVoices.find((v) => v.id === ai.edgeTtsVoice)
    || allEdgeVoices.find((v) => v.id === 'en-US-EricNeural')
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
      className={`px-2.5 py-1 rounded-md text-[12px] font-medium transition-colors ${
        activeTab === id
          ? 'bg-blue-500/25 text-blue-200 border border-blue-400/30'
          : 'bg-white/[0.03] text-white/55 border border-white/[0.08] hover:text-white/80 hover:bg-white/[0.06]'
      }`}
    >
      {label}
    </button>
  );

  const AIRow: React.FC<{
    icon: React.ReactNode;
    title: string;
    description: string;
    withBorder?: boolean;
    children: React.ReactNode;
  }> = ({ icon, title, description, withBorder = true, children }) => (
    <div
      className={`grid gap-3 px-4 py-3.5 md:px-5 md:grid-cols-[220px_minmax(0,1fr)] ${
        withBorder ? 'border-b border-white/[0.08]' : ''
      }`}
    >
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 text-white/65 shrink-0">{icon}</div>
        <div className="min-w-0">
          <h3 className="text-[13px] font-semibold text-white/95">{title}</h3>
          <p className="mt-0.5 text-[12px] text-white/50 leading-snug">{description}</p>
        </div>
      </div>
      <div className="flex items-center min-h-[32px]">{children}</div>
    </div>
  );

  const SectionToggle = ({
    enabled,
    onToggle,
    label,
  }: {
    enabled: boolean;
    onToggle: () => void;
    label: string;
  }) => (
    <button
      onClick={onToggle}
      className={`relative w-10 h-6 rounded-full transition-colors ${enabled ? 'bg-blue-500' : 'bg-white/10'}`}
      aria-label={label}
    >
      <span
        className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${enabled ? 'left-5' : 'left-1'}`}
      />
    </button>
  );

  return (
    <div className="w-full max-w-[980px] mx-auto">
      <div className="overflow-hidden rounded-xl border border-white/[0.10] bg-[rgba(20,20,20,0.34)]">
      <AIRow
        icon={<Brain className="w-4 h-4" />}
        title="Enable AI"
        description="Master switch for AI features."
      >
        <div className="flex items-center gap-2">
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
          {saveStatus === 'saved' && <span className="text-[12px] text-green-400">Saved</span>}
        </div>
      </AIRow>

      <div className="flex items-center gap-1.5 px-4 py-3 border-b border-white/[0.08] md:px-5 overflow-x-auto">
        <TabButton id="api-keys" label="API Keys" />
        <TabButton id="llm" label="LLM" />
        <TabButton id="whisper" label="SuperCmd Whisper" />
        <TabButton id="speak" label="SuperCmd Read" />
      </div>

      <div className={`${!ai.enabled ? 'opacity-65 pointer-events-none select-none' : ''}`}>
        {(activeTab === 'api-keys' || activeTab === 'llm') && (
          <div className="grid grid-cols-1">
            <div className={`px-4 py-3.5 md:px-5 space-y-3 ${activeTab === 'llm' ? 'hidden' : ''}`}>
                <div>
                  <label className="text-[12px] text-white/50 mb-1 block">ChatGPT (OpenAI) API Key</label>
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
                  <label className="text-[12px] text-white/50 mb-1 block">Claude (Anthropic) API Key</label>
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
                  <label className="text-[12px] text-white/50 mb-1 block">ElevenLabs API Key</label>
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

                <div className="pt-1 border-t border-white/[0.06]">
                  <p className="text-[13px] font-semibold text-white/95">Supermemory</p>
                  <p className="text-[12px] text-white/50 mt-0.5 leading-snug">Memory backend for long-term context.</p>
                </div>

                <div>
                  <label className="text-[12px] text-white/50 mb-1 block">Supermemory API Key</label>
                  <div className="relative">
                    <input
                      type={showSupermemoryKey ? 'text' : 'password'}
                      value={ai.supermemoryApiKey || ''}
                      onChange={(e) => updateAI({ supermemoryApiKey: e.target.value.trim() })}
                      placeholder="sm-..."
                      className="w-full bg-white/[0.04] border border-white/[0.08] rounded-md px-2.5 py-2 pr-9 text-sm text-white/90 placeholder-white/30 focus:outline-none focus:border-blue-500/50"
                    />
                    <button
                      onClick={() => setShowSupermemoryKey(!showSupermemoryKey)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70"
                    >
                      {showSupermemoryKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-[12px] text-white/50 mb-1 block">Supermemory Client</label>
                  <input
                    type="text"
                    value={ai.supermemoryClient || ''}
                    onChange={(e) => updateAI({ supermemoryClient: e.target.value.trim() })}
                    placeholder="client-123"
                    className="w-full bg-white/[0.04] border border-white/[0.08] rounded-md px-2.5 py-2 text-sm text-white/90 placeholder-white/30 focus:outline-none focus:border-blue-500/50"
                  />
                  <p className="text-[10px] text-white/35 mt-1">Used to scope user memory retrieval.</p>
                </div>

                <div>
                  <label className="text-[12px] text-white/50 mb-1 block">Supermemory Base URL</label>
                  <input
                    type="text"
                    value={ai.supermemoryBaseUrl || 'https://api.supermemory.ai'}
                    onChange={(e) => updateAI({ supermemoryBaseUrl: e.target.value.trim() })}
                    placeholder="https://api.supermemory.ai"
                    className="w-full bg-white/[0.04] border border-white/[0.08] rounded-md px-2.5 py-2 text-sm text-white/90 placeholder-white/30 focus:outline-none focus:border-blue-500/50"
                  />
                </div>

                <label className="inline-flex items-center gap-2 text-[11px] text-white/65">
                  <input
                    type="checkbox"
                    checked={Boolean(ai.supermemoryLocalMode)}
                    onChange={(e) => updateAI({ supermemoryLocalMode: e.target.checked })}
                  />
                  <span>Use local Supermemory mode (allow requests without API key)</span>
                </label>
            </div>

            <div className={`px-4 py-3.5 md:px-5 space-y-3 self-start ${activeTab === 'llm' ? '' : 'hidden'}`}>
              <div className="flex items-center justify-between gap-3 pb-1">
                <div>
                  <h3 className="text-[13px] font-semibold text-white/95">Enable LLM</h3>
                  <p className="text-[12px] text-white/50 mt-0.5 leading-snug">Toggle model-based AI features.</p>
                </div>
                <SectionToggle
                  enabled={ai.llmEnabled !== false}
                  onToggle={() => updateAI({ llmEnabled: ai.llmEnabled === false })}
                  label="Toggle LLM section"
                />
              </div>

              <div className={`${ai.llmEnabled === false ? 'opacity-65 pointer-events-none select-none' : ''}`}>
              <div>
                <h3 className="text-[13px] font-semibold text-white/95">Generic Model Selection</h3>
                <p className="text-[12px] text-white/50 mt-0.5 leading-snug">Used by extensions and model-agnostic AI actions.</p>
              </div>

              <div>
                  <label className="text-[12px] text-white/50 mb-1 block">Provider</label>
                  <div className="grid grid-cols-2 gap-2">
                    {PROVIDER_OPTIONS.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => {
                          if (p.id === 'ollama') {
                            const firstInstalled = Array.from(localModels)[0];
                            const nextDefault = firstInstalled ? `ollama-${firstInstalled}` : '';
                            updateAI({ provider: p.id, defaultModel: nextDefault });
                            return;
                          }
                          if (p.id === 'openai-compatible') {
                            const nextDefault = ai.openaiCompatibleModel ? `openai-compatible-${ai.openaiCompatibleModel}` : '';
                            updateAI({ provider: p.id, defaultModel: nextDefault });
                            return;
                          }
                          updateAI({ provider: p.id, defaultModel: '' });
                        }}
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
                    <label className="text-[12px] text-white/50 mb-1 block">Ollama Server URL</label>
                    <input
                      type="text"
                      value={ai.ollamaBaseUrl}
                      onChange={(e) => updateAI({ ollamaBaseUrl: e.target.value.trim() })}
                      placeholder="http://localhost:11434"
                      className="w-full bg-white/[0.04] border border-white/[0.08] rounded-md px-2.5 py-2 text-sm text-white/90 placeholder-white/30 focus:outline-none focus:border-blue-500/50"
                    />
                  </div>
                )}

                {ai.provider === 'openai-compatible' && (
                  <div className="space-y-3">
                    <div>
                      <label className="text-[12px] text-white/50 mb-1 block">Base URL</label>
                      <input
                        type="text"
                        value={ai.openaiCompatibleBaseUrl}
                        onChange={(e) => updateAI({ openaiCompatibleBaseUrl: e.target.value.trim() })}
                        placeholder="https://api.openrouter.ai/v1"
                        className="w-full bg-white/[0.04] border border-white/[0.08] rounded-md px-2.5 py-2 text-sm text-white/90 placeholder-white/30 focus:outline-none focus:border-blue-500/50"
                      />
                      <p className="text-[10px] text-white/35 mt-1">Include /v1 if your provider uses it (e.g., https://api.openai.com/v1)</p>
                    </div>

                    <div>
                      <label className="text-[12px] text-white/50 mb-1 block">API Key</label>
                      <div className="relative">
                        <input
                          type={showOpenAICompatibleKey ? 'text' : 'password'}
                          value={ai.openaiCompatibleApiKey}
                          onChange={(e) => updateAI({ openaiCompatibleApiKey: e.target.value.trim() })}
                          placeholder="sk-..."
                          className="w-full bg-white/[0.04] border border-white/[0.08] rounded-md px-2.5 py-2 pr-9 text-sm text-white/90 placeholder-white/30 focus:outline-none focus:border-blue-500/50"
                        />
                        <button
                          onClick={() => setShowOpenAICompatibleKey(!showOpenAICompatibleKey)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70"
                        >
                          {showOpenAICompatibleKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="text-[12px] text-white/50 mb-1 block">Model Name</label>
                      <input
                        type="text"
                        value={ai.openaiCompatibleModel}
                        onChange={(e) => {
                          const modelName = e.target.value.trim();
                          updateAI({ 
                            openaiCompatibleModel: modelName,
                            defaultModel: modelName ? `openai-compatible-${modelName}` : ''
                          });
                        }}
                        placeholder="anthropic/claude-3.5-sonnet"
                        className="w-full bg-white/[0.04] border border-white/[0.08] rounded-md px-2.5 py-2 text-sm text-white/90 placeholder-white/30 focus:outline-none focus:border-blue-500/50"
                      />
                      <p className="text-[10px] text-white/35 mt-1">The exact model name your provider expects (e.g., gpt-4o, meta-llama/llama-3.1-70b-instruct)</p>
                    </div>
                  </div>
                )}

                <div className="mt-2">
                  <label className="text-[12px] text-white/50 mb-1 block">Default Model</label>
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

              {ai.provider === 'ollama' && (
                <div className="pt-3 border-t border-white/[0.08]">
                  <div className="flex items-center justify-between mb-2.5">
                    <h3 className="text-[13px] font-semibold text-white/95">Ollama Models</h3>
                    {ollamaRunning && (
                      <button
                        onClick={refreshOllamaStatus}
                        className="flex items-center gap-1 px-2 py-1 text-[12px] text-white/50 hover:text-white/75 rounded-md transition-colors"
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
                      <p className="text-[12px] text-white/45 mb-3">Install and run Ollama to use local models.</p>
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
                                  <p className="text-[12px] text-white/45 mt-0.5">{model.description}</p>
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
          </div>
        )}

        {activeTab === 'whisper' && (
          <>
          <div className="px-4 py-3 md:px-5 border-b border-white/[0.08] flex items-center justify-between gap-3">
            <div>
              <h3 className="text-[13px] font-semibold text-white/95">Enable SuperCmd Whisper</h3>
              <p className="text-[12px] text-white/50 mt-0.5 leading-snug">Toggle speech-to-text features.</p>
            </div>
            <SectionToggle
              enabled={ai.whisperEnabled !== false}
              onToggle={() => updateAI({ whisperEnabled: ai.whisperEnabled === false })}
              label="Toggle SuperCmd Whisper section"
            />
          </div>
          <div className={`grid grid-cols-1 xl:grid-cols-2 gap-0 ${ai.whisperEnabled === false ? 'opacity-65 pointer-events-none select-none' : ''}`}>
            <div className="px-4 py-3.5 md:px-5 space-y-3 border-b border-white/[0.08] xl:border-b-0 xl:border-r xl:border-white/[0.08]">
              <div className="flex items-center gap-2">
                <Mic className="w-4 h-4 text-white/65 shrink-0" />
                <div>
                  <h3 className="text-[13px] font-semibold text-white/95">SuperCmd Whisper</h3>
                  <p className="text-[12px] text-white/50 mt-0.5 leading-snug">Speech-to-text and transcript cleanup.</p>
                </div>
              </div>

              <div>
                <label className="text-[12px] text-white/50 mb-1 block">Transcription Model</label>
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
                  <p className="text-[11px] text-amber-300">OpenAI Whisper selected. Add OpenAI API key in API Keys.</p>
                </div>
              )}

              {whisperModelValue.startsWith('elevenlabs-') && (
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-md px-2.5 py-2">
                  <p className="text-[11px] text-amber-300">
                    {ai.elevenlabsApiKey
                      ? 'ElevenLabs STT selected. Cloud transcription will use your ElevenLabs key.'
                      : 'ElevenLabs STT selected. Add ElevenLabs API key in API Keys.'}
                  </p>
                </div>
              )}

              <div className="pt-2 border-t border-white/[0.08] space-y-2">
                <p className="text-[12px] text-white/50">Whisper Hotkeys</p>
                <div>
                  <p className="text-[12px] text-white/50 mb-1.5">Start/Stop Speaking</p>
                  <HotkeyRecorder
                    value={(settings.commandHotkeys || {})[WHISPER_SPEAK_TOGGLE_COMMAND_ID] || 'Fn'}
                    onChange={(hotkey) => { void handleWhisperHotkeyChange(WHISPER_SPEAK_TOGGLE_COMMAND_ID, hotkey); }}
                    compact
                  />
                </div>
                {hotkeyStatus.type !== 'idle' ? (
                  <p
                    className={`text-[11px] ${
                      hotkeyStatus.type === 'error' ? 'text-red-300/90' : 'text-emerald-300/90'
                    }`}
                  >
                    {hotkeyStatus.text}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="px-4 py-3.5 md:px-5 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-[13px] font-semibold text-white/95">Smooth Output</h3>
                  <p className="text-[12px] text-white/50 mt-0.5 leading-snug">Clean up filler words and self-corrections.</p>
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
                  <label className="text-[12px] text-white/50 mb-1 block">Smoothing Model</label>
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
                  <p className="text-[12px] text-white/45 mt-1">Uses your current provider models.</p>
                </div>
              )}
            </div>
          </div>
          </>
        )}

        {activeTab === 'speak' && (
          <>
          <div className="px-4 py-3 md:px-5 border-b border-white/[0.08] flex items-center justify-between gap-3">
            <div>
              <h3 className="text-[13px] font-semibold text-white/95">Enable SuperCmd Read</h3>
              <p className="text-[12px] text-white/50 mt-0.5 leading-snug">Toggle text-to-speech features.</p>
            </div>
            <SectionToggle
              enabled={ai.readEnabled !== false}
              onToggle={() => updateAI({ readEnabled: ai.readEnabled === false })}
              label="Toggle SuperCmd Read section"
            />
          </div>
          <div className={`grid grid-cols-1 xl:grid-cols-2 gap-0 ${ai.readEnabled === false ? 'opacity-65 pointer-events-none select-none' : ''}`}>
            <div className="px-4 py-3.5 md:px-5 space-y-3 border-b border-white/[0.08] xl:border-b-0 xl:border-r xl:border-white/[0.08]">
              <div className="flex items-center gap-2">
                <Volume2 className="w-4 h-4 text-white/65 shrink-0" />
                <div>
                  <h3 className="text-[13px] font-semibold text-white/95">SuperCmd Read</h3>
                  <p className="text-[12px] text-white/50 mt-0.5 leading-snug">Read selected text aloud.</p>
                </div>
              </div>

              <div>
                <label className="text-[12px] text-white/50 mb-1 block">Speech Provider</label>
                <select
                  value={speakModelValue}
                  onChange={(e) => {
                    const nextModel = e.target.value;
                    if (nextModel === 'edge-tts') {
                      updateAI({ textToSpeechModel: 'edge-tts' });
                      return;
                    }
                    updateAI({
                      textToSpeechModel: buildElevenLabsSpeakModel(nextModel, selectedElevenLabsVoiceId),
                    });
                  }}
                  className="w-full bg-white/[0.04] border border-white/[0.08] rounded-md px-2.5 py-2 text-sm text-white/90 focus:outline-none focus:border-blue-500/50"
                >
                  {SPEAK_TTS_OPTIONS.map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
              </div>

              {speakModelValue === 'edge-tts' && (
                <div className="pt-2 border-t border-white/[0.08] space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[12px] text-white/50">Edge TTS Voice</p>
                    {edgeVoicesLoading && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-white/40">
                        <RefreshCw className="w-3 h-3 animate-spin" />
                        Fetching full voice list...
                      </span>
                    )}
                  </div>

                  <div>
                    <label className="text-[12px] text-white/50 mb-1 block">Language</label>
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
                    <label className="text-[12px] text-white/50 mb-1 block">Voice Gender</label>
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
                    <label className="text-[12px] text-white/50 mb-1 block">Voice</label>
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
                        const intro = `Hi, this is ${selectedEdgeVoice.label}. This is my voice in SuperCmd.`;
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
                <div className="pt-2 border-t border-white/[0.08] space-y-2.5">
                  <div>
                    <p className="text-[12px] text-white/50 mb-1">ElevenLabs Model</p>
                    <select
                      value={speakModelValue}
                      onChange={(e) =>
                        updateAI({
                          textToSpeechModel: buildElevenLabsSpeakModel(e.target.value, selectedElevenLabsVoiceId),
                        })}
                      className="w-full bg-white/[0.04] border border-white/[0.08] rounded-md px-2.5 py-2 text-sm text-white/90 focus:outline-none focus:border-blue-500/50"
                    >
                      {SPEAK_TTS_OPTIONS.filter((m) => m.id.startsWith('elevenlabs-')).map((m) => (
                        <option key={m.id} value={m.id}>{m.label}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-[12px] text-white/50">ElevenLabs Voice</p>
                      {elevenLabsVoicesLoading && (
                        <span className="text-[10px] text-white/35 flex items-center gap-1">
                          <RefreshCw className="w-3 h-3 animate-spin" />
                          Fetching your voices...
                        </span>
                      )}
                    </div>
                    {elevenLabsVoicesError && (
                      <p className="text-[10px] text-amber-300 mb-1.5">{elevenLabsVoicesError}</p>
                    )}
                    <select
                      value={selectedElevenLabsVoiceId}
                      onChange={(e) =>
                        updateAI({
                          textToSpeechModel: buildElevenLabsSpeakModel(speakModelValue, e.target.value),
                        })}
                      className="w-full bg-white/[0.04] border border-white/[0.08] rounded-md px-2.5 py-2 text-sm text-white/90 focus:outline-none focus:border-blue-500/50"
                    >
                      {ELEVENLABS_VOICES.length > 0 && (
                        <optgroup label="Built-in Voices">
                          {ELEVENLABS_VOICES.map((voice) => (
                            <option key={voice.id} value={voice.id}>
                              {voice.label}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {elevenLabsVoices.filter(v => v.category === 'premade' && !ELEVENLABS_VOICES.some(bv => bv.id === v.id)).length > 0 && (
                        <optgroup label="Additional Premade Voices">
                          {elevenLabsVoices
                            .filter(v => v.category === 'premade' && !ELEVENLABS_VOICES.some(bv => bv.id === v.id))
                            .map((voice) => (
                              <option key={voice.id} value={voice.id}>
                                {voice.name}
                              </option>
                            ))}
                        </optgroup>
                      )}
                      {elevenLabsVoices.filter(v => v.category === 'cloned' || v.category === 'generated').length > 0 && (
                        <optgroup label="Your Custom Voices (Cloned/Generated)">
                          {elevenLabsVoices
                            .filter(v => v.category === 'cloned' || v.category === 'generated')
                            .map((voice) => (
                              <option key={voice.id} value={voice.id}>
                                {voice.name} {voice.labels?.accent ? `(${voice.labels.accent})` : ''}
                              </option>
                            ))}
                        </optgroup>
                      )}
                      {elevenLabsVoices.filter(v => v.category === 'professional').length > 0 && (
                        <optgroup label="Professional Voice Clones">
                          {elevenLabsVoices
                            .filter(v => v.category === 'professional')
                            .map((voice) => (
                              <option key={voice.id} value={voice.id}>
                                {voice.name}
                              </option>
                            ))}
                        </optgroup>
                      )}
                    </select>
                    {elevenLabsVoices.length > 0 && (
                      <p className="text-[10px] text-white/35 mt-1">
                        {elevenLabsVoices.length} custom voice{elevenLabsVoices.length !== 1 ? 's' : ''} available from your ElevenLabs account
                      </p>
                    )}
                  </div>

                  <button
                    type="button"
                    disabled={previewingVoice || !ai.elevenlabsApiKey}
                    onClick={async () => {
                      try {
                        setPreviewingVoice(true);
                        const selectedVoice = ELEVENLABS_VOICES.find((v) => v.id === selectedElevenLabsVoiceId) || elevenLabsVoices.find((v) => v.id === selectedElevenLabsVoiceId);
                        const intro = `Hi, this is ${selectedVoice?.label || selectedVoice?.name || 'my voice'} from ElevenLabs in SuperCmd.`;
                        await window.electron.speakPreviewVoice({
                          provider: 'elevenlabs',
                          model: speakModelValue,
                          voice: selectedElevenLabsVoiceId,
                          text: intro,
                        });
                      } catch {
                        // Non-blocking preview.
                      } finally {
                        setPreviewingVoice(false);
                      }
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs text-blue-200 bg-blue-500/15 border border-blue-400/25 hover:bg-blue-500/25 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {previewingVoice ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Volume2 className="w-3 h-3" />}
                    {previewingVoice ? 'Playing sample...' : 'Play Sample Voice'}
                  </button>

                  <p className="text-[10px] text-white/35">
                    SuperCmd stores this as <code className="text-white/55">{`${speakModelValue}@${selectedElevenLabsVoiceId}`}</code>.
                  </p>
                  {!ai.elevenlabsApiKey && (
                    <p className="text-[11px] text-amber-300 mt-1.5">Add ElevenLabs API key in API Keys.</p>
                  )}
                </div>
              )}
            </div>

            <div className="px-4 py-3.5 md:px-5">
              <h3 className="text-[13px] font-semibold text-white/95">Notes</h3>
              <div className="mt-2 space-y-1.5 text-[12px] text-white/50 leading-relaxed">
                <p>Whisper default is Native for fast local dictation.</p>
                <p>Speak default is Edge TTS with per-language male/female voice selection.</p>
                <p>English voice options are intentionally limited to US and UK variants.</p>
                <p>ElevenLabs custom voices (cloned/generated) will appear automatically when your API key is configured.</p>
              </div>
            </div>
          </div>
          </>
        )}
      </div>
      </div>
    </div>
  );
};

export default AITab;
