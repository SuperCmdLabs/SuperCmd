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
  absoluteIndex: number;
  selected: boolean;
  style?: React.CSSProperties;
  registerItemRef: (absoluteIndex: number, el: HTMLDivElement | null) => void;
  commandAlias: string;
  commandHotkey: string;
  onCommandClick: (
    command: CommandInfo,
    selectedIndex: number,
    event?: React.MouseEvent<HTMLDivElement>
  ) => void | Promise<void>;
  onCommandContextMenu: (
    event: React.MouseEvent<HTMLDivElement>,
    command: CommandInfo,
    selectedIndex: number
  ) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
};

const LauncherCommandRowComponent: React.FC<LauncherCommandRowProps> = ({
  command,
  flatIndex,
  absoluteIndex,
  selected,
  style,
  registerItemRef,
  commandAlias,
  commandHotkey,
  onCommandClick,
  onCommandContextMenu,
  t,
}) => {
  const accessoryLabel = React.useMemo(() => getCommandAccessoryLabel(command), [command]);
  const typeBadgeLabel = React.useMemo(() => getCommandTypeBadgeLabel(command, t), [command, t]);
  const fallbackCategory = React.useMemo(() => getCategoryLabel(command.category, t), [command.category, t]);
  const hotkeyParts = React.useMemo(
    () => (commandHotkey ? getShortcutDisplayParts(commandHotkey) : []),
    [commandHotkey]
  );
  const displayTitle = React.useMemo(() => getCommandDisplayTitle(command, t), [command, t]);
  const commandIcon = React.useMemo(() => renderCommandIcon(command), [command]);
  const itemRef = React.useCallback(
    (el: HTMLDivElement | null) => {
      registerItemRef(absoluteIndex, el);
    },
    [absoluteIndex, registerItemRef]
  );
  const handleClick = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      void onCommandClick(command, absoluteIndex, event);
    },
    [absoluteIndex, command, onCommandClick]
  );
  const handleContextMenu = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      onCommandContextMenu(event, command, absoluteIndex);
    },
    [absoluteIndex, command, onCommandContextMenu]
  );

  return (
    <div
      ref={itemRef}
      className={`command-item px-3 py-2 rounded-lg cursor-pointer ${
        selected ? 'selected' : ''
      }`}
      style={style}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
    >
      <div className="flex items-center gap-2.5">
        <div className="w-5 h-5 flex items-center justify-center flex-shrink-0 overflow-hidden">
          {commandIcon}
        </div>

        <div className="min-w-0 flex-1 flex items-center gap-2">
          <div className="text-[var(--text-primary)] text-[0.8125rem] font-medium truncate tracking-[0.004em]">
            {displayTitle}
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

const LauncherCommandRow = React.memo(LauncherCommandRowComponent);

export default LauncherCommandRow;
