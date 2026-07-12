import type { CommandInfo } from '../../types/electron';

export type BackgroundRefreshTimerKind = 'extension' | 'inline-script';

export interface BackgroundRefreshTimerDescriptor {
  key: string;
  kind: BackgroundRefreshTimerKind;
  command: CommandInfo;
  intervalMs: number;
  extensionCommand?: { extName: string; cmdName: string };
}

export interface BackgroundRefreshTimerEntry<TTimerId> {
  timerId: TTimerId;
}

export interface BackgroundRefreshTimerReconcileResult {
  created: number;
  retained: number;
  cleared: number;
}

export interface BackgroundRefreshTimerReconcileOptions<TTimerId> {
  timers: Map<string, BackgroundRefreshTimerEntry<TTimerId>>;
  descriptors: BackgroundRefreshTimerDescriptor[];
  createTimer: (descriptor: BackgroundRefreshTimerDescriptor) => TTimerId;
  clearTimer: (timerId: TTimerId) => void;
}

export type BackgroundRefreshTick = () => Promise<void> | void;

export function createInFlightBackgroundRefreshTick(runTick: BackgroundRefreshTick): () => void {
  let inFlight = false;

  return () => {
    if (inFlight) return;

    inFlight = true;
    void Promise.resolve()
      .then(runTick)
      .finally(() => {
        inFlight = false;
      });
  };
}
export function parseExtensionCommandPath(pathValue: string): { extName: string; cmdName: string } | null {
  const rawPath = String(pathValue || '').trim();
  const separatorIndex = rawPath.indexOf('/');
  if (separatorIndex <= 0 || separatorIndex >= rawPath.length - 1) return null;

  const extName = rawPath.slice(0, separatorIndex).trim();
  const cmdName = rawPath.slice(separatorIndex + 1).trim();
  if (!extName || !cmdName) return null;

  return { extName, cmdName };
}

export function getBackgroundRefreshTimerKey(cmd: CommandInfo): string | null {
  if (cmd.category === 'extension' && typeof cmd.interval === 'string' && cmd.path) {
    const identity = parseExtensionCommandPath(cmd.path);
    if (!identity) return null;

    return [
      'extension',
      cmd.id,
      `${identity.extName}/${identity.cmdName}`,
      cmd.path.trim(),
      cmd.mode || '',
      cmd.interval,
    ].join('\u0000');
  }

  if (cmd.category === 'script' && cmd.mode === 'inline' && typeof cmd.interval === 'string') {
    return ['inline-script', cmd.id, (cmd.path || '').trim(), cmd.mode, cmd.interval].join('\u0000');
  }

  return null;
}

export function getBackgroundRefreshTimerDescriptors(
  commands: CommandInfo[],
  parseIntervalToMs: (interval: string) => number | null
): BackgroundRefreshTimerDescriptor[] {
  const descriptors: BackgroundRefreshTimerDescriptor[] = [];
  const seenKeys = new Set<string>();

  for (const cmd of commands) {
    const key = getBackgroundRefreshTimerKey(cmd);
    if (!key || seenKeys.has(key) || typeof cmd.interval !== 'string') continue;

    const intervalMs = parseIntervalToMs(cmd.interval);
    if (!intervalMs) continue;

    descriptors.push({
      key,
      kind: cmd.category === 'extension' ? 'extension' : 'inline-script',
      command: cmd,
      intervalMs,
      extensionCommand: cmd.category === 'extension' ? parseExtensionCommandPath(cmd.path || '') || undefined : undefined,
    });
    seenKeys.add(key);
  }

  return descriptors;
}

export function reconcileBackgroundRefreshTimers<TTimerId>({
  timers,
  descriptors,
  createTimer,
  clearTimer,
}: BackgroundRefreshTimerReconcileOptions<TTimerId>): BackgroundRefreshTimerReconcileResult {
  const nextKeys = new Set(descriptors.map((descriptor) => descriptor.key));
  let created = 0;
  let retained = 0;
  let cleared = 0;

  for (const [key, entry] of Array.from(timers.entries())) {
    if (!nextKeys.has(key)) {
      clearTimer(entry.timerId);
      timers.delete(key);
      cleared += 1;
    }
  }

  for (const descriptor of descriptors) {
    if (timers.has(descriptor.key)) {
      retained += 1;
      continue;
    }

    timers.set(descriptor.key, { timerId: createTimer(descriptor) });
    created += 1;
  }

  return { created, retained, cleared };
}

export function clearBackgroundRefreshTimers<TTimerId>(
  timers: Map<string, BackgroundRefreshTimerEntry<TTimerId>>,
  clearTimer: (timerId: TTimerId) => void
): number {
  let cleared = 0;

  for (const entry of timers.values()) {
    clearTimer(entry.timerId);
    cleared += 1;
  }

  timers.clear();
  return cleared;
}
