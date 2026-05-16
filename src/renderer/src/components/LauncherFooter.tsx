import React from 'react';
import type { CommandInfo } from '../../types/electron';
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
  resultCount: number;
  onOpenActions: () => void;
  t: (key: string, params?: Record<string, string | number>) => string;
};

const LauncherFooter: React.FC<LauncherFooterProps> = ({
  status,
  selectedCommand,
  selectedAction,
  resultCount,
  onOpenActions,
  t,
}) => (
  <div
    className="sc-glass-footer sc-launcher-footer absolute bottom-0 left-0 right-0 z-10 flex items-center px-4 py-2.5"
  >
    <div
      className="sc-footer-primary flex items-center gap-2 text-xs flex-1 min-w-0 font-normal truncate text-[var(--text-subtle)]"
    >
      {status ? (
        <>
          {status.type === 'success' ? (
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/90 shadow-[0_0_0_3px_rgba(52,211,153,0.18)] flex-shrink-0" />
          ) : (
            <span className="w-1.5 h-1.5 rounded-full bg-rose-400/90 shadow-[0_0_0_3px_rgba(244,114,182,0.18)] flex-shrink-0" />
          )}
          <span className="truncate text-[var(--text-secondary)]">{status.text}</span>
        </>
      ) : selectedCommand ? (
        <>
          <span className="w-5 h-5 flex items-center justify-center flex-shrink-0 overflow-hidden">
            {renderCommandIcon(selectedCommand)}
          </span>
          <span className="truncate">{getCommandDisplayTitle(selectedCommand, t)}</span>
        </>
      ) : (
        t('launcher.status.results', { count: resultCount })
      )}
    </div>
    {selectedAction && (
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
    )}
    <button
      onClick={onOpenActions}
      className="flex items-center gap-1.5 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
    >
      <span className="text-xs font-normal">{t('common.actions')}</span>
      <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--kbd-bg)] text-[0.6875rem] text-[var(--text-subtle)] font-medium">⌘</kbd>
      <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--kbd-bg)] text-[0.6875rem] text-[var(--text-subtle)] font-medium">K</kbd>
    </button>
  </div>
);

export default LauncherFooter;
