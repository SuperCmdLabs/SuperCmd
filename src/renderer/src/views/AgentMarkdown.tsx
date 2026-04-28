/**
 * AgentMarkdown — small, dependency-free markdown renderer used inside the
 * AgentWidget result panel. Supports headings, bold/italic, inline code,
 * fenced code blocks, ordered/unordered lists and links.
 *
 * Inline `code` and fenced ``` blocks are rendered as copy-able snippets so
 * the user can grab IDs, amounts, paths, or any structured data the agent
 * surfaces in its final answer with a single click.
 */

import { useState, useCallback } from 'react';

interface AgentMarkdownProps {
  text: string;
  /** Accent color used for the copy-snippet hover highlight. */
  accentInk?: string;
}

export function AgentMarkdown({ text, accentInk = '#f7f7f8' }: AgentMarkdownProps) {
  const blocks = parseBlocks(text);
  return (
    <div
      style={{
        fontSize: 14,
        fontWeight: 500,
        color: '#f7f7f8',
        letterSpacing: '0.1px',
        lineHeight: 1.55,
        wordBreak: 'break-word',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      {blocks.map((block, i) => (
        <BlockRenderer key={i} block={block} accentInk={accentInk} />
      ))}
    </div>
  );
}

// ─── Block parsing ────────────────────────────────────────────────────

type Block =
  | { type: 'heading'; level: number; content: string }
  | { type: 'paragraph'; content: string }
  | { type: 'code-block'; lang: string; code: string }
  | { type: 'ordered-list'; items: string[] }
  | { type: 'bullet-list'; items: string[] };

function parseBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block.
    const fence = line.match(/^```(\S*)\s*$/);
    if (fence) {
      const lang = fence[1] || '';
      i++;
      const codeLines: string[] = [];
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // consume closing fence
      blocks.push({ type: 'code-block', lang, code: codeLines.join('\n') });
      continue;
    }

    // Heading.
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, content: heading[2] });
      i++;
      continue;
    }

    // Ordered list.
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ''));
        i++;
      }
      blocks.push({ type: 'ordered-list', items });
      continue;
    }

    // Bullet list.
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, ''));
        i++;
      }
      blocks.push({ type: 'bullet-list', items });
      continue;
    }

    // Blank line — skip; gap is handled by parent flex gap.
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Paragraph — collect contiguous non-special lines.
    const paraLines: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^#{1,4}\s+/.test(lines[i]) &&
      !/^```/.test(lines[i]) &&
      !/^\d+\.\s+/.test(lines[i]) &&
      !/^[-*]\s+/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push({ type: 'paragraph', content: paraLines.join('\n') });
  }

  return blocks;
}

// ─── Block renderer ───────────────────────────────────────────────────

function BlockRenderer({ block, accentInk }: { block: Block; accentInk: string }) {
  switch (block.type) {
    case 'heading': {
      const sizes = [0, 17, 15.5, 14, 13]; // index by level
      return (
        <div
          style={{
            fontSize: sizes[block.level] ?? 14,
            fontWeight: 700,
            letterSpacing: '-0.1px',
            color: '#fafafa',
            marginTop: 2,
            marginBottom: 2,
            lineHeight: 1.3,
          }}
        >
          {renderInline(block.content, accentInk)}
        </div>
      );
    }
    case 'paragraph':
      return (
        <div style={{ whiteSpace: 'pre-wrap' }}>
          {renderInline(block.content, accentInk)}
        </div>
      );
    case 'code-block':
      return <CodeBlock code={block.code} lang={block.lang} accentInk={accentInk} />;
    case 'ordered-list':
      return (
        <ol
          style={{
            margin: 0,
            paddingLeft: 22,
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
          }}
        >
          {block.items.map((item, i) => (
            <li key={i} style={{ paddingLeft: 2 }}>
              {renderInline(item, accentInk)}
            </li>
          ))}
        </ol>
      );
    case 'bullet-list':
      return (
        <ul
          style={{
            margin: 0,
            paddingLeft: 22,
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
          }}
        >
          {block.items.map((item, i) => (
            <li key={i} style={{ paddingLeft: 2 }}>
              {renderInline(item, accentInk)}
            </li>
          ))}
        </ul>
      );
  }
}

// ─── Inline parsing ───────────────────────────────────────────────────

// Order matters: longest-prefix tokens first so **bold** beats *italic*.
const INLINE_RE =
  /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(\*[^*\n]+\*)|(_[^_\n]+_)|(\[[^\]]+\]\([^)\s]+\))/g;

function renderInline(text: string, accentInk: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let key = 0;

  for (const m of text.matchAll(INLINE_RE)) {
    const start = m.index ?? 0;
    if (start > last) out.push(<span key={key++}>{text.slice(last, start)}</span>);
    const token = m[0];

    if (token.startsWith('`')) {
      out.push(
        <InlineCode key={key++} value={token.slice(1, -1)} accentInk={accentInk} />,
      );
    } else if (token.startsWith('**') || token.startsWith('__')) {
      out.push(
        <strong key={key++} style={{ fontWeight: 700, color: '#fafafa' }}>
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith('*') || token.startsWith('_')) {
      out.push(
        <em key={key++} style={{ fontStyle: 'italic' }}>
          {token.slice(1, -1)}
        </em>,
      );
    } else if (token.startsWith('[')) {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
      if (linkMatch) {
        const [, label, url] = linkMatch;
        out.push(
          <a
            key={key++}
            href={url}
            onClick={(e) => {
              e.preventDefault();
              const el = (window as any).electron;
              if (el?.openUrl) void el.openUrl(url);
              else window.open(url, '_blank');
            }}
            style={{ color: accentInk, textDecoration: 'underline' }}
          >
            {label}
          </a>,
        );
      } else {
        out.push(<span key={key++}>{token}</span>);
      }
    }
    last = start + token.length;
  }
  if (last < text.length) out.push(<span key={key++}>{text.slice(last)}</span>);
  return out;
}

// ─── Inline code chip with copy ───────────────────────────────────────

function InlineCode({ value, accentInk }: { value: string; accentInk: string }) {
  const [copied, setCopied] = useState(false);
  const [hovered, setHovered] = useState(false);
  const onCopy = useCallback(() => {
    copyText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1100);
  }, [value]);

  return (
    <button
      type="button"
      onClick={onCopy}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={copied ? 'Copied' : 'Click to copy'}
      style={{
        all: 'unset',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        cursor: 'pointer',
        padding: '1px 6px',
        margin: '0 1px',
        borderRadius: 5,
        fontFamily:
          "GeistMono, ui-monospace, SFMono-Regular, 'Roboto Mono', Menlo, Monaco, monospace",
        fontSize: 12,
        fontWeight: 500,
        color: copied ? accentInk : 'rgba(244, 244, 245, 0.95)',
        background: hovered || copied ? 'rgba(255, 255, 255, 0.10)' : 'rgba(255, 255, 255, 0.06)',
        border: `1px solid ${copied ? accentInk : 'rgba(255, 255, 255, 0.10)'}`,
        verticalAlign: 'baseline',
        lineHeight: 1.4,
        transition: 'background 120ms ease, border-color 120ms ease, color 120ms ease',
        WebkitAppRegion: 'no-drag',
      } as React.CSSProperties}
    >
      <span style={{ wordBreak: 'break-all' }}>{value}</span>
      <CopyGlyph copied={copied} />
    </button>
  );
}

// ─── Fenced code block ────────────────────────────────────────────────

function CodeBlock({ code, lang, accentInk }: { code: string; lang: string; accentInk: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = useCallback(() => {
    copyText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1100);
  }, [code]);

  return (
    <div
      style={{
        position: 'relative',
        background: 'rgba(0, 0, 0, 0.36)',
        border: '1px solid rgba(255, 255, 255, 0.06)',
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '5px 8px 5px 10px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
          background: 'rgba(255, 255, 255, 0.02)',
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '0.5px',
            textTransform: 'uppercase',
            color: 'rgba(244, 244, 245, 0.45)',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          }}
        >
          {lang || 'code'}
        </span>
        <button
          type="button"
          onClick={onCopy}
          title={copied ? 'Copied' : 'Copy to clipboard'}
          style={{
            all: 'unset',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '2px 7px',
            borderRadius: 4,
            fontSize: 10.5,
            fontWeight: 600,
            letterSpacing: '0.2px',
            color: copied ? accentInk : 'rgba(244, 244, 245, 0.7)',
            background: 'rgba(255, 255, 255, 0.05)',
            border: `1px solid ${copied ? accentInk : 'rgba(255, 255, 255, 0.08)'}`,
            transition: 'color 120ms ease, border-color 120ms ease',
          } as React.CSSProperties}
        >
          <CopyGlyph copied={copied} />
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre
        style={{
          margin: 0,
          padding: '8px 10px',
          fontFamily:
            "GeistMono, ui-monospace, SFMono-Regular, 'Roboto Mono', Menlo, Monaco, monospace",
          fontSize: 11.5,
          lineHeight: 1.55,
          color: 'rgba(244, 244, 245, 0.92)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          overflow: 'auto',
          maxHeight: 320,
        }}
      >
        {code}
      </pre>
    </div>
  );
}

// ─── Glyph + clipboard helper ─────────────────────────────────────────

function CopyGlyph({ copied }: { copied: boolean }) {
  if (copied) {
    return (
      <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden style={{ flexShrink: 0 }}>
        <path
          d="M2.5 6.2l2.4 2.4 4.6-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden style={{ flexShrink: 0 }}>
      <rect x="3.2" y="3.2" width="6" height="6.5" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.1" />
      <path
        d="M5 3V2.2A.8.8 0 0 1 5.8 1.4h3.4a.8.8 0 0 1 .8.8v4.6a.8.8 0 0 1-.8.8H9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function copyText(value: string) {
  try {
    if (navigator?.clipboard?.writeText) {
      void navigator.clipboard.writeText(value);
      return;
    }
  } catch {
    // fall through to legacy path
  }
  // Legacy fallback — works inside detached portal windows where the
  // async clipboard API may be unavailable.
  const ta = document.createElement('textarea');
  ta.value = value;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
  } catch {
    /* ignore */
  }
  document.body.removeChild(ta);
}
