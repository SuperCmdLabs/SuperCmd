import React from 'react';
import { ArrowLeft } from 'lucide-react';
import type { BrowserSearchResult, BrowserHistoryProfileOption } from '../hooks/useBrowserSearch';
import type { BrowserResultsViewScope } from '../utils/browser-search-commands';
import {
  canEditBrowserResultNickname,
  normalizeBookmarkNickname,
} from '../utils/browser-search-commands';
import { getQuickLinkPromptPanelStyle } from '../components/launcher-overlay-style';
import LauncherViewShell from '../components/LauncherViewShell';
import { renderCommandIcon } from '../utils/command-helpers';

export type BrowserResultsViewSection = {
  key: string;
  title: string;
  items: BrowserSearchResult[];
};

export type BookmarkNicknamePromptState = {
  result: BrowserSearchResult;
  value: string;
};

type BrowserResultsViewProps = {
  alwaysMountedRunners: React.ReactNode;

  backgroundImageUrl: string;
  showBackground: boolean;
  backgroundBlurPercent: number;
  backgroundOpacityPercent: number;

  query: string;
  setQuery: React.Dispatch<React.SetStateAction<string | null>>;
  inputRef: React.RefObject<HTMLInputElement>;
  placeholder: string;
  onClose: () => void;

  scope: BrowserResultsViewScope;
  results: BrowserSearchResult[];
  sections: BrowserResultsViewSection[];
  selectedIndex: number;
  setSelectedIndex: React.Dispatch<React.SetStateAction<number>>;
  selectedResult: BrowserSearchResult | null;
  activateResult: (result: BrowserSearchResult, alternate?: boolean) => void | Promise<void>;

  showHistoryProfilePicker: boolean;
  historyProfileOptions: BrowserHistoryProfileOption[];
  effectiveHistoryProfileIds: string[] | null;
  historyProfileFilterLabel: string;
  historyProfileMenuOpen: boolean;
  setHistoryProfileMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setHistorySelectedProfileIds: React.Dispatch<React.SetStateAction<string[] | null>>;

  bookmarkNicknamePrompt: BookmarkNicknamePromptState | null;
  bookmarkNicknameSuggestion: string;
  bookmarkNicknameInputRef: React.RefObject<HTMLInputElement>;
  setBookmarkNicknamePrompt: React.Dispatch<React.SetStateAction<BookmarkNicknamePromptState | null>>;
  openBookmarkNicknamePrompt: (result: BrowserSearchResult | null) => void;
  closeBookmarkNicknamePrompt: () => void;

  isNativeLiquidGlass: boolean;
  isGlassyTheme: boolean;

  t: (key: string, params?: Record<string, string | number>) => string;
};

const BrowserResultsView: React.FC<BrowserResultsViewProps> = ({
  alwaysMountedRunners,
  backgroundImageUrl,
  showBackground,
  backgroundBlurPercent,
  backgroundOpacityPercent,
  query,
  setQuery,
  inputRef,
  placeholder,
  onClose,
  scope,
  results,
  sections,
  selectedIndex,
  setSelectedIndex,
  selectedResult,
  activateResult,
  showHistoryProfilePicker,
  historyProfileOptions,
  effectiveHistoryProfileIds,
  historyProfileFilterLabel,
  historyProfileMenuOpen,
  setHistoryProfileMenuOpen,
  setHistorySelectedProfileIds,
  bookmarkNicknamePrompt,
  bookmarkNicknameSuggestion,
  bookmarkNicknameInputRef,
  setBookmarkNicknamePrompt,
  openBookmarkNicknamePrompt,
  closeBookmarkNicknamePrompt,
  isNativeLiquidGlass,
  isGlassyTheme,
  t,
}) => {
  return (
    <>
      <LauncherViewShell
        alwaysMountedRunners={alwaysMountedRunners}
        backgroundImageUrl={backgroundImageUrl}
        showBackground={showBackground}
        backgroundBlurPercent={backgroundBlurPercent}
        backgroundOpacityPercent={backgroundOpacityPercent}
      >
        <div className="h-full flex flex-col">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--ui-divider)]">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-white/[0.06]"
              aria-label={t('common.back')}
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (bookmarkNicknamePrompt) return;

                if (event.key === 'Escape' || (event.key === 'Backspace' && !query)) {
                  event.preventDefault();
                  onClose();
                  return;
                }

                if (
                  event.metaKey &&
                  !event.ctrlKey &&
                  !event.altKey &&
                  !event.shiftKey &&
                  (event.key === 'n' || event.key === 'N') &&
                  canEditBrowserResultNickname(selectedResult)
                ) {
                  event.preventDefault();
                  openBookmarkNicknamePrompt(selectedResult);
                  return;
                }

                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setSelectedIndex((index) => Math.min(index + 1, results.length - 1));
                  return;
                }

                if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setSelectedIndex((index) => Math.max(index - 1, 0));
                  return;
                }

                if (event.key === 'Enter' && selectedResult) {
                  event.preventDefault();
                  void activateResult(selectedResult, event.metaKey);
                }
              }}
              placeholder={placeholder}
              className="flex-1 bg-transparent outline-none text-[0.95rem] text-[var(--text-primary)] placeholder:text-[var(--text-subtle)]"
            />
            {showHistoryProfilePicker ? (
              <div className="relative flex-shrink-0">
                <button
                  type="button"
                  onClick={() => setHistoryProfileMenuOpen((open) => !open)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--ui-divider)] bg-white/[0.04] px-2.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-white/[0.07]"
                >
                  <span>Profiles</span>
                  <span className="text-[var(--text-muted)]">{historyProfileFilterLabel}</span>
                </button>
                {historyProfileMenuOpen ? (
                  <div className="absolute right-0 top-9 z-30 w-64 overflow-hidden rounded-lg border border-[var(--ui-divider)] bg-[var(--ui-panel-bg)] shadow-xl">
                    <div className="max-h-64 overflow-y-auto p-1">
                      {historyProfileOptions.map((profile) => {
                        const checked = Boolean(effectiveHistoryProfileIds?.includes(profile.id));
                        return (
                          <button
                            key={profile.id}
                            type="button"
                            onClick={() => {
                              setHistorySelectedProfileIds((current) => {
                                const currentIds = current ?? historyProfileOptions.map((item) => item.id);
                                return currentIds.includes(profile.id)
                                  ? currentIds.filter((id) => id !== profile.id)
                                  : [...currentIds, profile.id];
                              });
                            }}
                            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-white/[0.06]"
                          >
                            <span className={`flex h-3.5 w-3.5 items-center justify-center rounded border text-[0.625rem] ${checked ? 'border-cyan-300 bg-cyan-400/20 text-cyan-200' : 'border-[var(--ui-divider)] text-transparent'}`}>
                              x
                            </span>
                            <span className="min-w-0 flex-1 truncate">{profile.label}</span>
                            <span className="text-[0.6875rem] text-[var(--text-muted)]">{profile.count}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar p-1.5">
            {results.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-[var(--text-muted)]">
                {t('launcher.status.noMatchingResults')}
              </div>
            ) : (
              <div className="space-y-0.5">
                {sections.reduce(
                  (acc, section) => {
                    acc.nodes.push(
                      <div
                        key={section.key}
                        className="px-3 pt-2 pb-1 text-[0.6875rem] uppercase tracking-wider text-[var(--text-subtle)] font-medium"
                      >
                        {section.title}
                      </div>
                    );
                    section.items.forEach((result) => {
                      const flatIndex = acc.index++;
                      const selected = flatIndex === selectedIndex;
                      acc.nodes.push(
                        <div
                          key={result.id}
                          className={`command-item px-3 py-2 rounded-lg cursor-pointer ${selected ? 'selected' : ''}`}
                          onMouseEnter={() => setSelectedIndex(flatIndex)}
                          onClick={(event) => void activateResult(result, event.metaKey)}
                        >
                          <div className="flex items-center gap-2.5">
                            <div className="w-5 h-5 flex items-center justify-center flex-shrink-0 overflow-hidden">
                              {renderCommandIcon({
                                id: result.id,
                                title: result.title,
                                subtitle: result.subtitle,
                                category: 'system',
                                browserResultKind: result.kind,
                                browserFaviconUrl: result.faviconUrl,
                              })}
                            </div>
                            <div className="min-w-0 flex-1 flex items-center gap-2">
                              <div className="text-[var(--text-primary)] text-[0.8125rem] font-medium truncate tracking-[0.004em]">
                                {result.title}
                              </div>
                              <div className="text-[var(--text-muted)] text-[0.6875rem] font-medium truncate">
                                {result.subtitle}
                              </div>
                              {result.nickname ? (
                                <div className="inline-flex h-5 flex-shrink-0 items-center rounded-md border border-[var(--launcher-chip-border)] bg-[var(--launcher-chip-bg)] px-1.5 font-mono text-[0.625rem] leading-none text-[var(--text-subtle)]">
                                  {result.nickname}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      );
                    });
                    return acc;
                  },
                  { nodes: [] as React.ReactNode[], index: 0 }
                ).nodes}
              </div>
            )}
          </div>
          <div className="sc-glass-footer sc-launcher-footer flex items-center px-4 py-2.5 border-t border-[var(--ui-divider)]">
            <div className="sc-footer-primary flex items-center gap-2 text-xs flex-1 min-w-0 font-normal truncate text-[var(--text-subtle)]">
              {selectedResult ? (
                <>
                  <span className="w-5 h-5 flex items-center justify-center flex-shrink-0 overflow-hidden">
                    {renderCommandIcon({
                      id: selectedResult.id,
                      title: selectedResult.title,
                      subtitle: selectedResult.subtitle,
                      category: 'system',
                      browserResultKind: selectedResult.kind,
                      browserFaviconUrl: selectedResult.faviconUrl,
                    })}
                  </span>
                  <span className="truncate">{selectedResult.title}</span>
                </>
              ) : (
                t('launcher.status.results', { count: results.length })
              )}
            </div>
            {selectedResult ? (
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-[var(--text-primary)]">
                  {scope === 'open-tabs'
                    ? t('launcher.actions.focusExistingTab')
                    : t('launcher.actions.open')}
                </span>
                <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--kbd-bg)] text-[0.6875rem] text-[var(--text-subtle)] font-medium">↩</kbd>
                {selectedResult.focusAvailable ? (
                  <>
                    <span className="ml-2 text-xs font-normal text-[var(--text-muted)]">
                      {scope === 'open-tabs'
                        ? t('launcher.actions.open')
                        : t('launcher.browserSearch.focusHint')}
                    </span>
                    <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--kbd-bg)] text-[0.6875rem] text-[var(--text-subtle)] font-medium">⌘</kbd>
                    <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--kbd-bg)] text-[0.6875rem] text-[var(--text-subtle)] font-medium">↩</kbd>
                  </>
                ) : null}
                {canEditBrowserResultNickname(selectedResult) ? (
                  <>
                    <span className="ml-2 text-xs font-normal text-[var(--text-muted)]">
                      {selectedResult.nickname
                        ? t('launcher.browserSearch.editNickname')
                        : t('launcher.browserSearch.setNickname')}
                    </span>
                    <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--kbd-bg)] text-[0.6875rem] text-[var(--text-subtle)] font-medium">⌘</kbd>
                    <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--kbd-bg)] text-[0.6875rem] text-[var(--text-subtle)] font-medium">N</kbd>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </LauncherViewShell>
      {bookmarkNicknamePrompt ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-5"
          style={{ background: 'var(--bg-scrim)' }}
          onMouseDown={closeBookmarkNicknamePrompt}
        >
          <div
            className="w-[420px] max-w-[92vw] rounded-xl overflow-hidden p-3.5"
            onMouseDown={(event) => event.stopPropagation()}
            style={getQuickLinkPromptPanelStyle(isNativeLiquidGlass, isGlassyTheme)}
          >
            <div className="relative space-y-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="h-8 w-8 flex items-center justify-center flex-shrink-0 overflow-hidden rounded-md border border-[var(--ui-divider)] bg-[var(--ui-segment-bg)]">
                  <span className="h-5 w-5 flex items-center justify-center overflow-hidden">
                    {renderCommandIcon({
                      id: bookmarkNicknamePrompt.result.id,
                      title: bookmarkNicknamePrompt.result.title,
                      subtitle: bookmarkNicknamePrompt.result.subtitle,
                      category: 'system',
                      browserResultKind: 'bookmark',
                      browserFaviconUrl: bookmarkNicknamePrompt.result.faviconUrl,
                    })}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold text-[var(--text-primary)]">
                    {bookmarkNicknamePrompt.result.title}
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-[var(--text-muted)]">
                    {bookmarkNicknamePrompt.result.subtitle}
                  </div>
                </div>
              </div>
              <div className="relative">
                <input
                  ref={bookmarkNicknameInputRef}
                  type="text"
                  value={bookmarkNicknamePrompt.value}
                  onChange={(event) =>
                    setBookmarkNicknamePrompt((prev) =>
                      prev ? { ...prev, value: normalizeBookmarkNickname(event.target.value) } : prev
                    )
                  }
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className="w-full bg-[var(--ui-segment-bg)] border border-[var(--snippet-divider)] rounded-lg px-3 py-2 text-[13px] text-[var(--text-secondary)] outline-none focus:border-[var(--snippet-divider-strong)]"
                />
                {bookmarkNicknameSuggestion && !bookmarkNicknamePrompt.value ? (
                  <div className="pointer-events-none absolute inset-y-0 left-3 flex max-w-[calc(100%-24px)] items-center gap-1.5 overflow-hidden text-[13px] text-[var(--text-subtle)]">
                    <span className="truncate font-mono">{bookmarkNicknameSuggestion}</span>
                    <kbd className="inline-flex h-[18px] min-w-[26px] flex-shrink-0 items-center justify-center rounded border border-[var(--ui-divider)] bg-[var(--kbd-bg)] px-1.5 text-[10px] font-medium text-[var(--text-muted)]">
                      Tab
                    </kbd>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
};

export default BrowserResultsView;
