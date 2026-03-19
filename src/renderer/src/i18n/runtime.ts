import enMessages from './locales/en.json';
import zhHansMessages from './locales/zh-Hans.json';
import zhHantMessages from './locales/zh-Hant.json';
import jaMessages from './locales/ja.json';
import koMessages from './locales/ko.json';
import frMessages from './locales/fr.json';
import deMessages from './locales/de.json';
import esMessages from './locales/es.json';
import ruMessages from './locales/ru.json';

export type SupportedAppLocale = 'en' | 'zh-Hans' | 'zh-Hant' | 'ja' | 'ko' | 'fr' | 'de' | 'es' | 'ru';
export type AppLanguageSetting = 'system' | SupportedAppLocale;
export type TranslationValues = Record<string, string | number | boolean | null | undefined>;
type MessageTree = Record<string, string | MessageTree>;

export const DEFAULT_APP_LANGUAGE: AppLanguageSetting = 'system';
export const FALLBACK_APP_LOCALE: SupportedAppLocale = 'en';
export const APP_LANGUAGE_OPTIONS: AppLanguageSetting[] = ['system', 'en', 'zh-Hans', 'zh-Hant', 'ja', 'ko', 'fr', 'de', 'es', 'ru'];

const MESSAGE_CATALOG: Record<SupportedAppLocale, MessageTree> = {
  en: enMessages as MessageTree,
  'zh-Hans': zhHansMessages as MessageTree,
  'zh-Hant': zhHantMessages as MessageTree,
  'ja': jaMessages as MessageTree,
  'ko': koMessages as MessageTree,
  'fr': frMessages as MessageTree,
  'de': deMessages as MessageTree,
  'es': esMessages as MessageTree,
  'ru': ruMessages as MessageTree,
};

function resolveMessage(tree: MessageTree, key: string): string | null {
  const segments = String(key || '')
    .split('.')
    .map((segment) => segment.trim())
    .filter(Boolean);
  let current: string | MessageTree | undefined = tree;
  for (const segment of segments) {
    if (!current || typeof current === 'string') return null;
    current = current[segment];
  }
  return typeof current === 'string' ? current : null;
}

function interpolateMessage(template: string, values?: TranslationValues): string {
  if (!values) return template;
  return template.replace(/\{([^}]+)\}/g, (_match, token) => {
    const value = values[token];
    return value === undefined || value === null ? '' : String(value);
  });
}

export function normalizeAppLanguage(value: unknown): AppLanguageSetting {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-');
  if (!normalized || normalized === 'system' || normalized === 'auto') return DEFAULT_APP_LANGUAGE;
  if (normalized === 'en' || normalized.startsWith('en-')) return 'en';
  if (
    normalized === 'zh' ||
    normalized === 'zh-cn' ||
    normalized === 'zh-sg' ||
    normalized === 'zh-hans' ||
    normalized.startsWith('zh-hans-')
  ) {
    return 'zh-Hans';
  }
  if (
    normalized === 'zh-tw' ||
    normalized === 'zh-hk' ||
    normalized === 'zh-mo' ||
    normalized === 'zh-hant' ||
    normalized.startsWith('zh-hant-')
  ) {
    return 'zh-Hant';
  }
  if (normalized === 'ja' || normalized === 'jp' || normalized.startsWith('ja-')) return 'ja';
  if (normalized === 'ko' || normalized === 'kr' || normalized.startsWith('ko-')) return 'ko';
  if (normalized === 'fr' || normalized.startsWith('fr-')) return 'fr';
  if (normalized === 'de' || normalized.startsWith('de-')) return 'de';
  if (normalized === 'es' || normalized.startsWith('es-')) return 'es';
  if (normalized === 'ru' || normalized.startsWith('ru-')) return 'ru';
  return DEFAULT_APP_LANGUAGE;
}

export function resolveAppLocale(
  language: AppLanguageSetting,
  systemLocale?: string | null
): SupportedAppLocale {
  if (language !== 'system') return language;
  const normalizedLocale = String(systemLocale || '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-');
  if (normalizedLocale.startsWith('zh')) {
    if (
      normalizedLocale === 'zh-tw' ||
      normalizedLocale === 'zh-hk' ||
      normalizedLocale === 'zh-mo' ||
      normalizedLocale === 'zh-hant' ||
      normalizedLocale.startsWith('zh-hant-')
    ) {
      return 'zh-Hant';
    }
    return 'zh-Hans';
  }
  if (normalizedLocale.startsWith('ja') || normalizedLocale.startsWith('jp')) return 'ja';
  if (normalizedLocale.startsWith('ko') || normalizedLocale.startsWith('kr')) return 'ko';
  if (normalizedLocale.startsWith('fr')) return 'fr';
  if (normalizedLocale.startsWith('de')) return 'de';
  if (normalizedLocale.startsWith('es')) return 'es';
  if (normalizedLocale.startsWith('ru')) return 'ru';
  return FALLBACK_APP_LOCALE;
}

export function translateMessage(
  locale: SupportedAppLocale,
  key: string,
  values?: TranslationValues
): string {
  const localeMessage =
    resolveMessage(MESSAGE_CATALOG[locale], key) ??
    resolveMessage(MESSAGE_CATALOG[FALLBACK_APP_LOCALE], key) ??
    key;
  return interpolateMessage(localeMessage, values);
}
