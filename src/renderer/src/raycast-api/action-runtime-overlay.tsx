/**
 * Action runtime overlay and extraction layer.
 *
 * Provides static fallback extraction from ActionPanel trees and the
 * command palette style action overlay renderer.
 */

import React, { useEffect, useRef, useState } from 'react';
import type { ExtractedAction } from './action-runtime-types';

interface OverlayDeps {
  snapshotExtensionContext: () => any;
  inferActionTitle: (props: any, kind?: string) => string;
  makeActionExecutor: (props: any, runtimeCtx?: any) => () => void;
  renderIcon: (icon: any, className?: string, assetsPath?: string) => React.ReactNode;
  matchesShortcut: (e: React.KeyboardEvent | KeyboardEvent, shortcut?: { modifiers?: string[]; key?: string }) => boolean;
  isMetaK: (e: React.KeyboardEvent | KeyboardEvent) => boolean;
  renderShortcut: (shortcut?: { modifiers?: string[]; key?: string }) => React.ReactNode;
}

export function createActionOverlayRuntime(deps: OverlayDeps) {
  const {
    snapshotExtensionContext,
    inferActionTitle,
    makeActionExecutor,
    renderIcon,
    matchesShortcut,
    isMetaK,
    renderShortcut,
  } = deps;

  function extractActionsFromElement(element: React.ReactElement | undefined | null): ExtractedAction[] {
    if (!element) return [];

    const result: ExtractedAction[] = [];
    const runtimeCtx = snapshotExtensionContext();

    function walk(nodes: React.ReactNode, sectionTitle?: string) {
      React.Children.forEach(nodes, (child) => {
        if (!React.isValidElement(child)) return;

        const props = child.props as any;
        const hasChildren = props.children != null;
        const isActionLike =
          props.onAction || props.onSubmit || props.content !== undefined || props.url || props.target || props.paths;

        if (isActionLike || (props.title && !hasChildren)) {
          result.push({
            title: inferActionTitle(props),
            icon: props.icon,
            shortcut: props.shortcut,
            style: props.style,
            sectionTitle,
            execute: makeActionExecutor(props, runtimeCtx),
          });
          return;
        }

        if (hasChildren) {
          walk(props.children, props.title || sectionTitle);
        }
      });
    }

    const rootProps = element.props as any;
    if (rootProps?.children) {
      walk(rootProps.children);
    }

    return result;
  }

  function ActionPanelOverlay({
    actions,
    onClose,
    onExecute,
  }: {
    actions: ExtractedAction[];
    onClose: () => void;
    onExecute: (action: ExtractedAction) => void;
  }) {
    const [selectedIdx, setSelectedIdx] = useState(0);
    const [filter, setFilter] = useState('');
    const filterRef = useRef<HTMLInputElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);

    const filteredActions = filter
      ? actions.filter((action) => action.title.toLowerCase().includes(filter.toLowerCase()))
      : actions;

    useEffect(() => {
      filterRef.current?.focus();
    }, []);

    useEffect(() => {
      setSelectedIdx(0);
    }, [filter]);

    useEffect(() => {
      panelRef.current
        ?.querySelector(`[data-action-idx="${selectedIdx}"]`)
        ?.scrollIntoView({ block: 'nearest' });
    }, [selectedIdx]);

    const handleKeyDown = (event: React.KeyboardEvent) => {
      if ((event.metaKey || event.altKey || event.ctrlKey) && !event.repeat) {
        if (isMetaK(event)) {
          event.preventDefault();
          onClose();
          return;
        }

        for (const action of actions) {
          if (!action.shortcut || !matchesShortcut(event, action.shortcut)) continue;
          event.preventDefault();
          onExecute(action);
          return;
        }
      }

      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          setSelectedIdx((value) => Math.min(value + 1, filteredActions.length - 1));
          break;
        case 'ArrowUp':
          event.preventDefault();
          setSelectedIdx((value) => Math.max(value - 1, 0));
          break;
        case 'Enter':
          event.preventDefault();
          if (!event.repeat && filteredActions[selectedIdx]) onExecute(filteredActions[selectedIdx]);
          break;
        case 'Escape':
          event.preventDefault();
          onClose();
          break;
      }
    };

    const groups: { title?: string; items: { action: ExtractedAction; idx: number }[] }[] = [];
    let groupIndex = 0;
    let currentTitle: string | undefined | null = null;

    for (const action of filteredActions) {
      if (action.sectionTitle !== currentTitle || groups.length === 0) {
        currentTitle = action.sectionTitle;
        groups.push({ title: action.sectionTitle, items: [] });
      }
      groups[groups.length - 1].items.push({ action, idx: groupIndex++ });
    }

    const isGlassyTheme =
      document.documentElement.classList.contains('sc-glassy') ||
      document.body.classList.contains('sc-glassy');
    const isNativeLiquidGlass =
      document.documentElement.classList.contains('sc-native-liquid-glass') ||
      document.body.classList.contains('sc-native-liquid-glass');

    return (
      <div
        className="fixed inset-0 z-50"
        onClick={onClose}
        onKeyDown={handleKeyDown}
        tabIndex={-1}
        style={{ background: 'var(--bg-scrim)' }}
      >
        <div
          ref={panelRef}
          className={`absolute bottom-12 right-3 w-80 max-h-[65vh] overflow-hidden flex flex-col ${
            (isNativeLiquidGlass || isGlassyTheme) ? 'rounded-3xl p-1' : 'rounded-xl shadow-2xl'
          }`}
          style={
            isNativeLiquidGlass
              ? {
                  background: 'rgba(var(--surface-base-rgb), 0.72)',
                  backdropFilter: 'blur(44px) saturate(155%)',
                  WebkitBackdropFilter: 'blur(44px) saturate(155%)',
                  border: '1px solid rgba(var(--on-surface-rgb), 0.22)',
                  boxShadow: `
                    0 18px 38px -12px rgba(var(--backdrop-rgb), 0.26),
                    inset 0 -1px 0 0 rgba(var(--on-surface-rgb), 0.05)
                  `,
                }
              : isGlassyTheme
              ? {
                  background: `
                    linear-gradient(160deg,
                      rgba(255, 255, 255, 0.16) 0%,
                      rgba(255, 255, 255, 0.035) 38%,
                      rgba(255, 255, 255, 0.07) 100%
                    ),
                    rgba(var(--surface-base-rgb), 0.58)
                  `,
                  backdropFilter: 'blur(128px) saturate(195%) contrast(107%) brightness(1.03)',
                  WebkitBackdropFilter: 'blur(128px) saturate(195%) contrast(107%) brightness(1.03)',
                  border: '1px solid rgba(255, 255, 255, 0.14)',
                  boxShadow: `
                    0 28px 58px -14px rgba(0, 0, 0, 0.42),
                    inset 0 -1px 0 0 rgba(0, 0, 0, 0.08)
                  `,
                }
              : {
                  background: 'var(--card-bg)',
                  backdropFilter: 'blur(40px)',
                  WebkitBackdropFilter: 'blur(40px)',
                  border: '1px solid var(--border-primary)',
                }
          }
          onClick={(event) => event.stopPropagation()}
        >
          <div className="action-overlay-scroll flex-1 overflow-y-auto py-1">
            {filteredActions.length === 0 ? (
              <div className="px-3 py-4 text-center text-white/30 text-sm">No matching actions</div>
            ) : (
              groups.map((group, groupPosition) => (
                <div key={groupPosition}>
                  {groupPosition > 0 && <hr className="border-[var(--ui-divider)] my-0.5" />}
                  {group.title && (
                    <div className="px-3 pt-1.5 pb-0.5 text-[10px] uppercase tracking-wider text-white/25 font-medium select-none">
                      {group.title}
                    </div>
                  )}
                  {group.items.map(({ action, idx }) => (
                    <div
                      key={idx}
                      data-action-idx={idx}
                      className={`mx-1 px-2.5 py-1.5 rounded-lg border border-transparent flex items-center gap-2.5 cursor-pointer transition-colors ${
                        idx === selectedIdx
                          ? 'bg-[var(--action-menu-selected-bg)]'
                          : 'hover:bg-[var(--overlay-item-hover-bg)]'
                      }`}
                      style={
                        idx === selectedIdx
                          ? {
                              background: 'var(--action-menu-selected-bg)',
                              borderColor: 'var(--action-menu-selected-border)',
                              boxShadow: 'var(--action-menu-selected-shadow)',
                            }
                          : undefined
                      }
                      onClick={() => onExecute(action)}
                      onMouseMove={() => setSelectedIdx(idx)}
                    >
                      {action.icon && (
                        <span
                          className={`w-4 h-4 flex-shrink-0 flex items-center justify-center text-xs ${
                            idx === selectedIdx ? 'text-white' : 'text-white/50'
                          }`}
                          style={
                            isNativeLiquidGlass && action.style === 'destructive'
                              ? { color: 'var(--status-danger-faded)' }
                              : undefined
                          }
                        >
                          {renderIcon(action.icon, 'w-4 h-4')}
                        </span>
                      )}
                      <span
                        className={`flex-1 text-[13px] truncate ${
                          action.style === 'destructive'
                            ? idx === selectedIdx
                              ? 'text-white'
                              : 'text-red-400'
                            : idx === selectedIdx
                              ? 'text-white'
                              : 'text-white/80'
                        }`}
                        style={
                          isNativeLiquidGlass && action.style === 'destructive'
                            ? { color: 'var(--status-danger-faded)' }
                            : undefined
                        }
                      >
                        {action.title}
                      </span>
                      <span className={`flex items-center gap-0.5 ${idx === selectedIdx ? 'text-white/70' : 'text-white/25'}`}>
                        {idx === 0 ? (
                          <kbd className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded bg-white/[0.08] text-[10px] font-medium">
                            ↩
                          </kbd>
                        ) : (
                          renderShortcut(action.shortcut)
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
          <div className="border-t border-[var(--ui-divider)] px-3 py-2">
            <input
              ref={filterRef}
              type="text"
              placeholder="Search for actions…"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              className="w-full bg-transparent text-sm text-white/70 placeholder-white/25 outline-none"
            />
          </div>
        </div>
      </div>
    );
  }

  return {
    extractActionsFromElement,
    ActionPanelOverlay,
  };
}
