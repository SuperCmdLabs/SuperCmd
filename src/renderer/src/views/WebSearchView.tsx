import React from 'react';
import { ArrowLeft, Plus } from 'lucide-react';
import LauncherViewShell from '../components/LauncherViewShell';
import { getQuickLinkPromptPanelStyle } from '../components/launcher-overlay-style';
import { renderCommandIcon } from '../utils/command-helpers';
import {
  getFaviconUrlForHost,
  parseSearchBangFromList,
  type SearchBangDefinition,
  type WebSearchResult,
} from '../utils/web-search-bangs';

export type WebSearchViewSection = {
  key: WebSearchResult['section'];
  titleKey: string;
  items: WebSearchResult[];
  startIndex: number;
};

export type WebSearchBangPromptState = {
  result: WebSearchResult;
  value: string;
};

export type WebSearchCustomBangPromptState = {
  key: string;
  aliases: string;
  name: string;
  host: string;
  template: string;
};

type WebSearchViewProps = {
  alwaysMountedRunners: React.ReactNode;

  backgroundImageUrl: string;
  showBackground: boolean;
  backgroundBlurPercent: number;
  backgroundOpacityPercent: number;

  query: string;
  setQuery: React.Dispatch<React.SetStateAction<string | null>>;
  inputRef: React.RefObject<HTMLInputElement>;
  onClose: () => void;

  results: WebSearchResult[];
  visibleSections: WebSearchViewSection[];
  selectedIndex: number;
  setSelectedIndex: React.Dispatch<React.SetStateAction<number>>;
  selectedResult: WebSearchResult | null;
  activateResult: (result: WebSearchResult | null) => void | Promise<void>;
  submitSearch: (query: string) => void | Promise<void>;
  loadMoreResults: () => void;

  effectiveSearchBangs: SearchBangDefinition[];
  activeBang: SearchBangDefinition | null;
  isBangManager: boolean;
  showHiddenBangs: boolean;
  toggleShowHidden: () => void | Promise<void>;

  bangPrompt: WebSearchBangPromptState | null;
  bangInputRef: React.RefObject<HTMLInputElement>;
  setBangPrompt: React.Dispatch<React.SetStateAction<WebSearchBangPromptState | null>>;
  openBangPrompt: (result: WebSearchResult | null) => void;
  saveBangAliases: () => void | Promise<void>;

  customBangPrompt: WebSearchCustomBangPromptState | null;
  setCustomBangPrompt: React.Dispatch<React.SetStateAction<WebSearchCustomBangPromptState | null>>;
  openCustomBangPrompt: () => void;
  closeCustomBangPrompt: () => void;
  saveCustomBang: () => void | Promise<void>;

  toggleBangDisabled: (result: WebSearchResult | null) => void | Promise<void>;

  isNativeLiquidGlass: boolean;
  isGlassyTheme: boolean;

  t: (key: string, params?: Record<string, string | number>) => string;
};

const WebSearchView: React.FC<WebSearchViewProps> = ({
  alwaysMountedRunners,
  backgroundImageUrl,
  showBackground,
  backgroundBlurPercent,
  backgroundOpacityPercent,
  query,
  setQuery,
  inputRef,
  onClose,
  results,
  visibleSections,
  selectedIndex,
  setSelectedIndex,
  selectedResult,
  activateResult,
  submitSearch,
  loadMoreResults,
  effectiveSearchBangs,
  activeBang,
  isBangManager,
  showHiddenBangs,
  toggleShowHidden,
  bangPrompt,
  bangInputRef,
  setBangPrompt,
  openBangPrompt,
  saveBangAliases,
  customBangPrompt,
  setCustomBangPrompt,
  openCustomBangPrompt,
  closeCustomBangPrompt,
  saveCustomBang,
  toggleBangDisabled,
  isNativeLiquidGlass,
  isGlassyTheme,
  t,
}) => {
  const customBangFields: Array<[keyof WebSearchCustomBangPromptState, string]> = [
    ['key', t('launcher.browserSearch.customBangFields.key')],
    ['aliases', t('launcher.browserSearch.customBangFields.aliases')],
    ['name', t('launcher.browserSearch.customBangFields.name')],
    ['host', t('launcher.browserSearch.customBangFields.host')],
    ['template', t('launcher.browserSearch.customBangFields.template')],
  ];

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
                if (bangPrompt || customBangPrompt) return;
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
                  (event.key === 'n' || event.key === 'N')
                ) {
                  if (!isBangManager) return;
                  event.preventDefault();
                  if (selectedResult?.kind === 'bang') {
                    openBangPrompt(selectedResult);
                  } else {
                    openCustomBangPrompt();
                  }
                  return;
                }
                if (
                  event.metaKey &&
                  !event.ctrlKey &&
                  !event.altKey &&
                  !event.shiftKey &&
                  (event.key === 'd' || event.key === 'D') &&
                  selectedResult?.kind === 'bang'
                ) {
                  if (!isBangManager) return;
                  event.preventDefault();
                  void toggleBangDisabled(selectedResult);
                  return;
                }
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setSelectedIndex((index) => Math.min(index + 1, Math.max(0, results.length - 1)));
                  return;
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setSelectedIndex((index) => Math.max(index - 1, 0));
                  return;
                }
                if (event.key === 'Enter') {
                  event.preventDefault();
                  if (selectedResult) {
                    void activateResult(selectedResult);
                  } else if (query.trim()) {
                    void submitSearch(query);
                  }
                }
              }}
              placeholder={t('launcher.browserSearch.webSearchPlaceholder')}
              className="flex-1 bg-transparent outline-none text-[0.95rem] text-[var(--text-primary)] placeholder:text-[var(--text-subtle)]"
            />
            {activeBang ? (
              <div className="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--launcher-chip-border)] bg-[var(--launcher-chip-bg)] px-2 text-xs text-[var(--text-secondary)]">
                <span className="w-4 h-4 flex items-center justify-center overflow-hidden">
                  {renderCommandIcon({
                    id: `web-search-bang-active:${activeBang.key}`,
                    title: activeBang.name,
                    subtitle: activeBang.host,
                    category: 'system',
                    browserResultKind: 'search',
                    browserFaviconUrl: getFaviconUrlForHost(activeBang.host),
                  })}
                </span>
                <span>!{activeBang.key}</span>
              </div>
            ) : null}
            {isBangManager ? (
              <>
                <button
                  type="button"
                  onClick={toggleShowHidden}
                  className={`inline-flex h-7 items-center rounded-md border px-2 text-xs ${
                    showHiddenBangs
                      ? 'border-[var(--launcher-chip-border)] bg-[var(--launcher-chip-bg)] text-[var(--text-secondary)]'
                      : 'border-transparent text-[var(--text-muted)] hover:bg-white/[0.06]'
                  }`}
                >
                  {showHiddenBangs ? t('launcher.browserSearch.hideHidden') : t('launcher.browserSearch.showHidden')}
                </button>
                <button
                  type="button"
                  onClick={openCustomBangPrompt}
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-transparent px-2 text-xs text-[var(--text-muted)] hover:bg-white/[0.06]"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t('launcher.browserSearch.newBang')}
                </button>
              </>
            ) : null}
          </div>

          <div
            className="flex-1 overflow-y-auto custom-scrollbar p-1.5"
            onScroll={(event) => {
              const target = event.currentTarget;
              if (target.scrollTop + target.clientHeight < target.scrollHeight - 96) return;
              loadMoreResults();
            }}
          >
            {results.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-[var(--text-muted)]">
                {t('launcher.status.noMatchingResults')}
              </div>
            ) : (
              <div className="space-y-0.5">
                {visibleSections.map((section) => (
                  <div key={section.key}>
                    <div className="px-3 pt-2 pb-1 text-[0.6875rem] uppercase tracking-wider text-[var(--text-subtle)] font-medium">
                      {t(section.titleKey)}
                    </div>
                    <div className="space-y-0.5">
                      {section.items.map((result, sectionIndex) => {
                        const flatIndex = section.startIndex + sectionIndex;
                        const selected = flatIndex === selectedIndex;
                        return (
                          <div
                            key={result.id}
                            className={`command-item px-3 py-2 rounded-lg cursor-pointer ${selected ? 'selected' : ''}`}
                            onMouseEnter={() => setSelectedIndex(flatIndex)}
                            onClick={() => void activateResult(result)}
                          >
                            <div className="flex items-center gap-2.5">
                              <div className="w-5 h-5 flex items-center justify-center flex-shrink-0 overflow-hidden">
                                {renderCommandIcon({
                                  id: result.id,
                                  title: result.title,
                                  subtitle: result.subtitle,
                                  category: 'system',
                                  browserResultKind: 'search',
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
                                {result.isCustom ? (
                                  <div className="inline-flex h-5 flex-shrink-0 items-center rounded-md border border-[var(--launcher-chip-border)] bg-[var(--launcher-chip-bg)] px-1.5 text-[0.625rem] leading-none text-[var(--text-subtle)]">
                                    {t('common.custom')}
                                  </div>
                                ) : null}
                                {result.isDisabled ? (
                                  <div className="inline-flex h-5 flex-shrink-0 items-center rounded-md border border-[var(--launcher-chip-border)] bg-[var(--launcher-chip-bg)] px-1.5 text-[0.625rem] leading-none text-[var(--text-subtle)]">
                                    {t('common.disabled')}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
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
                      browserResultKind: 'search',
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
                  {selectedResult.kind === 'bang' && !parseSearchBangFromList(selectedResult.query, effectiveSearchBangs).query.trim()
                    ? t('launcher.browserSearch.useBang')
                    : t('launcher.actions.open')}
                </span>
                <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--kbd-bg)] text-[0.6875rem] text-[var(--text-subtle)] font-medium">↩</kbd>
                {selectedResult.kind === 'bang' ? (
                  <>
                    <span className="ml-2 text-xs font-normal text-[var(--text-muted)]">
                      {t('common.edit')}
                    </span>
                    <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--kbd-bg)] text-[0.6875rem] text-[var(--text-subtle)] font-medium">⌘</kbd>
                    <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--kbd-bg)] text-[0.6875rem] text-[var(--text-subtle)] font-medium">N</kbd>
                    <span className="ml-2 text-xs font-normal text-[var(--text-muted)]">
                      {selectedResult.isDisabled ? t('common.enable') : t('common.disable')}
                    </span>
                    <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--kbd-bg)] text-[0.6875rem] text-[var(--text-subtle)] font-medium">⌘</kbd>
                    <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--kbd-bg)] text-[0.6875rem] text-[var(--text-subtle)] font-medium">D</kbd>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </LauncherViewShell>
      {bangPrompt ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-5"
          style={{ background: 'var(--bg-scrim)' }}
          onMouseDown={() => void saveBangAliases()}
        >
          <div
            className="w-[420px] max-w-[92vw] rounded-xl overflow-hidden p-3.5"
            onMouseDown={(event) => event.stopPropagation()}
            style={getQuickLinkPromptPanelStyle(isNativeLiquidGlass, isGlassyTheme)}
          >
            <div className="space-y-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="h-8 w-8 flex items-center justify-center flex-shrink-0 overflow-hidden rounded-md border border-[var(--ui-divider)] bg-[var(--ui-segment-bg)]">
                  <span className="h-5 w-5 flex items-center justify-center overflow-hidden">
                    {renderCommandIcon({
                      id: bangPrompt.result.id,
                      title: bangPrompt.result.title,
                      subtitle: bangPrompt.result.subtitle,
                      category: 'system',
                      browserResultKind: 'search',
                      browserFaviconUrl: bangPrompt.result.faviconUrl,
                    })}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold text-[var(--text-primary)]">
                    {bangPrompt.result.title}
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-[var(--text-muted)]">
                    {bangPrompt.result.subtitle}
                  </div>
                </div>
              </div>
              <input
                ref={bangInputRef}
                type="text"
                value={bangPrompt.value}
                onChange={(event) =>
                  setBangPrompt((prev) =>
                    prev ? { ...prev, value: event.target.value.toLowerCase().replace(/[^a-z0-9.+_!,\-\s]/g, '') } : prev
                  )
                }
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="w-full bg-[var(--ui-segment-bg)] border border-[var(--snippet-divider)] rounded-lg px-3 py-2 text-[13px] text-[var(--text-secondary)] outline-none focus:border-[var(--snippet-divider-strong)]"
              />
              <p className="text-[11px] leading-snug text-[var(--text-muted)]">
                {t('launcher.browserSearch.aliasHelp')}
              </p>
            </div>
          </div>
        </div>
      ) : null}
      {customBangPrompt ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-5"
          style={{ background: 'var(--bg-scrim)' }}
          onMouseDown={closeCustomBangPrompt}
        >
          <div
            className="w-[460px] max-w-[92vw] rounded-xl overflow-hidden p-3.5"
            onMouseDown={(event) => event.stopPropagation()}
            style={getQuickLinkPromptPanelStyle(isNativeLiquidGlass, isGlassyTheme)}
          >
            <div className="space-y-3">
              <div>
                <div className="text-[13px] font-semibold text-[var(--text-primary)]">{t('launcher.browserSearch.newBang')}</div>
                <div className="mt-0.5 text-[11px] text-[var(--text-muted)]">{t('launcher.browserSearch.customBangHelp')}</div>
              </div>
              {customBangFields.map(([field, label]) => (
                <label key={field} className="block">
                  <div className="mb-1 text-[11px] text-[var(--text-muted)]">{label}</div>
                  <input
                    type="text"
                    value={customBangPrompt[field]}
                    onChange={(event) => setCustomBangPrompt((prev) => prev ? { ...prev, [field]: event.target.value } : prev)}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    className="w-full bg-[var(--ui-segment-bg)] border border-[var(--snippet-divider)] rounded-lg px-3 py-2 text-[13px] text-[var(--text-secondary)] outline-none focus:border-[var(--snippet-divider-strong)]"
                  />
                </label>
              ))}
              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" className="sc-button !py-1.5 !px-3 !text-[12px]" onClick={closeCustomBangPrompt}>
                  {t('common.cancel')}
                </button>
                <button type="button" className="sc-button !py-1.5 !px-3 !text-[12px]" onClick={() => void saveCustomBang()}>
                  {t('common.save')}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
};

export default WebSearchView;
