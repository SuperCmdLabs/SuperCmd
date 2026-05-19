import React from 'react';
import type { CommandInfo, QuickLinkDynamicField } from '../../types/electron';
import { getQuickLinkPromptPanelStyle } from './launcher-overlay-style';

export type QuickLinkDynamicPromptState = {
  command: CommandInfo;
  quickLinkId: string;
  fields: QuickLinkDynamicField[];
  values: Record<string, string>;
};

type QuickLinkDynamicPromptOverlayProps = {
  prompt: QuickLinkDynamicPromptState | null;
  inputRef: React.RefObject<HTMLInputElement>;
  commandTitle: string;
  setPrompt: React.Dispatch<React.SetStateAction<QuickLinkDynamicPromptState | null>>;
  onCancel: () => void;
  onSubmit: () => void | Promise<void>;
  isNativeLiquidGlass: boolean;
  isGlassyTheme: boolean;
};

const QuickLinkDynamicPromptOverlay: React.FC<QuickLinkDynamicPromptOverlayProps> = ({
  prompt,
  inputRef,
  commandTitle,
  setPrompt,
  onCancel,
  onSubmit,
  isNativeLiquidGlass,
  isGlassyTheme,
}) => {
  if (!prompt) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-5"
      style={{ background: 'var(--bg-scrim)' }}
      onMouseDown={onCancel}
    >
      <div
        className="w-[520px] max-w-[92vw] rounded-xl overflow-hidden"
        onMouseDown={(event) => event.stopPropagation()}
        style={getQuickLinkPromptPanelStyle(isNativeLiquidGlass, isGlassyTheme)}
      >
        <div className="px-4 py-3 border-b border-[var(--snippet-divider)] text-[var(--text-primary)] text-sm font-medium">
          Fill Quick Link Arguments
        </div>
        <div className="px-4 pt-3 text-xs text-[var(--text-muted)]">
          {commandTitle}
        </div>
        <div className="p-4 pt-3 space-y-3">
          {prompt.fields.map((field, idx) => (
            <div key={field.key}>
              <label className="block text-xs text-[var(--text-muted)] mb-1.5">{field.name}</label>
              <input
                ref={idx === 0 ? inputRef : undefined}
                type="text"
                value={prompt.values[field.key] || ''}
                onChange={(event) =>
                  setPrompt((prev) =>
                    prev
                      ? {
                          ...prev,
                          values: {
                            ...prev.values,
                            [field.key]: event.target.value,
                          },
                        }
                      : prev
                  )
                }
                placeholder={field.defaultValue || ''}
                className="w-full bg-[var(--ui-segment-bg)] border border-[var(--snippet-divider)] rounded-lg px-2.5 py-1.5 text-[13px] text-[var(--text-secondary)] placeholder:text-[color:var(--text-subtle)] outline-none focus:border-[var(--snippet-divider-strong)]"
              />
            </div>
          ))}
        </div>
        <div className="px-4 py-3 border-t border-[var(--snippet-divider)] flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[var(--snippet-divider)] bg-[var(--ui-segment-bg)] text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--ui-segment-hover-bg)] transition-colors"
          >
            <span>Cancel</span>
            <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--kbd-bg)] text-[11px] text-[var(--text-muted)] font-medium">Esc</kbd>
          </button>
          <button
            onClick={() => void onSubmit()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[var(--snippet-divider-strong)] bg-[var(--ui-segment-active-bg)] text-xs text-[var(--text-primary)] hover:bg-[var(--ui-segment-hover-bg)] transition-colors"
          >
            <span>Open Link</span>
            <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--kbd-bg)] text-[11px] text-[var(--text-muted)] font-medium">↩</kbd>
          </button>
        </div>
      </div>
    </div>
  );
};

export default QuickLinkDynamicPromptOverlay;
