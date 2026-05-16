import type { CommandInfo, QuickLinkDynamicField } from '../../types/electron';

export const MAX_RECENT_SECTION_ITEMS = 5;
export const QUICK_LINK_COMMAND_PREFIX = 'quicklink-';
export const MAX_INLINE_EXTENSION_ARGUMENTS = 3;
export const MAX_INLINE_QUICK_LINK_ARGUMENTS = 3;
export const DIRECT_LAUNCH_EXPANSION_GUARD_MS = 700;
export const NOOP_ON_CLOSE = () => {};

export function getQuickLinkIdFromCommandId(commandId: string): string | null {
  const normalized = String(commandId || '').trim();
  if (!normalized.startsWith(QUICK_LINK_COMMAND_PREFIX)) return null;
  const id = normalized.slice(QUICK_LINK_COMMAND_PREFIX.length).trim();
  return id || null;
}

export function formatCalcKindLabel(kind: 'math' | 'unit' | 'currency' | 'crypto' | 'time' | 'date'): string {
  switch (kind) {
    case 'math':
      return 'Math';
    case 'unit':
      return 'Unit';
    case 'currency':
      return 'Currency';
    case 'crypto':
      return 'Crypto';
    case 'time':
      return 'Time';
    case 'date':
      return 'Date';
  }
}

export function normalizeQuickLinkDynamicFields(fields: QuickLinkDynamicField[]): QuickLinkDynamicField[] {
  const map = new Map<string, QuickLinkDynamicField>();
  for (const field of fields || []) {
    const rawKey = String(field?.key || field?.name || '').trim();
    if (!rawKey) continue;
    const normalizedKey = rawKey.toLowerCase();
    if (map.has(normalizedKey)) continue;
    map.set(normalizedKey, {
      key: rawKey,
      name: String(field?.name || rawKey),
      defaultValue: field?.defaultValue,
    });
  }
  return Array.from(map.values());
}

export function getExtensionIdentityFromCommand(
  command: CommandInfo | null | undefined
): { extName: string; cmdName: string } | null {
  if (!command || command.category !== 'extension' || !command.path) return null;
  const rawPath = String(command.path || '').trim();
  const separatorIndex = rawPath.indexOf('/');
  if (separatorIndex <= 0 || separatorIndex >= rawPath.length - 1) return null;
  const extName = rawPath.slice(0, separatorIndex).trim();
  const cmdName = rawPath.slice(separatorIndex + 1).trim();
  if (!extName || !cmdName) return null;
  return { extName, cmdName };
}

export function isEditableElement(element: Element | null): boolean {
  const target = element as HTMLElement | null;
  if (!target) return false;
  const tagName = String(target.tagName || '').toUpperCase();
  return (
    target.isContentEditable ||
    tagName === 'INPUT' ||
    tagName === 'TEXTAREA' ||
    tagName === 'SELECT'
  );
}
