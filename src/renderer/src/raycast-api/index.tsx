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
  supportPath: '/tmp/supercommand',
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

export async function showToast(options: Toast.Options): Promise<Toast> {
  const t = new Toast(options);
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
// Resolve a relative icon/asset path to an sc-asset:// URL
function resolveIconSrc(src: string): string {
  // Already absolute URL, data URI, or custom protocol — leave as-is
  if (/^(https?:\/\/|data:|file:\/\/|sc-asset:\/\/)/.test(src)) return src;
  // Absolute filesystem path
  if (src.startsWith('/')) {
    return `sc-asset://ext-asset${src}`;
  }
  // If it looks like a file path (has an image/svg extension), resolve via extension assets
  if (/\.(svg|png|jpe?g|gif|webp|ico|tiff?)$/i.test(src)) {
    const ctx = getExtensionContext();
    if (ctx.assetsPath) {
      return `sc-asset://ext-asset${ctx.assetsPath}/${src}`;
    }
  }
  return src;
}

// Resolve a tintColor value to a CSS color string.
// Extensions can pass tintColor as:
//   - a string: '#FF0000'
//   - an object: { light: '#FF0000', dark: '#FF0000', adjustContrast?: boolean }
function resolveTintColor(tintColor: any): string | undefined {
  const isValidCssColor = (value: string): boolean => {
    try {
      const el = document.createElement('span');
      el.style.color = '';
      el.style.color = value;
      return Boolean(el.style.color);
    } catch {
      return false;
    }
  };

  const normalizeCssColor = (value: string): string => {
    const v = value.trim();
    if (/^[0-9a-f]{3}$/i.test(v) || /^[0-9a-f]{6}$/i.test(v) || /^[0-9a-f]{8}$/i.test(v)) {
      return `#${v}`;
    }
    return v;
  };

  if (!tintColor) return undefined;
  if (typeof tintColor === 'string') {
    const normalized = normalizeCssColor(tintColor);
    return isValidCssColor(normalized) ? normalized : undefined;
  }
  if (typeof tintColor === 'object') {
    // Prefer dark since we're always dark-themed
    const raw = tintColor.dark || tintColor.light;
    if (typeof raw === 'string') {
      const normalized = normalizeCssColor(raw);
      return isValidCssColor(normalized) ? normalized : undefined;
    }
    return undefined;
  }
  return undefined;
}

function addHexAlpha(color: string, alphaHex: string): string | undefined {
  const m = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return undefined;
  const hex = m[1].length === 3
    ? m[1].split('').map((c) => c + c).join('')
    : m[1];
  return `#${hex}${alphaHex}`;
}

const fileIconCache = new Map<string, string | null>();

function FileIcon({ filePath, className }: { filePath: string; className: string }) {
  const [src, setSrc] = useState<string | null>(() => fileIconCache.get(filePath) ?? null);

  useEffect(() => {
    let cancelled = false;
    const cached = fileIconCache.get(filePath);
    if (cached !== undefined) {
      setSrc(cached);
      return;
    }
    (window as any).electron?.getFileIconDataUrl?.(filePath, 20)
      .then((iconSrc: string | null) => {
        if (cancelled) return;
        fileIconCache.set(filePath, iconSrc || null);
        setSrc(iconSrc || null);
      })
      .catch(() => {
        if (cancelled) return;
        fileIconCache.set(filePath, null);
        setSrc(null);
      });
    return () => {
      cancelled = true;
    };
  }, [filePath]);

  if (src) return <img src={src} className={className + ' rounded'} alt="" />;

  let isDirectory = false;
  try {
    const stat = (window as any).electron?.statSync?.(filePath);
    isDirectory = Boolean(stat?.exists && stat?.isDirectory);
  } catch {}
  return <span className="text-center" style={{ fontSize: '0.875rem' }}>{isDirectory ? '📁' : '📄'}</span>;
}

export function renderIcon(icon: any, className = 'w-4 h-4'): React.ReactNode {
  if (!icon) return null;

  // If it's a string URL or data URL, render as image
  if (typeof icon === 'string') {
    if (icon.startsWith('data:') || icon.startsWith('http') || icon.startsWith('sc-asset:')) {
      return <img src={icon} className={className + ' rounded'} alt="" />;
    }
    // Check if it looks like a file path (has image extension) — resolve via extension assets
    if (/\.(svg|png|jpe?g|gif|webp|ico|tiff?)$/i.test(icon)) {
      const resolved = resolveIconSrc(icon);
      return <img src={resolved} className={className + ' rounded'} alt="" />;
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
    // Raycast file icons: { fileIcon: "/path/to/file-or-folder" }
    if (typeof icon.fileIcon === 'string') {
      return <FileIcon filePath={icon.fileIcon} className={className} />;
    }

    const tint = resolveTintColor(icon.tintColor);

    const sourceCandidate = icon.source
      ? (typeof icon.source === 'string' ? icon.source : icon.source?.light || icon.source?.dark || '')
      : '';
    const fallbackCandidate = typeof icon.fallback === 'string' ? icon.fallback : '';
    const source = sourceCandidate || fallbackCandidate;

    if (source) {
      const src = source;
      if (src) {
        // Check if source is an emoji/symbol (from our Icon proxy) vs a real URL/path
        if (isEmojiOrSymbol(src)) {
          return <span className="text-center" style={{ fontSize: '0.875rem', color: tint }}>{src}</span>;
        }
        const resolved = resolveIconSrc(src);
        return <img src={resolved} className={className + ' rounded'} alt="" style={tint ? { filter: `brightness(0) saturate(100%)`, color: tint } : undefined} />;
      }
    }
    // Handle { light, dark } theme icons
    if (icon.light || icon.dark) {
      const src = icon.dark || icon.light;
      if (typeof src === 'string') {
        if (isEmojiOrSymbol(src)) {
          return <span className="text-center" style={{ fontSize: '0.875rem', color: tint }}>{src}</span>;
        }
        const resolved = resolveIconSrc(src);
        return <img src={resolved} className={className + ' rounded'} alt="" />;
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
      CopyPath: { modifiers: ['cmd', 'opt'], key: 'c' },
      CopyName: { modifiers: ['cmd', 'opt'], key: 'n' },
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
    try {
      let text = '';
      let html = '';

      // Parse content
      if (typeof content === 'string' || typeof content === 'number') {
        text = String(content);
      } else if (typeof content === 'object') {
        text = content.text || '';
        html = content.html || '';
        // file is not directly copyable via web clipboard
      }

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

      // TODO: Handle concealed option by not saving to clipboard history
      // For now, we always show the toast unless concealed
      if (!options?.concealed) {
        showToast({ title: 'Copied to clipboard', style: 'success' });
      }
    } catch (e) {
      console.error('Clipboard copy error:', e);
    }
  },

  async paste(content: string | Clipboard.Content): Promise<void> {
    try {
      // First, copy to clipboard
      await this.copy(content);

      // Then trigger paste via AppleScript
      const electron = (window as any).electron;
      if (electron?.runAppleScript) {
        await electron.runAppleScript(`
          tell application "System Events"
            keystroke "v" using command down
          end tell
        `);
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
      return undefined;
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
  },
  async removeItem(key: string): Promise<void> {
    localStorage.removeItem(getStoragePrefix() + key);
    // Remove legacy key too, so callers don't read stale values.
    localStorage.removeItem(legacyStoragePrefix + key);
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
      });

      // Actually navigate to the launched command
      if (result.success && result.bundle) {
        // Trigger a navigation to the new command by calling runExtension via the main app
        // This should switch the view to the new extension/command
        console.log('Command launched successfully, switching to:', result.bundle);

        // Use the global electron API to tell the main window to load the new extension
        if (electron?.runExtension) {
          const bundle = result.bundle;
          // Send event to switch to the new extension
          // This will be handled by the main app's LauncherOverlay
          (window as any).electron?.executeCommand?.(`ext-${bundle.extName}-${bundle.cmdName}`);
        }
      } else if (!result.success) {
        throw new Error('Failed to launch command');
      }

      console.log('Command launched successfully:', result);
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
  return { name: 'SuperCommand', path: '', bundleId: 'com.supercommand' };
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
  if (electron?.openSettings) {
    await electron.openSettings();
  }
}

export async function openCommandPreferences(): Promise<void> {
  const electron = (window as any).electron;
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
function makeActionExecutor(p: any): () => void {
  return () => {
    if (p.onAction) { p.onAction(); return; }
    if (p.onSubmit) { p.onSubmit(getFormValues()); return; }
    if (p.content !== undefined) {
      if (p.__actionKind === 'paste') {
        Clipboard.paste(String(p.content));
      } else {
        Clipboard.copy(String(p.content));
        showToast({ title: 'Copied to clipboard', style: ToastStyle.Success });
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

  // Build a stable executor ref so we always call the latest props
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    if (!registry) return;
    const executor = () => makeActionExecutor(propsRef.current)();
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
    // Extension-defined shortcuts work even when action panel is open
    if ((e.metaKey || e.altKey || e.ctrlKey) && !e.repeat) {
      // ⌘K closes the panel (handled by parent)
      if (e.key === 'k' && e.metaKey) { e.preventDefault(); onClose(); return; }
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
  title, subtitle, icon, accessories, isSelected, dataIdx, onSelect, onActivate,
}: ListItemProps & { isSelected: boolean; dataIdx: number; onSelect: () => void; onActivate: () => void }) {
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
    >
      <div className="flex items-center gap-2.5 w-full">
        {icon && (
          <div className="w-5 h-5 flex items-center justify-center flex-shrink-0 text-white/55 text-xs">
            {renderIcon(icon, 'w-5 h-5')}
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
              {acc?.icon && <span className="text-[10px]">{renderIcon(acc.icon, 'w-3 h-3')}</span>}
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
  }, [filteredItems.length, selectedIdx, pop, primaryAction, showActions, selectedActions]);

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
      if (e.key === 'k' && e.metaKey) return;
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

  // ── Render ─────────────────────────────────────────────────────

  const listContent = (
    <div ref={listRef} className="flex-1 overflow-y-auto py-0">
      {isLoading && filteredItems.length === 0 ? (
        <div className="flex items-center justify-center h-full text-white/50"><p className="text-sm">Loading…</p></div>
      ) : filteredItems.length === 0 ? (
        <div className="flex items-center justify-center h-full text-white/40"><p className="text-sm">No results</p></div>
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
                isSelected={globalIdx === selectedIdx}
                dataIdx={globalIdx}
                onSelect={() => setSelectedIdx(globalIdx)}
                onActivate={() => setSelectedIdx(globalIdx)}
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
  if (/^(https?:\/\/|data:|file:\/\/|sc-asset:\/\/)/.test(cleanSrc)) return cleanSrc;
  // Resolve relative to extension assets using custom sc-asset:// protocol
  const ctx = getExtensionContext();
  if (ctx.assetsPath) {
    return `sc-asset://ext-asset${ctx.assetsPath}/${cleanSrc}`;
  }
  return cleanSrc;
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
      if (e.key === 'k' && e.metaKey) { e.preventDefault(); setShowActions(prev => !prev); return; }
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

  return (
    <div className="flex flex-col h-full">
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
    <div className="flex items-start gap-3">
      <div className="w-20 flex-shrink-0 pt-1.5 text-right">
        {title && <label className="text-[12px] text-white/40">{title}</label>}
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
        className="w-full bg-white/[0.06] border border-white/[0.08] rounded-md px-2.5 py-[5px] text-[13px] text-white outline-none focus:border-white/20" autoFocus={autoFocus} />
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
        className="w-full bg-white/[0.06] border border-white/[0.08] rounded-md px-2.5 py-[5px] text-[13px] text-white outline-none focus:border-white/20 resize-y" />
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
        className="w-full bg-white/[0.06] border border-white/[0.08] rounded-md px-2.5 py-[5px] text-[13px] text-white outline-none focus:border-white/20" />
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
          className="w-full bg-white/[0.06] border border-white/[0.08] rounded-md px-2.5 py-[5px] text-[13px] text-white outline-none">
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
  <div className="flex items-start gap-3">
    <div className="w-20 flex-shrink-0" />
    <p className="text-[11px] text-white/40 flex-1">{title ? <strong>{title}: </strong> : null}{text}</p>
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

FormComponent.FilePicker = ({ id, title, value, onChange, allowMultipleSelection, canChooseDirectories, canChooseFiles, showHiddenFiles, error }: any) => (
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
  title, subtitle, content, isSelected, dataIdx, onSelect, onActivate,
}: any) {
  const imgSrc = typeof content === 'string' ? content : (content?.source || '');

  return (
    <div
      data-idx={dataIdx}
      className={`relative rounded-lg cursor-pointer transition-all overflow-hidden flex flex-col ${
        isSelected ? 'ring-2 ring-blue-500 bg-white/[0.08]' : 'hover:bg-white/[0.04]'
      }`}
      style={{ height: '160px' }}
      onClick={onActivate}
      onMouseMove={onSelect}
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
  const handleSearchChange = useCallback((text: string) => {
    setInternalSearch(text);
    onSearchTextChange?.(text);
    setSelectedIdx(0);
  }, [onSearchTextChange]);

  // ── Action collection ───────────────────────────────────────────
  const selectedItem = filteredItems[selectedIdx];
  const footerTitle = navigationTitle
    || extInfo.extensionDisplayName
    || _extensionContext.extensionDisplayName
    || _extensionContext.extensionName
    || 'Extension';
  const footerIcon = extInfo.extensionIconDataUrl || _extensionContext.extensionIconDataUrl;
  const { collectedActions: selectedActions, registryAPI: actionRegistry } = useCollectedActions();
  const activeActionsElement = selectedItem?.props?.actions || gridActions;
  const primaryAction = selectedActions[0];

  // ── Keyboard handler ─────────────────────────────────────────────
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'k' && e.metaKey) {
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
      if (e.key === 'k' && e.metaKey) return;
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

  return (
    <GridRegistryContext.Provider value={registryAPI}>
      {/* Hidden render area — children register items via context */}
      <div style={{ display: 'none' }}>
        {children}
        {activeActionsElement && (
          <ActionRegistryContext.Provider value={actionRegistry}>
            <div key={selectedItem?.id || '__grid_actions'}>
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
            <div className="flex items-center justify-center h-full text-white/40"><p className="text-sm">No results</p></div>
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

    const serializeItem = (item: MBItemRegistration): any => {
      if (item.type === 'separator') {
        return { type: 'separator' };
      } else if (item.type === 'submenu') {
        // Serialize submenu with children
        const submenuChildren = (item.children || []).map(serializeItem);
        return {
          type: 'submenu',
          title: item.title || '',
          icon: item.icon,
          children: submenuChildren,
        };
      } else {
        // Regular item
        if (item.onAction) actions.set(item.id, item.onAction);
        const serializedItem: any = {
          type: 'item',
          id: item.id,
          title: item.title || '',
          subtitle: item.subtitle,
          tooltip: item.tooltip,
        };

        // Add alternate item if present
        if (item.alternate) {
          if (item.alternate.onAction) {
            actions.set(item.alternate.id, item.alternate.onAction);
          }
          serializedItem.alternate = {
            id: item.alternate.id,
            title: item.alternate.title,
            subtitle: item.alternate.subtitle,
            tooltip: item.alternate.tooltip,
          };
        }

        return serializedItem;
      }
    };

    for (const item of allItems) {
      // Insert separator between sections
      if (item.sectionId !== prevSectionId && prevSectionId != null) {
        serialized.push({ type: 'separator' });
      }
      prevSectionId = item.sectionId;

      // Add section title if present
      if (item.sectionTitle && item.sectionId !== prevSectionId) {
        serialized.push({
          type: 'item',
          title: item.sectionTitle,
          disabled: true,
        });
      }

      serialized.push(serializeItem(item));
    }

    _mbActions.set(extId, actions);

    // Resolve icon for the Tray
    let iconPath: string | undefined;
    let iconEmoji: string | undefined;
    if (icon && typeof icon === 'object') {
      const src = icon.source
        ? (typeof icon.source === 'object' ? (icon.source.dark || icon.source.light) : icon.source)
        : (icon.dark || icon.light);
      if (src && /\.(svg|png|jpe?g|gif|webp|ico|tiff?)$/i.test(src) && assetsPath) {
        iconPath = `${assetsPath}/${src}`;
      } else if (src && isEmojiOrSymbol(src)) {
        iconEmoji = src;
      }
    } else if (typeof icon === 'string') {
      if (/\.\w+$/.test(icon) && assetsPath) {
        iconPath = `${assetsPath}/${icon}`;
      } else if (isEmojiOrSymbol(icon)) {
        iconEmoji = icon;
      }
    }

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
  useEffect(() => () => { _mbActions.delete(extId); }, [extId]);

  if (isMenuBar) {
    // Render children in a hidden div so React hooks in items execute,
    // but nothing is visible. Items register via context.
    return (
      <MBRegistryContext.Provider value={registryAPI}>
        <div style={{ display: 'none' }}>{children}</div>
      </MBRegistryContext.Provider>
    );
  }

  // Fallback: render in the SuperCommand overlay window
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
  const normalizeRequestBody = (body: any): BodyInit | undefined => {
    if (body == null) return undefined;
    if (typeof body === 'string') return body;
    if (body instanceof FormData) return body;
    if (body instanceof URLSearchParams) return body;
    if (body instanceof Blob) return body;
    return JSON.stringify(body);
  };

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
        body: normalizeRequestBody(opts?.body),
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
  const optionsKey = useMemo(() => {
    try {
      return JSON.stringify({
        execute: options?.execute ?? true,
        method: options?.method || 'GET',
        headers: options?.headers || null,
        body: options?.body || null,
      });
    } catch {
      return String(options?.execute ?? true);
    }
  }, [options?.execute, options?.method, options?.headers, options?.body]);

  useEffect(() => {
    if (options?.execute === false) {
      setIsLoading(false);
      setError(undefined);
      setAllData(options?.initialData);
      return;
    }
    setPage(0);
    setCursor(undefined);
    setAllData(options?.initialData);
    fetchData(0, undefined);
  }, [fetchData, urlString, optionsKey]);

  const revalidate = useCallback(() => {
    setPage(0);
    setCursor(undefined);
    setAllData(undefined);
    fetchData(0, undefined);
  }, [fetchData]);

  const mutate = useCallback(async (asyncUpdate?: Promise<T>, mutateOptions?: { optimisticUpdate?: (data: T | undefined) => T; rollbackOnError?: boolean | ((data: T | undefined) => T); shouldRevalidateAfter?: boolean }) => {
    const prevData = allData;
    if (mutateOptions?.optimisticUpdate) {
      setAllData(mutateOptions.optimisticUpdate(allData));
    }
    if (asyncUpdate) {
      try {
        const result = await asyncUpdate;
        if (mutateOptions?.shouldRevalidateAfter !== false) {
          setAllData(result);
        }
        return result;
      } catch (e) {
        if (mutateOptions?.rollbackOnError !== false) {
          if (typeof mutateOptions?.rollbackOnError === 'function') {
            setAllData(mutateOptions.rollbackOnError(prevData));
          } else {
            setAllData(prevData);
          }
        }
        throw e;
      }
    }
    revalidate();
    return undefined;
  }, [allData, revalidate]);

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
    abortable?: React.MutableRefObject<AbortController | null | undefined>;
    onData?: (data: T) => void;
    onError?: (error: Error) => void;
    onWillExecute?: (args: any[]) => void;
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

    // Set up abort controller if abortable ref is provided
    if (opts?.abortable) {
      const controller = new AbortController();
      opts.abortable.current = controller;
    }

    opts?.onWillExecute?.(argsRef.current);

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
  initialValue?: T,
  config?: { cacheNamespace?: string }
): [T, (value: T | ((prev: T) => T)) => void] {
  const ns = config?.cacheNamespace ? `${config.cacheNamespace}-` : '';
  const storageKey = `sc-cache-${ns}${key}`;
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

// ── FormValidation Enum ──────────────────────────────────────────────

export enum FormValidation {
  Required = 'required',
}

// ── useForm ─────────────────────────────────────────────────────────
// https://developers.raycast.com/utils-reference/react-hooks/useForm

export function useForm<T extends Record<string, any> = Record<string, any>>(options: {
  onSubmit: (values: T) => void | boolean | Promise<void | boolean>;
  initialValues?: Partial<T>;
  validation?: Partial<Record<keyof T, ((value: any) => string | undefined | null) | FormValidation>>;
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
      const rule = options.validation[key];
      if (rule) {
        let error: string | undefined | null;
        if (rule === FormValidation.Required) {
          const v = values[key];
          if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) {
            error = 'This field is required';
          }
        } else if (typeof rule === 'function') {
          error = rule(values[key]);
        }
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
          const rule = options.validation?.[key as keyof T];
          if (rule) {
            let err: string | undefined | null;
            if (rule === FormValidation.Required) {
              const v = values[key as keyof T];
              if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) {
                err = 'This field is required';
              }
            } else if (typeof rule === 'function') {
              err = rule(values[key as keyof T]);
            }
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
  args?: string[] | Record<string, any>,
  options?: {
    shell?: boolean | string;
    stripFinalNewline?: boolean;
    input?: string;
    encoding?: string;
    timeout?: number;
    parseOutput?: (output: { stdout: string; stderr: string; exitCode: number | null; error?: Error; signal: string | null; timedOut: boolean; command: string }) => T;
    initialData?: T;
    keepPreviousData?: boolean;
    execute?: boolean;
    onData?: (data: T) => void;
    onError?: (error: Error) => void;
    onWillExecute?: (args: string[]) => void;
    failureToastOptions?: any;
    env?: Record<string, string>;
    cwd?: string;
  }
) {
  // Handle overload: useExec(command, options) — no args array
  const actualArgs: string[] = Array.isArray(args) ? args : [];
  const actualOptions = Array.isArray(args) ? options : (args as typeof options);

  return usePromise(
    async () => {
      const electron = (window as any).electron;
      if (!electron?.execCommand) {
        console.warn(`useExec: execCommand not available for "${command}"`);
        const output = { stdout: '', stderr: '', exitCode: 0 as number | null, signal: null as string | null, timedOut: false, command };
        return actualOptions?.parseOutput ? actualOptions.parseOutput(output) : ('' as any as T);
      }

      const result = await electron.execCommand(command, actualArgs, {
        shell: actualOptions?.shell,
        input: actualOptions?.input,
        env: actualOptions?.env,
        cwd: actualOptions?.cwd,
        timeout: actualOptions?.timeout,
      });

      if (result.exitCode !== 0 && result.stderr) {
        throw new Error(result.stderr);
      }

      if (actualOptions?.parseOutput) {
        return actualOptions.parseOutput({
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          signal: null,
          timedOut: false,
          command,
        });
      }

      let stdout = result.stdout as string;
      if (actualOptions?.stripFinalNewline !== false && stdout.endsWith('\n')) {
        stdout = stdout.slice(0, -1);
      }

      return stdout as any as T;
    },
    [],
    {
      initialData: actualOptions?.initialData,
      execute: actualOptions?.execute,
      onData: actualOptions?.onData,
      onError: actualOptions?.onError,
      onWillExecute: actualOptions?.onWillExecute ? () => actualOptions.onWillExecute!(actualArgs) : undefined,
    }
  );
}

// ── useSQL ──────────────────────────────────────────────────────────

export function useSQL<T = any>(
  databasePath: string,
  query: string,
  options?: {
    permissionPriming?: string;
    execute?: boolean;
    onError?: (error: Error) => void;
    onData?: (data: T[]) => void;
    onWillExecute?: (args: string[]) => void;
    failureToastOptions?: any;
  }
) {
  const result = usePromise(
    async (dbPath: string, sqlQuery: string) => {
      const electron = (window as any).electron;
      if (!electron?.runSqliteQuery) {
        throw new Error('useSQL: runSqliteQuery IPC not available');
      }
      const res = await electron.runSqliteQuery(dbPath, sqlQuery);
      if (res.error) {
        throw new Error(res.error);
      }
      return (Array.isArray(res.data) ? res.data : []) as T[];
    },
    [databasePath, query],
    {
      execute: options?.execute,
      onData: options?.onData,
      onError: options?.onError,
      onWillExecute: options?.onWillExecute ? () => options.onWillExecute!([databasePath, query]) : undefined,
    }
  );

  return { ...result, permissionView: undefined as React.ReactNode | undefined };
}

// ── useStreamJSON ───────────────────────────────────────────────────

export function useStreamJSON<T = any>(
  url: string | Request,
  options?: RequestInit & {
    filter?: (item: T) => boolean;
    transform?: (item: any) => T;
    dataPath?: string | RegExp;
    pageSize?: number;
    initialData?: T[];
    keepPreviousData?: boolean;
    execute?: boolean;
    onError?: (error: Error) => void;
    onData?: (data: T) => void;
    onWillExecute?: (args: [string, RequestInit]) => void;
    failureToastOptions?: any;
  }
) {
  const pageSize = options?.pageSize ?? 20;
  const [allItems, setAllItems] = useState<T[]>(options?.initialData || []);
  const [isLoading, setIsLoading] = useState(options?.execute !== false);
  const [error, setError] = useState<Error | undefined>(undefined);
  const [displayCount, setDisplayCount] = useState(pageSize);

  const optionsRef = useRef(options);
  optionsRef.current = options;

  const fetchAndParse = useCallback(async () => {
    const opts = optionsRef.current;
    if (opts?.execute === false) return;
    setIsLoading(true);
    setError(undefined);

    try {
      const resolvedUrl = typeof url === 'string' ? url : url.url;
      const res = await fetch(resolvedUrl, opts);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const json = await res.json();

      // Extract data using dataPath
      let items: any[];
      if (opts?.dataPath) {
        if (typeof opts.dataPath === 'string') {
          items = opts.dataPath.split('.').reduce((obj: any, key: string) => obj?.[key], json);
        } else {
          // RegExp dataPath — find first matching key
          const match = Object.keys(json).find(k => (opts.dataPath as RegExp).test(k));
          items = match ? json[match] : json;
        }
      } else {
        items = Array.isArray(json) ? json : [json];
      }

      if (!Array.isArray(items)) items = [items];

      // Apply transform
      if (opts?.transform) {
        items = items.map(opts.transform);
      }

      // Apply filter
      if (opts?.filter) {
        items = items.filter(opts.filter);
      }

      setAllItems(items as T[]);
      items.forEach(item => opts?.onData?.(item as T));
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
      opts?.onError?.(e);
    } finally {
      setIsLoading(false);
    }
  }, [url]);

  useEffect(() => {
    fetchAndParse();
  }, [fetchAndParse]);

  const revalidate = useCallback(() => {
    setAllItems([]);
    setDisplayCount(pageSize);
    fetchAndParse();
  }, [fetchAndParse, pageSize]);

  const mutate = useCallback(async (asyncUpdate?: Promise<any>, mutateOptions?: any) => {
    if (mutateOptions?.optimisticUpdate) {
      setAllItems(mutateOptions.optimisticUpdate(allItems));
    }
    if (asyncUpdate) {
      try { await asyncUpdate; } catch (e) {
        if (mutateOptions?.rollbackOnError) revalidate();
        throw e;
      }
    }
  }, [allItems, revalidate]);

  const hasMore = displayCount < allItems.length;
  const pagination = useMemo(() => ({
    pageSize,
    hasMore,
    onLoadMore: () => { if (hasMore) setDisplayCount(prev => prev + pageSize); },
  }), [pageSize, hasMore]);

  return {
    data: allItems.slice(0, displayCount),
    isLoading,
    error,
    revalidate,
    mutate,
    pagination,
  };
}

// ── useAI ───────────────────────────────────────────────────────────

export function useAI(
  prompt: string,
  options?: {
    model?: string;
    creativity?: AICreativity;
    execute?: boolean;
    stream?: boolean;
    onError?: (error: Error) => void;
    onData?: (data: string) => void;
    onWillExecute?: (args: [string]) => void;
    failureToastOptions?: any;
  }
) {
  const [data, setData] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const promptRef = useRef(prompt);
  const optionsRef = useRef(options);
  promptRef.current = prompt;
  optionsRef.current = options;

  const shouldExecute = options?.execute !== false;
  const stream = options?.stream !== false;

  const run = useCallback(() => {
    if (!promptRef.current) return;
    const opts = optionsRef.current;

    // Abort previous request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);
    setError(undefined);
    setData('');

    opts?.onWillExecute?.([promptRef.current]);

    const sp = AI.ask(promptRef.current, {
      model: opts?.model,
      creativity: opts?.creativity,
      signal: controller.signal,
    });

    if (stream) {
      sp.on('data', (chunk: string) => {
        if (!controller.signal.aborted) {
          setData((prev) => prev + chunk);
        }
      });
    }

    sp.then((fullText: string) => {
      if (!controller.signal.aborted) {
        if (!stream) setData(fullText);
        setIsLoading(false);
        opts?.onData?.(fullText);
      }
    }).catch((err: any) => {
      if (!controller.signal.aborted) {
        const e = err instanceof Error ? err : new Error(err?.message || 'AI request failed');
        setError(e);
        setIsLoading(false);
        opts?.onError?.(e);
      }
    });
  }, [stream]);

  useEffect(() => {
    if (shouldExecute) {
      run();
    }
    return () => {
      abortRef.current?.abort();
    };
  }, [shouldExecute, run]);

  return { data, isLoading, error, revalidate: run };
}

// ── useFrecencySorting ──────────────────────────────────────────────
// Sorts items by frecency (frequency + recency). Returns the sorted data
// and a function to track visits.

interface FrecencyEntry {
  count: number;
  lastVisited: number;
}

function computeFrecencyScore(entry: FrecencyEntry): number {
  const ageHours = (Date.now() - entry.lastVisited) / (1000 * 60 * 60);
  // Decay factor: halve score every 72 hours
  const decay = Math.pow(0.5, ageHours / 72);
  return entry.count * decay;
}

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
  const ns = options?.namespace || 'default';
  const storageKey = `sc-frecency-${ns}`;
  const getKey = options?.key || ((item: any) => item?.id ?? String(item));

  const [frecencyMap, setFrecencyMap] = useState<Record<string, FrecencyEntry>>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  });

  const persistMap = useCallback((map: Record<string, FrecencyEntry>) => {
    try { localStorage.setItem(storageKey, JSON.stringify(map)); } catch {}
  }, [storageKey]);

  const sortedData = useMemo(() => {
    if (!data) return [];
    if (!Array.isArray(data)) {
      if (typeof data === 'object' && data !== null && 'data' in (data as any)) {
        const innerData = (data as any).data;
        if (Array.isArray(innerData)) return [...innerData];
      }
      return [];
    }

    const items = [...data];
    items.sort((a, b) => {
      const keyA = getKey(a);
      const keyB = getKey(b);
      const entryA = frecencyMap[keyA];
      const entryB = frecencyMap[keyB];

      // Both visited: sort by frecency score descending
      if (entryA && entryB) {
        return computeFrecencyScore(entryB) - computeFrecencyScore(entryA);
      }
      // Only one visited: visited items come first
      if (entryA && !entryB) return -1;
      if (!entryA && entryB) return 1;
      // Neither visited: use custom sort or preserve order
      if (options?.sortUnvisited) return options.sortUnvisited(a, b);
      return 0;
    });

    return items;
  }, [data, frecencyMap, getKey, options?.sortUnvisited]);

  const visitItem = useCallback(async (item: T) => {
    const k = getKey(item);
    setFrecencyMap(prev => {
      const entry = prev[k];
      const updated = {
        ...prev,
        [k]: { count: (entry?.count || 0) + 1, lastVisited: Date.now() },
      };
      persistMap(updated);
      return updated;
    });
  }, [getKey, persistMap]);

  const resetRanking = useCallback(async (item: T) => {
    const k = getKey(item);
    setFrecencyMap(prev => {
      const updated = { ...prev };
      delete updated[k];
      persistMap(updated);
      return updated;
    });
  }, [getKey, persistMap]);

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

// ── getAvatarIcon ──────────────────────────────────────────────────

const AVATAR_COLORS = [
  '#FF6363', '#FF9F43', '#FECA57', '#2ECC71', '#54A0FF',
  '#C56CF0', '#FF6B81', '#7BED9F', '#70A1FF', '#FFA502',
  '#A29BFE', '#FD79A8', '#00CEC9', '#E17055', '#6C5CE7',
];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function getAvatarIcon(
  name: string,
  options?: { background?: string; gradient?: boolean }
): string {
  const initials = getInitials(name);
  const bgColor = options?.background || AVATAR_COLORS[hashString(name) % AVATAR_COLORS.length];
  const useGradient = options?.gradient !== false;

  const gradientDef = useGradient
    ? `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="rgba(255,255,255,0.15)"/><stop offset="100%" stop-color="rgba(0,0,0,0.1)"/></linearGradient></defs>`
    : '';
  const gradientRect = useGradient
    ? `<rect width="64" height="64" rx="32" fill="url(#g)"/>`
    : '';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">${gradientDef}<rect width="64" height="64" rx="32" fill="${bgColor}"/>${gradientRect}<text x="32" y="32" text-anchor="middle" dominant-baseline="central" fill="white" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-size="24" font-weight="600">${initials}</text></svg>`;

  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

// ── getProgressIcon ────────────────────────────────────────────────

export function getProgressIcon(
  progress: number,
  color?: string,
  options?: { background?: string; backgroundOpacity?: number }
): string {
  const clampedProgress = Math.max(0, Math.min(1, progress));
  const fgColor = color || '#FF6363';
  const bgColor = options?.background || '#FFFFFF';
  const bgOpacity = options?.backgroundOpacity ?? 0.1;

  const radius = 10;
  const cx = 16;
  const cy = 16;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - clampedProgress);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="${bgColor}" stroke-width="4" opacity="${bgOpacity}"/><circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="${fgColor}" stroke-width="4" stroke-linecap="round" stroke-dasharray="${circumference}" stroke-dashoffset="${dashOffset}" transform="rotate(-90 ${cx} ${cy})"/></svg>`;

  return `data:image/svg+xml;base64,${btoa(svg)}`;
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
const OAUTH_TOKEN_KEY_PREFIX = 'sc-oauth-token:';
const OAUTH_CLIENT_ID_OVERRIDE_PREFIX = 'sc-oauth-client-id:';
const OAUTH_CALLBACK_TIMEOUT_MS = 3 * 60 * 1000;
const oauthCallbackWaiters = new Set<(url: string) => void>();
const oauthCallbackQueue: string[] = [];
let oauthCallbackBridgeInitialized = false;

function oauthTokenKey(providerId: string): string {
  return `${OAUTH_TOKEN_KEY_PREFIX}${providerId || 'default'}`;
}

function oauthClientIdOverrideKey(providerId: string): string {
  return `${OAUTH_CLIENT_ID_OVERRIDE_PREFIX}${providerId || 'default'}`;
}

function ensureOAuthCallbackBridge() {
  if (oauthCallbackBridgeInitialized) return;
  oauthCallbackBridgeInitialized = true;
  try {
    (window as any).electron?.onOAuthCallback?.((url: string) => {
      if (!url) return;
      oauthCallbackQueue.push(url);
      for (const waiter of Array.from(oauthCallbackWaiters)) {
        waiter(url);
      }
    });
  } catch {}
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function buildOAuthRedirectUri(redirectMethod: string, extensionName?: string): string {
  const pkg = extensionName || getExtensionContext().extensionName || 'supercommand-extension';
  switch (redirectMethod) {
    case 'web':
    case 'app':
    case 'appURI':
    default:
      // SuperCommand-owned OAuth callback deep link.
      // Must be registered in each provider app config.
      return `supercommand://oauth/callback?packageName=${encodeURIComponent(pkg)}`;
  }
}

class PKCEClientCompat {
  redirectMethod: string;
  providerName: string;
  providerIcon?: any;
  providerId: string;
  description?: string;
  extensionName: string;

  constructor(options: any) {
    this.redirectMethod = options?.redirectMethod || 'web';
    this.providerName = options?.providerName || 'OAuth Provider';
    this.providerIcon = options?.providerIcon;
    this.providerId = options?.providerId || this.providerName.toLowerCase().replace(/\s+/g, '-');
    this.description = options?.description;
    // Capture extension identity at construction time to avoid cross-extension context bleed.
    this.extensionName = getExtensionContext().extensionName || 'supercommand-extension';
  }

  async authorizationRequest(options: any) {
    const state = Math.random().toString(36).slice(2);
    const codeVerifier = `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
    const verifierBytes = new TextEncoder().encode(codeVerifier);
    const digest = await crypto.subtle.digest('SHA-256', verifierBytes);
    const codeChallenge = toBase64Url(new Uint8Array(digest));
    const endpoint = options?.endpoint || '';
    const url = new URL(endpoint);
    if (options?.clientId) url.searchParams.set('client_id', options.clientId);
    if (options?.scope) url.searchParams.set('scope', options.scope);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', buildOAuthRedirectUri(this.redirectMethod, this.extensionName));
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('state', state);
    if (options?.extraParameters && typeof options.extraParameters === 'object') {
      for (const [k, v] of Object.entries(options.extraParameters)) {
        if (typeof v === 'string') url.searchParams.set(k, v);
      }
    }
    return {
      codeChallenge,
      codeVerifier,
      state,
      redirectUri: buildOAuthRedirectUri(this.redirectMethod, this.extensionName),
      toURL: () => url.toString(),
    };
  }

  async authorize(requestOrOptions: any) {
    const maybeToURL = requestOrOptions?.toURL;
    const url = typeof maybeToURL === 'function' ? maybeToURL() : requestOrOptions?.url;
    if (url) {
      await open(url);
    }
    return { authorizationCode: '' };
  }

  async setTokens(tokens: any) {
    if (!tokens) return;
    try {
      localStorage.setItem(oauthTokenKey(this.providerId), JSON.stringify(tokens));
    } catch {}
  }

  async getTokens() {
    try {
      const raw = localStorage.getItem(oauthTokenKey(this.providerId));
      if (!raw) return undefined;
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  }

  async removeTokens() {
    try {
      localStorage.removeItem(oauthTokenKey(this.providerId));
    } catch {}
  }
}

class TokenSetCompat {
  accessToken = '';
  refreshToken = '';
  idToken = '';
  scope = '';
  expiresIn?: number;
  obtainedAt?: Date;

  constructor(init?: any) {
    if (init && typeof init === 'object') {
      Object.assign(this, init);
    }
    if (!this.obtainedAt) this.obtainedAt = new Date();
  }

  isExpired() {
    if (!this.expiresIn) return false;
    const obtained = this.obtainedAt instanceof Date ? this.obtainedAt.getTime() : Date.now();
    return Date.now() >= obtained + this.expiresIn * 1000;
  }
}

export const OAuth = {
  RedirectMethod: {
    Web: 'web',
    App: 'app',
    AppURI: 'appURI',
  },
  PKCEClient: PKCEClientCompat,
  TokenSet: TokenSetCompat,
  TokenResponse: class {
    accessToken = '';
    refreshToken = '';
    idToken = '';
    tokenType = 'Bearer';
    scope = '';
    expiresIn?: number;
  },
};

type OAuthServiceOptions = {
  client?: InstanceType<typeof PKCEClientCompat>;
  clientId?: string;
  scope?: string;
  authorizeUrl?: string;
  tokenUrl?: string;
  refreshTokenUrl?: string;
  bodyEncoding?: string;
  onAuthorize?: (params: { token: string; type: 'oauth' | 'personal'; idToken?: string }) => void | Promise<void>;
  authorize?: () => Promise<string>;
  personalAccessToken?: string;
};

function parseOAuthCallbackUrl(rawUrl: string): {
  code?: string;
  state?: string;
  error?: string;
  errorDescription?: string;
} | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'supercommand:') return null;
    const isOAuthCallback =
      (parsed.hostname === 'oauth' && parsed.pathname === '/callback') ||
      parsed.pathname === '/oauth/callback';
    if (!isOAuthCallback) return null;
    return {
      code: parsed.searchParams.get('code') || undefined,
      state: parsed.searchParams.get('state') || undefined,
      error: parsed.searchParams.get('error') || undefined,
      errorDescription: parsed.searchParams.get('error_description') || undefined,
    };
  } catch {
    return null;
  }
}

async function waitForOAuthCallback(state: string, timeoutMs = OAUTH_CALLBACK_TIMEOUT_MS): Promise<{ code?: string; error?: string; errorDescription?: string }> {
  ensureOAuthCallbackBridge();

  for (let i = 0; i < oauthCallbackQueue.length; i++) {
    const parsed = parseOAuthCallbackUrl(oauthCallbackQueue[i]);
    if (parsed?.state === state) {
      oauthCallbackQueue.splice(i, 1);
      return parsed;
    }
  }

  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      oauthCallbackWaiters.delete(handler);
      reject(new Error('OAuth authorization timed out'));
    }, timeoutMs);

    const handler = (rawUrl: string) => {
      const parsed = parseOAuthCallbackUrl(rawUrl);
      if (!parsed || parsed.state !== state) return;
      clearTimeout(timer);
      oauthCallbackWaiters.delete(handler);
      resolve(parsed);
    };

    oauthCallbackWaiters.add(handler);
  });
}

export class OAuthService {
  private options: OAuthServiceOptions;
  onAuthorize?: (params: { token: string; type: 'oauth' | 'personal'; idToken?: string }) => void | Promise<void>;

  constructor(options: OAuthServiceOptions) {
    this.options = options || {};
    this.onAuthorize = options?.onAuthorize;
  }

  getProviderKey(): string {
    return this.options.client?.providerId || this.options.client?.providerName || 'oauth-provider';
  }

  getConfiguredClientId(): string | undefined {
    const key = oauthClientIdOverrideKey(this.getProviderKey());
    const override = localStorage.getItem(key);
    return (override && override.trim()) || this.options.clientId;
  }

  setClientIdOverride(value: string): void {
    const key = oauthClientIdOverrideKey(this.getProviderKey());
    const trimmed = (value || '').trim();
    if (!trimmed) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, trimmed);
  }

  private async exchangeAuthorizationCode(params: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<any> {
    if (!this.options.tokenUrl) {
      throw new Error('OAuth token URL is not configured for this extension.');
    }
    const clientId = this.getConfiguredClientId();
    if (!clientId) {
      throw new Error('Missing OAuth client ID. Configure a valid client ID and try again.');
    }

    const body = new URLSearchParams();
    body.set('grant_type', 'authorization_code');
    body.set('code', params.code);
    body.set('client_id', clientId);
    body.set('redirect_uri', params.redirectUri);
    body.set('code_verifier', params.codeVerifier);

    const response = await fetch(this.options.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: body.toString(),
    });

    const text = await response.text();
    let parsed: any = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {}

    if (!response.ok) {
      const providerError =
        parsed?.error_description ||
        parsed?.error?.message ||
        parsed?.error ||
        text ||
        `OAuth token exchange failed (${response.status})`;
      throw new Error(providerError);
    }

    return parsed || {};
  }

  getProviderInfo(): { name: string; description: string; icon?: string } {
    return {
      name: this.options.client?.providerName || 'OAuth Provider',
      description:
        this.options.client?.description ||
        `Connect your ${this.options.client?.providerName || 'account'}`,
      icon: this.options.client?.providerIcon,
    };
  }

  async getAuthorizationUrl(): Promise<string | null> {
    if (!this.options.authorizeUrl || !this.options.scope) return null;
    const clientId = this.getConfiguredClientId();
    if (!clientId) return null;
    try {
      if (this.options.client?.authorizationRequest) {
        const request = await this.options.client.authorizationRequest({
          endpoint: this.options.authorizeUrl,
          clientId,
          scope: this.options.scope,
        });
        if (request?.toURL) return request.toURL();
      }
      const url = new URL(this.options.authorizeUrl);
      url.searchParams.set('client_id', clientId);
      url.searchParams.set('scope', this.options.scope);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set(
        'redirect_uri',
        buildOAuthRedirectUri(
          (this.options.client as any)?.redirectMethod || 'web',
          (this.options.client as any)?.extensionName
        )
      );
      return url.toString();
    } catch {
      return null;
    }
  }

  async beginAuthorization(): Promise<boolean> {
    const clientId = this.getConfiguredClientId();
    if (!clientId || !this.options.authorizeUrl || !this.options.scope) return false;
    const request = await this.options.client?.authorizationRequest?.({
      endpoint: this.options.authorizeUrl,
      clientId,
      scope: this.options.scope,
    });
    const authUrl = request?.toURL ? request.toURL() : await this.getAuthorizationUrl();
    if (!authUrl) return false;

    await open(authUrl);
    const callback = await waitForOAuthCallback(request?.state || '');

    if (callback.error) {
      throw new Error(callback.errorDescription || callback.error);
    }
    if (!callback.code) {
      throw new Error('Authorization did not return a valid code.');
    }

    const tokenResponse = await this.exchangeAuthorizationCode({
      code: callback.code,
      codeVerifier: request?.codeVerifier || '',
      redirectUri: request?.redirectUri || buildOAuthRedirectUri((this.options.client as any)?.redirectMethod || 'web'),
    });

    const accessToken = tokenResponse?.access_token || tokenResponse?.accessToken;
    if (!accessToken) {
      throw new Error('OAuth token response did not include an access token.');
    }

    const tokenSet = {
      accessToken,
      refreshToken: tokenResponse?.refresh_token || tokenResponse?.refreshToken,
      idToken: tokenResponse?.id_token || tokenResponse?.idToken,
      scope: tokenResponse?.scope || this.options.scope || '',
      tokenType: tokenResponse?.token_type || tokenResponse?.tokenType || 'Bearer',
      expiresIn: tokenResponse?.expires_in || tokenResponse?.expiresIn,
      obtainedAt: new Date().toISOString(),
    };
    await this.options.client?.setTokens?.(tokenSet);
    await Promise.resolve(
      this.onAuthorize?.({
        token: tokenSet.accessToken,
        type: 'oauth',
        idToken: tokenSet.idToken,
      })
    );
    return true;
  }

  async getStoredToken(): Promise<{ token: string; idToken?: string } | null> {
    const stored = await this.options.client?.getTokens?.();
    const accessToken = stored?.accessToken || stored?.access_token;
    if (!accessToken) return null;
    const idToken = stored?.idToken || stored?.id_token;
    return { token: accessToken, idToken };
  }

  async authorize(): Promise<string> {
    if (this.options.personalAccessToken) {
      const token = this.options.personalAccessToken;
      await Promise.resolve(this.onAuthorize?.({ token, type: 'personal' }));
      return token;
    }

    if (typeof this.options.authorize === 'function') {
      const token = await this.options.authorize();
      await Promise.resolve(this.onAuthorize?.({ token, type: 'oauth' }));
      return token;
    }

    const stored = await this.getStoredToken();
    if (stored?.token) {
      await Promise.resolve(this.onAuthorize?.({ token: stored.token, type: 'oauth', idToken: stored.idToken }));
      return stored.token;
    }
    const ok = await this.beginAuthorization();
    if (!ok) throw new Error('OAuth authorization is required');
    const postAuth = await this.getStoredToken();
    if (!postAuth?.token) throw new Error('OAuth authorization failed');
    return postAuth.token;
  }
}

let _accessTokenValue: string | null = null;
let _accessTokenType: 'oauth' | 'personal' | null = null;

export function withAccessToken(options: any) {
  const shouldInvokeOnAuthorize = !(options instanceof OAuthService);

  if (_extensionContext.commandMode === 'no-view') {
    return (fn: any) => {
      return async (props: any) => {
        const token = options?.personalAccessToken ?? (await options?.authorize?.());
        if (token) {
          _accessTokenValue = token;
          _accessTokenType = options?.personalAccessToken ? 'personal' : 'oauth';
          const idToken = (await options?.client?.getTokens?.())?.idToken;
          if (shouldInvokeOnAuthorize) {
            await Promise.resolve(options?.onAuthorize?.({ token, type: _accessTokenType, idToken }));
          }
        }
        return await fn(props);
      };
    };
  }

  return (Component: any) => {
    const WrappedComponent: React.FC<any> = (props) => {
      const [ready, setReady] = useState(false);
      const [error, setError] = useState<string | null>(null);
      const [oauthNeedsAuth, setOauthNeedsAuth] = useState(false);
      const [oauthBusy, setOauthBusy] = useState(false);
      const [oauthLink, setOauthLink] = useState<string>('');
      const [oauthInfo, setOauthInfo] = useState<{ name: string; description: string; icon?: string } | null>(null);
      const [oauthHint, setOauthHint] = useState<string>('');
      const [oauthClientIdInput, setOauthClientIdInput] = useState('');

      useEffect(() => {
        let cancelled = false;
        (async () => {
          try {
            if (options instanceof OAuthService) {
              const info = options.getProviderInfo();
              if (!cancelled) setOauthInfo(info);
              if (!cancelled) setOauthClientIdInput(options.getConfiguredClientId() || '');
              const authUrl = await options.getAuthorizationUrl();
              if (!cancelled) setOauthLink(authUrl || '');
              const stored = await options.getStoredToken();
              if (!stored?.token) {
                if (!cancelled) setOauthNeedsAuth(true);
                return;
              }
              _accessTokenValue = stored.token;
              _accessTokenType = 'oauth';
              await Promise.resolve(options.onAuthorize?.({ token: stored.token, type: 'oauth', idToken: stored.idToken }));
              if (!cancelled) setReady(true);
              return;
            }

            const token = options?.personalAccessToken ?? (await options?.authorize?.());
            if (!token) throw new Error('No access token returned');
            _accessTokenValue = token;
            _accessTokenType = options?.personalAccessToken ? 'personal' : 'oauth';
            const idToken = (await options?.client?.getTokens?.())?.idToken;
            if (shouldInvokeOnAuthorize) {
              await Promise.resolve(options?.onAuthorize?.({ token, type: _accessTokenType, idToken }));
            }
            if (!cancelled) setReady(true);
          } catch (e: any) {
            if (!cancelled) setError(e?.message || 'Failed to authorize');
          }
        })();
        return () => {
          cancelled = true;
        };
      }, []);

      const handleOAuthSignIn = useCallback(async () => {
        if (!(options instanceof OAuthService)) return;
        setOauthBusy(true);
        setOauthHint('');
        try {
          options.setClientIdOverride(oauthClientIdInput);
          const opened = await options.beginAuthorization();
          if (!opened) {
            setOauthHint('Unable to open authorization URL.');
            return;
          }
          const stored = await options.getStoredToken();
          if (!stored?.token) {
            setOauthHint('Authorization finished but no token was stored.');
            return;
          }
          _accessTokenValue = stored.token;
          _accessTokenType = 'oauth';
          await Promise.resolve(options.onAuthorize?.({ token: stored.token, type: 'oauth', idToken: stored.idToken }));
          setOauthNeedsAuth(false);
          setReady(true);
        } catch (e: any) {
          setOauthHint(e?.message || 'Failed to start OAuth authorization.');
        } finally {
          setOauthBusy(false);
        }
      }, [options, oauthClientIdInput]);

      const handleOAuthCopyLink = useCallback(async () => {
        if (!oauthLink) return;
        try {
          await navigator.clipboard.writeText(oauthLink);
          setOauthHint('Authorization link copied.');
        } catch {
          setOauthHint('Failed to copy authorization link.');
        }
      }, [oauthLink]);

      if (error) {
        return (
          <div style={{ padding: 16, color: 'rgba(255,255,255,0.8)', fontSize: 13 }}>
            {error}
          </div>
        );
      }
      if (oauthNeedsAuth) {
        const iconSrc = oauthInfo?.icon ? resolveIconSrc(oauthInfo.icon) : getExtensionContext().extensionIconDataUrl;
        return (
          <div className="h-full flex flex-col">
            <div className="flex-1 flex items-center justify-center px-6">
              <div className="w-full max-w-[520px] text-center">
                <div className="mx-auto mb-5 w-14 h-14 rounded-2xl border border-white/[0.12] bg-white/[0.04] flex items-center justify-center overflow-hidden">
                  {iconSrc ? (
                    <img src={iconSrc} alt="" className="w-9 h-9 object-contain" />
                  ) : (
                    <Sparkles className="w-5 h-5 text-white/70" />
                  )}
                </div>
                <div className="text-white/95 text-[34px] leading-tight font-semibold mb-1">
                  {oauthInfo?.name || 'Sign In Required'}
                </div>
                <div className="text-white/60 text-[15px] mb-6">
                  {oauthInfo?.description || 'Connect your account to continue.'}
                </div>
                <button
                  type="button"
                  onClick={handleOAuthSignIn}
                  disabled={oauthBusy}
                  className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
                    oauthBusy
                      ? 'bg-white/[0.08] text-white/45 cursor-not-allowed'
                      : 'bg-white/[0.14] hover:bg-white/[0.20] text-white'
                  }`}
                >
                  {oauthBusy ? 'Opening...' : `Sign in with ${oauthInfo?.name || 'Provider'}`}
                </button>
                <div className="mt-4">
                  <input
                    type="text"
                    value={oauthClientIdInput}
                    onChange={(e) => setOauthClientIdInput(e.target.value)}
                    placeholder="OAuth Client ID"
                    className="w-full max-w-[380px] mx-auto bg-white/[0.05] border border-white/[0.1] rounded-md px-3 py-2 text-sm text-white/85 placeholder-white/35 outline-none"
                  />
                  <div className="mt-1 text-xs text-white/40">
                    Use your own OAuth app client ID for SuperCommand redirect support.
                  </div>
                </div>
              </div>
            </div>
            <div className="px-4 py-3 border-t border-white/[0.06] text-center text-sm text-white/55">
              Need to open in another browser?{' '}
              <button
                type="button"
                onClick={handleOAuthCopyLink}
                className="text-cyan-300 hover:text-cyan-200 transition-colors"
              >
                Copy authorization link
              </button>
              {oauthHint ? <div className="mt-1 text-xs text-white/40">{oauthHint}</div> : null}
            </div>
          </div>
        );
      }
      if (!ready) {
        return (
          <div style={{ padding: 16, color: 'rgba(255,255,255,0.55)', fontSize: 13 }}>
            Authorizing...
          </div>
        );
      }
      return <Component {...props} />;
    };

    WrappedComponent.displayName = `withAccessToken(${Component?.displayName || Component?.name || 'Component'})`;
    return WrappedComponent;
  };
}

export function getAccessToken(): { token: string; type: 'oauth' | 'personal' } {
  if (!_accessTokenValue || !_accessTokenType) {
    throw new Error('getAccessToken must be used when authenticated');
  }
  return { token: _accessTokenValue, type: _accessTokenType };
}

// getPreferenceValues already exported above

// ─── Preference Types ─────────────────────────────────────────────────

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
    const val = _extensionContext.preferences[prop];
    return { name: prop, type: 'textfield', required: false, title: prop, description: '', value: val } as Preference;
  },
});
export type LaunchContext = Record<string, any>;
export type Application = { name: string; path: string; bundleId?: string; localizedName?: string };
export type FileSystemItem = { path: string };

// LaunchOptions for intra-extension launches
export interface LaunchOptions {
  name: string;
  type: LaunchType;
  arguments?: Record<string, any> | null;
  context?: LaunchContext | null;
  fallbackText?: string | null;
  // For inter-extension launches:
  extensionName?: string;
  ownerOrAuthorName?: string;
}

// =====================================================================
// ─── WindowManagement ───────────────────────────────────────────────
// =====================================================================

export const WindowManagement = {
  async getActiveWindow(): Promise<WindowManagementWindow> {
    const electron = (window as any).electron;
    if (electron?.getActiveWindow) {
      const result = await electron.getActiveWindow();
      if (!result) {
        throw new Error('No active window found');
      }
      return result;
    }
    throw new Error('WindowManagement API not available');
  },

  async getWindowsOnActiveDesktop(): Promise<WindowManagementWindow[]> {
    const electron = (window as any).electron;
    if (electron?.getWindowsOnActiveDesktop) {
      return await electron.getWindowsOnActiveDesktop();
    }
    throw new Error('WindowManagement API not available');
  },

  async getDesktops(): Promise<WindowManagementDesktop[]> {
    const electron = (window as any).electron;
    if (electron?.getDesktops) {
      return await electron.getDesktops();
    }
    throw new Error('WindowManagement API not available');
  },

  async setWindowBounds(options: WindowManagementSetWindowBoundsOptions): Promise<void> {
    const electron = (window as any).electron;
    if (electron?.setWindowBounds) {
      await electron.setWindowBounds(options);
    } else {
      throw new Error('WindowManagement API not available');
    }
  },
};

// WindowManagement namespace for types (use declare to merge with const)
declare namespace WindowManagement {
  enum DesktopType {
    User = 'user',
    FullScreen = 'fullscreen',
  }

  interface Window {
    id: string;
    active: boolean;
    bounds:
      | { position: { x: number; y: number }; size: { width: number; height: number } }
      | 'fullscreen';
    desktopId: string;
    positionable: boolean;
    resizable: boolean;
    fullScreenSettable: boolean;
    application?: Application;
  }

  interface Desktop {
    id: string;
    active: boolean;
    screenId: string;
    size: { width: number; height: number };
    type: DesktopType;
  }

  interface SetWindowBoundsOptions {
    id: string;
    bounds:
      | { position?: { x?: number; y?: number }; size?: { width?: number; height?: number } }
      | 'fullscreen';
    desktopId?: string;
  }
}

// Export the types so they're available
export type WindowManagementWindow = {
  id: string;
  active: boolean;
  bounds:
    | { position: { x: number; y: number }; size: { width: number; height: number } }
    | 'fullscreen';
  desktopId: string;
  positionable: boolean;
  resizable: boolean;
  fullScreenSettable: boolean;
  application?: Application;
};

export type WindowManagementDesktop = {
  id: string;
  active: boolean;
  screenId: string;
  size: { width: number; height: number };
  type: WindowManagementDesktopType;
};

export enum WindowManagementDesktopType {
  User = 'user',
  FullScreen = 'fullscreen',
}

export type WindowManagementSetWindowBoundsOptions = {
  id: string;
  bounds:
    | { position?: { x?: number; y?: number }; size?: { width?: number; height?: number } }
    | 'fullscreen';
  desktopId?: string;
};

// Make DesktopType accessible via WindowManagement.DesktopType
(WindowManagement as any).DesktopType = WindowManagementDesktopType;

// =====================================================================
// ─── BrowserExtension ───────────────────────────────────────────────
// =====================================================================

export namespace BrowserExtension {
  export interface Tab {
    /** Whether the tab is active in its window. */
    active: boolean;
    /** Unique tab identifier within the browser session. */
    id: number;
    /** Current URL of the tab. */
    url: string;
    /** Favicon URL of the tab. May be undefined during page load. */
    favicon?: string;
    /** Title of the tab. May be undefined during page load. */
    title?: string;
  }

  export interface ContentOptions {
    /** CSS selector to filter content. Returns first match only. Cannot be used with markdown format. */
    cssSelector?: string;
    /** Target tab ID. Defaults to active tab in focused window. */
    tabId?: number;
    /** Output format: "html" returns outer HTML, "text" returns inner text, "markdown" provides reader-mode conversion. */
    format?: 'html' | 'text' | 'markdown';
  }
}

export const BrowserExtension = {
  async getContent(options?: BrowserExtension.ContentOptions): Promise<string> {
    console.warn('[BrowserExtension] getContent is not available — browser extension not installed');
    return '';
  },
  async getTabs(): Promise<BrowserExtension.Tab[]> {
    console.warn('[BrowserExtension] getTabs is not available — browser extension not installed');
    return [];
  },
};

// =====================================================================
// ─── Tool ───────────────────────────────────────────────────────────
// =====================================================================

export namespace Tool {
  export type Confirmation<T = any> = (input: T) => Promise<
    | undefined
    | {
        style?: 'regular' | 'destructive';
        info?: Array<{ name: string; value?: string }>;
        message?: string;
        image?: string;
      }
  >;
}

// updateCommandMetadata
export async function updateCommandMetadata(metadata: { subtitle?: string | null }): Promise<void> {
  const electron = (window as any).electron;
  const ctx = getExtensionContext();

  // Create a unique command ID from extension + command name
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

// =====================================================================
// ─── DeeplinkType Enum ──────────────────────────────────────────────
// =====================================================================

export enum DeeplinkType {
  Extension = 'extension',
  ScriptCommand = 'scriptCommand',
}

// =====================================================================
// ─── createDeeplink ─────────────────────────────────────────────────
// =====================================================================

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
      params.set('arguments', JSON.stringify(options.arguments));
    }
    const qs = params.toString();
    return `raycast://script-commands/${encodeURIComponent(options.command)}${qs ? `?${qs}` : ''}`;
  }

  // Extension deeplink
  const ctx = getExtensionContext();
  const extOpts = options as CreateDeeplinkExternalExtensionOptions;
  const owner = extOpts.ownerOrAuthorName || ctx.owner || '';
  const extName = extOpts.extensionName || ctx.extensionName || '';

  const params = new URLSearchParams();
  if (options.launchType) {
    params.set('launchType', options.launchType);
  }
  if (options.arguments && Object.keys(options.arguments).length > 0) {
    params.set('arguments', JSON.stringify(options.arguments));
  }
  if ((options as CreateDeeplinkExtensionOptions).fallbackText) {
    params.set('fallbackText', (options as CreateDeeplinkExtensionOptions).fallbackText!);
  }

  const qs = params.toString();
  return `raycast://extensions/${encodeURIComponent(owner)}/${encodeURIComponent(extName)}/${encodeURIComponent(options.command)}${qs ? `?${qs}` : ''}`;
}

// =====================================================================
// ─── executeSQL ─────────────────────────────────────────────────────
// =====================================================================

export async function executeSQL<T = unknown>(databasePath: string, query: string): Promise<T[]> {
  const electron = (window as any).electron;
  if (!electron?.runSqliteQuery) {
    throw new Error('executeSQL: runSqliteQuery IPC not available');
  }
  const result = await electron.runSqliteQuery(databasePath, query);
  if (result.error) {
    throw new Error(result.error);
  }
  return (Array.isArray(result.data) ? result.data : []) as T[];
}

// =====================================================================
// ─── withCache ──────────────────────────────────────────────────────
// =====================================================================

export function withCache<Fn extends (...args: any[]) => Promise<any>>(
  fn: Fn,
  options?: {
    validate?: (data: Awaited<ReturnType<Fn>>) => boolean;
    maxAge?: number;
  }
): Fn & { clearCache: () => void } {
  const cacheStore = new Map<string, { data: any; timestamp: number }>();

  const wrapped = (async (...args: any[]) => {
    const key = JSON.stringify(args);
    const cached = cacheStore.get(key);

    if (cached) {
      const isExpired = options?.maxAge != null && (Date.now() - cached.timestamp) > options.maxAge;
      const isValid = options?.validate ? options.validate(cached.data) : true;

      if (!isExpired && isValid) {
        return cached.data;
      }
    }

    const result = await fn(...args);
    cacheStore.set(key, { data: result, timestamp: Date.now() });
    return result;
  }) as Fn & { clearCache: () => void };

  wrapped.clearCache = () => {
    cacheStore.clear();
  };

  return wrapped;
}
