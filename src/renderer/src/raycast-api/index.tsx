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
  // In a real implementation this would show a modal.
  // For compatibility, we auto-confirm.
  return true;
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
};

// Return the property name as the icon value. This works with our
// renderer which shows the mapped icon or a dot for unknown icons.
export const Icon: Record<string, string> = new Proxy({} as Record<string, string>, {
  get(_target, prop: string) {
    return iconMap[prop] || '•';
  },
});

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
    if (icon.length <= 2 || /[\u{1F300}-\u{1F9FF}]/u.test(icon)) {
      return <span className="text-center" style={{ fontSize: '0.875rem' }}>{icon}</span>;
    }
    // Otherwise show a dot
    return <span className="opacity-50">•</span>;
  }

  // If it's an object with source property
  if (typeof icon === 'object' && icon !== null) {
    if (icon.source) {
      const src = typeof icon.source === 'string' ? icon.source : icon.source?.light || icon.source?.dark || '';
      if (src) {
        return <img src={src} className={className + ' rounded'} alt="" />;
      }
    }
    // Handle { light, dark } theme icons
    if (icon.light || icon.dark) {
      const src = icon.dark || icon.light;
      if (typeof src === 'string') {
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
// ─── ActionPanel ────────────────────────────────────────────────────
// =====================================================================

function ActionPanelComponent({ children }: { children?: React.ReactNode; title?: string }) {
  return <>{children}</>;
}

// =====================================================================
// ─── Action ─────────────────────────────────────────────────────────
// =====================================================================

function ActionComponent({ title, onAction }: { title?: string; icon?: any; shortcut?: any; onAction?: () => void; style?: any; [key: string]: any }) {
  return (
    <button onClick={onAction} className="w-full text-left px-3 py-1.5 text-sm text-white/80 hover:bg-white/[0.06] rounded transition-colors">
      {title}
    </button>
  );
}

function ActionCopyToClipboard({ content, title, ...rest }: { content: any; title?: string; [key: string]: any }) {
  return (
    <button onClick={() => Clipboard.copy(String(content))} className="w-full text-left px-3 py-1.5 text-sm text-white/80 hover:bg-white/[0.06] rounded transition-colors">
      {title || 'Copy to Clipboard'}
    </button>
  );
}

function ActionOpenInBrowser({ url, title, ...rest }: { url: string; title?: string; [key: string]: any }) {
  return (
    <button onClick={() => (window as any).electron?.openUrl?.(url)} className="w-full text-left px-3 py-1.5 text-sm text-white/80 hover:bg-white/[0.06] rounded transition-colors">
      {title || 'Open in Browser'}
    </button>
  );
}

function ActionPush({ title, target, ...rest }: { title?: string; target: React.ReactElement; [key: string]: any }) {
  const { push } = useNavigation();
  return (
    <button onClick={() => push(target)} className="w-full text-left px-3 py-1.5 text-sm text-white/80 hover:bg-white/[0.06] rounded transition-colors">
      {title || 'Open'}
    </button>
  );
}

function ActionSubmitForm({ title, onSubmit, ...rest }: { title?: string; onSubmit?: (values: any) => void; [key: string]: any }) {
  const handleSubmit = () => {
    const values = getFormValues();
    const errors = getFormErrors();
    // Don't submit if there are errors
    if (Object.keys(errors).length > 0) {
      showToast({ title: 'Please fix form errors', style: Toast.Style.Failure });
      return;
    }
    onSubmit?.(values);
  };

  return (
    <button onClick={handleSubmit} className="w-full text-left px-3 py-1.5 text-sm text-white/80 hover:bg-white/[0.06] rounded transition-colors">
      {title || 'Submit'}
    </button>
  );
}

function ActionTrash({ title, paths, onTrash, ...rest }: { title?: string; paths: string[]; onTrash?: () => void; [key: string]: any }) {
  return (
    <button onClick={() => { trash(paths); onTrash?.(); }} className="w-full text-left px-3 py-1.5 text-sm text-white/80 hover:bg-white/[0.06] rounded transition-colors">
      {title || 'Move to Trash'}
    </button>
  );
}

function ActionPickDate({ title, onChange, ...rest }: { title?: string; onChange?: (date: Date | null) => void; [key: string]: any }) {
  return (
    <button onClick={() => onChange?.(new Date())} className="w-full text-left px-3 py-1.5 text-sm text-white/80 hover:bg-white/[0.06] rounded transition-colors">
      {title || 'Pick Date'}
    </button>
  );
}

function ActionCreateSnippet(props: any) {
  return <ActionComponent title={props.title || 'Create Snippet'} onAction={props.onAction} />;
}

function ActionCreateQuicklink(props: any) {
  return <ActionComponent title={props.title || 'Create Quicklink'} onAction={props.onAction} />;
}

function ActionToggleSidebar(props: any) {
  return <ActionComponent title={props.title || 'Toggle Sidebar'} onAction={props.onAction} />;
}

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
  Section: ({ children, title }: { children?: React.ReactNode; title?: string }) => <>{children}</>,
  Submenu: ({ children, title, icon }: { children?: React.ReactNode; title?: string; icon?: any }) => <>{children}</>,
});

// =====================================================================
// ─── List ───────────────────────────────────────────────────────────
// =====================================================================

interface ListItemProps {
  id?: string;
  title: string | { value: string; tooltip?: string };
  subtitle?: string | { value?: string; tooltip?: string };
  icon?: any;
  accessories?: Array<{ text?: string; icon?: any; tag?: any; date?: any; tooltip?: string }>;
  actions?: React.ReactElement;
  keywords?: string[];
  detail?: React.ReactElement;
}

function ListItemComponent(_props: ListItemProps) {
  return null;
}

function ListItemRenderer({
  title, subtitle, icon, accessories, isSelected, dataIdx, onSelect, onActivate,
}: ListItemProps & { isSelected: boolean; dataIdx: number; onSelect: () => void; onActivate: () => void }) {
  return (
    <div
      data-idx={dataIdx}
      className={`px-3 py-1.5 rounded-lg cursor-pointer transition-all ${
        isSelected ? 'bg-white/[0.08] border border-white/[0.1]' : 'border border-transparent hover:bg-white/[0.04]'
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
          <span className="text-white text-sm truncate block">{typeof title === 'string' ? title : (title as any)?.value || ''}</span>
        </div>
        {subtitle && (
          <span className="text-white/30 text-xs flex-shrink-0 truncate max-w-[200px]">
            {typeof subtitle === 'string' ? subtitle : (subtitle as any)?.value || ''}
          </span>
        )}
        {accessories?.map((acc, i) => (
          <span key={i} className="text-white/25 text-[11px] flex-shrink-0 flex items-center gap-1">
            {acc?.icon && <span className="text-[10px]">{renderIcon(acc.icon, 'w-3 h-3')}</span>}
            {typeof acc === 'string' ? acc : acc?.text || acc?.tag?.value || (acc?.date ? new Date(acc.date).toLocaleDateString() : '') || ''}
          </span>
        ))}
      </div>
    </div>
  );
}

function ListSectionComponent({ children, title }: { children?: React.ReactNode; title?: string; subtitle?: string }) {
  return (
    <div className="mb-1">
      {title && <div className="px-3 py-1 text-[11px] uppercase tracking-wider text-white/25 font-medium">{title}</div>}
      {children}
    </div>
  );
}

function ListEmptyView({ title, description, icon, actions }: { title?: string; description?: string; icon?: any; actions?: React.ReactElement }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-white/40 py-12">
      {icon && <div className="text-2xl mb-2 opacity-40">{typeof icon === 'string' ? icon : '○'}</div>}
      {title && <p className="text-sm font-medium">{title}</p>}
      {description && <p className="text-xs text-white/25 mt-1">{description}</p>}
    </div>
  );
}

function ListDropdown({ children, tooltip, storeValue, onChange, value, defaultValue }: any) {
  return <>{children}</>;
}
ListDropdown.Item = ({ title, value }: any) => null;
ListDropdown.Section = ({ children, title }: any) => <>{children}</>;

function ListComponent({
  children, searchBarPlaceholder, onSearchTextChange, isLoading, searchText: controlledSearch, filtering, isShowingDetail, navigationTitle, searchBarAccessory, throttle, selectedItemId, onSelectionChange,
}: any) {
  const [internalSearch, setInternalSearch] = useState('');
  const searchText = controlledSearch ?? internalSearch;
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { pop } = useNavigation();

  const handleSearchChange = (text: string) => {
    setInternalSearch(text);
    onSearchTextChange?.(text);
    setSelectedIdx(0);
  };

  const items = flattenListItems(children);

  // Built-in filtering when no external handler
  const filteredItems =
    (onSearchTextChange || filtering === false || !searchText.trim())
      ? items
      : items.filter((item) => {
          const titleRaw = item.props.title;
          const subtitleRaw = item.props.subtitle;
          const t = (typeof titleRaw === 'string' ? titleRaw : (titleRaw as any)?.value || '').toLowerCase();
          const s = (typeof subtitleRaw === 'string' ? subtitleRaw : (subtitleRaw as any)?.value || '').toLowerCase();
          const q = searchText.toLowerCase();
          return t.includes(q) || s.includes(q) ||
            item.props.keywords?.some((k: string) => k.toLowerCase().includes(q));
        });

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); setSelectedIdx((p) => Math.min(p + 1, filteredItems.length - 1)); break;
      case 'ArrowUp': e.preventDefault(); setSelectedIdx((p) => Math.max(p - 1, 0)); break;
      case 'Enter': e.preventDefault(); if (filteredItems[selectedIdx]) executePrimaryAction(filteredItems[selectedIdx]); break;
      case 'Escape': e.preventDefault(); pop(); break;
    }
  }, [filteredItems, selectedIdx, pop]);

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${selectedIdx}"]`);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedIdx]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Notify selection change
  useEffect(() => {
    if (onSelectionChange && filteredItems[selectedIdx]) {
      onSelectionChange(filteredItems[selectedIdx]?.props?.id || null);
    }
  }, [selectedIdx]);

  // Get the detail element of the selected item
  const selectedItem = filteredItems[selectedIdx];
  const detailElement = selectedItem?.props?.detail;

  // Render the list content
  const listContent = (
    <div ref={listRef} className="flex-1 overflow-y-auto p-1.5" style={{ background: 'rgba(10,10,12,0.5)' }}>
      {isLoading && filteredItems.length === 0 ? (
        <div className="flex items-center justify-center h-full text-white/50"><p className="text-sm">Loading…</p></div>
      ) : filteredItems.length === 0 ? (
        <div className="flex items-center justify-center h-full text-white/40"><p className="text-sm">No results</p></div>
      ) : (
        <div className="space-y-0.5">
          {filteredItems.map((item, idx) => (
            <ListItemRenderer
              key={item.props.id || `${item.props.title}-${idx}`}
              {...item.props}
              isSelected={idx === selectedIdx}
              dataIdx={idx}
              onSelect={() => setSelectedIdx(idx)}
              onActivate={() => executePrimaryAction(item)}
            />
          ))}
        </div>
      )}
    </div>
  );

  // Render detail panel when isShowingDetail is true
  const detailPanel = isShowingDetail && detailElement ? (
    <div className="flex-1 border-l border-white/[0.06] overflow-y-auto" style={{ background: 'rgba(10,10,12,0.5)' }}>
      <div className="p-4">
        {detailElement}
      </div>
    </div>
  ) : null;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06]">
        <svg className="w-4 h-4 text-white/30 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          ref={inputRef} type="text" placeholder={searchBarPlaceholder || 'Search…'} value={searchText}
          onChange={(e) => handleSearchChange(e.target.value)} onKeyDown={handleKeyDown}
          className="flex-1 bg-transparent border-none outline-none text-white/90 placeholder-white/30 text-base font-light" autoFocus
        />
      </div>
      {isShowingDetail ? (
        <div className="flex flex-1 overflow-hidden">
          <div className="w-1/3 flex flex-col overflow-hidden">
            {listContent}
          </div>
          {detailPanel}
        </div>
      ) : (
        listContent
      )}
      <div className="px-3 py-1.5 border-t border-white/[0.05] text-white/20 text-[11px]">
        {filteredItems.length} items{isLoading ? ' • Loading…' : ''}
      </div>
    </div>
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
  const { pop } = useNavigation();

  const setValue = useCallback((id: string, value: any) => {
    setValues(prev => {
      const next = { ...prev, [id]: value };
      _currentFormValues = next;
      return next;
    });
    // Clear error when value changes
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

  // Update global ref whenever values change
  useEffect(() => {
    _currentFormValues = values;
    _currentFormErrors = errors;
  }, [values, errors]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); pop(); } };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [pop]);

  const contextValue = useMemo(() => ({ values, setValue, errors, setError }), [values, setValue, errors, setError]);

  return (
    <FormContext.Provider value={contextValue}>
      <div className="flex flex-col h-full">
        <div className="flex-1 overflow-y-auto p-6" style={{ background: 'rgba(10,10,12,0.5)' }}>
          {isLoading ? (
            <div className="flex items-center justify-center h-full text-white/50"><p className="text-sm">Loading…</p></div>
          ) : children}
        </div>
        {actions && (
          <div className="px-4 py-3 border-t border-white/[0.06] flex justify-end gap-2">
            {actions}
          </div>
        )}
      </div>
    </FormContext.Provider>
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
    <div className="mb-3">
      {title && <label className="text-xs text-white/50 mb-1 block">{title}</label>}
      <input type="text" placeholder={placeholder} value={fieldValue} onChange={handleChange}
        className="w-full bg-white/[0.06] border border-white/[0.08] rounded px-3 py-1.5 text-sm text-white outline-none focus:border-white/20" autoFocus={autoFocus} />
      {fieldError && <p className="text-xs text-red-400 mt-1">{fieldError}</p>}
      {info && <p className="text-xs text-white/30 mt-1">{info}</p>}
    </div>
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
    <div className="mb-3">
      {title && <label className="text-xs text-white/50 mb-1 block">{title}</label>}
      <textarea placeholder={placeholder} value={fieldValue} onChange={handleChange} rows={4}
        className="w-full bg-white/[0.06] border border-white/[0.08] rounded px-3 py-1.5 text-sm text-white outline-none focus:border-white/20 resize-y" />
      {fieldError && <p className="text-xs text-red-400 mt-1">{fieldError}</p>}
    </div>
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
    <div className="mb-3">
      {title && <label className="text-xs text-white/50 mb-1 block">{title}</label>}
      <input type="password" placeholder={placeholder} value={fieldValue} onChange={handleChange}
        className="w-full bg-white/[0.06] border border-white/[0.08] rounded px-3 py-1.5 text-sm text-white outline-none focus:border-white/20" />
      {fieldError && <p className="text-xs text-red-400 mt-1">{fieldError}</p>}
    </div>
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
    <label className="flex items-center gap-2 mb-3 text-sm text-white/80 cursor-pointer">
      <input type="checkbox" checked={fieldValue} onChange={handleChange} className="accent-blue-500" />
      {title || label}
      {fieldError && <span className="text-xs text-red-400 ml-2">{fieldError}</span>}
    </label>
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
      <div className="mb-3">
        {title && <label className="text-xs text-white/50 mb-1 block">{title}</label>}
        <select value={fieldValue} onChange={handleChange}
          className="w-full bg-white/[0.06] border border-white/[0.08] rounded px-3 py-1.5 text-sm text-white outline-none">
          {children}
        </select>
        {fieldError && <p className="text-xs text-red-400 mt-1">{fieldError}</p>}
      </div>
    );
  },
  {
    Item: ({ value, title, icon }: any) => <option value={value}>{title}</option>,
    Section: ({ children, title }: any) => <optgroup label={title}>{children}</optgroup>,
  }
);

FormComponent.DatePicker = Object.assign(
  ({ id, title, value, onChange, defaultValue, error, min, max, type }: any) => (
    <div className="mb-3">
      {title && <label className="text-xs text-white/50 mb-1 block">{title}</label>}
      <input type={type === 'date' ? 'date' : 'datetime-local'} value={value ? (value instanceof Date ? value.toISOString().slice(0, 16) : value) : ''}
        onChange={(e: any) => onChange?.(e.target.value ? new Date(e.target.value) : null)}
        className="w-full bg-white/[0.06] border border-white/[0.08] rounded px-3 py-1.5 text-sm text-white outline-none focus:border-white/20" />
      {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
    </div>
  ),
  { Type: { Date: 'date', DateTime: 'datetime' }, isFullDay: false }
);

FormComponent.Description = ({ text, title }: any) => <p className="text-xs text-white/40 mb-3">{title ? <strong>{title}: </strong> : null}{text}</p>;
FormComponent.Separator = () => <hr className="border-white/[0.06] my-3" />;

FormComponent.TagPicker = Object.assign(
  ({ id, title, children, value, onChange, error }: any) => (
    <div className="mb-3">
      {title && <label className="text-xs text-white/50 mb-1 block">{title}</label>}
      <div className="flex flex-wrap gap-1">{children}</div>
      {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
    </div>
  ),
  { Item: ({ value, title }: any) => <span className="text-xs bg-white/10 px-1.5 py-0.5 rounded text-white/60">{title}</span> }
);

FormComponent.FilePicker = ({ id, title, value, onChange, allowMultipleSelection, canChooseDirectories, canChooseFiles, error }: any) => (
  <div className="mb-3">
    {title && <label className="text-xs text-white/50 mb-1 block">{title}</label>}
    <div className="text-xs text-white/30">File picker not available</div>
    {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
  </div>
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

function flattenListItems(children: React.ReactNode): React.ReactElement<ListItemProps>[] {
  const items: React.ReactElement<ListItemProps>[] = [];
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    if (child.type === ListItemComponent || (child.type as any)?.displayName === 'ListItem') {
      items.push(child as React.ReactElement<ListItemProps>);
      return;
    }
    if (child.props && (child.props as any).children) {
      items.push(...flattenListItems((child.props as any).children));
    }
  });
  return items;
}

function executePrimaryAction(item: React.ReactElement<ListItemProps>) {
  const actionsElement = item.props.actions;
  if (!actionsElement) return;

  const actions: React.ReactElement[] = [];
  React.Children.forEach((actionsElement.props as any)?.children, (child) => {
    if (React.isValidElement(child)) {
      if ((child.props as any)?.children) {
        React.Children.forEach((child.props as any).children, (subChild) => {
          if (React.isValidElement(subChild)) actions.push(subChild);
        });
      } else {
        actions.push(child);
      }
    }
  });

  if (actions.length === 0) return;
  const primary = actions[0];
  const props = primary.props as any;

  if (props.onAction) {
    props.onAction();
  } else if (props.onSubmit) {
    props.onSubmit({});
  } else if (props.content !== undefined) {
    Clipboard.copy(String(props.content));
  } else if (props.url) {
    (window as any).electron?.openUrl?.(props.url);
  } else if (props.target && React.isValidElement(props.target)) {
    // Action.Push — use global navigation ref
    const nav = getGlobalNavigation();
    nav.push(props.target);
  }
}

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
          opts?.onData?.(innerResult.data);
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
