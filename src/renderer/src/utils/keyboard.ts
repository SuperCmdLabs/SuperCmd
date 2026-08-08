// Pure predicates for keyboard-event handling shared across the launcher
// (search input, snippet manager, …). Intentionally dependency-free so it can
// be exercised directly by `scripts/test-ime-composition.mjs` via
// `scripts/lib/ts-import.mjs` (esbuild transpile, no relative imports).

/**
 * Returns `true` when a keydown/keyup event is fired while a CJK
 * (Japanese / Chinese / Korean) Input Method Editor composition is in
 * progress.
 *
 * The DOM signals this two ways, depending on the engine:
 *   1. `KeyboardEvent.isComposing === true` — the modern, correct signal.
 *   2. `keyCode === 229` — the legacy value Chromium/IE emit for the key that
 *      confirms/inserts an IME candidate before the composed text is committed.
 *
 * The Enter that *confirms* a kana-kanji / pinyin candidate therefore arrives
 * looking like a normal Enter (`key === 'Enter'`, `keyCode === 13`) but with
 * `isComposing === true` (or as `keyCode === 229` on older engines). Without a
 * guard it is misread as a "submit" and closes / runs the launcher
 * mid-composition. Callers should `return` early when this returns `true`.
 *
 * @param nativeEvent The native `KeyboardEvent` (e.g. `e.nativeEvent`). Only
 *   its `isComposing` flag is read, so a structural subset is accepted and
 *   `null`/`undefined` are tolerated.
 * @param keyCode The legacy `keyCode` of the event (e.g. `e.keyCode`).
 */
export function isImeComposing(
  nativeEvent: { isComposing?: boolean } | null | undefined,
  keyCode?: number,
): boolean {
  if (nativeEvent?.isComposing) return true;
  return keyCode === 229;
}
