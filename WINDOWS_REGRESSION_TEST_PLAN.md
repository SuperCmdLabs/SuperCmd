# Windows Regression Test Plan

Branch scope: `feat/windows-foundation`

## Goal

Catch Windows regressions early for:
- Shortcut labels and key behavior (`Ctrl` vs `Cmd`).
- Snippet import/export/copy/paste flows.
- Clipboard/snippet text insertion pipelines.
- Calculator and unit conversion behavior.
- Launcher search, command execution, and system commands.

## Test Layers

1. Unit tests (fast, CI-safe)
- Validate pure logic and formatting behavior.
- Run on every commit.

2. Integration smoke tests (app-level behavior without full desktop automation)
- Validate snippet persistence/import/export logic.
- Run on every PR.

3. Windows runtime certification (manual, native desktop)
- Validate global hotkeys, focus transitions, foreground app paste, dialogs, native binaries.
- Required before release.

## Automated Suite

Run:

```bash
npm test
npm run test:windows-regression
npm run test:e2e:windows
```

If Playwright is not installed yet in your environment:

```bash
npm install -D @playwright/test playwright
npx playwright install
```

Coverage currently automated:
- `src/renderer/src/__tests__/shortcut-format.test.ts`
  - Verifies `Cmd`-style accelerators render as `Ctrl`/`Del`/`Backspace` on Windows.
  - Verifies macOS symbol rendering stays intact.
- `src/renderer/src/__tests__/smart-calculator.test.ts`
  - Verifies arithmetic, unit conversion, temperature conversion, and non-math fallback.
- `src/main/__tests__/snippet-store.test.ts`
  - Verifies snippet export JSON shape.
  - Verifies Raycast-style import (`text` field) support.
  - Verifies duplicate detection and keyword sanitization.
- `e2e/windows/launcher-shortcuts.spec.ts`
  - Launches the Electron app and validates Windows `Ctrl` shortcut rendering in launcher/actions surfaces.
  - Validates `Ctrl+K` opens the actions overlay and exposes core action rows.

## Manual Windows Certification

Environment:
- Windows 11 (required), Windows 10 (recommended).
- One packaged build (`npm run package`) and one dev build.

Runbook:

1. Launcher and Search
- Open launcher from 3+ host apps (browser, terminal, editor).
- Verify close/open cycles are stable.
- Search by title, alias, pinned, recent.
- Confirm action footer shows `Ctrl` shortcuts (not `Cmd`).

2. Snippets
- Create snippet with keyword and dynamic placeholder.
- Copy to clipboard flow.
- Paste into Notepad and VS Code.
- Export snippets and confirm file picker appears in front.
- Delete snippet, import exported file, verify imported/skipped counts.
- Re-import same file and confirm dedupe behavior.

3. Clipboard History
- Copy 5+ entries from different apps.
- Search entries and paste selected item.
- Delete one item and clear all.
- Restart app and confirm persistence behavior.

4. Text Insertion Pipelines
- `hideAndPaste` into browser input, Notepad, Office app.
- Verify punctuation, multiline content, and braces.
- Verify no focus-lock or missed paste after launcher hides.

5. Calculator and Conversions
- Arithmetic (`2+2`, `144/12`).
- Unit (`10 cm to in`, `5 km to mi`).
- Temperature (`100 c to f`).
- Verify result copy behavior from launcher.

6. App/System Commands
- Open common Win32 apps and UWP apps.
- Run all Windows settings commands used by SuperCmd (`ms-settings:` entries).
- Verify icons render or gracefully fall back.

7. Extensions / AI / Whisper / Speak
- Install one extension, run command, uninstall.
- Validate AI chat request/stream/cancel.
- Validate whisper hotkey press/hold/release lifecycle.
- Validate speak start/stop and focus return.

8. Packaging and Startup
- Install packaged app.
- Validate open-at-login.
- Validate updater status display path.

## Release Gate

A Windows release is allowed only if:
- All automated tests pass.
- No blocker failures in snippet/clipboard/paste pipelines.
- No blocker failures in launcher hotkeys/shortcuts/focus behavior.
- Manual Windows certification checklist is completed and recorded.
