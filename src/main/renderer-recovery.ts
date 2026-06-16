// Pure decision logic for recovering the launcher renderer after it dies.
//
// The launcher renderer is created once and kept alive (hidden) for the whole
// session; it also runs every extension with full Node integration. If that
// renderer is killed (extension crash, OOM, or macOS reaping the backgrounded
// process) the window has nothing to paint and shows blank on the next show().
// We reload it — but a renderer that crashes immediately on load must not spin
// in a tight reload loop, so reloads are rate-limited.
//
// This file deliberately contains NO Electron references so the decision can be
// unit-tested by running it through a crash sequence (see
// scripts/test-renderer-crash-recovery.mjs) rather than grepping the source.

export const RENDERER_RECOVERY_STABLE_SESSION_MS = 30 * 1000; // 30s
export const RENDERER_RECOVERY_MAX_RELOADS = 3;
// Defer the reload OUT of the crash-event callback. Reloading synchronously
// inside render-process-gone spawns the replacement renderer while Chromium is
// still tearing down the dead one; on macOS that can fail the Mach IPC
// rendezvous and abort the whole app (SIGTRAP) — strictly worse than the blank
// window we're fixing. A short delay lets the dead renderer tear down first.
export const RENDERER_RECOVERY_DELAY_MS = 500;

export interface RendererCrashState {
  /** Number of reloads in the current (recent) burst. */
  count: number;
  /** Timestamp (ms) of the last crash we acted on. */
  lastAt: number;
}

export interface RendererCrashDecision {
  /** Whether the window should be reloaded to recover. */
  reload: boolean;
  /** State to carry into the next crash evaluation. */
  nextState: RendererCrashState;
  /** True when we've crashed too many times and are giving up. */
  giveUp: boolean;
}

export function getRendererCrashState(): RendererCrashState {
  return { count: 0, lastAt: 0 };
}

/**
 * Decide whether to reload the launcher window after its renderer process is
 * gone. Pure: same inputs always yield the same decision and next state.
 *
 * @param state  current crash-burst state
 * @param reason details.reason from the render-process-gone event
 * @param now    current time in ms (injected so tests are deterministic)
 */
export function evaluateRendererCrash(
  state: RendererCrashState,
  reason: string,
  now: number,
): RendererCrashDecision {
  // 'clean-exit' is an intentional, normal teardown — nothing to recover, and
  // it must not consume the reload budget.
  if (reason === 'clean-exit') {
    return { reload: false, nextState: state, giveUp: false };
  }

  // A crash that arrives after a long quiet stretch starts a fresh burst.
  let count = state.count;
  if (now - state.lastAt > RENDERER_RECOVERY_STABLE_SESSION_MS) count = 0;
  count += 1;
  const nextState: RendererCrashState = { count, lastAt: now };

  if (count > RENDERER_RECOVERY_MAX_RELOADS) {
    return { reload: false, nextState, giveUp: true };
  }
  return { reload: true, nextState, giveUp: false };
}
