import React from 'react';
import { Sparkles, X } from 'lucide-react';
import type { CommandInfo, QuickLinkDynamicField } from '../../types/electron';
import InlineArgumentField, { InlineArgumentLeadingIcon, InlineArgumentOverflowBadge } from './InlineArgumentField';

type LauncherSearchHeaderProps = {
  inlineArgumentLaneRef: React.RefObject<HTMLDivElement>;
  inlineArgumentClusterRef: React.RefObject<HTMLDivElement>;
  inlineArgumentInputRefs: React.MutableRefObject<(HTMLInputElement | HTMLSelectElement | null)[]>;
  inlineQuickLinkInputRefs: React.MutableRefObject<(HTMLInputElement | null)[]>;

  inputRef: React.RefObject<HTMLInputElement>;
  placeholder: string;
  value: string;
  autocompleteSuffix?: string;
  onInputChange: (value: string) => void;
  onBlur: () => void;
  onKeyDown: (event: React.KeyboardEvent) => void;

  inlineArgumentStartPx: number | null;
  selectedInlineArgumentLeadingIcon: React.ReactNode;

  selectedInlineExtensionArgumentDefinitions: CommandInfo['commandArgumentDefinitions'];
  selectedInlineExtensionArgumentValues: Record<string, string>;
  hasSelectedExtensionOverflowArguments: boolean;
  selectedExtensionOverflowCount: number;
  onInlineExtensionArgumentChange: (argumentName: string, value: string) => void;

  selectedQuickLinkId: string | null;
  selectedInlineQuickLinkDynamicFields: QuickLinkDynamicField[];
  selectedInlineQuickLinkDynamicValues: Record<string, string>;
  hasSelectedQuickLinkOverflowDynamicFields: boolean;
  selectedQuickLinkOverflowCount: number;
  onInlineQuickLinkDynamicValueChange: (fieldKey: string, value: string) => void;

  searchQuery: string;
  aiAvailable: boolean;
  shouldHideAskAi: boolean;
  onAskAi: () => void;
  onClearSearch: () => void;

  t: (key: string, params?: Record<string, string | number>) => string;
};

const LauncherSearchHeader: React.FC<LauncherSearchHeaderProps> = ({
  inlineArgumentLaneRef,
  inlineArgumentClusterRef,
  inlineArgumentInputRefs,
  inlineQuickLinkInputRefs,
  inputRef,
  placeholder,
  value,
  autocompleteSuffix,
  onInputChange,
  onBlur,
  onKeyDown,
  inlineArgumentStartPx,
  selectedInlineArgumentLeadingIcon,
  selectedInlineExtensionArgumentDefinitions,
  selectedInlineExtensionArgumentValues,
  hasSelectedExtensionOverflowArguments,
  selectedExtensionOverflowCount,
  onInlineExtensionArgumentChange,
  selectedQuickLinkId,
  selectedInlineQuickLinkDynamicFields,
  selectedInlineQuickLinkDynamicValues,
  hasSelectedQuickLinkOverflowDynamicFields,
  selectedQuickLinkOverflowCount,
  onInlineQuickLinkDynamicValueChange,
  searchQuery,
  aiAvailable,
  shouldHideAskAi,
  onAskAi,
  onClearSearch,
}) => {
  const extensionArgumentDefinitions = selectedInlineExtensionArgumentDefinitions || [];

  return (
    <div className="drag-region flex h-[60px] items-center gap-2 px-4 border-b border-[var(--ui-divider)]">
      <div ref={inlineArgumentLaneRef} className="relative min-w-0 flex-1">
        <div className="relative flex h-full items-center">
          {autocompleteSuffix && value ? (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 flex items-center min-w-0 w-full text-[0.9375rem] font-medium tracking-[0.005em] whitespace-pre overflow-hidden"
            >
              <span className="invisible">{value}</span>
              <span className="text-[color:var(--text-subtle)]">{autocompleteSuffix}</span>
            </div>
          ) : null}
          <input
            ref={inputRef}
            type="text"
            placeholder={placeholder}
            value={value}
            onChange={(e) => {
              onInputChange(e.target.value);
            }}
            onBlur={onBlur}
            onKeyDown={onKeyDown}
            className="launcher-search-input min-w-0 w-full bg-transparent border-none outline-none text-[var(--text-primary)] placeholder:text-[color:var(--text-muted)] placeholder:font-medium text-[0.9375rem] font-medium tracking-[0.005em]"
            autoFocus
          />
        </div>
        {extensionArgumentDefinitions.length > 0 ? (
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center overflow-x-hidden overflow-y-visible">
            <div
              ref={inlineArgumentClusterRef}
              className="pointer-events-auto inline-flex min-w-0 items-center gap-1"
              style={{ marginLeft: inlineArgumentStartPx != null ? `${inlineArgumentStartPx}px` : '30%' }}
            >
              {selectedInlineArgumentLeadingIcon ? (
                <InlineArgumentLeadingIcon>{selectedInlineArgumentLeadingIcon}</InlineArgumentLeadingIcon>
              ) : null}
              {extensionArgumentDefinitions.map((definition, index) => {
                const value = selectedInlineExtensionArgumentValues[definition.name] || '';
                const placeholder = definition.placeholder || definition.title || definition.name;
                return (
                  <InlineArgumentField
                    key={`inline-arg-${definition.name}`}
                    inputRef={(el) => {
                      inlineArgumentInputRefs.current[index] = el;
                    }}
                    value={value}
                    placeholder={placeholder}
                    type={definition.type === 'dropdown' ? 'select' : definition.type === 'password' ? 'password' : 'text'}
                    options={(definition.data || []).map((option) => ({
                      value: String(option?.value || ''),
                      label: String(option?.title || option?.value || ''),
                    }))}
                    onChange={(nextValue) => {
                      onInlineExtensionArgumentChange(definition.name, nextValue);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Tab') {
                        event.preventDefault();
                        const total = extensionArgumentDefinitions.length;
                        const nextIndex = event.shiftKey ? index - 1 : index + 1;
                        if (nextIndex >= 0 && nextIndex < total) {
                          inlineArgumentInputRefs.current[nextIndex]?.focus();
                        } else {
                          inputRef.current?.focus();
                        }
                        return;
                      }
                      onKeyDown(event);
                    }}
                  />
                );
              })}
              {hasSelectedExtensionOverflowArguments ? (
                <InlineArgumentOverflowBadge
                  count={selectedExtensionOverflowCount}
                />
              ) : null}
            </div>
          </div>
        ) : selectedInlineQuickLinkDynamicFields.length > 0 ? (
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center overflow-x-hidden overflow-y-visible">
            <div
              ref={inlineArgumentClusterRef}
              className="pointer-events-auto inline-flex min-w-0 items-center gap-1"
              style={{ marginLeft: inlineArgumentStartPx != null ? `${inlineArgumentStartPx}px` : '30%' }}
            >
              {selectedInlineArgumentLeadingIcon ? (
                <InlineArgumentLeadingIcon>{selectedInlineArgumentLeadingIcon}</InlineArgumentLeadingIcon>
              ) : null}
              {selectedInlineQuickLinkDynamicFields.map((field, index) => (
                <InlineArgumentField
                  key={`inline-quicklink-${selectedQuickLinkId || 'none'}-${field.key}`}
                  inputRef={(el) => {
                    inlineQuickLinkInputRefs.current[index] = el as HTMLInputElement | null;
                  }}
                  value={selectedInlineQuickLinkDynamicValues[field.key] || ''}
                  placeholder={field.defaultValue || field.name}
                  onChange={(nextValue) => {
                    onInlineQuickLinkDynamicValueChange(field.key, nextValue);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Tab') {
                      event.preventDefault();
                      const total = selectedInlineQuickLinkDynamicFields.length;
                      const nextIndex = event.shiftKey ? index - 1 : index + 1;
                      if (nextIndex >= 0 && nextIndex < total) {
                        inlineQuickLinkInputRefs.current[nextIndex]?.focus();
                      } else {
                        inputRef.current?.focus();
                      }
                      return;
                    }
                    onKeyDown(event);
                  }}
                />
              ))}
              {hasSelectedQuickLinkOverflowDynamicFields ? (
                <InlineArgumentOverflowBadge
                  count={selectedQuickLinkOverflowCount}
                />
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {searchQuery && aiAvailable && !shouldHideAskAi && (
          <button
            onClick={onAskAi}
            className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-[var(--soft-pill-bg)] hover:bg-[var(--soft-pill-hover-bg)] transition-colors flex-shrink-0 group"
          >
            <Sparkles className="w-3 h-3 text-white/30 group-hover:text-purple-400 transition-colors" />
            <span className="text-[0.6875rem] text-white/30 group-hover:text-white/50 transition-colors">Ask AI</span>
            <kbd className="text-[0.625rem] text-white/20 bg-[var(--soft-pill-bg)] px-1 py-0.5 rounded font-mono leading-none">Tab</kbd>
          </button>
        )}
        {searchQuery && (
          <button
            onClick={onClearSearch}
            className="text-[var(--text-subtle)] hover:text-[var(--text-muted)] transition-colors flex-shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
};

export default LauncherSearchHeader;
