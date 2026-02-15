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
  renderIcon: (icon: any, className?: string) => React.ReactNode;
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
    const cleanSrc = src.replace(/\?.*$/, '');
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

        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.06]">
          <button onClick={pop} className="text-white/30 hover:text-white/60 transition-colors flex-shrink-0 p-0.5">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {isLoading ? <div className="h-full" /> : (
            <>
              {markdown && <div className="text-white/80 text-sm leading-relaxed">{renderSimpleMarkdown(markdown, resolveMarkdownImageSrc)}</div>}
              {metadata}
              {children}
            </>
          )}
        </div>

        {isLoading ? (
          <div className="flex items-center px-4 py-3.5 border-t border-white/[0.06]" style={{ background: 'rgba(28,28,32,0.90)' }}>
            <div className="flex items-center gap-2 text-white/80 text-sm">
              <div className="w-4 h-4 border-2 border-white/20 border-t-white/70 rounded-full animate-spin" />
              <span>{navigationTitle || 'Loading…'}</span>
            </div>
          </div>
        ) : detailActions.length > 0 ? (
          <div className="flex items-center px-4 py-3.5 border-t border-white/[0.06]" style={{ background: 'rgba(28,28,32,0.90)' }}>
            <div className="flex items-center gap-2 text-white/40 text-xs flex-1 min-w-0 font-medium">
              {footerIcon ? <img src={footerIcon} alt="" className="w-4 h-4 rounded-sm object-contain flex-shrink-0" /> : null}
              <span className="truncate">{footerTitle}</span>
            </div>
            {primaryAction ? (
              <button type="button" onClick={() => primaryAction.execute()} className="flex items-center gap-2 mr-3 text-white hover:text-white/90 transition-colors">
                <span className="text-white text-xs font-semibold">{primaryAction.title}</span>
                {primaryAction.shortcut ? <span className="flex items-center gap-0.5">{deps.renderShortcut(primaryAction.shortcut)}</span> : <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-white/[0.08] text-[11px] text-white/40 font-medium">↩</kbd>}
              </button>
            ) : null}
            <button onClick={() => setShowActions(true)} className="flex items-center gap-1.5 text-white/50 hover:text-white/70 transition-colors">
              <span className="text-xs font-medium">Actions</span>
              <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-white/[0.08] text-[11px] text-white/40 font-medium">⌘</kbd>
              <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-white/[0.08] text-[11px] text-white/40 font-medium">K</kbd>
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
    return (
      <div className="text-xs text-white/50 flex items-center gap-1.5">
        <span className="text-white/30">{title}: </span>
        {icon ? <span className="inline-flex items-center">{deps.renderIcon(icon, 'w-3 h-3')}</span> : null}
        <span style={normalized.color ? { color: normalized.color } : undefined}>{normalized.value}</span>
      </div>
    );
  };

  const MetadataSeparator = () => <hr className="border-white/[0.06] my-2" />;
  const MetadataLink = ({ title, target, text }: { title: string; target: string; text: string }) => (
    <div className="text-xs"><span className="text-white/30">{title}: </span><a href={target} className="text-blue-400 hover:underline">{text}</a></div>
  );

  const MetadataTagListItem = ({ text, color }: { text: unknown; color?: unknown }) => {
    const normalized = resolveMetadataText(text);
    const tint = resolveTintColor(color) || normalized.color;
    const tagBg = tint ? (deps.addHexAlpha(tint, '22') || 'rgba(255,255,255,0.1)') : 'rgba(255,255,255,0.1)';
    return <span className="text-xs px-1.5 py-0.5 rounded mr-1" style={{ background: tagBg, color: tint || 'rgba(255,255,255,0.6)' }}>{normalized.value}</span>;
  };

  const MetadataTagList = Object.assign(
    ({ children, title }: { children?: React.ReactNode; title?: string }) => <div className="flex flex-wrap gap-1">{title ? <span className="text-xs text-white/30 mr-1">{title}:</span> : null}{children}</div>,
    { Item: MetadataTagListItem }
  );

  const Metadata = Object.assign(
    ({ children }: { children?: React.ReactNode }) => <div className="space-y-1 mt-4">{children}</div>,
    { Label: MetadataLabel, Separator: MetadataSeparator, Link: MetadataLink, TagList: MetadataTagList }
  );

  const Detail = Object.assign(DetailComponent, { Metadata });
  return { Detail, Metadata };
}
