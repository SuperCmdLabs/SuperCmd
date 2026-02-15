/**
 * List runtime detail panel helpers.
 *
 * Builds `List.Item.Detail` and handles markdown image source resolution.
 */

import React from 'react';
import { renderSimpleMarkdown } from './detail-markdown';

interface ListDetailDeps {
  getExtensionContext: () => { assetsPath: string };
  normalizeScAssetUrl: (url: string) => string;
  toScAssetUrl: (path: string) => string;
}

export function createListDetailRuntime(deps: ListDetailDeps) {
  const { getExtensionContext, normalizeScAssetUrl, toScAssetUrl } = deps;

  function resolveListDetailMarkdownImageSrc(src: string): string {
    const cleanSrc = src.replace(/\?.*$/, '');
    if (/^https?:\/\//.test(cleanSrc) || cleanSrc.startsWith('data:') || cleanSrc.startsWith('file://')) return cleanSrc;
    if (cleanSrc.startsWith('sc-asset://')) return normalizeScAssetUrl(cleanSrc);
    if (cleanSrc.startsWith('/')) return toScAssetUrl(cleanSrc);
    const context = getExtensionContext();
    if (context.assetsPath) return toScAssetUrl(`${context.assetsPath}/${cleanSrc}`);
    return cleanSrc;
  }

  const ListItemDetailComponent = ({ markdown, isLoading, metadata, children }: {
    markdown?: string;
    isLoading?: boolean;
    metadata?: React.ReactElement;
    children?: React.ReactNode;
  }) => (
    <div className="flex flex-col h-full overflow-y-auto p-4">
      {isLoading ? (
        <div className="flex items-center justify-center h-full text-white/50"><p className="text-sm">Loading…</p></div>
      ) : (
        <>
          {markdown && <div className="text-white/80 text-sm leading-relaxed">{renderSimpleMarkdown(markdown, resolveListDetailMarkdownImageSrc)}</div>}
          {metadata}
          {children}
        </>
      )}
    </div>
  );

  const ListItemDetail: any = Object.assign(ListItemDetailComponent, {});
  return { ListItemDetail };
}
