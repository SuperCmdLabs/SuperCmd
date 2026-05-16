import React from 'react';
import type { CommandInfo } from '../../types/electron';
import type { LauncherAction } from '../utils/command-helpers';
import { getShortcutDisplayParts } from '../utils/command-helpers';
import { getLauncherFloatingPanelStyle } from './launcher-overlay-style';

export type LauncherContextMenuState = {
  x: number;
  y: number;
  command: CommandInfo;
};

type LauncherContextMenuOverlayProps = {
  contextMenu: LauncherContextMenuState | null;
  actions: LauncherAction[];
  selectedIndex: number;
  setSelectedIndex: React.Dispatch<React.SetStateAction<number>>;
  menuRef: React.RefObject<HTMLDivElement>;
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  onClose: () => void;
  onActionClick: (action: LauncherAction) => void | Promise<void>;
  isNativeLiquidGlass: boolean;
  isGlassyTheme: boolean;
};

const LauncherContextMenuOverlay: React.FC<LauncherContextMenuOverlayProps> = ({
  contextMenu,
  actions,
  selectedIndex,
  setSelectedIndex,
  menuRef,
  onKeyDown,
  onClose,
  onActionClick,
  isNativeLiquidGlass,
  isGlassyTheme,
}) => {
  if (!contextMenu || actions.length === 0) return null;

  return (
    <div
      className="fixed inset-0 z-50"
      onClick={onClose}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div
        ref={menuRef}
        className="absolute w-80 max-h-[60vh] rounded-xl overflow-hidden flex flex-col shadow-2xl outline-none focus:outline-none focus-visible:outline-none ring-0 focus:ring-0 focus-visible:ring-0"
        tabIndex={0}
        onKeyDown={onKeyDown}
        style={{
          left: Math.min(contextMenu.x, window.innerWidth - 340),
          top: Math.min(contextMenu.y, window.innerHeight - 320),
          ...getLauncherFloatingPanelStyle(isNativeLiquidGlass, isGlassyTheme),
        }}
        onFocus={(e) => {
          (e.currentTarget as HTMLDivElement).style.outline = 'none';
        }}
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="flex-1 overflow-y-auto py-1">
          {actions.map((action, idx) => (
            <div
              key={`ctx-${action.id}`}
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
                      key={`ctx-${action.id}-${key}-${keyIdx}`}
                      className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--kbd-bg)] text-[11px] font-medium text-[var(--text-muted)]"
                    >
                      {key}
                    </kbd>
                  ))}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default LauncherContextMenuOverlay;
