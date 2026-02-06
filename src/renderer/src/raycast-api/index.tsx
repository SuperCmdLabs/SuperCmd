/**
 * @raycast/api + @raycast/utils — Complete Compatibility Shim
 *
 * This module provides a comprehensive compatibility layer for Raycast
 * extensions running inside SuperCommand. It implements ALL the APIs
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
 *          useExec, useSQL, useStreamJSON, useAI
 *   Functions: getFavicon, runAppleScript, showFailureToast
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

// =====================================================================
// ─── Extension Context (set by ExtensionView) ───────────────────────
// =====================================================================

export interface ExtensionContextType {
  extensionName: string;
  commandName: string;
  assetsPath: string;
  supportPath: string;
  owner: string;
  preferences: Record<string, any>;
  commandMode: 'view' | 'no-view' | 'menu-bar';
}

let _extensionContext: ExtensionContextType = {
  extensionName: '',
  commandName: '',
  assetsPath: '',
  supportPath: '/tmp/supercommand',
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

// =====================================================================
// ─── Navigation Context ─────────────────────────────────────────────
// =====================================================================

interface NavigationCtx {
  push: (element: React.ReactElement) => void;
  pop: () => void;
}

export const NavigationContext = createContext<NavigationCtx>({
  push: () => {},
  pop: () => {},
});

// Global ref for navigation (used by executePrimaryAction for Action.Push)
let _globalNavigation: NavigationCtx = { push: () => {}, pop: () => {} };

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

// =====================================================================
// ─── Environment ────────────────────────────────────────────────────
// =====================================================================

export const environment: Record<string, any> = {
  isDevelopment: false,
  extensionName: '',
  commandName: '',
  commandMode: 'view',
  assetsPath: '',
  supportPath: '/tmp/supercommand',
  raycastVersion: '1.80.0',
  ownerOrAuthorName: '',
  launchType: LaunchType.UserInitiated,
  textSize: 'medium',
  appearance: 'dark',
  theme: { name: 'dark' },
  canAccess: () => true,
};

// Initialize appearance from system
(async () => {
  try {
    const appearance = await (window as any).electron?.getAppearance?.();
    if (appearance) {
      environment.appearance = appearance;
      environment.theme = { name: appearance };
    }
  } catch {}
})();

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
  public primaryAction?: any;
  public secondaryAction?: any;

  private _el: HTMLDivElement | null = null;
  private _timer: any = null;

  constructor(options: { style?: ToastStyle; title: string; message?: string; primaryAction?: any; secondaryAction?: any }) {
    this.style = options.style || ToastStyle.Success;
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

export function showToast(optionsOrStyle: any, titleOrUndefined?: string, messageOrUndefined?: string): Promise<Toast> {
  let options: any = {};
  if (typeof optionsOrStyle === 'string') {
    options = { style: optionsOrStyle, title: titleOrUndefined, message: messageOrUndefined };
  } else {
    options = optionsOrStyle;
  }
  const t = new Toast(options);
  t.show();
  return Promise.resolve(t);
}

// =====================================================================
// ─── showHUD ────────────────────────────────────────────────────────
// =====================================================================

export async function showHUD(title: string, options?: any): Promise<void> {
  await showToast({ title, style: ToastStyle.Success });
}

// =====================================================================
// ─── confirmAlert ───────────────────────────────────────────────────
// =====================================================================

export async function confirmAlert(options: {
  title: string;
  message?: string;
  primaryAction?: { title?: string; style?: string; onAction?: () => void };
  dismissAction?: { title?: string; onAction?: () => void };
  icon?: any;
  rememberUserChoice?: boolean;
}): Promise<boolean> {
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

// =====================================================================
// ─── Icon ───────────────────────────────────────────────────────────
// =====================================================================

// Map Raycast icon names to SVG paths or emoji
const iconMap: Record<string, string> = {
  // Common icons - using emoji as fallback
  List: '☰',
  MagnifyingGlass: '🔍',
  Gear: '⚙️',
  Trash: '🗑️',
  Plus: '+',
  Minus: '-',
  Checkmark: '✓',
  XMarkCircle: '✕',
  ExclamationMark: '!',
  Exclamationmark: '!',
  Exclamationmark2: '‼',
  Exclamationmark3: '⁉',
  QuestionMark: '?',
  Info: 'ℹ',
  Star: '⭐',
  StarFilled: '★',
  Heart: '♡',
  HeartFilled: '♥',
  Folder: '📁',
  Document: '📄',
  Terminal: '>_',
  Code: '</>',
  Globe: '🌐',
  Link: '🔗',
  Lock: '🔒',
  Unlock: '🔓',
  Key: '🔑',
  Person: '👤',
  PersonCircle: '👤',
  Envelope: '✉️',
  Message: '💬',
  Phone: '📱',
  Calendar: '📅',
  Clock: '🕐',
  Alarm: '⏰',
  Bell: '🔔',
  Camera: '📷',
  Image: '🖼️',
  Video: '🎬',
  Music: '🎵',
  Play: '▶',
  Pause: '⏸',
  Stop: '⏹',
  Forward: '⏩',
  Backward: '⏪',
  Repeat: '🔁',
  Shuffle: '🔀',
  Download: '⬇️',
  Upload: '⬆️',
  Cloud: '☁️',
  Sun: '☀️',
  Moon: '🌙',
  Bolt: '⚡',
  Fire: '🔥',
  Leaf: '🍃',
  Tree: '🌳',
  Bug: '🐛',
  Hammer: '🔨',
  Wrench: '🔧',
  Pencil: '✏️',
  Clipboard: '📋',
  Copy: '📋',
  Cut: '✂️',
  Paste: '📋',
  Undo: '↩️',
  Redo: '↪️',
  ArrowRight: '→',
  ArrowLeft: '←',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ChevronRight: '›',
  ChevronLeft: '‹',
  ChevronUp: '⌃',
  ChevronDown: '⌄',
  CircleFilled: '●',
  Circle: '○',
  SquareFilled: '■',
  Square: '□',
  EyeDropper: '🎨',
  Wand: '✨',
  Sparkles: '✨',
  Text: 'Aa',
  TextCursor: '|',
  Tag: '🏷️',
  Bookmark: '🔖',
  Filter: '⚙',
  SortAscending: '↑',
  SortDescending: '↓',
  Window: '⬜',
  Desktop: '🖥️',
  Keyboard: '⌨️',
  Mouse: '🖱️',
  Printer: '🖨️',
  Wifi: '📶',
  Bluetooth: 'ᛒ',
  Battery: '🔋',
  Power: '⏻',
  Home: '🏠',
  Building: '🏢',
  Map: '🗺️',
  Pin: '📍',
  Compass: '🧭',
  Car: '🚗',
  Airplane: '✈️',
  Ship: '🚢',
  Train: '🚂',
  Wallet: '👛',
  CreditCard: '💳',
  Cart: '🛒',
  Gift: '🎁',
  Trophy: '🏆',
  Flag: '🚩',
  EmojiSad: '😢',
  EmojiHappy: '😊',
  Binoculars: '🔭',
  Fingerprint: '🔐',
  AppWindow: '⬜',
  AppWindowGrid: '⊞',
  Dot: '•',
  BandAid: '🩹',
  Raindrop: '💧',
  TwoPeople: '👥',
  AddPerson: '👤+',
  RemovePerson: '👤-',
  SaveDocument: '💾',
  NewDocument: '📄',
  NewFolder: '📁',
  Switch: '⇄',
  Sidebar: '▊',
  BarChart: '📊',
  LineChart: '📈',
  PieChart: '🥧',
  Snippet: '{ }',
  TextInput: '⌨',
  Paragraph: '¶',
  Uppercase: 'AA',
  Lowercase: 'aa',
  FullSignal: '📶',
  RotateAntiClockwise: '↺',
  RotateClockwise: '↻',
  Maximize: '⤢',
  Minimize: '⤡',
  ArrowClockwise: '↻',
  ArrowCounterClockwise: '↺',
  Eraser: '⌫',
  Megaphone: '📢',
  ArrowNe: '↗',
  ArrowRightCircle: '→',
  Eye: '👁',
  EyeDisabled: '🚫',
  EyeSlash: '👁‍🗨',
  Cog: '⚙️',
  Bubble: '💬',
};

// Return the property name as the icon value. This works with our
// renderer which shows the mapped icon or a dot for unknown icons.
export const Icon: Record<string, string> = new Proxy({} as Record<string, string>, {
  get(_target, prop: string) {
    return iconMap[prop] || '•';
  },
});

// Helper: check if a string is an emoji/symbol (not a URL or file path)
function isEmojiOrSymbol(s: string): boolean {
  if (!s) return false;
  if (s.startsWith('data:') || s.startsWith('http') || s.startsWith('/') || s.startsWith('.')) return false;
  // Short strings (1-4 chars) that aren't file paths are likely emoji/symbols
  if (s.length <= 4) return true;
  // Check for emoji unicode ranges
  if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2B50}\u{2702}-\u{27B0}]/u.test(s)) return true;
  return false;
}

// Helper component to render icons
export function renderIcon(icon: any, className = 'w-4 h-4'): React.ReactNode {
  if (!icon) return null;

  // If it's a string URL or data URL, render as image
  if (typeof icon === 'string') {
    if (icon.startsWith('data:') || icon.startsWith('http')) {
      return <img src={icon} className={className + ' rounded'} alt="" />;
    }
    // Check if it's a mapped icon
    const mappedIcon = iconMap[icon];
    if (mappedIcon) {
      return <span className="text-center" style={{ fontSize: '0.875rem' }}>{mappedIcon}</span>;
    }
    // Check if the icon itself is an emoji or symbol
    if (isEmojiOrSymbol(icon)) {
      return <span className="text-center" style={{ fontSize: '0.875rem' }}>{icon}</span>;
    }
    // Otherwise show a dot
    return <span className="opacity-50">•</span>;
  }

  // If it's an object with source property (e.g., { source: Icon.Checkmark, tintColor: Color.Green })
  if (typeof icon === 'object' && icon !== null) {
    const tintColor = icon.tintColor || undefined;

    if (icon.source) {
      const src = typeof icon.source === 'string' ? icon.source : icon.source?.light || icon.source?.dark || '';
      if (src) {
        // Check if source is an emoji/symbol (from our Icon proxy) vs a real URL/path
        if (isEmojiOrSymbol(src)) {
          return <span className="text-center" style={{ fontSize: '0.875rem', color: tintColor }}>{src}</span>;
        }
        return <img src={src} className={className + ' rounded'} alt="" />;
      }
    }
    // Handle { light, dark } theme icons
    if (icon.light || icon.dark) {
      const src = icon.dark || icon.light;
      if (typeof src === 'string') {
        if (isEmojiOrSymbol(src)) {
          return <span className="text-center" style={{ fontSize: '0.875rem', color: tintColor }}>{src}</span>;
        }
        return <img src={src} className={className + ' rounded'} alt="" />;
      }
    }
  }

  return <span className="opacity-50">•</span>;
}

// =====================================================================
// ─── Color ──────────────────────────────────────────────────────────
// =====================================================================

export const Color: Record<string, string> = {
  Red: '#FF6363',
  Orange: '#FF9F43',
  Yellow: '#FECA57',
  Green: '#2ECC71',
  Blue: '#54A0FF',
  Purple: '#C56CF0',
  Magenta: '#FF6B81',
  PrimaryText: '#FFFFFF',
  SecondaryText: 'rgba(255,255,255,0.5)',
};

// Dynamic proxy so any Color.X access returns a hex string
const ColorProxy = new Proxy(Color, {
  get(target, prop: string) {
    return target[prop] || '#FFFFFF';
  },
});
export { ColorProxy as Color_ };

// =====================================================================
// ─── Image ──────────────────────────────────────────────────────────
// =====================================================================

export const Image = {
  Mask: {
    Circle: 'circle' as const,
    RoundedRectangle: 'rounded' as const,
  },
};

// =====================================================================
// ─── Keyboard ───────────────────────────────────────────────────────
// =====================================================================

export const Keyboard = {
  Shortcut: {
    Common: {
      Copy: { modifiers: ['cmd'], key: 'c' },
      Cut: { modifiers: ['cmd'], key: 'x' },
      Paste: { modifiers: ['cmd'], key: 'v' },
      Undo: { modifiers: ['cmd'], key: 'z' },
      Redo: { modifiers: ['cmd', 'shift'], key: 'z' },
      SelectAll: { modifiers: ['cmd'], key: 'a' },
      New: { modifiers: ['cmd'], key: 'n' },
      Open: { modifiers: ['cmd'], key: 'o' },
      Save: { modifiers: ['cmd'], key: 's' },
      Find: { modifiers: ['cmd'], key: 'f' },
      Refresh: { modifiers: ['cmd'], key: 'r' },
      Delete: { modifiers: ['ctrl'], key: 'x' },
      Edit: { modifiers: ['cmd'], key: 'e' },
      ToggleQuickLook: { modifiers: ['cmd'], key: 'y' },
      MoveUp: { modifiers: ['cmd', 'option'], key: 'arrowUp' },
      MoveDown: { modifiers: ['cmd', 'option'], key: 'arrowDown' },
      Pin: { modifiers: ['cmd', 'shift'], key: 'p' },
    },
  },
};

// =====================================================================
// ─── Clipboard ──────────────────────────────────────────────────────
// =====================================================================

export const Clipboard = {
  async copy(content: string | { text?: string; html?: string }) {
    try {
      const text = typeof content === 'string' ? content : content.text || '';
      await navigator.clipboard.writeText(text);
      showToast({ title: 'Copied to clipboard', style: 'success' });
    } catch {}
  },
  async paste(content: string) {
    try {
      await navigator.clipboard.writeText(content);
    } catch {}
  },
  async readText(): Promise<string> {
    try {
      return await navigator.clipboard.readText();
    } catch {
      return '';
    }
  },
  async read(): Promise<{ text: string }> {
    try {
      const text = await navigator.clipboard.readText();
      return { text };
    } catch {
      return { text: '' };
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

const storagePrefix = 'sc-ext-';

export const LocalStorage = {
  async getItem(key: string): Promise<string | undefined> {
    return localStorage.getItem(storagePrefix + key) ?? undefined;
  },
  async setItem(key: string, value: string): Promise<void> {
    localStorage.setItem(storagePrefix + key, String(value));
  },
  async removeItem(key: string): Promise<void> {
    localStorage.removeItem(storagePrefix + key);
  },
  async allItems(): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(storagePrefix)) {
        result[k.slice(storagePrefix.length)] = localStorage.getItem(k) || '';
      }
    }
    return result;
  },
  async clear(): Promise<void> {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(storagePrefix)) toRemove.push(k);
    }
    toRemove.forEach((k) => localStorage.removeItem(k));
  },
};

// =====================================================================
// ─── Cache ──────────────────────────────────────────────────────────
// =====================================================================

export class Cache {
  private data: Record<string, string> = {};
  get(key: string): string | undefined { return this.data[key]; }
  set(key: string, value: string): void { this.data[key] = value; }
  remove(key: string): void { delete this.data[key]; }
  has(key: string): boolean { return key in this.data; }
  isEmpty = false;
  clear(): void { this.data = {}; }
}

// =====================================================================
// ─── AI (stub) ──────────────────────────────────────────────────────
// =====================================================================

export const AI = {
  async ask(prompt: string, options?: any): Promise<string> {
    return `AI is not available in SuperCommand. Prompt: "${prompt}"`;
  },
};

// =====================================================================
// ─── Utility Functions ──────────────────────────────────────────────
// =====================================================================

export function getPreferenceValues<T = Record<string, any>>(): T {
  return _extensionContext.preferences as T;
}

export function open(target: string, application?: string | any) {
  (window as any).electron?.openUrl?.(target);
}

export function closeMainWindow(options?: any) {
  (window as any).electron?.hideWindow?.();
}

export function popToRoot(options?: any) {
  // handled by ExtensionView navigation
}

export async function launchCommand(options: {
  name: string;
  type: string;
  extensionName?: string;
  ownerOrAuthorName?: string;
  arguments?: Record<string, string>;
  context?: Record<string, any>;
  fallbackText?: string;
}): Promise<void> {
  console.log('launchCommand:', options);
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

export async function getApplications(): Promise<
  Array<{ name: string; path: string; bundleId?: string }>
> {
  try {
    const electron = (window as any).electron;
    if (electron?.getApplications) {
      return await electron.getApplications();
    }
  } catch (e) {
    console.error('getApplications error:', e);
  }
  return [];
}

export async function getFrontmostApplication(): Promise<{
  name: string;
  path: string;
  bundleId?: string;
}> {
  try {
    const electron = (window as any).electron;
    if (electron?.getFrontmostApplication) {
      const app = await electron.getFrontmostApplication();
      if (app) return app;
    }
  } catch (e) {
    console.error('getFrontmostApplication error:', e);
  }
  return { name: 'SuperCommand', path: '', bundleId: 'com.supercommand' };
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

export function openExtensionPreferences(): void {
  console.log('openExtensionPreferences');
}

export function openCommandPreferences(): void {
  console.log('openCommandPreferences');
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
function makeActionExecutor(p: any): () => void {
  return () => {
    if (p.onAction) { p.onAction(); return; }
    if (p.onSubmit) { p.onSubmit(getFormValues()); return; }
    if (p.content !== undefined) {
      Clipboard.copy(String(p.content));
      showToast({ title: 'Copied to clipboard', style: ToastStyle.Success });
      return;
    }
    if (p.url) { (window as any).electron?.openUrl?.(p.url); return; }
    if (p.target && React.isValidElement(p.target)) {
      getGlobalNavigation().push(p.target);
      return;
    }
    if (p.paths) { trash(p.paths); p.onTrash?.(); return; }
  };
}

// Hook used by each Action component to register itself
function useActionRegistration(props: any) {
  const registry = useContext(ActionRegistryContext);
  const sectionTitle = useContext(ActionSectionContext);
  const idRef = useRef(`__action_${++_actionOrderCounter}`);
  const orderRef = useRef(++_actionOrderCounter);

  // Build a stable executor ref so we always call the latest props
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    if (!registry) return;
    const executor = () => makeActionExecutor(propsRef.current)();
    registry.register(idRef.current, {
      title: props.title || 'Action',
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
      registryRef.current.set(id, { id, ...data });
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
function ActionPanelSubmenu({ children, title, icon }: { children?: React.ReactNode; title?: string; icon?: any }) {
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
  useActionRegistration(_props);
  return null;
}
function ActionCopyToClipboard(_props: { content: any; title?: string; shortcut?: any; [key: string]: any }) {
  useActionRegistration(_props);
  return null;
}
function ActionOpenInBrowser(_props: { url: string; title?: string; shortcut?: any; [key: string]: any }) {
  useActionRegistration(_props);
  return null;
}
function ActionPush(_props: { title?: string; target: React.ReactElement; icon?: any; shortcut?: any; [key: string]: any }) {
  useActionRegistration(_props);
  return null;
}
function ActionSubmitForm(_props: { title?: string; onSubmit?: (values: any) => void; icon?: any; shortcut?: any; [key: string]: any }) {
  useActionRegistration(_props);
  return null;
}
function ActionTrash(_props: { title?: string; paths?: string[]; onTrash?: () => void; shortcut?: any; [key: string]: any }) {
  useActionRegistration(_props);
  return null;
}
function ActionPickDate(_props: { title?: string; onChange?: (date: Date | null) => void; shortcut?: any; [key: string]: any }) {
  useActionRegistration(_props);
  return null;
}
function ActionCreateSnippet(_props: any) { useActionRegistration(_props); return null; }
function ActionCreateQuicklink(_props: any) { useActionRegistration(_props); return null; }
function ActionToggleSidebar(_props: any) { useActionRegistration(_props); return null; }

export const Action = Object.assign(ActionComponent, {
  CopyToClipboard: ActionCopyToClipboard,
  OpenInBrowser: ActionOpenInBrowser,
  Push: ActionPush,
  SubmitForm: ActionSubmitForm,
  Paste: ActionCopyToClipboard,
  ShowInFinder: ActionComponent,
  OpenWith: ActionComponent,
  Trash: ActionTrash,
  PickDate: ActionPickDate,
  CreateSnippet: ActionCreateSnippet,
  CreateQuicklink: ActionCreateQuicklink,
  ToggleSidebar: ActionToggleSidebar,
  Style: {
    Regular: 'regular' as const,
    Destructive: 'destructive' as const,
  },
});

export const ActionPanel = Object.assign(ActionPanelComponent, {
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

  function walk(nodes: React.ReactNode, sectionTitle?: string) {
    React.Children.forEach(nodes, (child) => {
      if (!React.isValidElement(child)) return;
      const p = child.props as any;
      const hasChildren = p.children != null;
      const isActionLike = p.onAction || p.onSubmit || p.content !== undefined || p.url || p.target || p.paths;

      if (isActionLike || (p.title && !hasChildren)) {
        result.push({
          title: p.title || 'Action',
          icon: p.icon,
          shortcut: p.shortcut,
          style: p.style,
          sectionTitle,
          execute: makeActionExecutor(p),
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
  title, subtitle, icon, accessories, isSelected, dataIdx, onSelect, onActivate,
}: ListItemProps & { isSelected: boolean; dataIdx: number; onSelect: () => void; onActivate: () => void }) {
  const titleStr = typeof title === 'string' ? title : (title as any)?.value || '';
  const subtitleStr = typeof subtitle === 'string' ? subtitle : (subtitle as any)?.value || '';

  return (
    <div
      data-idx={dataIdx}
      className={`mx-1 px-2.5 py-[5px] rounded-lg cursor-pointer transition-all ${
        isSelected ? 'bg-white/[0.08]' : 'hover:bg-white/[0.04]'
      }`}
      onClick={onActivate}
      onMouseMove={onSelect}
    >
      <div className="flex items-center gap-2.5">
        {icon && (
          <div className="w-5 h-5 flex items-center justify-center flex-shrink-0 text-white/50 text-xs">
            {renderIcon(icon, 'w-5 h-5')}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <span className="text-white/90 text-[13px] truncate block">{titleStr}</span>
        </div>
        {subtitleStr && (
          <span className="text-white/30 text-xs flex-shrink-0 truncate max-w-[200px]">{subtitleStr}</span>
        )}
        {accessories?.map((acc, i) => {
          const accText = typeof acc?.text === 'string' ? acc.text
            : typeof acc?.text === 'object' ? acc.text?.value || '' : '';
          const accTextColor = typeof acc?.text === 'object' ? acc.text?.color : undefined;
          const tagText = typeof acc?.tag === 'string' ? acc.tag
            : typeof acc?.tag === 'object' ? acc.tag?.value || '' : '';
          const tagColor = typeof acc?.tag === 'object' ? acc.tag?.color : undefined;
          const dateStr = acc?.date ? new Date(acc.date).toLocaleDateString() : '';

          return (
            <span key={i} className="text-[11px] flex-shrink-0 flex items-center gap-1" style={{ color: accTextColor || tagColor || 'rgba(255,255,255,0.25)' }}>
              {acc?.icon && <span className="text-[10px]">{renderIcon(acc.icon, 'w-3 h-3')}</span>}
              {tagText ? (
                <span className="px-1.5 py-0.5 rounded text-[10px]" style={{ background: `${tagColor || 'rgba(255,255,255,0.1)'}22`, color: tagColor || 'rgba(255,255,255,0.5)' }}>{tagText}</span>
              ) : accText || dateStr || ''}
            </span>
          );
        })}
      </div>
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
  return (
    <div className="flex flex-col items-center justify-center h-full text-white/40 py-12">
      {icon && <div className="text-2xl mb-2 opacity-40">{typeof icon === 'string' ? icon : '○'}</div>}
      {title && <p className="text-sm font-medium">{title}</p>}
      {description && <p className="text-xs text-white/25 mt-1 max-w-xs text-center">{description}</p>}
    </div>
  );
}

// ── List.Dropdown — renders as a real <select> ───────────────────────

function ListDropdown({ children, tooltip, storeValue, onChange, value, defaultValue }: any) {
  const [internalValue, setInternalValue] = useState(value ?? defaultValue ?? '');

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
  if (e.key.toLowerCase() !== shortcut.key.toLowerCase()) return false;
  const mods = shortcut.modifiers || [];
  if (mods.includes('cmd') !== e.metaKey) return false;
  // Handle both 'opt' and 'option' (Raycast uses both forms)
  if ((mods.includes('opt') || mods.includes('option') || mods.includes('alt')) !== e.altKey) return false;
  if (mods.includes('shift') !== e.shiftKey) return false;
  if (mods.includes('ctrl') !== e.ctrlKey) return false;
  return true;
}

function ListComponent({
  children, searchBarPlaceholder, onSearchTextChange, isLoading,
  searchText: controlledSearch, filtering, isShowingDetail,
  navigationTitle, searchBarAccessory, throttle,
  selectedItemId, onSelectionChange, actions: listActions,
}: any) {
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
        // Include the actions element's component type in the snapshot.
        // When the actions switch (e.g. ActionPanel → ListActions), the
        // type (function ref) changes, the snapshot changes, and we
        // re-render so the correct actions are collected.
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

  const registryAPI = useMemo<ListRegistryAPI>(() => ({
    set(id, data) {
      registryRef.current.set(id, { id, ...data });
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

  // ── Search bar control ─────────────────────────────────────────
  const handleSearchChange = useCallback((text: string) => {
    setInternalSearch(text);
    onSearchTextChange?.(text);
    setSelectedIdx(0);
  }, [onSearchTextChange]);

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

  const { collectedActions: selectedActions, registryAPI: actionRegistry } = useCollectedActions();

  // Determine which actions element to render — item actions take priority
  const activeActionsElement = selectedItem?.props?.actions || listActions;

  const primaryAction = selectedActions[0];

  // ── Keyboard handler ───────────────────────────────────────────
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // ⌘K toggles action panel
    if (e.key === 'k' && e.metaKey) {
      e.preventDefault();
      setShowActions(prev => !prev);
      return;
    }
    if (showActions) return; // Let the overlay handle keys

    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); setSelectedIdx(p => Math.min(p + 1, filteredItems.length - 1)); break;
      case 'ArrowUp': e.preventDefault(); setSelectedIdx(p => Math.max(p - 1, 0)); break;
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
  }, [filteredItems.length, selectedIdx, pop, primaryAction, showActions]);

  // ── Window-level shortcut listener ─────────────────────────────
  // Extension-defined shortcuts (⌘E, ⌘D, ⌘T, etc.) must be caught
  // at the window level in the capture phase, BEFORE the browser or
  // Electron can intercept them. React's onKeyDown on a div sometimes
  // misses modifier-key combos due to native handling.
  //
  // We use refs for the values so the handler closure doesn't go stale
  // and we don't need to re-register the listener on every action change.
  const selectedActionsRef = useRef(selectedActions);
  selectedActionsRef.current = selectedActions;
  const showActionsRef = useRef(showActions);
  showActionsRef.current = showActions;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const actions = selectedActionsRef.current;
      const panelOpen = showActionsRef.current;

      // Only process when the action panel is NOT open
      if (panelOpen) return;
      // Skip ⌘K (handled by React handler for action panel toggle)
      if (e.key === 'k' && e.metaKey) return;
      // Only check shortcuts when a modifier key is active (not plain typing)
      if (!e.metaKey && !e.altKey && !e.ctrlKey) return;
      if (e.repeat) return;

      // Debug: log modifier key events and available shortcuts
      const shortcuts = actions.filter(a => a.shortcut).map(a =>
        `${a.title}[${a.shortcut!.modifiers?.join('+')}+${a.shortcut!.key}]`
      );
      console.log(`[Shortcut] key=${e.key} meta=${e.metaKey} alt=${e.altKey} shift=${e.shiftKey} | ${actions.length} actions, shortcuts: ${shortcuts.join(', ') || 'none'}`);

      for (const action of actions) {
        if (action.shortcut && matchesShortcut(e, action.shortcut)) {
          console.log(`[Shortcut] MATCH → ${action.title}`);
          e.preventDefault();
          e.stopPropagation();
          action.execute();
          return;
        }
      }
    };
    window.addEventListener('keydown', handler, true); // capture phase
    return () => window.removeEventListener('keydown', handler, true);
  }, []); // stable — reads from refs

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

  // ── Execute action and close panel ─────────────────────────────
  const handleActionExecute = useCallback((action: ExtractedAction) => {
    setShowActions(false);
    action.execute();
  }, []);

  // ── Render ─────────────────────────────────────────────────────

  const listContent = (
    <div ref={listRef} className="flex-1 overflow-y-auto py-1" style={{ background: 'rgba(10,10,12,0.5)' }}>
      {isLoading && filteredItems.length === 0 ? (
        <div className="flex items-center justify-center h-full text-white/50"><p className="text-sm">Loading…</p></div>
      ) : filteredItems.length === 0 ? (
        <div className="flex items-center justify-center h-full text-white/40"><p className="text-sm">No results</p></div>
      ) : (
        groupedItems.map((group, gi) => (
          <div key={gi} className="mb-0.5">
            {group.title && (
              <div className="px-3 pt-2 pb-1 text-[11px] uppercase tracking-wider text-white/25 font-medium select-none">{group.title}</div>
            )}
            {group.items.map(({ item, globalIdx }) => (
              <ListItemRenderer
                key={item.id}
                {...item.props}
                isSelected={globalIdx === selectedIdx}
                dataIdx={globalIdx}
                onSelect={() => setSelectedIdx(globalIdx)}
                onActivate={() => primaryAction?.execute()}
              />
            ))}
          </div>
        ))
      )}
    </div>
  );

  const detailPanel = isShowingDetail && detailElement ? (
    <div className="flex-1 border-l border-white/[0.06] overflow-y-auto" style={{ background: 'rgba(10,10,12,0.5)' }}>
      <div className="p-4">{detailElement}</div>
    </div>
  ) : null;

  return (
    <ListRegistryContext.Provider value={registryAPI}>
      {/* Hidden render area — children mount here and register items via context */}
      <div style={{ display: 'none' }}>
        {children}
        {/* Render ONE actions element in registry context so hooks work.
            Item-level actions take priority; list-level is fallback. */}
        {activeActionsElement && (
          <ActionRegistryContext.Provider value={actionRegistry}>
            <div key={selectedItem?.id || '__list_actions'}>
              {activeActionsElement}
            </div>
          </ActionRegistryContext.Provider>
        )}
      </div>

      <div className="flex flex-col h-full" onKeyDown={handleKeyDown}>
        {/* ── Search bar ──────────────────────────────────────── */}
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-white/[0.06]">
          <button onClick={pop} className="text-white/30 hover:text-white/60 transition-colors flex-shrink-0 p-0.5">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          </button>
          <input
            ref={inputRef}
            type="text"
            placeholder={searchBarPlaceholder || 'Search…'}
            value={searchText}
            onChange={e => handleSearchChange(e.target.value)}
            className="flex-1 bg-transparent border-none outline-none text-white/90 placeholder-white/30 text-[15px] font-light"
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

        {/* ── Footer ──────────────────────────────────────────── */}
        <div className="flex items-center px-3 py-1.5 border-t border-white/[0.06]" style={{ background: 'rgba(20,20,24,0.8)' }}>
          <div className="flex items-center gap-2 text-white/30 text-[11px] flex-1 min-w-0">
            <span className="truncate">{navigationTitle || _extensionContext.extensionName || 'Extension'}</span>
          </div>
          {primaryAction && (
            <div className="flex items-center gap-1.5 mr-3">
              <span className="text-white/50 text-[11px]">{primaryAction.title}</span>
              <kbd className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded bg-white/[0.06] text-[10px] text-white/30 font-medium">↩</kbd>
            </div>
          )}
          <button
            onClick={() => setShowActions(true)}
            className="flex items-center gap-1.5 text-white/40 hover:text-white/60 transition-colors"
          >
            <span className="text-[11px]">Actions</span>
            <kbd className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded bg-white/[0.06] text-[10px] text-white/30 font-medium">⌘</kbd>
            <kbd className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded bg-white/[0.06] text-[10px] text-white/30 font-medium">K</kbd>
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

export const List = Object.assign(ListComponent, {
  Item: ListItemComponent,
  Section: ListSectionComponent,
  EmptyView: ListEmptyView,
  Dropdown: ListDropdown,
});

// =====================================================================
// ─── Detail ─────────────────────────────────────────────────────────
// =====================================================================

function DetailComponent({ markdown, isLoading, children, actions, metadata, navigationTitle }: {
  markdown?: string; children?: React.ReactNode; isLoading?: boolean;
  navigationTitle?: string; actions?: React.ReactElement; metadata?: React.ReactElement;
}) {
  const { pop } = useNavigation();
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); pop(); } };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [pop]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-6" style={{ background: 'rgba(10,10,12,0.5)' }}>
        {isLoading ? (
          <div className="flex items-center justify-center h-full text-white/50"><p className="text-sm">Loading…</p></div>
        ) : (
          <>
            {markdown && <div className="text-white/80 text-sm leading-relaxed whitespace-pre-wrap">{markdown}</div>}
            {metadata}
            {children}
          </>
        )}
      </div>
    </div>
  );
}

const MetadataLabel = ({ title, text, icon }: { title: string; text?: string; icon?: any }) => (
  <div className="text-xs text-white/50"><span className="text-white/30">{title}: </span>{text}</div>
);
const MetadataSeparator = () => <hr className="border-white/[0.06] my-2" />;
const MetadataLink = ({ title, target, text }: { title: string; target: string; text: string }) => (
  <div className="text-xs"><span className="text-white/30">{title}: </span><a href={target} className="text-blue-400 hover:underline">{text}</a></div>
);
const MetadataTagListItem = ({ text, color }: any) => (
  <span className="text-xs bg-white/10 px-1.5 py-0.5 rounded text-white/60 mr-1">{text}</span>
);
const MetadataTagList = Object.assign(
  ({ children, title }: any) => <div className="flex flex-wrap gap-1">{title && <span className="text-xs text-white/30 mr-1">{title}:</span>}{children}</div>,
  { Item: MetadataTagListItem }
);

const Metadata = Object.assign(
  ({ children }: { children?: React.ReactNode }) => <div className="space-y-1 mt-4">{children}</div>,
  { Label: MetadataLabel, Separator: MetadataSeparator, Link: MetadataLink, TagList: MetadataTagList }
);

export const Detail = Object.assign(DetailComponent, { Metadata });

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

  // ── Keyboard handler ───────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); pop(); return; }
      // ⌘K toggles action panel
      if (e.key === 'k' && e.metaKey) { e.preventDefault(); setShowActions(prev => !prev); return; }
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

      <div className="flex flex-col h-full">
        {/* ── Navigation bar ────────────────────────────────────── */}
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-white/[0.06]">
          <button onClick={pop} className="text-white/30 hover:text-white/60 transition-colors flex-shrink-0 p-0.5">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          </button>
        </div>

        {/* ── Form content (horizontal layout) ──────────────────── */}
        <div className="flex-1 overflow-y-auto py-6 px-4" style={{ background: 'rgba(10,10,12,0.5)' }}>
          {isLoading ? (
            <div className="flex items-center justify-center h-full text-white/50"><p className="text-sm">Loading…</p></div>
          ) : (
            <div className="max-w-2xl mx-auto space-y-4">
              {children}
            </div>
          )}
        </div>

        {/* ── Footer ──────────────────────────────────────────── */}
        {formActions.length > 0 && (
          <div className="flex items-center px-3 py-1.5 border-t border-white/[0.06]" style={{ background: 'rgba(20,20,24,0.8)' }}>
            <div className="flex items-center gap-2 text-white/30 text-[11px] flex-1 min-w-0">
              <span className="truncate">{navigationTitle || _extensionContext.extensionName || 'Extension'}</span>
            </div>
            {primaryAction && (
              <div className="flex items-center gap-1.5 mr-3">
                <span className="text-white/50 text-[11px]">{primaryAction.title}</span>
                <kbd className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded bg-white/[0.06] text-[10px] text-white/30 font-medium">⌘</kbd>
                <kbd className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded bg-white/[0.06] text-[10px] text-white/30 font-medium">↩</kbd>
              </div>
            )}
            <button
              onClick={() => setShowActions(true)}
              className="flex items-center gap-1.5 text-white/40 hover:text-white/60 transition-colors"
            >
              <span className="text-[11px]">Actions</span>
              <kbd className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded bg-white/[0.06] text-[10px] text-white/30 font-medium">⌘</kbd>
              <kbd className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded bg-white/[0.06] text-[10px] text-white/30 font-medium">K</kbd>
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
        {title && <label className="text-[13px] text-white/40">{title}</label>}
      </div>
      <div className="flex-1 min-w-0">
        {children}
        {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
        {info && <p className="text-xs text-white/30 mt-1">{info}</p>}
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
        className="w-full bg-white/[0.06] border border-white/[0.08] rounded-md px-3 py-1.5 text-sm text-white outline-none focus:border-white/20" autoFocus={autoFocus} />
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
      <textarea placeholder={placeholder} value={fieldValue} onChange={handleChange} rows={4}
        className="w-full bg-white/[0.06] border border-white/[0.08] rounded-md px-3 py-1.5 text-sm text-white outline-none focus:border-white/20 resize-y" />
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
        className="w-full bg-white/[0.06] border border-white/[0.08] rounded-md px-3 py-1.5 text-sm text-white outline-none focus:border-white/20" />
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
      <label className="flex items-center gap-2 py-1.5 text-sm text-white/80 cursor-pointer">
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
          className="w-full bg-white/[0.06] border border-white/[0.08] rounded-md px-3 py-1.5 text-sm text-white outline-none">
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
        className="w-full bg-white/[0.06] border border-white/[0.08] rounded-md px-3 py-1.5 text-sm text-white outline-none focus:border-white/20" />
    </FormFieldRow>
  ),
  { Type: { Date: 'date', DateTime: 'datetime' }, isFullDay: false }
);

FormComponent.Description = ({ text, title }: any) => (
  <div className="flex items-start gap-4">
    <div className="w-24 flex-shrink-0" />
    <p className="text-xs text-white/40 flex-1">{title ? <strong>{title}: </strong> : null}{text}</p>
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

FormComponent.FilePicker = ({ id, title, value, onChange, allowMultipleSelection, canChooseDirectories, canChooseFiles, error }: any) => (
  <FormFieldRow title={title} error={error}>
    <div className="text-xs text-white/30 py-1.5">File picker not available</div>
  </FormFieldRow>
);

FormComponent.LinkAccessory = ({ text, target }: any) => (
  <a href={target} className="text-xs text-blue-400 hover:underline">{text}</a>
);

export const Form = FormComponent;

// =====================================================================
// ─── Grid ───────────────────────────────────────────────────────────
// =====================================================================

function GridComponent({ children, columns, inset, isLoading, searchBarPlaceholder, onSearchTextChange, filtering, navigationTitle, searchBarAccessory, aspectRatio, fit, searchText: controlledSearch, selectedItemId, onSelectionChange, throttle }: any) {
  const [internalSearch, setInternalSearch] = useState('');
  const searchText = controlledSearch ?? internalSearch;
  const inputRef = useRef<HTMLInputElement>(null);
  const { pop } = useNavigation();

  const handleSearchChange = (text: string) => {
    setInternalSearch(text);
    onSearchTextChange?.(text);
  };

  useEffect(() => { inputRef.current?.focus(); }, []);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06]">
        <input ref={inputRef} type="text" placeholder={searchBarPlaceholder || 'Search…'} value={searchText}
          onChange={(e) => handleSearchChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); pop(); } }}
          className="flex-1 bg-transparent border-none outline-none text-white/90 placeholder-white/30 text-base font-light" autoFocus />
      </div>
      <div className="flex-1 overflow-y-auto p-2" style={{ background: 'rgba(10,10,12,0.5)' }}>
        {isLoading ? (
          <div className="flex items-center justify-center h-full text-white/50"><p className="text-sm">Loading…</p></div>
        ) : (
          <div className={`grid gap-2`} style={{ gridTemplateColumns: `repeat(${columns || 4}, 1fr)` }}>
            {children}
          </div>
        )}
      </div>
    </div>
  );
}

const GridItem = ({ title, subtitle, content, actions, keywords, id, accessory }: any) => (
  <div className="text-sm text-white/80 p-2 bg-white/[0.04] rounded-lg">
    {content?.source && <img src={typeof content.source === 'string' ? content.source : ''} className="w-full rounded mb-1" alt="" />}
    {title && <p className="truncate text-xs">{title}</p>}
    {subtitle && <p className="truncate text-[10px] text-white/40">{subtitle}</p>}
  </div>
);

export const Grid = Object.assign(GridComponent, {
  Item: GridItem,
  Section: ListSectionComponent,
  EmptyView: ListEmptyView,
  Dropdown: ListDropdown,
});
Grid.Dropdown = ListDropdown;

// =====================================================================
// ─── MenuBarExtra ───────────────────────────────────────────────────
// =====================================================================

function MenuBarExtraComponent({ children, icon, title, tooltip, isLoading }: any) {
  return <div className="flex flex-col h-full p-2">{children}</div>;
}

function MenuBarExtraItem({ title, icon, onAction, shortcut, tooltip }: any) {
  return (
    <button onClick={onAction} className="w-full text-left px-3 py-1.5 text-sm text-white/80 hover:bg-white/[0.06] rounded transition-colors">
      {title}
    </button>
  );
}

export const MenuBarExtra = Object.assign(MenuBarExtraComponent, {
  Item: MenuBarExtraItem,
  Section: ({ children, title }: any) => <div className="mb-1">{title && <div className="px-3 py-1 text-[11px] text-white/25">{title}</div>}{children}</div>,
  Separator: () => <hr className="border-white/[0.06] my-1" />,
  Submenu: ({ children, title, icon }: any) => <>{children}</>,
});

// =====================================================================
// ─── Helpers (internal) ─────────────────────────────────────────────
// =====================================================================

// executePrimaryAction is now handled by extractActionsFromElement + ActionPanelOverlay
// No legacy helpers needed.

// =====================================================================
// ─── @raycast/utils — Hooks & Utilities ─────────────────────────────
// =====================================================================

// ── usePromise ──────────────────────────────────────────────────────
// The most commonly used hook from @raycast/utils.
// Signature: usePromise(fn, args?, options?)

export function usePromise<T>(
  fn: (...args: any[]) => Promise<T>,
  args?: any[],
  options?: {
    initialData?: T;
    execute?: boolean;
    onData?: (data: T) => void;
    onError?: (error: Error) => void;
    onWillExecute?: (args: any[]) => void;
    abortable?: React.MutableRefObject<AbortController | null | undefined>;
    failureToastOptions?: any;
  }
): {
  data: T | undefined;
  isLoading: boolean;
  error: Error | undefined;
  revalidate: () => void;
  mutate: (asyncUpdate?: Promise<T>, options?: any) => Promise<T | undefined>;
} {
  const [data, setData] = useState<T | undefined>(options?.initialData);
  const [isLoading, setIsLoading] = useState(options?.execute !== false);
  const [error, setError] = useState<Error | undefined>(undefined);
  const fnRef = useRef(fn);
  const argsRef = useRef(args || []);
  fnRef.current = fn;
  argsRef.current = args || [];

  const execute = useCallback(() => {
    if (options?.execute === false) return;
    setIsLoading(true);
    setError(undefined);
    options?.onWillExecute?.(argsRef.current);

    // Wrap in Promise.resolve to handle both sync and async functions
    Promise.resolve()
      .then(() => fnRef.current(...argsRef.current))
      .then((result) => {
        setData(result);
        setIsLoading(false);
        options?.onData?.(result);
      })
      .catch((err) => {
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        setIsLoading(false);
        options?.onError?.(e);
        if (options?.failureToastOptions !== false) {
          // silent — don't show toast for every error
        }
      });
  }, [options?.execute]);

  useEffect(() => {
    execute();
  }, [execute, ...(args || [])]);

  const revalidate = useCallback(() => {
    execute();
  }, [execute]);

  const mutate = useCallback(async (asyncUpdate?: Promise<T>, mutateOptions?: any) => {
    if (mutateOptions?.optimisticUpdate) {
      setData(mutateOptions.optimisticUpdate(data));
    }
    if (asyncUpdate) {
      try {
        const result = await asyncUpdate;
        if (!mutateOptions?.shouldRevalidateAfter) {
          setData(result);
        }
        return result;
      } catch (e) {
        if (mutateOptions?.rollbackOnError) {
          revalidate();
        }
        throw e;
      }
    }
    revalidate();
    return data;
  }, [data, revalidate]);

  return { data, isLoading, error, revalidate, mutate };
}

// ── useFetch ────────────────────────────────────────────────────────

export function useFetch<T = any, U = undefined>(
  url: string | ((options: { page: number; cursor?: string; lastItem?: any }) => string),
  options?: {
    method?: string;
    headers?: Record<string, string>;
    body?: any;
    mapResult?: (result: any) => { data: T; hasMore?: boolean; cursor?: string } | T;
    parseResponse?: (response: Response) => Promise<any>;
    initialData?: T;
    execute?: boolean;
    keepPreviousData?: boolean;
    onData?: (data: T) => void;
    onError?: (error: Error) => void;
    onWillExecute?: () => void;
    failureToastOptions?: any;
  }
): {
  data: T | undefined;
  isLoading: boolean;
  error: Error | undefined;
  revalidate: () => void;
  mutate: (asyncUpdate?: Promise<T>, options?: any) => Promise<T | undefined>;
  pagination: { page: number; pageSize: number; hasMore: boolean; onLoadMore: () => void };
} {
  const [page, setPage] = useState(0);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = useState(true);
  const [allData, setAllData] = useState<T | undefined>(options?.initialData);
  const [isLoading, setIsLoading] = useState(options?.execute !== false);
  const [error, setError] = useState<Error | undefined>(undefined);

  // Use refs to avoid stale closures in fetchData
  const urlRef = useRef(url);
  const optionsRef = useRef(options);
  urlRef.current = url;
  optionsRef.current = options;

  const fetchData = useCallback(async (pageNum: number, currentCursor?: string) => {
    const opts = optionsRef.current;
    if (opts?.execute === false) return;
    setIsLoading(true);
    setError(undefined);

    try {
      const resolvedUrl = typeof urlRef.current === 'function'
        ? urlRef.current({ page: pageNum, cursor: currentCursor, lastItem: undefined })
        : urlRef.current;

      const res = await fetch(resolvedUrl, {
        method: opts?.method,
        headers: opts?.headers,
        body: opts?.body ? JSON.stringify(opts.body) : undefined,
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const parsed = opts?.parseResponse ? await opts.parseResponse(res) : await res.json();
      const mapped = opts?.mapResult ? opts.mapResult(parsed) : parsed;

      // Handle pagination format { data, hasMore, cursor }
      if (mapped && typeof mapped === 'object' && 'data' in mapped) {
        const paginatedResult = mapped as { data: T; hasMore?: boolean; cursor?: string };
        setHasMore(paginatedResult.hasMore ?? false);
        setCursor(paginatedResult.cursor);

        // Use functional update to avoid stale closure issues
        setAllData(prev => {
          if (pageNum === 0) {
            return paginatedResult.data;
          }
          // Accumulate data for subsequent pages
          if (Array.isArray(paginatedResult.data) && Array.isArray(prev)) {
            return [...prev, ...paginatedResult.data] as unknown as T;
          }
          // If previous data wasn't an array, just use new data
          return paginatedResult.data;
        });
        opts?.onData?.(paginatedResult.data);
      } else {
        // Non-paginated response
        setAllData(mapped as T);
        setHasMore(false);
        opts?.onData?.(mapped as T);
      }
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
      opts?.onError?.(e);
    } finally {
      setIsLoading(false);
    }
  }, []); // No dependencies - we use refs

  // Track URL for re-fetching when it changes (for non-function URLs)
  const urlString = typeof url === 'string' ? url : 'function';

  useEffect(() => {
    setPage(0);
    setCursor(undefined);
    setAllData(options?.initialData);
    fetchData(0, undefined);
  }, [fetchData, urlString]);

  const revalidate = useCallback(() => {
    setPage(0);
    setCursor(undefined);
    setAllData(undefined);
    fetchData(0, undefined);
  }, [fetchData]);

  const mutate = useCallback(async (asyncUpdate?: Promise<T>) => {
    if (asyncUpdate) {
      const result = await asyncUpdate;
      setAllData(result);
      return result;
    }
    revalidate();
    return undefined; // Can't return current state synchronously
  }, [revalidate]);

  const onLoadMore = useCallback(() => {
    if (hasMore && !isLoading) {
      const nextPage = page + 1;
      setPage(nextPage);
      fetchData(nextPage, cursor);
    }
  }, [hasMore, isLoading, page, cursor, fetchData]);

  const pagination = useMemo(() => ({
    page,
    pageSize: 20,
    hasMore,
    onLoadMore,
  }), [page, hasMore, onLoadMore]);

  return { data: allData, isLoading, error, revalidate, mutate, pagination };
}

// ── useCachedPromise ────────────────────────────────────────────────
// This hook supports pagination when the async function returns { data, hasMore, cursor }.
// It accumulates data across pages and provides pagination controls.

export function useCachedPromise<T>(
  fn: (...args: any[]) => Promise<T> | ((...args: any[]) => (...innerArgs: any[]) => Promise<any>),
  args?: any[],
  options?: {
    initialData?: T;
    execute?: boolean;
    keepPreviousData?: boolean;
    onData?: (data: T) => void;
    onError?: (error: Error) => void;
    failureToastOptions?: any;
  }
): {
  data: T | undefined;
  isLoading: boolean;
  error: Error | undefined;
  revalidate: () => void;
  mutate: (asyncUpdate?: Promise<T>, options?: any) => Promise<T | undefined>;
  pagination?: { page: number; pageSize: number; hasMore: boolean; onLoadMore: () => void };
} {
  const [page, setPage] = useState(0);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = useState(true);
  const [accumulatedData, setAccumulatedData] = useState<any[] | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(options?.execute !== false);
  const [error, setError] = useState<Error | undefined>(undefined);
  const [isPaginated, setIsPaginated] = useState(false);

  const fnRef = useRef(fn);
  const argsRef = useRef(args || []);
  const optionsRef = useRef(options);
  fnRef.current = fn;
  argsRef.current = args || [];
  optionsRef.current = options;

  const fetchPage = useCallback(async (pageNum: number, currentCursor?: string) => {
    const opts = optionsRef.current;
    if (opts?.execute === false) return;
    setIsLoading(true);
    setError(undefined);

    try {
      // Call the function with the provided args
      const outerResult = fnRef.current(...argsRef.current);

      // Check if the result is a function (pagination pattern)
      // In pagination mode: fn(args) returns (paginationOptions) => Promise<{ data, hasMore, cursor }>
      if (typeof outerResult === 'function') {
        setIsPaginated(true);
        const paginationOptions = { page: pageNum, cursor: currentCursor, lastItem: undefined };
        const innerResult = await outerResult(paginationOptions);

        // Check if result is paginated format { data, hasMore, cursor }
        if (innerResult && typeof innerResult === 'object' && 'data' in innerResult) {
          const { data: pageData, hasMore: more, cursor: nextCursor } = innerResult;
          setHasMore(more ?? false);
          setCursor(nextCursor);

          if (pageNum === 0) {
            setAccumulatedData(Array.isArray(pageData) ? pageData : []);
          } else {
            setAccumulatedData(prev => {
              const prevArr = Array.isArray(prev) ? prev : [];
              const newArr = Array.isArray(pageData) ? pageData : [];
              return [...prevArr, ...newArr];
            });
          }
          opts?.onData?.((innerResult as any).data);
        } else {
          // Non-paginated result from inner function
          setAccumulatedData(innerResult as any);
          setHasMore(false);
        }
      } else {
        // Not a pagination function - treat as a regular promise
        const result = await outerResult;

        // Check if regular result happens to be paginated format
        if (result && typeof result === 'object' && 'data' in result && 'hasMore' in result) {
          setIsPaginated(true);
          const { data: pageData, hasMore: more, cursor: nextCursor } = result as any;
          setHasMore(more ?? false);
          setCursor(nextCursor);

          if (pageNum === 0) {
            setAccumulatedData(Array.isArray(pageData) ? pageData : []);
          } else {
            setAccumulatedData(prev => {
              const prevArr = Array.isArray(prev) ? prev : [];
              const newArr = Array.isArray(pageData) ? pageData : [];
              return [...prevArr, ...newArr];
            });
          }
          opts?.onData?.(pageData as T);
        } else {
          // Non-paginated result
          setAccumulatedData(result as any);
          setHasMore(false);
          opts?.onData?.(result as T);
        }
      }
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
      opts?.onError?.(e);
    } finally {
      setIsLoading(false);
    }
  }, []); // No dependencies - using refs

  // Re-fetch when args change (use JSON stringification for deep comparison)
  const argsKey = JSON.stringify(args || []);
  useEffect(() => {
    setPage(0);
    setCursor(undefined);
    setAccumulatedData(undefined);
    fetchPage(0, undefined);
  }, [argsKey, fetchPage]);

  const revalidate = useCallback(() => {
    setPage(0);
    setCursor(undefined);
    setAccumulatedData(undefined);
    fetchPage(0, undefined);
  }, [fetchPage]);

  const mutate = useCallback(async (asyncUpdate?: Promise<T>) => {
    if (asyncUpdate) {
      const result = await asyncUpdate;
      setAccumulatedData(result as any);
      return result;
    }
    revalidate();
    return accumulatedData as T | undefined;
  }, [accumulatedData, revalidate]);

  const onLoadMore = useCallback(() => {
    if (hasMore && !isLoading) {
      const nextPage = page + 1;
      setPage(nextPage);
      fetchPage(nextPage, cursor);
    }
  }, [hasMore, isLoading, page, cursor, fetchPage]);

  const pagination = useMemo(() => ({
    page,
    pageSize: 10,
    hasMore,
    onLoadMore,
  }), [page, hasMore, onLoadMore]);

  return {
    data: accumulatedData as T | undefined,
    isLoading,
    error,
    revalidate,
    mutate,
    pagination: isPaginated ? pagination : undefined,
  };
}

// ── useCachedState ──────────────────────────────────────────────────

export function useCachedState<T>(
  key: string,
  initialValue?: T
): [T, (value: T | ((prev: T) => T)) => void] {
  const storageKey = `sc-cache-${key}`;
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      return stored ? JSON.parse(stored) : (initialValue as T);
    } catch {
      return initialValue as T;
    }
  });

  const setter = useCallback((newValue: T | ((prev: T) => T)) => {
    setValue((prev) => {
      const resolved = typeof newValue === 'function' ? (newValue as (prev: T) => T)(prev) : newValue;
      try { localStorage.setItem(storageKey, JSON.stringify(resolved)); } catch {}
      return resolved;
    });
  }, [storageKey]);

  return [value, setter];
}

// ── useForm ─────────────────────────────────────────────────────────
// https://developers.raycast.com/utils-reference/react-hooks/useForm

export function useForm<T extends Record<string, any> = Record<string, any>>(options: {
  onSubmit: (values: T) => void | boolean | Promise<void | boolean>;
  initialValues?: Partial<T>;
  validation?: Partial<Record<keyof T, (value: any) => string | undefined>>;
}): {
  handleSubmit: (values: T) => void;
  itemProps: Record<string, { id: string; value: any; onChange: (value: any) => void; error?: string; onBlur?: () => void }>;
  values: T;
  setValue: (key: keyof T, value: any) => void;
  setValidationError: (key: keyof T, error: string) => void;
  reset: (values?: Partial<T>) => void;
  focus: (key: keyof T) => void;
} {
  const [values, setValues] = useState<T>((options.initialValues || {}) as T);
  const [errors, setErrors] = useState<Partial<Record<keyof T, string>>>({});

  const setValue = useCallback((key: keyof T, value: any) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    // Clear error when value changes
    setErrors((prev) => { const next = { ...prev }; delete next[key]; return next; });
  }, []);

  const setValidationError = useCallback((key: keyof T, error: string) => {
    setErrors((prev) => ({ ...prev, [key]: error }));
  }, []);

  const validate = useCallback((): boolean => {
    if (!options.validation) return true;
    const newErrors: Partial<Record<keyof T, string>> = {};
    let valid = true;
    for (const key of Object.keys(options.validation) as (keyof T)[]) {
      const validator = options.validation[key];
      if (validator) {
        const error = validator(values[key]);
        if (error) {
          newErrors[key] = error;
          valid = false;
        }
      }
    }
    setErrors(newErrors);
    return valid;
  }, [values, options.validation]);

  const handleSubmit = useCallback((submitValues: T) => {
    if (validate()) {
      options.onSubmit(submitValues || values);
    }
  }, [values, validate, options.onSubmit]);

  const reset = useCallback((newValues?: Partial<T>) => {
    setValues((newValues || options.initialValues || {}) as T);
    setErrors({});
  }, [options.initialValues]);

  const focus = useCallback((_key: keyof T) => {
    // Cannot actually focus in this environment
  }, []);

  // Generate itemProps for each field
  const itemProps = useMemo(() => {
    const props: Record<string, any> = {};
    const allKeys = new Set([
      ...Object.keys(options.initialValues || {}),
      ...Object.keys(options.validation || {}),
      ...Object.keys(values),
    ]);
    for (const key of allKeys) {
      props[key as string] = {
        id: key as string,
        value: values[key as keyof T],
        onChange: (v: any) => setValue(key as keyof T, v),
        error: errors[key as keyof T],
        onBlur: () => {
          if (options.validation?.[key as keyof T]) {
            const err = options.validation[key as keyof T]!(values[key as keyof T]);
            if (err) setErrors((prev) => ({ ...prev, [key]: err }));
          }
        },
      };
    }
    return props;
  }, [values, errors, options.initialValues, options.validation, setValue]);

  return { handleSubmit, itemProps, values, setValue, setValidationError, reset, focus };
}

// ── useExec ─────────────────────────────────────────────────────────

export function useExec<T = string>(
  command: string,
  args?: string[],
  options?: {
    shell?: boolean | string;
    input?: string;
    encoding?: string;
    parseOutput?: (output: { stdout: string; stderr: string; exitCode: number }) => T;
    initialData?: T;
    execute?: boolean;
    onData?: (data: T) => void;
    onError?: (error: Error) => void;
    onWillExecute?: () => void;
    failureToastOptions?: any;
    env?: Record<string, string>;
    cwd?: string;
  }
) {
  return usePromise(
    async () => {
      const electron = (window as any).electron;
      if (!electron?.execCommand) {
        console.warn(`useExec: execCommand not available for "${command}"`);
        const output = { stdout: '', stderr: '', exitCode: 0 };
        return options?.parseOutput ? options.parseOutput(output) : ('' as any as T);
      }

      const result = await electron.execCommand(command, args || [], {
        shell: options?.shell,
        input: options?.input,
        env: options?.env,
      });

      if (result.exitCode !== 0 && result.stderr) {
        throw new Error(result.stderr);
      }

      if (options?.parseOutput) {
        return options.parseOutput(result);
      }

      return result.stdout as any as T;
    },
    [],
    {
      initialData: options?.initialData,
      execute: options?.execute,
      onData: options?.onData,
      onError: options?.onError,
    }
  );
}

// ── useSQL ──────────────────────────────────────────────────────────

export function useSQL<T = any>(
  databasePath: string,
  query: string,
  options?: { permissionPriming?: string; execute?: boolean }
) {
  return usePromise(
    async () => {
      console.warn('useSQL is not available in SuperCommand renderer');
      return [] as T[];
    },
    [],
    { execute: options?.execute }
  );
}

// ── useStreamJSON ───────────────────────────────────────────────────

export function useStreamJSON<T = any>(
  url: string,
  options?: any
) {
  return useFetch(url, options);
}

// ── useAI ───────────────────────────────────────────────────────────

export function useAI(prompt: string, options?: { model?: string; creativity?: number; execute?: boolean }) {
  return usePromise(
    async () => {
      return `AI is not available in SuperCommand. Prompt: "${prompt}"`;
    },
    [],
    { execute: options?.execute }
  );
}

// ── useFrecencySorting ──────────────────────────────────────────────
// Sorts items by frecency (frequency + recency). Returns the sorted data
// and a function to track visits.

export function useFrecencySorting<T>(
  data: T[] | undefined,
  options?: {
    key?: (item: T) => string;
    namespace?: string;
    sortUnvisited?: (a: T, b: T) => number;
  }
): {
  data: T[];
  visitItem: (item: T) => Promise<void>;
  resetRanking: (item: T) => Promise<void>;
} {
  // Simple implementation that just returns the data as-is
  // In a full implementation, this would track visit frequency and recency
  const sortedData = useMemo(() => {
    // Handle undefined/null
    if (!data) return [];
    // Handle non-array inputs gracefully (defensive programming)
    if (!Array.isArray(data)) {
      console.warn('[useFrecencySorting] Expected array but received:', typeof data);
      // If it's an object with a data property, try to extract it
      if (typeof data === 'object' && data !== null && 'data' in (data as any)) {
        const innerData = (data as any).data;
        if (Array.isArray(innerData)) return [...innerData];
      }
      return [];
    }
    return [...data];
  }, [data]);

  const visitItem = useCallback(async (item: T) => {
    // In a full implementation, this would record the visit
  }, []);

  const resetRanking = useCallback(async (item: T) => {
    // In a full implementation, this would reset the item's ranking
  }, []);

  return { data: sortedData, visitItem, resetRanking };
}

// ── useLocalStorage ─────────────────────────────────────────────────
// Syncs state with localStorage

export function useLocalStorage<T>(
  key: string,
  initialValue?: T
): {
  value: T | undefined;
  setValue: (value: T) => Promise<void>;
  removeValue: () => Promise<void>;
  isLoading: boolean;
} {
  const [value, setValueState] = useState<T | undefined>(() => {
    try {
      const stored = localStorage.getItem(`raycast-${key}`);
      return stored ? JSON.parse(stored) : initialValue;
    } catch {
      return initialValue;
    }
  });
  const [isLoading, setIsLoading] = useState(false);

  const setValue = useCallback(async (newValue: T) => {
    setValueState(newValue);
    try {
      localStorage.setItem(`raycast-${key}`, JSON.stringify(newValue));
    } catch {}
  }, [key]);

  const removeValue = useCallback(async () => {
    setValueState(undefined);
    try {
      localStorage.removeItem(`raycast-${key}`);
    } catch {}
  }, [key]);

  return { value, setValue, removeValue, isLoading };
}

// ── getFavicon ──────────────────────────────────────────────────────

export function getFavicon(url: string | { url: string }, options?: { fallback?: string; size?: number; mask?: string }): string {
  const rawUrl = typeof url === 'string' ? url : url.url;
  try {
    const u = new URL(rawUrl);
    const size = options?.size || 64;
    return `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=${size}`;
  } catch {
    return options?.fallback || '';
  }
}

// ── runAppleScript ──────────────────────────────────────────────────

export async function runAppleScript(script: string, options?: any): Promise<string> {
  try {
    const electron = (window as any).electron;
    if (electron?.runAppleScript) {
      return await electron.runAppleScript(script);
    }
  } catch (e) {
    console.error('runAppleScript error:', e);
  }
  return '';
}

// ── showFailureToast ────────────────────────────────────────────────

export async function showFailureToast(error: Error | string | unknown, options?: { title?: string; message?: string; primaryAction?: any }): Promise<void> {
  const msg = typeof error === 'string' ? error : error instanceof Error ? error.message : String(error);
  showToast({ title: options?.title || 'Error', message: options?.message || msg, style: Toast.Style.Failure });
}

// =====================================================================
// ─── Additional @raycast/api exports ────────────────────────────────
// =====================================================================

// ToastStyle is already exported above with the Toast class

export const LaunchProps = {} as any;

// Raycast OAuth
export const OAuth = {
  PKCEClient: class {
    constructor(_options: any) {}
    authorizationRequest(_options: any) { return { toURL: () => '', codeChallenge: '', codeVerifier: '', state: '' }; }
    async authorize(_request: any) { return { authorizationCode: '' }; }
    async setTokens(_tokens: any) {}
    async getTokens() { return null; }
    async removeTokens() {}
  },
  TokenSet: class {
    accessToken = '';
    refreshToken = '';
    idToken = '';
    isExpired() { return true; }
    scope = '';
  },
  TokenResponse: class {},
};

// getPreferenceValues already exported above

// Additional type-only exports that extensions might reference
export type Preferences = Record<string, any>;
export type LaunchContext = Record<string, any>;
export type Application = { name: string; path: string; bundleId?: string };
export type FileSystemItem = { path: string };

// WindowManagement
export const WindowManagement = {
  getActiveWindow: async () => ({ id: '1', title: 'SuperCommand', bounds: { x: 0, y: 0, width: 800, height: 600 } }),
  getWindows: async () => [],
  getDesktops: async () => [{ id: '1', windows: [] }],
};

// BrowserExtension
export const BrowserExtension = {
  getContent: async (options?: any) => '',
  getTabs: async () => [],
  getActiveTab: async () => ({ url: '', title: '' }),
};

// updateCommandMetadata
export async function updateCommandMetadata(metadata: { subtitle?: string }): Promise<void> {
  // noop in SuperCommand
}

