import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BrowserSearchResult, BrowserHistoryProfileOption } from './useBrowserSearch';
import type {
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
    getOpenTabResults: (input: string) => BrowserSearchResult[];
    getBookmarkResults: (input: string) => BrowserSearchResult[];
    getHistoryResults: (
      input: string,
      profileIds?: string[] | null,
      showProfileContext?: boolean
    ) => BrowserSearchResult[];
    getHistoryProfiles: () => BrowserHistoryProfileOption[];
    executeBrowserSearch: (
      input: string,
      options?: { focusExistingTab?: boolean }
    ) => Promise<boolean>;
    refreshBrowserEntries: () => void;
  };
  resultGroups: BrowserSearchResultGroupSetting[];
  launcherInputRef: React.RefObject<HTMLInputElement>;
  t: (key: string, params?: Record<string, string | number>) => string;
};

export function useBrowserResultsController({
  browserSearch,
  resultGroups,
  launcherInputRef,
  t,
}: UseBrowserResultsControllerOptions) {
  const [browserResultsViewQuery, setBrowserResultsViewQuery] = useState<string | null>(null);
  const [browserResultsViewScope, setBrowserResultsViewScope] = useState<BrowserResultsViewScope>('all');
  const [browserResultsViewSelectedIndex, setBrowserResultsViewSelectedIndex] = useState(0);
  const [browserHistorySelectedProfileIds, setBrowserHistorySelectedProfileIds] = useState<string[] | null>(null);
  const [browserHistoryProfileMenuOpen, setBrowserHistoryProfileMenuOpen] = useState(false);
  const [bookmarkNicknamePrompt, setBookmarkNicknamePrompt] = useState<{
    result: BrowserSearchResult;
    value: string;
  } | null>(null);

  const browserResultsViewInputRef = useRef<HTMLInputElement>(null);
  const bookmarkNicknameInputRef = useRef<HTMLInputElement>(null);

  const browserHistoryProfileOptions = useMemo(() => {
    return browserSearch.getHistoryProfiles();
  }, [browserSearch]);

  const effectiveBrowserHistoryProfileIds = useMemo(() => {
    if (browserHistorySelectedProfileIds !== null) return browserHistorySelectedProfileIds;
    return browserHistoryProfileOptions.length > 0
      ? browserHistoryProfileOptions.map((profile) => profile.id)
      : null;
  }, [browserHistoryProfileOptions, browserHistorySelectedProfileIds]);

  const browserResultsViewResults = useMemo(() => {
    if (browserResultsViewQuery === null) return [];
    if (browserResultsViewScope === 'open-tabs') {
      return browserSearch.getOpenTabResults(browserResultsViewQuery);
    }
    if (browserResultsViewScope === 'bookmarks') {
      return browserSearch.getBookmarkResults(browserResultsViewQuery);
    }
    if (browserResultsViewScope === 'history') {
      return browserSearch.getHistoryResults(
        browserResultsViewQuery,
        effectiveBrowserHistoryProfileIds,
        browserHistoryProfileOptions.length > 1
      );
    }
    return browserSearch.getAllResults(browserResultsViewQuery, resultGroups);
  }, [browserHistoryProfileOptions.length, browserSearch, resultGroups, browserResultsViewQuery, browserResultsViewScope, effectiveBrowserHistoryProfileIds]);

  const browserResultsViewSections = useMemo(() => {
    if (browserResultsViewScope === 'open-tabs') {
      const sections: Array<{
        key: string;
        kind: 'open-tab';
        title: string;
        items: BrowserSearchResult[];
      }> = [];
      const sectionByWindow = new Map<string, number>();
      for (const result of browserResultsViewResults) {
        const windowKey = [
          result.browserName || 'Browser',
          result.profileName || '',
          result.windowId || 'window',
        ].join(':');
        let sectionIndex = sectionByWindow.get(windowKey);
        if (sectionIndex === undefined) {
          sectionIndex = sections.length;
          sectionByWindow.set(windowKey, sectionIndex);
          const profileLabel = result.profileName ? ` - ${result.profileName}` : '';
          sections.push({
            key: `open-tab-window-${windowKey}`,
            kind: 'open-tab',
            title: `${result.browserName || t('launcher.badges.openTab')}${profileLabel} - Window ${sectionIndex + 1}`,
            items: [],
          });
        }
        sections[sectionIndex].items.push(result);
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
        const folder = result.bookmarkFolder || t('launcher.badges.bookmark');
        let sectionIndex = sectionByFolder.get(folder);
        if (sectionIndex === undefined) {
          sectionIndex = sections.length;
          sectionByFolder.set(folder, sectionIndex);
          sections.push({
            key: `bookmark-folder-${folder}`,
            kind: 'bookmark',
            title: folder,
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
  const showHistoryProfilePicker = browserResultsViewScope === 'history' && browserHistoryProfileOptions.length > 1;
  const selectedHistoryProfileCount = effectiveBrowserHistoryProfileIds?.length ?? browserHistoryProfileOptions.length;
  const historyProfileFilterLabel = `${selectedHistoryProfileCount}/${browserHistoryProfileOptions.length}`;
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
  }, [browserResultsViewQuery, browserResultsViewResults.length]);

  useEffect(() => {
    if (browserResultsViewQuery === null) return;
    window.setTimeout(() => browserResultsViewInputRef.current?.focus(), 0);
  }, [browserResultsViewQuery]);

  const openBrowserResult = useCallback(async (result: BrowserSearchResult, options?: { focusExistingTab?: boolean }) => {
    const ok = await browserSearch.executeBrowserSearch(result.actionInput, options);
    if (ok) {
      setBrowserResultsViewQuery(null);
      try { window.electron.hideWindow(); } catch {}
    }
  }, [browserSearch]);

  const activateBrowserResult = useCallback(async (result: BrowserSearchResult, alternate = false) => {
    const focusExistingTab = result.focusAvailable && (
      browserResultsViewScope === 'open-tabs' ? !alternate : alternate
    );
    await openBrowserResult(result, focusExistingTab ? { focusExistingTab: true } : undefined);
  }, [browserResultsViewScope, openBrowserResult]);

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
    browserHistoryProfileMenuOpen,
    setBrowserHistoryProfileMenuOpen,
    setBrowserHistorySelectedProfileIds,

    browserResultsPlaceholder,

    bookmarkNicknamePrompt,
    setBookmarkNicknamePrompt,
    bookmarkNicknameSuggestion,
    openBookmarkNicknamePrompt,
    closeBookmarkNicknamePrompt,

    activateBrowserResult,
    closeBrowserResults,

    isBrowserResultsViewOpen: browserResultsViewQuery !== null,
  };
}
