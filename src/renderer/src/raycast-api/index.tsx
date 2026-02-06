/**
 * @raycast/api Compatibility Shim
 *
 * Provides React components that match the Raycast extension API
 * so that community extensions can render inside SuperCommand's overlay.
 *
 * Implemented: List, Detail, ActionPanel, Action, showToast, Icon, Color,
 *              useNavigation, getPreferenceValues, environment, Clipboard
 */

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  createContext,
  useContext,
} from 'react';

// ─── Navigation Context ─────────────────────────────────────────────

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

// ─── Toast ──────────────────────────────────────────────────────────

export enum ToastStyle {
  Animated = 'animated',
  Success = 'success',
  Failure = 'failure',
}

export const Toast = {
  Style: {
    Animated: 'animated' as const,
    Success: 'success' as const,
    Failure: 'failure' as const,
  },
};

let toastEl: HTMLDivElement | null = null;

export function showToast(options: any): { hide: () => void } {
  const title =
    typeof options === 'string' ? options : options?.title || '';
  const style = options?.style || 'success';

  if (toastEl) toastEl.remove();

  toastEl = document.createElement('div');
  toastEl.className = `sc-toast sc-toast-${style}`;
  toastEl.textContent = title;
  document.body.appendChild(toastEl);

  const timer = setTimeout(() => {
    toastEl?.remove();
    toastEl = null;
  }, 3000);

  return {
    hide: () => {
      clearTimeout(timer);
      toastEl?.remove();
      toastEl = null;
    },
  };
}

// ─── Icon Enum ──────────────────────────────────────────────────────

export const Icon: Record<string, string> = new Proxy(
  {} as Record<string, string>,
  {
    get(_target, prop: string) {
      return prop; // just return the name string
    },
  }
);

// ─── Color Enum ─────────────────────────────────────────────────────

export const Color: Record<string, string> = {
  Red: '#FF6363',
  Orange: '#FF9F43',
  Yellow: '#FECA57',
  Green: '#48DBFB',
  Blue: '#54A0FF',
  Purple: '#C56CF0',
  Magenta: '#FF6B81',
  PrimaryText: '#FFFFFF',
  SecondaryText: 'rgba(255,255,255,0.5)',
};

// ─── Clipboard ──────────────────────────────────────────────────────

export const Clipboard = {
  async copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      showToast({ title: 'Copied to clipboard', style: 'success' });
    } catch {}
  },
  async paste() {
    try {
      return await navigator.clipboard.readText();
    } catch {
      return '';
    }
  },
  async readText() {
    try {
      return await navigator.clipboard.readText();
    } catch {
      return '';
    }
  },
};

// ─── Utilities ──────────────────────────────────────────────────────

export function getPreferenceValues(): Record<string, any> {
  return {};
}

export const environment = {
  isDevelopment: false,
  extensionName: '',
  commandName: '',
  assetsPath: '',
  supportPath: '',
  launchType: 'userInitiated',
};

export function open(url: string) {
  // Use IPC to open URLs in the default browser (or ignore raycast:// deep links)
  (window as any).electron?.openUrl?.(url);
}

export function closeMainWindow() {
  window.electron?.hideWindow?.();
}

export function popToRoot() {
  // handled by ExtensionView
}

// ─── Image ──────────────────────────────────────────────────────────

export const Image = {
  Mask: {
    Circle: 'circle',
    RoundedRectangle: 'rounded',
  },
};

// ─── ActionPanel ────────────────────────────────────────────────────

interface ActionPanelProps {
  children?: React.ReactNode;
  title?: string;
}

function ActionPanelComponent({ children }: ActionPanelProps) {
  // ActionPanel is a container — its children (Actions) are collected
  // by List.Item and rendered when the user activates an item.
  return <>{children}</>;
}

// ─── Action ─────────────────────────────────────────────────────────

interface ActionProps {
  title?: string;
  icon?: any;
  shortcut?: any;
  onAction?: () => void;
  // for compatibility
  [key: string]: any;
}

function ActionComponent({ title, onAction }: ActionProps) {
  return (
    <button
      onClick={onAction}
      className="w-full text-left px-3 py-1.5 text-sm text-white/80 hover:bg-white/[0.06] rounded transition-colors"
    >
      {title}
    </button>
  );
}

function ActionCopyToClipboard({
  content,
  title,
}: {
  content: string;
  title?: string;
  [key: string]: any;
}) {
  return (
    <button
      onClick={() => Clipboard.copy(content)}
      className="w-full text-left px-3 py-1.5 text-sm text-white/80 hover:bg-white/[0.06] rounded transition-colors"
    >
      {title || 'Copy to Clipboard'}
    </button>
  );
}

function ActionOpenInBrowser({
  url,
  title,
}: {
  url: string;
  title?: string;
  [key: string]: any;
}) {
  return (
    <button
      onClick={() => (window as any).electron?.openUrl?.(url)}
      className="w-full text-left px-3 py-1.5 text-sm text-white/80 hover:bg-white/[0.06] rounded transition-colors"
    >
      {title || 'Open in Browser'}
    </button>
  );
}

function ActionPush({
  title,
  target,
}: {
  title?: string;
  target: React.ReactElement;
  [key: string]: any;
}) {
  const { push } = useNavigation();
  return (
    <button
      onClick={() => push(target)}
      className="w-full text-left px-3 py-1.5 text-sm text-white/80 hover:bg-white/[0.06] rounded transition-colors"
    >
      {title || 'Open'}
    </button>
  );
}

// Attach sub-actions
export const Action = Object.assign(ActionComponent, {
  CopyToClipboard: ActionCopyToClipboard,
  OpenInBrowser: ActionOpenInBrowser,
  Push: ActionPush,
  SubmitForm: ActionComponent,
  Paste: ActionCopyToClipboard,
  ShowInFinder: ActionComponent,
  OpenWith: ActionComponent,
});

export const ActionPanel = Object.assign(ActionPanelComponent, {
  Section: ({ children }: { children?: React.ReactNode; title?: string }) => (
    <>{children}</>
  ),
  Submenu: ({
    children,
    title,
  }: {
    children?: React.ReactNode;
    title?: string;
    icon?: any;
  }) => <>{children}</>,
});

// ─── List ───────────────────────────────────────────────────────────

interface ListProps {
  children?: React.ReactNode;
  searchBarPlaceholder?: string;
  onSearchTextChange?: (text: string) => void;
  isLoading?: boolean;
  navigationTitle?: string;
  isShowingDetail?: boolean;
  filtering?: boolean | { keepSectionOrder?: boolean };
  searchBarAccessory?: React.ReactNode;
  throttle?: boolean;
  searchText?: string;
}

function ListComponent({
  children,
  searchBarPlaceholder,
  onSearchTextChange,
  isLoading,
  searchText: controlledSearch,
}: ListProps) {
  const [internalSearch, setInternalSearch] = useState('');
  const searchText = controlledSearch ?? internalSearch;
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [showActions, setShowActions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { pop } = useNavigation();

  const handleSearchChange = (text: string) => {
    setInternalSearch(text);
    onSearchTextChange?.(text);
    setSelectedIdx(0);
  };

  // Flatten all List.Item children from sections and top-level
  const items = flattenListItems(children);

  // Auto-filter if no onSearchTextChange (built-in filtering)
  const filteredItems =
    onSearchTextChange || !searchText.trim()
      ? items
      : items.filter(
          (item) =>
            item.props.title
              ?.toLowerCase()
              .includes(searchText.toLowerCase()) ||
            item.props.subtitle
              ?.toLowerCase()
              .includes(searchText.toLowerCase()) ||
            item.props.keywords?.some((k: string) =>
              k.toLowerCase().includes(searchText.toLowerCase())
            )
        );

  // Keyboard
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (showActions) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setShowActions(false);
        }
        return;
      }

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIdx((p) =>
            p < filteredItems.length - 1 ? p + 1 : p
          );
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIdx((p) => (p > 0 ? p - 1 : 0));
          break;
        case 'Enter':
          e.preventDefault();
          if (filteredItems[selectedIdx]) {
            executePrimaryAction(filteredItems[selectedIdx]);
          }
          break;
        case 'Escape':
          e.preventDefault();
          pop();
          break;
      }
    },
    [filteredItems, selectedIdx, showActions, pop]
  );

  // Scroll selected into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${selectedIdx}"]`);
    if (el)
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedIdx]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06]">
        <svg
          className="w-4 h-4 text-white/30 flex-shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        <input
          ref={inputRef}
          type="text"
          placeholder={searchBarPlaceholder || 'Search…'}
          value={searchText}
          onChange={(e) => handleSearchChange(e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex-1 bg-transparent border-none outline-none text-white/90 placeholder-white/30 text-base font-light"
          autoFocus
        />
      </div>

      {/* Items */}
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto p-1.5"
        style={{ background: 'rgba(10,10,12,0.5)' }}
      >
        {isLoading ? (
          <div className="flex items-center justify-center h-full text-white/50">
            <p className="text-sm">Loading…</p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="flex items-center justify-center h-full text-white/40">
            <p className="text-sm">No results</p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {filteredItems.map((item, idx) => (
              <ListItemRenderer
                key={item.props.id || item.props.title + idx}
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

      {/* Footer */}
      <div className="px-3 py-1.5 border-t border-white/[0.05] text-white/20 text-[11px]">
        {filteredItems.length} items
      </div>
    </div>
  );
}

// ─── List.Item ──────────────────────────────────────────────────────

interface ListItemProps {
  id?: string;
  title: string;
  subtitle?: string;
  icon?: any;
  accessories?: Array<{ text?: string; icon?: any; tag?: any }>;
  actions?: React.ReactElement;
  keywords?: string[];
  detail?: React.ReactElement;
}

function ListItemComponent(_props: ListItemProps) {
  // Actual rendering handled by ListItemRenderer
  return null;
}

function ListItemRenderer({
  title,
  subtitle,
  icon,
  accessories,
  isSelected,
  dataIdx,
  onSelect,
  onActivate,
}: ListItemProps & {
  isSelected: boolean;
  dataIdx: number;
  onSelect: () => void;
  onActivate: () => void;
}) {
  return (
    <div
      data-idx={dataIdx}
      className={`px-3 py-1.5 rounded-lg cursor-pointer transition-all ${
        isSelected
          ? 'bg-white/[0.08] border border-white/[0.1]'
          : 'border border-transparent hover:bg-white/[0.04]'
      }`}
      onClick={onActivate}
      onMouseMove={onSelect}
    >
      <div className="flex items-center gap-2.5">
        {/* Icon */}
        {icon && (
          <div className="w-5 h-5 flex items-center justify-center flex-shrink-0 text-white/50 text-xs">
            {typeof icon === 'string' && icon.startsWith('data:') ? (
              <img src={icon} className="w-5 h-5" alt="" />
            ) : typeof icon === 'object' && icon?.source ? (
              <img src={icon.source} className="w-5 h-5" alt="" />
            ) : (
              <span className="opacity-50">●</span>
            )}
          </div>
        )}
        {/* Text */}
        <div className="flex-1 min-w-0">
          <span className="text-white text-sm truncate block">{title}</span>
        </div>
        {subtitle && (
          <span className="text-white/30 text-xs flex-shrink-0 truncate max-w-[200px]">
            {subtitle}
          </span>
        )}
        {/* Accessories */}
        {accessories?.map((acc, i) => (
          <span key={i} className="text-white/25 text-[11px] flex-shrink-0">
            {typeof acc === 'string'
              ? acc
              : acc?.text || acc?.tag?.value || ''}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── List.Section ───────────────────────────────────────────────────

interface ListSectionProps {
  children?: React.ReactNode;
  title?: string;
  subtitle?: string;
}

function ListSectionComponent({ children, title }: ListSectionProps) {
  return (
    <div className="mb-1">
      {title && (
        <div className="px-3 py-1 text-[11px] uppercase tracking-wider text-white/25 font-medium">
          {title}
        </div>
      )}
      {children}
    </div>
  );
}

// ─── List.EmptyView ─────────────────────────────────────────────────

function ListEmptyView({
  title,
  description,
  icon,
}: {
  title?: string;
  description?: string;
  icon?: any;
}) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-white/40 py-12">
      {icon && <div className="text-2xl mb-2 opacity-40">{typeof icon === 'string' ? icon : '○'}</div>}
      {title && <p className="text-sm font-medium">{title}</p>}
      {description && (
        <p className="text-xs text-white/25 mt-1">{description}</p>
      )}
    </div>
  );
}

// Compose List
export const List = Object.assign(ListComponent, {
  Item: ListItemComponent,
  Section: ListSectionComponent,
  EmptyView: ListEmptyView,
  Dropdown: ({ children }: any) => <>{children}</>,
});

// ─── Detail ─────────────────────────────────────────────────────────

interface DetailProps {
  markdown?: string;
  children?: React.ReactNode;
  isLoading?: boolean;
  navigationTitle?: string;
  actions?: React.ReactElement;
  metadata?: React.ReactElement;
}

function DetailComponent({ markdown, isLoading, children }: DetailProps) {
  const { pop } = useNavigation();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        pop();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [pop]);

  return (
    <div className="flex flex-col h-full">
      <div
        className="flex-1 overflow-y-auto p-6"
        style={{ background: 'rgba(10,10,12,0.5)' }}
      >
        {isLoading ? (
          <div className="flex items-center justify-center h-full text-white/50">
            <p className="text-sm">Loading…</p>
          </div>
        ) : (
          <>
            {markdown && (
              <div className="text-white/80 text-sm leading-relaxed whitespace-pre-wrap">
                {markdown}
              </div>
            )}
            {children}
          </>
        )}
      </div>
    </div>
  );
}

DetailComponent.Metadata = ({ children }: { children?: React.ReactNode }) => (
  <>{children}</>
);
DetailComponent.Metadata.Label = ({
  title,
  text,
}: {
  title: string;
  text?: string;
  icon?: any;
}) => (
  <div className="text-xs text-white/50">
    <span className="text-white/30">{title}: </span>
    {text}
  </div>
);
DetailComponent.Metadata.Separator = () => (
  <hr className="border-white/[0.06] my-2" />
);
DetailComponent.Metadata.Link = ({
  title,
  target,
  text,
}: {
  title: string;
  target: string;
  text: string;
}) => (
  <div className="text-xs">
    <span className="text-white/30">{title}: </span>
    <a href={target} className="text-blue-400 hover:underline">
      {text}
    </a>
  </div>
);
DetailComponent.Metadata.TagList = ({ children }: any) => <>{children}</>;
DetailComponent.Metadata.TagList.Item = ({ text }: any) => (
  <span className="text-xs bg-white/10 px-1.5 py-0.5 rounded text-white/60 mr-1">
    {text}
  </span>
);

export const Detail = DetailComponent;

// ─── Form (stub) ────────────────────────────────────────────────────

function FormComponent({ children }: any) {
  return (
    <div className="flex flex-col h-full p-6" style={{ background: 'rgba(10,10,12,0.5)' }}>
      {children}
    </div>
  );
}

FormComponent.TextField = ({
  id,
  title,
  placeholder,
  value,
  onChange,
}: any) => (
  <div className="mb-3">
    <label className="text-xs text-white/50 mb-1 block">{title}</label>
    <input
      type="text"
      placeholder={placeholder}
      value={value}
      onChange={(e: any) => onChange?.(e.target.value)}
      className="w-full bg-white/[0.06] border border-white/[0.08] rounded px-3 py-1.5 text-sm text-white outline-none focus:border-white/20"
    />
  </div>
);

FormComponent.TextArea = FormComponent.TextField;
FormComponent.Checkbox = ({ id, title, value, onChange }: any) => (
  <label className="flex items-center gap-2 mb-3 text-sm text-white/80 cursor-pointer">
    <input
      type="checkbox"
      checked={value}
      onChange={(e: any) => onChange?.(e.target.checked)}
      className="accent-blue-500"
    />
    {title}
  </label>
);
FormComponent.Dropdown = ({ id, title, children }: any) => (
  <div className="mb-3">
    <label className="text-xs text-white/50 mb-1 block">{title}</label>
    <select className="w-full bg-white/[0.06] border border-white/[0.08] rounded px-3 py-1.5 text-sm text-white outline-none">
      {children}
    </select>
  </div>
);
FormComponent.Dropdown.Item = ({ value, title }: any) => (
  <option value={value}>{title}</option>
);
FormComponent.DatePicker = FormComponent.TextField;
FormComponent.Description = ({ text }: any) => (
  <p className="text-xs text-white/40 mb-3">{text}</p>
);
FormComponent.Separator = () => <hr className="border-white/[0.06] my-3" />;
FormComponent.TagPicker = ({ children }: any) => <>{children}</>;
FormComponent.TagPicker.Item = ({ value, title }: any) => (
  <span>{title}</span>
);

export const Form = FormComponent;

// ─── Grid (stub) ────────────────────────────────────────────────────

export const Grid = Object.assign(
  ({ children }: any) => <div>{children}</div>,
  {
    Item: ({ title }: any) => (
      <div className="text-sm text-white/80 p-2">{title}</div>
    ),
    Section: ListSectionComponent,
    EmptyView: ListEmptyView,
    Dropdown: ({ children }: any) => <>{children}</>,
  }
);

// ─── LocalStorage (stub) ────────────────────────────────────────────

const storagePrefix = 'sc-ext-';

export const LocalStorage = {
  async getItem(key: string): Promise<string | undefined> {
    return localStorage.getItem(storagePrefix + key) ?? undefined;
  },
  async setItem(key: string, value: string): Promise<void> {
    localStorage.setItem(storagePrefix + key, value);
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

// ─── Cache (stub) ───────────────────────────────────────────────────

export class Cache {
  private data: Record<string, string> = {};
  get(key: string): string | undefined {
    return this.data[key];
  }
  set(key: string, value: string): void {
    this.data[key] = value;
  }
  remove(key: string): void {
    delete this.data[key];
  }
  has(key: string): boolean {
    return key in this.data;
  }
  isEmpty = false;
}

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Recursively collect all List.Item elements from children,
 * walking through List.Section and Fragment wrappers.
 */
function flattenListItems(
  children: React.ReactNode
): React.ReactElement<ListItemProps>[] {
  const items: React.ReactElement<ListItemProps>[] = [];

  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;

    // Direct List.Item
    if (
      child.type === ListItemComponent ||
      (child.type as any)?.displayName === 'ListItem'
    ) {
      items.push(child as React.ReactElement<ListItemProps>);
      return;
    }

    // List.Section or Fragment — recurse
    if (child.props && (child.props as any).children) {
      items.push(...flattenListItems((child.props as any).children));
    }
  });

  return items;
}

/**
 * Execute the primary (first) action of a List.Item.
 */
function executePrimaryAction(item: React.ReactElement<ListItemProps>) {
  const actionsElement = item.props.actions;
  if (!actionsElement) return;

  // Walk action children to find the first Action
  const actions: React.ReactElement[] = [];
  React.Children.forEach(
    (actionsElement.props as any)?.children,
    (child) => {
      if (React.isValidElement(child)) {
        // Check for Section children too
        if ((child.props as any)?.children) {
          React.Children.forEach(
            (child.props as any).children,
            (subChild) => {
              if (React.isValidElement(subChild)) {
                actions.push(subChild);
              }
            }
          );
        } else {
          actions.push(child);
        }
      }
    }
  );

  if (actions.length === 0) return;

  const primary = actions[0];
  const props = primary.props as any;

  // Execute based on action type
  if (props.onAction) {
    props.onAction();
  } else if (props.content !== undefined) {
    // CopyToClipboard
    Clipboard.copy(String(props.content));
  } else if (props.url) {
    // OpenInBrowser
    (window as any).electron?.openUrl?.(props.url);
  }
}

// ─── @raycast/utils stubs ───────────────────────────────────────────

export function useFetch(url: string, options?: any) {
  const [data, setData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<any>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);

    fetch(url)
      .then((res) => res.json())
      .then((d) => {
        if (!cancelled) {
          setData(options?.mapResult ? options.mapResult(d) : d);
          setIsLoading(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e);
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [url]);

  return { data, isLoading, error, revalidate: () => {} };
}

export function useCachedPromise(fn: (...args: any[]) => Promise<any>, args?: any[], options?: any) {
  const [data, setData] = useState<any>(options?.initialData ?? null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<any>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    fn(...(args || []))
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setIsLoading(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e);
          setIsLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, []);

  return { data, isLoading, error, revalidate: () => {} };
}

export function useCachedState<T>(key: string, initialValue: T): [T, (v: T) => void] {
  return useState<T>(initialValue);
}

