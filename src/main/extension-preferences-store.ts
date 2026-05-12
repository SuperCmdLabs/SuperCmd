import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

type PreferenceMap = Record<string, any>;

interface ExtensionPreferencesStoreData {
  version: 1;
  extensions: Record<string, PreferenceMap>;
  commands: Record<string, PreferenceMap>;
}

const DEFAULT_STORE: ExtensionPreferencesStoreData = {
  version: 1,
  extensions: {},
  commands: {},
};

let cache: ExtensionPreferencesStoreData | null = null;

function getStorePath(): string {
  return path.join(app.getPath('userData'), 'extension-preferences.json');
}

function normalizePreferenceMap(value: unknown): PreferenceMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return { ...(value as Record<string, any>) };
}

function normalizeStore(value: unknown): ExtensionPreferencesStoreData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_STORE, extensions: {}, commands: {} };
  }
  const parsed = value as Partial<ExtensionPreferencesStoreData>;
  const extensions: Record<string, PreferenceMap> = {};
  const commands: Record<string, PreferenceMap> = {};

  for (const [key, entry] of Object.entries(parsed.extensions || {})) {
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey) continue;
    extensions[normalizedKey] = normalizePreferenceMap(entry);
  }
  for (const [key, entry] of Object.entries(parsed.commands || {})) {
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey) continue;
    commands[normalizedKey] = normalizePreferenceMap(entry);
  }

  return {
    version: 1,
    extensions,
    commands,
  };
}

function loadStore(): ExtensionPreferencesStoreData {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(getStorePath(), 'utf8');
    cache = normalizeStore(JSON.parse(raw));
  } catch {
    cache = normalizeStore(DEFAULT_STORE);
  }
  return cache;
}

function saveStore(next: ExtensionPreferencesStoreData): void {
  cache = next;
  fs.writeFileSync(getStorePath(), JSON.stringify(next, null, 2), 'utf8');
}

function getCommandKey(extName: string, cmdName: string): string {
  return `${extName}/${cmdName}`;
}

export function getExtensionPreferencesSnapshot(): ExtensionPreferencesStoreData {
  const store = loadStore();
  return {
    version: 1,
    extensions: { ...store.extensions },
    commands: { ...store.commands },
  };
}

export function getExtensionPreferences(extName: string, cmdName?: string): PreferenceMap {
  const store = loadStore();
  const normalizedExtName = String(extName || '').trim();
  if (!normalizedExtName) return {};
  if (cmdName) {
    const normalizedCmdName = String(cmdName || '').trim();
    if (!normalizedCmdName) return {};
    return { ...(store.commands[getCommandKey(normalizedExtName, normalizedCmdName)] || {}) };
  }
  return { ...(store.extensions[normalizedExtName] || {}) };
}

export function setExtensionPreferences(extName: string, values: PreferenceMap, cmdName?: string): PreferenceMap {
  const store = loadStore();
  const normalizedExtName = String(extName || '').trim();
  if (!normalizedExtName) return {};
  const normalizedValues = normalizePreferenceMap(values);

  if (cmdName) {
    const normalizedCmdName = String(cmdName || '').trim();
    if (!normalizedCmdName) return {};
    store.commands[getCommandKey(normalizedExtName, normalizedCmdName)] = normalizedValues;
  } else {
    store.extensions[normalizedExtName] = normalizedValues;
  }

  saveStore(store);
  return { ...normalizedValues };
}

export function setExtensionPreferenceValue(
  extName: string,
  preferenceName: string,
  value: any,
  cmdName?: string
): PreferenceMap {
  const current = getExtensionPreferences(extName, cmdName);
  current[String(preferenceName || '').trim()] = value;
  return setExtensionPreferences(extName, current, cmdName);
}

export function mergeExtensionPreferencesSnapshot(snapshot: Partial<ExtensionPreferencesStoreData>): ExtensionPreferencesStoreData {
  const store = loadStore();
  const normalized = normalizeStore(snapshot);

  for (const [extName, values] of Object.entries(normalized.extensions)) {
    store.extensions[extName] = {
      ...values,
      ...(store.extensions[extName] || {}),
    };
  }
  for (const [commandKey, values] of Object.entries(normalized.commands)) {
    store.commands[commandKey] = {
      ...values,
      ...(store.commands[commandKey] || {}),
    };
  }

  saveStore(store);
  return getExtensionPreferencesSnapshot();
}
