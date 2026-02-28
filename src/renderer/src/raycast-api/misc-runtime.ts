/**
 * raycast-api/misc-runtime.ts
 * Purpose: Preference/deeplink helpers and command metadata runtime exports.
 */

import { getExtensionContext, type LaunchType } from './index';
import { getCurrentScopedExtensionContext } from './context-scope-runtime';

export interface PreferenceValues {
  [name: string]: any;
}

export interface Preference {
  name: string;
  type: 'appPicker' | 'checkbox' | 'dropdown' | 'password' | 'textfield' | 'file' | 'directory';
  required: boolean;
  title: string;
  description: string;
  value?: unknown;
  default?: unknown;
  placeholder?: string;
  label?: string;
  data?: unknown[];
}

/** @deprecated Use getPreferenceValues instead. */
export type Preferences = { [name: string]: Preference };

/** @deprecated Use getPreferenceValues instead. */
export const preferences: Preferences = new Proxy({} as Preferences, {
  get(_target, prop: string) {
    const ctx = getCurrentScopedExtensionContext();
    const contextPrefs = (ctx.preferences || {}) as Record<string, any>;
    const extName = String(ctx.extensionName || '').trim();
    const cmdName = String(ctx.commandName || '').trim();

    const readStoredPrefs = (key: string): Record<string, any> => {
      if (!key) return {};
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
      } catch {
        return {};
      }
    };

    const extStored = extName ? readStoredPrefs(`sc-ext-prefs:${extName}`) : {};
    const cmdStored = extName && cmdName ? readStoredPrefs(`sc-ext-cmd-prefs:${extName}/${cmdName}`) : {};
    const stored = { ...extStored, ...cmdStored };
    const contextValue = contextPrefs[prop];
    const val = contextValue === undefined || contextValue === null || (typeof contextValue === 'string' && contextValue.trim() === '')
      ? stored[prop]
      : contextValue;

    return { name: prop, type: 'textfield', required: false, title: prop, description: '', value: val } as Preference;
  },
});

export type LaunchContext = Record<string, any>;
export type Application = { name: string; path: string; bundleId?: string; localizedName?: string };
export type FileSystemItem = { path: string };

export interface LaunchOptions {
  name: string;
  type: LaunchType;
  arguments?: Record<string, any> | null;
  context?: LaunchContext | null;
  fallbackText?: string | null;
  extensionName?: string;
  ownerOrAuthorName?: string;
}

export async function updateCommandMetadata(metadata: { subtitle?: string | null }): Promise<void> {
  const electron = (window as any).electron;
  const ctx = getExtensionContext();
  const commandId = `${ctx.extensionName}/${ctx.commandName}`;

  try {
    if (electron?.updateCommandMetadata) {
      await electron.updateCommandMetadata(commandId, metadata);
    } else {
      console.warn('updateCommandMetadata not available');
    }
  } catch (error) {
    console.error('Failed to update command metadata:', error);
    throw error;
  }
}

export enum DeeplinkType {
  Extension = 'extension',
  ScriptCommand = 'scriptCommand',
}

interface CreateDeeplinkExtensionOptions {
  type?: DeeplinkType.Extension;
  command: string;
  launchType?: LaunchType;
  arguments?: Record<string, string>;
  fallbackText?: string;
}

interface CreateDeeplinkExternalExtensionOptions extends CreateDeeplinkExtensionOptions {
  ownerOrAuthorName: string;
  extensionName: string;
}

interface CreateDeeplinkScriptCommandOptions {
  type: DeeplinkType.ScriptCommand;
  command: string;
  arguments?: string[];
}

export function createDeeplink(
  options: CreateDeeplinkExtensionOptions | CreateDeeplinkExternalExtensionOptions | CreateDeeplinkScriptCommandOptions
): string {
  if (options.type === DeeplinkType.ScriptCommand) {
    const params = new URLSearchParams();
    if (options.arguments?.length) {
      for (const arg of options.arguments) params.append('arguments', arg);
    }
    const qs = params.toString();
    return `raycast://script-commands/${encodeURIComponent(options.command)}${qs ? `?${qs}` : ''}`;
  }

  const ctx = getExtensionContext();
  const extOpts = options as CreateDeeplinkExternalExtensionOptions;
  const owner = extOpts.ownerOrAuthorName || ctx.owner || '';
  const extName = extOpts.extensionName || ctx.extensionName || '';

  const params = new URLSearchParams();
  if (options.launchType) params.set('launchType', options.launchType);
  if (options.arguments && Object.keys(options.arguments).length > 0) {
    params.set('arguments', JSON.stringify(options.arguments));
  }
  if ((options as CreateDeeplinkExtensionOptions).fallbackText) {
    params.set('fallbackText', (options as CreateDeeplinkExtensionOptions).fallbackText!);
  }

  const qs = params.toString();
  return `raycast://extensions/${encodeURIComponent(owner)}/${encodeURIComponent(extName)}/${encodeURIComponent(options.command)}${qs ? `?${qs}` : ''}`;
}
