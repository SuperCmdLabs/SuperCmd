/**
 * Action runtime keyboard helpers.
 *
 * Provides shortcut matching utilities and the keyboard shortcut renderer
 * used by action overlays and footer affordances.
 */

import React from 'react';
import type { ActionShortcut } from './action-runtime-types';

export function matchesShortcut(e: React.KeyboardEvent | KeyboardEvent, shortcut?: ActionShortcut): boolean {
  if (!shortcut?.key) return false;
  const shortcutKey = shortcut.key.toLowerCase();
  const eventKey = e.key.toLowerCase();
  const eventCode = ((e as any).code || '').toLowerCase();

  const keyMatch = eventKey === shortcutKey;
  const codeMatch =
    shortcutKey.length === 1 &&
    /^[a-z]$/.test(shortcutKey) &&
    eventCode === `key${shortcutKey}`;
  if (!keyMatch && !codeMatch) return false;

  const modifiers = shortcut.modifiers || [];
  if (modifiers.includes('cmd') !== e.metaKey) return false;
  if ((modifiers.includes('opt') || modifiers.includes('option') || modifiers.includes('alt')) !== e.altKey) return false;
  if (modifiers.includes('shift') !== e.shiftKey) return false;
  if (modifiers.includes('ctrl') !== e.ctrlKey) return false;
  return true;
}

export function isMetaK(e: React.KeyboardEvent | KeyboardEvent): boolean {
  return e.metaKey && String(e.key || '').toLowerCase() === 'k';
}

export function renderShortcut(shortcut?: ActionShortcut): React.ReactNode {
  if (!shortcut?.key) return null;

  const parts: string[] = [];
  for (const mod of shortcut.modifiers || []) {
    if (mod === 'cmd') parts.push('⌘');
    else if (mod === 'opt' || mod === 'alt') parts.push('⌥');
    else if (mod === 'shift') parts.push('⇧');
    else if (mod === 'ctrl') parts.push('⌃');
  }

  return (
    <span className="flex items-center gap-0.5 ml-auto">
      {parts.map((symbol, index) => (
        <kbd
          key={index}
          className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded bg-white/[0.06] text-[10px] text-white/40 font-medium"
        >
          {symbol}
        </kbd>
      ))}
      <kbd className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded bg-white/[0.06] text-[10px] text-white/40 font-medium">
        {shortcut.key.toUpperCase()}
      </kbd>
    </span>
  );
}
