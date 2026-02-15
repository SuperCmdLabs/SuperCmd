import { useEffect, useRef, useState } from 'react';

type DetachedWindowAnchor = 'center' | 'center-bottom' | 'top-right' | 'caret';

interface DetachedPortalWindowOptions {
  name: string;
  title: string;
  width: number;
  height: number;
  anchor: DetachedWindowAnchor;
  onClosed?: () => void;
}

const PORTAL_ROOT_ID = '__sc_detached_portal_root__';

function computeWindowPosition(anchor: DetachedWindowAnchor, width: number, height: number): { left: number; top: number } {
  const screenLeft = window.screen?.availLeft ?? 0;
  const screenTop = window.screen?.availTop ?? 0;
  const availWidth = window.screen?.availWidth || window.outerWidth || window.innerWidth || width;
  const availHeight = window.screen?.availHeight || window.outerHeight || window.innerHeight || height;

  if (anchor === 'top-right') {
    return {
      left: Math.round(screenLeft + availWidth - width - 20),
      top: Math.round(screenTop + 16),
    };
  }

  if (anchor === 'caret') {
    return {
      left: Math.round(screenLeft + (availWidth - width) / 2),
      top: Math.round(screenTop + availHeight - height - 14),
    };
  }

  if (anchor === 'center') {
    return {
      left: Math.round(screenLeft + (availWidth - width) / 2),
      top: Math.round(screenTop + (availHeight - height) / 2),
    };
  }

  return {
    left: Math.round(screenLeft + (availWidth - width) / 2),
    top: Math.round(screenTop + availHeight - height - 14),
  };
}

function buildWindowFeatures(width: number, height: number, anchor: DetachedWindowAnchor): string {
  const { left, top } = computeWindowPosition(anchor, width, height);
  return [
    `width=${Math.max(80, Math.round(width))}`,
    `height=${Math.max(36, Math.round(height))}`,
    `left=${left}`,
    `top=${top}`,
    'resizable=no',
    'scrollbars=no',
  ].join(',');
}

function cloneStylesIntoDocument(sourceDoc: Document, targetDoc: Document): void {
  const stale = targetDoc.head.querySelectorAll('[data-sc-detached-style="1"]');
  stale.forEach((node) => node.remove());

  const styleNodes = sourceDoc.head.querySelectorAll('style, link[rel="stylesheet"]');
  styleNodes.forEach((node) => {
    if (node.tagName.toLowerCase() === 'style') {
      const style = targetDoc.createElement('style');
      style.setAttribute('data-sc-detached-style', '1');
      style.textContent = (node as HTMLStyleElement).textContent || '';
      targetDoc.head.appendChild(style);
      return;
    }
    const linkNode = node as HTMLLinkElement;
    const href = linkNode.href;
    if (!href) return;
    const link = targetDoc.createElement('link');
    link.setAttribute('data-sc-detached-style', '1');
    link.rel = 'stylesheet';
    link.href = href;
    targetDoc.head.appendChild(link);
  });

  const baseStyle = targetDoc.createElement('style');
  baseStyle.setAttribute('data-sc-detached-style', '1');
  baseStyle.textContent = `
    html, body, #${PORTAL_ROOT_ID} {
      width: 100%;
      height: 100%;
      margin: 0;
      padding: 0;
      overflow: hidden;
      background: transparent;
    }
    body {
      position: relative;
    }
  `;
  targetDoc.head.appendChild(baseStyle);
}

function ensurePortalRoot(targetDoc: Document): HTMLElement {
  let root = targetDoc.getElementById(PORTAL_ROOT_ID) as HTMLElement | null;
  if (!root) {
    root = targetDoc.createElement('div');
    root.id = PORTAL_ROOT_ID;
    targetDoc.body.appendChild(root);
  }
  return root;
}

export function useDetachedPortalWindow(
  isOpen: boolean,
  options: DetachedPortalWindowOptions
): HTMLElement | null {
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const childWindowRef = useRef<Window | null>(null);
  const programmaticCloseRef = useRef(false);
  const onClosedRef = useRef<(() => void) | undefined>(options.onClosed);
  const windowNameRef = useRef<string>('');

  useEffect(() => {
    onClosedRef.current = options.onClosed;
  }, [options.onClosed]);

  useEffect(() => {
    const closeDetachedWindow = () => {
      const current = childWindowRef.current;
      if (!current || current.closed) {
        childWindowRef.current = null;
        windowNameRef.current = '';
        setPortalTarget(null);
        return;
      }
      programmaticCloseRef.current = true;
      try {
        current.close();
      } catch {}
      childWindowRef.current = null;
      windowNameRef.current = '';
      setPortalTarget(null);
      programmaticCloseRef.current = false;
    };

    if (!isOpen) {
      closeDetachedWindow();
      return;
    }

    const features = buildWindowFeatures(options.width, options.height, options.anchor);
    let child = childWindowRef.current;
    if (!child || child.closed) {
      if (!windowNameRef.current) {
        windowNameRef.current = `${options.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      }
      const popupUrl = `about:blank?sc_detached=${encodeURIComponent(options.name)}`;
      child = window.open(popupUrl, windowNameRef.current, features);
      if (!child) {
        setPortalTarget(null);
        return;
      }
      childWindowRef.current = child;
    } else {
      try {
        const { left, top } = computeWindowPosition(options.anchor, options.width, options.height);
        child.resizeTo(Math.round(options.width), Math.round(options.height));
        child.moveTo(left, top);
      } catch {}
    }

    const childDoc = child.document;
    childDoc.title = options.title;
    cloneStylesIntoDocument(document, childDoc);
    childDoc.documentElement.classList.add('sc-detached-window');
    if (childDoc.body) {
      childDoc.body.classList.add('sc-detached-window');
      childDoc.body.setAttribute('data-sc-detached-name', options.name);
    }
    const portalRoot = ensurePortalRoot(childDoc);
    setPortalTarget(portalRoot);
    const shouldFocusChild = options.name !== 'supercmd-whisper-window';
    if (shouldFocusChild) {
      try {
        child.focus();
      } catch {}
    }

    const handleBeforeUnload = () => {
      childWindowRef.current = null;
      windowNameRef.current = '';
      setPortalTarget(null);
      if (!programmaticCloseRef.current) {
        onClosedRef.current?.();
      }
    };

    child.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      try {
        child?.removeEventListener('beforeunload', handleBeforeUnload);
      } catch {}
      if (!isOpen) {
        closeDetachedWindow();
      }
    };
  }, [isOpen, options.anchor, options.height, options.name, options.title, options.width]);

  useEffect(() => {
    return () => {
      const current = childWindowRef.current;
      if (!current || current.closed) return;
      programmaticCloseRef.current = true;
      try {
        current.close();
      } catch {}
      childWindowRef.current = null;
      windowNameRef.current = '';
      programmaticCloseRef.current = false;
    };
  }, []);

  return portalTarget;
}
