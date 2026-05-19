import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BrowserSearchResult, BrowserHistoryProfileOption } from './useBrowserSearch';
import type {
  BrowserProfileFilterKind,
  BrowserProfileSetting,
  BrowserSearchNicknameSetting,
  BrowserSearchResultGroupSetting,
} from '../../types/electron';
import type { BrowserResultsViewScope } from '../utils/browser-search-commands';
import {
  canEditBrowserResultNickname,
  formatBrowserHistoryDateSection,
  getBrowserResultNicknameKey,
  getSuggestedBookmarkNickname,
  normalizeBookmarkNickname,
  normalizeBookmarkNicknameUrl,
} from '../utils/browser-search-commands';

type UseBrowserResultsControllerOptions = {
  browserSearch: {
    getAllResults: (
      input: string,
      resultGroups: BrowserSearchResultGroupSetting[]
    ) => BrowserSearchResult[];
    getOpenTabResults: (input: string, limit?: number) => BrowserSearchResult[];
    getBookmarkResults: (input: string, limit?: number) => BrowserSearchResult[];
    getHistoryResults: (
      input: string,
      profileIds?: string[] | null,
      showProfileContext?: boolean,
      limit?: number
    ) => BrowserSearchResult[];
    getHistoryProfiles: () => BrowserHistoryProfileOption[];
    getProfileFilterOptions: (kind: BrowserProfileFilterKind) => BrowserHistoryProfileOption[];
    profileFilters: Partial<Record<BrowserProfileFilterKind, string[]>>;
    profiles: BrowserProfileSetting[];
    executeBrowserSearch: (
      input: string,
      options?: any
    ) => Promise<boolean>;
    refreshOpenTabs: () => void;
    refreshBrowserEntries: () => void;
  };
  resultGroups: BrowserSearchResultGroupSetting[];
  launcherInputRef: React.RefObject<HTMLInputElement>;
  t: (key: string, params?: Record<string, string | number>) => string;
};

function scopeToFilterKind(scope: BrowserResultsViewScope): BrowserProfileFilterKind | null {
  if (scope === 'open-tabs') return 'open-tab';
  if (scope === 'bookmarks') return 'bookmark';
  if (scope === 'history') return 'history';
  return null;
}

const BROWSER_RESULTS_PAGE_SIZE = 160;

export function useBrowserResultsController({
  browserSearch,
  resultGroups,
  launcherInputRef,
  t,
}: UseBrowserResultsControllerOptions) {
  const [browserResultsViewQuery, setBrowserResultsViewQuery] = useState<string | null>(null);
  const [browserResultsViewScope, setBrowserResultsViewScope] = useState<BrowserResultsViewScope>('all');
  const [browserResultsViewSelectedIndex, setBrowserResultsViewSelectedIndex] = useState(0);
  const [browserResultsViewLimit, setBrowserResultsViewLimit] = useState(BROWSER_RESULTS_PAGE_SIZE);
  const [browserHistoryProfileMenuOpen, setBrowserHistoryProfileMenuOpen] = useState(false);
  const [browserProfileFilterOverrides, setBrowserProfileFilterOverrides] = useState<Partial<Record<BrowserProfileFilterKind, string[]>>>({});
  const [bookmarkNicknamePrompt, setBookmarkNicknamePrompt] = useState<{
    result: BrowserSearchResult;
    value: string;
  } | null>(null);

  const browserResultsViewInputRef = useRef<HTMLInputElement>(null);
  const bookmarkNicknameInputRef = useRef<HTMLInputElement>(null);

  const browserHistoryProfileOptions = useMemo(() => {
    const filterKind = scopeToFilterKind(browserResultsViewScope);
    if (filterKind) return browserSearch.getProfileFilterOptions(filterKind);
    return browserSearch.getHistoryProfiles();
  }, [browserSearch, browserResultsViewScope]);

  const effectiveBrowserHistoryProfileIds = useMemo(() => {
    const filterKind = scopeToFilterKind(browserResultsViewScope);
    if (!filterKind) return null;
    const allProfileIds = browserHistoryProfileOptions.map((profile) => profile.id);
    const allProfileIdSet = new Set(allProfileIds);
    const override = browserProfileFilterOverrides[filterKind];
    if (override) return override.filter((id) => allProfileIdSet.has(id));
    const saved = browserSearch.profileFilters?.[filterKind];
    return saved === undefined ? allProfileIds : saved.filter((id) => allProfileIdSet.has(id));
  }, [browserHistoryProfileOptions, browserResultsViewScope, browserSearch.profileFilters, browserProfileFilterOverrides]);

  const browserResultsViewResults = useMemo(() => {
    if (browserResultsViewQuery === null) return [];
    if (browserResultsViewScope === 'open-tabs') {
      const enabled = effectiveBrowserHistoryProfileIds ? new Set(effectiveBrowserHistoryProfileIds) : null;
      return browserSearch.getOpenTabResults(browserResultsViewQuery, browserResultsViewLimit).filter((result) =>
        !enabled || !result.sourceProfileId || enabled.has(result.sourceProfileId)
      );
    }
    if (browserResultsViewScope === 'bookmarks') {
      const enabled = effectiveBrowserHistoryProfileIds ? new Set(effectiveBrowserHistoryProfileIds) : null;
      return browserSearch.getBookmarkResults(browserResultsViewQuery, browserResultsViewLimit).filter((result) =>
        !enabled || !result.sourceProfileId || enabled.has(result.sourceProfileId)
      );
    }
    if (browserResultsViewScope === 'history') {
      return browserSearch.getHistoryResults(
        browserResultsViewQuery,
        effectiveBrowserHistoryProfileIds,
        browserHistoryProfileOptions.length > 1,
        browserResultsViewLimit
      );
    }
    return browserSearch.getAllResults(browserResultsViewQuery, resultGroups);
  }, [browserHistoryProfileOptions.length, browserSearch, resultGroups, browserResultsViewLimit, browserResultsViewQuery, browserResultsViewScope, effectiveBrowserHistoryProfileIds]);

  const browserResultsViewSections = useMemo(() => {
    if (browserResultsViewScope === 'open-tabs') {
      const sections: Array<{
        key: string;
        kind: 'open-tab';
        title: string;
        profileLabel: string;
        windowLabel: string | number;
        items: BrowserSearchResult[];
      }> = [];
      const sectionByWindow = new Map<string, number>();
      for (const result of browserResultsViewResults) {
        const profileLabel = result.profileLabel || result.profileName || result.browserName || t('launcher.badges.openTab');
        const windowIdentity = result.windowId || (result.windowOrdinal ? `ordinal-${result.windowOrdinal}` : `tab-${result.tabId || result.id}`);
        const windowKey = [result.sourceProfileId || profileLabel, windowIdentity].join(':');
        let sectionIndex = sectionByWindow.get(windowKey);
        if (sectionIndex === undefined) {
          sectionIndex = sections.length;
          sectionByWindow.set(windowKey, sectionIndex);
          const windowLabel = result.windowOrdinal && result.windowOrdinal > 0
            ? result.windowOrdinal
            : sectionIndex + 1;
          sections.push({
            key: `open-tab-window-${windowKey}`,
            kind: 'open-tab',
            title: `${profileLabel} - Window ${windowLabel} - 0 Tabs`,
            profileLabel,
            windowLabel,
            items: [],
          });
        }
        const section = sections[sectionIndex];
        section.items.push(result);
        section.title = `${section.profileLabel} - Window ${section.windowLabel} - ${section.items.length} ${section.items.length === 1 ? 'Tab' : 'Tabs'}`;
      }
      return sections;
    }
    if (browserResultsViewScope === 'bookmarks') {
      const sections: Array<{
        key: string;
        kind: 'bookmark';
        title: string;
        items: BrowserSearchResult[];
      }> = [];
      const sectionByFolder = new Map<string, number>();
      for (const result of browserResultsViewResults) {
        const profileLabel = result.profileLabel || result.profileName || t('launcher.badges.bookmark');
        const folder = result.bookmarkFolder || t('launcher.badges.bookmark');
        const sectionKey = `${result.sourceProfileId || profileLabel}:${folder}`;
        let sectionIndex = sectionByFolder.get(sectionKey);
        if (sectionIndex === undefined) {
          sectionIndex = sections.length;
          sectionByFolder.set(sectionKey, sectionIndex);
          sections.push({
            key: `bookmark-folder-${sectionKey}`,
            kind: 'bookmark',
            title: `${profileLabel} - ${folder}`,
            items: [],
          });
        }
        sections[sectionIndex].items.push(result);
      }
      return sections;
    }
    if (browserResultsViewScope === 'history') {
      const sections: Array<{
        key: string;
        kind: 'history';
        title: string;
        items: BrowserSearchResult[];
      }> = [];
      const sectionByDate = new Map<string, number>();
      for (const result of browserResultsViewResults) {
        const sectionTitle = formatBrowserHistoryDateSection(result.lastUsedAt) || t('launcher.badges.history');
        let sectionIndex = sectionByDate.get(sectionTitle);
        if (sectionIndex === undefined) {
          sectionIndex = sections.length;
          sectionByDate.set(sectionTitle, sectionIndex);
          sections.push({
            key: `history-date-${sectionTitle}`,
            kind: 'history',
            title: sectionTitle,
            items: [],
          });
        }
        sections[sectionIndex].items.push(result);
      }
      return sections;
    }
    return [{
      key: 'browser-section-ranked',
      kind: 'history' as const,
      title: t('launcher.browserSearch.showAll'),
      items: browserResultsViewResults,
    }];
  }, [browserResultsViewResults, browserResultsViewScope, t]);

  const selectedBrowserResult = browserResultsViewResults[browserResultsViewSelectedIndex] || null;
  const showHistoryProfilePicker = (browserResultsViewScope === 'open-tabs' || browserResultsViewScope === 'bookmarks' || browserResultsViewScope === 'history') && browserHistoryProfileOptions.length > 1;
  const selectedHistoryProfileCount = effectiveBrowserHistoryProfileIds?.length ?? browserHistoryProfileOptions.length;
  const historyProfileFilterLabel = `${selectedHistoryProfileCount}/${browserHistoryProfileOptions.length}`;
  const browserAlternateProfile = browserSearch.profiles && browserSearch.profiles.length > 1
    ? browserSearch.profiles[1]
    : null;
  const browserResultsPlaceholder = browserResultsViewScope === 'open-tabs'
    ? t('launcher.browserSearch.openTabsPlaceholder')
    : browserResultsViewScope === 'bookmarks'
      ? t('launcher.browserSearch.bookmarksPlaceholder')
      : browserResultsViewScope === 'history'
        ? t('launcher.browserSearch.historyPlaceholder')
    : t('launcher.browserSearch.showAllPlaceholder');
  const bookmarkNicknameSuggestion = bookmarkNicknamePrompt
    ? getSuggestedBookmarkNickname(bookmarkNicknamePrompt.result)
    : '';

  useEffect(() => {
    setBrowserResultsViewSelectedIndex(0);
  }, [browserResultsViewQuery, browserResultsViewScope, effectiveBrowserHistoryProfileIds?.join('|')]);

  useEffect(() => {
    setBrowserResultsViewLimit(BROWSER_RESULTS_PAGE_SIZE);
  }, [browserResultsViewQuery, browserResultsViewScope, effectiveBrowserHistoryProfileIds?.join('|')]);

  const loadMoreBrowserResults = useCallback(() => {
    if (browserResultsViewScope === 'all') return;
    setBrowserResultsViewLimit((limit) => limit + BROWSER_RESULTS_PAGE_SIZE);
  }, [browserResultsViewScope]);

  useEffect(() => {
    if (browserResultsViewQuery === null) return;
    window.setTimeout(() => browserResultsViewInputRef.current?.focus(), 0);
  }, [browserResultsViewQuery]);

  const openBrowserResult = useCallback(async (result: BrowserSearchResult, options?: any) => {
    setBrowserResultsViewQuery(null);
    try { window.electron.hideWindow(); } catch {}
    const ok = await browserSearch.executeBrowserSearch(result.actionInput, {
      ...options,
      kind: result.kind,
      url: result.url,
      sourceProfileId: result.sourceProfileId,
      windowId: result.windowId,
      tabId: result.tabId,
    });
    if (!ok) setBrowserResultsViewQuery('');
  }, [browserSearch]);

  const activateBrowserResult = useCallback(async (result: BrowserSearchResult, event?: { altKey?: boolean; metaKey?: boolean; numberKey?: string | number | null }) => {
    const focusExistingTab = result.kind === 'open-tab' && event?.metaKey === true && event?.altKey !== true;
    await openBrowserResult(result, { focusExistingTab, event });
  }, [browserResultsViewScope, openBrowserResult]);

  const setBrowserProfileFilterIds = useCallback(async (kind: BrowserProfileFilterKind, ids: string[]) => {
    setBrowserProfileFilterOverrides((prev) => ({ ...prev, [kind]: ids }));
    try {
      const currentSettings = await window.electron.getSettings();
      await window.electron.saveSettings({
        browserSearch: {
          ...currentSettings.browserSearch,
          profileFilters: {
            ...(currentSettings.browserSearch.profileFilters || {}),
            [kind]: ids,
          },
        },
      });
    } catch (error) {
      console.error('Failed to save browser profile filter:', error);
    }
  }, []);

  const openBookmarkNicknamePrompt = useCallback((result: BrowserSearchResult | null) => {
    if (!canEditBrowserResultNickname(result)) return;
    setBookmarkNicknamePrompt({
      result,
      value: result.nickname || '',
    });
  }, []);

  const closeBookmarkNicknamePrompt = useCallback(() => {
    setBookmarkNicknamePrompt(null);
    window.setTimeout(() => browserResultsViewInputRef.current?.focus(), 0);
  }, []);

  const saveBookmarkNickname = useCallback(async (result: BrowserSearchResult, rawValue: string) => {
    if (!canEditBrowserResultNickname(result)) return;
    const nickname = normalizeBookmarkNickname(rawValue);
    const targetKey = getBrowserResultNicknameKey(result);
    try {
      const currentSettings = await window.electron.getSettings();
      const browserSearchSettings = currentSettings.browserSearch;
      const currentNicknames = Array.isArray(browserSearchSettings?.nicknames)
        ? browserSearchSettings.nicknames
        : [];
      const nextNicknames: BrowserSearchNicknameSetting[] = currentNicknames.filter((item) => {
        const itemKey = [
          item.source || '',
          item.sourceProfileId || '',
          normalizeBookmarkNicknameUrl(item.url),
        ].join(':');
        return itemKey !== targetKey;
      });
      if (nickname) {
        nextNicknames.push({
          source: result.source || '',
          sourceProfileId: result.sourceProfileId,
          url: result.url,
          nickname,
        });
      }
      await window.electron.saveSettings({
        browserSearch: {
          ...browserSearchSettings,
          nicknames: nextNicknames.sort((a, b) => a.nickname.localeCompare(b.nickname)),
        },
      });
      browserSearch.refreshBrowserEntries();
    } catch (error) {
      console.error('Failed to save bookmark nickname:', error);
    }
  }, [browserSearch]);

  const submitBookmarkNicknamePrompt = useCallback(async () => {
    if (!bookmarkNicknamePrompt) return;
    await saveBookmarkNickname(bookmarkNicknamePrompt.result, bookmarkNicknamePrompt.value);
    closeBookmarkNicknamePrompt();
  }, [bookmarkNicknamePrompt, closeBookmarkNicknamePrompt, saveBookmarkNickname]);

  const closeBrowserResults = useCallback(() => {
    setBrowserResultsViewQuery(null);
    setBrowserHistoryProfileMenuOpen(false);
    window.setTimeout(() => launcherInputRef.current?.focus(), 50);
  }, [launcherInputRef]);

  useEffect(() => {
    if (!bookmarkNicknamePrompt) return;
    const timer = window.setTimeout(() => {
      void saveBookmarkNickname(bookmarkNicknamePrompt.result, bookmarkNicknamePrompt.value);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [bookmarkNicknamePrompt?.result.id, bookmarkNicknamePrompt?.value, saveBookmarkNickname]);

  useEffect(() => {
    if (!bookmarkNicknamePrompt) return;
    const timer = window.setTimeout(() => {
      bookmarkNicknameInputRef.current?.focus();
      bookmarkNicknameInputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [bookmarkNicknamePrompt?.result.id]);

  useEffect(() => {
    if (!bookmarkNicknamePrompt) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const suggestion = getSuggestedBookmarkNickname(bookmarkNicknamePrompt.result);
      if (event.key === 'Escape') {
        event.preventDefault();
        closeBookmarkNicknamePrompt();
        return;
      }
      if (event.key === 'Tab' && suggestion) {
        event.preventDefault();
        setBookmarkNicknamePrompt((prev) => prev ? { ...prev, value: suggestion } : prev);
        void saveBookmarkNickname(bookmarkNicknamePrompt.result, suggestion);
        return;
      }
      if (
        (event.key === 'Enter' || event.code === 'Enter' || event.code === 'NumpadEnter') &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.shiftKey
      ) {
        event.preventDefault();
        void submitBookmarkNicknamePrompt();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [bookmarkNicknamePrompt, closeBookmarkNicknamePrompt, submitBookmarkNicknamePrompt]);

  useEffect(() => {
    if (browserResultsViewQuery === null || browserResultsViewScope !== 'open-tabs') return;
    browserSearch.refreshOpenTabs();
    const id = window.setInterval(() => {
      browserSearch.refreshOpenTabs();
    }, 2500);
    return () => window.clearInterval(id);
  }, [browserResultsViewQuery, browserResultsViewScope, browserSearch]);

  return {
    browserResultsViewQuery,
    setBrowserResultsViewQuery,
    browserResultsViewScope,
    setBrowserResultsViewScope,
    browserResultsViewSelectedIndex,
    setBrowserResultsViewSelectedIndex,

    browserResultsViewInputRef,
    bookmarkNicknameInputRef,

    browserResultsViewResults,
    browserResultsViewSections,
    selectedBrowserResult,

    browserHistoryProfileOptions,
    effectiveBrowserHistoryProfileIds,
    showHistoryProfilePicker,
    historyProfileFilterLabel,
    browserAlternateProfileLabel: browserAlternateProfile
      ? (browserAlternateProfile.displayName || browserAlternateProfile.detectedName || browserAlternateProfile.profileId)
      : '',
    browserAlternateProfileBrowserId: browserAlternateProfile?.browserId,
    browserHistoryProfileMenuOpen,
    setBrowserHistoryProfileMenuOpen,
    setBrowserHistorySelectedProfileIds: (updater: React.SetStateAction<string[] | null>) => {
      const filterKind = scopeToFilterKind(browserResultsViewScope);
      if (!filterKind) return;
      const current = effectiveBrowserHistoryProfileIds ?? browserHistoryProfileOptions.map((item) => item.id);
      const next = typeof updater === 'function' ? updater(current) : updater;
      void setBrowserProfileFilterIds(filterKind, next ?? browserHistoryProfileOptions.map((item) => item.id));
    },

    browserResultsPlaceholder,

    bookmarkNicknamePrompt,
    setBookmarkNicknamePrompt,
    bookmarkNicknameSuggestion,
    openBookmarkNicknamePrompt,
    closeBookmarkNicknamePrompt,

    activateBrowserResult,
    loadMoreBrowserResults,
    closeBrowserResults,

    isBrowserResultsViewOpen: browserResultsViewQuery !== null,
  };
}
