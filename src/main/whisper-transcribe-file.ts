import * as path from 'path';
import type { AppSettings } from './settings-store';

export type WhisperFileTranscriptionProvider =
  | 'parakeet'
  | 'qwen3'
  | 'whispercpp'
  | 'openai'
  | 'elevenlabs'
  | 'mistral'
  | 'native';

export interface WhisperFileTranscriptionPlan {
  provider: WhisperFileTranscriptionProvider;
  model: string;
}

export interface WhisperFileSystem {
  existsSync(filePath: string): boolean;
  readFileSync(filePath: string): Buffer;
  unlinkSync(filePath: string): void;
  rmdirSync(filePath: string, options?: { recursive?: boolean }): void;
}

type WhisperCppModelStatus = {
  state: string;
};

type BufferTranscriber = (opts: {
  audioBuffer: Buffer;
  language?: string;
  mimeType?: string;
}) => Promise<string>;

type CloudBufferTranscriber = (opts: {
  audioBuffer: Buffer;
  apiKey: string;
  model: string;
  language?: string;
  mimeType?: string;
}) => Promise<string>;

export interface TranscribeWhisperAudioFileDeps {
  fs: WhisperFileSystem;
  loadSettings(): AppSettings;
  isAIDisabledInSettings(settings: AppSettings): boolean;
  normalizeWhisperLanguageCode(rawLanguage?: string): string;
  resolveElevenLabsSttModel(model: string): string;
  getElevenLabsApiKey(settings: AppSettings): string;
  getMistralApiKey(settings: AppSettings): string;
  getWhisperCppModelStatus(): WhisperCppModelStatus;
  ensureWhisperCppServer(): Promise<void>;
  sendWhisperCppRequest(request: Record<string, any>): Promise<any>;
  transcribeAudioWithParakeet: BufferTranscriber;
  transcribeAudioWithQwen3: BufferTranscriber;
  transcribeAudioWithElevenLabs: CloudBufferTranscriber;
  transcribeAudioWithMistralVoxtral: CloudBufferTranscriber;
  transcribeAudio: CloudBufferTranscriber;
  whisperCppModelName: string;
}

export function resolveWhisperFileTranscriptionPlan(
  sttModel: string | undefined,
  deps: {
    whisperCppModelName: string;
    resolveElevenLabsSttModel(model: string): string;
  }
): WhisperFileTranscriptionPlan {
  const rawModel = sttModel || '';
  let provider: WhisperFileTranscriptionProvider = 'whispercpp';
  let model = `ggml-${deps.whisperCppModelName}`;

  if (rawModel === 'parakeet') {
    provider = 'parakeet';
    model = 'parakeet-tdt-0.6b-v3';
  } else if (rawModel === 'qwen3') {
    provider = 'qwen3';
    model = 'qwen3-asr-0.6b';
  } else if (!rawModel || rawModel === 'default' || rawModel === 'whispercpp') {
    provider = 'whispercpp';
    model = `ggml-${deps.whisperCppModelName}`;
  } else if (rawModel === 'native') {
    provider = 'native';
    model = '';
  } else if (rawModel.startsWith('openai-')) {
    provider = 'openai';
    model = rawModel.slice('openai-'.length);
  } else if (rawModel.startsWith('elevenlabs-')) {
    provider = 'elevenlabs';
    model = deps.resolveElevenLabsSttModel(rawModel);
  } else if (rawModel.startsWith('mistral-')) {
    provider = 'mistral';
    model = rawModel.slice('mistral-'.length) || 'voxtral-mini-latest';
  } else if (rawModel) {
    model = rawModel;
  }

  return { provider, model };
}

export function shouldReadWhisperFileAudioBuffer(provider: WhisperFileTranscriptionProvider): boolean {
  return provider === 'parakeet'
    || provider === 'qwen3'
    || provider === 'openai'
    || provider === 'elevenlabs'
    || provider === 'mistral';
}

function cleanupWhisperFileAudioPath(fs: WhisperFileSystem, audioPath: string): void {
  try { fs.unlinkSync(audioPath); } catch {}
  try { fs.rmdirSync(path.dirname(audioPath), { recursive: true }); } catch {}
}

export async function transcribeWhisperAudioFile(params: {
  audioPath: string;
  options?: { language?: string };
  deps: TranscribeWhisperAudioFileDeps;
}): Promise<string> {
  const { audioPath, options, deps } = params;
  const s = deps.loadSettings();
  if (deps.isAIDisabledInSettings(s)) {
    throw new Error('AI is disabled. Enable AI in Settings -> AI to use Whisper.');
  }
  if (s.ai?.whisperEnabled === false) {
    throw new Error('SuperCmd Whisper is disabled in Settings -> AI.');
  }

  if (!deps.fs.existsSync(audioPath)) {
    throw new Error(`Audio file not found: ${audioPath}`);
  }

  const { provider, model } = resolveWhisperFileTranscriptionPlan(
    s.ai.speechToTextModel || '',
    {
      whisperCppModelName: deps.whisperCppModelName,
      resolveElevenLabsSttModel: deps.resolveElevenLabsSttModel,
    }
  );
  if (provider === 'native') {
    return '';
  }

  const audioBuffer = shouldReadWhisperFileAudioBuffer(provider)
    ? deps.fs.readFileSync(audioPath)
    : null;

  const rawLang = options?.language || s.ai.speechLanguage || 'en-US';
  const language = deps.normalizeWhisperLanguageCode(rawLang);

  if (provider === 'openai' && !s.ai.openaiApiKey) {
    throw new Error('OpenAI API key not configured.');
  }
  const elevenLabsApiKey = deps.getElevenLabsApiKey(s);
  if (provider === 'elevenlabs' && !elevenLabsApiKey) {
    throw new Error('ElevenLabs API key not configured.');
  }
  const mistralApiKey = deps.getMistralApiKey(s);
  if (provider === 'mistral' && !mistralApiKey) {
    throw new Error('Mistral API key not configured.');
  }

  if (provider === 'whispercpp') {
    const status = deps.getWhisperCppModelStatus();
    if (status.state === 'downloading') {
      throw new Error('Whisper model still downloading.');
    }
    if (status.state !== 'downloaded') {
      throw new Error('Whisper model not downloaded.');
    }
    await deps.ensureWhisperCppServer();
    const result = await deps.sendWhisperCppRequest({
      command: 'transcribe',
      file: audioPath,
      language,
    });
    cleanupWhisperFileAudioPath(deps.fs, audioPath);
    return result.text || '';
  }

  if (!audioBuffer) {
    throw new Error(`No audio buffer available for ${provider} transcription.`);
  }

  const mimeType = 'audio/wav';
  const text = provider === 'parakeet'
    ? await deps.transcribeAudioWithParakeet({ audioBuffer, language, mimeType })
    : provider === 'qwen3'
      ? await deps.transcribeAudioWithQwen3({ audioBuffer, language, mimeType })
      : provider === 'elevenlabs'
        ? await deps.transcribeAudioWithElevenLabs({ audioBuffer, apiKey: elevenLabsApiKey, model, language, mimeType })
        : provider === 'mistral'
          ? await deps.transcribeAudioWithMistralVoxtral({ audioBuffer, apiKey: mistralApiKey, model, language, mimeType })
          : await deps.transcribeAudio({ audioBuffer, apiKey: s.ai.openaiApiKey, model, language, mimeType });

  cleanupWhisperFileAudioPath(deps.fs, audioPath);
  return text;
}
