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

export function hydrateExtensionBundlePreferences(bundle: ExtensionBundle): ExtensionBundle {
  const extName = bundle.extName || bundle.extensionName || '';
  const cmdName = bundle.cmdName || bundle.commandName || '';
  const extStored = extName ? readJsonObject(getExtPrefsKey(extName)) : {};
  const cmdStored = extName && cmdName ? readJsonObject(getCmdPrefsKey(extName, cmdName)) : {};
  const argStored =
    bundle.mode === 'no-view' && extName && cmdName
      ? readJsonObject(getCmdArgsKey(extName, cmdName))
      : {};
  return {
    ...bundle,
    preferences: {
      ...(bundle.preferences || {}),
      ...extStored,
      ...cmdStored,
    },
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

  const args = bundle.commandArgumentDefinitions || [];
  const hasArgs = args.length > 0;
  const missingArgs = getMissingRequiredArguments(bundle);

  if (bundle.mode === 'no-view') {
    // no-view commands have no UI to collect launch arguments at runtime.
    if (hasArgs) return true;
    return missingArgs.length > 0;
  }

  // View/menu-bar commands can collect optional inputs in their own UI.
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
