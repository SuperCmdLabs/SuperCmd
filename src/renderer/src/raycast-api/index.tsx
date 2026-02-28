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
import { addHexAlpha, isEmojiOrSymbol, normalizeScAssetUrl, resolveTintColor, toScAssetUrl } from './icon-runtime-assets';
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
import {
  configureContextScopeRuntime,
  snapshotExtensionContext,
  withExtensionContext,
  getCurrentScopedExtensionContext,
} from './context-scope-runtime';
import { configureMenuBarRuntime, MenuBarExtra } from './menubar-runtime';
import { createDetailRuntime } from './detail-runtime';
import { createActionRuntime } from './action-runtime';
import { createFormRuntime } from './form-runtime';
import { getFormValues, getFormErrors } from './form-runtime-context';
import { createGridRuntime } from './grid-runtime';
import { createListRuntime } from './list-runtime';
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
import { onThemeChange } from '../utils/theme';

export { Icon, Color, Image, Keyboard, renderIcon };
export { OAuth, OAuthService, withAccessToken, getAccessToken, resetAccessToken };
export { getFavicon, getAvatarIcon, getProgressIcon, runAppleScript, showFailureToast };
export { usePromise, useFetch, useCachedPromise, useExec, useSQL };
export { useCachedState, FormValidation, useForm, useStreamJSON, useAI, useFrecencySorting, useLocalStorage };
export { emitExtensionStorageChanged };
export { MenuBarExtra };
export { getFormValues, getFormErrors };
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

configureMenuBarRuntime({ ExtensionInfoReactContext, getExtensionContext, setExtensionContext, isEmojiOrSymbol });

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
let _aiAvailabilityRefreshPromise: Promise<boolean> | null = null;

async function refreshAIAvailabilityCache(force = false): Promise<boolean> {
  if (!force && _aiAvailabilityRefreshPromise) {
    return _aiAvailabilityRefreshPromise;
  }

  _aiAvailabilityRefreshPromise = (async () => {
    try {
      const available = await (window as any).electron?.aiIsAvailable?.() ?? false;
      _aiAvailableCache = available;
      return available;
    } catch {
      _aiAvailableCache = false;
      return false;
    } finally {
      _aiAvailabilityRefreshPromise = null;
    }
  })();

  return _aiAvailabilityRefreshPromise;
}

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
      // Keep this permissive and refresh in the background so stale cache values
      // don't block AI features immediately after settings updates.
      void refreshAIAvailabilityCache();
      return true;
    }
    return true;
  },
};

if (typeof document !== 'undefined') {
  const applyEnvironmentTheme = () => {
    const isDark = document.documentElement.classList.contains('dark');
    environment.appearance = isDark ? 'dark' : 'light';
    environment.theme = { name: isDark ? 'dark' : 'light' };
    document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
  };

  applyEnvironmentTheme();
  onThemeChange(({ theme }) => {
    environment.appearance = theme;
    environment.theme = { name: theme };
    document.documentElement.style.colorScheme = theme;
  });
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
    shortcut?: any;
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
  private static _activeToast: Toast | null = null;

  private _title = '';
  private _message?: string;
  private _style: ToastStyle = ToastStyle.Success;
  private _primaryAction?: Alert.ActionOptions;
  private _secondaryAction?: Alert.ActionOptions;

  private _el: HTMLDivElement | null = null;
  private _menuEl: HTMLDivElement | null = null;
  private _timer: any = null;
  private _keyHandler: ((event: KeyboardEvent) => void) | null = null;
  private _actions: Alert.ActionOptions[] = [];
  private _selectedActionIndex = 0;
  private _hostEl: HTMLElement | null = null;
  private _isInlineHost = false;

  constructor(options: Toast.Options) {
    this._style = this.normalizeStyle(options.style);
    this._title = options.title || '';
    this._message = options.message;
    this._primaryAction = options.primaryAction;
    this._secondaryAction = options.secondaryAction;
  }

  public get title(): string {
    return this._title;
  }

  public set title(value: string) {
    this._title = String(value || '');
    this.refresh();
  }

  public get message(): string | undefined {
    return this._message;
  }

  public set message(value: string | undefined) {
    this._message = value ? String(value) : undefined;
    this.refresh();
  }

  public get style(): ToastStyle {
    return this._style;
  }

  public set style(value: ToastStyle | Toast.Style | string) {
    this._style = this.normalizeStyle(value);
    this.refresh();
  }

  public get primaryAction(): Alert.ActionOptions | undefined {
    return this._primaryAction;
  }

  public set primaryAction(value: Alert.ActionOptions | undefined) {
    this._primaryAction = value;
    this.refresh();
  }

  public get secondaryAction(): Alert.ActionOptions | undefined {
    return this._secondaryAction;
  }

  public set secondaryAction(value: Alert.ActionOptions | undefined) {
    this._secondaryAction = value;
    this.refresh();
  }

  private normalizeStyle(value: ToastStyle | Toast.Style | string | undefined): ToastStyle {
    if (value === ToastStyle.Animated || value === Toast.Style.Animated || value === 'animated') {
      return ToastStyle.Animated;
    }
    if (value === ToastStyle.Failure || value === Toast.Style.Failure || value === 'failure') {
      return ToastStyle.Failure;
    }
    if (value === ToastStyle.Success || value === Toast.Style.Success || value === 'success') {
      return ToastStyle.Success;
    }
    return ToastStyle.Success;
  }

  private getClassName(): string {
    return `sc-toast ${this._isInlineHost ? 'sc-toast-inline' : ''} ${
      this._style === ToastStyle.Failure
        ? 'sc-toast-failure'
        : this._style === ToastStyle.Animated
          ? 'sc-toast-animated'
          : 'sc-toast-success'
    }`;
  }

  private resolveInlineHost(): HTMLElement | null {
    const footers = Array.from(document.querySelectorAll<HTMLElement>('.sc-glass-footer'));
    for (let index = footers.length - 1; index >= 0; index -= 1) {
      const footer = footers[index];
      if (!footer) continue;
      if (footer.getClientRects().length === 0) continue;
      const style = window.getComputedStyle(footer);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      return footer;
    }
    return null;
  }

  private updateActions() {
    this._actions = [this._primaryAction, this._secondaryAction]
      .filter((action): action is Alert.ActionOptions => Boolean(action?.title));
    if (this._selectedActionIndex >= this._actions.length) {
      this._selectedActionIndex = Math.max(0, this._actions.length - 1);
    }
  }

  private updateKeyboardHandler() {
    if (this._actions.length === 0) {
      if (this._keyHandler) {
        window.removeEventListener('keydown', this._keyHandler, true);
        this._keyHandler = null;
      }
      return;
    }

    if (this._keyHandler) return;

    this._keyHandler = (event: KeyboardEvent) => {
      const isToastMenuShortcut = event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey && String(event.key || '').toLowerCase() === 't';
      if (isToastMenuShortcut && !event.repeat) {
        event.preventDefault();
        event.stopPropagation();
        this.toggleActionMenu();
        return;
      }

      if (this._menuEl) {
        if (event.key === 'Escape') {
          event.preventDefault();
          this.closeActionMenu();
          return;
        }
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          this._selectedActionIndex = Math.min(this._selectedActionIndex + 1, this._actions.length - 1);
          this.renderActionMenu();
          return;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          this._selectedActionIndex = Math.max(this._selectedActionIndex - 1, 0);
          this.renderActionMenu();
          return;
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          this.executeAction(this._actions[this._selectedActionIndex]);
          return;
        }
      }

      for (const action of this._actions) {
        if (this.matchesActionShortcut(event, action)) {
          event.preventDefault();
          event.stopPropagation();
          this.executeAction(action);
          return;
        }
      }
    };
    window.addEventListener('keydown', this._keyHandler, true);
  }

  private renderToastBody() {
    if (!this._el) return;
    this._el.className = this.getClassName();
    this._el.innerHTML = '';

    const dotEl = document.createElement('span');
    dotEl.className = 'sc-toast-dot';

    const textWrapEl = document.createElement('span');
    textWrapEl.className = 'sc-toast-main';

    const titleEl = document.createElement('span');
    titleEl.className = 'sc-toast-title';
    titleEl.textContent = this._title || '';
    textWrapEl.appendChild(titleEl);

    if (this._message) {
      const messageEl = document.createElement('span');
      messageEl.className = 'sc-toast-message';
      messageEl.textContent = `• ${this._message}`;
      textWrapEl.appendChild(messageEl);
    }

    this._el.appendChild(dotEl);
    this._el.appendChild(textWrapEl);

    if (this._actions.length > 0) {
      const hintEl = document.createElement('span');
      hintEl.className = 'sc-toast-hint';
      hintEl.innerHTML = `<kbd>⌘</kbd><kbd>T</kbd>`;
      this._el.appendChild(hintEl);
    }
  }

  private syncAutoHideTimer() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    if (!this._el) return;
    if (this._style === ToastStyle.Animated) return;
    const timeoutMs = this._actions.length > 0 ? 6000 : 3000;
    this._timer = setTimeout(() => this.hide(), timeoutMs);
  }

  private updateActionMenuPosition() {
    if (!this._menuEl || !this._el) return;
    const rect = this._el.getBoundingClientRect();
    this._menuEl.style.right = '';
    this._menuEl.style.top = '';
    this._menuEl.style.left = `${rect.left}px`;
    this._menuEl.style.bottom = `${Math.max(window.innerHeight - rect.top + 8, 12)}px`;
  }

  private refresh() {
    if (!this._el) return;

    this.updateActions();
    this.updateKeyboardHandler();
    this.renderToastBody();

    if (this._actions.length === 0 && this._menuEl) {
      this.closeActionMenu();
    } else if (this._menuEl) {
      this.updateActionMenuPosition();
      this.renderActionMenu();
    }

    this.syncAutoHideTimer();
  }

  show() {
    this.hide(); // clear any existing instance of this toast
    if (Toast._activeToast && Toast._activeToast !== this) {
      void Toast._activeToast.hide();
    }

    this._hostEl = this.resolveInlineHost() || document.body;
    this._isInlineHost = this._hostEl !== document.body;

    this._el = document.createElement('div');
    this._el.className = this.getClassName();
    if (this._isInlineHost) {
      this._hostEl.classList.add('sc-toast-active');
      this._hostEl.insertBefore(this._el, this._hostEl.firstChild || null);
    } else {
      this._hostEl.appendChild(this._el);
    }
    Toast._activeToast = this;
    this.refresh();
    return Promise.resolve();
  }

  private getActionShortcutLabel(action?: Alert.ActionOptions): string {
    const shortcut = (action as any)?.shortcut;
    if (!shortcut) return '';
    const modifiers = Array.isArray(shortcut.modifiers) ? shortcut.modifiers : [];
    const parts: string[] = [];
    for (const mod of modifiers) {
      if (mod === 'cmd') parts.push('⌘');
      else if (mod === 'ctrl') parts.push('⌃');
      else if (mod === 'opt') parts.push('⌥');
      else if (mod === 'shift') parts.push('⇧');
    }
    const keyRaw = String(shortcut.key || '').toLowerCase();
    if (keyRaw === 'return' || keyRaw === 'enter') parts.push('↩');
    else if (keyRaw === 'delete' || keyRaw === 'backspace') parts.push('⌫');
    else if (keyRaw === 'space') parts.push('Space');
    else if (keyRaw) parts.push(keyRaw.length === 1 ? keyRaw.toUpperCase() : keyRaw);
    return parts.join(' ');
  }

  private matchesActionShortcut(event: KeyboardEvent, action?: Alert.ActionOptions): boolean {
    const shortcut = (action as any)?.shortcut;
    if (!shortcut) return false;

    const modifiers = Array.isArray(shortcut.modifiers)
      ? shortcut.modifiers.map((mod: any) => String(mod || '').toLowerCase())
      : [];

    const expectsCmd = modifiers.includes('cmd');
    const expectsCtrl = modifiers.includes('ctrl');
    const expectsOpt = modifiers.includes('opt') || modifiers.includes('alt');
    const expectsShift = modifiers.includes('shift');

    if (expectsCmd !== event.metaKey) return false;
    if (expectsCtrl !== event.ctrlKey) return false;
    if (expectsOpt !== event.altKey) return false;
    if (expectsShift !== event.shiftKey) return false;

    const expectedKeyRaw = String(shortcut.key || '').trim().toLowerCase();
    const pressedKeyRaw = String(event.key || '').trim().toLowerCase();

    const normalize = (value: string) => {
      if (value === 'return') return 'enter';
      if (value === 'spacebar' || value === ' ') return 'space';
      return value;
    };

    const expectedKey = normalize(expectedKeyRaw);
    const pressedKey = normalize(pressedKeyRaw);
    if (!expectedKey) return false;
    return expectedKey === pressedKey;
  }

  private renderActionMenu() {
    if (!this._menuEl) return;
    this._menuEl.innerHTML = '';
    if (this._actions.length === 0) return;
    this._selectedActionIndex = Math.max(0, Math.min(this._selectedActionIndex, this._actions.length - 1));
    this._actions.forEach((action, idx) => {
      const itemEl = document.createElement('button');
      itemEl.type = 'button';
      itemEl.className = `sc-toast-menu-item ${idx === this._selectedActionIndex ? 'is-selected' : ''}`;
      itemEl.addEventListener('mouseenter', () => {
        this._selectedActionIndex = idx;
        this.renderActionMenu();
      });
      itemEl.addEventListener('click', (event) => {
        event.preventDefault();
        this.executeAction(action);
      });

      const titleEl = document.createElement('span');
      titleEl.className = 'sc-toast-menu-item-title';
      titleEl.textContent = action.title;
      itemEl.appendChild(titleEl);

      const shortcutLabel = this.getActionShortcutLabel(action);
      if (shortcutLabel) {
        const shortcutEl = document.createElement('span');
        shortcutEl.className = 'sc-toast-menu-item-shortcut';
        shortcutEl.textContent = shortcutLabel;
        itemEl.appendChild(shortcutEl);
      }

      this._menuEl?.appendChild(itemEl);
    });
  }

  private openActionMenu() {
    if (!this._el || this._actions.length === 0 || this._menuEl) return;
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }

    const menuEl = document.createElement('div');
    menuEl.className = 'sc-toast-menu';

    this._selectedActionIndex = 0;
    this._menuEl = menuEl;
    this.updateActionMenuPosition();
    this.renderActionMenu();
    document.body.appendChild(menuEl);
  }

  private closeActionMenu(options?: { rescheduleAutoHide?: boolean }) {
    if (!this._menuEl) return;
    this._menuEl.remove();
    this._menuEl = null;
    if (options?.rescheduleAutoHide !== false) {
      this.syncAutoHideTimer();
    }
  }

  private toggleActionMenu() {
    if (this._menuEl) {
      this.closeActionMenu();
    } else {
      this.openActionMenu();
    }
  }

  private executeAction(action?: Alert.ActionOptions) {
    if (!action) return;
    this.closeActionMenu();
    try {
      action.onAction?.();
    } finally {
      void this.hide();
    }
  }

  hide() {
    if (this._timer) clearTimeout(this._timer);
    if (this._keyHandler) {
      window.removeEventListener('keydown', this._keyHandler, true);
      this._keyHandler = null;
    }
    this.closeActionMenu({ rescheduleAutoHide: false });
    if (this._el) {
      this._el.remove();
      this._el = null;
    }
    if (Toast._activeToast === this) {
      Toast._activeToast = null;
      this._hostEl?.classList.remove('sc-toast-active');
    }
    this._hostEl = null;
    this._isInlineHost = false;
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

export async function showToast(options: Toast.Options): Promise<Toast>;
export async function showToast(style: ToastStyle | Toast.Style, title: string, message?: string): Promise<Toast>;
export async function showToast(
  optionsOrStyle: Toast.Options | ToastStyle | Toast.Style,
  title?: string,
  message?: string
): Promise<Toast> {
  const options: Toast.Options =
    typeof optionsOrStyle === 'string'
      ? {
        style: optionsOrStyle,
        title: String(title || ''),
        message: message ? String(message) : undefined,
      }
      : optionsOrStyle;
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
  try {
    const candidates = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[data-supercmd-search-input="true"]')
    );
    const visible = candidates.find((input) => {
      if (!input || input.disabled) return false;
      return input.getClientRects().length > 0;
    });
    const target = visible || candidates[0] || null;
    if (target && target.value !== '') {
      const descriptor = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      );
      descriptor?.set?.call(target, '');
      target.dispatchEvent(new Event('input', { bubbles: true }));
    }
  } catch {}
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

const CLIPBOARD_MEDIA_PATH_REGEX = /\.(gif|png|jpe?g|webp|bmp|tiff?|heic|heif|mp4|mov|m4v)$/i;

async function inferClipboardFilePath(rawValue: string, electron: any): Promise<string> {
  const value = String(rawValue || '').trim();
  if (!value) return '';

  const maybePathLike =
    value.startsWith('/') ||
    value.startsWith('~/') ||
    value.startsWith('file://');
  if (!maybePathLike) return '';

  let candidate = value;
  if (candidate.startsWith('file://')) {
    try {
      candidate = decodeURIComponent(candidate.replace(/^file:\/\//i, ''));
      if (!candidate.startsWith('/')) candidate = `/${candidate}`;
    } catch {}
  }

  if (!CLIPBOARD_MEDIA_PATH_REGEX.test(candidate)) return '';

  try {
    const exists = await electron?.fileExists?.(candidate);
    if (exists) return candidate;
  } catch {}

  if (candidate.startsWith('~/')) {
    try {
      const homeDir = String(electron?.homeDir || '').trim();
      if (homeDir) {
        const expanded = `${homeDir}/${candidate.slice(2)}`;
        const exists = await electron?.fileExists?.(expanded);
        if (exists) return expanded;
      }
    } catch {}
  }

  return '';
}

export const Clipboard = {
  async copy(
    content: string | number | Clipboard.Content,
    options?: Clipboard.CopyOptions
  ): Promise<void> {
    const electron = (window as any).electron;
    let text = '';
    let html = '';
    let file = '';

    // Parse content
    if (typeof content === 'string' || typeof content === 'number') {
      text = String(content);
    } else if (typeof content === 'object') {
      text = content.text || content.file || '';
      file = content.file || '';
      html = content.html || '';
    }

    if (!file && !html && text) {
      const inferredFile = await inferClipboardFilePath(text, electron);
      if (inferredFile) file = inferredFile;
    }

    let copied = false;

    try {
      // File payloads should stay as file content (not plain text paths).
      if (file) {
        if (electron?.clipboardWrite) {
          copied = await electron.clipboardWrite({ text, html, file }) || false;
        } else {
          await navigator.clipboard.writeText(file);
          copied = true;
        }
      } else if (html) {
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
        copied = await electron?.clipboardWrite?.({ text, html, file }) || false;
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
      let file = '';

      if (typeof content === 'string' || typeof content === 'number') {
        text = String(content);
      } else if (content && typeof content === 'object') {
        text = content.text || content.file || '';
        file = content.file || '';
        html = content.html || '';
      }

      if (!file && !html && text) {
        const inferredFile = await inferClipboardFilePath(text, electron);
        if (inferredFile) file = inferredFile;
      }

      // Prefer main-process paste flow: hides SuperCmd first and pastes into
      // the previously focused app/editor. This prevents pasting into the
      // launcher's own search field.
      if (file && electron?.pasteFile) {
        // File paste (GIFs, images): writes file data to clipboard in main
        // process and simulates Cmd+V with proper focus management.
        const pasted = await electron.pasteFile(file);
        if (pasted) return;
      }
      if (!html && !file && electron?.pasteText) {
        const pasted = await electron.pasteText(text);
        if (pasted) return;
      }

      // Fallback path (no paste bridge or HTML payload).
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
  'Google_Gemini_2_5_Pro': 'gemini-gemini-2.5-pro',
  'Google_Gemini_2_5_Flash': 'gemini-gemini-2.5-flash',
  'Google_Gemini_2_5_Flash_Lite': 'gemini-gemini-2.5-flash-lite',
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
  await refreshAIAvailabilityCache(true);
})();

if (typeof window !== 'undefined') {
  window.addEventListener('focus', () => {
    void refreshAIAvailabilityCache(true);
  });
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        void refreshAIAvailabilityCache(true);
      }
    });
  }
}

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
    void refreshAIAvailabilityCache();

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
  const scoped = getCurrentScopedExtensionContext();
  const context = scoped || _extensionContext;
  const contextPrefs = (context?.preferences || {}) as Record<string, any>;
  const extName = String(context?.extensionName || _extensionContext.extensionName || '').trim();
  const cmdName = String(context?.commandName || _extensionContext.commandName || '').trim();

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

  const merged = { ...stored, ...contextPrefs };
  for (const [key, value] of Object.entries(contextPrefs)) {
    if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
      if (stored[key] !== undefined) {
        merged[key] = stored[key];
      }
    }
  }

  return merged as Values;
}

export async function open(target: string, application?: string | Application): Promise<void> {
  const electron = (window as any).electron;
  if (application) {
    const appName = typeof application === 'string' ? application : application.name;
    if (electron?.openUrl) {
      await electron.openUrl(target, appName);
      return;
    }
    // Fallback path if openUrl bridge is unavailable.
    if (electron?.execCommand) {
      await electron.execCommand('open', ['-a', appName, target]);
      return;
    }
  }
  await electron?.openUrl?.(target);
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
// ─── Action Runtime ─────────────────────────────────────────────────
// =====================================================================

const actionRuntime = createActionRuntime({
  snapshotExtensionContext,
  withExtensionContext,
  ExtensionInfoReactContext,
  getFormValues,
  Clipboard,
  trash,
  getGlobalNavigation,
  renderIcon,
});

const {
  ActionRegistryContext,
  useCollectedActions,
  ActionPanelOverlay,
  matchesShortcut,
  isMetaK,
  renderShortcut,
} = actionRuntime;

export const Action = actionRuntime.Action;
export const ActionPanel = actionRuntime.ActionPanel;
export const InternalActionPanelOverlay = ActionPanelOverlay;

// =====================================================================
// ─── List ───────────────────────────────────────────────────────────
// =====================================================================
const listRuntime = createListRuntime({
  ExtensionInfoReactContext,
  useNavigation,
  useCollectedActions,
  ActionRegistryContext,
  ActionPanelOverlay,
  matchesShortcut,
  isMetaK,
  isEmojiOrSymbol,
  renderIcon,
  resolveTintColor,
  addHexAlpha,
  getExtensionContext,
  normalizeScAssetUrl,
  toScAssetUrl,
  setClearSearchBarCallback: (callback) => {
    _clearSearchBarCallback = callback;
  },
});

const { EmptyViewRegistryContext, ListEmptyView, ListDropdown, ListItemDetail } = listRuntime;
export const List = listRuntime.List;

// =====================================================================
// ─── Detail ─────────────────────────────────────────────────────────
// =====================================================================

const detailRuntime = createDetailRuntime({
  ExtensionInfoReactContext,
  getExtensionContext,
  useNavigation,
  useCollectedActions,
  ActionPanelOverlay,
  ActionRegistryContext,
  matchesShortcut,
  isMetaK,
  renderShortcut,
  renderIcon,
  addHexAlpha,
});
const Metadata = detailRuntime.Metadata;
export const Detail = detailRuntime.Detail;

// Assign Metadata to List.Item.Detail (deferred because Metadata is defined after List)
ListItemDetail.Metadata = Metadata;

// =====================================================================
// ─── Form ───────────────────────────────────────────────────────────
// =====================================================================
const formRuntime = createFormRuntime({
  ExtensionInfoReactContext,
  useNavigation,
  useCollectedActions,
  ActionRegistryContext,
  ActionPanelOverlay,
  matchesShortcut,
  isMetaK,
  renderShortcut,
  getExtensionContext,
});

export const Form = formRuntime.Form;

// =====================================================================
// ─── Grid ───────────────────────────────────────────────────────────
// =====================================================================
const gridRuntime = createGridRuntime({
  ExtensionInfoReactContext,
  useNavigation,
  useCollectedActions,
  ActionRegistryContext,
  ActionPanelOverlay,
  matchesShortcut,
  isMetaK,
  getExtensionContext,
  EmptyViewRegistryContext,
  ListEmptyView,
  ListDropdown,
  resolveIconSrc,
});

export const Grid = gridRuntime.Grid;

// MenuBarExtra runtime moved to `menubar-runtime.tsx`.

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
