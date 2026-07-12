export const DEFAULT_TTS_MODEL = 'edge-tts';
export const DEFAULT_EDGE_TTS_VOICE = 'en-US-EricNeural';
export const DEFAULT_ELEVENLABS_VOICE_ID = '21m00Tcm4TlvDq8ikWAM';

export interface SpeakOptions {
  voice: string;
  rate: string;
}

export interface SpeakSettingsSnapshot {
  ai?: {
    textToSpeechModel?: string | null;
    edgeTtsVoice?: string | null;
  } | null;
}

export interface ResolvedSpeakSettings {
  ttsModel: string;
  edgeVoice: string;
  targetVoice: string;
}

export function parseElevenLabsSpeakModel(raw: string): { model: string; voiceId: string } {
  const value = String(raw || '').trim();
  const explicitVoice = /@([A-Za-z0-9]{8,})$/.exec(value)?.[1];
  const modelOnly = explicitVoice ? value.replace(/@[A-Za-z0-9]{8,}$/, '') : value;
  const model = modelOnly.startsWith('elevenlabs-') ? modelOnly : 'elevenlabs-multilingual-v2';
  const voiceId = explicitVoice || DEFAULT_ELEVENLABS_VOICE_ID;
  return { model, voiceId };
}

export function buildElevenLabsSpeakModel(model: string, voiceId: string): string {
  const normalizedModel = String(model || '').trim() || 'elevenlabs-multilingual-v2';
  const normalizedVoice = String(voiceId || '').trim() || DEFAULT_ELEVENLABS_VOICE_ID;
  return `${normalizedModel}@${normalizedVoice}`;
}

export function resolveSpeakSettings(settings: SpeakSettingsSnapshot | null | undefined): ResolvedSpeakSettings {
  const ttsModel = String(settings?.ai?.textToSpeechModel || DEFAULT_TTS_MODEL);
  const edgeVoice = String(settings?.ai?.edgeTtsVoice || DEFAULT_EDGE_TTS_VOICE);
  const targetVoice = ttsModel.startsWith('elevenlabs-')
    ? parseElevenLabsSpeakModel(ttsModel).voiceId
    : edgeVoice;

  return { ttsModel, edgeVoice, targetVoice };
}

export async function applySpeakSettings(
  settings: SpeakSettingsSnapshot | null | undefined,
  options: {
    getCurrentVoice: () => string;
    setConfiguredTtsModel: (value: string) => void;
    setConfiguredEdgeTtsVoice: (value: string) => void;
    updateSpeakOptions: (patch: { voice: string; restartCurrent: false }) => Promise<SpeakOptions | null | undefined>;
    setSpeakOptions: (next: SpeakOptions) => void;
    isDisposed?: () => boolean;
  }
): Promise<ResolvedSpeakSettings> {
  const resolved = resolveSpeakSettings(settings);
  if (options.isDisposed?.()) return resolved;

  options.setConfiguredTtsModel(resolved.ttsModel);
  options.setConfiguredEdgeTtsVoice(resolved.edgeVoice);

  if (!resolved.targetVoice || resolved.targetVoice === options.getCurrentVoice()) {
    return resolved;
  }

  const next = await options.updateSpeakOptions({
    voice: resolved.targetVoice,
    restartCurrent: false,
  });
  if (!next || options.isDisposed?.()) return resolved;

  options.setSpeakOptions(next);
  return resolved;
}
