import React from 'react';
import type { CommandInfo } from '../../types/electron';
import {
  getCategoryLabel,
  getCommandAccessoryLabel,
  getCommandDisplayTitle,
  getCommandTypeBadgeLabel,
  getShortcutDisplayParts,
  renderCommandIcon,
} from '../utils/command-helpers';

type LauncherCommandRowProps = {
  command: CommandInfo;
  flatIndex: number;
  selected: boolean;
  itemRef: (el: HTMLDivElement | null) => void;
  commandAlias: string;
  commandHotkey: string;
  onClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  onContextMenu: (event: React.MouseEvent<HTMLDivElement>) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
};

const LauncherCommandRow: React.FC<LauncherCommandRowProps> = ({
  command,
  flatIndex,
  selected,
  itemRef,
  commandAlias,
  commandHotkey,
  onClick,
  onContextMenu,
  t,
}) => {
  const accessoryLabel = getCommandAccessoryLabel(command);
  const typeBadgeLabel = getCommandTypeBadgeLabel(command, t);
  const fallbackCategory = getCategoryLabel(command.category, t);
  const hotkeyParts = commandHotkey ? getShortcutDisplayParts(commandHotkey) : [];

  return (
    <div
      ref={itemRef}
      className={`command-item px-3 py-2 rounded-lg cursor-pointer ${
        selected ? 'selected' : ''
      }`}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      <div className="flex items-center gap-2.5">
        <div className="w-5 h-5 flex items-center justify-center flex-shrink-0 overflow-hidden">
          {renderCommandIcon(command)}
        </div>

        <div className="min-w-0 flex-1 flex items-center gap-2">
          <div className="text-[var(--text-primary)] text-[0.8125rem] font-medium truncate tracking-[0.004em]">
            {getCommandDisplayTitle(command, t)}
          </div>
          {accessoryLabel ? (
            <div className="text-[var(--text-muted)] text-[0.75rem] font-medium truncate">
              {accessoryLabel}
            </div>
          ) : (
            <div className="text-[var(--text-muted)] text-[0.6875rem] font-medium truncate">
              {fallbackCategory}
            </div>
          )}
          {commandAlias ? (
            <div className="inline-flex items-center h-5 rounded-md border border-[var(--launcher-chip-border)] bg-[var(--launcher-chip-bg)] px-1.5 text-[0.625rem] font-mono text-[var(--text-subtle)] leading-none flex-shrink-0">
              {commandAlias}
            </div>
          ) : null}
          {hotkeyParts.length > 0 ? (
            <span className="inline-flex items-center gap-0.5 flex-shrink-0">
              {hotkeyParts.map((part, idx) => (
                <kbd key={idx} className="inline-flex items-center justify-center min-w-[18px] h-[18px] rounded bg-[var(--kbd-bg)] px-1 text-[10px] font-medium text-[var(--text-muted)]">
                  {part}
                </kbd>
              ))}
            </span>
          ) : null}
        </div>
        {typeBadgeLabel ? (
          <div className="text-[var(--text-muted)] text-[0.6875rem] font-medium leading-none flex-shrink-0 truncate">
            {typeBadgeLabel}
          </div>
        ) : null}
        {flatIndex < 9 && (
          <span className="inline-flex items-center gap-0.5 flex-shrink-0">
            <kbd className="inline-flex items-center justify-center w-[18px] h-[18px] rounded bg-[var(--kbd-bg)] text-[10px] font-medium text-[var(--text-muted)]">⌘</kbd>
            <kbd className="inline-flex items-center justify-center w-[18px] h-[18px] rounded bg-[var(--kbd-bg)] text-[10px] font-medium text-[var(--text-muted)]">{flatIndex + 1}</kbd>
          </span>
        )}
      </div>
    </div>
  );
};

export default LauncherCommandRow;
