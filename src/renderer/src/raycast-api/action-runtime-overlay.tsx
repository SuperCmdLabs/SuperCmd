/**
 * Action runtime overlay and extraction layer.
 *
 * Provides static fallback extraction from ActionPanel trees and the
 * command palette style action overlay renderer.
 */

import React, { useEffect, useRef, useState } from 'react';
import type { ExtractedAction } from './action-runtime-types';
import { resolveIconSrc } from './icon-runtime-assets';

interface OverlayDeps {
  snapshotExtensionContext: () => any;
  inferActionTitle: (props: any, kind?: string) => string;
  makeActionExecutor: (props: any, runtimeCtx?: any) => () => void;
  renderIcon: (icon: any, className?: string, assetsPath?: string) => React.ReactNode;
  matchesShortcut: (e: React.KeyboardEvent | KeyboardEvent, shortcut?: { modifiers?: string[]; key?: string }) => boolean;
  isMetaK: (e: React.KeyboardEvent | KeyboardEvent) => boolean;
  renderShortcut: (shortcut?: { modifiers?: string[]; key?: string }) => React.ReactNode;
  renderShortcutKeycap: (label: string, key?: React.Key) => React.ReactNode;
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
    renderShortcutKeycap,
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
    const runtimeCtx = snapshotExtensionContext();
    const assetsPath = String(runtimeCtx?.assetsPath || '').trim();

    const filteredActions = filter
      ? actions.filter((action) => action.title.toLowerCase().includes(filter.toLowerCase()))
      : actions;

    const hasImageExtension = (value: string): boolean => /\.(svg|png|jpe?g|gif|webp|ico|tiff?)$/i.test(value);

    const hasRenderableActionIcon = (icon: ExtractedAction['icon']): boolean => {
      if (!icon) return false;
      if (typeof icon === 'string') {
        return hasImageExtension(icon) ? Boolean(resolveIconSrc(icon, assetsPath)) : true;
      }
      if (typeof icon !== 'object') return true;

      const source = (icon as Record<string, unknown>).source;
      const fallback = (icon as Record<string, unknown>).fallback;
      const fileIcon = (icon as Record<string, unknown>).fileIcon;
      if (typeof fileIcon === 'string' && fileIcon.trim()) return true;

      if (typeof source === 'string') {
        return hasImageExtension(source) ? Boolean(resolveIconSrc(source, assetsPath)) : true;
      }

      if (source && typeof source === 'object') {
        const variants = [source.light, source.dark].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
        if (variants.length > 0) {
          const assetLikeVariants = variants.filter((value) => hasImageExtension(value));
          if (assetLikeVariants.length === 0) return true;
          if (assetLikeVariants.some((value) => Boolean(resolveIconSrc(value, assetsPath)))) return true;
        }
      }

      if (typeof fallback === 'string' && fallback.trim()) return true;
      return false;
    };

    const hasAnyIcons = filteredActions.some((action) => hasRenderableActionIcon(action.icon));

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
          event.stopPropagation();
          onClose();
          return;
        }

        for (const action of actions) {
          if (!action.shortcut || !matchesShortcut(event, action.shortcut)) continue;
          event.preventDefault();
          event.stopPropagation();
          onExecute(action);
          return;
        }
      }

      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          event.stopPropagation();
          setSelectedIdx((value) => Math.min(value + 1, filteredActions.length - 1));
          break;
        case 'ArrowUp':
          event.preventDefault();
          event.stopPropagation();
          setSelectedIdx((value) => Math.max(value - 1, 0));
          break;
        case 'Enter':
          event.preventDefault();
          event.stopPropagation();
          if (!event.repeat && filteredActions[selectedIdx]) onExecute(filteredActions[selectedIdx]);
          break;
        case 'Escape':
          event.preventDefault();
          event.stopPropagation();
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

    const usesThemeOverride = isNativeLiquidGlass || isGlassyTheme;
    const themeOverrideStyle = isNativeLiquidGlass
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
      : undefined;

    return (
      <div
        className="sc-action-scrim"
        onClick={onClose}
        onKeyDown={handleKeyDown}
        tabIndex={-1}
      >
        <div
          ref={panelRef}
          className={`sc-action-panel ${usesThemeOverride ? '!rounded-3xl p-1' : ''}`}
          style={themeOverrideStyle}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="sc-action-list action-overlay-scroll">
            {filteredActions.length === 0 ? (
              <div className="sc-action-empty">No matching actions</div>
            ) : (
              groups.map((group, groupPosition) => (
                <div key={groupPosition} className="sc-action-section">
                  {group.title && (
                    <div className="sc-action-section-title">{group.title}</div>
                  )}
                  {group.items.map(({ action, idx }) => {
                    const hasActionIcon = hasRenderableActionIcon(action.icon);
                    const isSelected = idx === selectedIdx;
                    const isDestructive = action.style === 'destructive';
                    const itemClassName = `sc-action-item${isDestructive ? ' sc-action-item--destructive' : ''}`;
                    return (
                      <div
                        key={idx}
                        data-action-idx={idx}
                        data-selected={isSelected || undefined}
                        className={itemClassName}
                        onClick={() => onExecute(action)}
                        onMouseMove={() => setSelectedIdx(idx)}
                      >
                        {hasAnyIcons ? (
                          <span className="sc-action-item-icon">
                            {hasActionIcon ? renderIcon(action.icon, 'w-4 h-4', assetsPath) : null}
                          </span>
                        ) : null}
                        <span className="sc-action-item-title">{action.title}</span>
                        <span className="sc-action-item-shortcut">
                          {idx === 0 ? renderShortcutKeycap('↩', 'enter') : renderShortcut(action.shortcut)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>
          <div className="sc-action-search-bar">
            <input
              ref={filterRef}
              type="text"
              placeholder="Search for actions…"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              className="sc-action-search-input"
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
