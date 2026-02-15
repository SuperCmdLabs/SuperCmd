/**
 * @raycast/api + @raycast/utils — Complete Compatibility Shim
 *
 * This module provides a comprehensive compatibility layer for Raycast
 * extensions running inside SuperCmd. It implements ALL the APIs
 * documented at https://developers.raycast.com/api-reference/
 *
 * EXPORTS (from @raycast/api):
 *   Components: List, Detail, Form, Grid, ActionPanel, Action, MenuBarExtra
 *   Hooks: useNavigation
 *   Functions: showToast, showHUD, confirmAlert, open, closeMainWindow,
 *              popToRoot, launchCommand, getSelectedText, getSelectedFinderItems,
 *              getApplications, getFrontmostApplication, trash,
 *              openExtensionPreferences, openCommandPreferences
 *   Objects: environment, Clipboard, LocalStorage, Cache, Toast, Icon, Color,
 *            Image, Keyboard, AI, LaunchType
 *
 * EXPORTS (from @raycast/utils — same module, extensions import from both):
 *   Hooks: useFetch, useCachedPromise, useCachedState, usePromise, useForm,
 *          useExec, useSQL, useStreamJSON, useAI, useFrecencySorting,
 *          useLocalStorage
 *   Functions: getFavicon, getAvatarIcon, getProgressIcon, runAppleScript,
 *             showFailureToast, executeSQL, createDeeplink, withCache
 */

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  createContext,
  useContext,
} from 'react';
import { configureIconRuntime, Icon, Color, Image, Keyboard, renderIcon, resolveIconSrc } from './icon-runtime';
import { isEmojiOrSymbol } from './icon-runtime-assets';
import { configureOAuthRuntime, OAuth, OAuthService, withAccessToken, getAccessToken, resetAccessToken } from './oauth';
import {
  preferences,
  updateCommandMetadata,
  DeeplinkType,
  createDeeplink,
} from './misc-runtime';
import { getFavicon, getAvatarIcon, getProgressIcon, runAppleScript, showFailureToast } from './utility-runtime';
import { useCachedState } from './hooks/use-cached-state';
import { FormValidation, useForm } from './hooks/use-form';
import { usePromise } from './hooks/use-promise';
import { useFetch } from './hooks/use-fetch';
import { useCachedPromise } from './hooks/use-cached-promise';
import { useExec } from './hooks/use-exec';
import { useSQL } from './hooks/use-sql';
import { useStreamJSON } from './hooks/use-stream-json';
import { useAI } from './hooks/use-ai';
import { useFrecencySorting } from './hooks/use-frecency-sorting';
import { useLocalStorage } from './hooks/use-local-storage';
import { configureStorageEvents, emitExtensionStorageChanged } from './storage-events';
import { configureContextScopeRuntime, snapshotExtensionContext, withExtensionContext } from './context-scope-runtime';
import type {
  PreferenceValues,
  Preference,
  Preferences,
  LaunchContext,
  Application,
  FileSystemItem,
  LaunchOptions,
} from './misc-runtime';
import {
  WindowManagement,
  WindowManagementDesktopType,
  type WindowManagementWindow,
  type WindowManagementDesktop,
  type WindowManagementSetWindowBoundsOptions,
  BrowserExtension,
  executeSQL,
  withCache,
} from './platform-runtime';
import type { Tool } from './platform-runtime';

export { Icon, Color, Image, Keyboard, renderIcon };
export { OAuth, OAuthService, withAccessToken, getAccessToken, resetAccessToken };
export { getFavicon, getAvatarIcon, getProgressIcon, runAppleScript, showFailureToast };
export { usePromise, useFetch, useCachedPromise, useExec, useSQL };
export { useCachedState, FormValidation, useForm, useStreamJSON, useAI, useFrecencySorting, useLocalStorage };
export { emitExtensionStorageChanged };
export {
  WindowManagement,
  WindowManagementDesktopType,
  BrowserExtension,
  executeSQL,
  withCache,
};
export type {
  WindowManagementWindow,
  WindowManagementDesktop,
  WindowManagementSetWindowBoundsOptions,
  Tool,
};
export type {
  PreferenceValues,
  Preference,
  Preferences,
  LaunchContext,
  Application,
  FileSystemItem,
  LaunchOptions,
} from './misc-runtime';
export { preferences, updateCommandMetadata, DeeplinkType, createDeeplink };

// =====================================================================
// ─── Extension Context (set by ExtensionView) ───────────────────────
// =====================================================================

export interface ExtensionContextType {
  extensionName: string;
  extensionDisplayName?: string;
  extensionIconDataUrl?: string;
  commandName: string;
  assetsPath: string;
  supportPath: string;
  owner: string;
  preferences: Record<string, any>;
  commandMode: 'view' | 'no-view' | 'menu-bar';
}

let _extensionContext: ExtensionContextType = {
  extensionName: '',
  extensionDisplayName: '',
  extensionIconDataUrl: '',
  commandName: '',
  assetsPath: '',
  supportPath: '/tmp/supercmd',
  owner: '',
  preferences: {},
  commandMode: 'view',
};

export function setExtensionContext(ctx: ExtensionContextType) {
  _extensionContext = ctx;
  // Also update environment object
  environment.extensionName = ctx.extensionName;
  environment.commandName = ctx.commandName;
  environment.commandMode = ctx.commandMode;
  environment.assetsPath = ctx.assetsPath;
  environment.supportPath = ctx.supportPath;
  environment.ownerOrAuthorName = ctx.owner;
}

export function getExtensionContext(): ExtensionContextType {
  return _extensionContext;
}

configureIconRuntime({ getExtensionContext });
configureOAuthRuntime({ getExtensionContext, open, resolveIconSrc });
configureStorageEvents({ getExtensionContext });
configureContextScopeRuntime({ getExtensionContext, setExtensionContext });

// ─── Per-Extension React Context (for concurrent extensions like menu-bar) ──
// The global _extensionContext is a singleton and races when multiple
// extensions render simultaneously. This React context lets each extension
// subtree see its own info.

export const ExtensionInfoReactContext = createContext<{
  extId: string;
  assetsPath: string;
  commandMode: 'view' | 'no-view' | 'menu-bar';
  extensionDisplayName?: string;
  extensionIconDataUrl?: string;
}>({ extId: '', assetsPath: '', commandMode: 'view', extensionDisplayName: '', extensionIconDataUrl: '' });

// =====================================================================
// ─── Navigation Context ─────────────────────────────────────────────
// =====================================================================

interface NavigationCtx {
  push: (element: React.ReactElement) => void;
  pop: () => void;
  popToRoot?: () => void;
}

export const NavigationContext = createContext<NavigationCtx>({
  push: () => {},
  pop: () => {},
  popToRoot: () => {},
});

// Global ref for navigation (used by executePrimaryAction for Action.Push)
let _globalNavigation: NavigationCtx = { push: () => {}, pop: () => {}, popToRoot: () => {} };

export function setGlobalNavigation(nav: NavigationCtx) {
  _globalNavigation = nav;
}

export function getGlobalNavigation(): NavigationCtx {
  return _globalNavigation;
}

export function useNavigation() {
  const ctx = useContext(NavigationContext);
  // Also update global ref so it's available for executePrimaryAction
  _globalNavigation = ctx;
  return ctx;
}

// =====================================================================
// ─── LaunchType Enum ────────────────────────────────────────────────
// =====================================================================

export enum LaunchType {
  UserInitiated = 'userInitiated',
  Background = 'background',
}

// Forward-declared AI availability cache (set asynchronously in the AI section below)
let _aiAvailableCache: boolean | null = null;

// =====================================================================
// ─── Environment ────────────────────────────────────────────────────
// =====================================================================

export const environment: Record<string, any> = {
  isDevelopment: false,
  extensionName: '',
  commandName: '',
  commandMode: 'view',
  assetsPath: '',
  supportPath: '/tmp/supercmd',
  raycastVersion: '1.80.0',
  ownerOrAuthorName: '',
  launchType: LaunchType.UserInitiated,
  textSize: 'medium',
  appearance: 'dark',
  theme: { name: 'dark' },
  canAccess: (resource?: any) => {
    // If checking AI access, use the cached availability
    // Extensions call: environment.canAccess(AI) — the AI object has a Model property
    if (resource && resource.Model && resource.ask) {
      return _aiAvailableCache ?? false;
    }
    return true;
  },
};

// Force dark mode as the default extension theme.
if (typeof document !== 'undefined') {
  document.documentElement.classList.add('dark');
  document.documentElement.style.colorScheme = 'dark';
}

// =====================================================================
// ─── Alert Types (defined before Toast since Toast references Alert) ──
// =====================================================================

export namespace Alert {
  export enum ActionStyle {
    Default = 'default',
    Cancel = 'cancel',
    Destructive = 'destructive',
  }

  export interface ActionOptions {
    title: string;
    onAction?: () => void;
    style?: ActionStyle;
  }

  export interface Options {
    title: string;
    message?: string;
    icon?: any;
    primaryAction?: ActionOptions;
    dismissAction?: ActionOptions;
    rememberUserChoice?: boolean;
  }
}

// =====================================================================
// ─── Toast ──────────────────────────────────────────────────────────
// =====================================================================

export enum ToastStyle {
  Animated = 'animated',
  Success = 'success',
  Failure = 'failure',
}

export class Toast {
  static Style = ToastStyle;

  public title: string = '';
  public message?: string;
  public style: ToastStyle = ToastStyle.Success;
  public primaryAction?: Alert.ActionOptions;
  public secondaryAction?: Alert.ActionOptions;

  private _el: HTMLDivElement | null = null;
  private _timer: any = null;

  constructor(options: Toast.Options) {
    this.style = options.style as ToastStyle || ToastStyle.Success;
    this.title = options.title || '';
    this.message = options.message;
    this.primaryAction = options.primaryAction;
    this.secondaryAction = options.secondaryAction;
  }

  show() {
    this.hide(); // clear any existing
    this._el = document.createElement('div');
    const styleColor =
      this.style === ToastStyle.Failure ? 'rgba(255,60,60,0.85)' :
      this.style === ToastStyle.Animated ? 'rgba(60,60,255,0.85)' :
      'rgba(40,180,80,0.85)';

    this._el.style.cssText =
      'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);' +
      'padding:8px 16px;border-radius:8px;font-size:13px;z-index:99999;' +
      `color:#fff;backdrop-filter:blur(20px);max-width:400px;text-align:center;background:${styleColor}`;

    this._el.textContent = this.title + (this.message ? ` — ${this.message}` : '');
    document.body.appendChild(this._el);

    this._timer = setTimeout(() => this.hide(), 3000);
    return Promise.resolve();
  }

  hide() {
    if (this._timer) clearTimeout(this._timer);
    if (this._el) {
      this._el.remove();
      this._el = null;
    }
    return Promise.resolve();
  }
}

// Toast namespace for types (merged with class)
export namespace Toast {
  export enum Style {
    Animated = 'animated',
    Success = 'success',
    Failure = 'failure',
  }

  export interface Options {
    title: string;
    message?: string;
    style?: ToastStyle | Toast.Style;
    primaryAction?: Alert.ActionOptions;
    secondaryAction?: Alert.ActionOptions;
  }
}

function shouldSuppressBenignGitMissingPathToast(options: Toast.Options): boolean {
  const style = options?.style as any;
  const isFailure = style === ToastStyle.Failure || style === Toast.Style.Failure || style === 'failure';
  if (!isFailure) return false;

  const title = String(options?.title || '');
  const message = String(options?.message || '');
  const combined = `${title} ${message}`.toLowerCase();

  if (!combined.includes('git')) return false;
  if (!combined.includes('enoent') || !combined.includes('no such file or directory')) return false;
  return /\b(stat|lstat|access|scandir)\b/.test(combined);
}

export async function showToast(options: Toast.Options): Promise<Toast> {
  const t = new Toast(options);
  if (shouldSuppressBenignGitMissingPathToast(options)) {
    return t;
  }
  await t.show();
  return t;
}

// =====================================================================
// ─── PopToRootType ──────────────────────────────────────────────────
// =====================================================================

export enum PopToRootType {
  Default = 'default',
  Immediate = 'immediate',
  Suspended = 'suspended',
}

// =====================================================================
// ─── showHUD ────────────────────────────────────────────────────────
// =====================================================================

export async function showHUD(
  title: string,
  options?: { clearRootSearch?: boolean; popToRootType?: PopToRootType }
): Promise<void> {
  await showToast({ title, style: ToastStyle.Success });

  if (options?.clearRootSearch) {
    _clearSearchBarCallback?.();
  }
  if (options?.popToRootType === PopToRootType.Immediate) {
    const nav = getGlobalNavigation();
    if (nav?.popToRoot) nav.popToRoot();
  }
}

// =====================================================================
// ─── confirmAlert ───────────────────────────────────────────────────
// =====================================================================

export async function confirmAlert(options: Alert.Options): Promise<boolean> {
  const confirmed = window.confirm(`${options.title}${options.message ? '\n\n' + options.message : ''}`);
  if (confirmed) {
    options.primaryAction?.onAction?.();
    return true;
  } else {
    options.dismissAction?.onAction?.();
    return false;
  }
}

// =====================================================================
// ─── clearSearchBar ─────────────────────────────────────────────────
// =====================================================================

let _clearSearchBarCallback: (() => void) | null = null;

export function clearSearchBar(options?: { forceScrollToTop?: boolean }): Promise<void> {
  _clearSearchBarCallback?.();
  return Promise.resolve();
}

// NOTE: Icon/Color/Image/Keyboard implementation moved to `icon-runtime.tsx`.

// =====================================================================
// ─── Clipboard ──────────────────────────────────────────────────────
// =====================================================================

// Clipboard types
export namespace Clipboard {
  export type Content = string | number | { text?: string; file?: string; html?: string };
  export interface CopyOptions {
    concealed?: boolean;
  }
  export interface ReadContent {
    text?: string;
    file?: string;
    html?: string;
  }
}

export const Clipboard = {
  async copy(
    content: string | number | Clipboard.Content,
    options?: Clipboard.CopyOptions
  ): Promise<void> {
    let text = '';
    let html = '';

    // Parse content
    if (typeof content === 'string' || typeof content === 'number') {
      text = String(content);
    } else if (typeof content === 'object') {
      text = content.text || content.file || '';
      html = content.html || '';
    }

    let copied = false;

    try {
      // Copy to clipboard
      if (html) {
        // For HTML content, we need to use ClipboardItem
        const blob = new Blob([html], { type: 'text/html' });
        const textBlob = new Blob([text], { type: 'text/plain' });
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': blob,
            'text/plain': textBlob,
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(text);
      }
      copied = true;
    } catch (e) {
      // Fallback for unfocused renderer documents.
      try {
        const electron = (window as any).electron;
        copied = await electron?.clipboardWrite?.({ text, html }) || false;
      } catch {}
      if (!copied) {
        console.error('Clipboard copy error:', e);
        throw e;
      }
    }

    // TODO: Handle concealed option by not saving to clipboard history
    // For now, we always show the toast unless concealed
    if (!options?.concealed) {
      showToast({ title: 'Copied to clipboard', style: 'success' });
    }
  },

  async paste(content: string | Clipboard.Content): Promise<void> {
    try {
      const electron = (window as any).electron;
      let text = '';
      let html = '';

      if (typeof content === 'string' || typeof content === 'number') {
        text = String(content);
      } else if (content && typeof content === 'object') {
        text = content.text || content.file || '';
        html = content.html || '';
      }

      // Prefer main-process paste flow: hides SuperCmd first and pastes into
      // the previously focused app/editor. This prevents pasting into the
      // launcher's own search field.
      if (!html && electron?.pasteText) {
        const pasted = await electron.pasteText(text);
        if (pasted) return;
      }

      // Fallback path (no paste-text bridge or HTML payload).
      await this.copy(content, { concealed: true });
      if (electron?.hideWindow) {
        await electron.hideWindow();
        await new Promise((resolve) => setTimeout(resolve, 60));
      }
      if (electron?.runAppleScript) {
        await electron.runAppleScript(
          `tell application "System Events"
  keystroke "v" using command down
end tell`
        );
      }
    } catch (e) {
      console.error('Clipboard paste error:', e);
    }
  },

  async readText(options?: { offset?: number }): Promise<string | undefined> {
    try {
      const electron = (window as any).electron;

      // If offset is specified and we have clipboard history, use it
      if (options?.offset && electron?.clipboardGetHistory) {
        const history = await electron.clipboardGetHistory();
        const item = history[options.offset];
        return item?.text || undefined;
      }

      // Otherwise read current clipboard
      const text = await navigator.clipboard.readText();
      return text || undefined;
    } catch {
      try {
        const electron = (window as any).electron;
        const text = await electron?.clipboardReadText?.();
        return text || undefined;
      } catch {
        return undefined;
      }
    }
  },

  async read(options?: { offset?: number }): Promise<Clipboard.ReadContent> {
    try {
      const electron = (window as any).electron;

      // If offset is specified and we have clipboard history, use it
      if (options?.offset && electron?.clipboardGetHistory) {
        const history = await electron.clipboardGetHistory();
        const item = history[options.offset];
        if (item) {
          return {
            text: item.text,
            file: item.file,
            html: item.html,
          };
        }
      }

      // Otherwise read current clipboard
      const text = await navigator.clipboard.readText();
      return { text };
    } catch {
      return {};
    }
  },

  async clear(): Promise<void> {
    try {
      await navigator.clipboard.writeText('');
    } catch {}
  },
};

// =====================================================================
// ─── LocalStorage ───────────────────────────────────────────────────
// =====================================================================

const legacyStoragePrefix = 'sc-ext-';

function getStoragePrefix(): string {
  const ext = (_extensionContext.extensionName || 'global').trim() || 'global';
  return `sc-ext:${ext}:`;
}

function encodeStorageValue(value: any): string {
  const t = typeof value;
  if (t === 'string') return JSON.stringify({ __scv: 1, t: 's', v: value });
  if (t === 'number') return JSON.stringify({ __scv: 1, t: 'n', v: value });
  if (t === 'boolean') return JSON.stringify({ __scv: 1, t: 'b', v: value });
  // Keep backward-compatible behavior for out-of-contract values:
  // store as string instead of serializing into objects that break callers.
  return JSON.stringify({ __scv: 1, t: 's', v: String(value) });
}

function decodeStorageValue(raw: string): LocalStorage.Value {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.__scv === 1) {
      return parsed.v as LocalStorage.Value;
    }
    // Legacy format used JSON.stringify(value) directly.
    // Preserve primitive values exactly.
    if (typeof parsed === 'string' || typeof parsed === 'number' || typeof parsed === 'boolean') {
      return parsed as LocalStorage.Value;
    }
  } catch {
    // Legacy plain string format
  }
  return raw as LocalStorage.Value;
}

export const LocalStorage = {
  async getItem(key: string): Promise<LocalStorage.Value | undefined> {
    const scopedKey = getStoragePrefix() + key;
    let raw = localStorage.getItem(scopedKey);
    if (raw === null) {
      // Backward compatibility: read legacy non-scoped key.
      raw = localStorage.getItem(legacyStoragePrefix + key);
    }
    if (raw === null) return undefined;
    return decodeStorageValue(raw);
  },
  async setItem(key: string, value: LocalStorage.Value): Promise<void> {
    const scopedKey = getStoragePrefix() + key;
    localStorage.setItem(scopedKey, encodeStorageValue(value));
    emitExtensionStorageChanged();
  },
  async removeItem(key: string): Promise<void> {
    localStorage.removeItem(getStoragePrefix() + key);
    // Remove legacy key too, so callers don't read stale values.
    localStorage.removeItem(legacyStoragePrefix + key);
    emitExtensionStorageChanged();
  },
  async allItems(): Promise<LocalStorage.Values> {
    const result: LocalStorage.Values = {};
    const scopedPrefix = getStoragePrefix();

    // Read scoped keys first.
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(scopedPrefix)) {
        const raw = localStorage.getItem(k);
        if (raw !== null) {
          result[k.slice(scopedPrefix.length)] = decodeStorageValue(raw);
        }
      }
    }

    // Backfill from legacy keys only if missing in scoped storage.
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(legacyStoragePrefix)) {
        const raw = localStorage.getItem(k);
        if (raw !== null) {
          const unscopedKey = k.slice(legacyStoragePrefix.length);
          if (result[unscopedKey] === undefined) {
            result[unscopedKey] = decodeStorageValue(raw);
          }
        }
      }
    }
    return result;
  },
  async clear(): Promise<void> {
    const scopedPrefix = getStoragePrefix();
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(scopedPrefix) || k?.startsWith(legacyStoragePrefix)) toRemove.push(k);
    }
    toRemove.forEach((k) => localStorage.removeItem(k));
    emitExtensionStorageChanged();
  },
};

export namespace LocalStorage {
  export type Value = string | number | boolean;
  export type Values = Record<string, Value>;
}

// =====================================================================
// ─── Cache ──────────────────────────────────────────────────────────
// =====================================================================

export namespace Cache {
  export interface Options {
    capacity?: number; // in bytes, default 10MB
    namespace?: string;
  }
  export type Subscriber = (key: string | undefined, data: string | undefined) => void;
  export type Subscription = () => void;
}

export class Cache {
  private storageKey: string;
  private capacity: number;
  private subscribers: Set<Cache.Subscriber> = new Set();
  private lruOrder: string[] = []; // Track access order for LRU

  constructor(options: Cache.Options = {}) {
    this.capacity = options.capacity ?? 10 * 1024 * 1024; // 10MB default
    const namespace = options.namespace ?? 'default';
    this.storageKey = `sc-cache-${namespace}`;

    // Load existing cache from localStorage
    this.loadFromStorage();
  }

  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        this.lruOrder = parsed.lruOrder || [];
      }
    } catch (e) {
      console.error('Failed to load cache from storage:', e);
    }
  }

  private saveToStorage(): void {
    try {
      const data = {
        lruOrder: this.lruOrder,
      };
      localStorage.setItem(this.storageKey, JSON.stringify(data));
    } catch (e) {
      console.error('Failed to save cache to storage:', e);
    }
  }

  private getItemKey(key: string): string {
    return `${this.storageKey}-item-${key}`;
  }

  private getCurrentSize(): number {
    let total = 0;
    for (const key of this.lruOrder) {
      const value = localStorage.getItem(this.getItemKey(key));
      if (value) {
        total += value.length;
      }
    }
    return total;
  }

  private evictLRU(): void {
    // Remove oldest (first) item
    const oldestKey = this.lruOrder.shift();
    if (oldestKey) {
      localStorage.removeItem(this.getItemKey(oldestKey));
    }
  }

  private updateLRU(key: string): void {
    // Remove key if it exists
    const index = this.lruOrder.indexOf(key);
    if (index !== -1) {
      this.lruOrder.splice(index, 1);
    }
    // Add to end (most recently used)
    this.lruOrder.push(key);
  }

  private notifySubscribers(key: string | undefined, data: string | undefined): void {
    for (const subscriber of this.subscribers) {
      try {
        subscriber(key, data);
      } catch (e) {
        console.error('Cache subscriber error:', e);
      }
    }
  }

  get(key: string): string | undefined {
    const value = localStorage.getItem(this.getItemKey(key));
    if (value !== null) {
      this.updateLRU(key);
      this.saveToStorage();
      return value;
    }
    return undefined;
  }

  set(key: string, data: string): void {
    const itemKey = this.getItemKey(key);
    const dataSize = data.length;

    // Check if adding this item would exceed capacity
    let currentSize = this.getCurrentSize();
    while (currentSize + dataSize > this.capacity && this.lruOrder.length > 0) {
      this.evictLRU();
      currentSize = this.getCurrentSize();
    }

    // Store the item
    localStorage.setItem(itemKey, data);
    this.updateLRU(key);
    this.saveToStorage();

    // Notify subscribers
    this.notifySubscribers(key, data);
  }

  remove(key: string): boolean {
    const itemKey = this.getItemKey(key);
    const existed = localStorage.getItem(itemKey) !== null;

    if (existed) {
      localStorage.removeItem(itemKey);
      const index = this.lruOrder.indexOf(key);
      if (index !== -1) {
        this.lruOrder.splice(index, 1);
      }
      this.saveToStorage();
      this.notifySubscribers(key, undefined);
    }

    return existed;
  }

  has(key: string): boolean {
    return localStorage.getItem(this.getItemKey(key)) !== null;
  }

  get isEmpty(): boolean {
    return this.lruOrder.length === 0;
  }

  clear(options?: { notifySubscribers?: boolean }): void {
    const shouldNotify = options?.notifySubscribers ?? true;

    // Remove all items
    for (const key of this.lruOrder) {
      localStorage.removeItem(this.getItemKey(key));
    }
    this.lruOrder = [];
    this.saveToStorage();

    // Notify subscribers
    if (shouldNotify) {
      this.notifySubscribers(undefined, undefined);
    }
  }

  subscribe(subscriber: Cache.Subscriber): Cache.Subscription {
    this.subscribers.add(subscriber);

    // Return unsubscribe function
    return () => {
      this.subscribers.delete(subscriber);
    };
  }
}

// =====================================================================
// ─── AI ─────────────────────────────────────────────────────────────
// =====================================================================

type AICreativity = 'none' | 'low' | 'medium' | 'high' | 'maximum' | number;

function resolveCreativity(c?: AICreativity): number {
  if (c === undefined || c === null) return 0.7;
  if (typeof c === 'number') return Math.max(0, Math.min(2, c));
  switch (c) {
    case 'none': return 0;
    case 'low': return 0.3;
    case 'medium': return 0.7;
    case 'high': return 1.2;
    case 'maximum': return 2.0;
    default: return 0.7;
  }
}

// AI model enum — maps Raycast model names to internal routing keys
const AIModel = {
  'OpenAI_GPT4o': 'openai-gpt-4o',
  'OpenAI_GPT4o-mini': 'openai-gpt-4o-mini',
  'OpenAI_GPT4-turbo': 'openai-gpt-4-turbo',
  'OpenAI_GPT3.5-turbo': 'openai-gpt-3.5-turbo',
  'OpenAI_o1': 'openai-o1',
  'OpenAI_o1-mini': 'openai-o1-mini',
  'OpenAI_o3-mini': 'openai-o3-mini',
  'Anthropic_Claude_Opus': 'anthropic-claude-opus',
  'Anthropic_Claude_Sonnet': 'anthropic-claude-sonnet',
  'Anthropic_Claude_Haiku': 'anthropic-claude-haiku',
} as const;

let _requestIdCounter = 0;
function nextRequestId(): string {
  return `ai-req-${++_requestIdCounter}-${Date.now()}`;
}

// StreamingPromise: a Promise that also supports .on("data") for streaming
type StreamListener = (chunk: string) => void;

class StreamingPromise implements PromiseLike<string> {
  private _resolve!: (value: string) => void;
  private _reject!: (reason: any) => void;
  private _promise: Promise<string>;
  private _listeners: StreamListener[] = [];

  constructor() {
    this._promise = new Promise<string>((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;
    });
  }

  on(event: string, callback: StreamListener): this {
    if (event === 'data') {
      this._listeners.push(callback);
    }
    return this;
  }

  _emit(chunk: string): void {
    for (const fn of this._listeners) {
      try { fn(chunk); } catch {}
    }
  }

  _complete(fullText: string): void {
    this._resolve(fullText);
  }

  _error(err: any): void {
    this._reject(err);
  }

  then<TResult1 = string, TResult2 = never>(
    onfulfilled?: ((value: string) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this._promise.then(onfulfilled, onrejected);
  }

  catch<TResult = never>(
    onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null
  ): Promise<string | TResult> {
    return this._promise.catch(onrejected);
  }

  finally(onfinally?: (() => void) | null): Promise<string> {
    return this._promise.finally(onfinally);
  }
}

// Global IPC listener registry — routes chunks to the right StreamingPromise
const _activeStreams = new Map<string, { sp: StreamingPromise; fullText: string }>();
let _aiListenersRegistered = false;

function ensureAIListeners(): void {
  if (_aiListenersRegistered) return;
  _aiListenersRegistered = true;

  const electron = (window as any).electron;
  if (!electron) return;

  electron.onAIStreamChunk?.((data: { requestId: string; chunk: string }) => {
    const entry = _activeStreams.get(data.requestId);
    if (entry) {
      entry.fullText += data.chunk;
      entry.sp._emit(data.chunk);
    }
  });

  electron.onAIStreamDone?.((data: { requestId: string }) => {
    const entry = _activeStreams.get(data.requestId);
    if (entry) {
      entry.sp._complete(entry.fullText);
      _activeStreams.delete(data.requestId);
    }
  });

  electron.onAIStreamError?.((data: { requestId: string; error: string }) => {
    const entry = _activeStreams.get(data.requestId);
    if (entry) {
      entry.sp._error(new Error(data.error));
      _activeStreams.delete(data.requestId);
    }
  });
}

// Initialize AI availability cache
(async () => {
  try {
    _aiAvailableCache = await (window as any).electron?.aiIsAvailable?.() ?? false;
  } catch {
    _aiAvailableCache = false;
  }
})();

export const AI = {
  Model: AIModel,

  ask(
    prompt: string,
    options?: {
      model?: string;
      creativity?: AICreativity;
      signal?: AbortSignal;
    }
  ): StreamingPromise {
    ensureAIListeners();

    const sp = new StreamingPromise();
    const requestId = nextRequestId();
    const electron = (window as any).electron;

    if (!electron?.aiAsk) {
      setTimeout(() => sp._error(new Error('AI is not available')), 0);
      return sp;
    }

    _activeStreams.set(requestId, { sp, fullText: '' });

    const creativity = resolveCreativity(options?.creativity);
    electron.aiAsk(requestId, prompt, {
      model: options?.model,
      creativity,
    }).catch((err: any) => {
      const entry = _activeStreams.get(requestId);
      if (entry) {
        entry.sp._error(err);
        _activeStreams.delete(requestId);
      }
    });

    // Handle AbortSignal
    if (options?.signal) {
      if (options.signal.aborted) {
        electron.aiCancel?.(requestId);
        setTimeout(() => sp._error(new Error('Request aborted')), 0);
        _activeStreams.delete(requestId);
      } else {
        options.signal.addEventListener('abort', () => {
          electron.aiCancel?.(requestId);
          const entry = _activeStreams.get(requestId);
          if (entry) {
            entry.sp._error(new Error('Request aborted'));
            _activeStreams.delete(requestId);
          }
        }, { once: true });
      }
    }

    return sp;
  },
};

if (typeof window !== 'undefined') {
  (window as any).__supercmdRaycastAI = AI;
}

// =====================================================================
// ─── Utility Functions ──────────────────────────────────────────────
// =====================================================================

export function getPreferenceValues<Values extends PreferenceValues = PreferenceValues>(): Values {
  return _extensionContext.preferences as Values;
}

export async function open(target: string, application?: string | Application): Promise<void> {
  const electron = (window as any).electron;
  if (application) {
    const appName = typeof application === 'string' ? application : application.name;
    // Use 'open -a' to open with a specific application
    if (electron?.execCommand) {
      await electron.execCommand('open', ['-a', appName, target]);
      return;
    }
  }
  electron?.openUrl?.(target);
}

export async function closeMainWindow(options?: { clearRootSearch?: boolean; popToRootType?: PopToRootType }): Promise<void> {
  if (options?.clearRootSearch) {
    _clearSearchBarCallback?.();
  }
  if (options?.popToRootType === PopToRootType.Immediate) {
    const nav = getGlobalNavigation();
    if (nav?.popToRoot) nav.popToRoot();
  }
  (window as any).electron?.hideWindow?.();
}

export async function popToRoot(options?: { clearSearchBar?: boolean }): Promise<void> {
  const nav = getGlobalNavigation();
  if (nav?.popToRoot) nav.popToRoot();
  if (options?.clearSearchBar !== false) {
    _clearSearchBarCallback?.();
  }
}

export async function launchCommand(options: LaunchOptions): Promise<void> {
  const electron = (window as any).electron;
  const ctx = getExtensionContext();

  // Determine target extension
  // For intra-extension launches (same extension), extensionName can be omitted
  // For cross-extension launches, extensionName MUST be provided
  const targetExtension = options.extensionName || ctx.extensionName;
  const targetOwner = options.ownerOrAuthorName || ctx.owner;

  // Check if this is an inter-extension launch
  const isInterExtension = !!(options.extensionName && options.extensionName !== ctx.extensionName);

  if (isInterExtension) {
    // For cross-extension launches, we need permission handling
    // TODO: Implement permission alert system
    console.warn('Cross-extension launches require permission handling');
  }

  try {
    if (electron?.launchCommand) {
      const result = await electron.launchCommand({
        ...options,
        extensionName: targetExtension,
        ownerOrAuthorName: targetOwner,
        sourceExtensionName: ctx.extensionName,
        sourcePreferences: ctx.preferences,
      });

      if (result.success && result.bundle) {
        window.dispatchEvent(
          new CustomEvent('sc-launch-extension-bundle', {
            detail: {
              bundle: result.bundle,
              launchOptions: {
                type: options.type ?? LaunchType.UserInitiated,
                context: options.context,
              },
              source: {
                extensionName: ctx.extensionName,
                commandName: ctx.commandName,
                commandMode: ctx.commandMode,
              },
            },
          })
        );
      } else if (!result.success) {
        throw new Error('Failed to launch command');
      }
    } else {
      throw new Error('Command execution not available');
    }
  } catch (error) {
    throw new Error(`Failed to launch command "${options.name}": ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function getSelectedText(): Promise<string> {
  try {
    return await navigator.clipboard.readText();
  } catch {
    throw new Error('Could not get selected text');
  }
}

export async function getSelectedFinderItems(): Promise<Array<{ path: string }>> {
  return [];
}

export async function getApplications(path?: string): Promise<Application[]> {
  try {
    const electron = (window as any).electron;
    if (electron?.getApplications) {
      return await electron.getApplications(path);
    }
  } catch (e) {
    console.error('getApplications error:', e);
  }
  return [];
}

export async function getFrontmostApplication(): Promise<Application> {
  try {
    const electron = (window as any).electron;
    if (electron?.getFrontmostApplication) {
      const app = await electron.getFrontmostApplication();
      if (app) return app;
    }
  } catch (e) {
    console.error('getFrontmostApplication error:', e);
  }
  return { name: 'SuperCmd', path: '', bundleId: 'com.supercmd' };
}

export async function getDefaultApplication(path: string): Promise<Application> {
  try {
    const electron = (window as any).electron;
    if (electron?.getDefaultApplication) {
      return await electron.getDefaultApplication(path);
    }
  } catch (e) {
    console.error('getDefaultApplication error:', e);
  }
  throw new Error(`No default application found for: ${path}`);
}

export function captureException(exception: unknown): void {
  // Log the exception — in a full implementation this would report to a developer hub
  console.error('[captureException]', exception);
}

export async function showInFinder(path: string): Promise<void> {
  try {
    await (window as any).electron?.execCommand?.('open', ['-R', path]);
  } catch {}
}

export async function trash(path: string | string[]): Promise<void> {
  try {
    const electron = (window as any).electron;
    const paths = Array.isArray(path) ? path : [path];
    if (electron?.moveToTrash) {
      await electron.moveToTrash(paths);
    }
  } catch (e) {
    console.error('trash error:', e);
  }
}

export async function openExtensionPreferences(): Promise<void> {
  const electron = (window as any).electron;
  const ctx = getExtensionContext();
  if (electron?.openSettingsTab) {
    await electron.openSettingsTab('extensions', {
      extensionName: ctx.extensionName,
    });
    return;
  }
  if (electron?.openSettings) {
    await electron.openSettings();
  }
}

export async function openCommandPreferences(): Promise<void> {
  const electron = (window as any).electron;
  const ctx = getExtensionContext();
  if (electron?.openSettingsTab) {
    await electron.openSettingsTab('extensions', {
      extensionName: ctx.extensionName,
      commandName: ctx.commandName,
    });
    return;
  }
  if (electron?.openSettings) {
    await electron.openSettings();
  }
}

// =====================================================================
// ─── Action Registry Context ────────────────────────────────────────
// =====================================================================

// Action components register themselves via this context when mounted
// inside a collecting container. This allows actions to work even when
// wrapped in custom components that use hooks (e.g., <ListActions />).

let _actionOrderCounter = 0;

interface ActionRegistration {
  id: string;
  title: string;
  icon?: any;
  shortcut?: { modifiers?: string[]; key?: string };
  style?: string;
  sectionTitle?: string;
  execute: () => void;
  order: number;
}

interface ActionRegistryAPI {
  register: (id: string, data: Omit<ActionRegistration, 'id'>) => void;
  unregister: (id: string) => void;
}

const ActionRegistryContext = createContext<ActionRegistryAPI | null>(null);
const ActionSectionContext = createContext<string | undefined>(undefined);

// Standalone executor factory (used by both static extraction and registry)
function makeActionExecutor(p: any, runtimeCtx?: ExtensionContextType): () => void {
  return () => {
    withExtensionContext(runtimeCtx, () => {
      if (p.onAction) { p.onAction(); return; }
      if (p.onSubmit) { p.onSubmit(getFormValues()); return; }
      if (p.content !== undefined) {
        if (p.__actionKind === 'paste') {
          Clipboard.paste(p.content);
        } else {
          Clipboard.copy(p.content);
        }
        // Call onCopy/onPaste callbacks if provided
        p.onCopy?.();
        p.onPaste?.();
        return;
      }
      if (p.url) {
        (window as any).electron?.openUrl?.(p.url);
        p.onOpen?.();
        return;
      }
      if (p.target && React.isValidElement(p.target)) {
        getGlobalNavigation().push(p.target);
        p.onPush?.();
        return;
      }
      if (p.paths) { trash(p.paths); p.onTrash?.(); return; }
    });
  };
}

function inferActionTitle(p: any, kind?: string): string {
  if (p?.title) return p.title;
  switch (kind || p?.__actionKind) {
    case 'copyToClipboard': return 'Copy to Clipboard';
    case 'paste': return 'Paste';
    case 'openInBrowser': return 'Open in Browser';
    case 'push': return 'Open';
    case 'submitForm': return 'Submit';
    case 'trash': return 'Move to Trash';
    case 'pickDate': return 'Pick Date';
    case 'open': return 'Open';
    case 'toggleQuickLook': return 'Toggle Quick Look';
    case 'createSnippet': return 'Create Snippet';
    case 'createQuicklink': return 'Create Quicklink';
    case 'toggleSidebar': return 'Toggle Sidebar';
    default: return 'Action';
  }
}

// Hook used by each Action component to register itself
function useActionRegistration(props: any, kind?: string) {
  const registry = useContext(ActionRegistryContext);
  const sectionTitle = useContext(ActionSectionContext);
  const idRef = useRef(`__action_${++_actionOrderCounter}`);
  const orderRef = useRef(++_actionOrderCounter);
  const runtimeCtxRef = useRef<ExtensionContextType>(snapshotExtensionContext());

  // Build a stable executor ref so we always call the latest props
  const propsRef = useRef(props);
  propsRef.current = props;
  runtimeCtxRef.current = snapshotExtensionContext();

  useEffect(() => {
    if (!registry) return;
    const executor = () => makeActionExecutor(propsRef.current, runtimeCtxRef.current)();
    registry.register(idRef.current, {
      title: inferActionTitle(props, kind),
      icon: props.icon,
      shortcut: props.shortcut,
      style: props.style,
      sectionTitle,
      execute: executor,
      order: orderRef.current,
    });
    return () => registry.unregister(idRef.current);
    // Re-register only when display-relevant properties change.
    // The executor uses propsRef so it always calls the latest props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registry, props.title, props.icon, props.shortcut, props.style, sectionTitle]);

  return null;
}

// ── useCollectedActions hook ─────────────────────────────────────────
// Manages an action registry for a given actions element.
// Returns: { collectedActions, ActionsRenderer }
// ActionsRenderer must be rendered in the tree (hidden) so hooks work.

function useCollectedActions() {
  const registryRef = useRef(new Map<string, ActionRegistration>());
  const [version, setVersion] = useState(0);
  const pendingRef = useRef(false);
  const lastSnapshotRef = useRef('');

  const scheduleUpdate = useCallback(() => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    queueMicrotask(() => {
      pendingRef.current = false;
      const entries = Array.from(registryRef.current.values());
      const snapshot = entries.map(e => `${e.id}:${e.title}:${e.sectionTitle || ''}`).join('|');
      if (snapshot !== lastSnapshotRef.current) {
        lastSnapshotRef.current = snapshot;
        setVersion(v => v + 1);
      }
    });
  }, []);

  const registryAPI = useMemo<ActionRegistryAPI>(() => ({
    register(id, data) {
      const existing = registryRef.current.get(id);
      if (existing) {
        existing.title = data.title;
        existing.icon = data.icon;
        existing.shortcut = data.shortcut;
        existing.style = data.style;
        existing.sectionTitle = data.sectionTitle;
        existing.execute = data.execute;
        existing.order = data.order;
      } else {
        registryRef.current.set(id, { id, ...data });
      }
      scheduleUpdate();
    },
    unregister(id) {
      if (registryRef.current.has(id)) {
        registryRef.current.delete(id);
        scheduleUpdate();
      }
    },
  }), [scheduleUpdate]);

  const collectedActions = useMemo(() => {
    return Array.from(registryRef.current.values()).sort((a, b) => a.order - b.order);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  return { collectedActions, registryAPI };
}

// =====================================================================
// ─── ActionPanel ────────────────────────────────────────────────────
// =====================================================================

// When ActionRegistryContext is available, ActionPanel renders its
// children so that hooks inside wrapper components work and Action
// components can register themselves. Otherwise returns null (legacy).

function ActionPanelComponent({ children, title }: { children?: React.ReactNode; title?: string }) {
  const registry = useContext(ActionRegistryContext);
  if (registry) return <>{children}</>;
  return null;
}
function ActionPanelSection({ children, title }: { children?: React.ReactNode; title?: string }) {
  const registry = useContext(ActionRegistryContext);
  if (registry) {
    return (
      <ActionSectionContext.Provider value={title}>
        {children}
      </ActionSectionContext.Provider>
    );
  }
  return null;
}
function ActionPanelItem(_props: { title?: string; icon?: any; shortcut?: any; onAction?: () => void; style?: any; [key: string]: any }) {
  useActionRegistration(_props, 'action');
  return null;
}
function ActionPanelSubmenu({ children, title, icon, filtering, isLoading, onOpen, onSearchTextChange, shortcut, throttle, autoFocus }: {
  children?: React.ReactNode; title?: string; icon?: any;
  filtering?: boolean | { keepSectionOrder: boolean }; isLoading?: boolean;
  onOpen?: () => void; onSearchTextChange?: (text: string) => void;
  shortcut?: any; throttle?: boolean; autoFocus?: boolean;
}) {
  const registry = useContext(ActionRegistryContext);
  if (registry) {
    return (
      <ActionSectionContext.Provider value={title}>
        {children}
      </ActionSectionContext.Provider>
    );
  }
  return null;
}

// =====================================================================
// ─── Action ─────────────────────────────────────────────────────────
// =====================================================================

// Action components register via context when mounted. They still
// render null visually — the collected data drives the UI.

function ActionComponent(_props: { title?: string; icon?: any; shortcut?: any; onAction?: () => void; style?: any; [key: string]: any }) {
  useActionRegistration(_props, 'action');
  return null;
}
function ActionCopyToClipboard(_props: { content: any; title?: string; shortcut?: any; concealed?: boolean; onCopy?: (content: any) => void; [key: string]: any }) {
  useActionRegistration({ ..._props, __actionKind: 'copyToClipboard' }, 'copyToClipboard');
  return null;
}
function ActionPaste(_props: { content: any; title?: string; shortcut?: any; concealed?: boolean; onPaste?: (content: any) => void; [key: string]: any }) {
  useActionRegistration({ ..._props, __actionKind: 'paste' }, 'paste');
  return null;
}
function ActionOpenInBrowser(_props: { url: string; title?: string; shortcut?: any; [key: string]: any }) {
  useActionRegistration({ ..._props, __actionKind: 'openInBrowser' }, 'openInBrowser');
  return null;
}
function ActionPush(_props: { title?: string; target: React.ReactElement; icon?: any; shortcut?: any; onPush?: () => void; onPop?: () => void; [key: string]: any }) {
  useActionRegistration({ ..._props, __actionKind: 'push' }, 'push');
  return null;
}
function ActionSubmitForm(_props: { title?: string; onSubmit?: (values: any) => void; icon?: any; shortcut?: any; [key: string]: any }) {
  useActionRegistration({ ..._props, __actionKind: 'submitForm' }, 'submitForm');
  return null;
}
function ActionTrash(_props: { title?: string; paths?: string[]; onTrash?: () => void; shortcut?: any; [key: string]: any }) {
  useActionRegistration({ ..._props, __actionKind: 'trash' }, 'trash');
  return null;
}
function ActionPickDate(_props: { title?: string; onChange?: (date: Date | null) => void; shortcut?: any; [key: string]: any }) {
  useActionRegistration({ ..._props, __actionKind: 'pickDate' }, 'pickDate');
  return null;
}
function ActionOpen(_props: { target: string; title: string; application?: string | any; icon?: any; shortcut?: any; onOpen?: (target: string) => void; [key: string]: any }) {
  useActionRegistration({ ..._props, __actionKind: 'open' }, 'open');
  return null;
}
function ActionToggleQuickLook(_props: { title?: string; icon?: any; shortcut?: any; [key: string]: any }) {
  useActionRegistration({ ..._props, __actionKind: 'toggleQuickLook' }, 'toggleQuickLook');
  return null;
}
function ActionCreateSnippet(_props: any) { useActionRegistration({ ..._props, __actionKind: 'createSnippet' }, 'createSnippet'); return null; }
function ActionCreateQuicklink(_props: any) { useActionRegistration({ ..._props, __actionKind: 'createQuicklink' }, 'createQuicklink'); return null; }
function ActionToggleSidebar(_props: any) { useActionRegistration({ ..._props, __actionKind: 'toggleSidebar' }, 'toggleSidebar'); return null; }

const ActionPickDateWithType = Object.assign(ActionPickDate, {
  Type: { DateTime: 'datetime' as const, Date: 'date' as const },
});

export const Action = Object.assign(ActionComponent, {
  CopyToClipboard: ActionCopyToClipboard,
  Open: ActionOpen,
  OpenInBrowser: ActionOpenInBrowser,
  Push: ActionPush,
  SubmitForm: ActionSubmitForm,
  Paste: ActionPaste,
  ShowInFinder: ActionComponent,
  OpenWith: ActionComponent,
  Trash: ActionTrash,
  PickDate: ActionPickDateWithType,
  ToggleQuickLook: ActionToggleQuickLook,
  CreateSnippet: ActionCreateSnippet,
  CreateQuicklink: ActionCreateQuicklink,
  ToggleSidebar: ActionToggleSidebar,
  Style: {
    Regular: 'regular' as const,
    Destructive: 'destructive' as const,
  },
});

export const ActionPanel = Object.assign(ActionPanelComponent, {
  Item: ActionPanelItem,
  Section: ActionPanelSection,
  Submenu: ActionPanelSubmenu,
});

// ── Extract action data from ActionPanel element tree ────────────────
// Legacy static extraction — kept as fallback for non-registry usage.

interface ExtractedAction {
  title: string;
  icon?: any;
  shortcut?: { modifiers?: string[]; key?: string };
  style?: string;
  sectionTitle?: string;
  execute: () => void;
}

function extractActionsFromElement(el: React.ReactElement | undefined | null): ExtractedAction[] {
  if (!el) return [];
  const result: ExtractedAction[] = [];
  const runtimeCtx = snapshotExtensionContext();

  function walk(nodes: React.ReactNode, sectionTitle?: string) {
    React.Children.forEach(nodes, (child) => {
      if (!React.isValidElement(child)) return;
      const p = child.props as any;
      const hasChildren = p.children != null;
      const isActionLike = p.onAction || p.onSubmit || p.content !== undefined || p.url || p.target || p.paths;

      if (isActionLike || (p.title && !hasChildren)) {
        result.push({
          title: inferActionTitle(p),
          icon: p.icon,
          shortcut: p.shortcut,
          style: p.style,
          sectionTitle,
          execute: makeActionExecutor(p, runtimeCtx),
        });
      } else if (hasChildren) {
        walk(p.children, p.title || sectionTitle);
      }
    });
  }

  const rootProps = el.props as any;
  if (rootProps?.children) {
    walk(rootProps.children);
  }
  return result;
}

// ── Shortcut rendering helper ────────────────────────────────────────

function renderShortcut(shortcut?: { modifiers?: string[]; key?: string }): React.ReactNode {
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
      {parts.map((s, i) => (
        <kbd key={i} className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded bg-white/[0.06] text-[10px] text-white/40 font-medium">{s}</kbd>
      ))}
      <kbd className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded bg-white/[0.06] text-[10px] text-white/40 font-medium">{shortcut.key.toUpperCase()}</kbd>
    </span>
  );
}

// ── ActionPanelOverlay (the ⌘K dropdown) ─────────────────────────────

function ActionPanelOverlay({
  actions,
  onClose,
  onExecute,
}: {
  actions: ExtractedAction[];
  onClose: () => void;
  onExecute: (action: ExtractedAction) => void;
}) {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [filter, setFilter] = useState('');
  const filterRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const filteredActions = filter
    ? actions.filter(a => a.title.toLowerCase().includes(filter.toLowerCase()))
    : actions;

  useEffect(() => { filterRef.current?.focus(); }, []);
  useEffect(() => { setSelectedIdx(0); }, [filter]);

  // Scroll selected item into view
  useEffect(() => {
    panelRef.current?.querySelector(`[data-action-idx="${selectedIdx}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [selectedIdx]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Extension-defined shortcuts work even when action panel is open
    if ((e.metaKey || e.altKey || e.ctrlKey) && !e.repeat) {
      // ⌘K closes the panel (handled by parent)
      if (isMetaK(e)) { e.preventDefault(); onClose(); return; }
      for (const action of actions) {
        if (action.shortcut && matchesShortcut(e, action.shortcut)) {
          e.preventDefault();
          onExecute(action);
          return;
        }
      }
    }
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); setSelectedIdx(p => Math.min(p + 1, filteredActions.length - 1)); break;
      case 'ArrowUp': e.preventDefault(); setSelectedIdx(p => Math.max(p - 1, 0)); break;
      case 'Enter': e.preventDefault(); if (!e.repeat && filteredActions[selectedIdx]) onExecute(filteredActions[selectedIdx]); break;
      case 'Escape': e.preventDefault(); onClose(); break;
    }
  };

  // Group by section
  const groups: { title?: string; items: { action: ExtractedAction; idx: number }[] }[] = [];
  let gIdx = 0;
  let curTitle: string | undefined | null = null;
  for (const action of filteredActions) {
    if (action.sectionTitle !== curTitle || groups.length === 0) {
      curTitle = action.sectionTitle;
      groups.push({ title: action.sectionTitle, items: [] });
    }
    groups[groups.length - 1].items.push({ action, idx: gIdx++ });
  }

  return (
    <div className="fixed inset-0 z-50" onClick={onClose} onKeyDown={handleKeyDown} tabIndex={-1}
      style={{ background: 'rgba(0,0,0,0.15)' }}>
      <div
        ref={panelRef}
        className="absolute bottom-12 right-3 w-80 max-h-[65vh] rounded-xl overflow-hidden flex flex-col shadow-2xl"
        style={{ background: 'rgba(30,30,34,0.97)', backdropFilter: 'blur(40px)', border: '1px solid rgba(255,255,255,0.08)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Action list */}
        <div className="flex-1 overflow-y-auto py-1">
          {filteredActions.length === 0 ? (
            <div className="px-3 py-4 text-center text-white/30 text-sm">No matching actions</div>
          ) : groups.map((group, gi) => (
            <div key={gi}>
              {gi > 0 && <hr className="border-white/[0.06] my-0.5" />}
              {group.title && (
                <div className="px-3 pt-1.5 pb-0.5 text-[10px] uppercase tracking-wider text-white/25 font-medium select-none">{group.title}</div>
              )}
              {group.items.map(({ action, idx }) => (
                <div
                  key={idx}
                  data-action-idx={idx}
                  className={`mx-1 px-2.5 py-1.5 rounded-lg flex items-center gap-2.5 cursor-pointer transition-colors ${
                    idx === selectedIdx ? 'bg-blue-500/90' : 'hover:bg-white/[0.06]'
                  }`}
                  onClick={() => onExecute(action)}
                  onMouseMove={() => setSelectedIdx(idx)}
                >
                  {action.icon && (
                    <span className={`w-4 h-4 flex-shrink-0 flex items-center justify-center text-xs ${idx === selectedIdx ? 'text-white' : 'text-white/50'}`}>
                      {renderIcon(action.icon, 'w-4 h-4')}
                    </span>
                  )}
                  <span className={`flex-1 text-[13px] truncate ${
                    action.style === 'destructive'
                      ? idx === selectedIdx ? 'text-white' : 'text-red-400'
                      : idx === selectedIdx ? 'text-white' : 'text-white/80'
                  }`}>{action.title}</span>
                  <span className={`flex items-center gap-0.5 ${idx === selectedIdx ? 'text-white/70' : 'text-white/25'}`}>
                    {idx === 0 ? (
                      <kbd className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded bg-white/[0.08] text-[10px] font-medium">↩</kbd>
                    ) : renderShortcut(action.shortcut)}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
        {/* Search input */}
        <div className="border-t border-white/[0.06] px-3 py-2">
          <input
            ref={filterRef}
            type="text"
            placeholder="Search for actions…"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="w-full bg-transparent text-sm text-white/70 placeholder-white/25 outline-none"
          />
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// ─── List ───────────────────────────────────────────────────────────
// =====================================================================

// ── Types ────────────────────────────────────────────────────────────

interface ListItemProps {
  id?: string;
  title: string | { value: string; tooltip?: string };
  subtitle?: string | { value?: string; tooltip?: string };
  icon?: any;
  accessories?: Array<{ text?: string | { value?: string; color?: string }; icon?: any; tag?: any; date?: any; tooltip?: string }>;
  actions?: React.ReactElement;
  keywords?: string[];
  detail?: React.ReactElement;
  quickLook?: { name?: string; path: string };
}

// ── Item registration context ────────────────────────────────────────
// List.Item components register themselves with the parent List via
// this context. This solves the problem where custom wrapper components
// (like TodoSection) prevent static tree-walking from finding items.

let _itemOrderCounter = 0;

interface ItemRegistration {
  id: string;
  props: ListItemProps;
  sectionTitle?: string;
  order: number;
}

interface ListRegistryAPI {
  set: (id: string, data: Omit<ItemRegistration, 'id'>) => void;
  delete: (id: string) => void;
}

const ListRegistryContext = createContext<ListRegistryAPI>({
  set: () => {},
  delete: () => {},
});

const ListSectionTitleContext = createContext<string | undefined>(undefined);

// ── List.Item — registers with parent List via context ───────────────

function ListItemComponent(props: ListItemProps) {
  const registry = useContext(ListRegistryContext);
  const sectionTitle = useContext(ListSectionTitleContext);
  const stableId = useRef(props.id || `__li_${++_itemOrderCounter}`).current;
  // Order must update every render (NOT useRef) so that items in earlier
  // sections always sort before items in later sections. React renders
  // children in tree order, so this naturally reflects the JSX structure.
  const order = ++_itemOrderCounter;

  // Register synchronously (ref update, no state change)
  registry.set(stableId, { props, sectionTitle, order });

  // Unregister on unmount only
  useEffect(() => {
    return () => registry.delete(stableId);
  }, [stableId, registry]);

  return null; // Rendering is done by the parent List
}

// ── List.Item.Accessory type (for type-compatibility) ────────────────
type ListItemAccessory = { text?: string | { value?: string; color?: string }; icon?: any; tag?: any; date?: any; tooltip?: string };
(ListItemComponent as any).Accessory = {} as ListItemAccessory;
(ListItemComponent as any).Props = {} as ListItemProps;

// ── ListItemRenderer — the actual visual row ────────────────────────

function ListItemRenderer({
  title, subtitle, icon, accessories, isSelected, dataIdx, onSelect, onActivate, onContextAction, assetsPath,
}: ListItemProps & {
  isSelected: boolean;
  dataIdx: number;
  onSelect: () => void;
  onActivate: () => void;
  onContextAction: (e: React.MouseEvent<HTMLDivElement>) => void;
  assetsPath?: string;
}) {
  const titleStr = typeof title === 'string' ? title : (title as any)?.value || '';
  const subtitleStr = typeof subtitle === 'string' ? subtitle : (subtitle as any)?.value || '';

  return (
    <div
      data-idx={dataIdx}
      className={`mx-2 px-3 py-1.5 rounded-xl min-h-[38px] flex items-center cursor-pointer transition-all ${
        isSelected ? 'bg-white/[0.08]' : 'hover:bg-white/[0.04]'
      }`}
      onClick={onActivate}
      onMouseMove={onSelect}
      onContextMenu={onContextAction}
    >
      <div className="flex items-center gap-2.5 w-full">
        {icon && (
          <div className="w-5 h-5 flex items-center justify-center flex-shrink-0 text-white/55 text-xs">
            {renderIcon(icon, 'w-5 h-5', assetsPath)}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <span className="text-[13px] leading-[18px] truncate block" style={{ color: 'rgba(255,255,255,0.9)' }}>{titleStr}</span>
        </div>
        {subtitleStr && (
          <span className="text-[11px] leading-[16px] flex-shrink-0 truncate max-w-[220px]" style={{ color: 'rgba(255,255,255,0.42)' }}>{subtitleStr}</span>
        )}
        {accessories?.map((acc, i) => {
          const accText = typeof acc?.text === 'string' ? acc.text
            : typeof acc?.text === 'object' ? acc.text?.value || '' : '';
          const accTextColorRaw = typeof acc?.text === 'object' ? acc.text?.color : undefined;
          const tagText = typeof acc?.tag === 'string' ? acc.tag
            : typeof acc?.tag === 'object' ? acc.tag?.value || '' : '';
          const tagColorRaw = typeof acc?.tag === 'object' ? acc.tag?.color : undefined;
          const accTextColor = resolveTintColor(accTextColorRaw);
          const tagColor = resolveTintColor(tagColorRaw);
          const dateStr = acc?.date ? new Date(acc.date).toLocaleDateString() : '';
          const tagBg = tagColor
            ? (addHexAlpha(tagColor, '22') || 'rgba(255,255,255,0.1)')
            : 'rgba(255,255,255,0.1)';

          return (
            <span key={i} className="text-[12px] leading-5 flex-shrink-0 flex items-center gap-1.5" style={{ color: accTextColor || tagColor || 'rgba(255,255,255,0.35)' }}>
              {acc?.icon && <span className="text-[10px]">{renderIcon(acc.icon, 'w-3 h-3', assetsPath)}</span>}
              {tagText ? (
                <span className="px-2 py-0.5 rounded text-[11px]" style={{ background: tagBg, color: tagColor || 'rgba(255,255,255,0.55)' }}>{tagText}</span>
              ) : accText || dateStr || ''}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function ListEmojiGridItemRenderer({
  icon, title, isSelected, dataIdx, onSelect, onActivate, onContextAction,
}: {
  icon?: any;
  title?: string;
  isSelected: boolean;
  dataIdx: number;
  onSelect: () => void;
  onActivate: () => void;
  onContextAction: (e: React.MouseEvent<HTMLDivElement>) => void;
}) {
  const emoji = typeof icon === 'string' ? icon : '';
  return (
    <div
      data-idx={dataIdx}
      className={`relative rounded-2xl cursor-pointer transition-all overflow-hidden flex items-center justify-center ${
        isSelected ? 'ring-2 ring-white/70 bg-white/[0.10]' : 'bg-white/[0.05] hover:bg-white/[0.08]'
      }`}
      style={{ minHeight: '96px' }}
      onClick={onActivate}
      onMouseMove={onSelect}
      onContextMenu={onContextAction}
      title={title || ''}
    >
      <span className="text-[46px] leading-none select-none">{emoji || '🙂'}</span>
    </div>
  );
}

// ── List.Section — provides section title context ────────────────────

function ListSectionComponent({ children, title }: { children?: React.ReactNode; title?: string; subtitle?: string }) {
  return (
    <ListSectionTitleContext.Provider value={title}>
      {children}
    </ListSectionTitleContext.Provider>
  );
}

// ── List.EmptyView ───────────────────────────────────────────────────

function ListEmptyView({ title, description, icon, actions }: { title?: string; description?: string; icon?: any; actions?: React.ReactElement }) {
  const registerEmptyView = useContext(EmptyViewRegistryContext);
  useEffect(() => {
    if (!registerEmptyView) return;
    registerEmptyView({ title, description, icon, actions });
    return () => registerEmptyView(null);
  }, [registerEmptyView, title, description, icon, actions]);

  // When mounted in the hidden registry tree, only register metadata/actions.
  if (registerEmptyView) return null;

  return (
    <div className="flex flex-col items-center justify-center h-full text-white/40 py-12">
      {icon && <div className="text-2xl mb-2 opacity-40">{typeof icon === 'string' ? icon : '○'}</div>}
      {title && <p className="text-sm font-medium">{title}</p>}
      {description && <p className="text-xs text-white/25 mt-1 max-w-xs text-center">{description}</p>}
    </div>
  );
}

const EmptyViewRegistryContext = createContext<((props: {
  title?: string;
  description?: string;
  icon?: any;
  actions?: React.ReactElement;
} | null) => void) | null>(null);

// ── List.Dropdown — renders as a real <select> ───────────────────────

function ListDropdown({ children, tooltip, storeValue, onChange, value, defaultValue, filtering, onSearchTextChange, throttle, id, isLoading, placeholder }: any) {
  const [internalValue, setInternalValue] = useState(value ?? defaultValue ?? '');
  const didEmitInitialChange = useRef(false);

  // Extract items from children recursively
  const items: { title: string; value: string }[] = [];
  function walkDropdownChildren(nodes: React.ReactNode) {
    React.Children.forEach(nodes, (child) => {
      if (!React.isValidElement(child)) return;
      const p = child.props as any;
      if (p.value !== undefined && p.title !== undefined) {
        items.push({ title: p.title, value: p.value });
      }
      if (p.children) walkDropdownChildren(p.children);
    });
  }
  walkDropdownChildren(children);

  useEffect(() => {
    if (didEmitInitialChange.current) return;
    if (!onChange) return;
    const initial = value ?? defaultValue ?? items[0]?.value;
    if (initial === undefined) return;
    didEmitInitialChange.current = true;
    onChange(initial);
  }, [onChange, value, defaultValue, items]);

  return (
    <select
      value={value ?? internalValue}
      onChange={e => { const v = e.target.value; setInternalValue(v); onChange?.(v); }}
      title={tooltip}
      className="bg-white/[0.06] border border-white/[0.08] rounded-md px-2.5 py-1 text-[13px] text-white/70 outline-none cursor-pointer appearance-none pr-6"
      style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='rgba(255,255,255,0.3)' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 6px center',
      }}
    >
      {items.map(item => <option key={item.value} value={item.value}>{item.title}</option>)}
    </select>
  );
}
ListDropdown.Item = (_props: { title: string; value: string; icon?: any }) => null;
ListDropdown.Section = ({ children }: { children?: React.ReactNode; title?: string }) => <>{children}</>;

// ── ListComponent (main) ─────────────────────────────────────────────

// ── Shortcut matching helper ─────────────────────────────────────────
// Raycast shortcuts: { modifiers: ["cmd","opt","shift","ctrl"], key: "e" }
function matchesShortcut(e: React.KeyboardEvent | KeyboardEvent, shortcut?: { modifiers?: string[]; key?: string }): boolean {
  if (!shortcut?.key) return false;
  const sk = shortcut.key.toLowerCase();
  const ek = e.key.toLowerCase();
  // Also match against e.code (layout-independent: "KeyD" for "d") for robustness
  const ec = ((e as any).code || '').toLowerCase();
  const keyMatch = ek === sk;
  const codeMatch = sk.length === 1 && /^[a-z]$/.test(sk) && ec === `key${sk}`;
  if (!keyMatch && !codeMatch) return false;
  const mods = shortcut.modifiers || [];
  if (mods.includes('cmd') !== e.metaKey) return false;
  if ((mods.includes('opt') || mods.includes('option') || mods.includes('alt')) !== e.altKey) return false;
  if (mods.includes('shift') !== e.shiftKey) return false;
  if (mods.includes('ctrl') !== e.ctrlKey) return false;
  return true;
}

function isMetaK(e: React.KeyboardEvent | KeyboardEvent): boolean {
  return e.metaKey && String(e.key || '').toLowerCase() === 'k';
}

function ListComponent({
  children, searchBarPlaceholder, onSearchTextChange, isLoading,
  searchText: controlledSearch, filtering, isShowingDetail,
  navigationTitle, searchBarAccessory, throttle,
  selectedItemId, onSelectionChange, actions: listActions,
}: any) {
  const extInfo = useContext(ExtensionInfoReactContext);
  const [internalSearch, setInternalSearch] = useState('');
  const searchText = controlledSearch ?? internalSearch;
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [showActions, setShowActions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { pop } = useNavigation();

  // Track the selected item's section so we can stabilize selection
  // when items move between sections (e.g. mark complete/incomplete).
  const prevSelectedSectionRef = useRef<string | undefined>(undefined);

  // ── Item registry (ref-based to avoid render loops) ────────────
  const registryRef = useRef(new Map<string, ItemRegistration>());
  const [registryVersion, setRegistryVersion] = useState(0);
  const pendingRef = useRef(false);
  const lastSnapshotRef = useRef('');

  const scheduleRegistryUpdate = useCallback(() => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    queueMicrotask(() => {
      pendingRef.current = false;
      const entries = Array.from(registryRef.current.values());
      const snapshot = entries.map(e => {
        const t = typeof e.props.title === 'string' ? e.props.title : (e.props.title as any)?.value || '';
        const s = typeof e.props.subtitle === 'string' ? e.props.subtitle : (e.props.subtitle as any)?.value || '';
        const detail = e.props.detail;
        const detailSig = React.isValidElement(detail)
          ? `${String((detail.type as any)?.name || (detail.type as any)?.displayName || detail.type)}:${
            typeof (detail.props as any)?.markdown === 'string' ? (detail.props as any).markdown : ''
          }:${Boolean((detail.props as any)?.isLoading)}`
          : '';
        // Include the actions element's component type in the snapshot.
        // When the actions switch (e.g. ActionPanel → ListActions), the
        // type (function ref) changes, the snapshot changes, and we
        // re-render so the correct actions are collected.
        const atype = e.props.actions?.type as any;
        const at = atype?.name || atype?.displayName || typeof atype || '';
        return `${e.id}:${t}:${s}:${e.sectionTitle || ''}:${at}:${detailSig}`;
      }).join('|');
      if (snapshot !== lastSnapshotRef.current) {
        lastSnapshotRef.current = snapshot;
        setRegistryVersion(v => v + 1);
      }
    });
  }, []);

  const registryAPI = useMemo<ListRegistryAPI>(() => ({
    set(id, data) {
      const existing = registryRef.current.get(id);
      if (existing) {
        existing.props = data.props;
        existing.sectionTitle = data.sectionTitle;
        existing.order = data.order;
      } else {
        registryRef.current.set(id, { id, ...data });
      }
      scheduleRegistryUpdate();
    },
    delete(id) {
      if (registryRef.current.has(id)) {
        registryRef.current.delete(id);
        scheduleRegistryUpdate();
      }
    },
  }), [scheduleRegistryUpdate]);

  // ── Collect sorted items from registry ─────────────────────────
  const allItems = useMemo(() => {
    return Array.from(registryRef.current.values()).sort((a, b) => a.order - b.order);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registryVersion]);

  // ── Filtering ──────────────────────────────────────────────────
  const filteredItems = useMemo(() => {
    if (onSearchTextChange || filtering === false || !searchText.trim()) return allItems;
    const q = searchText.toLowerCase();
    return allItems.filter(item => {
      const t = (typeof item.props.title === 'string' ? item.props.title : (item.props.title as any)?.value || '').toLowerCase();
      const s = (typeof item.props.subtitle === 'string' ? item.props.subtitle : (item.props.subtitle as any)?.value || '').toLowerCase();
      return t.includes(q) || s.includes(q) || item.props.keywords?.some((k: string) => k.toLowerCase().includes(q));
    });
  }, [allItems, searchText, filtering, onSearchTextChange]);

  const shouldUseEmojiGrid = useMemo(() => {
    if (isShowingDetail) return false;
    if (filteredItems.length < 24) return false;

    const iconToEmoji = (icon: any): string => {
      if (typeof icon === 'string') return icon;
      if (!icon || typeof icon !== 'object') return '';
      const source = icon.source ?? icon.light ?? icon.dark;
      if (typeof source === 'string') return source;
      if (source && typeof source === 'object') {
        if (typeof source.light === 'string') return source.light;
        if (typeof source.dark === 'string') return source.dark;
      }
      return '';
    };

    let emojiIcons = 0;
    let iconsWithValue = 0;
    for (const item of filteredItems) {
      if ((item as any)?.props?.detail) return false;
      const emojiCandidate = iconToEmoji((item as any)?.props?.icon).trim();
      if (!emojiCandidate) continue;
      iconsWithValue += 1;
      if (isEmojiOrSymbol(emojiCandidate)) emojiIcons += 1;
    }

    if (iconsWithValue < Math.ceil(filteredItems.length * 0.95)) return false;
    return emojiIcons / Math.max(1, iconsWithValue) >= 0.95;
  }, [filteredItems, isShowingDetail]);

  const emojiGridCols = 8;

  // ── Search bar control ─────────────────────────────────────────
  // Debounce the extension's onSearchTextChange callback to avoid excessive API calls
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSearchChange = useCallback((text: string) => {
    setInternalSearch(text);
    setSelectedIdx(0);
    if (onSearchTextChange) {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      if (throttle !== false) {
        searchDebounceRef.current = setTimeout(() => {
          onSearchTextChange(text);
        }, 300);
      } else {
        onSearchTextChange(text);
      }
    }
  }, [onSearchTextChange, throttle]);
  useEffect(() => {
    return () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current); };
  }, []);

  // Register clearSearchBar callback
  useEffect(() => {
    _clearSearchBarCallback = () => handleSearchChange('');
    return () => { _clearSearchBarCallback = null; };
  }, [handleSearchChange]);

  // ── Action collection via registry ─────────────────────────────
  // We render the active actions element in a hidden area with
  // ActionRegistryContext so hooks in wrapper components work.
  // IMPORTANT: Use a SINGLE registry and render only ONE actions element
  // at a time. Item-level actions take priority; list-level actions are
  // the fallback (for empty state). Rendering both simultaneously causes
  // duplicate component mounts sharing the same atom state, leading to
  // double mutations (e.g. duplicate todo items).
  const selectedItem = filteredItems[selectedIdx];
  const [emptyViewProps, setEmptyViewProps] = useState<{
    title?: string;
    description?: string;
    icon?: any;
    actions?: React.ReactElement;
  } | null>(null);

  const { collectedActions: selectedActions, registryAPI: actionRegistry } = useCollectedActions();

  // Determine which actions element to render — item actions take priority
  const activeActionsElement =
    selectedItem?.props?.actions ||
    (filteredItems.length === 0 ? emptyViewProps?.actions : null) ||
    listActions;

  const primaryAction = selectedActions[0];

  // ── Keyboard handler ───────────────────────────────────────────
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // ⌘K toggles action panel
    if (isMetaK(e)) {
      e.preventDefault();
      setShowActions(prev => !prev);
      return;
    }

    // ── Extension-defined shortcuts (⌘D, ⌘E, ⌘T, etc.) ────────
    // Must check BEFORE the showActions bail-out so shortcuts
    // work regardless of whether the action panel is open.
    if ((e.metaKey || e.altKey || e.ctrlKey) && !e.repeat) {
      for (const action of selectedActions) {
        if (action.shortcut && matchesShortcut(e, action.shortcut)) {
          e.preventDefault();
          e.stopPropagation();
          setShowActions(false); // close panel if open
          action.execute();
          // Refocus search input so edit mode works (e.g. ⌘E puts text in bar)
          setTimeout(() => inputRef.current?.focus(), 0);
          return;
        }
      }
    }

    if (showActions) return; // Let the overlay handle arrow/enter/escape

    switch (e.key) {
      case 'ArrowRight':
        if (shouldUseEmojiGrid) {
          e.preventDefault();
          setSelectedIdx(p => Math.min(p + 1, filteredItems.length - 1));
          break;
        }
        break;
      case 'ArrowLeft':
        if (shouldUseEmojiGrid) {
          e.preventDefault();
          setSelectedIdx(p => Math.max(p - 1, 0));
          break;
        }
        break;
      case 'ArrowDown':
        e.preventDefault();
        if (shouldUseEmojiGrid) {
          setSelectedIdx(p => Math.min(p + emojiGridCols, filteredItems.length - 1));
        } else {
          setSelectedIdx(p => Math.min(p + 1, filteredItems.length - 1));
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (shouldUseEmojiGrid) {
          setSelectedIdx(p => Math.max(p - emojiGridCols, 0));
        } else {
          setSelectedIdx(p => Math.max(p - 1, 0));
        }
        break;
      case 'Enter':
        e.preventDefault();
        if (e.repeat) break; // Ignore key auto-repeat to prevent duplicate actions
        if (primaryAction) {
          primaryAction.execute();
        }
        break;
      case 'Escape':
        e.preventDefault();
        pop();
        break;
    }
  }, [filteredItems.length, selectedIdx, pop, primaryAction, showActions, selectedActions, shouldUseEmojiGrid]);

  // ── Window-level shortcut listener (backup) ────────────────────
  // Capture phase fires before React's delegated handler, providing
  // a reliable backup for extension shortcuts.
  const selectedActionsRef = useRef(selectedActions);
  selectedActionsRef.current = selectedActions;
  const showActionsRef = useRef(showActions);
  showActionsRef.current = showActions;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const actions = selectedActionsRef.current;
      if (isMetaK(e) && !e.repeat) {
        e.preventDefault();
        e.stopPropagation();
        setShowActions(prev => !prev);
        return;
      }
      if (!e.metaKey && !e.altKey && !e.ctrlKey) return;
      if (e.repeat) return;

      for (const action of actions) {
        if (action.shortcut && matchesShortcut(e, action.shortcut)) {
          e.preventDefault();
          e.stopPropagation();
          setShowActions(false); // close panel if open
          action.execute();
          // Refocus search input so edit mode works
          setTimeout(() => inputRef.current?.focus(), 0);
          return;
        }
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, []);

  // ── Selection stabilization ─────────────────────────────────────
  // When items change (e.g. mark complete moves an item between sections),
  // the flat index stays the same but may now point into a different section.
  // We stabilize by keeping the selection in the original section.
  // When the user navigates (arrow keys), we just update the tracked section.
  const prevFilteredItemsRef = useRef(filteredItems);

  useEffect(() => {
    const itemsChanged = prevFilteredItemsRef.current !== filteredItems;
    prevFilteredItemsRef.current = filteredItems;
    const currentItem = filteredItems[selectedIdx];

    if (itemsChanged) {
      // Clamp if out of bounds
      if (selectedIdx >= filteredItems.length && filteredItems.length > 0) {
        setSelectedIdx(filteredItems.length - 1);
        return;
      }
      // If the item at selectedIdx moved to a different section, try to
      // stay in the original section by looking backward (item above).
      const prevSection = prevSelectedSectionRef.current;
      if (prevSection !== undefined && currentItem && currentItem.sectionTitle !== prevSection) {
        for (let i = selectedIdx - 1; i >= 0; i--) {
          if (filteredItems[i].sectionTitle === prevSection) {
            setSelectedIdx(i);
            return; // ref will update on the re-render triggered by setSelectedIdx
          }
        }
        // No item above in same section — try forward
        for (let i = selectedIdx + 1; i < filteredItems.length; i++) {
          if (filteredItems[i].sectionTitle === prevSection) {
            setSelectedIdx(i);
            return;
          }
        }
      }
    }

    // Update tracked section for next comparison
    if (currentItem) {
      prevSelectedSectionRef.current = currentItem.sectionTitle;
    }
  }, [filteredItems, selectedIdx]);

  // ── Scroll selected into view ──────────────────────────────────
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${selectedIdx}"]`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedIdx]);

  // Focus input
  useEffect(() => { inputRef.current?.focus(); }, []);

  // Notify selection change
  useEffect(() => {
    if (onSelectionChange && filteredItems[selectedIdx]) {
      onSelectionChange(filteredItems[selectedIdx]?.props?.id || null);
    }
  }, [selectedIdx, onSelectionChange, filteredItems]);

  // ── Group items by section ─────────────────────────────────────
  const groupedItems = useMemo(() => {
    const groups: { title?: string; items: { item: ItemRegistration; globalIdx: number }[] }[] = [];
    let globalIdx = 0;
    let curSection: string | undefined | null = null;

    for (const item of filteredItems) {
      if (item.sectionTitle !== curSection || groups.length === 0) {
        curSection = item.sectionTitle;
        groups.push({ title: item.sectionTitle, items: [] });
      }
      groups[groups.length - 1].items.push({ item, globalIdx: globalIdx++ });
    }
    return groups;
  }, [filteredItems]);

  // ── Detail panel ───────────────────────────────────────────────
  const detailElement = selectedItem?.props?.detail;
  const footerTitle = navigationTitle
    || extInfo.extensionDisplayName
    || _extensionContext.extensionDisplayName
    || _extensionContext.extensionName
    || 'Extension';
  const footerIcon = extInfo.extensionIconDataUrl || _extensionContext.extensionIconDataUrl;

  // ── Execute action and close panel ─────────────────────────────
  const handleActionExecute = useCallback((action: ExtractedAction) => {
    setShowActions(false);
    action.execute();
    // Refocus search input after panel closes (for edit actions, etc.)
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const handleItemContextMenu = useCallback((idx: number, e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedIdx(idx);
    setShowActions(true);
  }, []);

  // ── Render ─────────────────────────────────────────────────────

  const listContent = (
    <div ref={listRef} className="flex-1 overflow-y-auto py-0">
      {isLoading && filteredItems.length === 0 ? (
        <div className="flex items-center justify-center h-full text-white/50"><p className="text-sm">Loading…</p></div>
      ) : filteredItems.length === 0 ? (
        emptyViewProps ? (
          <ListEmptyView
            title={emptyViewProps.title}
            description={emptyViewProps.description}
            icon={emptyViewProps.icon}
            actions={emptyViewProps.actions}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-white/40"><p className="text-sm">No results</p></div>
        )
      ) : shouldUseEmojiGrid ? (
        groupedItems.map((group, gi) => (
          <div key={gi} className="mb-2">
            {group.title && (
              <div className="px-4 pt-2 pb-1 text-[11px] uppercase tracking-wider text-white/30 font-medium select-none">
                {group.title}
                <span className="ml-2 text-white/40 normal-case">{group.items.length}</span>
              </div>
            )}
            <div className="px-2 pb-1 grid gap-2" style={{ gridTemplateColumns: `repeat(${emojiGridCols}, 1fr)` }}>
              {group.items.map(({ item, globalIdx }) => {
                const title = typeof item.props.title === 'string' ? item.props.title : (item.props.title as any)?.value || '';
                return (
                  <ListEmojiGridItemRenderer
                    key={item.id}
                    icon={item.props.icon}
                    title={title}
                    isSelected={globalIdx === selectedIdx}
                    dataIdx={globalIdx}
                    onSelect={() => setSelectedIdx(globalIdx)}
                    onActivate={() => setSelectedIdx(globalIdx)}
                    onContextAction={(e) => handleItemContextMenu(globalIdx, e)}
                  />
                );
              })}
            </div>
          </div>
        ))
      ) : (
        groupedItems.map((group, gi) => (
          <div key={gi} className="mb-0">
            {group.title && (
              <div className="px-4 pt-0.5 pb-1 text-[11px] uppercase tracking-wider text-white/30 font-medium select-none">{group.title}</div>
            )}
            {group.items.map(({ item, globalIdx }) => (
              <ListItemRenderer
                key={item.id}
                {...item.props}
                assetsPath={extInfo.assetsPath || getExtensionContext().assetsPath}
                isSelected={globalIdx === selectedIdx}
                dataIdx={globalIdx}
                onSelect={() => setSelectedIdx(globalIdx)}
                onActivate={() => setSelectedIdx(globalIdx)}
                onContextAction={(e) => handleItemContextMenu(globalIdx, e)}
              />
            ))}
          </div>
        ))
      )}
    </div>
  );

  const detailPanel = isShowingDetail && detailElement ? (
    <div className="flex-1 border-l border-white/[0.06] overflow-y-auto">
      <div className="p-4">{detailElement}</div>
    </div>
  ) : null;

  return (
    <ListRegistryContext.Provider value={registryAPI}>
      {/* Hidden render area — children mount here and register items via context */}
      <div style={{ display: 'none' }}>
        <EmptyViewRegistryContext.Provider value={setEmptyViewProps}>
          {children}
        </EmptyViewRegistryContext.Provider>
        {/* Render ONE actions element in registry context so hooks work.
            Item-level actions take priority; list-level is fallback. */}
        {activeActionsElement && (
          <ActionRegistryContext.Provider value={actionRegistry}>
            <div key={selectedItem?.id || (filteredItems.length === 0 ? '__list_empty_actions' : '__list_actions')}>
              {activeActionsElement}
            </div>
          </ActionRegistryContext.Provider>
        )}
      </div>

      <div className="flex flex-col h-full" onKeyDown={handleKeyDown}>
        {/* ── Search bar - transparent background ──────────────────────────────────────── */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.06]">
          {/* Always show back button */}
          <button onClick={pop} className="text-white/30 hover:text-white/60 transition-colors flex-shrink-0 p-0.5">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          </button>
          <input
            ref={inputRef}
            type="text"
            placeholder={searchBarPlaceholder || 'Search…'}
            value={searchText}
            onChange={e => handleSearchChange(e.target.value)}
            className="flex-1 bg-transparent border-none outline-none text-white/90 placeholder-white/30 text-[14px] font-light"
            autoFocus
          />
          {searchBarAccessory && (
            <div className="flex-shrink-0">{searchBarAccessory}</div>
          )}
        </div>

        {/* ── Main content ────────────────────────────────────── */}
        {isShowingDetail ? (
          <div className="flex flex-1 overflow-hidden">
            <div className="w-1/3 flex flex-col overflow-hidden">{listContent}</div>
            {detailPanel}
          </div>
        ) : (
          listContent
        )}

        {/* ── Footer - lighter background ──────────────────────────────────────────── */}
        <div className="flex items-center px-4 py-3 border-t border-white/[0.06]" style={{ background: 'rgba(28,28,32,0.90)' }}>
          <div className="flex items-center gap-2 text-white/40 text-xs flex-1 min-w-0 font-medium">
            {footerIcon ? <img src={footerIcon} alt="" className="w-4 h-4 rounded-sm object-contain flex-shrink-0" /> : null}
            <span className="truncate">{footerTitle}</span>
          </div>
          {primaryAction && (
            <button
              type="button"
              onClick={() => primaryAction.execute()}
              className="flex items-center gap-2 mr-3 text-white hover:text-white/90 transition-colors"
            >
              <span className="text-white text-xs font-semibold">{primaryAction.title}</span>
              <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-white/[0.08] text-[11px] text-white/40 font-medium">↩</kbd>
            </button>
          )}
          <button
            onClick={() => setShowActions(true)}
            className="flex items-center gap-1.5 text-white/50 hover:text-white/70 transition-colors"
          >
            <span className="text-xs font-medium">Actions</span>
            <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-white/[0.08] text-[11px] text-white/40 font-medium">⌘</kbd>
            <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-white/[0.08] text-[11px] text-white/40 font-medium">K</kbd>
          </button>
        </div>
      </div>

      {/* ── Action Panel Overlay ──────────────────────────────── */}
      {showActions && selectedActions.length > 0 && (
        <ActionPanelOverlay
          actions={selectedActions}
          onClose={() => setShowActions(false)}
          onExecute={handleActionExecute}
        />
      )}
    </ListRegistryContext.Provider>
  );
}

// List.Item.Detail — inline detail view for list items (used with isShowingDetail)
const ListItemDetailComponent = ({ markdown, isLoading, metadata, children }: {
  markdown?: string; isLoading?: boolean; metadata?: React.ReactElement; children?: React.ReactNode;
}) => {
  return (
    <div className="flex flex-col h-full overflow-y-auto p-4">
      {isLoading ? (
        <div className="flex items-center justify-center h-full text-white/50"><p className="text-sm">Loading…</p></div>
      ) : (
        <>
          {markdown && <div className="text-white/80 text-sm leading-relaxed">{renderSimpleMarkdown(markdown)}</div>}
          {metadata}
          {children}
        </>
      )}
    </div>
  );
};

// Note: Metadata is assigned to ListItemDetail later (after Metadata is defined)
const ListItemDetail: any = Object.assign(ListItemDetailComponent, {});

const ListItem = Object.assign(ListItemComponent, { Detail: ListItemDetail });

export const List = Object.assign(ListComponent, {
  Item: ListItem,
  Section: ListSectionComponent,
  EmptyView: ListEmptyView,
  Dropdown: ListDropdown,
});

// =====================================================================
// ─── Detail ─────────────────────────────────────────────────────────
// =====================================================================

// ─── Simple Markdown Renderer ──────────────────────────────────────
// Handles images, headings, bold, italic, code blocks, links, lists.
// Resolves relative image paths via the extension's assetsPath.

function resolveMarkdownImageSrc(src: string): string {
  // Strip Raycast-specific query params like ?&raycast-height=350
  const cleanSrc = src.replace(/\?.*$/, '');
  // If it's already an absolute URL or data URI, return as-is
  if (/^https?:\/\//.test(cleanSrc) || cleanSrc.startsWith('data:') || cleanSrc.startsWith('file://')) return cleanSrc;
  if (cleanSrc.startsWith('sc-asset://')) return normalizeScAssetUrl(cleanSrc);
  // Resolve relative to extension assets using custom sc-asset:// protocol
  if (cleanSrc.startsWith('/')) return toScAssetUrl(cleanSrc);
  const ctx = getExtensionContext();
  if (ctx.assetsPath) {
    return toScAssetUrl(`${ctx.assetsPath}/${cleanSrc}`);
  }
  return cleanSrc;
}

function parseHtmlImgTag(html: string): { src: string; alt?: string; height?: number; width?: number } | null {
  const tag = html.trim();
  if (!/^<img\b/i.test(tag)) return null;

  const attrs: Record<string, string> = {};
  const attrRegex = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match: RegExpExecArray | null;
  while ((match = attrRegex.exec(tag))) {
    const name = (match[1] || '').toLowerCase();
    const value = match[3] ?? match[4] ?? match[5] ?? '';
    attrs[name] = value;
  }

  if (!attrs.src) return null;
  const parsedHeight = attrs.height ? Number(attrs.height) : undefined;
  const parsedWidth = attrs.width ? Number(attrs.width) : undefined;

  return {
    src: resolveMarkdownImageSrc(attrs.src),
    alt: attrs.alt,
    height: Number.isFinite(parsedHeight) && parsedHeight! > 0 ? parsedHeight : undefined,
    width: Number.isFinite(parsedWidth) && parsedWidth! > 0 ? parsedWidth : undefined,
  };
}

function renderSimpleMarkdown(md: string): React.ReactNode[] {
  const lines = md.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code block
    if (line.startsWith('```')) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      elements.push(
        <pre key={elements.length} className="bg-white/[0.06] rounded-lg p-3 my-2 overflow-x-auto">
          <code className="text-xs text-white/70 font-mono">{codeLines.join('\n')}</code>
        </pre>
      );
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      const sizes = ['text-xl', 'text-lg', 'text-base', 'text-sm', 'text-sm', 'text-xs'];
      elements.push(
        <div key={elements.length} className={`${sizes[level - 1]} font-bold text-white/90 mt-3 mb-1`}>
          {renderInlineMarkdown(text)}
        </div>
      );
      i++;
      continue;
    }

    // Image on its own line
    const imgMatch = line.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/);
    if (imgMatch) {
      const alt = imgMatch[1];
      const src = resolveMarkdownImageSrc(imgMatch[2]);
      elements.push(
        <div key={elements.length} className="my-2 flex justify-center">
          <img src={src} alt={alt} className="max-w-full rounded-lg" style={{ maxHeight: 350 }} />
        </div>
      );
      i++;
      continue;
    }

    // Raw HTML image on its own line: <img src="..." ... />
    const htmlImg = parseHtmlImgTag(line);
    if (htmlImg) {
      elements.push(
        <div key={elements.length} className="my-2 flex justify-center">
          <img
            src={htmlImg.src}
            alt={htmlImg.alt || ''}
            className="max-w-full rounded-lg"
            style={{
              maxHeight: htmlImg.height || 350,
              ...(htmlImg.width ? { width: htmlImg.width } : {}),
            }}
          />
        </div>
      );
      i++;
      continue;
    }

    // Unordered list item
    if (/^[-*]\s+/.test(line)) {
      const text = line.replace(/^[-*]\s+/, '');
      elements.push(
        <div key={elements.length} className="flex items-start gap-2 text-sm text-white/80 ml-2">
          <span className="text-white/40 mt-0.5">•</span>
          <span>{renderInlineMarkdown(text)}</span>
        </div>
      );
      i++;
      continue;
    }

    // Ordered list item
    const olMatch = line.match(/^(\d+)\.\s+(.*)$/);
    if (olMatch) {
      elements.push(
        <div key={elements.length} className="flex items-start gap-2 text-sm text-white/80 ml-2">
          <span className="text-white/40 mt-0.5">{olMatch[1]}.</span>
          <span>{renderInlineMarkdown(olMatch[2])}</span>
        </div>
      );
      i++;
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      elements.push(<hr key={elements.length} className="border-white/[0.08] my-3" />);
      i++;
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      elements.push(<div key={elements.length} className="h-2" />);
      i++;
      continue;
    }

    // Regular paragraph
    elements.push(
      <p key={elements.length} className="text-sm text-white/80 leading-relaxed">
        {renderInlineMarkdown(line)}
      </p>
    );
    i++;
  }

  return elements;
}

function renderInlineMarkdown(text: string): React.ReactNode {
  // Process inline markdown: images, links, bold, italic, code, strikethrough
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // Inline raw HTML image: <img src="..." ... />
    const htmlImgMatch = remaining.match(/^<img\b[^>]*\/?>/i);
    if (htmlImgMatch) {
      const parsed = parseHtmlImgTag(htmlImgMatch[0]);
      if (parsed) {
        parts.push(
          <img
            key={key++}
            src={parsed.src}
            alt={parsed.alt || ''}
            className="inline rounded"
            style={{
              maxHeight: parsed.height || 350,
              ...(parsed.width ? { width: parsed.width } : {}),
            }}
          />
        );
        remaining = remaining.slice(htmlImgMatch[0].length);
        continue;
      }
    }

    // Inline image: ![alt](src)
    const imgMatch = remaining.match(/^!\[([^\]]*)\]\(([^)]+)\)/);
    if (imgMatch) {
      const src = resolveMarkdownImageSrc(imgMatch[2]);
      parts.push(<img key={key++} src={src} alt={imgMatch[1]} className="inline max-h-[350px] rounded" />);
      remaining = remaining.slice(imgMatch[0].length);
      continue;
    }

    // Link: [text](url)
    const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/);
    if (linkMatch) {
      parts.push(<a key={key++} href={linkMatch[2]} className="text-blue-400 hover:underline" onClick={(e) => { e.preventDefault(); (window as any).electron?.openUrl?.(linkMatch[2]); }}>{linkMatch[1]}</a>);
      remaining = remaining.slice(linkMatch[0].length);
      continue;
    }

    // Inline code: `code`
    const codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch) {
      parts.push(<code key={key++} className="bg-white/[0.08] px-1 py-0.5 rounded text-xs font-mono text-white/70">{codeMatch[1]}</code>);
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    // Bold: **text**
    const boldMatch = remaining.match(/^\*\*([^*]+)\*\*/);
    if (boldMatch) {
      parts.push(<strong key={key++} className="text-white/90 font-semibold">{boldMatch[1]}</strong>);
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    // Italic: *text*
    const italicMatch = remaining.match(/^\*([^*]+)\*/);
    if (italicMatch) {
      parts.push(<em key={key++}>{italicMatch[1]}</em>);
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }

    // Plain character
    // Gather all plain text until next special character
    const plainMatch = remaining.match(/^[^![\]`*]+/);
    if (plainMatch) {
      parts.push(plainMatch[0]);
      remaining = remaining.slice(plainMatch[0].length);
    } else {
      parts.push(remaining[0]);
      remaining = remaining.slice(1);
    }
  }

  return parts.length === 1 ? parts[0] : <>{parts}</>;
}

function DetailComponent({ markdown, isLoading, children, actions, metadata, navigationTitle }: {
  markdown?: string; children?: React.ReactNode; isLoading?: boolean;
  navigationTitle?: string; actions?: React.ReactElement; metadata?: React.ReactElement;
}) {
  const extInfo = useContext(ExtensionInfoReactContext);
  const [showActions, setShowActions] = useState(false);
  const { pop } = useNavigation();
  const { collectedActions: detailActions, registryAPI: detailActionRegistry } = useCollectedActions();
  const primaryAction = detailActions[0];
  const footerTitle = navigationTitle
    || extInfo.extensionDisplayName
    || _extensionContext.extensionDisplayName
    || _extensionContext.extensionName
    || 'Extension';
  const footerIcon = extInfo.extensionIconDataUrl || _extensionContext.extensionIconDataUrl;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); pop(); return; }
      if (isMetaK(e)) { e.preventDefault(); setShowActions(prev => !prev); return; }
      if (e.key === 'Enter' && e.metaKey && !e.repeat && primaryAction) { e.preventDefault(); primaryAction.execute(); return; }
      if (!e.repeat) {
        for (const action of detailActions) {
          if (action.shortcut && matchesShortcut(e, action.shortcut)) {
            e.preventDefault();
            action.execute();
            return;
          }
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [pop, primaryAction, detailActions]);

  const handleActionExecute = useCallback((action: ExtractedAction) => {
    setShowActions(false);
    action.execute();
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (detailActions.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    setShowActions(true);
  }, [detailActions.length]);

  return (
    <div className="flex flex-col h-full" onContextMenu={handleContextMenu}>
      {/* Hidden render area for actions so hooks inside actions work */}
      {actions && (
        <div style={{ display: 'none' }}>
          <ActionRegistryContext.Provider value={detailActionRegistry}>
            {actions}
          </ActionRegistryContext.Provider>
        </div>
      )}

      {/* ── Navigation bar ─────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.06]">
        <button onClick={pop} className="text-white/30 hover:text-white/60 transition-colors flex-shrink-0 p-0.5">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <div className="h-full" />
        ) : (
          <>
            {markdown && <div className="text-white/80 text-sm leading-relaxed">{renderSimpleMarkdown(markdown)}</div>}
            {metadata}
            {children}
          </>
        )}
      </div>

      {/* ── Footer ─────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="flex items-center px-4 py-3.5 border-t border-white/[0.06]" style={{ background: 'rgba(28,28,32,0.90)' }}>
          <div className="flex items-center gap-2 text-white/80 text-sm">
            <div className="w-4 h-4 border-2 border-white/20 border-t-white/70 rounded-full animate-spin" />
            <span>{navigationTitle || 'Loading…'}</span>
          </div>
        </div>
      ) : detailActions.length > 0 && (
        <div className="flex items-center px-4 py-3.5 border-t border-white/[0.06]" style={{ background: 'rgba(28,28,32,0.90)' }}>
          <div className="flex items-center gap-2 text-white/40 text-xs flex-1 min-w-0 font-medium">
            {footerIcon ? <img src={footerIcon} alt="" className="w-4 h-4 rounded-sm object-contain flex-shrink-0" /> : null}
            <span className="truncate">{footerTitle}</span>
          </div>
          {primaryAction && (
            <button
              type="button"
              onClick={() => primaryAction.execute()}
              className="flex items-center gap-2 mr-3 text-white hover:text-white/90 transition-colors"
            >
              <span className="text-white text-xs font-semibold">{primaryAction.title}</span>
              {primaryAction.shortcut ? (
                <span className="flex items-center gap-0.5">{renderShortcut(primaryAction.shortcut)}</span>
              ) : (
                <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-white/[0.08] text-[11px] text-white/40 font-medium">↩</kbd>
              )}
            </button>
          )}
          <button
            onClick={() => setShowActions(true)}
            className="flex items-center gap-1.5 text-white/50 hover:text-white/70 transition-colors"
          >
            <span className="text-xs font-medium">Actions</span>
            <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-white/[0.08] text-[11px] text-white/40 font-medium">⌘</kbd>
            <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-white/[0.08] text-[11px] text-white/40 font-medium">K</kbd>
          </button>
        </div>
      )}

      {/* ── Action Panel Overlay ──────────────────────────────── */}
      {showActions && detailActions.length > 0 && (
        <ActionPanelOverlay
          actions={detailActions}
          onClose={() => setShowActions(false)}
          onExecute={handleActionExecute}
        />
      )}
    </div>
  );
}

function resolveMetadataText(
  input: unknown
): { value: string; color?: string } {
  if (input == null) return { value: '' };
  if (typeof input === 'object' && !Array.isArray(input)) {
    const maybe = input as { value?: unknown; color?: unknown };
    if ('value' in maybe || 'color' in maybe) {
      const rawValue = maybe.value == null ? '' : String(maybe.value);
      return {
        value: rawValue,
        color: resolveTintColor(maybe.color),
      };
    }
  }
  return { value: String(input) };
}

const MetadataLabel = ({ title, text, icon }: { title: string; text?: unknown; icon?: any }) => {
  const normalized = resolveMetadataText(text);
  return (
    <div className="text-xs text-white/50 flex items-center gap-1.5">
      <span className="text-white/30">{title}: </span>
      {icon ? <span className="inline-flex items-center">{renderIcon(icon, 'w-3 h-3')}</span> : null}
      <span style={normalized.color ? { color: normalized.color } : undefined}>{normalized.value}</span>
    </div>
  );
};
const MetadataSeparator = () => <hr className="border-white/[0.06] my-2" />;
const MetadataLink = ({ title, target, text }: { title: string; target: string; text: string }) => (
  <div className="text-xs"><span className="text-white/30">{title}: </span><a href={target} className="text-blue-400 hover:underline">{text}</a></div>
);
const MetadataTagListItem = ({ text, color }: any) => {
  const normalized = resolveMetadataText(text);
  const tint = resolveTintColor(color) || normalized.color;
  const tagBg = tint
    ? (addHexAlpha(tint, '22') || 'rgba(255,255,255,0.1)')
    : 'rgba(255,255,255,0.1)';
  return (
    <span
      className="text-xs px-1.5 py-0.5 rounded mr-1"
      style={{ background: tagBg, color: tint || 'rgba(255,255,255,0.6)' }}
    >
      {normalized.value}
    </span>
  );
};
const MetadataTagList = Object.assign(
  ({ children, title }: any) => <div className="flex flex-wrap gap-1">{title && <span className="text-xs text-white/30 mr-1">{title}:</span>}{children}</div>,
  { Item: MetadataTagListItem }
);

const Metadata = Object.assign(
  ({ children }: { children?: React.ReactNode }) => <div className="space-y-1 mt-4">{children}</div>,
  { Label: MetadataLabel, Separator: MetadataSeparator, Link: MetadataLink, TagList: MetadataTagList }
);

export const Detail = Object.assign(DetailComponent, { Metadata });

// Assign Metadata to List.Item.Detail (deferred because Metadata is defined after List)
ListItemDetail.Metadata = Metadata;

// =====================================================================
// ─── Form ───────────────────────────────────────────────────────────
// =====================================================================

// Form context to collect values from all fields
interface FormContextType {
  values: Record<string, any>;
  setValue: (id: string, value: any) => void;
  errors: Record<string, string>;
  setError: (id: string, error: string) => void;
}

const FormContext = createContext<FormContextType>({
  values: {},
  setValue: () => {},
  errors: {},
  setError: () => {},
});

// Global ref to access current form values (for Action.SubmitForm)
let _currentFormValues: Record<string, any> = {};
let _currentFormErrors: Record<string, string> = {};

export function getFormValues(): Record<string, any> {
  return { ..._currentFormValues };
}

export function getFormErrors(): Record<string, string> {
  return { ..._currentFormErrors };
}

function FormComponent({ children, actions, navigationTitle, isLoading, enableDrafts, draftValues }: {
  children?: React.ReactNode; actions?: React.ReactElement; navigationTitle?: string;
  isLoading?: boolean; enableDrafts?: boolean; draftValues?: Record<string, any>;
}) {
  const extInfo = useContext(ExtensionInfoReactContext);
  const [values, setValues] = useState<Record<string, any>>(draftValues || {});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showActions, setShowActions] = useState(false);
  const { pop } = useNavigation();

  const setValue = useCallback((id: string, value: any) => {
    setValues(prev => {
      const next = { ...prev, [id]: value };
      _currentFormValues = next;
      return next;
    });
    setErrors(prev => {
      const next = { ...prev };
      delete next[id];
      _currentFormErrors = next;
      return next;
    });
  }, []);

  const setError = useCallback((id: string, error: string) => {
    setErrors(prev => {
      const next = { ...prev, [id]: error };
      _currentFormErrors = next;
      return next;
    });
  }, []);

  useEffect(() => {
    _currentFormValues = values;
    _currentFormErrors = errors;
  }, [values, errors]);

  // ── Action collection via registry ─────────────────────────────
  const { collectedActions: formActions, registryAPI: formActionRegistry } = useCollectedActions();
  const primaryAction = formActions[0];
  const footerTitle = navigationTitle
    || extInfo.extensionDisplayName
    || _extensionContext.extensionDisplayName
    || _extensionContext.extensionName
    || 'Extension';
  const footerIcon = extInfo.extensionIconDataUrl || _extensionContext.extensionIconDataUrl;

  // ── Keyboard handler ───────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); pop(); return; }
      // ⌘K toggles action panel
      if (isMetaK(e)) { e.preventDefault(); setShowActions(prev => !prev); return; }
      // ⌘Enter triggers primary action
      if (e.key === 'Enter' && e.metaKey && !e.repeat && primaryAction) { e.preventDefault(); primaryAction.execute(); return; }
      // Extension-defined keyboard shortcuts
      if (!e.repeat) {
        for (const action of formActions) {
          if (action.shortcut && matchesShortcut(e, action.shortcut)) {
            e.preventDefault();
            action.execute();
            return;
          }
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [pop, primaryAction, formActions]);

  const contextValue = useMemo(() => ({ values, setValue, errors, setError }), [values, setValue, errors, setError]);

  const handleActionExecute = useCallback((action: ExtractedAction) => {
    setShowActions(false);
    action.execute();
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (formActions.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    setShowActions(true);
  }, [formActions.length]);

  return (
    <FormContext.Provider value={contextValue}>
      {/* Hidden render area for actions */}
      {actions && (
        <div style={{ display: 'none' }}>
          <ActionRegistryContext.Provider value={formActionRegistry}>
            {actions}
          </ActionRegistryContext.Provider>
        </div>
      )}

      <div className="flex flex-col h-full" onContextMenu={handleContextMenu}>
        {/* ── Navigation bar - same padding as List/main search bar ── */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.06]">
          <button onClick={pop} className="text-white/30 hover:text-white/60 transition-colors flex-shrink-0 p-0.5">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          </button>
        </div>

        {/* ── Form content (horizontal layout) ──────────────────── */}
        <div className="flex-1 overflow-y-auto py-4 px-4">
          {isLoading ? (
            <div className="flex items-center justify-center h-full text-white/50"><p className="text-sm">Loading…</p></div>
          ) : (
            <div className="max-w-2xl mx-auto space-y-3">
              {children}
            </div>
          )}
        </div>

        {/* ── Footer - same as List/main footer ────────────────── */}
        {formActions.length > 0 && (
          <div className="flex items-center px-4 py-3 border-t border-white/[0.06]" style={{ background: 'rgba(28,28,32,0.90)' }}>
            <div className="flex items-center gap-2 text-white/40 text-xs flex-1 min-w-0 font-medium">
              {footerIcon ? <img src={footerIcon} alt="" className="w-4 h-4 rounded-sm object-contain flex-shrink-0" /> : null}
              <span className="truncate">{footerTitle}</span>
            </div>
            {primaryAction && (
              <button
                type="button"
                onClick={() => primaryAction.execute()}
                className="flex items-center gap-2 mr-3 text-white hover:text-white/90 transition-colors"
              >
                <span className="text-white text-xs font-semibold">{primaryAction.title}</span>
                {primaryAction.shortcut ? (
                  <span className="flex items-center gap-0.5">{renderShortcut(primaryAction.shortcut)}</span>
                ) : (
                  <>
                    <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-white/[0.08] text-[11px] text-white/40 font-medium">⌘</kbd>
                    <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-white/[0.08] text-[11px] text-white/40 font-medium">↩</kbd>
                  </>
                )}
              </button>
            )}
            <button
              onClick={() => setShowActions(true)}
              className="flex items-center gap-1.5 text-white/50 hover:text-white/70 transition-colors"
            >
              <span className="text-xs font-medium">Actions</span>
              <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-white/[0.08] text-[11px] text-white/40 font-medium">⌘</kbd>
              <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-white/[0.08] text-[11px] text-white/40 font-medium">K</kbd>
            </button>
          </div>
        )}
      </div>

      {/* ── Action Panel Overlay ──────────────────────────────── */}
      {showActions && formActions.length > 0 && (
        <ActionPanelOverlay
          actions={formActions}
          onClose={() => setShowActions(false)}
          onExecute={handleActionExecute}
        />
      )}
    </FormContext.Provider>
  );
}

// ── Form field helper: horizontal row layout ─────────────────────────
function FormFieldRow({ title, children, error, info }: { title?: string; children: React.ReactNode; error?: string; info?: string }) {
  return (
    <div className="flex items-start gap-4">
      <div className="w-24 flex-shrink-0 pt-2 text-right">
        {title && <label className="text-[13px] font-medium text-white/55">{title}</label>}
      </div>
      <div className="flex-1 min-w-0">
        {children}
        {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
        {info && <p className="text-[12px] text-white/35 mt-1.5">{info}</p>}
      </div>
    </div>
  );
}

FormComponent.TextField = ({ id, title, placeholder, value, onChange, defaultValue, error, info, storeValue, autoFocus }: any) => {
  const form = useContext(FormContext);
  const fieldValue = value ?? form.values[id] ?? defaultValue ?? '';
  const fieldError = error ?? form.errors[id];

  const handleChange = (e: any) => {
    const newValue = e.target.value;
    if (id) form.setValue(id, newValue);
    onChange?.(newValue);
  };

  return (
    <FormFieldRow title={title} error={fieldError} info={info}>
      <input type="text" placeholder={placeholder} value={fieldValue} onChange={handleChange}
        className="w-full bg-white/[0.06] border border-white/[0.12] rounded-lg px-3 py-2 text-[15px] text-white/95 placeholder:text-white/45 outline-none focus:border-white/30" autoFocus={autoFocus} />
    </FormFieldRow>
  );
};

FormComponent.TextArea = ({ id, title, placeholder, value, onChange, defaultValue, error, info, enableMarkdown }: any) => {
  const form = useContext(FormContext);
  const fieldValue = value ?? form.values[id] ?? defaultValue ?? '';
  const fieldError = error ?? form.errors[id];

  const handleChange = (e: any) => {
    const newValue = e.target.value;
    if (id) form.setValue(id, newValue);
    onChange?.(newValue);
  };

  return (
    <FormFieldRow title={title} error={fieldError}>
      <textarea placeholder={placeholder} value={fieldValue} onChange={handleChange} rows={5}
        className="w-full min-h-[140px] bg-white/[0.06] border border-white/[0.12] rounded-xl px-4 py-3 text-[15px] text-white/95 placeholder:text-white/45 outline-none focus:border-white/30 resize-y" />
    </FormFieldRow>
  );
};

FormComponent.PasswordField = ({ id, title, placeholder, value, onChange, defaultValue, error }: any) => {
  const form = useContext(FormContext);
  const fieldValue = value ?? form.values[id] ?? defaultValue ?? '';
  const fieldError = error ?? form.errors[id];

  const handleChange = (e: any) => {
    const newValue = e.target.value;
    if (id) form.setValue(id, newValue);
    onChange?.(newValue);
  };

  return (
    <FormFieldRow title={title} error={fieldError}>
      <input type="password" placeholder={placeholder} value={fieldValue} onChange={handleChange}
        className="w-full bg-white/[0.06] border border-white/[0.12] rounded-lg px-3 py-2 text-[15px] text-white/95 placeholder:text-white/45 outline-none focus:border-white/30" />
    </FormFieldRow>
  );
};

FormComponent.Checkbox = ({ id, title, label, value, onChange, defaultValue, error, storeValue }: any) => {
  const form = useContext(FormContext);
  const fieldValue = value ?? form.values[id] ?? defaultValue ?? false;
  const fieldError = error ?? form.errors[id];

  const handleChange = (e: any) => {
    const newValue = e.target.checked;
    if (id) form.setValue(id, newValue);
    onChange?.(newValue);
  };

  return (
    <FormFieldRow title={title || label} error={fieldError}>
      <label className="flex items-center gap-2 py-1 text-[13px] text-white/80 cursor-pointer">
        <input type="checkbox" checked={fieldValue} onChange={handleChange} className="accent-blue-500" />
        {label && title ? label : null}
      </label>
    </FormFieldRow>
  );
};

FormComponent.Dropdown = Object.assign(
  ({ id, title, children, value, onChange, defaultValue, error, storeValue, isLoading, filtering, throttle }: any) => {
    const form = useContext(FormContext);
    const fieldValue = value ?? form.values[id] ?? defaultValue ?? '';
    const fieldError = error ?? form.errors[id];

    const handleChange = (e: any) => {
      const newValue = e.target.value;
      if (id) form.setValue(id, newValue);
      onChange?.(newValue);
    };

    return (
      <FormFieldRow title={title} error={fieldError}>
        <select value={fieldValue} onChange={handleChange}
          className="w-full bg-white/[0.06] border border-white/[0.12] rounded-lg px-3 py-2 text-[15px] text-white/95 outline-none focus:border-white/30">
          {children}
        </select>
      </FormFieldRow>
    );
  },
  {
    Item: ({ value, title, icon }: any) => <option value={value}>{title}</option>,
    Section: ({ children, title }: any) => <optgroup label={title}>{children}</optgroup>,
  }
);

FormComponent.DatePicker = Object.assign(
  ({ id, title, value, onChange, defaultValue, error, min, max, type }: any) => (
    <FormFieldRow title={title} error={error}>
      <input type={type === 'date' ? 'date' : 'datetime-local'} value={value ? (value instanceof Date ? value.toISOString().slice(0, 16) : value) : ''}
        onChange={(e: any) => onChange?.(e.target.value ? new Date(e.target.value) : null)}
        className="w-full bg-white/[0.06] border border-white/[0.08] rounded-md px-2.5 py-[5px] text-[13px] text-white outline-none focus:border-white/20" />
    </FormFieldRow>
  ),
  { Type: { Date: 'date', DateTime: 'datetime' }, isFullDay: false }
);

FormComponent.Description = ({ text, title }: any) => (
  <div className="flex items-start gap-4">
    <div className="w-24 flex-shrink-0" />
    <p className="text-[13px] text-white/55 leading-relaxed flex-1">{title ? <strong className="text-white/65">{title}: </strong> : null}{text}</p>
  </div>
);

FormComponent.Separator = () => <hr className="border-white/[0.06] my-2" />;

FormComponent.TagPicker = Object.assign(
  ({ id, title, children, value, onChange, error }: any) => (
    <FormFieldRow title={title} error={error}>
      <div className="flex flex-wrap gap-1">{children}</div>
    </FormFieldRow>
  ),
  { Item: ({ value, title }: any) => <span className="text-xs bg-white/10 px-1.5 py-0.5 rounded text-white/60">{title}</span> }
);

FormComponent.FilePicker = ({
  id,
  title,
  value,
  onChange,
  defaultValue,
  allowMultipleSelection,
  canChooseDirectories,
  canChooseFiles,
  showHiddenFiles,
  error,
}: any) => {
  const form = useContext(FormContext);
  const fieldValue = value ?? form.values[id] ?? defaultValue ?? [];
  const fieldError = error ?? form.errors[id];
  const files = Array.isArray(fieldValue) ? fieldValue : (fieldValue ? [fieldValue] : []);

  const pickFiles = async () => {
    const picked = await (window as any).electron?.pickFiles?.({
      allowMultipleSelection: Boolean(allowMultipleSelection),
      canChooseDirectories: Boolean(canChooseDirectories),
      canChooseFiles: canChooseFiles !== false,
      showHiddenFiles: Boolean(showHiddenFiles),
    });
    if (!picked || !Array.isArray(picked)) return;
    if (id) form.setValue(id, picked);
    onChange?.(picked);
  };

  const cta = allowMultipleSelection ? 'Select Files' : 'Select File';

  return (
    <FormFieldRow title={title} error={fieldError}>
      <div className="space-y-2">
        <button
          type="button"
          onClick={pickFiles}
          className="w-full h-10 rounded-lg border border-white/[0.14] bg-white/[0.06] hover:bg-white/[0.10] text-[14px] font-semibold text-white/90 transition-colors"
        >
          {cta}
        </button>
        {files.length > 0 ? (
          <div className="text-[12px] text-white/55 break-all">
            {allowMultipleSelection ? `${files.length} selected` : files[0]}
          </div>
        ) : null}
      </div>
    </FormFieldRow>
  );
};

FormComponent.LinkAccessory = ({ text, target }: any) => (
  <a href={target} className="text-xs text-blue-400 hover:underline">{text}</a>
);

export const Form = FormComponent;

// =====================================================================
// ─── Grid ───────────────────────────────────────────────────────────
// =====================================================================

// ── Grid Item registration context ──────────────────────────────────
// Grid.Item components register themselves with the parent Grid via context,
// following the same pattern as List.Item.

let _gridItemOrderCounter = 0;

interface GridItemRegistration {
  id: string;
  props: {
    title?: string;
    subtitle?: string;
    content?: { source?: string; tintColor?: string } | string;
    actions?: React.ReactElement;
    keywords?: string[];
    id?: string;
    accessory?: any;
    quickLook?: { name?: string; path: string };
  };
  sectionTitle?: string;
  order: number;
}

interface GridRegistryAPI {
  set: (id: string, data: Omit<GridItemRegistration, 'id'>) => void;
  delete: (id: string) => void;
}

const GridRegistryContext = createContext<GridRegistryAPI>({
  set: () => {},
  delete: () => {},
});

const GridSectionTitleContext = createContext<string | undefined>(undefined);

// ── Grid.Item — registers with parent Grid via context ────────────────

function GridItemComponent(props: any) {
  const registry = useContext(GridRegistryContext);
  const sectionTitle = useContext(GridSectionTitleContext);
  const stableId = useRef(props.id || `__gi_${++_gridItemOrderCounter}`).current;
  const order = ++_gridItemOrderCounter;

  registry.set(stableId, { props, sectionTitle, order });

  useEffect(() => {
    return () => registry.delete(stableId);
  }, [stableId, registry]);

  return null;
}

// ── Grid.Section — provides section title context ─────────────────────

function GridSectionComponent({ children, title, subtitle, aspectRatio, columns, fit, inset }: {
  children?: React.ReactNode; title?: string; subtitle?: string;
  aspectRatio?: string; columns?: number; fit?: string; inset?: string;
}) {
  return (
    <GridSectionTitleContext.Provider value={title}>
      {children}
    </GridSectionTitleContext.Provider>
  );
}

// ── GridItemRenderer — visual grid cell ──────────────────────────────

function GridItemRenderer({
  title, subtitle, content, isSelected, dataIdx, onSelect, onActivate, onContextAction,
}: any) {
  const getGridImageSource = (value: any): string => {
    if (!value) return '';

    if (typeof value === 'string') {
      return resolveIconSrc(value);
    }

    if (typeof value === 'object') {
      const directSource = value.source;
      const nestedSource = value.value?.source;
      const candidate = directSource ?? nestedSource;

      if (typeof candidate === 'string') {
        return resolveIconSrc(candidate);
      }

      if (candidate && typeof candidate === 'object') {
        const themed = candidate.dark || candidate.light || '';
        if (typeof themed === 'string') {
          return resolveIconSrc(themed);
        }
      }
    }

    return '';
  };

  const imgSrc = getGridImageSource(content);

  return (
    <div
      data-idx={dataIdx}
      className={`relative rounded-lg cursor-pointer transition-all overflow-hidden flex flex-col ${
        isSelected ? 'ring-2 ring-blue-500 bg-white/[0.08]' : 'hover:bg-white/[0.04]'
      }`}
      style={{ height: '160px' }}
      onClick={onActivate}
      onMouseMove={onSelect}
      onContextMenu={onContextAction}
    >
      {/* Image area — centered, fixed height */}
      <div className="flex-1 flex items-center justify-center overflow-hidden p-1.5 min-h-0">
        {imgSrc ? (
          <img
            src={typeof imgSrc === 'string' ? imgSrc : ''}
            alt={title || ''}
            className="max-w-full max-h-full object-contain rounded"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full bg-white/[0.03] rounded flex items-center justify-center text-white/20 text-2xl">
            {title ? title.charAt(0) : '?'}
          </div>
        )}
      </div>
      {/* Title at bottom */}
      {title && (
        <div className="px-2 pb-2 pt-1 flex-shrink-0">
          <p className="truncate text-[11px] text-white/70 text-center">{title}</p>
          {subtitle && <p className="truncate text-[9px] text-white/30 text-center">{subtitle}</p>}
        </div>
      )}
    </div>
  );
}

// ── GridComponent — main Grid container with full action support ──────

function GridComponent({
  children, columns, inset, isLoading, searchBarPlaceholder, onSearchTextChange,
  filtering, navigationTitle, searchBarAccessory, aspectRatio, fit,
  searchText: controlledSearch, selectedItemId, onSelectionChange, throttle,
  pagination, actions: gridActions,
}: any) {
  const extInfo = useContext(ExtensionInfoReactContext);
  const [internalSearch, setInternalSearch] = useState('');
  const searchText = controlledSearch ?? internalSearch;
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [showActions, setShowActions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const { pop } = useNavigation();

  const cols = columns || 5;

  // ── Item registry ──────────────────────────────────────────────
  const registryRef = useRef(new Map<string, GridItemRegistration>());
  const [registryVersion, setRegistryVersion] = useState(0);
  const pendingRef = useRef(false);
  const lastSnapshotRef = useRef('');

  const scheduleRegistryUpdate = useCallback(() => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    queueMicrotask(() => {
      pendingRef.current = false;
      const entries = Array.from(registryRef.current.values());
      const snapshot = entries.map(e => {
        const t = e.props.title || '';
        const atype = e.props.actions?.type as any;
        const at = atype?.name || atype?.displayName || typeof atype || '';
        return `${e.id}:${t}:${e.sectionTitle || ''}:${at}`;
      }).join('|');
      if (snapshot !== lastSnapshotRef.current) {
        lastSnapshotRef.current = snapshot;
        setRegistryVersion(v => v + 1);
      }
    });
  }, []);

  const registryAPI = useMemo<GridRegistryAPI>(() => ({
    set(id, data) {
      const existing = registryRef.current.get(id);
      if (existing) {
        existing.props = data.props;
        existing.sectionTitle = data.sectionTitle;
        existing.order = data.order;
      } else {
        registryRef.current.set(id, { id, ...data });
      }
      scheduleRegistryUpdate();
    },
    delete(id) {
      if (registryRef.current.has(id)) {
        registryRef.current.delete(id);
        scheduleRegistryUpdate();
      }
    },
  }), [scheduleRegistryUpdate]);

  // ── Collect sorted items ────────────────────────────────────────
  const allItems = useMemo(() => {
    return Array.from(registryRef.current.values()).sort((a, b) => a.order - b.order);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registryVersion]);

  // ── Filtering ──────────────────────────────────────────────────
  const filteredItems = useMemo(() => {
    // When extension handles filtering itself (onSearchTextChange provided)
    // or filtering is explicitly disabled, skip internal filtering
    if (onSearchTextChange || filtering === false || !searchText.trim()) return allItems;
    const q = searchText.toLowerCase();
    return allItems.filter(item => {
      const t = (item.props.title || '').toLowerCase();
      const s = (item.props.subtitle || '').toLowerCase();
      return t.includes(q) || s.includes(q) || item.props.keywords?.some((k: string) => k.toLowerCase().includes(q));
    });
  }, [allItems, searchText, filtering, onSearchTextChange]);

  // ── Search bar control ──────────────────────────────────────────
  // Debounce the extension's onSearchTextChange callback to avoid excessive API calls
  const gridSearchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSearchChange = useCallback((text: string) => {
    setInternalSearch(text);
    setSelectedIdx(0);
    if (onSearchTextChange) {
      if (gridSearchDebounceRef.current) clearTimeout(gridSearchDebounceRef.current);
      if (throttle !== false) {
        gridSearchDebounceRef.current = setTimeout(() => {
          onSearchTextChange(text);
        }, 300);
      } else {
        onSearchTextChange(text);
      }
    }
  }, [onSearchTextChange, throttle]);
  useEffect(() => {
    return () => { if (gridSearchDebounceRef.current) clearTimeout(gridSearchDebounceRef.current); };
  }, []);

  // ── Action collection ───────────────────────────────────────────
  const selectedItem = filteredItems[selectedIdx];
  const [emptyViewProps, setEmptyViewProps] = useState<{
    title?: string;
    description?: string;
    icon?: any;
    actions?: React.ReactElement;
  } | null>(null);
  const footerTitle = navigationTitle
    || extInfo.extensionDisplayName
    || _extensionContext.extensionDisplayName
    || _extensionContext.extensionName
    || 'Extension';
  const footerIcon = extInfo.extensionIconDataUrl || _extensionContext.extensionIconDataUrl;
  const { collectedActions: selectedActions, registryAPI: actionRegistry } = useCollectedActions();
  const activeActionsElement =
    selectedItem?.props?.actions ||
    (filteredItems.length === 0 ? emptyViewProps?.actions : null) ||
    gridActions;
  const primaryAction = selectedActions[0];

  // ── Keyboard handler ─────────────────────────────────────────────
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (isMetaK(e)) {
      e.preventDefault();
      setShowActions(prev => !prev);
      return;
    }

    // Extension shortcuts
    if ((e.metaKey || e.altKey || e.ctrlKey) && !e.repeat) {
      for (const action of selectedActions) {
        if (action.shortcut && matchesShortcut(e, action.shortcut)) {
          e.preventDefault();
          e.stopPropagation();
          setShowActions(false);
          action.execute();
          setTimeout(() => inputRef.current?.focus(), 0);
          return;
        }
      }
    }

    if (showActions) return;

    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        setSelectedIdx(p => Math.min(p + 1, filteredItems.length - 1));
        break;
      case 'ArrowLeft':
        e.preventDefault();
        setSelectedIdx(p => Math.max(p - 1, 0));
        break;
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIdx(p => Math.min(p + cols, filteredItems.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIdx(p => Math.max(p - cols, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (e.repeat) break;
        if (primaryAction) primaryAction.execute();
        break;
      case 'Escape':
        e.preventDefault();
        pop();
        break;
    }
  }, [filteredItems.length, selectedIdx, pop, primaryAction, showActions, selectedActions, cols]);

  // ── Window-level shortcut listener ─────────────────────────────
  const selectedActionsRef = useRef(selectedActions);
  selectedActionsRef.current = selectedActions;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const actions = selectedActionsRef.current;
      if (isMetaK(e) && !e.repeat) {
        e.preventDefault();
        e.stopPropagation();
        setShowActions(prev => !prev);
        return;
      }
      if (!e.metaKey && !e.altKey && !e.ctrlKey) return;
      if (e.repeat) return;
      for (const action of actions) {
        if (action.shortcut && matchesShortcut(e, action.shortcut)) {
          e.preventDefault();
          e.stopPropagation();
          setShowActions(false);
          action.execute();
          setTimeout(() => inputRef.current?.focus(), 0);
          return;
        }
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, []);

  // ── Scroll selected into view ──────────────────────────────────
  useEffect(() => {
    gridRef.current?.querySelector(`[data-idx="${selectedIdx}"]`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedIdx]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // ── Selection change notification ───────────────────────────────
  useEffect(() => {
    if (onSelectionChange && filteredItems[selectedIdx]) {
      onSelectionChange(filteredItems[selectedIdx]?.props?.id || null);
    }
  }, [selectedIdx, onSelectionChange, filteredItems]);

  // ── Group items by section ─────────────────────────────────────
  const groupedItems = useMemo(() => {
    const groups: { title?: string; items: { item: GridItemRegistration; globalIdx: number }[] }[] = [];
    let globalIdx = 0;
    let curSection: string | undefined | null = null;

    for (const item of filteredItems) {
      if (item.sectionTitle !== curSection || groups.length === 0) {
        curSection = item.sectionTitle;
        groups.push({ title: item.sectionTitle, items: [] });
      }
      groups[groups.length - 1].items.push({ item, globalIdx: globalIdx++ });
    }
    return groups;
  }, [filteredItems]);

  // ── Execute action and close panel ─────────────────────────────
  const handleActionExecute = useCallback((action: ExtractedAction) => {
    setShowActions(false);
    action.execute();
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const handleItemContextMenu = useCallback((idx: number, e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedIdx(idx);
    setShowActions(true);
  }, []);

  return (
    <GridRegistryContext.Provider value={registryAPI}>
      {/* Hidden render area — children register items via context */}
      <div style={{ display: 'none' }}>
        <EmptyViewRegistryContext.Provider value={setEmptyViewProps}>
          {children}
        </EmptyViewRegistryContext.Provider>
        {activeActionsElement && (
          <ActionRegistryContext.Provider value={actionRegistry}>
            <div key={selectedItem?.id || (filteredItems.length === 0 ? '__grid_empty_actions' : '__grid_actions')}>
              {activeActionsElement}
            </div>
          </ActionRegistryContext.Provider>
        )}
      </div>

      <div className="flex flex-col h-full" onKeyDown={handleKeyDown}>
        {/* ── Search bar ──────────────────────────────────────── */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.06]">
          <button onClick={pop} className="text-white/30 hover:text-white/60 transition-colors flex-shrink-0 p-0.5">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          </button>
          <input
            ref={inputRef}
            type="text"
            placeholder={searchBarPlaceholder || 'Search…'}
            value={searchText}
            onChange={e => handleSearchChange(e.target.value)}
            className="flex-1 bg-transparent border-none outline-none text-white/90 placeholder-white/30 text-[14px] font-light"
            autoFocus
          />
          {searchBarAccessory && (
            <div className="flex-shrink-0">{searchBarAccessory}</div>
          )}
        </div>

        {/* ── Grid content ──────────────────────────────────── */}
        <div ref={gridRef} className="flex-1 overflow-y-auto p-2">
          {isLoading && filteredItems.length === 0 ? (
            <div className="flex items-center justify-center h-full text-white/50"><p className="text-sm">Loading…</p></div>
          ) : filteredItems.length === 0 ? (
            emptyViewProps ? (
              <ListEmptyView
                title={emptyViewProps.title}
                description={emptyViewProps.description}
                icon={emptyViewProps.icon}
                actions={emptyViewProps.actions}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-white/40"><p className="text-sm">No results</p></div>
            )
          ) : (
            groupedItems.map((group, gi) => (
              <div key={gi} className="mb-2">
                {group.title && (
                  <div className="px-2 pt-2 pb-1.5 text-[11px] uppercase tracking-wider text-white/25 font-medium select-none">{group.title}</div>
                )}
                <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
                  {group.items.map(({ item, globalIdx }) => (
                    <GridItemRenderer
                      key={item.id}
                      title={item.props.title}
                      subtitle={item.props.subtitle}
                      content={item.props.content}
                      isSelected={globalIdx === selectedIdx}
                      dataIdx={globalIdx}
                      onSelect={() => setSelectedIdx(globalIdx)}
                      onActivate={() => setSelectedIdx(globalIdx)}
                      onContextAction={(e: React.MouseEvent<HTMLDivElement>) => handleItemContextMenu(globalIdx, e)}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        {/* ── Footer ─────────────────────────────────────────── */}
          <div className="flex items-center px-4 py-3 border-t border-white/[0.06]" style={{ background: 'rgba(28,28,32,0.90)' }}>
          <div className="flex items-center gap-2 text-white/40 text-xs flex-1 min-w-0 font-medium">
            {footerIcon ? <img src={footerIcon} alt="" className="w-4 h-4 rounded-sm object-contain flex-shrink-0" /> : null}
            <span className="truncate">{footerTitle}</span>
          </div>
          {primaryAction && (
            <button
              type="button"
              onClick={() => primaryAction.execute()}
              className="flex items-center gap-2 mr-3 text-white hover:text-white/90 transition-colors"
            >
              <span className="text-white text-xs font-semibold">{primaryAction.title}</span>
              <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-white/[0.08] text-[11px] text-white/40 font-medium">↩</kbd>
            </button>
          )}
          <button
            onClick={() => setShowActions(true)}
            className="flex items-center gap-1.5 text-white/50 hover:text-white/70 transition-colors"
          >
            <span className="text-xs font-medium">Actions</span>
            <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-white/[0.08] text-[11px] text-white/40 font-medium">⌘</kbd>
            <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-white/[0.08] text-[11px] text-white/40 font-medium">K</kbd>
          </button>
        </div>
      </div>

      {/* ── Action Panel Overlay ──────────────────────────────── */}
      {showActions && selectedActions.length > 0 && (
        <ActionPanelOverlay
          actions={selectedActions}
          onClose={() => setShowActions(false)}
          onExecute={handleActionExecute}
        />
      )}
    </GridRegistryContext.Provider>
  );
}

// Grid.Inset enum (used by extensions like cursor-recent-projects)
const GridInset = { Small: 'small', Medium: 'medium', Large: 'large' } as const;
const GridFit = { Contain: 'contain', Fill: 'fill' } as const;

export const Grid = Object.assign(GridComponent, {
  Item: GridItemComponent,
  Section: GridSectionComponent,
  EmptyView: ListEmptyView,
  Dropdown: ListDropdown,
  Inset: GridInset,
  Fit: GridFit,
});
Grid.Dropdown = ListDropdown;

// =====================================================================
// ─── MenuBarExtra (Native macOS Tray Integration) ───────────────────
// =====================================================================
//
// When commandMode === 'menu-bar', this component:
//   1. Collects all child Item/Section/Separator registrations
//   2. Sends the serialized menu structure to the main process via IPC
//   3. Main process creates/updates a native macOS Tray with a native Menu
//   4. Native menu clicks are routed back here to fire onAction callbacks
//
// When commandMode !== 'menu-bar' (fallback), it renders in-window.

// ── Registration types ───────────────────────────────────────────────

export namespace MenuBarExtra {
  export interface ActionEvent {
    type: 'left-click' | 'right-click';
  }

  export interface ItemProps {
    title: string;
    alternate?: React.ReactElement<ItemProps>;
    icon?: any;
    onAction?: (event: ActionEvent) => void;
    shortcut?: any;
    subtitle?: string;
    tooltip?: string;
  }

  export interface SubmenuProps {
    title: string;
    children?: React.ReactNode;
    icon?: any;
  }

  export interface SectionProps {
    children?: React.ReactNode;
    title?: string;
  }

  export interface Props {
    children?: React.ReactNode;
    icon?: any;
    isLoading?: boolean;
    title?: string;
    tooltip?: string;
  }
}

interface MBItemRegistration {
  id: string;
  type: 'item' | 'separator' | 'submenu';
  title?: string;
  subtitle?: string;
  icon?: any;
  tooltip?: string;
  onAction?: (event: MenuBarExtra.ActionEvent) => void;
  alternate?: MBItemRegistration;
  sectionId?: string;
  sectionTitle?: string;
  order: number;
  children?: MBItemRegistration[];
}

interface MBRegistryAPI {
  register: (item: MBItemRegistration) => void;
  unregister: (id: string) => void;
}

type SerializedMenuBarIcon = {
  iconPath?: string;
  iconEmoji?: string;
};

function pickMenuBarIconSource(icon: any): string {
  if (!icon || typeof icon !== 'object') return '';
  if (icon.source !== undefined) {
    if (typeof icon.source === 'string') return icon.source;
    if (icon.source && typeof icon.source === 'object') {
      // Prefer light assets for menu-bar icons because they're shown against
      // translucent/dark menu backgrounds on macOS.
      return icon.source.light || icon.source.dark || '';
    }
  }
  return icon.light || icon.dark || '';
}

function toMenuBarIconPayload(icon: any, assetsPath: string): SerializedMenuBarIcon | undefined {
  if (!icon) return undefined;
  const source = typeof icon === 'object' && icon !== null
    ? pickMenuBarIconSource(icon)
    : icon;

  if (typeof source !== 'string' || !source.trim()) return undefined;
  const src = source.trim();

  if (isEmojiOrSymbol(src)) {
    return { iconEmoji: src };
  }

  if (/^file:\/\//.test(src)) {
    try {
      const filePath = decodeURIComponent(new URL(src).pathname);
      if (filePath) return { iconPath: filePath };
    } catch {}
  }

  if (src.startsWith('sc-asset://ext-asset')) {
    const raw = src.slice('sc-asset://ext-asset'.length);
    return { iconPath: decodeURIComponent(raw) };
  }

  if (src.startsWith('/')) {
    return { iconPath: src };
  }

  if (/\.(svg|png|jpe?g|gif|webp|ico|tiff?)$/i.test(src) && assetsPath) {
    return { iconPath: `${assetsPath}/${src}` };
  }

  return undefined;
}

const MBRegistryContext = createContext<MBRegistryAPI | null>(null);
const MBSectionIdContext = createContext<string | undefined>(undefined);
const MBSectionTitleContext = createContext<string | undefined>(undefined);

// ── Global action map & click listener ──────────────────────────────

const _mbActions = new Map<string, Map<string, () => void>>();
let _mbClickListenerInit = false;

function initMBClickListener() {
  if (_mbClickListenerInit) return;
  _mbClickListenerInit = true;
  const electron = (window as any).electron;
  electron?.onMenuBarItemClick?.((data: { extId: string; itemId: string }) => {
    _mbActions.get(data.extId)?.get(data.itemId)?.();
  });
}

let _mbOrderCounter = 0;
let _mbSectionOrderCounter = 0;

// ── MenuBarExtra (parent) ───────────────────────────────────────────

function MenuBarExtraComponent({ children, icon, title, tooltip, isLoading }: MenuBarExtra.Props) {
  // Use React context for per-extension info (safe with concurrent extensions)
  const extInfo = useContext(ExtensionInfoReactContext);
  const extId = extInfo.extId || `${getExtensionContext().extensionName}/${getExtensionContext().commandName}`;
  const assetsPath = extInfo.assetsPath || getExtensionContext().assetsPath;
  const isMenuBar = (extInfo.commandMode || getExtensionContext().commandMode) === 'menu-bar';
  const runtimeCtxRef = useRef<ExtensionContextType>({
    ...getExtensionContext(),
  });

  // Registry for child items
  const registryRef = useRef(new Map<string, MBItemRegistration>());
  const [registryVersion, setRegistryVersion] = useState(0);
  const pendingRef = useRef(false);

  // Reset order counters on each render
  _mbOrderCounter = 0;
  _mbSectionOrderCounter = 0;

  useEffect(() => {
    if (isMenuBar) initMBClickListener();
  }, [isMenuBar]);

  const registryAPI = useMemo<MBRegistryAPI>(() => ({
    register: (item: MBItemRegistration) => {
      registryRef.current.set(item.id, item);
      if (!pendingRef.current) {
        pendingRef.current = true;
        queueMicrotask(() => {
          pendingRef.current = false;
          setRegistryVersion((v) => v + 1);
        });
      }
    },
    unregister: (id: string) => {
      registryRef.current.delete(id);
      if (!pendingRef.current) {
        pendingRef.current = true;
        queueMicrotask(() => {
          pendingRef.current = false;
          setRegistryVersion((v) => v + 1);
        });
      }
    },
  }), []);

  // Send menu structure to main process whenever registry changes
  useEffect(() => {
    if (!isMenuBar) return;

    const allItems = Array.from(registryRef.current.values())
      .sort((a, b) => a.order - b.order);

    // Build serialized menu with section grouping
    const actions = new Map<string, (event: MenuBarExtra.ActionEvent) => void>();
    const serialized: any[] = [];
    let prevSectionId: string | undefined | null = null;

    const withRuntimeContext = (fn: (event: MenuBarExtra.ActionEvent) => void): (() => void) => {
      return () => {
        setExtensionContext({ ...runtimeCtxRef.current });
        fn({ type: 'left-click' });
      };
    };

    const serializeItem = (item: MBItemRegistration): any => {
      if (item.type === 'separator') {
        return { type: 'separator' };
      } else if (item.type === 'submenu') {
        // Serialize submenu with children
        const submenuChildren = (item.children || []).map(serializeItem);
        const iconPayload = toMenuBarIconPayload(item.icon, assetsPath);
        return {
          type: 'submenu',
          title: item.title || '',
          ...iconPayload,
          icon: item.icon,
          children: submenuChildren,
        };
      } else {
        // Regular item
        if (item.onAction) actions.set(item.id, withRuntimeContext(item.onAction));
        const iconPayload = toMenuBarIconPayload(item.icon, assetsPath);
        const serializedItem: any = {
          type: 'item',
          id: item.id,
          title: item.title || '',
          subtitle: item.subtitle,
          tooltip: item.tooltip,
          ...iconPayload,
        };

        // Add alternate item if present
        if (item.alternate) {
          if (item.alternate.onAction) {
            actions.set(item.alternate.id, withRuntimeContext(item.alternate.onAction));
          }
          const alternateIconPayload = toMenuBarIconPayload(item.alternate.icon, assetsPath);
          serializedItem.alternate = {
            id: item.alternate.id,
            title: item.alternate.title,
            subtitle: item.alternate.subtitle,
            tooltip: item.alternate.tooltip,
            ...alternateIconPayload,
          };
        }

        return serializedItem;
      }
    };

    for (const item of allItems) {
      const sectionChanged = item.sectionId !== prevSectionId;
      // Insert separator between sections
      if (sectionChanged && prevSectionId != null) {
        serialized.push({ type: 'separator' });
      }
      // Add section title if present
      if (sectionChanged && item.sectionTitle) {
        serialized.push({
          type: 'item',
          title: item.sectionTitle,
          disabled: true,
        });
      }
      prevSectionId = item.sectionId;

      serialized.push(serializeItem(item));
    }

    _mbActions.set(extId, actions);

    // Resolve icon for the Tray
    const trayIconPayload = toMenuBarIconPayload(icon, assetsPath) || {};
    const iconPath = trayIconPayload.iconPath;
    const iconEmoji = trayIconPayload.iconEmoji;

    (window as any).electron?.updateMenuBar?.({
      extId,
      iconPath,
      iconEmoji,
      title: title || '',
      tooltip: tooltip || '',
      items: serialized,
    });
  }, [registryVersion, icon, title, tooltip, extId, assetsPath, isMenuBar]);

  // Cleanup on unmount
  useEffect(
    () => () => {
      _mbActions.delete(extId);
      if (isMenuBar) {
        (window as any).electron?.removeMenuBar?.(extId);
      }
    },
    [extId, isMenuBar]
  );

  if (isMenuBar) {
    // Render children in a hidden div so React hooks in items execute,
    // but nothing is visible. Items register via context.
    return (
      <MBRegistryContext.Provider value={registryAPI}>
        <div style={{ display: 'none' }}>{children}</div>
      </MBRegistryContext.Provider>
    );
  }

  // Fallback: render in the SuperCmd overlay window
  return (
    <MBRegistryContext.Provider value={registryAPI}>
      <div className="flex flex-col h-full p-2">{children}</div>
    </MBRegistryContext.Provider>
  );
}

// ── MenuBarExtra.Item ───────────────────────────────────────────────

function MenuBarExtraItemComponent({ title, subtitle, icon, onAction, shortcut, tooltip, alternate }: MenuBarExtra.ItemProps) {
  const registry = useContext(MBRegistryContext);
  const sectionId = useContext(MBSectionIdContext);
  const sectionTitle = useContext(MBSectionTitleContext);
  const stableId = useRef(`__mbi_${++_mbOrderCounter}`).current;
  const order = useRef(++_mbOrderCounter).current;

  useEffect(() => {
    if (registry) {
      // Process alternate item if provided
      let alternateReg: MBItemRegistration | undefined;
      if (alternate) {
        alternateReg = {
          id: `${stableId}_alt`,
          type: 'item',
          title: alternate.props.title,
          subtitle: alternate.props.subtitle,
          icon: alternate.props.icon,
          tooltip: alternate.props.tooltip,
          onAction: alternate.props.onAction,
          order: order + 0.5,
        };
      }

      registry.register({
        id: stableId,
        type: 'item',
        title,
        subtitle,
        icon,
        tooltip,
        onAction,
        alternate: alternateReg,
        sectionId,
        sectionTitle,
        order,
      });
      return () => registry.unregister(stableId);
    }
  }, [title, subtitle, icon, tooltip, onAction, alternate, registry, stableId, order, sectionId, sectionTitle]);

  // In non-menu-bar mode, render a clickable row
  if (!registry) {
    return (
      <button onClick={() => onAction?.({ type: 'left-click' })} className="w-full text-left px-3 py-1.5 text-sm text-white/80 hover:bg-white/[0.06] rounded transition-colors">
        <div>{title}</div>
        {subtitle && <div className="text-xs text-white/50">{subtitle}</div>}
      </button>
    );
  }

  return null; // menu-bar mode: items are invisible, sent via IPC
}

// ── MenuBarExtra.Section ────────────────────────────────────────────

function MenuBarExtraSectionComponent({ children, title }: MenuBarExtra.SectionProps) {
  const stableId = useRef(`__mbs_${++_mbSectionOrderCounter}`).current;

  return (
    <MBSectionIdContext.Provider value={stableId}>
      <MBSectionTitleContext.Provider value={title}>
        {children}
      </MBSectionTitleContext.Provider>
    </MBSectionIdContext.Provider>
  );
}

// ── MenuBarExtra.Separator ──────────────────────────────────────────

function MenuBarExtraSeparatorComponent() {
  const registry = useContext(MBRegistryContext);
  const sectionId = useContext(MBSectionIdContext);
  const stableId = useRef(`__mbsep_${++_mbOrderCounter}`).current;
  const order = useRef(++_mbOrderCounter).current;

  useEffect(() => {
    if (registry) {
      registry.register({
        id: stableId,
        type: 'separator',
        sectionId,
        order,
      });
      return () => registry.unregister(stableId);
    }
  }, [registry, stableId, order, sectionId]);

  if (!registry) return <hr className="border-white/[0.06] my-1" />;
  return null;
}

// ── MenuBarExtra.Submenu ────────────────────────────────────────────

const MBSubmenuContext = createContext<string | null>(null);

function MenuBarExtraSubmenuComponent({ children, title, icon }: MenuBarExtra.SubmenuProps) {
  const registry = useContext(MBRegistryContext);
  const sectionId = useContext(MBSectionIdContext);
  const sectionTitle = useContext(MBSectionTitleContext);
  const stableId = useRef(`__mbsm_${++_mbOrderCounter}`).current;
  const order = useRef(++_mbOrderCounter).current;

  // Create a local registry for submenu children
  const submenuRegistryRef = useRef(new Map<string, MBItemRegistration>());
  const [submenuVersion, setSubmenuVersion] = useState(0);

  const submenuAPI = useMemo<MBRegistryAPI>(() => ({
    register: (item: MBItemRegistration) => {
      submenuRegistryRef.current.set(item.id, item);
      setSubmenuVersion((v) => v + 1);
    },
    unregister: (id: string) => {
      submenuRegistryRef.current.delete(id);
      setSubmenuVersion((v) => v + 1);
    },
  }), []);

  useEffect(() => {
    if (registry) {
      // Collect all child items
      const childItems = Array.from(submenuRegistryRef.current.values())
        .sort((a, b) => a.order - b.order);

      registry.register({
        id: stableId,
        type: 'submenu',
        title,
        icon,
        sectionId,
        sectionTitle,
        order,
        children: childItems,
      });
      return () => registry.unregister(stableId);
    }
  }, [title, icon, registry, stableId, order, sectionId, sectionTitle, submenuVersion]);

  // In non-menu-bar mode, render as collapsible section
  if (!registry) {
    const [expanded, setExpanded] = useState(false);
    return (
      <div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full text-left px-3 py-1.5 text-sm text-white/80 hover:bg-white/[0.06] rounded transition-colors flex items-center"
        >
          <span className="mr-2">{expanded ? '▼' : '▶'}</span>
          {title}
        </button>
        {expanded && (
          <div className="ml-4">
            <MBRegistryContext.Provider value={submenuAPI}>
              {children}
            </MBRegistryContext.Provider>
          </div>
        )}
      </div>
    );
  }

  // In menu-bar mode, provide submenu context
  return (
    <MBSubmenuContext.Provider value={stableId}>
      <MBRegistryContext.Provider value={submenuAPI}>
        <div style={{ display: 'none' }}>{children}</div>
      </MBRegistryContext.Provider>
    </MBSubmenuContext.Provider>
  );
}

export const MenuBarExtra = Object.assign(MenuBarExtraComponent, {
  Item: MenuBarExtraItemComponent,
  Section: MenuBarExtraSectionComponent,
  Separator: MenuBarExtraSeparatorComponent,
  Submenu: MenuBarExtraSubmenuComponent,
});

// =====================================================================
// ─── Helpers (internal) ─────────────────────────────────────────────
// =====================================================================

// executePrimaryAction is now handled by extractActionsFromElement + ActionPanelOverlay
// No legacy helpers needed.

// =====================================================================
// ─── @raycast/utils — Hooks & Utilities ─────────────────────────────
// =====================================================================

// Extracted hooks moved to `hooks/*` modules.

// Extracted hooks moved to `hooks/*` modules.

// Utility helpers moved to `utility-runtime.ts`.

// =====================================================================
// ─── Additional @raycast/api exports ────────────────────────────────
// =====================================================================

// ToastStyle is already exported above with the Toast class

export const LaunchProps = {} as any;

// OAuth runtime moved to `oauth/*` modules.

// getPreferenceValues already exported above
