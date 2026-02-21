# SuperCmd Windows Feature Certification Matrix

Branch scope: `feat/windows-foundation`

Purpose:
- Enumerate every major SuperCmd capability.
- Define what must work on Windows.
- Capture implementation status, dependencies, validation steps, and release criteria.

Status legend:
- `Ready`: implemented in code and has a clear Windows validation path.
- `Needs Validation`: implemented but requires Windows runtime/device verification.
- `Gap`: not yet at parity or requires additional implementation.

---

## 1) Launcher and Core Command System

| Capability | Windows requirement | Implementation path | Status | Validation detail |
|---|---|---|---|---|
| Global launcher hotkey | Toggle launcher reliably from any foreground app | `src/main/main.ts`, `src/main/settings-store.ts` | Needs Validation | Verify open/close from browser, terminal, Office, IDE; verify no stuck focus. |
| Fuzzy command search | Rank by title/keywords/alias/recent/pinned | `src/renderer/src/App.tsx` | Needs Validation | Search with exact, partial, alias, typo-like queries; compare result ordering consistency. |
| Recent commands | Most recently executed commands prioritized | `src/main/settings-store.ts`, `src/renderer/src/App.tsx` | Needs Validation | Execute varied commands; restart app; confirm order persists. |
| Pinned commands | Pinned commands remain promoted | `src/main/settings-store.ts`, `src/renderer/src/App.tsx` | Needs Validation | Pin, reorder, restart, unpin; verify deterministic ordering. |
| Disable commands | Disabled commands hidden and non-runnable | `src/main/main.ts`, `src/renderer/src/settings/ExtensionsTab.tsx` | Needs Validation | Disable app/system/extension commands and verify omission from search and hotkey execution. |
| Per-command hotkeys | Commands launch from global shortcuts | `src/main/main.ts` | Needs Validation | Configure shortcuts for each command category; test conflicts and duplicate prevention. |
| Command aliases | Alias becomes searchable keyword | `src/main/commands.ts`, `src/renderer/src/settings/ExtensionsTab.tsx` | Needs Validation | Add/edit/remove aliases and verify search index updates immediately and after restart. |

---

## 2) Discovery and Indexing (Windows Native)

| Capability | Windows requirement | Implementation path | Status | Validation detail |
|---|---|---|---|---|
| Win32 app discovery | Start Menu `.lnk` apps discoverable and launchable | `discoverWindowsApplications()` in `src/main/commands.ts` | Needs Validation | Verify common apps (Notepad, VS Code, Chrome, system tools). |
| UWP app discovery | Store apps discoverable and launchable | `Get-StartApps` flow in `src/main/commands.ts` | Needs Validation | Validate Calculator/Settings/Xbox/Photos launch flows. |
| Windows settings panels | All `ms-settings:` commands route correctly | `WINDOWS_SETTINGS_PANELS` in `src/main/commands.ts` | Needs Validation | Execute all 37 panel commands and record pass/fail per URI. |
| App/settings icon extraction | Icons render with fallback behavior on failure | `extractWindowsIcons()` in `src/main/commands.ts` | Needs Validation | Confirm icon rendering for mixed Win32/UWP targets and corrupted shortcuts. |

---

## 3) Native SuperCmd System Commands

Source command list defined in `src/main/commands.ts`.

| Command ID | Windows requirement | Implementation path | Status | Validation detail |
|---|---|---|---|---|
| `system-open-settings` | Open settings window | `src/main/main.ts` | Ready | Validate tab state and window lifecycle. |
| `system-open-ai-settings` | Open AI tab directly | `src/main/main.ts` | Ready | Verify direct navigation and persistence writes. |
| `system-open-extensions-settings` | Open extensions tab/store flow | `src/main/main.ts` | Ready | Validate no broken routing from launcher/hotkey. |
| `system-open-onboarding` | Open onboarding mode reliably | `src/main/main.ts`, `src/renderer/src/App.tsx` | Needs Validation | Validate first-run and re-open onboarding sequences. |
| `system-quit-launcher` | Exit cleanly | `src/main/main.ts` | Ready | Verify no orphan process remains. |
| `system-calculator` | Inline math/conversion | `src/renderer/src/smart-calculator.ts` | Needs Validation | Validate arithmetic, units, and copy flow. |
| `system-color-picker` | Return picked color to clipboard | `src/main/platform/windows.ts`, `src/main/main.ts` | Needs Validation | Verify picker cancel/confirm paths and clipboard value format. |
| `system-toggle-dark-mode` | Toggle app/system mode behavior | `src/main/main.ts` | Needs Validation | Validate repeated toggles on Win10/Win11. |
| `system-awake-toggle` | Prevent sleep toggle behavior | `src/main/main.ts` | Needs Validation | Validate active state, toggle off/on, and subtitle updates. |
| `system-hosts-editor` | Open editable hosts flow with elevation | `src/main/main.ts` | Needs Validation | Validate normal user + UAC elevation flow. |
| `system-env-variables` | Open environment variables settings path | `src/main/main.ts` | Needs Validation | Validate across Win10/Win11. |
| `system-shortcut-guide` | Open shortcut guide view | `src/renderer/src/App.tsx` | Ready | Validate view opens/closes and shortcuts display correctly. |

---

## 4) Clipboard, Snippets, and Text Insertion Paths

These are critical because many features depend on shared text insertion behavior.

| Capability | Windows requirement | Implementation path | Status | Validation detail |
|---|---|---|---|---|
| Clipboard history CRUD | Store/search/copy/delete/paste entries | `src/main/main.ts`, `src/main/preload.ts`, clipboard manager modules | Needs Validation | Validate text/html/file entries and persistence across restart. |
| Hide-and-paste pipeline | Paste to previously active app after launcher hides | `hideAndPaste()` in `src/main/main.ts` | Needs Validation | Validate in Notepad, VS Code, browser inputs, Office fields. |
| Direct text typing | Type generated text into focused app | `typeTextDirectly()` in `src/main/main.ts` | Needs Validation | Validate punctuation, braces, multiline behavior. |
| Replace live text | Backspace + replace workflows for whisper/prompt | `replaceTextDirectly()`, `replaceTextViaBackspaceAndPaste()` | Needs Validation | Validate for short/long selections and multiline replacements. |
| Snippet manager CRUD | Create/edit/delete/pin/import/export | `src/main/snippet-store.ts`, `src/renderer/src/SnippetManager.tsx` | Needs Validation | Validate all actions plus restart persistence. |
| Snippet paste action | Insert snippet into active app | `snippet-paste` IPC + shared paste pipeline in `src/main/main.ts` | Needs Validation | Validate plain and dynamic snippet variants. |
| Native snippet keyword expansion | Background keyword detection and in-place expansion | `src/native/snippet-expander-win.c`, `src/main/platform/windows.ts`, `expandSnippetKeywordInPlace()` in `src/main/main.ts` | Needs Validation | Validate delimiter handling, backspace replacement correctness, and non-interference while modifiers are pressed. |

---

## 5) AI, Memory, Whisper, and Speak

| Capability | Windows requirement | Implementation path | Status | Validation detail |
|---|---|---|---|---|
| AI chat stream | Prompt/stream/cancel complete without UI lockups | `src/main/main.ts`, `src/renderer/src/views/AiChatView.tsx` | Needs Validation | Validate provider switching and long-stream interruption. |
| Inline AI prompt | Apply generated text to active app | `system-cursor-prompt`, `prompt-apply-generated-text` in `src/main/main.ts` | Needs Validation | Validate from multiple host apps/editors. |
| Memory add | Add selected text to memory service | `system-add-to-memory` flow in `src/main/main.ts` | Needs Validation | Validate empty-selection errors and success messages. |
| Whisper overlay lifecycle | Start/listen/stop/release reliably | whisper flows in `src/main/main.ts`, `src/renderer/src/SuperCmdWhisper.tsx` | Needs Validation | Validate hotkey open/close race conditions. |
| Hold monitor | Detect hold/release for whisper controls | `hotkey-hold-monitor.exe` via `src/main/platform/windows.ts` | Needs Validation | Validate multiple shortcuts and release reasons. |
| Speak selected text | Read flow start/stop/status sync | `system-supercmd-speak` and speak IPC in `src/main/main.ts` | Needs Validation | Validate stop behavior, focus restoration, and overlay state. |
| Local speech backend | Use supported backend on Windows | `resolveSpeakBackend()` in `src/main/platform/windows.ts` | Needs Validation | Validate `edge-tts` presence/absence behavior. |
| Audio duration probe | Needed for parity metrics | `probeAudioDurationMs()` in `src/main/platform/windows.ts` | Gap | Currently returns `null`; implementable in a follow-up if required. |

---

## 6) Extensions and Raycast Compatibility

| Capability | Windows requirement | Implementation path | Status | Validation detail |
|---|---|---|---|---|
| Extension discovery/indexing | Installed extension commands visible and executable | `src/main/extension-runner.ts` | Needs Validation | Validate command list refresh after install/uninstall. |
| Extension store install/uninstall | End-to-end installation flow | `src/main/main.ts`, `src/renderer/src/settings/StoreTab.tsx` | Needs Validation | Validate fresh install, update, uninstall, reinstall paths. |
| Runtime bundle execution | Extension commands run in renderer runtime | `src/renderer/src/ExtensionView.tsx` | Needs Validation | Validate list/detail/form/grid commands. |
| Raycast API shim | Core APIs behave compatibly | `src/renderer/src/raycast-api/index.tsx` | Needs Validation | Validate representative extensions that use hooks/actions/forms. |
| OAuth callbacks/tokens | Auth flow and token persistence work | OAuth modules in main + renderer | Needs Validation | Validate sign-in, callback, token reuse, logout. |
| Menu bar/tray extras | Extension-driven tray menus work | `menubar-*` IPC in `src/main/main.ts` | Needs Validation | Validate menu updates, click routing, cleanup. |
| Script commands | Parse/execute Raycast-style script metadata | `src/main/script-command-runner.ts` | Needs Validation | Validate inline/fullOutput/no-view modes and arguments. |

---

## 7) Settings, Persistence, and Packaging

| Capability | Windows requirement | Implementation path | Status | Validation detail |
|---|---|---|---|---|
| Settings persistence | All toggles and hotkeys persist on restart | `src/main/settings-store.ts` | Needs Validation | Validate AI, aliases, hotkeys, pinned, disabled commands. |
| Open at login | Startup registration works in packaged app | `src/main/main.ts` | Needs Validation | Validate installer build on real Windows session. |
| Updater flow | Update state, download, install lifecycle works | updater IPC in `src/main/main.ts` | Needs Validation | Validate from packaged release channel only. |
| OAuth token persistence | Separate token store integrity | `src/main/settings-store.ts` + tests | Ready | Existing unit tests pass; still validate Windows file permissions path. |

---

## 8) Windows Build Requirements

| Item | Requirement | Path | Status |
|---|---|---|---|
| Hotkey hold monitor binary | `hotkey-hold-monitor.exe` compiled on Windows | `scripts/build-native.js`, `src/native/hotkey-hold-monitor.c` | Ready |
| Snippet expander binary | `snippet-expander-win.exe` compiled on Windows | `scripts/build-native.js`, `src/native/snippet-expander-win.c` | Ready |
| Speech recognizer binary | `speech-recognizer.exe` compiled with `csc.exe` | `scripts/build-native.js`, `src/native/speech-recognizer.cs` | Ready |
| Native binary packaging | binaries shipped in `dist/native` and unpacked | `package.json` (`asarUnpack`) | Needs Validation |

---

## 9) Release Gate: “Everything Works on Windows”

A Windows release is accepted only when all lines below are completed on at least one Windows 11 machine (and ideally one Windows 10 machine):

1. Pass all rows in sections 1 through 8 with recorded evidence.
2. No blocker failures in clipboard/snippet/typing/replace pipelines.
3. No blocker failures in whisper/speak lifecycle transitions.
4. No blocker failures in extension install/run/oauth/menu-bar flows.
5. Packaged app validation passes for startup and updater behaviors.

Current summary:
- Core Windows paths have been implemented for shared text insertion and snippet keyword expansion.
- Remaining work is runtime certification and any bugfixes found during that pass.

---

## 10) Automated Regression Coverage (Now Enforced)

Automated checks are now documented in `WINDOWS_REGRESSION_TEST_PLAN.md` and runnable via:

- `npm test`
- `npm run test:windows-regression`

Current automated guardrails:

| Area | Test file | What it catches |
|---|---|---|
| Shortcut label platform parity | `src/renderer/src/__tests__/shortcut-format.test.ts` | Prevents regressions where Windows renders macOS key labels (`Cmd`, mac symbols) instead of `Ctrl`/`Del`/`Backspace`. |
| Calculator + unit conversion correctness | `src/renderer/src/__tests__/smart-calculator.test.ts` | Validates arithmetic, conversions, and non-calculation fallback behavior. |
| Snippet import/export pipeline | `src/main/__tests__/snippet-store.test.ts` | Validates export shape, Raycast-style imports (`text`), duplicate skipping, and keyword sanitization. |
