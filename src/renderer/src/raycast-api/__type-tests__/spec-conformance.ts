/**
 * spec-conformance.ts — type-level parity check between our shim and
 * the official `@raycast/api` types.
 *
 * Companion to `scripts/raycast-parity-check.mjs` (which does a runtime
 * symbol diff + writes `docs/raycast-parity.md`). This file's job is
 * compile-time:
 *
 *   1. Surface the list of missing/extra top-level exports as type
 *      aliases that an IDE can hover. Read these to know what's left.
 *   2. Per-namespace member-key diffs for the big public APIs.
 *   3. (Eventual goal) Fail `tsc` when shim drifts from spec.
 *
 * Today the assertions at the bottom are deliberately non-strict — the
 * shim is mid-parity, and we don't want CI red until the work is done.
 * When the parity push wraps (Wave 3.3 in the plan), flip the
 * `STRICT_MODE` block to active. Until then, the diagnostic types here
 * just *describe* the gap surface; the actual gate is the parity script.
 *
 * IMPORTANT: this file is a `.ts` type-only file. It must not import
 * from anything that has runtime side-effects on import — the shim's
 * `index.tsx` does have side-effects (registers event listeners,
 * configures runtime singletons), so we use `typeof import(...)` to
 * extract its module type without executing it.
 */

import type * as Spec from '@raycast/api';

// `typeof import(...)` resolves the shim's module type without an
// actual runtime import — important because index.tsx has top-level
// side-effects (window listeners, runtime config) that we don't want
// running during type-checking.
type Shim = typeof import('../index');

// =====================================================================
// Top-level export parity
// =====================================================================

type SpecKeys = keyof typeof Spec;
type ShimKeys = keyof Shim;

/**
 * Top-level spec exports that don't exist in the shim.
 * Hover this type in an IDE to see the current gap list.
 *
 * As parity streams close gaps, this should shrink toward `never`.
 */
export type MissingTopLevel = Exclude<SpecKeys, ShimKeys>;

/**
 * Top-level shim exports that aren't in the spec — internal helpers
 * we expose intentionally (e.g. `setExtensionContext`, `renderIcon`,
 * `getFormValues`). Informational; not a parity gap.
 */
export type ExtraTopLevel = Exclude<ShimKeys, SpecKeys>;

// =====================================================================
// Per-namespace member parity
// =====================================================================
//
// For symbols that are simultaneously a runtime value AND a namespace
// (e.g. `Action`, `Form`, `List`, `OAuth`, `Cache`), the spec exposes
// members through both the value's type AND the namespace block. Use
// `keyof typeof Spec.X` to pick up runtime members; `keyof Spec.X` for
// namespace-block members.
//
// Some shim symbols attach static members at runtime (Object.assign or
// `attachX(Component)`) without surfacing them at the type level. The
// runtime parity script (`raycast-parity-check.mjs`) is the source of
// truth for those — the type-level diff here is best-effort.

// Convenience: keys present at the value level (covers FunctionComponent
// + intersected statics where typed correctly).
type ValueKeys<T> = T extends object ? keyof T : never;

export type MissingActionMembers = Exclude<ValueKeys<typeof Spec.Action>, ValueKeys<Shim['Action']>>;
export type MissingActionPanelMembers = Exclude<ValueKeys<typeof Spec.ActionPanel>, ValueKeys<Shim['ActionPanel']>>;
export type MissingFormMembers = Exclude<ValueKeys<typeof Spec.Form>, ValueKeys<Shim['Form']>>;
export type MissingListMembers = Exclude<ValueKeys<typeof Spec.List>, ValueKeys<Shim['List']>>;
export type MissingGridMembers = Exclude<ValueKeys<typeof Spec.Grid>, ValueKeys<Shim['Grid']>>;
export type MissingDetailMembers = Exclude<ValueKeys<typeof Spec.Detail>, ValueKeys<Shim['Detail']>>;
export type MissingMenuBarExtraMembers = Exclude<ValueKeys<typeof Spec.MenuBarExtra>, ValueKeys<Shim['MenuBarExtra']>>;
export type MissingAIMembers = Exclude<ValueKeys<typeof Spec.AI>, ValueKeys<Shim['AI']>>;
export type MissingCacheMembers = Exclude<ValueKeys<typeof Spec.Cache>, ValueKeys<Shim['Cache']>>;
export type MissingClipboardMembers = Exclude<ValueKeys<typeof Spec.Clipboard>, ValueKeys<Shim['Clipboard']>>;
export type MissingLocalStorageMembers = Exclude<ValueKeys<typeof Spec.LocalStorage>, ValueKeys<Shim['LocalStorage']>>;
export type MissingToastMembers = Exclude<ValueKeys<typeof Spec.Toast>, ValueKeys<Shim['Toast']>>;
export type MissingColorMembers = Exclude<ValueKeys<typeof Spec.Color>, ValueKeys<Shim['Color']>>;
export type MissingImageMembers = Exclude<ValueKeys<typeof Spec.Image>, ValueKeys<Shim['Image']>>;
export type MissingKeyboardMembers = Exclude<ValueKeys<typeof Spec.Keyboard>, ValueKeys<Shim['Keyboard']>>;
export type MissingIconMembers = Exclude<ValueKeys<typeof Spec.Icon>, ValueKeys<Shim['Icon']>>;
export type MissingOAuthMembers = Exclude<ValueKeys<typeof Spec.OAuth>, ValueKeys<Shim['OAuth']>>;
// `Tool`, `WindowManagement`, `BrowserExtension`, `Alert`, `environment`
// are namespaces / interfaces / object shapes that don't always have a
// matching runtime keyof. Add explicit checks here as those streams land.

// =====================================================================
// STRICT_MODE — flip these on after Wave 3.3 (final parity sweep).
// =====================================================================
// Until parity is complete, leaving these uncommented would break the
// build because the shim has known gaps. The parity script in CI is the
// active enforcement. Once `npm run parity:check` exits clean,
// uncomment the block below to also enforce at compile time so any
// future drift fails `tsc`.
//
// // @ts-expect-error — replace with: const _topLevel: never = null as any as MissingTopLevel;
// declare const _strictTopLevel: never;
// const _topLevel: typeof _strictTopLevel = null as any as MissingTopLevel;
//
// const _action:        never = null as any as MissingActionMembers;
// const _actionPanel:   never = null as any as MissingActionPanelMembers;
// const _form:          never = null as any as MissingFormMembers;
// const _list:          never = null as any as MissingListMembers;
// const _grid:          never = null as any as MissingGridMembers;
// const _detail:        never = null as any as MissingDetailMembers;
// const _menubar:       never = null as any as MissingMenuBarExtraMembers;
// const _ai:            never = null as any as MissingAIMembers;
// const _cache:         never = null as any as MissingCacheMembers;
// const _clipboard:     never = null as any as MissingClipboardMembers;
// const _localStorage:  never = null as any as MissingLocalStorageMembers;
// const _toast:         never = null as any as MissingToastMembers;
// const _color:         never = null as any as MissingColorMembers;
// const _image:         never = null as any as MissingImageMembers;
// const _keyboard:      never = null as any as MissingKeyboardMembers;
// const _icon:          never = null as any as MissingIconMembers;
// const _oauth:         never = null as any as MissingOAuthMembers;
