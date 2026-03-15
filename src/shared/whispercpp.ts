export const DEFAULT_WHISPER_CPP_MODEL = 'base';

export type WhisperCppModelId =
  | 'tiny.en'
  | 'tiny'
  | 'base.en'
  | 'base'
  | 'small.en'
  | 'small'
  | 'medium.en'
  | 'medium'
  | 'large-v3-turbo';

export type WhisperCppModelDefinition = {
  id: WhisperCppModelId;
  label: string;
  badge: 'English-only' | 'Multilingual';
  sizeLabel: string;
  description: string;
  recommended?: boolean;
};

export const WHISPER_CPP_MODELS: WhisperCppModelDefinition[] = [
  {
    id: 'tiny.en',
    label: 'Tiny',
    badge: 'English-only',
    sizeLabel: '~39 MB',
    description: 'Fastest option for English dictation.',
  },
  {
    id: 'tiny',
    label: 'Tiny',
    badge: 'Multilingual',
    sizeLabel: '~75 MB',
    description: 'Fastest option with multilingual support.',
  },
  {
    id: 'base.en',
    label: 'Base',
    badge: 'English-only',
    sizeLabel: '~142 MB',
    description: 'Balanced English model with lower download size.',
  },
  {
    id: 'base',
    label: 'Base',
    badge: 'Multilingual',
    sizeLabel: '~142 MB',
    description: 'Recommended default for offline multilingual dictation.',
    recommended: true,
  },
  {
    id: 'small.en',
    label: 'Small',
    badge: 'English-only',
    sizeLabel: '~466 MB',
    description: 'Higher English accuracy with a larger local model.',
  },
  {
    id: 'small',
    label: 'Small',
    badge: 'Multilingual',
    sizeLabel: '~466 MB',
    description: 'Higher multilingual accuracy with a larger local model.',
  },
  {
    id: 'medium.en',
    label: 'Medium',
    badge: 'English-only',
    sizeLabel: '~1.5 GB',
    description: 'Large English-only model for better recognition quality.',
  },
  {
    id: 'medium',
    label: 'Medium',
    badge: 'Multilingual',
    sizeLabel: '~1.5 GB',
    description: 'Large multilingual model for better recognition quality.',
  },
  {
    id: 'large-v3-turbo',
    label: 'Large v3 Turbo',
    badge: 'Multilingual',
    sizeLabel: '~1.5 GB',
    description: 'Fast large multilingual model with the best accuracy in this list.',
  },
];

export const WHISPER_LANGUAGE_OPTIONS = [
  { value: 'ar-EG', label: 'Arabic' },
  { value: 'zh-CN', label: 'Chinese (Mandarin)' },
  { value: 'en-US', label: 'English (US)' },
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'fr-CA', label: 'French (Canada)' },
  { value: 'fr-FR', label: 'French (France)' },
  { value: 'de-DE', label: 'German' },
  { value: 'hi-IN', label: 'Hindi' },
  { value: 'it-IT', label: 'Italian' },
  { value: 'ja-JP', label: 'Japanese' },
  { value: 'ko-KR', label: 'Korean' },
  { value: 'pt-BR', label: 'Portuguese (Brazil)' },
  { value: 'ru-RU', label: 'Russian' },
  { value: 'es-MX', label: 'Spanish (Mexico)' },
  { value: 'es-ES', label: 'Spanish (Spain)' },
] as const;

export function isWhisperCppModelId(value: string): value is WhisperCppModelId {
  return WHISPER_CPP_MODELS.some((model) => model.id === value);
}

export function normalizeWhisperCppModel(value: string | null | undefined): WhisperCppModelId {
  const normalized = String(value || '').trim();
  if (isWhisperCppModelId(normalized)) {
    return normalized;
  }
  return DEFAULT_WHISPER_CPP_MODEL;
}

export function getWhisperCppModelDefinition(value: string | null | undefined): WhisperCppModelDefinition {
  const modelId = normalizeWhisperCppModel(value);
  return WHISPER_CPP_MODELS.find((model) => model.id === modelId) || WHISPER_CPP_MODELS[0];
}

export function getWhisperCppModelOptionLabel(value: string | null | undefined): string {
  const model = getWhisperCppModelDefinition(value);
  return `${model.label} (${model.badge})`;
}

export function isEnglishOnlyWhisperCppModel(value: string | null | undefined): boolean {
  return getWhisperCppModelDefinition(value).badge === 'English-only';
}

