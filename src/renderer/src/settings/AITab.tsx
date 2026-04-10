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
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  Mic,
  RefreshCw,
  Trash2,
  Volume2,
} from 'lucide-react';
import HotkeyRecorder from './HotkeyRecorder';
import type {
  AppSettings,
  AISettings,
  EdgeTtsVoice,
  ElevenLabsVoice,
  WhisperCppModelStatus,
  ParakeetModelStatus,
  Qwen3ModelStatus,
} from '../../types/electron';
import { useI18n } from '../i18n';
import {
  clearElevenLabsVoiceCache,
  getCachedElevenLabsVoices,
  setCachedElevenLabsVoices,
} from '../utils/voice-cache';

const getProviderOptions = (t: (key: string) => string) => [
  { id: 'openai' as const, label: t('settings.ai.llm.provider.openai'), description: t('settings.ai.llm.providerDescriptions.openai') },
  { id: 'anthropic' as const, label: t('settings.ai.llm.provider.anthropic'), description: t('settings.ai.llm.providerDescriptions.anthropic') },
  { id: 'gemini' as const, label: t('settings.ai.llm.provider.gemini'), description: t('settings.ai.llm.providerDescriptions.gemini') },
  { id: 'ollama' as const, label: t('settings.ai.llm.provider.ollama'), description: t('settings.ai.llm.providerDescriptions.ollama') },
  { id: 'openai-compatible' as const, label: t('settings.ai.llm.provider.openaiCompatible'), description: t('settings.ai.llm.providerDescriptions.openaiCompatible') },
];

const getWhisperSttOptions = (t: (key: string) => string) => [
  { id: 'whispercpp', label: t('settings.ai.whisper.modelOptions.whispercpp') },
  { id: 'parakeet', label: t('settings.ai.whisper.modelOptions.parakeet') },
  { id: 'qwen3', label: t('settings.ai.whisper.modelOptions.qwen3') },
  { id: 'native', label: t('settings.ai.whisper.modelOptions.native') },
  { id: 'openai-gpt-4o-transcribe', label: t('settings.ai.whisper.modelOptions.openaiGpt4o') },
  { id: 'openai-whisper-1', label: t('settings.ai.whisper.modelOptions.openaiWhisper') },
  { id: 'elevenlabs-scribe-v1', label: t('settings.ai.whisper.modelOptions.elevenlabsScribeV1') },
  { id: 'elevenlabs-scribe-v2', label: t('settings.ai.whisper.modelOptions.elevenlabsScribeV2') },
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
  gemini: [
    { id: 'gemini-gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { id: 'gemini-gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { id: 'gemini-gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite' },
  ],
};

const getCuratedOllamaModels = (t: (key: string) => string) => [
  { name: 'llama3.2', label: 'Llama 3.2', size: '2.0 GB', description: t('settings.ai.llm.ollama.curatedDescriptions.llama32') },
  { name: 'llama3.2:1b', label: 'Llama 3.2 (1B)', size: '1.3 GB', description: t('settings.ai.llm.ollama.curatedDescriptions.llama32_1b') },
  { name: 'mistral', label: 'Mistral 7B', size: '4.1 GB', description: t('settings.ai.llm.ollama.curatedDescriptions.mistral') },
  { name: 'codellama', label: 'Code Llama', size: '3.8 GB', description: t('settings.ai.llm.ollama.curatedDescriptions.codellama') },
  { name: 'phi3', label: 'Phi-3', size: '2.3 GB', description: t('settings.ai.llm.ollama.curatedDescriptions.phi3') },
  { name: 'gemma2', label: 'Gemma 2', size: '5.4 GB', description: t('settings.ai.llm.ollama.curatedDescriptions.gemma2') },
  { name: 'qwen2.5', label: 'Qwen 2.5', size: '4.7 GB', description: t('settings.ai.llm.ollama.curatedDescriptions.qwen25') },
  { name: 'deepseek-r1', label: 'DeepSeek R1', size: '4.7 GB', description: t('settings.ai.llm.ollama.curatedDescriptions.deepseekR1') },
];

const WHISPER_LANGUAGE_CODES = [
  'ar-EG',
  'zh-CN',
  'en-US',
  'en-GB',
  'fr-CA',
  'fr-FR',
  'de-DE',
  'hi-IN',
  'it-IT',
  'ja-JP',
  'ko-KR',
  'pt-BR',
  'ru-RU',
  'es-MX',
  'es-ES',
] as const;

const AI_LANGUAGE_LABEL_KEYS: Record<string, string> = {
  'ar-EG': 'settings.ai.languages.arabic',
  'zh-CN': 'settings.ai.languages.chineseMandarin',
  'en-US': 'settings.ai.languages.englishUs',
  'en-GB': 'settings.ai.languages.englishUk',
  'fr-CA': 'settings.ai.languages.frenchCanada',
  'fr-FR': 'settings.ai.languages.frenchFrance',
  'de-DE': 'settings.ai.languages.german',
  'hi-IN': 'settings.ai.languages.hindi',
  'it-IT': 'settings.ai.languages.italian',
  'ja-JP': 'settings.ai.languages.japanese',
  'ko-KR': 'settings.ai.languages.korean',
  'pt-BR': 'settings.ai.languages.portugueseBrazil',
  'ru-RU': 'settings.ai.languages.russian',
  'es-MX': 'settings.ai.languages.spanishMexico',
  'es-ES': 'settings.ai.languages.spanishSpain',
};

function getAiLanguageLabel(t: (key: string) => string, languageCode: string): string {
  const key = AI_LANGUAGE_LABEL_KEYS[languageCode];
  return key ? t(key) : languageCode;
}

const getWhisperLanguageOptions = (t: (key: string) => string) =>
  WHISPER_LANGUAGE_CODES.map((value) => ({
    value,
    label: getAiLanguageLabel(t, value),
  }));

const getSpeakTtsOptions = (t: (key: string) => string) => [
  { id: 'edge-tts', label: t('settings.ai.speak.provider.edgeTTS') },
  { id: 'elevenlabs-multilingual-v2', label: t('settings.ai.speak.provider.elevenlabsMultilingual') },
  { id: 'elevenlabs-flash-v2-5', label: t('settings.ai.speak.provider.elevenlabsFlash') },
  { id: 'elevenlabs-turbo-v2-5', label: t('settings.ai.speak.provider.elevenlabsTurbo') },
  { id: 'elevenlabs-v3', label: t('settings.ai.speak.provider.elevenlabsV3') },
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
  const { t } = useI18n();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('api-keys');

  const [showOpenAIKey, setShowOpenAIKey] = useState(false);
  const [showAnthropicKey, setShowAnthropicKey] = useState(false);
  const [showGeminiKey, setShowGeminiKey] = useState(false);
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
  const [whisperCppModelStatus, setWhisperCppModelStatus] = useState<WhisperCppModelStatus | null>(null);
  const [whisperCppModelLoading, setWhisperCppModelLoading] = useState(false);
  const [parakeetModelStatus, setParakeetModelStatus] = useState<ParakeetModelStatus | null>(null);
  const [parakeetModelLoading, setParakeetModelLoading] = useState(false);
  const [qwen3ModelStatus, setQwen3ModelStatus] = useState<Qwen3ModelStatus | null>(null);
  const [qwen3ModelLoading, setQwen3ModelLoading] = useState(false);
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
          setElevenLabsVoicesError(t('settings.ai.speak.elevenlabs.voice.fetchFailed'));
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

  const refreshWhisperCppModelStatus = useCallback(async () => {
    try {
      const status = await window.electron.whisperCppModelStatus();
      setWhisperCppModelStatus(status);
      return status;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (activeTab !== 'whisper') return;
    let cancelled = false;
    let timer: number | null = null;

    const tick = async () => {
      await refreshWhisperCppModelStatus();
      if (cancelled) return;
      timer = window.setTimeout(() => { void tick(); }, 1000);
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [activeTab, refreshWhisperCppModelStatus]);

  const handleWhisperCppDownload = useCallback(async () => {
    setWhisperCppModelLoading(true);
    try {
      const status = await window.electron.whisperCppDownloadModel();
      setWhisperCppModelStatus(status);
    } catch {
      void refreshWhisperCppModelStatus();
    } finally {
      setWhisperCppModelLoading(false);
    }
  }, [refreshWhisperCppModelStatus]);

  const refreshParakeetModelStatus = useCallback(async () => {
    try {
      const status = await window.electron.parakeetModelStatus();
      setParakeetModelStatus(status);
      return status;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (activeTab !== 'whisper') return;
    let cancelled = false;
    let timer: number | null = null;

    const tick = async () => {
      await refreshParakeetModelStatus();
      if (cancelled) return;
      timer = window.setTimeout(() => { void tick(); }, 1000);
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [activeTab, refreshParakeetModelStatus]);

  const handleParakeetDownload = useCallback(async () => {
    setParakeetModelLoading(true);
    try {
      const status = await window.electron.parakeetDownloadModel();
      setParakeetModelStatus(status);
    } catch {
      void refreshParakeetModelStatus();
    } finally {
      setParakeetModelLoading(false);
    }
  }, [refreshParakeetModelStatus]);

  const refreshQwen3ModelStatus = useCallback(async () => {
    try {
      const status = await window.electron.qwen3ModelStatus();
      setQwen3ModelStatus(status);
      return status;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (activeTab !== 'whisper') return;
    let cancelled = false;
    let timer: number | null = null;

    const tick = async () => {
      await refreshQwen3ModelStatus();
      if (cancelled) return;
      timer = window.setTimeout(() => { void tick(); }, 1000);
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [activeTab, refreshQwen3ModelStatus]);

  const handleQwen3Download = useCallback(async () => {
    setQwen3ModelLoading(true);
    try {
      const status = await window.electron.qwen3DownloadModel();
      setQwen3ModelStatus(status);
    } catch {
      void refreshQwen3ModelStatus();
    } finally {
      setQwen3ModelLoading(false);
    }
  }, [refreshQwen3ModelStatus]);

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
    setPullProgress({ status: t('settings.ai.llm.ollama.startingDownload'), percent: 0 });
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
      setOllamaError(result.error || t('settings.ai.llm.ollama.deleteFailed'));
      setTimeout(() => setOllamaError(null), 5000);
    }
    setDeletingModel(null);
  };

  const handleWhisperHotkeyChange = async (commandId: string, hotkey: string) => {
    const result = await window.electron.updateCommandHotkey(commandId, hotkey);
    if (!result.success) {
      const message = result.error === 'duplicate'
        ? t('settings.ai.hotkeyDuplicate')
        : t('settings.ai.hotkeyUnavailable');
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
    setHotkeyStatus({ type: 'success', text: hotkey ? t('settings.ai.hotkeyUpdated') : t('settings.ai.hotkeyRemoved') });
    setTimeout(() => setHotkeyStatus({ type: 'idle', text: '' }), 1800);
    setSaveStatus('saved');
    setTimeout(() => setSaveStatus('idle'), 1600);
  };

  if (!settings) {
    return <div className="p-5 text-[var(--text-muted)] text-[0.75rem]">{t('common.loading')}</div>;
  }

  const ai = settings.ai;
  const whisperSpeakToggleHotkey = (settings.commandHotkeys || {})[WHISPER_SPEAK_TOGGLE_COMMAND_ID] ?? '';
  const isWhisperSpeakToggleFn = String(whisperSpeakToggleHotkey).trim().toLowerCase() === 'fn';
  const genericModels = ai.provider === 'ollama' && ollamaRunning
    ? Array.from(localModels).map((name) => ({
        id: `ollama-${name}`,
        label: getCuratedOllamaModels(t).find((m) => m.name === name)?.label || name,
      }))
    : ai.provider === 'openai-compatible' && ai.openaiCompatibleModel
      ? [{
          id: `openai-compatible-${ai.openaiCompatibleModel}`,
          label: ai.openaiCompatibleModel,
        }]
      : MODELS_BY_PROVIDER[ai.provider] || [];

  const whisperModelValue = (!ai.speechToTextModel || ai.speechToTextModel === 'default')
    ? 'whispercpp'
    : ai.speechToTextModel;
  const whisperCppPercent = whisperCppModelStatus?.state === 'downloading' && whisperCppModelStatus.totalBytes
    ? Math.max(0, Math.min(100, Math.round((whisperCppModelStatus.bytesDownloaded / whisperCppModelStatus.totalBytes) * 100)))
    : 0;
  const parakeetPercent = parakeetModelStatus?.state === 'downloading'
    ? Math.max(0, Math.min(100, Math.round((parakeetModelStatus.progress || 0) * 100)))
    : 0;
  const qwen3Percent = qwen3ModelStatus?.state === 'downloading'
    ? Math.max(0, Math.min(100, Math.round((qwen3ModelStatus.progress || 0) * 100)))
    : 0;

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
  const allEdgeVoices = (edgeVoices.length > 0 ? edgeVoices : EDGE_TTS_FALLBACK_VOICES).map((voice) => ({
    ...voice,
    languageLabel: getAiLanguageLabel(t, voice.languageCode),
  }));

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
      className={`px-2.5 py-1 rounded-md text-[0.75rem] font-medium transition-colors ${
        activeTab === id
          ? 'bg-[var(--ui-segment-active-bg)] text-[var(--text-primary)] border border-[var(--ui-segment-border)]'
          : 'bg-[var(--ui-segment-bg)] text-[var(--text-muted)] border border-[var(--ui-divider)] hover:text-[var(--text-secondary)] hover:bg-[var(--ui-segment-hover-bg)]'
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
        withBorder ? 'border-b border-[var(--ui-divider)]' : ''
      }`}
    >
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 text-[var(--text-muted)] shrink-0">{icon}</div>
        <div className="min-w-0">
          <h3 className="text-[0.8125rem] font-semibold text-[var(--text-primary)]">{title}</h3>
          <p className="mt-0.5 text-[0.75rem] text-[var(--text-muted)] leading-snug">{description}</p>
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
      className={`relative w-10 h-6 rounded-full border transition-colors ${
        enabled
          ? 'bg-[var(--accent)] border-[var(--accent-hover)]'
          : 'bg-[var(--ui-segment-bg)] border-[var(--ui-segment-border)]'
      }`}
      aria-label={label}
    >
      <span
        className={`absolute left-0.5 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border shadow-sm transition-transform ${
          enabled
            ? 'translate-x-[18px] bg-[var(--bg-overlay-strong)] border-[var(--ui-segment-border)]'
            : 'translate-x-0 bg-[var(--bg-overlay-strong)] border-[var(--ui-segment-border)]'
        }`}
      />
    </button>
  );

  return (
    <div className="w-full max-w-[980px] mx-auto">
      <div className="overflow-hidden rounded-xl border border-[var(--ui-panel-border)] bg-[var(--settings-panel-bg)]">
      <AIRow
        icon={<Brain className="w-4 h-4" />}
        title={t('settings.ai.enableAI.title')}
        description={t('settings.ai.enableAI.description')}
      >
        <div className="flex items-center gap-2">
          <button
            onClick={() => updateAI({ enabled: !ai.enabled })}
            className={`relative w-10 h-6 rounded-full border transition-colors ${
              ai.enabled
                ? 'bg-[var(--accent)] border-[var(--accent-hover)]'
                : 'bg-[var(--ui-segment-bg)] border-[var(--ui-segment-border)]'
            }`}
          >
            <span
              className={`absolute left-0.5 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border shadow-sm transition-transform ${
                ai.enabled
                  ? 'translate-x-[18px] bg-[var(--bg-overlay-strong)] border-[var(--ui-segment-border)]'
                  : 'translate-x-0 bg-[var(--bg-overlay-strong)] border-[var(--ui-segment-border)]'
              }`}
            />
          </button>
          {saveStatus === 'saved' && <span className="text-[0.75rem] text-green-400">{t('settings.ai.saved')}</span>}
        </div>
      </AIRow>

      <div className="flex items-center gap-1.5 px-4 py-3 border-b border-[var(--ui-divider)] md:px-5 overflow-x-auto">
        <TabButton id="api-keys" label={t('settings.ai.tabs.apiKeys')} />
        <TabButton id="llm" label={t('settings.ai.tabs.llm')} />
        <TabButton id="whisper" label={t('settings.ai.tabs.whisper')} />
        <TabButton id="speak" label={t('settings.ai.tabs.speak')} />
      </div>

      <div className={`${!ai.enabled ? 'opacity-65 pointer-events-none select-none' : ''}`}>
        {(activeTab === 'api-keys' || activeTab === 'llm') && (
          <div className="grid grid-cols-1">
            <div className={`px-4 py-3.5 md:px-5 space-y-3 ${activeTab === 'llm' ? 'hidden' : ''}`}>
                <div>
                  <label className="text-[0.75rem] text-[var(--text-secondary)] mb-1 block">{t('settings.ai.apiKeys.openai.label')}</label>
                  <div className="relative">
                    <input
                      type={showOpenAIKey ? 'text' : 'password'}
                      value={ai.openaiApiKey}
                      onChange={(e) => updateAI({ openaiApiKey: e.target.value.trim() })}
                      placeholder={t('settings.ai.apiKeys.openai.placeholder')}
                      className="w-full bg-[var(--ui-segment-bg)] border border-[var(--ui-divider)] rounded-md px-2.5 py-2 pr-9 text-sm text-[var(--text-primary)] placeholder:text-[color:var(--text-muted)] focus:outline-none focus:border-blue-500/50"
                    />
                    <button
                      onClick={() => setShowOpenAIKey(!showOpenAIKey)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                    >
                      {showOpenAIKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-[0.75rem] text-[var(--text-secondary)] mb-1 block">{t('settings.ai.apiKeys.anthropic.label')}</label>
                  <div className="relative">
                    <input
                      type={showAnthropicKey ? 'text' : 'password'}
                      value={ai.anthropicApiKey}
                      onChange={(e) => updateAI({ anthropicApiKey: e.target.value.trim() })}
                      placeholder={t('settings.ai.apiKeys.anthropic.placeholder')}
                      className="w-full bg-[var(--ui-segment-bg)] border border-[var(--ui-divider)] rounded-md px-2.5 py-2 pr-9 text-sm text-[var(--text-primary)] placeholder:text-[color:var(--text-muted)] focus:outline-none focus:border-blue-500/50"
                    />
                    <button
                      onClick={() => setShowAnthropicKey(!showAnthropicKey)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                    >
                      {showAnthropicKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-[0.75rem] text-[var(--text-secondary)] mb-1 block">{t('settings.ai.apiKeys.gemini.label')}</label>
                  <div className="relative">
                    <input
                      type={showGeminiKey ? 'text' : 'password'}
                      value={ai.geminiApiKey || ''}
                      onChange={(e) => updateAI({ geminiApiKey: e.target.value.trim() })}
                      placeholder={t('settings.ai.apiKeys.gemini.placeholder')}
                      className="w-full bg-[var(--ui-segment-bg)] border border-[var(--ui-divider)] rounded-md px-2.5 py-2 pr-9 text-sm text-[var(--text-primary)] placeholder:text-[color:var(--text-muted)] focus:outline-none focus:border-blue-500/50"
                    />
                    <button
                      onClick={() => setShowGeminiKey(!showGeminiKey)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                    >
                      {showGeminiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-[0.75rem] text-[var(--text-secondary)] mb-1 block">{t('settings.ai.apiKeys.elevenlabs.label')}</label>
                  <div className="relative">
                    <input
                      type={showElevenLabsKey ? 'text' : 'password'}
                      value={ai.elevenlabsApiKey || ''}
                      onChange={(e) => updateAI({ elevenlabsApiKey: e.target.value.trim() })}
                      placeholder={t('settings.ai.apiKeys.elevenlabs.placeholder')}
                      className="w-full bg-[var(--ui-segment-bg)] border border-[var(--ui-divider)] rounded-md px-2.5 py-2 pr-9 text-sm text-[var(--text-primary)] placeholder:text-[color:var(--text-muted)] focus:outline-none focus:border-blue-500/50"
                    />
                    <button
                      onClick={() => setShowElevenLabsKey(!showElevenLabsKey)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                    >
                      {showElevenLabsKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="pt-1 border-t border-[var(--ui-divider)]">
                  <p className="text-[0.8125rem] font-semibold text-[var(--text-primary)]">{t('settings.ai.apiKeys.supermemory.title')}</p>
                  <p className="text-[0.75rem] text-[var(--text-muted)] mt-0.5 leading-snug">{t('settings.ai.apiKeys.supermemory.description')}</p>
                </div>

                <div>
                  <label className="text-[0.75rem] text-[var(--text-secondary)] mb-1 block">{t('settings.ai.apiKeys.supermemory.apiKey.label')}</label>
                  <div className="relative">
                    <input
                      type={showSupermemoryKey ? 'text' : 'password'}
                      value={ai.supermemoryApiKey || ''}
                      onChange={(e) => updateAI({ supermemoryApiKey: e.target.value.trim() })}
                      placeholder={t('settings.ai.apiKeys.supermemory.apiKey.placeholder')}
                      className="w-full bg-[var(--ui-segment-bg)] border border-[var(--ui-divider)] rounded-md px-2.5 py-2 pr-9 text-sm text-[var(--text-primary)] placeholder:text-[color:var(--text-muted)] focus:outline-none focus:border-blue-500/50"
                    />
                    <button
                      onClick={() => setShowSupermemoryKey(!showSupermemoryKey)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                    >
                      {showSupermemoryKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-[0.75rem] text-[var(--text-secondary)] mb-1 block">{t('settings.ai.apiKeys.supermemory.client.label')}</label>
                  <input
                    type="text"
                    value={ai.supermemoryClient || ''}
                    onChange={(e) => updateAI({ supermemoryClient: e.target.value.trim() })}
                    placeholder={t('settings.ai.apiKeys.supermemory.client.placeholder')}
                    className="w-full bg-[var(--ui-segment-bg)] border border-[var(--ui-divider)] rounded-md px-2.5 py-2 text-sm text-[var(--text-primary)] placeholder:text-[color:var(--text-muted)] focus:outline-none focus:border-blue-500/50"
                  />
                  <p className="text-[0.625rem] text-[var(--text-muted)] mt-1">{t('settings.ai.apiKeys.supermemory.client.hint')}</p>
                </div>

                <div>
                  <label className="text-[0.75rem] text-[var(--text-secondary)] mb-1 block">{t('settings.ai.apiKeys.supermemory.baseUrl.label')}</label>
                  <input
                    type="text"
                    value={ai.supermemoryBaseUrl || 'https://api.supermemory.ai'}
                    onChange={(e) => updateAI({ supermemoryBaseUrl: e.target.value.trim() })}
                    placeholder="https://api.supermemory.ai"
                    className="w-full bg-[var(--ui-segment-bg)] border border-[var(--ui-divider)] rounded-md px-2.5 py-2 text-sm text-[var(--text-primary)] placeholder:text-[color:var(--text-muted)] focus:outline-none focus:border-blue-500/50"
                  />
                </div>

                <label className="inline-flex items-center gap-2 text-[0.6875rem] text-[var(--text-muted)]">
                  <input
                    type="checkbox"
                    checked={Boolean(ai.supermemoryLocalMode)}
                    onChange={(e) => updateAI({ supermemoryLocalMode: e.target.checked })}
                    className="settings-checkbox"
                  />
                  <span>{t('settings.ai.apiKeys.supermemory.localMode')}</span>
                </label>
            </div>

            <div className={`px-4 py-3.5 md:px-5 space-y-3 self-start ${activeTab === 'llm' ? '' : 'hidden'}`}>
              <div className="flex items-center justify-between gap-3 pb-1">
                <div>
                  <h3 className="text-[0.8125rem] font-semibold text-[var(--text-primary)]">{t('settings.ai.llm.enableLLM.title')}</h3>
                  <p className="text-[0.75rem] text-[var(--text-muted)] mt-0.5 leading-snug">{t('settings.ai.llm.enableLLM.description')}</p>
                </div>
                <SectionToggle
                  enabled={ai.llmEnabled !== false}
                  onToggle={() => updateAI({ llmEnabled: ai.llmEnabled === false })}
                  label={t('settings.ai.llm.enableLLM.title')}
                />
              </div>

              <div className={`${ai.llmEnabled === false ? 'opacity-65 pointer-events-none select-none' : ''}`}>
              <div>
                <h3 className="text-[0.8125rem] font-semibold text-[var(--text-primary)]">{t('settings.ai.llm.modelSelection.title')}</h3>
                <p className="text-[0.75rem] text-[var(--text-muted)] mt-0.5 leading-snug">{t('settings.ai.llm.modelSelection.description')}</p>
              </div>

              <div>
                  <label className="text-[0.75rem] text-[var(--text-secondary)] mb-1 block">{t('settings.ai.llm.provider.label')}</label>
                  <div className="grid grid-cols-2 gap-2">
                    {getProviderOptions(t).map((p) => (
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
                            ? 'bg-[var(--launcher-card-selected-bg)] border-[var(--launcher-card-selected-border)] text-[var(--text-primary)]'
                            : 'bg-[var(--ui-segment-bg)] border-[var(--ui-divider)] text-[var(--text-muted)] hover:bg-[var(--ui-segment-bg)]'
                        }`}
                      >
                        <div className="text-xs font-medium leading-tight">{p.label}</div>
                        <div className="text-[0.625rem] text-[var(--text-subtle)] mt-0.5 leading-tight">{p.description}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {ai.provider === 'ollama' && (
                  <div>
                    <label className="text-[0.75rem] text-[var(--text-muted)] mb-1 block">{t('settings.ai.llm.ollama.serverUrl.label')}</label>
                    <input
                      type="text"
                      value={ai.ollamaBaseUrl}
                      onChange={(e) => updateAI({ ollamaBaseUrl: e.target.value.trim() })}
                      placeholder="http://localhost:11434"
                      className="w-full bg-[var(--ui-segment-bg)] border border-[var(--ui-divider)] rounded-md px-2.5 py-2 text-sm text-[var(--text-secondary)] placeholder:text-[color:var(--text-subtle)] focus:outline-none focus:border-blue-500/50"
                    />
                  </div>
                )}

                {ai.provider === 'openai-compatible' && (
                  <div className="space-y-3">
                    <div>
                      <label className="text-[0.75rem] text-[var(--text-muted)] mb-1 block">{t('settings.ai.llm.openaiCompatible.baseUrl.label')}</label>
                      <input
                        type="text"
                        value={ai.openaiCompatibleBaseUrl}
                        onChange={(e) => updateAI({ openaiCompatibleBaseUrl: e.target.value.trim() })}
                        placeholder="https://api.openrouter.ai/v1"
                        className="w-full bg-[var(--ui-segment-bg)] border border-[var(--ui-divider)] rounded-md px-2.5 py-2 text-sm text-[var(--text-secondary)] placeholder:text-[color:var(--text-subtle)] focus:outline-none focus:border-blue-500/50"
                      />
                      <p className="text-[0.625rem] text-[var(--text-subtle)] mt-1">{t('settings.ai.llm.openaiCompatible.baseUrl.hint')}</p>
                    </div>

                    <div>
                      <label className="text-[0.75rem] text-[var(--text-muted)] mb-1 block">{t('settings.ai.llm.openaiCompatible.apiKey.label')}</label>
                      <div className="relative">
                        <input
                          type={showOpenAICompatibleKey ? 'text' : 'password'}
                          value={ai.openaiCompatibleApiKey}
                          onChange={(e) => updateAI({ openaiCompatibleApiKey: e.target.value.trim() })}
                          placeholder="sk-..."
                          className="w-full bg-[var(--ui-segment-bg)] border border-[var(--ui-divider)] rounded-md px-2.5 py-2 pr-9 text-sm text-[var(--text-secondary)] placeholder:text-[color:var(--text-subtle)] focus:outline-none focus:border-blue-500/50"
                        />
                        <button
                          onClick={() => setShowOpenAICompatibleKey(!showOpenAICompatibleKey)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-subtle)] hover:text-[var(--text-muted)]"
                        >
                          {showOpenAICompatibleKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="text-[0.75rem] text-[var(--text-muted)] mb-1 block">{t('settings.ai.llm.openaiCompatible.modelName.label')}</label>
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
                        className="w-full bg-[var(--ui-segment-bg)] border border-[var(--ui-divider)] rounded-md px-2.5 py-2 text-sm text-[var(--text-secondary)] placeholder:text-[color:var(--text-subtle)] focus:outline-none focus:border-blue-500/50"
                      />
                      <p className="text-[0.625rem] text-[var(--text-subtle)] mt-1">{t('settings.ai.llm.openaiCompatible.modelName.hint')}</p>
                    </div>
                  </div>
                )}

                <div className="mt-2">
                  <label className="text-[0.75rem] text-[var(--text-muted)] mb-1 block">{t('settings.ai.llm.defaultModel.label')}</label>
                  <select
                    value={ai.defaultModel}
                    onChange={(e) => updateAI({ defaultModel: e.target.value })}
                    className="w-full bg-[var(--ui-segment-bg)] border border-[var(--ui-divider)] rounded-md px-2.5 py-2 text-sm text-[var(--text-secondary)] focus:outline-none focus:border-blue-500/50"
                  >
                    <option value="">{t('settings.ai.llm.defaultModel.auto')}</option>
                    {genericModels.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>

              {ai.provider === 'ollama' && (
                <div className="pt-3 border-t border-[var(--ui-divider)]">
                  <div className="flex items-center justify-between mb-2.5">
                    <h3 className="text-[0.8125rem] font-semibold text-[var(--text-primary)]">{t('settings.ai.llm.ollama.models')}</h3>
                    {ollamaRunning && (
                      <button
                        onClick={refreshOllamaStatus}
                        className="flex items-center gap-1 px-2 py-1 text-[0.75rem] text-[var(--text-muted)] hover:text-[var(--text-secondary)] rounded-md transition-colors"
                      >
                        <RefreshCw className="w-3 h-3" />
                        {t('common.refresh')}
                      </button>
                    )}
                  </div>

                  {ollamaRunning === null && (
                    <div className="flex items-center gap-2 text-[var(--text-subtle)] text-xs py-2">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      {t('settings.ai.llm.ollama.checking')}
                    </div>
                  )}

                  {ollamaRunning === false && (
                    <div className="text-center py-4">
                      <div className="w-9 h-9 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-2.5">
                        <AlertCircle className="w-4 h-4 text-red-400/70" />
                      </div>
                      <p className="text-xs text-[var(--text-muted)] mb-0.5">{t('settings.ai.llm.ollama.notRunning.title')}</p>
                      <p className="text-[0.75rem] text-[var(--text-subtle)] mb-3">{t('settings.ai.llm.ollama.notRunning.description')}</p>
                      <button
                        onClick={() => window.electron.ollamaOpenDownload()}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 rounded-md transition-colors"
                      >
                        <Download className="w-3.5 h-3.5" />
                        {t('settings.ai.llm.ollama.notRunning.download')}
                        <ExternalLink className="w-3 h-3 text-blue-300/60" />
                      </button>
                    </div>
                  )}

                  {ollamaRunning === true && (
                    <>
                      <div className="flex items-center gap-2 mb-2.5">
                        <div className="w-2 h-2 rounded-full bg-green-400" />
                        <span className="text-[0.6875rem] text-green-400/70">{t('settings.ai.llm.ollama.running')}</span>
                      </div>

                      {ollamaError && (
                        <div className="bg-red-500/10 border border-red-500/20 rounded-md px-2.5 py-2 mb-2.5">
                          <p className="text-[0.6875rem] text-red-400">{ollamaError}</p>
                        </div>
                      )}

                      <div className="space-y-1 max-h-[min(46vh,360px)] overflow-y-auto pr-1">
                        {getCuratedOllamaModels(t).map((model) => {
                          const installed = localModels.has(model.name);
                          const isPulling = pullingModel === model.name;
                          const isDeleting = deletingModel === model.name;

                          return (
                            <div key={model.name} className="rounded-md border border-[var(--ui-divider)] bg-[var(--ui-segment-bg)] px-2.5 py-2">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-xs text-[var(--text-secondary)]">{model.label}</span>
                                    <span className="text-[0.625rem] text-[var(--text-subtle)]">{model.size}</span>
                                    {installed && (
                                      <span className="text-[0.625rem] font-medium px-1.5 py-0.5 rounded border border-[color:var(--status-success)] bg-[color:var(--status-success-soft)] text-[color:var(--status-success)]">{t('settings.ai.llm.ollama.installed')}</span>
                                    )}
                                  </div>
                                  <p className="text-[0.75rem] text-[var(--text-subtle)] mt-0.5">{model.description}</p>
                                </div>

                                {isPulling ? (
                                  <div className="flex items-center gap-1 text-[0.6875rem] text-[var(--text-muted)]">
                                    <RefreshCw className="w-3 h-3 animate-spin" />
                                    {pullProgress.percent > 0 ? `${pullProgress.percent}%` : '...'}
                                  </div>
                                ) : isDeleting ? (
                                  <div className="flex items-center gap-1 text-[0.6875rem] text-[var(--text-muted)]">
                                    <RefreshCw className="w-3 h-3 animate-spin" />
                                    {t('settings.ai.llm.ollama.removing')}
                                  </div>
                                ) : installed ? (
                                  <button
                                    onClick={() => handleDelete(model.name)}
                                    disabled={!!pullingModel}
                                    className="flex items-center gap-1 px-2 py-1 text-[0.6875rem] text-red-300/80 hover:text-red-200 hover:bg-red-500/10 rounded-md transition-colors"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                    {t('settings.ai.llm.ollama.removeModel')}
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => handlePull(model.name)}
                                    disabled={!!pullingModel}
                                    className="flex items-center gap-1 px-2 py-1 text-[0.6875rem] text-blue-300 hover:text-blue-200 bg-blue-500/10 hover:bg-blue-500/20 rounded-md transition-colors disabled:opacity-40"
                                  >
                                    <Download className="w-3 h-3" />
                                    {t('settings.ai.llm.ollama.downloadModel')}
                                  </button>
                                )}
                              </div>

                              {isPulling && pullProgress.percent > 0 && (
                                <div className="mt-2">
                                  <div className="w-full h-1.5 bg-[var(--ui-segment-bg)] rounded-full overflow-hidden">
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
          <div className="px-4 py-3 md:px-5 border-b border-[var(--ui-divider)] flex items-center justify-between gap-3">
            <div>
              <h3 className="text-[0.8125rem] font-semibold text-[var(--text-primary)]">{t('settings.ai.whisper.enableWhisper.title')}</h3>
              <p className="text-[0.75rem] text-[var(--text-muted)] mt-0.5 leading-snug">{t('settings.ai.whisper.enableWhisper.description')}</p>
            </div>
            <SectionToggle
              enabled={ai.whisperEnabled !== false}
              onToggle={() => updateAI({ whisperEnabled: ai.whisperEnabled === false })}
              label={t('settings.ai.whisper.title')}
            />
          </div>
          <div className={`grid grid-cols-1 xl:grid-cols-2 gap-0 ${ai.whisperEnabled === false ? 'opacity-65 pointer-events-none select-none' : ''}`}>
            <div className="px-4 py-3.5 md:px-5 space-y-3 border-b border-[var(--ui-divider)] xl:border-b-0 xl:border-r xl:border-[var(--ui-divider)]">
              <div className="flex items-center gap-2">
                <Mic className="w-4 h-4 text-[var(--text-muted)] shrink-0" />
                <div>
                  <h3 className="text-[0.8125rem] font-semibold text-[var(--text-primary)]">{t('settings.ai.whisper.title')}</h3>
                  <p className="text-[0.75rem] text-[var(--text-muted)] mt-0.5 leading-snug">{t('settings.ai.whisper.description')}</p>
                </div>
              </div>

              <div>
                <label className="text-[0.75rem] text-[var(--text-muted)] mb-1 block">{t('settings.ai.whisper.model.label')}</label>
                <select
                  value={whisperModelValue}
                  onChange={(e) => updateAI({ speechToTextModel: e.target.value })}
                  className="w-full bg-[var(--ui-segment-bg)] border border-[var(--ui-divider)] rounded-md px-2.5 py-2 text-sm text-[var(--text-secondary)] focus:outline-none focus:border-blue-500/50"
                >
                  {getWhisperSttOptions(t).map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
              </div>

              {whisperModelValue.startsWith('openai-') && !ai.openaiApiKey && (
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-md px-2.5 py-2">
                  <p className="text-[0.6875rem] text-amber-300">{t('settings.ai.whisper.openaiWarning')}</p>
                </div>
              )}

              {whisperModelValue.startsWith('elevenlabs-') && (
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-md px-2.5 py-2">
                  <p className="text-[0.6875rem] text-amber-300">
                    {ai.elevenlabsApiKey
                      ? t('settings.ai.whisper.elevenlabsReady')
                      : t('settings.ai.whisper.elevenlabsWarning', {
                          action: t('common.add').toLowerCase(),
                        })}
                  </p>
                </div>
              )}

              {whisperModelValue === 'parakeet' && (
                <div className="rounded-md px-2.5 py-2 border border-[color:var(--status-success-soft)] bg-[color:var(--status-success-soft)]">
                  <p className="text-[0.6875rem] text-[color:var(--status-success)]">
                    {t('settings.ai.whisper.providerInfo.parakeet')}
                  </p>
                </div>
              )}

              {whisperModelValue === 'qwen3' && (
                <div className="rounded-md px-2.5 py-2 border border-[color:var(--status-success-soft)] bg-[color:var(--status-success-soft)]">
                  <p className="text-[0.6875rem] text-[color:var(--status-success)]">
                    {t('settings.ai.whisper.providerInfo.qwen3')}
                  </p>
                </div>
              )}

              {whisperModelValue === 'qwen3' && (
                <div>
                  <label className="text-[0.75rem] text-[var(--text-muted)] mb-1 block">{t('settings.ai.whisper.recognitionLanguage')}</label>
                  <select
                    value={ai.speechLanguage || 'en-US'}
                    onChange={(e) => updateAI({ speechLanguage: e.target.value })}
                    className="w-full bg-[var(--ui-segment-bg)] border border-[var(--ui-divider)] rounded-md px-2.5 py-2 text-sm text-[var(--text-secondary)] focus:outline-none focus:border-blue-500/50"
                  >
                    {getWhisperLanguageOptions(t).map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
              )}

              {whisperModelValue === 'whispercpp' && (
                <div className="rounded-md px-2.5 py-2 border border-[color:var(--status-success-soft)] bg-[color:var(--status-success-soft)]">
                  <p className="text-[0.6875rem] text-[color:var(--status-success)]">
                    {t('settings.ai.whisper.providerInfo.whispercpp')}
                  </p>
                </div>
              )}

              {whisperModelValue === 'whispercpp' && (
                <div>
                  <label className="text-[0.75rem] text-[var(--text-muted)] mb-1 block">{t('settings.ai.whisper.modelSize.label')}</label>
                  <select
                    value={ai.whisperCppModelSize || 'base'}
                    onChange={(e) => {
                      updateAI({ whisperCppModelSize: e.target.value });
                      void refreshWhisperCppModelStatus();
                    }}
                    className={`w-full bg-[var(--ui-segment-bg)] border rounded-md px-2.5 py-2 text-sm text-[var(--text-secondary)] focus:outline-none focus:border-blue-500/50 ${
                      whisperCppModelStatus && whisperCppModelStatus.state !== 'downloaded' && whisperCppModelStatus.state !== 'downloading'
                        ? 'border-red-500/60'
                        : 'border-[var(--ui-divider)]'
                    }`}
                  >
                    <option value="tiny">{t('settings.ai.whisper.modelSize.tiny')}</option>
                    <option value="base">{t('settings.ai.whisper.modelSize.base')}</option>
                    <option value="small">{t('settings.ai.whisper.modelSize.small')}</option>
                    <option value="medium">{t('settings.ai.whisper.modelSize.medium')}</option>
                    <option value="large">{t('settings.ai.whisper.modelSize.large')}</option>
                  </select>
                  {whisperCppModelStatus && whisperCppModelStatus.state !== 'downloaded' && whisperCppModelStatus.state !== 'downloading' && (
                    <p className="text-[0.6875rem] text-red-400 mt-1">{t('settings.ai.whisper.modelSize.notDownloaded')}</p>
                  )}
                  <p className="text-[0.75rem] text-[var(--text-muted)] mt-1">{t('settings.ai.whisper.modelSize.hint')}</p>
                </div>
              )}

              {whisperModelValue === 'whispercpp' && (
                <div>
                  <label className="text-[0.75rem] text-[var(--text-muted)] mb-1 block">{t('settings.ai.whisper.recognitionLanguage')}</label>
                  <select
                    value={ai.speechLanguage || 'en-US'}
                    onChange={(e) => updateAI({ speechLanguage: e.target.value })}
                    className="w-full bg-[var(--ui-segment-bg)] border border-[var(--ui-divider)] rounded-md px-2.5 py-2 text-sm text-[var(--text-secondary)] focus:outline-none focus:border-blue-500/50"
                  >
                    {getWhisperLanguageOptions(t).map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
              )}

              {whisperModelValue === 'native' && (
                <div className="bg-sky-500/10 border border-sky-500/20 rounded-md px-2.5 py-2">
                  <p className="text-[0.6875rem] text-sky-300">
                    {t('settings.ai.whisper.providerInfo.native')}
                  </p>
                </div>
              )}

              <div className="pt-3 border-t border-[var(--ui-divider)] space-y-2">
                <p className="text-[0.75rem] text-[var(--text-muted)]">{t('settings.ai.whisper.hotkeys.title')}</p>
                <div>
                  <p className="text-[0.75rem] text-[var(--text-muted)] mb-1.5">{t('settings.ai.whisper.hotkeys.startStop')}</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <HotkeyRecorder
                      value={whisperSpeakToggleHotkey}
                      onChange={(hotkey) => { void handleWhisperHotkeyChange(WHISPER_SPEAK_TOGGLE_COMMAND_ID, hotkey); }}
                      compact
                      variant="whisper"
                    />
                    {!isWhisperSpeakToggleFn ? (
                      <button
                        type="button"
                        onClick={() => { void handleWhisperHotkeyChange(WHISPER_SPEAK_TOGGLE_COMMAND_ID, 'Fn'); }}
                        className="inline-flex min-h-[34px] items-center justify-center rounded-md px-3 py-1.5 text-[0.8125rem] font-medium transition-colors bg-[var(--ui-segment-bg)] border border-[var(--ui-divider)] text-[var(--text-secondary)] hover:bg-[var(--ui-segment-hover-bg)] hover:border-[var(--ui-segment-border)]"
                      >
                        {t('settings.ai.whisper.hotkeys.setToFn')}
                      </button>
                    ) : null}
                  </div>
                  {!isWhisperSpeakToggleFn ? (
                    <p className="mt-1.5 text-[0.6875rem] text-[var(--text-muted)]">
                      {t('settings.ai.whisper.hotkeys.fnHint')}
                    </p>
                  ) : null}
                </div>
                {hotkeyStatus.type !== 'idle' ? (
                  <p
                    className={`text-[0.6875rem] ${
                      hotkeyStatus.type === 'error' ? 'text-red-300/90' : 'text-emerald-300/90'
                    }`}
                  >
                    {hotkeyStatus.text}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="px-4 py-3.5 md:px-5 space-y-3">
              {whisperModelValue === 'parakeet' && (
                <div className="rounded-xl border border-[var(--ui-divider)] bg-[var(--ui-segment-bg)] px-3 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-[0.8125rem] font-semibold text-[var(--text-primary)]">{t('settings.ai.whisper.downloadCards.parakeet.title')}</h3>
                      <p className="text-[0.75rem] text-[var(--text-muted)] mt-0.5 leading-snug">
                        {t('settings.ai.whisper.downloadCards.parakeet.description')}
                      </p>
                    </div>
                    {parakeetModelStatus?.state === 'downloaded' ? (
                      <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-[color:var(--status-success)]" />
                    ) : (
                      <Download className="w-4 h-4 text-[var(--text-muted)] shrink-0 mt-0.5" />
                    )}
                  </div>

                  <div className="mt-3 text-[0.75rem]">
                    {parakeetModelStatus?.state === 'downloaded' ? (
                      <p className="text-[color:var(--status-success)]">{t('settings.ai.whisper.downloadCards.parakeet.ready')}</p>
                    ) : parakeetModelStatus?.state === 'downloading' ? (
                      <div className="space-y-2">
                        <p className="text-[var(--text-secondary)]">
                          {t('settings.ai.whisper.downloadCards.parakeet.downloading')}
                          {parakeetPercent > 0 ? ` (${parakeetPercent}%)` : '...'}
                        </p>
                        <div className="h-2 rounded-full bg-black/20 overflow-hidden">
                          <div
                            className="h-full bg-emerald-400/80 transition-[width] duration-300"
                            style={{ width: `${Math.max(3, parakeetPercent)}%` }}
                          />
                        </div>
                      </div>
                    ) : parakeetModelStatus?.state === 'error' ? (
                      <p className="text-rose-300">{parakeetModelStatus.error || t('settings.ai.whisper.downloadCards.modelDownloadFailed')}</p>
                    ) : (
                      <p className="text-amber-300">{t('settings.ai.whisper.downloadCards.parakeet.notDownloaded')}</p>
                    )}
                  </div>

                  <div className="mt-3 flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => { void handleParakeetDownload(); }}
                      disabled={parakeetModelLoading || parakeetModelStatus?.state === 'downloading' || parakeetModelStatus?.state === 'downloaded'}
                      className="inline-flex min-h-[34px] items-center justify-center rounded-md px-3 py-1.5 text-[0.8125rem] font-medium transition-colors bg-[var(--ui-segment-active-bg)] border border-[var(--ui-segment-border)] text-[var(--text-primary)] disabled:opacity-55 disabled:cursor-not-allowed"
                    >
                      {parakeetModelStatus?.state === 'downloaded'
                        ? t('settings.ai.whisper.downloadCards.actions.downloaded')
                        : parakeetModelStatus?.state === 'downloading'
                          ? t('settings.ai.whisper.downloadCards.actions.downloading')
                          : t('settings.ai.whisper.downloadCards.actions.download')}
                    </button>
                    <button
                      type="button"
                      onClick={() => { void refreshParakeetModelStatus(); }}
                      className="inline-flex min-h-[34px] items-center justify-center rounded-md px-3 py-1.5 text-[0.8125rem] font-medium transition-colors bg-[var(--ui-segment-bg)] border border-[var(--ui-divider)] text-[var(--text-secondary)] hover:bg-[var(--ui-segment-hover-bg)]"
                    >
                      {t('common.refresh')}
                    </button>
                  </div>
                </div>
              )}

              {whisperModelValue === 'qwen3' && (
                <div className="rounded-xl border border-[var(--ui-divider)] bg-[var(--ui-segment-bg)] px-3 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-[0.8125rem] font-semibold text-[var(--text-primary)]">{t('settings.ai.whisper.downloadCards.qwen3.title')}</h3>
                      <p className="text-[0.75rem] text-[var(--text-muted)] mt-0.5 leading-snug">
                        {t('settings.ai.whisper.downloadCards.qwen3.description')}
                      </p>
                    </div>
                    {qwen3ModelStatus?.state === 'downloaded' ? (
                      <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-[color:var(--status-success)]" />
                    ) : (
                      <Download className="w-4 h-4 text-[var(--text-muted)] shrink-0 mt-0.5" />
                    )}
                  </div>

                  <div className="mt-3 text-[0.75rem]">
                    {qwen3ModelStatus?.state === 'downloaded' ? (
                      <p className="text-[color:var(--status-success)]">{t('settings.ai.whisper.downloadCards.qwen3.ready')}</p>
                    ) : qwen3ModelStatus?.state === 'downloading' ? (
                      <div className="space-y-2">
                        <p className="text-[var(--text-secondary)]">
                          {t('settings.ai.whisper.downloadCards.qwen3.downloading')}
                          {qwen3Percent > 0 ? ` (${qwen3Percent}%)` : '...'}
                        </p>
                        <div className="h-2 rounded-full bg-black/20 overflow-hidden">
                          <div
                            className="h-full bg-emerald-400/80 transition-[width] duration-300"
                            style={{ width: `${Math.max(3, qwen3Percent)}%` }}
                          />
                        </div>
                      </div>
                    ) : qwen3ModelStatus?.state === 'error' ? (
                      <p className="text-rose-300">{qwen3ModelStatus.error || t('settings.ai.whisper.downloadCards.modelDownloadFailed')}</p>
                    ) : (
                      <p className="text-amber-300">{t('settings.ai.whisper.downloadCards.qwen3.notDownloaded')}</p>
                    )}
                  </div>

                  <div className="mt-3 flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => { void handleQwen3Download(); }}
                      disabled={qwen3ModelLoading || qwen3ModelStatus?.state === 'downloading' || qwen3ModelStatus?.state === 'downloaded'}
                      className="inline-flex min-h-[34px] items-center justify-center rounded-md px-3 py-1.5 text-[0.8125rem] font-medium transition-colors bg-[var(--ui-segment-active-bg)] border border-[var(--ui-segment-border)] text-[var(--text-primary)] disabled:opacity-55 disabled:cursor-not-allowed"
                    >
                      {qwen3ModelStatus?.state === 'downloaded'
                        ? t('settings.ai.whisper.downloadCards.actions.downloaded')
                        : qwen3ModelStatus?.state === 'downloading'
                          ? t('settings.ai.whisper.downloadCards.actions.downloading')
                          : t('settings.ai.whisper.downloadCards.actions.download')}
                    </button>
                    <button
                      type="button"
                      onClick={() => { void refreshQwen3ModelStatus(); }}
                      className="inline-flex min-h-[34px] items-center justify-center rounded-md px-3 py-1.5 text-[0.8125rem] font-medium transition-colors bg-[var(--ui-segment-bg)] border border-[var(--ui-divider)] text-[var(--text-secondary)] hover:bg-[var(--ui-segment-hover-bg)]"
                    >
                      {t('common.refresh')}
                    </button>
                  </div>
                </div>
              )}

              {whisperModelValue === 'whispercpp' && (
                <div className="rounded-xl border border-[var(--ui-divider)] bg-[var(--ui-segment-bg)] px-3 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-[0.8125rem] font-semibold text-[var(--text-primary)]">{t('settings.ai.whisper.downloadCards.whispercpp.title')}</h3>
                      <p className="text-[0.75rem] text-[var(--text-muted)] mt-0.5 leading-snug">
                        {t('settings.ai.whisper.downloadCards.whispercpp.description')}
                      </p>
                    </div>
                    {whisperCppModelStatus?.state === 'downloaded' ? (
                      <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-[color:var(--status-success)]" />
                    ) : (
                      <Download className="w-4 h-4 text-[var(--text-muted)] shrink-0 mt-0.5" />
                    )}
                  </div>

                  <div className="mt-3 text-[0.75rem]">
                    {whisperCppModelStatus?.state === 'downloaded' ? (
                      <p className="text-[color:var(--status-success)]">{t('settings.ai.whisper.downloadCards.whispercpp.ready')}</p>
                    ) : whisperCppModelStatus?.state === 'downloading' ? (
                      <div className="space-y-2">
                        <p className="text-[var(--text-secondary)]">
                          {t('settings.ai.whisper.downloadCards.whispercpp.downloading')}
                          {whisperCppModelStatus.totalBytes ? ` (${whisperCppPercent}%)` : '...'}
                        </p>
                        <div className="h-2 rounded-full bg-black/20 overflow-hidden">
                          <div
                            className="h-full bg-emerald-400/80 transition-[width] duration-300"
                            style={{ width: `${whisperCppPercent}%` }}
                          />
                        </div>
                      </div>
                    ) : whisperCppModelStatus?.state === 'error' ? (
                      <p className="text-rose-300">{whisperCppModelStatus.error || t('settings.ai.whisper.downloadCards.modelDownloadFailed')}</p>
                    ) : (
                      <p className="text-amber-300">{t('settings.ai.whisper.downloadCards.whispercpp.notDownloaded')}</p>
                    )}
                  </div>

                  <div className="mt-3 flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => { void handleWhisperCppDownload(); }}
                      disabled={whisperCppModelLoading || whisperCppModelStatus?.state === 'downloading' || whisperCppModelStatus?.state === 'downloaded'}
                      className="inline-flex min-h-[34px] items-center justify-center rounded-md px-3 py-1.5 text-[0.8125rem] font-medium transition-colors bg-[var(--ui-segment-active-bg)] border border-[var(--ui-segment-border)] text-[var(--text-primary)] disabled:opacity-55 disabled:cursor-not-allowed"
                    >
                      {whisperCppModelStatus?.state === 'downloaded'
                        ? t('settings.ai.whisper.downloadCards.actions.downloaded')
                        : whisperCppModelStatus?.state === 'downloading'
                          ? t('settings.ai.whisper.downloadCards.actions.downloading')
                          : t('settings.ai.whisper.downloadCards.actions.download')}
                    </button>
                    <button
                      type="button"
                      onClick={() => { void refreshWhisperCppModelStatus(); }}
                      className="inline-flex min-h-[34px] items-center justify-center rounded-md px-3 py-1.5 text-[0.8125rem] font-medium transition-colors bg-[var(--ui-segment-bg)] border border-[var(--ui-divider)] text-[var(--text-secondary)] hover:bg-[var(--ui-segment-hover-bg)]"
                    >
                      {t('common.refresh')}
                    </button>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-[0.8125rem] font-semibold text-[var(--text-primary)]">{t('settings.ai.whisper.autoClose.title')}</h3>
                  <p className="text-[0.75rem] text-[var(--text-muted)] mt-0.5 leading-snug">{t('settings.ai.whisper.autoClose.description')}</p>
                </div>
                <SectionToggle
                  enabled={ai.whisperAutoClose !== false}
                  onToggle={() => updateAI({ whisperAutoClose: ai.whisperAutoClose === false })}
                  label={t('settings.ai.whisper.autoClose.title')}
                />
              </div>

              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-[0.8125rem] font-semibold text-[var(--text-primary)]">{t('settings.ai.whisper.smoothOutput.title')}</h3>
                  <p className="text-[0.75rem] text-[var(--text-muted)] mt-0.5 leading-snug">{t('settings.ai.whisper.smoothOutput.description')}</p>
                </div>
                <SectionToggle
                  enabled={Boolean(ai.speechCorrectionEnabled)}
                  onToggle={() => updateAI({ speechCorrectionEnabled: !ai.speechCorrectionEnabled })}
                  label={t('settings.ai.whisper.smoothOutput.title')}
                />
              </div>

              {ai.speechCorrectionEnabled && (
                <div>
                  <label className="text-[0.75rem] text-[var(--text-muted)] mb-1 block">{t('settings.ai.whisper.smoothingModel.label')}</label>
                  <select
                    value={ai.speechCorrectionModel || ''}
                    onChange={(e) => updateAI({ speechCorrectionModel: e.target.value })}
                    className="w-full bg-[var(--ui-segment-bg)] border border-[var(--ui-divider)] rounded-md px-2.5 py-2 text-sm text-[var(--text-secondary)] focus:outline-none focus:border-blue-500/50"
                  >
                    <option value="">{t('settings.ai.whisper.smoothingModel.useDefault')}</option>
                    {correctionModelOptions.map((m) => (
                      <option key={m.id} value={m.id}>{m.label}</option>
                    ))}
                  </select>
                  <p className="text-[0.75rem] text-[var(--text-muted)] mt-1">{t('settings.ai.whisper.smoothingModel.hint')}</p>
                </div>
              )}
            </div>
          </div>
          </>
        )}

        {activeTab === 'speak' && (
          <>
          <div className="px-4 py-3 md:px-5 border-b border-[var(--ui-divider)] flex items-center justify-between gap-3">
            <div>
              <h3 className="text-[0.8125rem] font-semibold text-[var(--text-primary)]">{t('settings.ai.speak.enableRead.title')}</h3>
              <p className="text-[0.75rem] text-[var(--text-muted)] mt-0.5 leading-snug">{t('settings.ai.speak.enableRead.description')}</p>
            </div>
            <SectionToggle
              enabled={ai.readEnabled !== false}
              onToggle={() => updateAI({ readEnabled: ai.readEnabled === false })}
              label={t('settings.ai.speak.title')}
            />
          </div>
          <div className={`grid grid-cols-1 xl:grid-cols-2 gap-0 ${ai.readEnabled === false ? 'opacity-65 pointer-events-none select-none' : ''}`}>
            <div className="px-4 py-3.5 md:px-5 space-y-3 border-b border-[var(--ui-divider)] xl:border-b-0 xl:border-r xl:border-[var(--ui-divider)]">
              <div className="flex items-center gap-2">
                <Volume2 className="w-4 h-4 text-[var(--text-muted)] shrink-0" />
                <div>
                  <h3 className="text-[0.8125rem] font-semibold text-[var(--text-primary)]">{t('settings.ai.speak.title')}</h3>
                  <p className="text-[0.75rem] text-[var(--text-muted)] mt-0.5 leading-snug">{t('settings.ai.speak.description')}</p>
                </div>
              </div>

              <div>
                <label className="text-[0.75rem] text-[var(--text-muted)] mb-1 block">{t('settings.ai.speak.provider.label')}</label>
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
                  className="w-full bg-[var(--ui-segment-bg)] border border-[var(--ui-divider)] rounded-md px-2.5 py-2 text-sm text-[var(--text-secondary)] focus:outline-none focus:border-blue-500/50"
                >
                  {getSpeakTtsOptions(t).map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
              </div>

              {speakModelValue === 'edge-tts' && (
                <div className="pt-2 border-t border-[var(--ui-divider)] space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[0.75rem] text-[var(--text-muted)]">{t('settings.ai.speak.edgeTTS.voice')}</p>
                    {edgeVoicesLoading && (
                      <span className="inline-flex items-center gap-1 text-[0.625rem] text-[var(--text-subtle)]">
                        <RefreshCw className="w-3 h-3 animate-spin" />
                        {t('settings.ai.speak.edgeTTS.fetching')}
                      </span>
                    )}
                  </div>

                  <div>
                    <label className="text-[0.75rem] text-[var(--text-muted)] mb-1 block">{t('settings.ai.speak.edgeTTS.language.label')}</label>
                    <select
                      value={selectedEdgeLanguageCode}
                      onChange={(e) => handleEdgeLanguageChange(e.target.value)}
                      className="w-full bg-[var(--ui-segment-bg)] border border-[var(--ui-divider)] rounded-md px-2.5 py-2 text-sm text-[var(--text-secondary)] focus:outline-none focus:border-blue-500/50"
                    >
                      {edgeLanguageOptions.map((lang) => (
                        <option key={lang.code} value={lang.code}>{lang.label}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-[0.75rem] text-[var(--text-muted)] mb-1 block">{t('settings.ai.speak.edgeTTS.gender.label')}</label>
                    <select
                      value={selectedEdgeGender}
                      onChange={(e) => handleEdgeGenderChange(e.target.value as EdgeVoiceGender)}
                      className="w-full bg-[var(--ui-segment-bg)] border border-[var(--ui-divider)] rounded-md px-2.5 py-2 text-sm text-[var(--text-secondary)] focus:outline-none focus:border-blue-500/50"
                    >
                      <option value="female">{t('settings.ai.speak.edgeTTS.gender.female')}</option>
                      <option value="male">{t('settings.ai.speak.edgeTTS.gender.male')}</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-[0.75rem] text-[var(--text-muted)] mb-1 block">{t('settings.ai.speak.edgeTTS.voiceLabel.label')}</label>
                    <select
                      value={selectedEdgeVoice.id}
                      onChange={(e) => applyEdgeVoice(e.target.value)}
                      className="w-full bg-[var(--ui-segment-bg)] border border-[var(--ui-divider)] rounded-md px-2.5 py-2 text-sm text-[var(--text-secondary)] focus:outline-none focus:border-blue-500/50"
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
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-[var(--accent)] bg-[var(--accent-soft)] border border-[var(--accent)] hover:brightness-95 disabled:opacity-65 disabled:cursor-not-allowed transition-colors"
                  >
                    {previewingVoice ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Volume2 className="w-3 h-3" />}
                    {previewingVoice ? t('settings.ai.speak.edgeTTS.playSample.playing') : t('settings.ai.speak.edgeTTS.playSample.idle')}
                  </button>
                </div>
              )}

              {speakModelValue.startsWith('elevenlabs-') && (
                <div className="pt-2 border-t border-[var(--ui-divider)] space-y-2.5">
                  <div>
                    <p className="text-[0.75rem] text-[var(--text-muted)] mb-1">{t('settings.ai.speak.elevenlabs.model.label')}</p>
                    <select
                      value={speakModelValue}
                      onChange={(e) =>
                        updateAI({
                          textToSpeechModel: buildElevenLabsSpeakModel(e.target.value, selectedElevenLabsVoiceId),
                        })}
                      className="w-full bg-[var(--ui-segment-bg)] border border-[var(--ui-divider)] rounded-md px-2.5 py-2 text-sm text-[var(--text-secondary)] focus:outline-none focus:border-blue-500/50"
                    >
                      {getSpeakTtsOptions(t).filter((m) => m.id.startsWith('elevenlabs-')).map((m) => (
                        <option key={m.id} value={m.id}>{m.label}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-[0.75rem] text-[var(--text-muted)]">{t('settings.ai.speak.elevenlabs.voice.label')}</p>
                      {elevenLabsVoicesLoading && (
                        <span className="text-[0.625rem] text-[var(--text-subtle)] flex items-center gap-1">
                          <RefreshCw className="w-3 h-3 animate-spin" />
                          {t('settings.ai.speak.elevenlabs.voice.fetching')}
                        </span>
                      )}
                    </div>
                    {elevenLabsVoicesError && (
                      <p className="text-[0.625rem] text-amber-300 mb-1.5">{elevenLabsVoicesError}</p>
                    )}
                    <select
                      value={selectedElevenLabsVoiceId}
                      onChange={(e) =>
                        updateAI({
                          textToSpeechModel: buildElevenLabsSpeakModel(speakModelValue, e.target.value),
                        })}
                      className="w-full bg-[var(--ui-segment-bg)] border border-[var(--ui-divider)] rounded-md px-2.5 py-2 text-sm text-[var(--text-secondary)] focus:outline-none focus:border-blue-500/50"
                    >
                      {ELEVENLABS_VOICES.length > 0 && (
                        <optgroup label={t('settings.ai.speak.elevenlabs.voice.builtIn')}>
                          {ELEVENLABS_VOICES.map((voice) => (
                            <option key={voice.id} value={voice.id}>
                              {voice.label}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {elevenLabsVoices.filter(v => v.category === 'premade' && !ELEVENLABS_VOICES.some(bv => bv.id === v.id)).length > 0 && (
                        <optgroup label={t('settings.ai.speak.elevenlabs.voice.premade')}>
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
                        <optgroup label={t('settings.ai.speak.elevenlabs.voice.custom')}>
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
                        <optgroup label={t('settings.ai.speak.elevenlabs.voice.professional')}>
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
                      <p className="text-[0.625rem] text-[var(--text-subtle)] mt-1">
                        {t('settings.ai.speak.elevenlabs.voice.available', { count: elevenLabsVoices.length })}
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
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-[var(--accent)] bg-[var(--accent-soft)] border border-[var(--accent)] hover:brightness-95 disabled:opacity-65 disabled:cursor-not-allowed transition-colors"
                  >
                    {previewingVoice ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Volume2 className="w-3 h-3" />}
                    {previewingVoice ? t('settings.ai.speak.elevenlabs.playSample.playing') : t('settings.ai.speak.elevenlabs.playSample.idle')}
                  </button>

                  <p className="text-[0.625rem] text-[var(--text-subtle)]">
                    {t('settings.ai.speak.elevenlabs.storageHint', {
                      value: `${speakModelValue}@${selectedElevenLabsVoiceId}`,
                    })}
                  </p>
                  {!ai.elevenlabsApiKey && (
                    <p className="text-[0.6875rem] text-amber-300 mt-1.5">{t('settings.ai.speak.elevenlabs.apiKeyWarning')}</p>
                  )}
                </div>
              )}
            </div>

            <div className="px-4 py-3.5 md:px-5">
              <h3 className="text-[0.8125rem] font-semibold text-[var(--text-primary)]">{t('settings.ai.speak.notes.title')}</h3>
              <div className="mt-2 space-y-1.5 text-[0.75rem] text-[var(--text-muted)] leading-relaxed">
                <p>{t('settings.ai.speak.notes.whisperDefault')}</p>
                <p>{t('settings.ai.speak.notes.speakDefault')}</p>
                <p>{t('settings.ai.speak.notes.englishVoice')}</p>
                <p>{t('settings.ai.speak.notes.elevenlabsVoices')}</p>
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
