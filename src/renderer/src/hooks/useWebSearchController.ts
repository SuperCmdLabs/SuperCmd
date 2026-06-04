import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import type {
  AppSettings,
  WebSearchBangCustomProviderSetting,
  WebSearchBangEntry,
  WebSearchBangOverrideSetting,
  WebSearchBangUsageSetting,
} from '../../types/electron';
import type {
  WebSearchBangPromptState,
  WebSearchCustomBangPromptState,
  WebSearchViewSection,
} from '../views/WebSearchView';
import {
  type BangParseState,
  type SearchBangDefinition,
  type WebSearchResult,
  WEB_SEARCH_ACTIVE_BANG_SUGGESTION_LIMIT,
  WEB_SEARCH_BANG_USE_COUNTS_KEY,
  WEB_SEARCH_INITIAL_VISIBLE_RESULTS,
  WEB_SEARCH_RECENT_BANG_LIMIT,
  WEB_SEARCH_SUGGEST_DEBOUNCE_MS,
  WEB_SEARCH_VISIBLE_RESULTS_INCREMENT,
  SEARCH_BANGS,
  createUpdatedBangUsage,
  formatWebSearchBangAliases,
  formatWebSearchBangAliasSummary,
  getBangUsageScore,
  getFaviconUrlForHost,
  getSearchBangByKeyFromList,
  getSortedSearchBangs,
  getWebSearchBangSection,
  getWebSearchBangSectionTitleKey,
  normalizeBangDefinition,
  normalizeWebSearchBangAliasList,
  parseSearchBangFromList,
  parseSearchBangState,
} from '../utils/web-search-bangs';
import { MAX_LAUNCHER_FILE_RESULTS } from '../utils/launcher-file-results';

type UseWebSearchControllerOptions = {
  launcherInputRef: React.RefObject<HTMLInputElement>;
  expandLauncherForDirectLaunch: () => void;
  submitBrowserSearchRef: React.MutableRefObject<
    (query: string, options?: { focusExistingTab?: boolean }) => void | Promise<boolean>
  >;
  setLauncherSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  setLauncherSelectedIndex: React.Dispatch<React.SetStateAction<number>>;
  rootSearchQuery: string;
  aiMode: boolean;
  t: (key: string, params?: Record<string, string | number>) => string;
  browserSearchEnabled: boolean;
};

export function useWebSearchController({
  launcherInputRef,
  expandLauncherForDirectLaunch,
  submitBrowserSearchRef,
  setLauncherSearchQuery,
  setLauncherSelectedIndex,
  rootSearchQuery,
  aiMode,
  t,
  browserSearchEnabled,
}: UseWebSearchControllerOptions) {
  const [webSearchQuery, setWebSearchQuery] = useState<string | null>(null);
  const [webSearchSelectedIndex, setWebSearchSelectedIndex] = useState(0);
  const [rootWebSearchSuggestions, setRootWebSearchSuggestions] = useState<string[]>([]);
  const [webSearchSuggestions, setWebSearchSuggestions] = useState<string[]>([]);
  const [webSearchDefaultBangKey, setWebSearchDefaultBangKey] = useState('g');
  const [webSearchBangUsage, setWebSearchBangUsage] = useState<Record<string, WebSearchBangUsageSetting>>({});
  const [webSearchBangCatalog, setWebSearchBangCatalog] = useState<SearchBangDefinition[]>([]);
  const [webSearchBangOverrides, setWebSearchBangOverrides] = useState<WebSearchBangOverrideSetting[]>([]);
  const [webSearchDisabledBangKeys, setWebSearchDisabledBangKeys] = useState<string[]>([]);
  const [webSearchBangCustomProviders, setWebSearchBangCustomProviders] = useState<WebSearchBangCustomProviderSetting[]>([]);
  const [webSearchShowHiddenBangs, setWebSearchShowHiddenBangs] = useState(false);
  const [webSearchBangPrompt, setWebSearchBangPrompt] = useState<WebSearchBangPromptState | null>(null);
  const [webSearchCustomBangPrompt, setWebSearchCustomBangPrompt] = useState<WebSearchCustomBangPromptState | null>(null);
  const [webSearchVisibleResultCount, setWebSearchVisibleResultCount] = useState(WEB_SEARCH_INITIAL_VISIBLE_RESULTS);

  const webSearchInputRef = useRef<HTMLInputElement>(null);
  const webSearchBangInputRef = useRef<HTMLInputElement>(null);
  const lastRecordedRootBangUseRef = useRef<string | null>(null);
  const lastRecordedWebBangUseRef = useRef<string | null>(null);

  const hydrateWebSearchSettings = useCallback((settings: AppSettings) => {
    setWebSearchDefaultBangKey(String(settings.browserSearch?.webSearchDefaultBangKey || 'g'));
    setWebSearchBangOverrides(
      Array.isArray(settings.browserSearch?.webSearchBangOverrides)
        ? settings.browserSearch.webSearchBangOverrides
        : []
    );
    setWebSearchBangUsage(
      settings.browserSearch?.webSearchBangUsage && typeof settings.browserSearch.webSearchBangUsage === 'object'
        ? settings.browserSearch.webSearchBangUsage
        : {}
    );
    setWebSearchDisabledBangKeys(
      Array.isArray(settings.browserSearch?.webSearchDisabledBangKeys)
        ? settings.browserSearch.webSearchDisabledBangKeys
        : []
    );
    setWebSearchBangCustomProviders(
      Array.isArray(settings.browserSearch?.webSearchBangCustomProviders)
        ? settings.browserSearch.webSearchBangCustomProviders
        : []
    );
    setWebSearchShowHiddenBangs(Boolean(settings.browserSearch?.webSearchShowHiddenBangs));
  }, []);

  const effectiveSearchBangs = useMemo(() => {
    const byKey = new Map<string, SearchBangDefinition>();
    for (const entry of webSearchBangCatalog) {
      byKey.set(entry.key, entry);
    }
    for (const entry of SEARCH_BANGS) {
      const normalized = normalizeBangDefinition(entry);
      byKey.set(normalized.key, normalized);
    }
    for (const entry of webSearchBangCustomProviders) {
      const normalized = normalizeBangDefinition({
        key: entry.key,
        aliases: entry.aliases,
        name: entry.name,
        host: entry.host,
        template: entry.template,
        category: 'Custom',
        source: 'custom',
      });
      byKey.set(normalized.key, normalized);
    }
    for (const override of webSearchBangOverrides) {
      const current = byKey.get(override.key);
      if (!current) continue;
      byKey.set(override.key, {
        ...current,
        aliases: override.aliases.filter((alias) => alias !== override.key),
      });
    }
    return Array.from(byKey.values());
  }, [webSearchBangCatalog, webSearchBangOverrides, webSearchBangCustomProviders]);

  const disabledBangKeySet = useMemo(
    () => new Set(webSearchDisabledBangKeys.map((key) => key.toLowerCase())),
    [webSearchDisabledBangKeys]
  );

  const enabledSearchBangs = useMemo(
    () => effectiveSearchBangs.filter((bang) => !disabledBangKeySet.has(bang.key)),
    [effectiveSearchBangs, disabledBangKeySet]
  );

  const rootBangState = useMemo<BangParseState>(() => {
    if (aiMode) return { mode: 'none' };
    return parseSearchBangState(rootSearchQuery, enabledSearchBangs);
  }, [aiMode, rootSearchQuery, enabledSearchBangs]);

  const recordWebSearchBangUse = useCallback((bangKey: string) => {
    const normalizedKey = String(bangKey || '').trim().toLowerCase();
    if (!normalizedKey) return;
    setWebSearchBangUsage((current) => {
      const next = { ...current, [normalizedKey]: createUpdatedBangUsage(current[normalizedKey]) };
      try {
        localStorage.setItem(WEB_SEARCH_BANG_USE_COUNTS_KEY, JSON.stringify(Object.fromEntries(
          Object.entries(next).map(([key, value]) => [key, value.useCount])
        )));
      } catch {}
      window.electron.getSettings()
        .then((settings) => window.electron.saveSettings({
          browserSearch: {
            ...settings.browserSearch,
            webSearchBangUsage: next,
          },
        }))
        .catch(() => {});
      return next;
    });
  }, []);

  const closeWebSearch = useCallback(() => {
    setWebSearchQuery(null);
    setWebSearchSelectedIndex(0);
    setWebSearchSuggestions([]);
    setTimeout(() => launcherInputRef.current?.focus(), 50);
  }, [launcherInputRef]);

  const openWebSearchMode = useCallback((initialQuery = '') => {
    expandLauncherForDirectLaunch();
    setWebSearchQuery(initialQuery);
    setWebSearchSelectedIndex(0);
    window.setTimeout(() => webSearchInputRef.current?.focus(), 0);
  }, [expandLauncherForDirectLaunch]);

  const webSearchBangState = useMemo<BangParseState>(() => {
    if (webSearchQuery === null) return { mode: 'none' };
    return parseSearchBangState(webSearchQuery, enabledSearchBangs);
  }, [enabledSearchBangs, webSearchQuery]);

  const webSearchResults = useMemo<WebSearchResult[]>(() => {
    if (webSearchQuery === null) return [];
    const raw = String(webSearchQuery || '').trim();
    const results: WebSearchResult[] = [];
    if (raw && (webSearchBangState.mode === 'none' || webSearchBangState.mode === 'active')) {
      const activeBang = webSearchBangState.mode === 'active' ? webSearchBangState.bang : null;
      const defaultBang = getSearchBangByKeyFromList(webSearchDefaultBangKey, effectiveSearchBangs);
      const provider = activeBang || defaultBang;
      const searchSubject = (webSearchBangState.mode === 'active' ? webSearchBangState.query : raw).trim();
      if (!searchSubject) return [];
      results.push({
        id: 'web-search-mode:direct',
        kind: 'search',
        section: 'search',
        title: activeBang
          ? t('launcher.browserSearch.searchProviderFor', { provider: provider.name, query: searchSubject })
          : t('launcher.browserSearch.searchFor', { query: searchSubject }),
        subtitle: activeBang
          ? t('launcher.browserSearch.bangSubtitle', { bang: activeBang.key })
          : t('launcher.browserSearch.defaultSearch'),
        query: activeBang ? `${searchSubject} !${activeBang.key}` : searchSubject,
        bangKey: activeBang?.key,
        bang: activeBang || undefined,
        faviconUrl: getFaviconUrlForHost(provider.host),
      });
      for (const suggestion of webSearchSuggestions) {
        const normalized = String(suggestion || '').trim();
        if (!normalized || normalized.toLowerCase() === searchSubject.toLowerCase()) continue;
        results.push({
          id: `web-search-mode:suggestion:${normalized}`,
          kind: 'suggestion',
          section: 'search',
          title: normalized,
          subtitle: activeBang
            ? t('launcher.browserSearch.bangSubtitle', { bang: activeBang.key })
            : t('launcher.browserSearch.defaultSearch'),
          query: activeBang ? `${normalized} !${activeBang.key}` : normalized,
          bangKey: activeBang?.key,
          bang: activeBang || undefined,
          faviconUrl: getFaviconUrlForHost(provider.host),
        });
      }
      return results;
    }

    const parsed = parseSearchBangFromList(raw, enabledSearchBangs);
    const bangFilter = parsed.activeBangPrefix !== null
      ? parsed.activeBangPrefix
      : raw.replace(/^!+/, '');
    const sectionFilter = parsed.bang && !parsed.query ? '' : bangFilter;
    const candidateSource = webSearchShowHiddenBangs
      ? effectiveSearchBangs.filter((bang) => disabledBangKeySet.has(bang.key))
      : enabledSearchBangs;
    const sorted = parsed.bang && !parsed.query
      ? [parsed.bang, ...getSortedSearchBangs(candidateSource, null, webSearchBangUsage).filter((bang) => bang.key !== parsed.bang?.key)]
      : getSortedSearchBangs(candidateSource, bangFilter, webSearchBangUsage);
    const recentKeys = new Set<string>();
    const recentBangs = !sectionFilter && !webSearchShowHiddenBangs
      ? [...sorted]
          .filter((bang) => getBangUsageScore(webSearchBangUsage[bang.key]) > 0)
          .sort((a, b) => getBangUsageScore(webSearchBangUsage[b.key]) - getBangUsageScore(webSearchBangUsage[a.key]))
          .slice(0, WEB_SEARCH_RECENT_BANG_LIMIT)
      : [];
    for (const bang of recentBangs) recentKeys.add(bang.key);
    const matchingBangs = webSearchShowHiddenBangs
      ? sorted
      : sectionFilter
        ? sorted
        : [...recentBangs, ...sorted.filter((bang) => !recentKeys.has(bang.key))];
    for (const bang of matchingBangs) {
      const defaultAliases = [bang.key, ...(bang.aliases || [])];
      const aliasSummary = formatWebSearchBangAliasSummary(defaultAliases);
      const baseSubtitle = [bang.category, bang.subcategory, bang.host].filter(Boolean).join(' - ') || bang.host;
      results.push({
        id: `web-search-result:bang:${bang.key}`,
        kind: 'bang',
        section: webSearchShowHiddenBangs
          ? 'hidden'
          : recentKeys.has(bang.key) && !sectionFilter
            ? 'recent'
            : getWebSearchBangSection(bang, sectionFilter, webSearchBangUsage),
        title: `!${bang.key} ${bang.name}`,
        subtitle: aliasSummary ? `${baseSubtitle} - ${aliasSummary}` : baseSubtitle,
        query: `!${bang.key} `,
        bangKey: bang.key,
        defaultAliases,
        customAliases: webSearchBangOverrides.find((override) => override.key === bang.key)?.aliases,
        isCustom: webSearchBangOverrides.some((override) => override.key === bang.key),
        isDisabled: disabledBangKeySet.has(bang.key),
        bang,
        faviconUrl: getFaviconUrlForHost(bang.host),
      });
    }
    return results;
  }, [effectiveSearchBangs, enabledSearchBangs, disabledBangKeySet, t, webSearchBangOverrides, webSearchBangState, webSearchBangUsage, webSearchDefaultBangKey, webSearchQuery, webSearchShowHiddenBangs, webSearchSuggestions]);

  const visibleWebSearchResults = useMemo(
    () => webSearchResults.slice(0, Math.min(webSearchVisibleResultCount, webSearchResults.length)),
    [webSearchResults, webSearchVisibleResultCount]
  );

  const visibleWebSearchSections = useMemo(() => {
    const sections: WebSearchViewSection[] = [];
    const indexByKey = new Map<WebSearchResult['section'], number>();
    visibleWebSearchResults.forEach((result, flatIndex) => {
      const sectionIndex = indexByKey.get(result.section);
      if (sectionIndex === undefined) {
        indexByKey.set(result.section, sections.length);
        sections.push({
          key: result.section,
          titleKey: getWebSearchBangSectionTitleKey(result.section),
          items: [result],
          startIndex: flatIndex,
        });
        return;
      }
      sections[sectionIndex].items.push(result);
    });
    return sections;
  }, [visibleWebSearchResults]);

  const selectedWebSearchResult = webSearchResults[webSearchSelectedIndex] || null;
  const isWebSearchBangManager = !String(webSearchQuery || '').trim() ||
    webSearchBangState.mode === 'selecting' ||
    webSearchShowHiddenBangs;
  const activeWebSearchBang = webSearchBangState.mode === 'active' ? webSearchBangState.bang : null;

  const activateWebSearchResult = useCallback(async (result: WebSearchResult | null) => {
    if (!result) return;
    if (result.kind === 'bang') {
      setWebSearchQuery(null);
      setWebSearchSelectedIndex(0);
      setLauncherSearchQuery(result.query);
      setLauncherSelectedIndex(0);
      window.setTimeout(() => launcherInputRef.current?.focus(), 0);
      return;
    }
    await submitBrowserSearchRef.current(result.query);
  }, [launcherInputRef, setLauncherSearchQuery, setLauncherSelectedIndex, submitBrowserSearchRef]);

  const openWebSearchBangPrompt = useCallback((result: WebSearchResult | null) => {
    if (!result || result.kind !== 'bang' || !result.bangKey) return;
    setWebSearchBangPrompt({
      result,
      value: formatWebSearchBangAliases(result.customAliases || result.defaultAliases || [result.bangKey]),
    });
  }, []);

  const closeWebSearchBangPrompt = useCallback(() => {
    setWebSearchBangPrompt(null);
    window.setTimeout(() => webSearchInputRef.current?.focus(), 0);
  }, []);

  const saveWebSearchBangAliases = useCallback(async () => {
    if (!webSearchBangPrompt?.result.bangKey) return;
    const key = webSearchBangPrompt.result.bangKey;
    const aliases = normalizeWebSearchBangAliasList(webSearchBangPrompt.value);
    const defaultAliases = normalizeWebSearchBangAliasList(
      formatWebSearchBangAliases(webSearchBangPrompt.result.defaultAliases || [key])
    );
    const changed = aliases.join(',') !== defaultAliases.join(',');
    try {
      const currentSettings = await window.electron.getSettings();
      const browserSearchSettings = currentSettings.browserSearch;
      const currentOverrides = Array.isArray(browserSearchSettings?.webSearchBangOverrides)
        ? browserSearchSettings.webSearchBangOverrides
        : [];
      const nextOverrides = currentOverrides.filter((override) => override.key !== key);
      if (changed && aliases.length > 0) {
        nextOverrides.push({ key, aliases });
      }
      const sortedOverrides = nextOverrides.sort((a, b) => a.key.localeCompare(b.key));
      await window.electron.saveSettings({
        browserSearch: {
          ...browserSearchSettings,
          webSearchBangOverrides: sortedOverrides,
        },
      });
      setWebSearchBangOverrides(sortedOverrides);
    } catch (error) {
      console.error('Failed to save web search bang aliases:', error);
    } finally {
      closeWebSearchBangPrompt();
    }
  }, [closeWebSearchBangPrompt, webSearchBangPrompt]);

  const toggleWebSearchBangDisabled = useCallback(async (result: WebSearchResult | null) => {
    if (!result?.bangKey) return;
    const key = result.bangKey;
    try {
      const currentSettings = await window.electron.getSettings();
      const browserSearchSettings = currentSettings.browserSearch;
      const currentDisabled = Array.isArray(browserSearchSettings?.webSearchDisabledBangKeys)
        ? browserSearchSettings.webSearchDisabledBangKeys
        : [];
      const disabledSet = new Set(currentDisabled);
      if (disabledSet.has(key)) {
        disabledSet.delete(key);
      } else {
        disabledSet.add(key);
      }
      const nextDisabled = Array.from(disabledSet).sort();
      await window.electron.saveSettings({
        browserSearch: {
          ...browserSearchSettings,
          webSearchDisabledBangKeys: nextDisabled,
        },
      });
      setWebSearchDisabledBangKeys(nextDisabled);
    } catch (error) {
      console.error('Failed to update disabled bang:', error);
    }
  }, []);

  const toggleWebSearchShowHidden = useCallback(async () => {
    const next = !webSearchShowHiddenBangs;
    setWebSearchShowHiddenBangs(next);
    setWebSearchSelectedIndex(0);
    try {
      const currentSettings = await window.electron.getSettings();
      await window.electron.saveSettings({
        browserSearch: {
          ...currentSettings.browserSearch,
          webSearchShowHiddenBangs: next,
        },
      });
    } catch (error) {
      console.error('Failed to save hidden bang visibility:', error);
    }
  }, [webSearchShowHiddenBangs]);

  const openWebSearchCustomBangPrompt = useCallback(() => {
    setWebSearchCustomBangPrompt({
      key: '',
      aliases: '',
      name: '',
      host: '',
      template: 'https://example.com/search?q={query}',
    });
  }, []);

  const closeWebSearchCustomBangPrompt = useCallback(() => {
    setWebSearchCustomBangPrompt(null);
    window.setTimeout(() => webSearchInputRef.current?.focus(), 0);
  }, []);

  const saveWebSearchCustomBang = useCallback(async () => {
    if (!webSearchCustomBangPrompt) return;
    const key = normalizeWebSearchBangAliasList(webSearchCustomBangPrompt.key)[0] || '';
    const aliases = normalizeWebSearchBangAliasList(webSearchCustomBangPrompt.aliases).filter((alias) => alias !== key);
    const name = webSearchCustomBangPrompt.name.trim();
    const host = webSearchCustomBangPrompt.host.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
    const template = webSearchCustomBangPrompt.template.trim().replace(/\{\{\{s\}\}\}/g, '{query}');
    if (!key || !name || !host || !template.includes('{query}')) return;
    try {
      const currentSettings = await window.electron.getSettings();
      const browserSearchSettings = currentSettings.browserSearch;
      const currentProviders = Array.isArray(browserSearchSettings?.webSearchBangCustomProviders)
        ? browserSearchSettings.webSearchBangCustomProviders
        : [];
      const nextProviders = [
        ...currentProviders.filter((provider) => provider.key !== key),
        { key, aliases, name, host, template },
      ].sort((a, b) => a.key.localeCompare(b.key));
      await window.electron.saveSettings({
        browserSearch: {
          ...browserSearchSettings,
          webSearchBangCustomProviders: nextProviders,
        },
      });
      setWebSearchBangCustomProviders(nextProviders);
      closeWebSearchCustomBangPrompt();
    } catch (error) {
      console.error('Failed to save custom bang:', error);
    }
  }, [closeWebSearchCustomBangPrompt, webSearchCustomBangPrompt]);

  const loadMoreWebSearchResults = useCallback(() => {
    setWebSearchVisibleResultCount((count) =>
      Math.min(webSearchResults.length, count + WEB_SEARCH_VISIBLE_RESULTS_INCREMENT)
    );
  }, [webSearchResults.length]);

  useEffect(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(WEB_SEARCH_BANG_USE_COUNTS_KEY) || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
      setWebSearchBangUsage((current) => {
        if (Object.keys(current).length > 0) return current;
        return Object.entries(parsed).reduce((acc, [key, value]) => {
          const normalizedKey = String(key || '').trim().toLowerCase();
          const count = Math.floor(Number(value));
          if (normalizedKey && Number.isFinite(count) && count > 0) {
            acc[normalizedKey] = { useCount: count, lastUsedAt: Date.now(), frecencyScore: count };
          }
          return acc;
        }, {} as Record<string, WebSearchBangUsageSetting>);
      });
    } catch {}
  }, []);

  useEffect(() => {
    if (!browserSearchEnabled) {
      setWebSearchBangCatalog([]);
      return;
    }
    let cancelled = false;
    window.electron.webSearchListBangs?.()
      .then((entries: WebSearchBangEntry[]) => {
        if (cancelled || !Array.isArray(entries)) return;
        const next = entries
          .map((entry): SearchBangDefinition | null => {
            const rawKey = String(entry?.key || '').trim().toLowerCase().replace(/^!+/, '');
            if (!rawKey) return null;
            return normalizeBangDefinition({
              key: rawKey,
              aliases: Array.isArray(entry.aliases) ? entry.aliases : [],
              name: String(entry.name || rawKey),
              host: String(entry.host || 'duckduckgo.com'),
              category: entry.category,
              subcategory: entry.subcategory,
              template: String(entry.urlTemplate || 'https://duckduckgo.com/?q=!{bang}%20{query}'),
              source: entry.source || 'duckduckgo',
              rankHint: entry.rankHint,
            });
          })
          .filter((entry): entry is SearchBangDefinition => Boolean(entry));
        setWebSearchBangCatalog(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [browserSearchEnabled]);

  useEffect(() => {
    if (rootBangState.mode !== 'active') {
      lastRecordedRootBangUseRef.current = null;
      return;
    }
    const key = rootBangState.bang.key;
    if (lastRecordedRootBangUseRef.current === key) return;
    lastRecordedRootBangUseRef.current = key;
    recordWebSearchBangUse(key);
  }, [recordWebSearchBangUse, rootBangState]);

  useEffect(() => {
    if (webSearchBangState.mode !== 'active') {
      lastRecordedWebBangUseRef.current = null;
      return;
    }
    const key = webSearchBangState.bang.key;
    if (lastRecordedWebBangUseRef.current === key) return;
    lastRecordedWebBangUseRef.current = key;
    recordWebSearchBangUse(key);
  }, [recordWebSearchBangUse, webSearchBangState]);

  useEffect(() => {
    if (aiMode) {
      setRootWebSearchSuggestions([]);
      return;
    }
    const query = (rootBangState.mode === 'active' ? rootBangState.query : rootSearchQuery).trim();
    if (!query) {
      setRootWebSearchSuggestions([]);
      return;
    }
    const provider = rootBangState.mode === 'active' ? rootBangState.bang : undefined;
    const limit = rootBangState.mode === 'active' ? WEB_SEARCH_ACTIVE_BANG_SUGGESTION_LIMIT : MAX_LAUNCHER_FILE_RESULTS;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      window.electron.browserSearchSuggestMany(query, limit, provider ? { key: provider.key, host: provider.host, name: provider.name } : undefined)
        .then((suggestions) => {
          if (cancelled) return;
          setRootWebSearchSuggestions(Array.isArray(suggestions) ? suggestions.slice(0, limit) : []);
        })
        .catch(() => {
          if (!cancelled) setRootWebSearchSuggestions([]);
        });
    }, WEB_SEARCH_SUGGEST_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [aiMode, rootSearchQuery, rootBangState]);

  useEffect(() => {
    if (webSearchQuery === null) return;
    const raw = String(webSearchQuery || '').trim();
    const searchSubject = webSearchBangState.mode === 'active' ? webSearchBangState.query.trim() : raw;
    const shouldFetch = Boolean(searchSubject) && (webSearchBangState.mode === 'active' || webSearchBangState.mode === 'none');
    if (!shouldFetch) {
      setWebSearchSuggestions([]);
      return;
    }
    const provider = webSearchBangState.mode === 'active'
      ? webSearchBangState.bang
      : getSearchBangByKeyFromList(webSearchDefaultBangKey, effectiveSearchBangs);
    const limit = webSearchBangState.mode === 'active'
      ? WEB_SEARCH_ACTIVE_BANG_SUGGESTION_LIMIT
      : MAX_LAUNCHER_FILE_RESULTS;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      window.electron.browserSearchSuggestMany(searchSubject, limit, { key: provider.key, host: provider.host, name: provider.name })
        .then((suggestions) => {
          if (cancelled) return;
          setWebSearchSuggestions(Array.isArray(suggestions) ? suggestions.slice(0, limit) : []);
        })
        .catch(() => {
          if (!cancelled) setWebSearchSuggestions([]);
        });
    }, WEB_SEARCH_SUGGEST_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [effectiveSearchBangs, webSearchBangState, webSearchDefaultBangKey, webSearchQuery]);

  useEffect(() => {
    setWebSearchSelectedIndex(0);
    setWebSearchVisibleResultCount(WEB_SEARCH_INITIAL_VISIBLE_RESULTS);
  }, [webSearchQuery]);

  useEffect(() => {
    if (webSearchQuery === null) return;
    setWebSearchSelectedIndex((index) => Math.min(index, Math.max(0, webSearchResults.length - 1)));
  }, [webSearchQuery, webSearchResults.length]);

  useEffect(() => {
    if (webSearchQuery === null) return;
    if (webSearchSelectedIndex < webSearchVisibleResultCount - 12) return;
    setWebSearchVisibleResultCount((count) =>
      Math.min(webSearchResults.length, count + WEB_SEARCH_VISIBLE_RESULTS_INCREMENT)
    );
  }, [webSearchQuery, webSearchResults.length, webSearchSelectedIndex, webSearchVisibleResultCount]);

  useEffect(() => {
    if (webSearchQuery === null) return;
    window.setTimeout(() => webSearchInputRef.current?.focus(), 0);
  }, [webSearchQuery]);

  useEffect(() => {
    if (!webSearchBangPrompt) return;
    const timer = window.setTimeout(() => {
      webSearchBangInputRef.current?.focus();
      webSearchBangInputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [webSearchBangPrompt?.result.id]);

  useEffect(() => {
    if (!webSearchBangPrompt) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeWebSearchBangPrompt();
        return;
      }
      if (
        (event.key === 'Enter' || event.code === 'Enter' || event.code === 'NumpadEnter') &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey
      ) {
        event.preventDefault();
        void saveWebSearchBangAliases();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [closeWebSearchBangPrompt, saveWebSearchBangAliases, webSearchBangPrompt]);

  useEffect(() => {
    if (!webSearchCustomBangPrompt) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeWebSearchCustomBangPrompt();
        return;
      }
      if (
        (event.key === 'Enter' || event.code === 'Enter' || event.code === 'NumpadEnter') &&
        event.metaKey &&
        !event.altKey &&
        !event.ctrlKey
      ) {
        event.preventDefault();
        void saveWebSearchCustomBang();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [closeWebSearchCustomBangPrompt, saveWebSearchCustomBang, webSearchCustomBangPrompt]);

  useEffect(() => {
    if (webSearchQuery === null || webSearchBangPrompt) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && (event.key === 'n' || event.key === 'N')) {
        event.preventDefault();
        event.stopPropagation();
        if (selectedWebSearchResult?.kind === 'bang') {
          openWebSearchBangPrompt(selectedWebSearchResult);
        } else {
          openWebSearchCustomBangPrompt();
        }
        return;
      }
      if (
        event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey &&
        (event.key === 'd' || event.key === 'D') &&
        selectedWebSearchResult?.kind === 'bang'
      ) {
        event.preventDefault();
        event.stopPropagation();
        void toggleWebSearchBangDisabled(selectedWebSearchResult);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [openWebSearchBangPrompt, openWebSearchCustomBangPrompt, selectedWebSearchResult, toggleWebSearchBangDisabled, webSearchBangPrompt, webSearchQuery]);

  return {
    webSearchQuery,
    setWebSearchQuery,
    webSearchSelectedIndex,
    setWebSearchSelectedIndex,

    webSearchInputRef,
    webSearchBangInputRef,

    webSearchDefaultBangKey,
    webSearchBangUsage,
    webSearchShowHiddenBangs,

    effectiveSearchBangs,
    enabledSearchBangs,
    rootBangState,
    rootWebSearchSuggestions,

    webSearchBangState,
    webSearchResults,
    visibleWebSearchSections,
    selectedWebSearchResult,
    isWebSearchBangManager,
    activeWebSearchBang,

    webSearchBangPrompt,
    setWebSearchBangPrompt,
    webSearchCustomBangPrompt,
    setWebSearchCustomBangPrompt,

    recordWebSearchBangUse,
    closeWebSearch,
    openWebSearchMode,
    activateWebSearchResult,
    loadMoreWebSearchResults,

    openWebSearchBangPrompt,
    saveWebSearchBangAliases,
    toggleWebSearchBangDisabled,
    toggleWebSearchShowHidden,

    openWebSearchCustomBangPrompt,
    closeWebSearchCustomBangPrompt,
    saveWebSearchCustomBang,

    hydrateWebSearchSettings,
  };
}
