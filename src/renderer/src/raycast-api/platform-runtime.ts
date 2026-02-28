/**
 * raycast-api/platform-runtime.ts
 * Purpose: Platform-facing helpers (window management, browser extension stubs,
 * tool types, SQL bridge, and in-memory async cache utility).
 */

export type AppLike = { name: string; path: string; bundleId?: string; localizedName?: string };

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
  application?: AppLike;
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

(WindowManagement as any).DesktopType = WindowManagementDesktopType;

export namespace BrowserExtension {
  export interface Tab {
    active: boolean;
    id: number;
    url: string;
    favicon?: string;
    title?: string;
  }

  export interface ContentOptions {
    cssSelector?: string;
    tabId?: number;
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

