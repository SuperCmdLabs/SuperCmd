type NodeWindowBounds = { x: number; y: number; width: number; height: number };
type NodeWindowInfo = {
  id?: number;
  title?: string;
  path?: string;
  processId?: number;
  bounds?: NodeWindowBounds;
  workArea?: NodeWindowBounds;
};

type WorkerRequest =
  | { id: number; method: 'request-accessibility' }
  | { id: number; method: 'list-windows' }
  | { id: number; method: 'get-active-window' }
  | { id: number; method: 'get-window-by-id'; payload?: { id?: string } }
  | { id: number; method: 'set-window-bounds'; payload?: { id?: string; bounds?: NodeWindowBounds } };

type WorkerResponse =
  | { id: number; ok: true; result: any }
  | { id: number; ok: false; error: string };

let cachedWindowManagerApi: any | null = null;

function getWindowManagerApi(): any | null {
  if (cachedWindowManagerApi) return cachedWindowManagerApi;
  try {
    const mod = require('node-window-manager');
    cachedWindowManagerApi = mod?.windowManager || mod;
    return cachedWindowManagerApi;
  } catch (error) {
    console.error('[WindowManagerWorker] Failed to load node-window-manager:', error);
    return null;
  }
}

function normalizeRect(raw: any): NodeWindowBounds | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const x = Number(raw.x);
  const y = Number(raw.y);
  const width = Number(raw.width);
  const height = Number(raw.height);
  if (![x, y, width, height].every((value) => Number.isFinite(value))) {
    return undefined;
  }
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  };
}

function normalizeWindowInfo(win: any): NodeWindowInfo | null {
  if (!win) return null;
  const info = typeof win.getInfo === 'function' ? win.getInfo() : {};
  const bounds = typeof win.getBounds === 'function' ? win.getBounds() : info?.bounds;
  let monitorWorkArea = info?.workArea;
  if (!monitorWorkArea && typeof win.getMonitor === 'function') {
    try {
      const monitor = win.getMonitor();
      if (monitor && typeof monitor.getWorkArea === 'function') {
        monitorWorkArea = monitor.getWorkArea();
      }
    } catch {}
  }
  const idRaw = info?.id ?? win?.id;
  const id = typeof idRaw === 'number' ? idRaw : Number(idRaw);
  if (!Number.isFinite(id)) return null;
  const titleRaw = info?.title || (typeof win?.getTitle === 'function' ? win.getTitle() : '');
  const pathRaw = info?.path ?? win?.path;
  const processIdRaw = info?.processId ?? win?.processId;
  const processId = typeof processIdRaw === 'number' ? processIdRaw : Number(processIdRaw);
  const normalizedBounds = normalizeRect(bounds);
  const normalizedWorkArea = normalizeRect(monitorWorkArea);

  return {
    id,
    title: String(titleRaw || ''),
    path: String(pathRaw || ''),
    processId: Number.isFinite(processId) ? processId : undefined,
    bounds: normalizedBounds,
    workArea: normalizedWorkArea,
  };
}

function isSelfManagedWindow(info: NodeWindowInfo | null): boolean {
  if (!info) return false;
  const pid = Number(info.processId);
  if (Number.isFinite(pid) && pid > 0) {
    // Worker runs as a child process of Electron main.
    if (pid === process.ppid) return true;
  }
  const title = String(info.title || '').toLowerCase();
  if (title.includes('supercmd')) return true;
  const appPath = String(info.path || '');
  if (appPath.includes('SuperCmd.app')) return true;
  return false;
}

function getWindowsRaw(): any[] {
  const api = getWindowManagerApi();
  if (!api || typeof api.getWindows !== 'function') return [];
  const windows = api.getWindows();
  return Array.isArray(windows) ? windows : [];
}

function getWindowByIdRaw(windowId: string): any | null {
  const numericId = Number(windowId);
  if (!Number.isFinite(numericId)) return null;
  const api = getWindowManagerApi();
  if (api && typeof api.getWindow === 'function') {
    try {
      const direct = api.getWindow(numericId);
      if (direct) {
        const info = normalizeWindowInfo(direct);
        if (info?.id === numericId) return direct;
      }
    } catch {}
    try {
      const direct = api.getWindow(String(Math.trunc(numericId)));
      if (direct) {
        const info = normalizeWindowInfo(direct);
        if (info?.id === numericId) return direct;
      }
    } catch {}
  }
  const windows = getWindowsRaw();
  for (const win of windows) {
    const info = normalizeWindowInfo(win);
    if (!info?.id) continue;
    if (info.id === numericId) return win;
  }
  return null;
}

function send(response: WorkerResponse): void {
  try {
    if (typeof process.send === 'function') {
      process.send(response);
    }
  } catch {}
}

async function handleRequest(request: WorkerRequest): Promise<WorkerResponse> {
  const requestId = Number((request as any)?.id || 0);
  try {
    const api = getWindowManagerApi();
    if (!api) {
      return { id: request.id, ok: false, error: 'window manager unavailable' };
    }

    switch (request.method) {
      case 'request-accessibility': {
        if (process.platform === 'darwin' && typeof api.requestAccessibility === 'function') {
          api.requestAccessibility();
        }
        return { id: request.id, ok: true, result: true };
      }
      case 'list-windows': {
        const windows = getWindowsRaw()
          .map((win) => normalizeWindowInfo(win))
          .filter((info) => Boolean(info) && !isSelfManagedWindow(info as NodeWindowInfo));
        return { id: request.id, ok: true, result: windows };
      }
      case 'get-active-window': {
        if (typeof api.getActiveWindow !== 'function') {
          return { id: request.id, ok: true, result: null };
        }
        const active = api.getActiveWindow();
        const info = normalizeWindowInfo(active);
        if (isSelfManagedWindow(info)) {
          return { id: request.id, ok: true, result: null };
        }
        return { id: request.id, ok: true, result: info };
      }
      case 'get-window-by-id': {
        const id = String(request.payload?.id || '').trim();
        if (!id) return { id: request.id, ok: true, result: null };
        const win = getWindowByIdRaw(id);
        const info = normalizeWindowInfo(win);
        if (isSelfManagedWindow(info)) {
          return { id: request.id, ok: true, result: null };
        }
        return { id: request.id, ok: true, result: info };
      }
      case 'set-window-bounds': {
        const id = String(request.payload?.id || '').trim();
        const bounds = request.payload?.bounds;
        if (!id || !bounds) {
          return { id: request.id, ok: false, error: 'invalid payload' };
        }
        const win = getWindowByIdRaw(id);
        if (!win || typeof win.setBounds !== 'function') {
          return { id: request.id, ok: true, result: false };
        }
        const info = normalizeWindowInfo(win);
        if (isSelfManagedWindow(info)) {
          return { id: request.id, ok: true, result: false };
        }
        const x = Number(bounds.x);
        const y = Number(bounds.y);
        const width = Number(bounds.width);
        const height = Number(bounds.height);
        if (![x, y, width, height].every((value) => Number.isFinite(value))) {
          return { id: request.id, ok: false, error: 'invalid bounds' };
        }
        try {
          win.setBounds({
            x: Math.round(x),
            y: Math.round(y),
            width: Math.max(1, Math.round(width)),
            height: Math.max(1, Math.round(height)),
          });
        } catch (error) {
          return {
            id: request.id,
            ok: false,
            error: String((error as any)?.message || error || 'setBounds failed'),
          };
        }
        return { id: request.id, ok: true, result: true };
      }
    }
    return { id: requestId, ok: false, error: 'unknown method' };
  } catch (error: any) {
    return {
      id: request.id,
      ok: false,
      error: String(error?.message || error || 'window manager worker error'),
    };
  }
}

process.on('message', (message: WorkerRequest) => {
  void (async () => {
    if (!message || typeof message !== 'object') return;
    if (typeof message.id !== 'number' || !message.method) return;
    const response = await handleRequest(message);
    send(response);
  })();
});

process.on('uncaughtException', (error) => {
  console.error('[WindowManagerWorker] Uncaught exception:', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('[WindowManagerWorker] Unhandled rejection:', reason);
});
