import React from 'react';
import type { CommandInfo } from '../../types/electron';
import type { CalcResult } from '../smart-calculator';
import LauncherCalculatorCard from './LauncherCalculatorCard';
import LauncherCommandRow from './LauncherCommandRow';

export type LauncherCommandSection = {
  title: string;
  items: CommandInfo[];
};

type LauncherCommandListProps = {
  listRef: React.RefObject<HTMLDivElement>;
  itemRefs: React.MutableRefObject<(HTMLDivElement | null)[]>;
  isLoading: boolean;
  isHidden: boolean;
  displayCommands: CommandInfo[];
  sections: LauncherCommandSection[];
  calcResult: CalcResult | null;
  calcOffset: number;
  selectedIndex: number;
  commandAliases: Record<string, string>;
  commandHotkeys: Record<string, string>;
  onCalculatorCopy: () => void;
  onCommandClick: (command: CommandInfo, selectedIndex: number, event?: React.MouseEvent<HTMLDivElement>) => void | Promise<void>;
  onCommandContextMenu: (
    event: React.MouseEvent<HTMLDivElement>,
    command: CommandInfo,
    selectedIndex: number
  ) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
};

const LauncherCommandList: React.FC<LauncherCommandListProps> = ({
  listRef,
  itemRefs,
  isLoading,
  isHidden,
  displayCommands,
  sections,
  calcResult,
  calcOffset,
  selectedIndex,
  commandAliases,
  commandHotkeys,
  onCalculatorCopy,
  onCommandClick,
  onCommandContextMenu,
  t,
}) => (
  <div
    ref={listRef}
    className="flex-1 overflow-y-auto custom-scrollbar p-1.5 list-area"
    style={isHidden ? { display: 'none' } : undefined}
  >
    {isLoading ? (
      <div className="flex items-center justify-center h-full text-[var(--text-muted)]">
        <p className="text-sm">{t('launcher.status.discoveringApps')}</p>
      </div>
    ) : displayCommands.length === 0 && !calcResult ? (
      <div className="flex items-center justify-center h-full text-[var(--text-muted)]">
        <p className="text-sm">{t('launcher.status.noMatchingResults')}</p>
      </div>
    ) : (
      <div className="space-y-0.5">
        {calcResult && (
          <LauncherCalculatorCard
            result={calcResult}
            selected={selectedIndex === 0}
            itemRef={(el) => (itemRefs.current[0] = el)}
            onCopy={onCalculatorCopy}
            t={t}
          />
        )}

        {sections.reduce(
          (acc, section) => {
            const startIndex = acc.index;
            if (section.title) {
              acc.nodes.push(
                <div
                  key={`section-${section.title}`}
                  className="px-3 pt-2 pb-1 text-[0.6875rem] uppercase tracking-wider text-[var(--text-subtle)] font-medium"
                >
                  {section.title}
                </div>
              );
            }
            section.items.forEach((command, i) => {
              const flatIndex = startIndex + i;
              const absoluteIndex = flatIndex + calcOffset;
              const commandAlias = String(commandAliases[command.id] || '').trim();
              const commandHotkey = String(commandHotkeys[command.id] || '').trim();
              acc.nodes.push(
                <LauncherCommandRow
                  key={command.id}
                  command={command}
                  flatIndex={flatIndex}
                  selected={absoluteIndex === selectedIndex}
                  itemRef={(el) => (itemRefs.current[absoluteIndex] = el)}
                  commandAlias={commandAlias}
                  commandHotkey={commandHotkey}
                  onClick={(event) => {
                    void onCommandClick(command, absoluteIndex, event);
                  }}
                  onContextMenu={(event) => onCommandContextMenu(event, command, absoluteIndex)}
                  t={t}
                />
              );
            });
            acc.index += section.items.length;
            return acc;
          },
          { nodes: [] as React.ReactNode[], index: 0 }
        ).nodes}
      </div>
    )}
  </div>
);

export default LauncherCommandList;
