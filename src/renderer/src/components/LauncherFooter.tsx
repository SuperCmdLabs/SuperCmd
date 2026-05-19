import React, { useEffect, useState } from 'react';
import type { BrowserProfileSetting, CommandInfo } from '../../types/electron';
import {
  getCommandDisplayTitle,
  type LauncherAction,
  type MemoryFeedback,
  renderCommandIcon,
  renderShortcutLabel,
} from '../utils/command-helpers';

type LauncherFooterProps = {
  status: MemoryFeedback;
  selectedCommand: CommandInfo | null;
  selectedAction: LauncherAction | undefined;
  browserProfiles: BrowserProfileSetting[];
  resultCount: number;
  onOpenActions: () => void;
  t: (key: string, params?: Record<string, string | number>) => string;
};

const LauncherFooter: React.FC<LauncherFooterProps> = ({
  status,
  selectedCommand,
  selectedAction,
  browserProfiles,
  resultCount,
  onOpenActions,
  t,
}) => {
  const isBrowserProfileAction = Boolean(
    selectedCommand?.browserActionInput ||
    selectedCommand?.browserUrl ||
    selectedCommand?.browserMatchKind ||
    selectedCommand?.browserResultKind ||
    selectedCommand?.rootSearchSource === 'browser' ||
    selectedCommand?.rootSearchSource === 'open-url' ||
    selectedCommand?.rootSearchSource === 'direct-search'
  );
  const targetProfileLabel = selectedCommand?.browserTargetProfileLabel || '';
  const alternateProfileLabel = selectedCommand?.browserAlternateProfileLabel || '';
  const profileCount = Math.max(selectedCommand?.browserProfileCount || 0, browserProfiles.length);
  const showProfileHint = profileCount > 1 && Boolean(alternateProfileLabel);
  const showFocusHint = selectedCommand?.browserResultKind === 'open-tab' && selectedCommand.browserFocusAvailable === true;
  const [optionHeld, setOptionHeld] = useState(false);
  useEffect(() => {
    const isOptionEvent = (event: KeyboardEvent | MouseEvent | PointerEvent) =>
      Boolean(event.altKey || ('getModifierState' in event && event.getModifierState?.('Alt')));
    const onKeyDown = (event: KeyboardEvent) => {
      if (isOptionEvent(event) || event.key === 'Alt' || event.code === 'AltLeft' || event.code === 'AltRight') {
        setOptionHeld(true);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Alt' || event.code === 'AltLeft' || event.code === 'AltRight' || !isOptionEvent(event)) {
        setOptionHeld(false);
      }
    };
    const onPointerMove = (event: PointerEvent) => setOptionHeld(isOptionEvent(event));
    const onMouseMove = (event: MouseEvent) => setOptionHeld(isOptionEvent(event));
    const onBlur = () => setOptionHeld(false);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('pointermove', onPointerMove, true);
    window.addEventListener('mousemove', onMouseMove, true);
    window.addEventListener('blur', onBlur);
    const cleanupModifier = window.electron?.onModifierStateChanged?.((state) => {
      setOptionHeld(Boolean(state?.altKey));
    });
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('pointermove', onPointerMove, true);
      window.removeEventListener('mousemove', onMouseMove, true);
      window.removeEventListener('blur', onBlur);
      cleanupModifier?.();
    };
  }, []);
  return (
  <div
    className="sc-glass-footer sc-launcher-footer absolute bottom-0 left-0 right-0 z-10 flex items-center px-4 py-2.5"
  >
    <div
      className="sc-footer-primary flex min-w-0 flex-1 items-center gap-2 pr-4 text-xs font-normal text-[var(--text-subtle)]"
    >
      {status ? (
        <>
          {status.type === 'success' ? (
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/90 shadow-[0_0_0_3px_rgba(52,211,153,0.18)] flex-shrink-0" />
          ) : (
            <span className="w-1.5 h-1.5 rounded-full bg-rose-400/90 shadow-[0_0_0_3px_rgba(244,114,182,0.18)] flex-shrink-0" />
          )}
          <span className="min-w-0 truncate text-[var(--text-secondary)]">{status.text}</span>
        </>
      ) : selectedCommand ? (
        <>
          <span className="w-5 h-5 flex items-center justify-center flex-shrink-0 overflow-hidden">
            {renderCommandIcon(selectedCommand)}
          </span>
          <span className="min-w-0 truncate">{getCommandDisplayTitle(selectedCommand, t)}</span>
        </>
      ) : (
        t('launcher.status.results', { count: resultCount })
      )}
    </div>
    {selectedAction && isBrowserProfileAction && selectedCommand ? (
      <div className="ml-3 mr-3 flex max-w-[72%] shrink-0 items-center gap-2 overflow-hidden whitespace-nowrap">
        <button
          type="button"
          onClick={() => selectedAction.execute()}
          className="shrink-0 text-xs font-semibold text-[var(--text-primary)] transition-colors hover:text-[var(--text-primary)]"
        >
          {selectedAction.title}
        </button>
        {targetProfileLabel ? (
          <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-[var(--text-muted)]">
            <BrowserAppIcon iconDataUrl={selectedCommand.browserTargetProfileIconDataUrl} />
            <span className="max-w-[110px] truncate">{targetProfileLabel}</span>
          </span>
        ) : null}
        <kbd className="inline-flex h-[22px] min-w-[22px] shrink-0 items-center justify-center rounded bg-[var(--kbd-bg)] px-1.5 text-[0.6875rem] font-medium text-[var(--text-subtle)]">
          ↩
        </kbd>
        {showProfileHint ? (
          <>
            <span className="ml-2 shrink-0 text-xs text-[var(--text-muted)]">{t('launcher.browserSearch.profileAction')}</span>
            <kbd className="inline-flex h-[22px] min-w-[22px] shrink-0 items-center justify-center rounded bg-[var(--kbd-bg)] px-1.5 text-[0.6875rem] font-medium text-[var(--text-subtle)]">⌥</kbd>
            <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-[var(--text-muted)]">
              <BrowserAppIcon iconDataUrl={selectedCommand.browserAlternateProfileIconDataUrl} />
              <span className="max-w-[110px] truncate">{alternateProfileLabel}</span>
            </span>
            {optionHeld ? (
              <BrowserProfileMenu
                profiles={browserProfiles}
                iconForBrowserId={(browserId) =>
                  browserId === selectedCommand.browserTargetProfileBrowserId
                    ? selectedCommand.browserTargetProfileIconDataUrl
                    : browserId === selectedCommand.browserAlternateProfileBrowserId
                      ? selectedCommand.browserAlternateProfileIconDataUrl
                      : undefined
                }
              />
            ) : null}
          </>
        ) : null}
        {showFocusHint ? (
          <>
            <span className="ml-2 shrink-0 text-xs text-[var(--text-muted)]">{t('launcher.actions.focusExistingTab')}</span>
            <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--kbd-bg)] text-[0.6875rem] text-[var(--text-subtle)] font-medium">⌘</kbd>
            <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--kbd-bg)] text-[0.6875rem] text-[var(--text-subtle)] font-medium">↩</kbd>
          </>
        ) : null}
      </div>
    ) : selectedAction ? (
      <div className="flex items-center gap-2 mr-3">
        <button
          onClick={() => selectedAction.execute()}
          className="text-[var(--text-primary)] text-xs font-semibold hover:text-[var(--text-primary)] transition-colors"
        >
          {selectedAction.title}
        </button>
        {selectedAction.shortcut && (
          <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--kbd-bg)] text-[0.6875rem] text-[var(--text-subtle)] font-medium">
            {renderShortcutLabel(selectedAction.shortcut)}
          </kbd>
        )}
      </div>
    ) : null}
    {!isBrowserProfileAction ? (
      <button
        onClick={onOpenActions}
        className="flex items-center gap-1.5 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
      >
        <span className="text-xs font-normal">{t('common.actions')}</span>
        <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--kbd-bg)] text-[0.6875rem] text-[var(--text-subtle)] font-medium">⌘</kbd>
        <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--kbd-bg)] text-[0.6875rem] text-[var(--text-subtle)] font-medium">K</kbd>
      </button>
    ) : null}
  </div>
  );
};

const BrowserAppIcon: React.FC<{ iconDataUrl?: string }> = ({ iconDataUrl }) => {
  return (
    <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-white/10">
      {iconDataUrl ? (
        <img src={iconDataUrl} alt="" className="h-4 w-4 object-contain" draggable={false} />
      ) : null}
    </span>
  );
};

const BrowserProfileMenu: React.FC<{
  profiles: BrowserProfileSetting[];
  iconForBrowserId: (browserId: string) => string | undefined;
}> = ({ profiles, iconForBrowserId }) => {
  if (profiles.length === 0) return null;
  return (
    <div className="fixed bottom-[54px] left-1/2 z-50 min-w-[220px] -translate-x-1/2 overflow-hidden rounded-lg border border-[var(--ui-divider)] bg-[var(--settings-panel-bg)] p-1 shadow-xl">
      {profiles.map((profile, index) => (
        <div
          key={profile.id}
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-[var(--text-secondary)]"
        >
          <BrowserAppIcon iconDataUrl={iconForBrowserId(profile.browserId)} />
          <span className="min-w-0 flex-1 truncate">{profile.displayName || profile.detectedName || profile.profileId}</span>
          <kbd className="inline-flex h-[20px] min-w-[20px] items-center justify-center rounded bg-[var(--kbd-bg)] px-1.5 text-[0.65rem] text-[var(--text-subtle)]">
            {index === 0 ? '↩' : index === 1 ? '⌥' : `⌥${index - 1}`}
          </kbd>
        </div>
      ))}
    </div>
  );
};

export default LauncherFooter;
