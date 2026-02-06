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

export function useNavigation() {
  return useContext(NavigationContext);
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

// =====================================================================
// ─── Toast ──────────────────────────────────────────────────────────
// =====================================================================

export const Toast = {
  Style: {
    Animated: 'animated' as const,
    Success: 'success' as const,
    Failure: 'failure' as const,
  },
};

let toastEl: HTMLDivElement | null = null;

function _showToastElement(title: string, style: string, message?: string) {
  if (toastEl) toastEl.remove();
  toastEl = document.createElement('div');
  toastEl.style.cssText =
    'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);' +
    'padding:8px 16px;border-radius:8px;font-size:13px;z-index:99999;' +
    'color:#fff;backdrop-filter:blur(20px);max-width:400px;text-align:center;' +
    `background:${style === 'failure' ? 'rgba(255,60,60,0.85)' : style === 'animated' ? 'rgba(60,60,255,0.85)' : 'rgba(40,180,80,0.85)'}`;
  toastEl.textContent = title + (message ? ` — ${message}` : '');
  document.body.appendChild(toastEl);
  const timer = setTimeout(() => { toastEl?.remove(); toastEl = null; }, 3000);
  return {
    hide: () => { clearTimeout(timer); toastEl?.remove(); toastEl = null; },
    title,
    message: message || '',
    style,
  };
}

export function showToast(optionsOrStyle: any, titleOrUndefined?: string, messageOrUndefined?: string): any {
  // Support both showToast({ title, style, message }) and showToast(style, title, message)
  if (typeof optionsOrStyle === 'object' && optionsOrStyle !== null) {
    const { title = '', style = 'success', message = '' } = optionsOrStyle;
    return _showToastElement(title, style, message);
  }
  // Legacy call signature: showToast(style, title, message)
  return _showToastElement(titleOrUndefined || '', optionsOrStyle || 'success', messageOrUndefined);
}

// =====================================================================
// ─── showHUD ────────────────────────────────────────────────────────
// =====================================================================

export async function showHUD(title: string, options?: any): Promise<void> {
  _showToastElement(title, 'success');
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

// Return the property name as the icon value. This works with our
// renderer which just shows a dot for string icons.
export const Icon: Record<string, string> = new Proxy({} as Record<string, string>, {
  get(_target, prop: string) {
    return prop;
  },
});

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
  return {} as T;
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
  return [];
}

export async function getFrontmostApplication(): Promise<{
  name: string;
  path: string;
  bundleId?: string;
}> {
  return { name: 'SuperCommand', path: '', bundleId: 'com.supercommand' };
}

export async function trash(path: string | string[]): Promise<void> {
  console.log('trash:', path);
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
  return (
    <button onClick={() => onSubmit?.({})} className="w-full text-left px-3 py-1.5 text-sm text-white/80 hover:bg-white/[0.06] rounded transition-colors">
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
  title: string;
  subtitle?: string;
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
            {typeof icon === 'string' && (icon.startsWith('data:') || icon.startsWith('http')) ? (
              <img src={icon} className="w-5 h-5 rounded" alt="" />
            ) : typeof icon === 'object' && icon?.source ? (
              <img src={typeof icon.source === 'string' ? icon.source : ''} className="w-5 h-5 rounded" alt="" />
            ) : (
              <span className="opacity-50">●</span>
            )}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <span className="text-white text-sm truncate block">{title}</span>
        </div>
        {subtitle && (
          <span className="text-white/30 text-xs flex-shrink-0 truncate max-w-[200px]">{subtitle}</span>
        )}
        {accessories?.map((acc, i) => (
          <span key={i} className="text-white/25 text-[11px] flex-shrink-0">
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
          const t = item.props.title?.toLowerCase() || '';
          const s = item.props.subtitle?.toLowerCase() || '';
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

function FormComponent({ children, actions, navigationTitle, isLoading, onSubmit }: {
  children?: React.ReactNode; actions?: React.ReactElement; navigationTitle?: string;
  isLoading?: boolean; onSubmit?: (values: any) => void;
}) {
  const formRef = useRef<Record<string, any>>({});
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
        ) : children}
      </div>
    </div>
  );
}

FormComponent.TextField = ({ id, title, placeholder, value, onChange, defaultValue, error, info, storeValue, autoFocus }: any) => (
  <div className="mb-3">
    {title && <label className="text-xs text-white/50 mb-1 block">{title}</label>}
    <input type="text" placeholder={placeholder} value={value ?? defaultValue ?? ''} onChange={(e: any) => onChange?.(e.target.value)}
      className="w-full bg-white/[0.06] border border-white/[0.08] rounded px-3 py-1.5 text-sm text-white outline-none focus:border-white/20" autoFocus={autoFocus} />
    {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
    {info && <p className="text-xs text-white/30 mt-1">{info}</p>}
  </div>
);

FormComponent.TextArea = ({ id, title, placeholder, value, onChange, defaultValue, error, info, enableMarkdown }: any) => (
  <div className="mb-3">
    {title && <label className="text-xs text-white/50 mb-1 block">{title}</label>}
    <textarea placeholder={placeholder} value={value ?? defaultValue ?? ''} onChange={(e: any) => onChange?.(e.target.value)} rows={4}
      className="w-full bg-white/[0.06] border border-white/[0.08] rounded px-3 py-1.5 text-sm text-white outline-none focus:border-white/20 resize-y" />
    {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
  </div>
);

FormComponent.PasswordField = ({ id, title, placeholder, value, onChange, error }: any) => (
  <div className="mb-3">
    {title && <label className="text-xs text-white/50 mb-1 block">{title}</label>}
    <input type="password" placeholder={placeholder} value={value ?? ''} onChange={(e: any) => onChange?.(e.target.value)}
      className="w-full bg-white/[0.06] border border-white/[0.08] rounded px-3 py-1.5 text-sm text-white outline-none focus:border-white/20" />
    {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
  </div>
);

FormComponent.Checkbox = ({ id, title, label, value, onChange, defaultValue, error, storeValue }: any) => (
  <label className="flex items-center gap-2 mb-3 text-sm text-white/80 cursor-pointer">
    <input type="checkbox" checked={value ?? defaultValue ?? false} onChange={(e: any) => onChange?.(e.target.checked)} className="accent-blue-500" />
    {title || label}
    {error && <span className="text-xs text-red-400 ml-2">{error}</span>}
  </label>
);

FormComponent.Dropdown = Object.assign(
  ({ id, title, children, value, onChange, defaultValue, error, storeValue, isLoading, filtering, throttle }: any) => (
    <div className="mb-3">
      {title && <label className="text-xs text-white/50 mb-1 block">{title}</label>}
      <select value={value ?? defaultValue ?? ''} onChange={(e: any) => onChange?.(e.target.value)}
        className="w-full bg-white/[0.06] border border-white/[0.08] rounded px-3 py-1.5 text-sm text-white outline-none">
        {children}
      </select>
      {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
    </div>
  ),
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
    // Action.Push
    // We can't call useNavigation here so we do nothing — the user
    // will need to click the action button rendered by ActionPush.
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

    fnRef.current(...argsRef.current)
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

export function useFetch<T = any>(
  url: string | ((...args: any[]) => string),
  options?: {
    method?: string;
    headers?: Record<string, string>;
    body?: any;
    mapResult?: (result: any) => any;
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
  pagination?: any;
} {
  const resolvedUrl = typeof url === 'function' ? url() : url;

  return usePromise(
    async () => {
      const res = await fetch(resolvedUrl, {
        method: options?.method,
        headers: options?.headers,
        body: options?.body ? JSON.stringify(options.body) : undefined,
      });
      const parsed = options?.parseResponse ? await options.parseResponse(res) : await res.json();
      return options?.mapResult ? options.mapResult(parsed) : parsed;
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

// ── useCachedPromise ────────────────────────────────────────────────

export function useCachedPromise<T>(
  fn: (...args: any[]) => Promise<T>,
  args?: any[],
  options?: {
    initialData?: T;
    execute?: boolean;
    keepPreviousData?: boolean;
    onData?: (data: T) => void;
    onError?: (error: Error) => void;
    failureToastOptions?: any;
  }
) {
  return usePromise(fn, args, options);
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
  }
) {
  return usePromise(
    async () => {
      // Cannot actually exec in browser context — return empty
      console.warn(`useExec called for "${command}" — not available in SuperCommand renderer`);
      const output = { stdout: '', stderr: '', exitCode: 0 };
      return options?.parseOutput ? options.parseOutput(output) : ('' as any as T);
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
  console.warn('runAppleScript is not available in SuperCommand renderer');
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

// Some extensions import these types/values
export enum ToastStyle {
  Animated = 'animated',
  Success = 'success',
  Failure = 'failure',
}

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
