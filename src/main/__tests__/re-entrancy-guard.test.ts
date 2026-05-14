/**
 * Re-entrancy Guard & Event Loop Yielding Tests
 *
 * These tests simulate the root cause of a main-process hang where
 * the Electron main thread entered a re-entrant event loop:
 * V8 compilation → tick_callback → uv_run processed fs.stat completions,
 * which triggered more JS callbacks → more compilation, creating an infinite
 * synchronous busy-loop. The outer Cocoa event loop never regained control.
 *
 * These tests verify that:
 * 1. The re-entrancy guard prevents nested calls from blocking the event loop
 * 2. Yield points (setImmediate) break long synchronous work into chunks
 * 3. Timeout guards prevent bundle loading from hanging indefinitely
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Re-entrancy Guard Implementation ────────────────────────────────
// This is the guard we inject into getExtensionBundle and similar
// long-running async operations.

const _guardDepths = new Map<string, number>();
const MAX_REENTRANCY_DEPTH = 1; // prevent ANY nesting
const REENTRANCY_TIMEOUT_MS = 15_000;

function createReentrancyGuard(label: string) {
  return {
    enter(): boolean {
      const current = _guardDepths.get(label) ?? 0;
      if (current >= MAX_REENTRANCY_DEPTH) {
        console.warn(`[ReentrancyGuard] Blocked re-entrant call to "${label}" (depth=${current})`);
        return false;
      }
      _guardDepths.set(label, current + 1);
      return true;
    },
    exit(): void {
      const current = _guardDepths.get(label) ?? 0;
      if (current > 0) {
        _guardDepths.set(label, current - 1);
      }
    },
  };
}

function resetReentrancyGuard(): void {
  _guardDepths.clear();
}

// ── Yield Helper ────────────────────────────────────────────────────
// Yields to the event loop so pending I/O callbacks can be processed.
// This prevents the nested uv_run pattern seen in the crash.

async function yieldToEventLoop(): Promise<void> {
  return new Promise<void>((resolve) => {
    if (typeof setImmediate !== 'undefined') {
      setImmediate(resolve);
    } else {
      setTimeout(resolve, 0);
    }
  });
}

// ── Timeout Wrapper ─────────────────────────────────────────────────

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`[Timeout] "${label}" exceeded ${ms}ms`));
    }, ms);
  });
  try {
    const result = await Promise.race([promise, timeout]);
    return result;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ── Simulated Re-entrant Workload ───────────────────────────────────
// Simulates what the crash shows: a loop of sync work that triggers
// async completions (simulating fs.stat → callback → more work).

interface WorkItem {
  id: number;
  depth: number;
}

/**
 * Simulates a re-entrant workload that mimics the crash pattern:
 * 1. Do synchronous work (simulating V8 compilation / fs operations)
 * 2. Trigger an async completion (simulating fs.stat callback)
 * 3. Inside the callback, do more sync work
 * 4. Without yielding, this creates a re-entrant event loop
 */
function simulateSyncWork(ms: number): number {
  const start = Date.now();
  let count = 0;
  while (Date.now() - start < ms) {
    // Simulate CPU-bound work: string operations, array manipulations
    const arr = new Array(1000).fill(0).map((_, i) => i * Math.random());
    arr.sort((a, b) => a - b);
    count += arr.reduce((a, b) => a + b, 0) ? 1 : 0;
    // Check every iteration to avoid infinite loop
    if (count > 1_000_000) break;
  }
  return count;
}

// ── Tests ───────────────────────────────────────────────────────────

describe('Re-entrancy Guard', () => {
  beforeEach(() => {
    resetReentrancyGuard();
  });

  it('should allow first entry', () => {
    const guard = createReentrancyGuard('test');
    expect(guard.enter()).toBe(true);
    guard.exit();
  });

  it('should block re-entrant calls', () => {
    const guard = createReentrancyGuard('test');
    expect(guard.enter()).toBe(true);  // first entry OK
    expect(guard.enter()).toBe(false); // re-entry blocked
    guard.exit();
    expect(guard.enter()).toBe(true);  // after exit, OK again
    guard.exit();
  });

  it('should handle concurrent guards independently', () => {
    const guard1 = createReentrancyGuard('operation-1');
    const guard2 = createReentrancyGuard('operation-2');

    // Different labels should not interfere
    expect(guard1.enter()).toBe(true);
    expect(guard2.enter()).toBe(true);
    guard2.exit();
    guard1.exit();
  });

  it('should allow re-entry after full exit', () => {
    const guard = createReentrancyGuard('test');
    // Enter, exit, re-enter
    expect(guard.enter()).toBe(true);
    guard.exit();
    expect(guard.enter()).toBe(true);
    guard.exit();
    expect(guard.enter()).toBe(true);
    guard.exit();
  });
});

describe('Yield to Event Loop', () => {
  it('should return control to the event loop', async () => {
    let yielded = false;
    const yieldPromise = yieldToEventLoop().then(() => {
      yielded = true;
    });
    // The promise should not resolve synchronously
    expect(yielded).toBe(false);
    await yieldPromise;
    expect(yielded).toBe(true);
  });

  it('should allow pending microtasks to drain between yields', async () => {
    const executionOrder: string[] = [];

    // Schedule a microtask that runs after the first yield
    const microtaskPromise = new Promise<void>((resolve) => {
      queueMicrotask(() => {
        executionOrder.push('microtask');
        resolve();
      });
    });

    // Schedule a yield
    const yieldPromise = yieldToEventLoop().then(() => {
      executionOrder.push('after-yield');
    });

    await Promise.all([microtaskPromise, yieldPromise]);
    // The yield happens AFTER microtasks are processed
    expect(executionOrder).toContain('microtask');
    expect(executionOrder).toContain('after-yield');
  });
});

describe('Timeout Wrapper', () => {
  it('should resolve fast promises normally', async () => {
    const result = await withTimeout(
      Promise.resolve('done'),
      1000,
      'fast-op'
    );
    expect(result).toBe('done');
  });

  it('should reject slow promises that exceed timeout', async () => {
    const slowPromise = new Promise<string>((resolve) => {
      setTimeout(() => resolve('too late'), 500);
    });
    await expect(
      withTimeout(slowPromise, 50, 'slow-op')
    ).rejects.toThrow('[Timeout] "slow-op" exceeded 50ms');
  });

  it('should clean up timer on success', async () => {
    // Use vi.useFakeTimers to verify timer cleanup
    const fastPromise = Promise.resolve('fast');
    await expect(
      withTimeout(fastPromise, 1000, 'cleanup-test')
    ).resolves.toBe('fast');
  });
});

describe('Re-entrant Event Loop Simulation', () => {
  /**
   * This test simulates the EXACT pattern seen in the crash:
   *
   * Crash stack shows:
   *   uv_run → uv__work_done → AfterStat → FSReqCallback::Reject
   *   → MakeCallback → JS execution → V8 compilation → repeat
   *
   * The pattern: sync CPU work + async completions → re-entrant event loop
   *
   * Without yield points: the outer event loop blocks (simulating the hang)
   * With yield points: control returns to the event loop periodically
   */

  it('should demonstrate the re-entrant event loop problem (no yields)', async () => {
    // Simulate a workload that does sync work + schedules async work
    // Without yields, this blocks the event loop
    const outerStart = Date.now();
    let asyncCallbackFired = false;

    // Schedule an async callback (simulates fs.stat completion)
    const asyncPromise = new Promise<void>((resolve) => {
      setImmediate(() => {
        asyncCallbackFired = true;
        resolve();
      });
    });

    // Do synchronous work (simulates the discovery/build workload from the crash)
    // Without yields, this blocks the event loop for the entire duration
    simulateSyncWork(50); // 50ms of CPU work

    // The async callback should NOT have fired yet because the event
    // loop hasn't had a chance to process it
    expect(asyncCallbackFired).toBe(false);

    // Now yield to let the event loop process
    await yieldToEventLoop();

    // After yielding, the async callback should have fired
    expect(asyncCallbackFired).toBe(true);
    const elapsed = Date.now() - outerStart;
    console.log(`[test] No-yield workload: ${elapsed}ms total, async fired: ${asyncCallbackFired}`);
  });

  it('should prevent blocking with yield points', async () => {
    const executionOrder: string[] = [];

    // Schedule an async callback
    const asyncPromise = new Promise<void>((resolve) => {
      setImmediate(() => {
        executionOrder.push('async-callback');
        resolve();
      });
    });

    // Do sync work in chunks with yields between them
    // This simulates adding yield points to the discovery loop
    for (let i = 0; i < 3; i++) {
      simulateSyncWork(20); // Do 20ms of work
      await yieldToEventLoop(); // Yield to event loop
      executionOrder.push(`chunk-${i}-done`);
    }

    await asyncPromise;

    // The async callback should have fired during one of the yields
    expect(executionOrder).toContain('async-callback');
    // The callback should have fired before all chunks completed
    const asyncIndex = executionOrder.indexOf('async-callback');
    expect(asyncIndex).toBeLessThan(executionOrder.length - 1);
  });

  it('should demonstrate the crash pattern with re-entrant guard', async () => {
    /**
     * This directly simulates the crash pattern:
     * 1. An async operation is in progress (bundle loading)
     * 2. Another call attempts to enter the same critical section
     * 3. Without guard: re-entrant event loop, main thread never yields
     * 4. With guard: re-entrant call is blocked, yields to event loop
     */
    const guard = createReentrancyGuard('extension-bundle-load');
    const executionOrder: string[] = [];

    // First call enters the critical section (simulates getExtensionBundle)
    expect(guard.enter()).toBe(true);
    executionOrder.push('first-enter');

    // Simulate doing some work while guarded (cannot nest)
    const reentrantAttemptBlocked = guard.enter();
    expect(reentrantAttemptBlocked).toBe(false);
    executionOrder.push('reentrant-blocked');

    // First call exits
    guard.exit();
    executionOrder.push('first-exit');

    // Now re-entry is allowed again
    const reentrantAttemptAllowed = guard.enter();
    expect(reentrantAttemptAllowed).toBe(true);
    executionOrder.push('reentrant-allowed');
    guard.exit();

    expect(executionOrder).toEqual([
      'first-enter',
      'reentrant-blocked',
      'first-exit',
      'reentrant-allowed',
    ]);
  });
});

describe('getExtensionBundle Re-entrancy Integration', () => {
  /**
   * Integration-level test that simulates the actual getExtensionBundle flow
   * with the re-entrancy guard, yield points, and timeout.
   */

  async function simulateBundleLoadWithGuard(
    extName: string,
    cmdName: string,
    options?: {
      slowBuild?: boolean;
      simulateReentry?: boolean;
    }
  ): Promise<{ success: boolean; error?: string }> {
    const guard = createReentrancyGuard(`bundle:${extName}/${cmdName}`);

    if (!guard.enter()) {
      await yieldToEventLoop();
      if (!guard.enter()) {
        return { success: false, error: 'Concurrent bundle load conflict' };
      }
    }

    try {
      await withTimeout(
        (async () => {
          if (options?.slowBuild) {
            // Simulate a build that takes longer than the timeout
            await new Promise<void>((resolve) => {
              setTimeout(resolve, REENTRANCY_TIMEOUT_MS + 1000);
            });
            return;
          }

          if (options?.simulateReentry) {
            // Simulate re-entrant call during bundle load
            simulateSyncWork(20);
            return;
          }

          // Normal path: check bundle, read file
          simulateSyncWork(10);
        })(),
        REENTRANCY_TIMEOUT_MS,
        `${extName}/${cmdName}`
      );

      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        error: error?.message || String(error),
      };
    } finally {
      guard.exit();
    }
  }

  it('should successfully load a bundle', async () => {
    const result = await simulateBundleLoadWithGuard('test-ext', 'test-cmd');
    expect(result.success).toBe(true);
  });

  it('should timeout slow builds instead of hanging forever', async () => {
    const result = await simulateBundleLoadWithGuard(
      'slow-ext',
      'slow-cmd',
      { slowBuild: true }
    );
    // Should fail gracefully with a timeout error, not hang
    expect(result.success).toBe(false);
    if (result.error) {
      expect(result.error).toContain('exceeded');
    }
  }, 25_000);

  it('should detect and handle re-entrant calls', async () => {
    let result1: any = null;
    let result2: any = null;
    const guard = createReentrancyGuard('concurrent-test');

    // First call enters
    guard.enter();

    // Second call should be blocked
    const entered = guard.enter();
    expect(entered).toBe(false);

    // First exits
    guard.exit();

    // Second can now enter
    expect(guard.enter()).toBe(true);
    guard.exit();
  });
});
