import React from 'react';
import type { LauncherAction } from '../utils/command-helpers';
import { getShortcutDisplayParts } from '../utils/command-helpers';
import { getLauncherFloatingPanelStyle } from './launcher-overlay-style';

type LauncherActionsOverlayProps = {
  actions: LauncherAction[];
  selectedIndex: number;
  setSelectedIndex: React.Dispatch<React.SetStateAction<number>>;
  overlayRef: React.RefObject<HTMLDivElement>;
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  onClose: () => void;
  onActionClick: (action: LauncherAction) => void | Promise<void>;
  isNativeLiquidGlass: boolean;
  isGlassyTheme: boolean;
};

const LauncherActionsOverlay: React.FC<LauncherActionsOverlayProps> = ({
  actions,
  selectedIndex,
  setSelectedIndex,
  overlayRef,
  onKeyDown,
  onClose,
  onActionClick,
  isNativeLiquidGlass,
  isGlassyTheme,
}) => {
  if (actions.length === 0) return null;

  return (
    <div
      className="fixed inset-0 z-50"
      onClick={onClose}
      style={{ background: 'var(--bg-scrim)' }}
    >
      <div
        ref={overlayRef}
        className="absolute bottom-12 right-3 w-96 max-h-[65vh] rounded-xl overflow-hidden flex flex-col shadow-2xl outline-none focus:outline-none focus-visible:outline-none ring-0 focus:ring-0 focus-visible:ring-0"
        tabIndex={0}
        onKeyDown={onKeyDown}
        style={getLauncherFloatingPanelStyle(isNativeLiquidGlass, isGlassyTheme)}
        onFocus={(e) => {
          (e.currentTarget as HTMLDivElement).style.outline = 'none';
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex-1 overflow-y-auto py-1">
          {actions.map((action, idx) => (
            <React.Fragment key={action.id}>
              {action.separatorBefore && (
                <div className="mx-2.5 my-1 border-t border-[var(--ui-divider)]" />
              )}
              <div
                className={`mx-1 px-2.5 py-1.5 rounded-lg border border-transparent flex items-center gap-2.5 cursor-pointer transition-colors ${
                  idx === selectedIndex
                    ? action.style === 'destructive'
                      ? 'bg-[var(--action-menu-selected-bg)] text-[var(--status-danger-faded)]'
                      : 'bg-[var(--action-menu-selected-bg)] text-[var(--text-primary)]'
                    : action.style === 'destructive'
                      ? 'hover:bg-[var(--overlay-item-hover-bg)] text-[var(--status-danger-faded)]'
                      : 'hover:bg-[var(--overlay-item-hover-bg)] text-[var(--text-secondary)]'
                }`}
                style={
                  idx === selectedIndex
                    ? {
                        background: 'var(--action-menu-selected-bg)',
                        borderColor: 'var(--action-menu-selected-border)',
                        boxShadow: 'var(--action-menu-selected-shadow)',
                      }
                    : undefined
                }
                onClick={async () => {
                  await Promise.resolve(onActionClick(action));
                }}
                onMouseMove={() => setSelectedIndex(idx)}
              >
                {action.icon && (
                  <span
                    className={`shrink-0 ${
                      action.style === 'destructive'
                        ? 'text-[var(--status-danger-faded)]'
                        : 'text-[var(--text-muted)]'
                    }`}
                  >
                    {action.icon}
                  </span>
                )}
                <span className="flex-1 text-sm truncate">{action.title}</span>
                {action.shortcut && (
                  <span className="flex items-center gap-0.5">
                    {getShortcutDisplayParts(action.shortcut).map((key, keyIdx) => (
                      <kbd
                        key={`${action.id}-${key}-${keyIdx}`}
                        className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--kbd-bg)] text-[11px] font-medium text-[var(--text-muted)]"
                      >
                        {key}
                      </kbd>
                    ))}
                  </span>
                )}
              </div>
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
};

export default LauncherActionsOverlay;
