/**
 * raycast-api/detail-markdown.tsx
 * Purpose: Lightweight markdown renderer used by Detail and List.Item.Detail.
 */

import React from 'react';

type ResolveImageSrc = (src: string) => string;

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
          <img
            key={key++}
            src={parsed.src}
            alt={parsed.alt || ''}
            className="inline rounded"
            style={{ maxHeight: parsed.height || 350, ...(parsed.width ? { width: parsed.width } : {}) }}
          />
        );
        remaining = remaining.slice(htmlImgMatch[0].length);
        continue;
      }
    }

    const imgMatch = remaining.match(/^!\[([^\]]*)\]\(([^)]+)\)/);
    if (imgMatch) {
      const src = resolveImageSrc(imgMatch[2]);
      parts.push(<img key={key++} src={src} alt={imgMatch[1]} className="inline max-h-[350px] rounded" />);
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
      parts.push(<code key={key++} className="bg-white/[0.08] px-1 py-0.5 rounded text-xs font-mono text-white/70">{codeMatch[1]}</code>);
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    const boldMatch = remaining.match(/^\*\*([^*]+)\*\*/);
    if (boldMatch) {
      parts.push(<strong key={key++} className="text-white/90 font-semibold">{boldMatch[1]}</strong>);
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
        <pre key={elements.length} className="bg-white/[0.06] rounded-lg p-3 my-2 overflow-x-auto">
          <code className="text-xs text-white/70 font-mono">{codeLines.join('\n')}</code>
        </pre>
      );
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const sizes = ['text-xl', 'text-lg', 'text-base', 'text-sm', 'text-sm', 'text-xs'];
      elements.push(
        <div key={elements.length} className={`${sizes[level - 1]} font-bold text-white/90 mt-3 mb-1`}>
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
          <img src={src} alt={imgMatch[1]} className="max-w-full rounded-lg" style={{ maxHeight: 350 }} />
        </div>
      );
      i += 1;
      continue;
    }

    const htmlImg = parseHtmlImgTag(line, resolveImageSrc);
    if (htmlImg) {
      elements.push(
        <div key={elements.length} className="my-2 flex justify-center">
          <img
            src={htmlImg.src}
            alt={htmlImg.alt || ''}
            className="max-w-full rounded-lg"
            style={{ maxHeight: htmlImg.height || 350, ...(htmlImg.width ? { width: htmlImg.width } : {}) }}
          />
        </div>
      );
      i += 1;
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const text = line.replace(/^[-*]\s+/, '');
      elements.push(
        <div key={elements.length} className="flex items-start gap-2 text-sm text-white/80 ml-2">
          <span className="text-white/40 mt-0.5">•</span>
          <span>{renderInlineMarkdown(text, resolveImageSrc)}</span>
        </div>
      );
      i += 1;
      continue;
    }

    const olMatch = line.match(/^(\d+)\.\s+(.*)$/);
    if (olMatch) {
      elements.push(
        <div key={elements.length} className="flex items-start gap-2 text-sm text-white/80 ml-2">
          <span className="text-white/40 mt-0.5">{olMatch[1]}.</span>
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
      elements.push(<div key={elements.length} className="h-2" />);
      i += 1;
      continue;
    }

    elements.push(
      <p key={elements.length} className="text-sm text-white/80 leading-relaxed">
        {renderInlineMarkdown(line, resolveImageSrc)}
      </p>
    );
    i += 1;
  }

  return elements;
}
