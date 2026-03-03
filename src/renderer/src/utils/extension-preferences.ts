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

import type { ExtensionBundle, CommandInfo } from '../../types/electron';
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

export function writeJsonObject(key: string, value: Record<string, any>) {
  localStorage.setItem(key, JSON.stringify(value));
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
  const missingPrefs = getMissingRequiredPreferences(bundle);
  if (missingPrefs.length > 0) return true;

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

  writeJsonObject(extKey, extPrefs);
  writeJsonObject(cmdKey, cmdPrefs);
}

export function persistCommandArguments(extName: string, cmdName: string, values: Record<string, any>) {
  writeJsonObject(getCmdArgsKey(extName, cmdName), values);
}

export function clearCommandArguments(extName: string, cmdName: string) {
  try {
    localStorage.removeItem(getCmdArgsKey(extName, cmdName));
  } catch {
    // ignore storage failures
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
