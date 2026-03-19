import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_APP_LANGUAGE,
  normalizeAppLanguage,
  resolveAppLocale,
  translateMessage,
  type AppLanguageSetting,
  type SupportedAppLocale,
  type TranslationValues,
} from './runtime';

type I18nContextValue = {
  language: AppLanguageSetting;
  locale: SupportedAppLocale;
  t: (key: string, values?: TranslationValues) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguage] = useState<AppLanguageSetting>(DEFAULT_APP_LANGUAGE);

  useEffect(() => {
    let disposed = false;
    window.electron.getSettings()
      .then((settings) => {
        if (!disposed) {
          setLanguage(normalizeAppLanguage(settings?.appLanguage));
        }
      })
      .catch(() => {});

    const cleanup = window.electron.onSettingsUpdated?.((settings) => {
      setLanguage(normalizeAppLanguage(settings?.appLanguage));
    });

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  const locale = useMemo(
    () => resolveAppLocale(language, globalThis.navigator?.language),
    [language]
  );

  const t = useCallback(
    (key: string, values?: TranslationValues) => translateMessage(locale, key, values),
    [locale]
  );

  const value = useMemo(() => ({ language, locale, t }), [language, locale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within an I18nProvider.');
  }
  return context;
}
