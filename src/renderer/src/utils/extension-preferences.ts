/**
 * extension-preferences.ts
 *
 * localStorage helpers and preference hydration for Raycast-compatible extensions.
 * - readJsonObject / writeJsonObject: safe JSON read/write to localStorage
 * - Key builders: getExtPrefsKey, getCmdPrefsKey, getCmdArgsKey, getScriptCmdArgsKey, getMenuBarCommandKey
 * - hydrateExtensionBundlePreferences: merges stored prefs/args into an ExtensionBundle
 * - Missing-pref checks: getMissingRequiredPreferences, getMissingRequiredArguments,
 *   getMissingRequiredScriptArguments, getUnsetCriticalPreferences, shouldOpenCommandSetup
 * - Persist helpers: persistExtensionPreferences, persistCommandArguments, toScriptArgumentMapFromArray
 *
 * This module is the single source of truth for all preference/argument storage logic.
 * Import these helpers instead of reading localStorage directly.
 */

import type { ExtensionBundle, CommandInfo, ExtensionPreferencesSnapshot } from '../../types/electron';
import {
  EXT_PREFS_KEY_PREFIX,
  CMD_PREFS_KEY_PREFIX,
  CMD_ARGS_KEY_PREFIX,
  SCRIPT_CMD_ARGS_KEY_PREFIX,
  HIDDEN_MENUBAR_CMDS_KEY,
} from './constants';

export type PreferenceDefinition = NonNullable<ExtensionBundle['preferenceDefinitions']>[number];
export type ArgumentDefinition = NonNullable<ExtensionBundle['commandArgumentDefinitions']>[number];
export type ScriptArgumentDefinition = NonNullable<CommandInfo['commandArgumentDefinitions']>[number];

export function readJsonObject(key: string): Record<string, any> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeLocalJsonObject(key: string, value: Record<string, any>) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function writeJsonObject(key: string, value: Record<string, any>) {
  writeLocalJsonObject(key, value);
  // Mirror extension preferences and command arguments into the synced
  // settings.json so they propagate to other Macs. localStorage stays
  // the synchronous read cache; this is best-effort fire-and-forget.
  // Script-command args (sc-script-cmd-args:) and the hidden-menubar key
  // are intentionally not synced.
  syncExtensionStorageKeyToSettings(key, value);
}

function syncExtensionStorageKeyToSettings(key: string, value: Record<string, any>): void {
  try {
    if (key.startsWith(EXT_PREFS_KEY_PREFIX)) {
      const extName = key.slice(EXT_PREFS_KEY_PREFIX.length);
      if (!extName) return;
      void window.electron?.saveExtensionPreferences?.({ extName, extPrefs: value });
      return;
    }
    if (key.startsWith(CMD_PREFS_KEY_PREFIX)) {
      const slug = key.slice(CMD_PREFS_KEY_PREFIX.length);
      const slash = slug.indexOf('/');
      if (slash <= 0) return;
      const extName = slug.slice(0, slash);
      const cmdName = slug.slice(slash + 1);
      void window.electron?.saveExtensionPreferences?.({ extName, cmdName, cmdPrefs: value });
      return;
    }
    if (key.startsWith(CMD_ARGS_KEY_PREFIX)) {
      const slug = key.slice(CMD_ARGS_KEY_PREFIX.length);
      const slash = slug.indexOf('/');
      if (slash <= 0) return;
      const extName = slug.slice(0, slash);
      const cmdName = slug.slice(slash + 1);
      void window.electron?.saveExtensionCommandArguments?.({ extName, cmdName, values: value });
      return;
    }
  } catch {
    // best-effort — sync failure must not break local persistence
  }
}

export function collectLegacyExtensionPreferencesSnapshot(): ExtensionPreferencesSnapshot {
  const snapshot: ExtensionPreferencesSnapshot = {
    version: 1,
    extensions: {},
    commands: {},
  };

  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key) continue;
      if (key.startsWith(EXT_PREFS_KEY_PREFIX)) {
        const extName = key.slice(EXT_PREFS_KEY_PREFIX.length).trim();
        if (!extName) continue;
        const value = readJsonObject(key);
        if (Object.keys(value).length === 0) continue;
        snapshot.extensions[extName] = value;
        continue;
      }
      if (key.startsWith(CMD_PREFS_KEY_PREFIX)) {
        const commandKey = key.slice(CMD_PREFS_KEY_PREFIX.length).trim();
        if (!commandKey) continue;
        const value = readJsonObject(key);
        if (Object.keys(value).length === 0) continue;
        snapshot.commands[commandKey] = value;
      }
    }
  } catch {
    // best-effort migration only
  }

  return snapshot;
}

export function getMenuBarCommandKey(extName: string, cmdName: string): string {
  return `${(extName || '').trim().toLowerCase()}/${(cmdName || '').trim().toLowerCase()}`;
}

export function getExtPrefsKey(extName: string): string {
  return `${EXT_PREFS_KEY_PREFIX}${extName}`;
}

export function getCmdPrefsKey(extName: string, cmdName: string): string {
  return `${CMD_PREFS_KEY_PREFIX}${extName}/${cmdName}`;
}

export function getCmdArgsKey(extName: string, cmdName: string): string {
  return `${CMD_ARGS_KEY_PREFIX}${extName}/${cmdName}`;
}

export function getScriptCmdArgsKey(commandId: string): string {
  return `${SCRIPT_CMD_ARGS_KEY_PREFIX}${commandId}`;
}

export function getDefaultPreferenceValue(def: PreferenceDefinition): any {
  if (def.default !== undefined) return def.default;
  if (def.type === 'checkbox') return false;
  if (def.type === 'dropdown') return def.data?.[0]?.value ?? '';
  return '';
}

function deriveApplicationName(input: string): string {
  const raw = String(input || '').trim();
  if (!raw) return '';
  const lastSegment = raw.split('/').pop() || raw;
  const withoutExtension = lastSegment.replace(/\.app$/i, '');
  const bundleToken = withoutExtension.split('.').pop() || withoutExtension;
  const normalized = bundleToken.replace(/[-_]+/g, ' ').trim();
  return normalized || withoutExtension;
}

function normalizeAppPickerValue(value: any): any {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'object' && !Array.isArray(value)) {
    const path = typeof value.path === 'string' ? value.path.trim() : '';
    const bundleId = typeof value.bundleId === 'string' ? value.bundleId.trim() : '';
    const name =
      typeof value.name === 'string' && value.name.trim()
        ? value.name.trim()
        : deriveApplicationName(path || bundleId);
    if (!name && !path && !bundleId) return '';
    return {
      ...value,
      name,
      path,
      ...(bundleId ? { bundleId } : {}),
    };
  }

  const raw = String(value).trim();
  if (!raw) return '';
  const isPathLike = raw.startsWith('/') || raw.endsWith('.app');
  return {
    name: deriveApplicationName(raw),
    path: isPathLike ? raw : '',
    ...(isPathLike ? {} : { bundleId: raw }),
  };
}

export function normalizePreferenceValue(def: PreferenceDefinition, value: any): any {
  const type = String(def.type || 'textfield');
  if (value === undefined || value === null) return getDefaultPreferenceValue(def);

  if (type === 'checkbox') {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true') return true;
      if (normalized === 'false') return false;
    }
    return getDefaultPreferenceValue(def);
  }

  if (type === 'dropdown') {
    const normalized = typeof value === 'string' ? value.trim() : String(value).trim();
    const options = Array.isArray(def.data)
      ? def.data
          .map((option) => {
            if (!option || typeof option !== 'object') return null;
            return {
              value: String((option as any).value ?? '').trim(),
              title: String((option as any).title ?? '').trim(),
            };
          })
          .filter(Boolean) as Array<{ value: string; title: string }>
      : [];
    if (options.length === 0) return normalized;

    const directMatch = options.find((option) => option.value === normalized);
    if (directMatch) return directMatch.value;

    const titleMatch = options.find((option) => option.title === normalized);
    if (titleMatch) return titleMatch.value;

    const caseInsensitiveTitleMatch = options.find((option) => option.title.toLowerCase() === normalized.toLowerCase());
    if (caseInsensitiveTitleMatch) return caseInsensitiveTitleMatch.value;

    return getDefaultPreferenceValue(def);
  }

  if (type === 'appPicker') {
    return normalizeAppPickerValue(value);
  }

  if (type === 'textfield' || type === 'password' || type === 'file' || type === 'directory') {
    return typeof value === 'string' ? value : String(value);
  }

  return value;
}

export function hydrateStoredPreferenceValues(
  baseValues: Record<string, any>,
  defs: PreferenceDefinition[],
  storedValues: Record<string, any>
): Record<string, any> {
  const next = {
    ...baseValues,
    ...storedValues,
  };

  for (const def of defs) {
    if (!def?.name) continue;
    if (!Object.prototype.hasOwnProperty.call(storedValues, def.name)) continue;
    next[def.name] = normalizePreferenceValue(def, storedValues[def.name]);
  }

  return next;
}

export function hydrateExtensionBundlePreferences(bundle: ExtensionBundle): ExtensionBundle {
  const extName = bundle.extName || bundle.extensionName || '';
  const cmdName = bundle.cmdName || bundle.commandName || '';
  const extStored = extName ? readJsonObject(getExtPrefsKey(extName)) : {};
  const cmdStored = extName && cmdName ? readJsonObject(getCmdPrefsKey(extName, cmdName)) : {};
  const argStored =
    bundle.mode === 'no-view' && extName && cmdName
      ? readJsonObject(getCmdArgsKey(extName, cmdName))
      : {};
  const defs = bundle.preferenceDefinitions || [];
  const extensionDefs = defs.filter((def) => def?.scope !== 'command');
  const commandDefs = defs.filter((def) => def?.scope === 'command');
  const normalizedPreferences = hydrateStoredPreferenceValues(
    hydrateStoredPreferenceValues(bundle.preferences || {}, extensionDefs, extStored),
    commandDefs,
    cmdStored
  );

  return {
    ...bundle,
    preferences: normalizedPreferences,
    launchArguments: {
      ...(bundle as any).launchArguments,
      ...argStored,
    } as any,
  };
}

export function isMissingPreferenceValue(def: PreferenceDefinition, value: any): boolean {
  if (!def.required) return false;
  if (def.type === 'checkbox') return value === undefined || value === null;
  if (typeof value === 'string') return value.trim() === '';
  return value === undefined || value === null;
}

export function getMissingRequiredPreferences(bundle: ExtensionBundle, values?: Record<string, any>): PreferenceDefinition[] {
  const defs = bundle.preferenceDefinitions || [];
  const prefs = values || bundle.preferences || {};
  return defs.filter((def) => isMissingPreferenceValue(def, prefs[def.name]));
}

export function isMissingArgumentValue(def: ArgumentDefinition, value: any): boolean {
  if (!def.required) return false;
  if (typeof value === 'string') return value.trim() === '';
  return value === undefined || value === null;
}

export function getMissingRequiredArguments(bundle: ExtensionBundle, values?: Record<string, any>): ArgumentDefinition[] {
  const defs = bundle.commandArgumentDefinitions || [];
  const args = values || (bundle as any).launchArguments || {};
  return defs.filter((def) => isMissingArgumentValue(def, args[def.name]));
}

export function getUnsetCriticalPreferences(bundle: ExtensionBundle, values?: Record<string, any>): PreferenceDefinition[] {
  const defs = bundle.preferenceDefinitions || [];
  const prefs = values || bundle.preferences || {};
  const criticalName = /(api[-_ ]?key|token|secret|namespace|binary|protocol|preset)/i;
  return defs.filter((def) => {
    const type = (def.type || '').toLowerCase();
    if (type !== 'textfield' && type !== 'password' && type !== 'dropdown') return false;
    const v = prefs[def.name];
    const empty = (typeof v === 'string' ? v.trim() === '' : v === undefined || v === null);
    if (!empty) return false;
    return Boolean(def.required) || criticalName.test(def.name || '') || criticalName.test(def.title || '');
  });
}

export function shouldOpenCommandSetup(bundle: ExtensionBundle): boolean {
  const defs = bundle.preferenceDefinitions || [];
  const requiredDefs = defs.filter((def) => def?.required);
  if (requiredDefs.length > 0) {
    const extName = bundle.extName || bundle.extensionName || '';
    const cmdName = bundle.cmdName || bundle.commandName || '';
    const extStored = extName ? readJsonObject(getExtPrefsKey(extName)) : {};
    const cmdStored = extName && cmdName ? readJsonObject(getCmdPrefsKey(extName, cmdName)) : {};
    for (const def of requiredDefs) {
      const stored = def.scope === 'command' ? cmdStored : extStored;
      const hasStoredValue = Object.prototype.hasOwnProperty.call(stored, def.name);
      if (!hasStoredValue) return true;
      if (isMissingPreferenceValue(def, stored[def.name])) return true;
    }
  }

  const missingArgs = getMissingRequiredArguments(bundle);
  // Any required argument that is still missing blocks launch.
  // Optional arguments are handled inline at launch time.
  return missingArgs.length > 0;
}

export function persistExtensionPreferences(
  extName: string,
  cmdName: string,
  defs: PreferenceDefinition[],
  values: Record<string, any>
) {
  const extKey = getExtPrefsKey(extName);
  const cmdKey = getCmdPrefsKey(extName, cmdName);
  const extPrefs = readJsonObject(extKey);
  const cmdPrefs = readJsonObject(cmdKey);

  for (const def of defs) {
    if (!def?.name) continue;
    if (def.scope === 'command') {
      cmdPrefs[def.name] = values[def.name];
    } else {
      extPrefs[def.name] = values[def.name];
    }
  }

  // writeJsonObject mirrors both writes into synced settings.
  writeJsonObject(extKey, extPrefs);
  writeJsonObject(cmdKey, cmdPrefs);
}

export function persistCommandArguments(extName: string, cmdName: string, values: Record<string, any>) {
  // writeJsonObject mirrors the write into synced settings.
  writeJsonObject(getCmdArgsKey(extName, cmdName), values);
}

export function clearCommandArguments(extName: string, cmdName: string) {
  try {
    localStorage.removeItem(getCmdArgsKey(extName, cmdName));
  } catch {
    // ignore storage failures
  }
  try {
    // Write an empty payload rather than deleting: hydrate uses absent
    // keys to mean "not authoritatively set in this payload" and would
    // skip them, leaving stale args on other Macs. Empty `{}` is the
    // in-band sentinel for "cleared".
    void window.electron?.saveExtensionCommandArguments?.({ extName, cmdName, values: {} });
  } catch {
    // ignore — sync is best-effort
  }
}

export function getMissingRequiredScriptArguments(
  command: CommandInfo,
  values?: Record<string, any>
): ScriptArgumentDefinition[] {
  const defs = command.commandArgumentDefinitions || [];
  const current = values || {};
  return defs.filter((def) => {
    if (!def?.required) return false;
    const value = current[def.name];
    if (typeof value === 'string') return value.trim() === '';
    return value === undefined || value === null;
  });
}

export function toScriptArgumentMapFromArray(
  command: CommandInfo,
  args: string[]
): Record<string, any> {
  const defs = (command.commandArgumentDefinitions || []).slice().sort((a, b) => {
    const ai = Number(String(a.name || '').replace(/[^\d]/g, '')) || 0;
    const bi = Number(String(b.name || '').replace(/[^\d]/g, '')) || 0;
    return ai - bi;
  });
  const out: Record<string, any> = {};
  defs.forEach((def, idx) => {
    out[def.name] = String(args[idx] ?? '');
  });
  return out;
}

export function getHiddenMenuBarCommands(): Record<string, any> {
  return readJsonObject(HIDDEN_MENUBAR_CMDS_KEY);
}

export function setHiddenMenuBarCommands(value: Record<string, any>) {
  writeJsonObject(HIDDEN_MENUBAR_CMDS_KEY, value);
}

// ─── Sync between localStorage and synced settings.json ──────────
// Extension preferences and command arguments are mirrored into the
// synced settings file so they propagate across Macs. localStorage
// remains the synchronous read cache used by getPreferenceValues();
// the helpers below keep the two in sync.

const EXTENSION_PREFS_MIGRATION_FLAG = 'sc-extension-prefs-migrated-v1';

interface ExtensionStorageMap {
  [key: string]: Record<string, unknown> | undefined;
}

interface SyncedExtensionStorage {
  extensionPreferences?: ExtensionStorageMap;
  extensionCommandPreferences?: ExtensionStorageMap;
  extensionCommandArguments?: ExtensionStorageMap;
}

function emitStorageChangedFor(extensionName: string): void {
  if (!extensionName) return;
  try {
    window.dispatchEvent(
      new CustomEvent('sc-extension-storage-changed', { detail: { extensionName } })
    );
  } catch {
    // best-effort
  }
}

function areJsonValuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!areJsonValuesEqual(a[i], b[i])) return false;
    }
    return true;
  }

  if (typeof a === 'object' && typeof b === 'object') {
    const aObject = a as Record<string, unknown>;
    const bObject = b as Record<string, unknown>;
    const aKeys = Object.keys(aObject);
    const bKeys = Object.keys(bObject);
    if (aKeys.length !== bKeys.length) return false;
    for (const key of aKeys) {
      if (!Object.prototype.hasOwnProperty.call(bObject, key)) return false;
      if (!areJsonValuesEqual(aObject[key], bObject[key])) return false;
    }
    return true;
  }

  return false;
}

/**
 * One-shot per machine: walk localStorage for existing extension prefs /
 * args and push them up to the synced settings file. Idempotent — gated
 * by EXTENSION_PREFS_MIGRATION_FLAG. Safe to call on every app start.
 */
export async function migrateExtensionPreferencesFromLocalStorage(): Promise<void> {
  try {
    if (localStorage.getItem(EXTENSION_PREFS_MIGRATION_FLAG)) return;
  } catch {
    return;
  }

  const extPrefsByExt = new Map<string, Record<string, unknown>>();
  const cmdPrefsByExtCmd = new Map<string, { extName: string; cmdName: string; cmdPrefs: Record<string, unknown> }>();
  const cmdArgsByExtCmd = new Map<string, { extName: string; cmdName: string; values: Record<string, unknown> }>();

  let keyCount = 0;
  try {
    keyCount = localStorage.length;
  } catch {
    return;
  }

  for (let i = 0; i < keyCount; i += 1) {
    const key = (() => {
      try { return localStorage.key(i); } catch { return null; }
    })();
    if (!key) continue;

    if (key.startsWith(EXT_PREFS_KEY_PREFIX)) {
      const extName = key.slice(EXT_PREFS_KEY_PREFIX.length);
      if (!extName) continue;
      const value = readJsonObject(key);
      if (Object.keys(value).length > 0) extPrefsByExt.set(extName, value);
    } else if (key.startsWith(CMD_PREFS_KEY_PREFIX)) {
      const slug = key.slice(CMD_PREFS_KEY_PREFIX.length);
      const slash = slug.indexOf('/');
      if (slash <= 0) continue;
      const extName = slug.slice(0, slash);
      const cmdName = slug.slice(slash + 1);
      const value = readJsonObject(key);
      if (Object.keys(value).length > 0) {
        cmdPrefsByExtCmd.set(slug, { extName, cmdName, cmdPrefs: value });
      }
    } else if (key.startsWith(CMD_ARGS_KEY_PREFIX)) {
      const slug = key.slice(CMD_ARGS_KEY_PREFIX.length);
      const slash = slug.indexOf('/');
      if (slash <= 0) continue;
      const extName = slug.slice(0, slash);
      const cmdName = slug.slice(slash + 1);
      const value = readJsonObject(key);
      if (Object.keys(value).length > 0) {
        cmdArgsByExtCmd.set(slug, { extName, cmdName, values: value });
      }
    }
  }

  // Push to main. Errors are non-fatal — we still mark migrated to avoid
  // re-running on every boot if main is briefly unavailable.
  try {
    for (const [extName, extPrefs] of extPrefsByExt.entries()) {
      await window.electron?.saveExtensionPreferences?.({ extName, extPrefs });
    }
    for (const { extName, cmdName, cmdPrefs } of cmdPrefsByExtCmd.values()) {
      await window.electron?.saveExtensionPreferences?.({ extName, cmdName, cmdPrefs });
    }
    for (const { extName, cmdName, values } of cmdArgsByExtCmd.values()) {
      await window.electron?.saveExtensionCommandArguments?.({ extName, cmdName, values });
    }
  } catch (e) {
    console.warn('extension-preferences migration: IPC failure (non-fatal):', e);
  }

  try {
    localStorage.setItem(EXTENSION_PREFS_MIGRATION_FLAG, '1');
  } catch {
    // ignore
  }
}

/**
 * Hydrate localStorage from the synced settings. Called at app boot and
 * on every settings-updated broadcast (which fires both for in-app saves
 * and for external sync changes).
 *
 * Empty strings are kept as authoritative values: they're how text,
 * password, file, and directory preferences (and command arguments)
 * represent a cleared field. Skipping them would mean a clear on one
 * Mac never propagates to others. `undefined` and `null` are still
 * skipped — those mean "key not authoritatively set in this payload",
 * not "explicitly cleared".
 *
 * Hydration treats settings as the source of truth and updates only the
 * renderer cache. Writing back through sync here can echo our own
 * settings-updated broadcast and create a save/broadcast loop.
 */
export function hydrateExtensionPreferencesFromSettings(settings: SyncedExtensionStorage | null | undefined): void {
  if (!settings) return;
  const touchedExts = new Set<string>();

  const extPrefs = settings.extensionPreferences || {};
  for (const [extName, payload] of Object.entries(extPrefs)) {
    if (!payload || typeof payload !== 'object') continue;
    if (Object.keys(payload).length === 0) continue;
    const existing = readJsonObject(getExtPrefsKey(extName));
    let changed = false;
    for (const [k, v] of Object.entries(payload)) {
      if (v === undefined || v === null) continue;
      if (!areJsonValuesEqual(existing[k], v)) {
        existing[k] = v;
        changed = true;
      }
    }
    if (changed) {
      writeLocalJsonObject(getExtPrefsKey(extName), existing);
      touchedExts.add(extName);
    }
  }

  const cmdPrefs = settings.extensionCommandPreferences || {};
  for (const [slug, payload] of Object.entries(cmdPrefs)) {
    if (!payload || typeof payload !== 'object') continue;
    if (Object.keys(payload).length === 0) continue;
    const slash = slug.indexOf('/');
    if (slash <= 0) continue;
    const extName = slug.slice(0, slash);
    const cmdName = slug.slice(slash + 1);
    const existing = readJsonObject(getCmdPrefsKey(extName, cmdName));
    let changed = false;
    for (const [k, v] of Object.entries(payload)) {
      if (v === undefined || v === null) continue;
      if (!areJsonValuesEqual(existing[k], v)) {
        existing[k] = v;
        changed = true;
      }
    }
    if (changed) {
      writeLocalJsonObject(getCmdPrefsKey(extName, cmdName), existing);
      touchedExts.add(extName);
    }
  }

  const cmdArgs = settings.extensionCommandArguments || {};
  for (const [slug, payload] of Object.entries(cmdArgs)) {
    if (!payload || typeof payload !== 'object') continue;
    const slash = slug.indexOf('/');
    if (slash <= 0) continue;
    const extName = slug.slice(0, slash);
    const cmdName = slug.slice(slash + 1);
    const cmdArgsKey = getCmdArgsKey(extName, cmdName);
    // Empty payload is the synced "cleared" sentinel — drop the local
    // entry so a clear on another Mac propagates here.
    if (Object.keys(payload).length === 0) {
      const existing = readJsonObject(cmdArgsKey);
      if (Object.keys(existing).length > 0) {
        try { localStorage.removeItem(cmdArgsKey); } catch { /* ignore */ }
        touchedExts.add(extName);
      }
      continue;
    }
    const existing = readJsonObject(cmdArgsKey);
    let changed = false;
    for (const [k, v] of Object.entries(payload)) {
      if (v === undefined || v === null) continue;
      if (!areJsonValuesEqual(existing[k], v)) {
        existing[k] = v;
        changed = true;
      }
    }
    if (changed) {
      writeLocalJsonObject(cmdArgsKey, existing);
      touchedExts.add(extName);
    }
  }

  for (const extName of touchedExts) emitStorageChangedFor(extName);
}
