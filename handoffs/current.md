# Current Handoff

## Current Status

Investigating a recurring `EXC_BREAKPOINT`/`SIGTRAP` crash on `CrBrowserMain`
(main process). Confirmed root cause: `file-search-index.ts` rebuilds a
~1.1M-entry home-directory index on an interval, and previously kept the old
snapshot alive while building the new one — a multi-GB spike that blows any
V8 heap ceiling. Fix is written, compiled, and packaged into the latest DMG,
but **not yet confirmed working** — the last test run showed old (pre-fix)
behavior, most likely because a stale process/build was tested rather than
the new one. Branch `feat/fix-review-crash` also now contains two previously
orphaned, unmerged upstream branches (see Decisions).

## Completed Work

- **`lastBuildError` leak** (`extension-runner.ts`): now cleared on successful
  rebuild instead of growing forever.
- **Window-manager worker fixes**: stopped silencing its stdout/stderr
  (`main.ts`), which surfaced the real bug — `extract-file-icon` /
  `node-gyp-build` weren't in `asarUnpack`, so `node-window-manager` failed to
  load in packaged builds (`package.json`).
- **V8 heap ceiling fix, corrected**: first attempt
  (`app.commandLine.appendSwitch('js-flags', ...)`) confirmed NOT to reach the
  main process (only affects Chromium renderer processes). Second attempt
  (`v8.setFlagsFromString`) confirmed ineffective too (heap_size_limit is
  fixed at isolate creation). Working fix: re-exec the process once with
  `--js-flags=--max-old-space-size=4096` on argv (env-marker guarded against
  looping). Verified live: process reports `~4096MB` limit.
- **Diagnostics added** (`SC_HEAP_DEBUG=1` env gate): periodic
  `process.memoryUsage()` log every 5 min, heap snapshot capture via
  `Cmd+Alt+Shift+H` or `SIGUSR2`, written to `/tmp` (not `~/Library/Logs` —
  that directory has repeatedly lost files minutes after being written,
  cause unconfirmed, treat as unreliable for this investigation).
- **Recovered two orphaned upstream branches** (both had open PRs, neither
  merged into `main`, which itself is stalled at `2da7b9e`) and merged both
  into `feat/fix-review-crash`, cleanly, no conflicts:
  - `feat/Fix-shoutdown` (PR #630): LRU-cache extension bundles, stop
    pre-warming window-manager-worker, non-blocking discovery, idle
    transcription server shutdown (+ mid-request-kill bugfix), drain
    in-flight extension/script work before quit (this one has its own ADR
    diagnosing a *different* EXC_BREAKPOINT/SIGTRAP cause — a Node callback
    completing after Electron tears down V8 on quit; not yet confirmed
    whether it's still occurring separately from the FileIndex issue).
  - `feat/feat-confetti` (PR #631): expanded tray menu (Settings, Extension
    Store, Launch at Login, Check for Updates), Confetti/Fireworks/Snow/Rain
    commands, esbuild moved to `optionalDependencies` (fixes `EBADPLATFORM`
    on `npm install` for single-arch Macs).
  - Pushed today's 4 relevant commits (lastBuildError, heap diagnostics,
    window-manager stdio, heap-limit fix) onto `feat/Fix-shoutdown` and to
    origin, updating PR #630 live (11 commits now).
- **`file-search-index.ts` fix** (latest commit, root-cause fix):
  - Old snapshot dropped (`activeIndex = null`) before building the new one,
    instead of after — eliminates the double-memory rebuild spike. Trade-off:
    search returns empty during the rebuild window.
  - `MAX_INDEX_ENTRIES` 1.2M → 400k; `DEFAULT_REFRESH_INTERVAL_MS` 8min →
    60min.
  - Added a manual `system-rebuild-file-index` command
    (`commands.ts`/`executeCommand`) for on-demand refresh.
  - Compiled binary verified to contain `400000` (not `1200000`) — the fix is
    genuinely in the shipped DMG.

## Work In Progress

- **Confirming the FileIndex fix actually resolves the crash.** Last test run
  showed 1.1M entries and sub-60min interval rebuilds — i.e. old behavior —
  strongly suggesting a stale process or pre-fix install was tested, not that
  the fix failed. User was about to redo the test cleanly (kill all
  processes, reinstall from `~/Downloads/SuperCmd-1.0.26-arm64.dmg`, verify
  `grep -ao "400000" .../app.asar` before launching).

## Pending Work

1. Re-verify the FileIndex fix with a clean process + confirmed-current
   build, ideally past the ~48–96min window where every prior crash occurred.
2. If it still crashes: get another `[HeapDebug]`/`[FileIndex]` log + `.ips`
   from `~/Library/Logs/DiagnosticReports/` (read it immediately, it may
   disappear) and check whether the heap trend shows another single big
   jump (another oversized structure) or a slow genuine leak this time.
3. If it holds: consider whether `feat/Fix-shoutdown`'s quit-time race
   condition (drain-before-quit, already merged) is a second, independent,
   much rarer cause — no direct evidence yet that it's firing separately.
4. Two open upstream PRs (#630, #631) are `MERGEABLE` but `BLOCKED` on
   review — no CI configured on this repo, no human reviewer assigned.
   `main` itself has been stalled at `2da7b9e` this whole time; consider
   whether that's expected or itself a process gap worth raising.
5. Optional, not started: `global.gc()` periodic-forcing was proposed as a
   heap mitigation but deferred by user request ("ya veremos") in favor of
   chasing the FileIndex root cause first.

## Blockers

- None technical. Confirmation is blocked only on the user's next test run.

## Decisions

- Bring both orphaned branches into `feat/fix-review-crash` rather than
  leave them stranded or merge straight to `main` (user's call, asked
  explicitly).
- Accept a brief "search returns nothing" window during FileIndex rebuilds
  in exchange for not doubling peak memory (user's call, picked this option
  explicitly over alternatives).
- Diagnostics write to `/tmp`, not `~/Library/Logs` — that directory has
  been unreliable mid-session (files vanishing) independent of anything in
  this codebase; don't rely on it for future debugging in this repo either.

## Risks

- The ~48–96min crash timing has been remarkably consistent across multiple
  different fixes (heap ceiling raised, FileIndex capped) — if the next test
  still crashes around that window, the FileIndex theory may be wrong or
  incomplete, and the quit-time-race theory (already fixed via
  drain-before-quit) or a third, unfound cause should be considered before
  assuming "still the same bug."
- `git log --oneline` output was momentarily misleading mid-session (looked
  stale after a `cherry-pick --abort`) — cross-checked via `rev-parse`/
  `cat-file` and it was fine, but worth using low-level plumbing commands to
  double check if branch state ever looks wrong again in this repo.
- Multiple stale/orphaned SuperCmd processes have repeatedly confused test
  results this session (old tray menu, "app still runs after deleting it",
  and likely the last FileIndex test). Always confirm zero running processes
  and verify the installed binary's content (e.g. `grep -ao` a known string)
  before trusting a test result in this project going forward.

## Next Actions

- Wait for user's clean re-test of the FileIndex fix.
- Depending on result, either close out the crash investigation or resume
  hunting (see Pending Work #2–3).

## References

- Crash reports (may vanish from disk, read immediately if consulted):
  `~/Library/Logs/DiagnosticReports/SuperCmd-2026-07-{17,20,21}-*.ips`
- `src/main/file-search-index.ts`, `src/main/extension-runner.ts`,
  `src/main/main.ts`, `src/main/commands.ts`
- Upstream: `SuperCmdLabs/SuperCmd` PR #630, PR #631
- ADR (via `codebase-memory-mcp`, project
  `Users-cgomez-orca-workspaces-SuperCmd-Fix-shoutdown`): quit-time-race
  diagnosis for the drain-before-quit fix
- Local DMG builds: `~/Downloads/SuperCmd-1.0.26-arm64.dmg` (rebuilt several
  times today — always verify MD5/content before trusting a test against it)
