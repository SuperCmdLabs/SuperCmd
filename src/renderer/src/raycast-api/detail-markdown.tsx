/**
 * raycast-api/detail-markdown.tsx
 * Purpose: Lightweight markdown renderer used by Detail and List.Item.Detail.
 */

import React, { useState } from 'react';

type ResolveImageSrc = (src: string) => string;

/**
 * Image with onError fallback — renders a neutral placeholder when the
 * underlying <img> fails to load (broken URL, hotlink-blocked host that
 * returns 0-byte responses, etc.) instead of leaking the browser's
 * broken-image glyph.
 */
function MarkdownImage({
  src,
  alt,
  className,
  style,
  placeholderHeight,
}: {
  src: string;
  alt: string;
  className: string;
  style?: React.CSSProperties;
  placeholderHeight: number;
}) {
  const [errored, setErrored] = useState(false);
  const handleLoad = (event: React.SyntheticEvent<HTMLImageElement>) => {
    const img = event.currentTarget;
    if (img.naturalWidth === 0 || img.naturalHeight === 0) {
      setErrored(true);
    }
  };
  if (errored) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-[var(--ui-divider)] bg-[var(--ui-segment-bg)] text-[var(--text-subtle)]"
        style={{
          width: style?.width ?? placeholderHeight * 0.7,
          height: placeholderHeight,
        }}
        aria-label={alt || 'Image unavailable'}
        role="img"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          width="28"
          height="28"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="9" cy="9" r="1.5" />
          <path d="M21 15l-5-5L5 21" />
        </svg>
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      style={style}
      onError={() => setErrored(true)}
      onLoad={handleLoad}
    />
  );
}

type ParsedHtmlImage = {
  src: string;
  alt?: string;
  height?: number;
  width?: number;
};

function parseHtmlImgTag(html: string, resolveImageSrc: ResolveImageSrc): ParsedHtmlImage | null {
  const tag = html.trim();
  if (!/^<img\b/i.test(tag)) return null;

  const attrs: Record<string, string> = {};
  const attrRegex = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match: RegExpExecArray | null;
  while ((match = attrRegex.exec(tag))) {
    const name = (match[1] || '').toLowerCase();
    const value = match[3] ?? match[4] ?? match[5] ?? '';
    attrs[name] = value;
  }

  if (!attrs.src) return null;
  const parsedHeight = attrs.height ? Number(attrs.height) : undefined;
  const parsedWidth = attrs.width ? Number(attrs.width) : undefined;

  return {
    src: resolveImageSrc(attrs.src),
    alt: attrs.alt,
    height: Number.isFinite(parsedHeight) && parsedHeight! > 0 ? parsedHeight : undefined,
    width: Number.isFinite(parsedWidth) && parsedWidth! > 0 ? parsedWidth : undefined,
  };
}

function renderInlineMarkdown(text: string, resolveImageSrc: ResolveImageSrc): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    const htmlImgMatch = remaining.match(/^<img\b[^>]*\/?>/i);
    if (htmlImgMatch) {
      const parsed = parseHtmlImgTag(htmlImgMatch[0], resolveImageSrc);
      if (parsed) {
        parts.push(
          <MarkdownImage
            key={key++}
            src={parsed.src}
            alt={parsed.alt || ''}
            className="inline rounded"
            style={{ maxHeight: parsed.height || 350, ...(parsed.width ? { width: parsed.width } : {}) }}
            placeholderHeight={parsed.height || 180}
          />
        );
        remaining = remaining.slice(htmlImgMatch[0].length);
        continue;
      }
    }

    const imgMatch = remaining.match(/^!\[([^\]]*)\]\(([^)]+)\)/);
    if (imgMatch) {
      const src = resolveImageSrc(imgMatch[2]);
      parts.push(
        <MarkdownImage
          key={key++}
          src={src}
          alt={imgMatch[1]}
          className="inline max-h-[350px] rounded"
          placeholderHeight={180}
        />
      );
      remaining = remaining.slice(imgMatch[0].length);
      continue;
    }

    const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/);
    if (linkMatch) {
      parts.push(
        <a
          key={key++}
          href={linkMatch[2]}
          className="text-blue-400 hover:underline"
          onClick={(e) => {
            e.preventDefault();
            (window as any).electron?.openUrl?.(linkMatch[2]);
          }}
        >
          {linkMatch[1]}
        </a>
      );
      remaining = remaining.slice(linkMatch[0].length);
      continue;
    }

    const codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch) {
      parts.push(
        <code
          key={key++}
          className="bg-[var(--kbd-bg)] px-1.5 py-0.5 rounded text-[11px] font-mono text-[var(--text-secondary)]"
        >
          {codeMatch[1]}
        </code>
      );
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    const boldMatch = remaining.match(/^\*\*([^*]+)\*\*/);
    if (boldMatch) {
      parts.push(<strong key={key++} className="text-[var(--text-primary)] font-semibold">{boldMatch[1]}</strong>);
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    const italicMatch = remaining.match(/^\*([^*]+)\*/);
    if (italicMatch) {
      parts.push(<em key={key++}>{italicMatch[1]}</em>);
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }

    const plainMatch = remaining.match(/^[^![\]`*]+/);
    if (plainMatch) {
      parts.push(plainMatch[0]);
      remaining = remaining.slice(plainMatch[0].length);
    } else {
      parts.push(remaining[0]);
      remaining = remaining.slice(1);
    }
  }

  return parts.length === 1 ? parts[0] : <>{parts}</>;
}

export function renderSimpleMarkdown(md: string, resolveImageSrc: ResolveImageSrc): React.ReactNode[] {
  const lines = md.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith('```')) {
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i += 1;
      }
      i += 1;
      elements.push(
        <pre key={elements.length} className="my-0 overflow-x-auto whitespace-pre-wrap break-words">
          <code className="block text-[13px] leading-[1.65] font-mono text-[var(--text-primary)]">{codeLines.join('\n')}</code>
        </pre>
      );
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const sizes = ['text-xl', 'text-lg', 'text-base', 'text-sm', 'text-sm', 'text-xs'];
      elements.push(
        <div key={elements.length} className={`${sizes[level - 1]} font-bold text-[var(--text-primary)] mt-3 mb-1`}>
          {renderInlineMarkdown(headingMatch[2], resolveImageSrc)}
        </div>
      );
      i += 1;
      continue;
    }

    const imgMatch = line.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/);
    if (imgMatch) {
      const src = resolveImageSrc(imgMatch[2]);
      elements.push(
        <div key={elements.length} className="my-2 flex justify-center">
          <MarkdownImage
            src={src}
            alt={imgMatch[1]}
            className="max-w-full rounded-lg"
            style={{ maxHeight: 350 }}
            placeholderHeight={220}
          />
        </div>
      );
      i += 1;
      continue;
    }

    const htmlImg = parseHtmlImgTag(line, resolveImageSrc);
    if (htmlImg) {
      elements.push(
        <div key={elements.length} className="my-2 flex justify-center">
          <MarkdownImage
            src={htmlImg.src}
            alt={htmlImg.alt || ''}
            className="max-w-full rounded-lg"
            style={{ maxHeight: htmlImg.height || 350, ...(htmlImg.width ? { width: htmlImg.width } : {}) }}
            placeholderHeight={htmlImg.height || 220}
          />
        </div>
      );
      i += 1;
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const text = line.replace(/^[-*]\s+/, '');
      elements.push(
        <div key={elements.length} className="flex items-start gap-2 text-sm text-[var(--text-secondary)] ml-2">
          <span className="text-[var(--text-subtle)] mt-0.5">•</span>
          <span>{renderInlineMarkdown(text, resolveImageSrc)}</span>
        </div>
      );
      i += 1;
      continue;
    }

      const olMatch = line.match(/^(\d+)\.\s+(.*)$/);
      if (olMatch) {
        elements.push(
          <div key={elements.length} className="flex items-start gap-2 text-sm text-[var(--text-secondary)] ml-2">
            <span className="text-[var(--text-subtle)] mt-0.5">{olMatch[1]}.</span>
            <span>{renderInlineMarkdown(olMatch[2], resolveImageSrc)}</span>
          </div>
        );
        i += 1;
        continue;
    }

    if (/^---+$/.test(line.trim())) {
      elements.push(<hr key={elements.length} className="border-white/[0.08] my-3" />);
      i += 1;
      continue;
    }

    if (line.trim() === '') {
      elements.push(<div key={elements.length} className="h-1" />);
      i += 1;
      continue;
    }

    elements.push(
      <p key={elements.length} className="text-sm text-[var(--text-secondary)] leading-relaxed">
        {renderInlineMarkdown(line, resolveImageSrc)}
      </p>
    );
    i += 1;
  }

  return elements;
}
