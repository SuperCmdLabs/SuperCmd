import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

interface UseInlineArgumentAnchorOptions {
  enabled: boolean;
  query: string;
  searchInputRef: RefObject<HTMLInputElement>;
  laneRef: RefObject<HTMLElement>;
  inlineRef: RefObject<HTMLElement>;
  minStartRatio?: number;
  gapPx?: number;
}

function getInputFont(style: CSSStyleDeclaration): string {
  if (style.font && style.font.trim().length > 0) {
    return style.font;
  }
  return `${style.fontStyle} ${style.fontVariant} ${style.fontWeight} ${style.fontSize}/${style.lineHeight} ${style.fontFamily}`;
}

function measureTextWidth(text: string, inputEl: HTMLInputElement, canvas: HTMLCanvasElement): number {
  if (!text) return 0;
  const context = canvas.getContext('2d');
  if (!context) return text.length * 8;
  context.font = getInputFont(window.getComputedStyle(inputEl));
  return context.measureText(text).width;
}

export function useInlineArgumentAnchor({
  enabled,
  query,
  searchInputRef,
  laneRef,
  inlineRef,
  minStartRatio = 0.3,
  gapPx = 12,
}: UseInlineArgumentAnchorOptions): number | null {
  const [leftPx, setLeftPx] = useState<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const recalculate = useCallback(() => {
    if (!enabled) {
      setLeftPx(null);
      return;
    }

    const laneEl = laneRef.current;
    const inputEl = searchInputRef.current;
    const inlineEl = inlineRef.current;
    if (!laneEl || !inputEl || !inlineEl) return;

    const laneWidth = laneEl.clientWidth;
    if (laneWidth <= 0) return;
    const inlineWidth = Math.max(inlineEl.offsetWidth, inlineEl.scrollWidth);

    const defaultStart = Math.floor(laneWidth * minStartRatio);
    if (!canvasRef.current) {
      canvasRef.current = document.createElement('canvas');
    }
    const inputStyle = window.getComputedStyle(inputEl);
    const inputPaddingLeft = Number.parseFloat(inputStyle.paddingLeft || '0') || 0;
    const normalizedQuery = String(query || '');
    const textWidth = measureTextWidth(normalizedQuery, inputEl, canvasRef.current);
    const desiredStart = normalizedQuery.length > 0
      ? inputPaddingLeft + textWidth + gapPx
      : defaultStart;
    const maxStart = Math.max(0, laneWidth - inlineWidth);
    const nextLeft = Math.min(desiredStart, maxStart);

    setLeftPx((previous) => (previous === nextLeft ? previous : nextLeft));
  }, [enabled, gapPx, inlineRef, laneRef, minStartRatio, query, searchInputRef]);

  useLayoutEffect(() => {
    recalculate();
  }, [recalculate]);

  useEffect(() => {
    if (!enabled) return;
    const laneEl = laneRef.current;
    const inlineEl = inlineRef.current;
    if (!laneEl || !inlineEl) return;

    const observer = new ResizeObserver(() => {
      recalculate();
    });
    observer.observe(laneEl);
    observer.observe(inlineEl);

    return () => {
      observer.disconnect();
    };
  }, [enabled, inlineRef, laneRef, recalculate]);

  return leftPx;
}
