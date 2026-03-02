/**
 * Action runtime keyboard helpers.
 *
 * Provides shortcut matching utilities and the keyboard shortcut renderer
 * used by action overlays and footer affordances.
 */

import React from 'react';
import type { ActionShortcut } from './action-runtime-types';

const shortcutBadgeClassName =
  'inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-[var(--kbd-bg)] text-[11px] text-[var(--text-subtle)] font-medium';

export function renderShortcutKeycap(label: string, key?: React.Key): React.ReactNode {
  return (
    <kbd key={key} className={shortcutBadgeClassName}>
      {label}
    </kbd>
  );
}

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
    <span className="flex items-center gap-1 ml-auto">
      {parts.map((symbol, index) => (
        renderShortcutKeycap(symbol, index)
      ))}
      {renderShortcutKeycap(shortcut.key.toUpperCase(), 'key')}
    </span>
  );
}
