import { execFile } from 'child_process';

const DEFAULT_AEROSPACE_TIMEOUT_MS = 500;
const DEFAULT_SUPERCMD_BUNDLE_ID = 'com.supercmd.app';

export type AerospaceCommandRunner = (args: string[]) => Promise<string>;

export type AerospaceWorkspaceMoverOptions = {
  platform?: NodeJS.Platform;
  bundleId?: string;
  timeoutMs?: number;
  shouldRun?: () => boolean;
  runCommand?: AerospaceCommandRunner;
};

export type AerospaceWorkspaceMoverState = {
  available: boolean | null;
  inFlight: boolean;
  queued: boolean;
};

export type AerospaceWorkspaceMover = {
  requestMove: () => void;
  whenIdle: () => Promise<void>;
  getState: () => AerospaceWorkspaceMoverState;
};

function isAerospaceUnavailableError(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'ENOENT';
}

export function execAerospaceCommand(args: string[], timeoutMs = DEFAULT_AEROSPACE_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'aerospace',
      args,
      {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
        timeout: timeoutMs,
      },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(String(stdout || ''));
      },
    );
  });
}

export function createAerospaceWorkspaceMover(options: AerospaceWorkspaceMoverOptions = {}): AerospaceWorkspaceMover {
  const platform = options.platform ?? process.platform;
  const bundleId = options.bundleId ?? DEFAULT_SUPERCMD_BUNDLE_ID;
  const timeoutMs = options.timeoutMs ?? DEFAULT_AEROSPACE_TIMEOUT_MS;
  const runCommand = options.runCommand ?? ((args) => execAerospaceCommand(args, timeoutMs));

  let available: boolean | null = null;
  let inFlight = false;
  let queued = false;
  let inFlightPromise: Promise<void> | null = null;

  function canAttemptMove(): boolean {
    if (available === false || platform !== 'darwin') return false;
    try {
      return options.shouldRun ? options.shouldRun() : true;
    } catch {
      return false;
    }
  }

  async function reconcileOnce(): Promise<void> {
    if (!canAttemptMove()) return;

    try {
      const focusedWs = String(await runCommand(['list-workspaces', '--focused'])).trim();
      if (!focusedWs) return;
      available = true;

      const windowsRaw = String(
        await runCommand([
          'list-windows',
          '--all',
          '--app-bundle-id',
          bundleId,
          '--format',
          '%{window-id} %{workspace}',
        ]),
      ).trim();
      if (!windowsRaw) return;

      for (const line of windowsRaw.split('\n')) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 2) continue;
        const [windowId, currentWs] = parts;
        if (currentWs === focusedWs) continue;
        await runCommand(['move-node-to-workspace', focusedWs, '--window-id', windowId]);
      }
    } catch (error) {
      // ENOENT means the binary is unavailable; skip future attempts.
      if (isAerospaceUnavailableError(error)) {
        available = false;
      }
      // Other failures are transient (server not running, timeout, bad output).
    }
  }

  async function runQueuedReconciliations(): Promise<void> {
    try {
      do {
        queued = false;
        await reconcileOnce();
      } while (queued && canAttemptMove());
    } finally {
      inFlight = false;
      inFlightPromise = null;
    }
  }

  function requestMove(): void {
    if (!canAttemptMove()) return;
    if (inFlight) {
      queued = true;
      return;
    }

    inFlight = true;
    inFlightPromise = runQueuedReconciliations();
    void inFlightPromise.catch(() => {});
  }

  function whenIdle(): Promise<void> {
    return inFlightPromise ?? Promise.resolve();
  }

  function getState(): AerospaceWorkspaceMoverState {
    return { available, inFlight, queued };
  }

  return {
    requestMove,
    whenIdle,
    getState,
  };
}
