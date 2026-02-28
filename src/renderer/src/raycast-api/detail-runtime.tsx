/**
 * raycast-api/detail-runtime.tsx
 * Purpose: Detail component runtime and metadata primitives.
 */

import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { normalizeScAssetUrl, resolveTintColor, toScAssetUrl } from './icon-runtime-assets';
import { renderSimpleMarkdown } from './detail-markdown';

type ExtractedActionLike = {
  title: string;
  execute: () => void;
  shortcut?: any;
};

type CreateDetailRuntimeDeps = {
  ExtensionInfoReactContext: React.Context<any>;
  getExtensionContext: () => any;
  useNavigation: () => { pop: () => void };
  useCollectedActions: () => { collectedActions: ExtractedActionLike[]; registryAPI: any };
  ActionPanelOverlay: React.ComponentType<{ actions: ExtractedActionLike[]; onClose: () => void; onExecute: (action: ExtractedActionLike) => void }>;
  ActionRegistryContext: React.Context<any>;
  matchesShortcut: (event: KeyboardEvent, shortcut: any) => boolean;
  isMetaK: (event: KeyboardEvent) => boolean;
  renderShortcut: (shortcut: any) => React.ReactNode;
  renderIcon: (icon: any, className?: string, assetsPath?: string) => React.ReactNode;
  addHexAlpha: (color: string, alphaHex: string) => string | undefined;
};

type DetailProps = {
  markdown?: string;
  children?: React.ReactNode;
  isLoading?: boolean;
  navigationTitle?: string;
  actions?: React.ReactElement;
  metadata?: React.ReactElement;
};

const DETAIL_METADATA_RUNTIME_MARKER = '__scDetailMetadataRuntime';

function resolveMetadataText(input: unknown): { value: string; color?: string } {
  if (input == null) return { value: '' };
  if (typeof input === 'object' && !Array.isArray(input)) {
    const maybe = input as { value?: unknown; color?: unknown };
    if ('value' in maybe || 'color' in maybe) {
      return {
        value: maybe.value == null ? '' : String(maybe.value),
        color: resolveTintColor(maybe.color),
      };
    }
  }
  return { value: String(input) };
}

export function createDetailRuntime(deps: CreateDetailRuntimeDeps) {
  const resolveMarkdownImageSrc = (src: string): string => {
    const rawSrc = typeof src === 'string' ? src.trim() : '';
    if (!rawSrc) return '';
    const cleanSrc = rawSrc.replace(/\?.*$/, '');
    if (/^https?:\/\//.test(cleanSrc) || cleanSrc.startsWith('data:') || cleanSrc.startsWith('file://')) return cleanSrc;
    if (cleanSrc.startsWith('sc-asset://')) return normalizeScAssetUrl(cleanSrc);
    if (cleanSrc.startsWith('/')) return toScAssetUrl(cleanSrc);

    const ctx = deps.getExtensionContext();
    if (ctx.assetsPath) return toScAssetUrl(`${ctx.assetsPath}/${cleanSrc}`);
    return cleanSrc;
  };

  function DetailComponent({ markdown, isLoading, children, actions, metadata, navigationTitle }: DetailProps) {
    const extInfo = useContext(deps.ExtensionInfoReactContext);
    const [showActions, setShowActions] = useState(false);
    const { pop } = deps.useNavigation();
    const { collectedActions: detailActions, registryAPI: detailActionRegistry } = deps.useCollectedActions();
    const primaryAction = detailActions[0];

    const { detailMetadata, detailChildren } = useMemo(() => {
      if (metadata) {
        return { detailMetadata: metadata, detailChildren: children };
      }

      const allChildren = React.Children.toArray(children);
      if (allChildren.length === 0) {
        return { detailMetadata: null, detailChildren: children };
      }

      const metadataNodes: React.ReactNode[] = [];
      const contentNodes: React.ReactNode[] = [];

      for (const node of allChildren) {
        if (React.isValidElement(node)) {
          const typeRecord = node.type as Record<string, unknown> | null;
          if (typeRecord?.[DETAIL_METADATA_RUNTIME_MARKER] === true) {
            metadataNodes.push(node);
            continue;
          }
        }
        contentNodes.push(node);
      }

      return {
        detailMetadata: metadataNodes.length > 0 ? <>{metadataNodes}</> : null,
        detailChildren: contentNodes.length > 0 ? contentNodes : null,
      };
    }, [children, metadata]);

    const extensionContext = deps.getExtensionContext();
    const footerTitle = navigationTitle || extInfo.extensionDisplayName || extensionContext.extensionDisplayName || extensionContext.extensionName || 'Extension';
    const footerIcon = extInfo.extensionIconDataUrl || extensionContext.extensionIconDataUrl;

    useEffect(() => {
      const handler = (event: KeyboardEvent) => {
        if (event.key === 'Escape') { event.preventDefault(); pop(); return; }
        if (deps.isMetaK(event)) { event.preventDefault(); setShowActions((prev) => !prev); return; }
        if (event.key === 'Enter' && event.metaKey && !event.repeat && primaryAction) { event.preventDefault(); primaryAction.execute(); return; }
        if (!event.repeat) {
          for (const action of detailActions) {
            if (action.shortcut && deps.matchesShortcut(event, action.shortcut)) {
              event.preventDefault();
              action.execute();
              return;
            }
          }
        }
      };
      window.addEventListener('keydown', handler);
      return () => window.removeEventListener('keydown', handler);
    }, [detailActions, pop, primaryAction]);

    const handleActionExecute = useCallback((action: ExtractedActionLike) => {
      setShowActions(false);
      action.execute();
    }, []);

    const handleContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
      if (detailActions.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      setShowActions(true);
    }, [detailActions.length]);

    return (
      <div className="flex flex-col h-full" onContextMenu={handleContextMenu}>
        {actions && (
          <div style={{ display: 'none' }}>
            <deps.ActionRegistryContext.Provider value={detailActionRegistry}>
              {actions}
            </deps.ActionRegistryContext.Provider>
          </div>
        )}

        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--ui-divider)]">
          <button onClick={pop} className="text-[var(--text-subtle)] hover:text-[var(--text-muted)] transition-colors flex-shrink-0 p-0.5">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          </button>
        </div>

        <div className="flex-1 overflow-hidden">
          {isLoading ? (
            <div className="h-full" />
          ) : detailMetadata ? (
            <div className="flex h-full overflow-hidden">
              <div className="flex-1 overflow-y-auto px-4 py-4">
                {markdown ? (
                  <div className="text-[var(--text-secondary)] text-sm leading-relaxed">
                    {renderSimpleMarkdown(markdown, resolveMarkdownImageSrc)}
                  </div>
                ) : null}
                {detailChildren}
              </div>
              <aside className="w-[34%] min-w-[280px] max-w-[380px] border-l border-[var(--ui-divider)] overflow-y-auto px-4 py-5">
                {detailMetadata}
              </aside>
            </div>
          ) : (
            <div className="h-full overflow-y-auto px-4 py-4">
              {markdown ? (
                <div className="text-[var(--text-secondary)] text-sm leading-relaxed">
                  {renderSimpleMarkdown(markdown, resolveMarkdownImageSrc)}
                </div>
              ) : null}
              {detailChildren}
            </div>
          )}
        </div>

        {isLoading ? (
          <div className="sc-glass-footer flex items-center px-4 py-2.5">
            <div className="flex items-center gap-2 text-[var(--text-secondary)] text-sm">
              <div className="w-4 h-4 border-2 border-[var(--surface-tint-6)] border-t-[var(--text-secondary)] rounded-full animate-spin" />
              <span>{navigationTitle || 'Loading…'}</span>
            </div>
          </div>
        ) : detailActions.length > 0 ? (
          <div className="sc-glass-footer flex items-center px-4 py-2.5">
            <div className="flex items-center gap-2 text-[var(--text-subtle)] text-xs flex-1 min-w-0 font-normal">
              {footerIcon ? <img src={footerIcon} alt="" className="w-4 h-4 rounded-sm object-contain flex-shrink-0" /> : null}
              <span className="truncate">{footerTitle}</span>
            </div>
            {primaryAction ? (
              <button type="button" onClick={() => primaryAction.execute()} className="flex items-center gap-2 mr-3 text-[var(--text-primary)] hover:text-[var(--text-secondary)] transition-colors">
                <span className="text-xs font-semibold">{primaryAction.title}</span>
                {primaryAction.shortcut ? <span className="flex items-center gap-0.5">{deps.renderShortcut(primaryAction.shortcut)}</span> : <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--kbd-bg)] text-[11px] text-[var(--text-subtle)] font-medium">↩</kbd>}
              </button>
            ) : null}
            <button onClick={() => setShowActions(true)} className="flex items-center gap-1.5 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors">
              <span className="text-xs font-normal">Actions</span>
              <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--kbd-bg)] text-[11px] text-[var(--text-subtle)] font-medium">⌘</kbd>
              <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--kbd-bg)] text-[11px] text-[var(--text-subtle)] font-medium">K</kbd>
            </button>
          </div>
        ) : null}

        {showActions && detailActions.length > 0 ? (
          <deps.ActionPanelOverlay
            actions={detailActions}
            onClose={() => setShowActions(false)}
            onExecute={handleActionExecute}
          />
        ) : null}
      </div>
    );
  }

  const MetadataLabel = ({ title, text, icon }: { title: string; text?: unknown; icon?: any }) => {
    const normalized = resolveMetadataText(text);
    const extInfo = useContext(deps.ExtensionInfoReactContext);
    const extensionContext = deps.getExtensionContext();
    const assetsPath = extInfo?.assetsPath || extensionContext?.assetsPath || '';
    const hasValue = Boolean(normalized.value);

    return (
      <div className="space-y-1.5">
        <div className="text-[12px] font-semibold text-[var(--text-subtle)]">{title}</div>
        <div className="flex items-center gap-2 text-[14px] leading-6 text-[var(--text-primary)]">
          {icon ? (
            <span className="inline-flex items-center justify-center text-[var(--text-muted)]">
              {deps.renderIcon(icon, 'w-4 h-4', assetsPath)}
            </span>
          ) : null}
          <span style={normalized.color ? { color: normalized.color } : undefined}>
            {hasValue ? normalized.value : '—'}
          </span>
        </div>
      </div>
    );
  };

  const MetadataSeparator = () => <hr className="border-[var(--ui-divider)] my-3" />;
  const MetadataLink = ({ title, target, text }: { title: string; target: string; text?: string }) => (
    <div className="space-y-1.5">
      <div className="text-[12px] font-semibold text-[var(--text-subtle)]">{title}</div>
      <a href={target} className="text-[14px] leading-6 text-blue-400 hover:underline">{text || target}</a>
    </div>
  );

  const MetadataTagListItem = ({ text, color, icon }: { text: unknown; color?: unknown; icon?: any }) => {
    const normalized = resolveMetadataText(text);
    const tint = resolveTintColor(color) || normalized.color;
    const tagBg = tint ? (deps.addHexAlpha(tint, '22') || 'rgba(var(--on-surface-rgb), 0.1)') : 'rgba(var(--on-surface-rgb), 0.1)';
    const extInfo = useContext(deps.ExtensionInfoReactContext);
    const extensionContext = deps.getExtensionContext();
    const assetsPath = extInfo?.assetsPath || extensionContext?.assetsPath || '';

    return (
      <span
        className="inline-flex items-center gap-1.5 text-[14px] leading-5 px-2 py-1 rounded-md"
        style={{ background: tagBg, color: tint || 'rgba(var(--on-surface-rgb), 0.7)' }}
      >
        {icon ? (
          <span className="inline-flex items-center justify-center text-current">
            {deps.renderIcon(icon, 'w-3.5 h-3.5', assetsPath)}
          </span>
        ) : null}
        {normalized.value}
      </span>
    );
  };

  const MetadataTagList = Object.assign(
    ({ children, title }: { children?: React.ReactNode; title?: string }) => (
      <div className="space-y-1.5">
        {title ? <div className="text-[12px] font-semibold text-[var(--text-subtle)]">{title}</div> : null}
        <div className="flex flex-wrap gap-2">{children}</div>
      </div>
    ),
    { Item: MetadataTagListItem }
  );

  const MetadataComponent = ({ children }: { children?: React.ReactNode }) => <div className="space-y-4">{children}</div>;
  (MetadataComponent as Record<string, unknown>)[DETAIL_METADATA_RUNTIME_MARKER] = true;
  MetadataComponent.displayName = 'Detail.Metadata';

  const Metadata = Object.assign(
    MetadataComponent,
    { Label: MetadataLabel, Separator: MetadataSeparator, Link: MetadataLink, TagList: MetadataTagList }
  );

  const Detail = Object.assign(DetailComponent, { Metadata });
  return { Detail, Metadata };
}
