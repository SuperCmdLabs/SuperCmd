// Auto-recovery budget for renderer render-crashes. A render error that leaves
// the launcher blank should silently reload rather than stranding the user — but 
// a crash that recurs on every mount must not spin in a reload loop. The budget is 
// tracked in sessionStorage so it survives the reload (same renderer session) and 
// resets when a session stays healthy.
//
// Storage is injected (defaulting to the real sessionStorage) so the budget can
// be exercised by running it against an in-memory store in a test instead of
// grepping the source.

export const RELOAD_TRACKER_KEY = 'sc-renderer-reload-tracker';
export const RELOAD_WINDOW_MS = 30_000;
export const MAX_AUTO_RELOADS = 3;
export const STABLE_SESSION_MS = 30 * 1000; // 30s

/** Minimal storage surface we depend on (a subset of the Web Storage API). */
export interface BudgetStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface Tracker {
  count: number;
  firstAt: number;
}

/**
 * Consume one unit of the auto-reload budget.
 * @returns true if a reload is allowed (and the budget was charged), false if
 *          the budget is exhausted or storage is unavailable.
 */
export function consumeAutoReloadBudget(
  storage: BudgetStorage = sessionStorage,
  now: number = Date.now(),
): boolean {
  try {
    const raw = storage.getItem(RELOAD_TRACKER_KEY);
    let tracker = raw ? (JSON.parse(raw) as Tracker) : null;
    if (!tracker || now - tracker.firstAt > RELOAD_WINDOW_MS) {
      tracker = { count: 0, firstAt: now };
    }
    if (tracker.count >= MAX_AUTO_RELOADS) return false;
    tracker.count += 1;
    storage.setItem(RELOAD_TRACKER_KEY, JSON.stringify(tracker));
    return true;
  } catch {
    // No sessionStorage (or it's wedged) — don't risk an unbounded reload loop.
    return false;
  }
}

/** Reset the budget once a session has proven stable. */
export function clearAutoReloadBudget(storage: BudgetStorage = sessionStorage): void {
  try {
    storage.removeItem(RELOAD_TRACKER_KEY);
  } catch {
    // ignore
  }
}
