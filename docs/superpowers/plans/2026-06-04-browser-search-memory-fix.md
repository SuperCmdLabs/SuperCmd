# Browser-Search Memory Regression Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut renderer retained heap from ~90 MB back to v24-baseline (~45 MB) when browser search is disabled, and ~55 MB when enabled, without changing any user-visible behavior.

**Architecture:** Two-renderer-file change. (1) Gate all data loading and indexing in `useBrowserSearch` / `useWebSearchController` behind the `browserSearch.enabled` setting and a new `settingsLoaded` flag, clearing module-level caches on disable. (2) Diet the v25 in-memory index: drop the four prefix/contains Maps inside `buildBrowserEntryIndex` (we already do a linear `searchBlob.includes(token)` check downstream — the Maps were redundant), slim `BrowserEntrySearchIndex` to the three fields that are actually hot per-entry, and LRU-cap the per-entry cache at 2,000 entries. (3) Normalize the 13,520-entry DDG bangs catalog once at the IPC boundary and stop spread-copying it inside the `effectiveSearchBangs` memo, so only one shape lives in renderer memory.

**Tech Stack:** TypeScript, React hooks, Electron renderer process, esbuild bundler. No new dependencies. No new test framework — this project verifies renderer changes via `tsc --noEmit` + manual run + heap snapshots.

**Design spec:** `/Users/shobhit/.claude/plans/here-s-the-difference-between-memoized-otter.md`

**Background commit causing the regression:** `8992618a` ("feat: combine browser and root search improvements (#434)"). Reference only — do not revert.

---

## File structure

| File | Responsibility | Change scope |
|---|---|---|
| `src/renderer/src/hooks/useBrowserSearch.ts` | Browser-search data hook: loads entries/tabs from main, builds index, exposes ranked results to App. Owns module-level `browserEntrySearchIndexCache`. | Tasks 1, 3, 4, 5 |
| `src/renderer/src/hooks/useWebSearchController.ts` | Web-search hook: loads bangs catalog via IPC, runs bang parsing, builds web-search result rows. | Tasks 2, 6 |
| `src/renderer/src/App.tsx` | Composes both hooks; passes `browserSearchEnabled` between them. | Task 2 only |

No changes elsewhere. No IPC contract changes. No main-process changes. No type changes leak outside the two hooks (all relevant types are internal to `useBrowserSearch.ts`).

---

## Task 1: Gate entries/tabs/index on `browserSearch.enabled` + `settingsLoaded`

**Files:**
- Modify: `src/renderer/src/hooks/useBrowserSearch.ts:96-215` (state declarations, mount-time effects, `useMemo` for index)
- Modify: `src/renderer/src/hooks/useBrowserSearch.ts:640-731` (add `EMPTY_BROWSER_ENTRY_INDEX` sentinel)

Why: today `refreshEntries()` and `refreshTabs()` fire on mount regardless of `enabled`. The IPC call returns ~3.8 MB of history JSON; the resulting `useMemo` then builds the index for all 8,515 entries even when the user has the master toggle off.

- [ ] **Step 1: Declare `EMPTY_BROWSER_ENTRY_INDEX` at module scope**

Edit `src/renderer/src/hooks/useBrowserSearch.ts` immediately after the `type BrowserEntryIndex = { ... };` block (currently ending at line 661):

```ts
const EMPTY_BROWSER_ENTRY_INDEX: BrowserEntryIndex = {
  historyPrefixToEntryIds: new Map(),
  bookmarkPrefixToEntryIds: new Map(),
  historyContainsToEntryIds: new Map(),
  bookmarkContainsToEntryIds: new Map(),
  historyByTimeEntryIds: [],
  bookmarksByBrowserOrderEntryIds: [],
  profileCountsByKind: { history: new Map(), bookmark: new Map() },
};
```

(After Task 3 lands, the prefix/contains Map fields will be removed from the type — update this sentinel to match.)

- [ ] **Step 2: Add `settingsLoaded` state**

Inside `useBrowserSearch`, add this state next to the existing `useState` declarations (around line 99):

```ts
const [settingsLoaded, setSettingsLoaded] = useState<boolean>(false);
```

- [ ] **Step 3: Set `settingsLoaded = true` after settings load**

Modify both settings-load effects to flip the flag.

In the mount-time settings effect (currently lines 169-184), add `setSettingsLoaded(true);` immediately after the existing `setProfileFilters(...)` line:

```ts
useEffect(() => {
  let disposed = false;
  window.electron.getSettings()
    .then((s) => {
      if (disposed) return;
      setEnabled(s?.browserSearch?.enabled ?? true);
      setAlphaChromiumRootSearchEnabled(Boolean(s?.browserSearch?.alphaChromiumRootSearchEnabled));
      setNicknames(Array.isArray(s?.browserSearch?.nicknames) ? s.browserSearch.nicknames : []);
      setProfiles(normalizeBrowserProfiles(s?.browserSearch?.profiles));
      setProfileFilters(s?.browserSearch?.profileFilters || {});
      setSettingsLoaded(true);
    })
    .catch(() => {
      setSettingsLoaded(true);
    });
  return () => {
    disposed = true;
  };
}, []);
```

(The `catch` branch must also set `settingsLoaded = true` — otherwise an IPC failure permanently disables loading.)

The `onSettingsUpdated` effect (lines 186-195) does NOT need to flip the flag — `settingsLoaded` is one-way.

- [ ] **Step 4: Gate the entries effect on `settingsLoaded && enabled`**

Replace the entire entries effect (currently lines 207-215):

```ts
useEffect(() => {
  if (!settingsLoaded) return;
  if (!enabled) {
    setEntries([]);
    entriesRevisionRef.current = null;
    browserEntrySearchIndexCache.clear();
    return;
  }
  refreshEntries();
  const unsubscribe = window.electron.onBrowserSearchHistoryChanged?.(() => refreshEntriesIfStale());
  return () => {
    try {
      unsubscribe?.();
    } catch {}
  };
}, [settingsLoaded, enabled, refreshEntries, refreshEntriesIfStale]);
```

- [ ] **Step 5: Gate the tabs effect on `settingsLoaded && enabled && alphaChromiumRootSearchEnabled`**

Replace the entire tabs effect (currently lines 197-205):

```ts
useEffect(() => {
  if (!settingsLoaded) return;
  if (!enabled || !alphaChromiumRootSearchEnabled) {
    setTabs([]);
    return;
  }
  refreshTabs();
  const unsubscribeTabs = window.electron.onBrowserTabsChanged?.(() => refreshTabs());
  return () => {
    try {
      unsubscribeTabs?.();
    } catch {}
  };
}, [settingsLoaded, enabled, alphaChromiumRootSearchEnabled, refreshTabs]);
```

- [ ] **Step 6: Short-circuit the index `useMemo` on `!enabled`**

Replace line 116:

```ts
entryIndexRef.current = useMemo(
  () => (enabled ? buildBrowserEntryIndex(entries) : EMPTY_BROWSER_ENTRY_INDEX),
  [enabled, entries]
);
```

- [ ] **Step 7: Type-check**

Run from the repo root:

```bash
npx tsc --noEmit -p tsconfig.renderer.json
```

Expected: clean (no new errors). If errors fire about `BrowserEntryIndex` field mismatches with `EMPTY_BROWSER_ENTRY_INDEX`, you're seeing the Task 3 / Task 1 ordering effect — that's fine, just keep the sentinel matching the current type until Task 3 prunes the fields.

- [ ] **Step 8: Manual smoke test**

```bash
npm run build:main && npm run dev
```

Open Settings → Advanced → Browser Search and toggle the master switch off. Re-open the launcher, type a few keys. Expected: no browser-search results, no history-suggested URLs, no autocomplete from history. Toggle back on, results return after a brief re-load.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/hooks/useBrowserSearch.ts
git commit -m "fix(launcher): skip browser-search loading and indexing when disabled

Gate refreshEntries/refreshTabs/index build on settingsLoaded + enabled.
Clears state and the module-level search-index cache when transitioning
to disabled. Re-enabling triggers the existing reload path."
```

---

## Task 2: Gate bangs IPC load on `browserSearchEnabled` in `useWebSearchController`

**Files:**
- Modify: `src/renderer/src/hooks/useWebSearchController.ts:55-64` (options bag type)
- Modify: `src/renderer/src/hooks/useWebSearchController.ts:497-525` (bangs IPC effect)
- Modify: `src/renderer/src/App.tsx:433-442` (pass `browserSearchEnabled` into the hook)

Why: the bangs IPC currently fires on mount regardless of any toggle and stores 13,520 entries in state. With master toggle off they should never arrive in the renderer.

- [ ] **Step 1: Add `browserSearchEnabled` to options type**

Edit `src/renderer/src/hooks/useWebSearchController.ts` lines 42-53. Insert into the `UseWebSearchControllerOptions` type:

```ts
type UseWebSearchControllerOptions = {
  launcherInputRef: React.RefObject<HTMLInputElement>;
  expandLauncherForDirectLaunch: () => void;
  submitBrowserSearchRef: React.MutableRefObject<
    (query: string, options?: { focusExistingTab?: boolean }) => void | Promise<boolean>
  >;
  setLauncherSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  setLauncherSelectedIndex: React.Dispatch<React.SetStateAction<number>>;
  rootSearchQuery: string;
  aiMode: boolean;
  t: (key: string, params?: Record<string, string | number>) => string;
  browserSearchEnabled: boolean;
};
```

Add `browserSearchEnabled` to the destructured params at lines 55-64.

- [ ] **Step 2: Gate the bangs effect**

Replace the effect at lines 497-525:

```ts
useEffect(() => {
  if (!browserSearchEnabled) {
    setWebSearchBangCatalog([]);
    return;
  }
  let cancelled = false;
  window.electron.webSearchListBangs?.()
    .then((entries: WebSearchBangEntry[]) => {
      if (cancelled || !Array.isArray(entries)) return;
      const next = entries
        .map((entry): SearchBangDefinition | null => {
          const key = String(entry?.key || '').trim().toLowerCase().replace(/^!+/, '');
          if (!key) return null;
          return {
            key,
            aliases: Array.isArray(entry.aliases) ? entry.aliases : [],
            name: String(entry.name || key),
            host: String(entry.host || 'duckduckgo.com'),
            category: entry.category,
            subcategory: entry.subcategory,
            template: String(entry.urlTemplate || 'https://duckduckgo.com/?q=!{bang}%20{query}'),
            source: entry.source || 'duckduckgo',
            rankHint: entry.rankHint,
          };
        })
        .filter((entry): entry is SearchBangDefinition => Boolean(entry));
      setWebSearchBangCatalog(next);
    })
    .catch(() => {});
  return () => {
    cancelled = true;
  };
}, [browserSearchEnabled]);
```

(Task 6 replaces the body further — for now we only add the gate.)

- [ ] **Step 3: Wire `browserSearchEnabled` through `App.tsx`**

Find the `useWebSearchController` call (currently App.tsx:433-442). Add the new option, sourced from the already-exposed `browserSearch.enabled`:

```tsx
} = useWebSearchController({
  launcherInputRef: inputRef,
  expandLauncherForDirectLaunch,
  submitBrowserSearchRef,
  setLauncherSearchQuery: setSearchQuery,
  setLauncherSelectedIndex: setSelectedIndex,
  rootSearchQuery: deferredSearchQuery,
  aiMode,
  t,
  browserSearchEnabled: browserSearch.enabled,
});
```

`browserSearch` is the result of `useBrowserSearch` at App.tsx:163, which already exposes `enabled`.

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit -p tsconfig.renderer.json
```

Expected: clean.

- [ ] **Step 5: Manual smoke test**

Run the app. With browser search disabled, type `!g foo` into the launcher — expected: launcher treats it as plain text, NOT as a bang. Toggle browser search on, retry `!g foo` — expected: Google bang results appear.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/hooks/useWebSearchController.ts src/renderer/src/App.tsx
git commit -m "fix(launcher): skip web-search bangs load when browser search disabled

Plumb browserSearch.enabled through useWebSearchController and bail
out of the bangs IPC effect when disabled. Clears webSearchBangCatalog
on disable so the 13,520-entry catalog is not held in renderer state."
```

---

## Task 3: Drop the 4 prefix/contains Maps inside `buildBrowserEntryIndex`

**Files:**
- Modify: `src/renderer/src/hooks/useBrowserSearch.ts:650-661` (`BrowserEntryIndex` type)
- Modify: `src/renderer/src/hooks/useBrowserSearch.ts:663-730` (constants + `buildBrowserEntryIndex`)
- Modify: `src/renderer/src/hooks/useBrowserSearch.ts:746-808` (helper functions to delete)
- Modify: `src/renderer/src/hooks/useBrowserSearch.ts:935-957` (`buildBrowserCandidates`)
- Modify: `src/renderer/src/hooks/useBrowserSearch.ts:959-1112` (`getBrowserEntryCandidates` — collapse `candidateEntryIds` branch)
- Modify: `src/renderer/src/hooks/useBrowserSearch.ts:640-661` (update `EMPTY_BROWSER_ENTRY_INDEX` sentinel from Task 1 to match)

Why: these four Maps + their entry-id arrays account for ~22 MB of retained heap. The per-entry inner loop already does an O(N) `index.searchBlob.includes(token)` check (line 1047 today) — the precomputed prefix Maps were duplicating that work upfront. Removing them shifts ~22 MB out of memory at the cost of one extra O(8500) linear pass per keystroke, which is sub-5 ms on M-series hardware.

- [ ] **Step 1: Slim the `BrowserEntryIndex` type**

Replace the type at lines 650-661 with:

```ts
type BrowserEntryIndex = {
  historyByTimeEntryIds: number[];
  bookmarksByBrowserOrderEntryIds: number[];
  profileCountsByKind: {
    history: Map<string, number>;
    bookmark: Map<string, number>;
  };
};
```

- [ ] **Step 2: Update `EMPTY_BROWSER_ENTRY_INDEX`**

Update the sentinel declared in Task 1 to match the slimmer type:

```ts
const EMPTY_BROWSER_ENTRY_INDEX: BrowserEntryIndex = {
  historyByTimeEntryIds: [],
  bookmarksByBrowserOrderEntryIds: [],
  profileCountsByKind: { history: new Map(), bookmark: new Map() },
};
```

- [ ] **Step 3: Remove the `BROWSER_ENTRY_INDEX_MAX_PREFIX_LENGTH` constant**

Delete the line:

```ts
const BROWSER_ENTRY_INDEX_MAX_PREFIX_LENGTH = 24;
```

(Currently line 663.) `BROWSER_ENTRY_INDEX_MAX_TOKEN_LENGTH` and `BROWSER_ENTRY_INDEX_MAX_URL_CHARS` are still used elsewhere — keep them.

- [ ] **Step 4: Rewrite `buildBrowserEntryIndex`**

Replace the entire function (currently lines 668-730) with:

```ts
function buildBrowserEntryIndex(entries: BrowserSearchEntry[]): BrowserEntryIndex {
  const historyByTimeEntryIds: number[] = [];
  const bookmarksByBrowserOrderEntryIds: number[] = [];
  const historyProfileCounts = new Map<string, number>();
  const bookmarkProfileCounts = new Map<string, number>();
  entries.forEach((entry, entryId) => {
    if (entry.type !== 'url' && entry.type !== 'bookmark') return;
    if (entry.type === 'url') {
      historyByTimeEntryIds.push(entryId);
      if (entry.sourceProfileId) {
        const key = getEntryProfileKey(entry);
        historyProfileCounts.set(key, (historyProfileCounts.get(key) || 0) + 1);
      }
    } else {
      bookmarksByBrowserOrderEntryIds.push(entryId);
      if (entry.sourceProfileId) {
        const key = getEntryProfileKey(entry);
        bookmarkProfileCounts.set(key, (bookmarkProfileCounts.get(key) || 0) + 1);
      }
    }
  });
  historyByTimeEntryIds.sort((a, b) => compareHistoryEntriesByTime(entries[a], entries[b]));
  bookmarksByBrowserOrderEntryIds.sort((a, b) => compareBookmarkEntriesByBrowserOrder(entries[a], entries[b]));
  return {
    historyByTimeEntryIds,
    bookmarksByBrowserOrderEntryIds,
    profileCountsByKind: {
      history: historyProfileCounts,
      bookmark: bookmarkProfileCounts,
    },
  };
}
```

- [ ] **Step 5: Delete dead helpers**

Delete the following functions in their entirety (currently between lines ~746-808):

- `addBrowserEntryIndexValue` (currently ~746-753) — was only used inside the deleted prefix-fill loop.
- `resolveBrowserEntryCandidateIds` (currently ~755-775) — caller becomes a no-op (Step 6).
- `unionSortedBrowserEntryIds` (currently ~777-793) — only used by `resolveBrowserEntryCandidateIds`.
- `intersectBrowserEntryIdLists` (currently ~795-808) — only used by `resolveBrowserEntryCandidateIds`.

- [ ] **Step 6: Collapse `buildBrowserCandidates` to a single path**

Replace the function at lines 935-957 with:

```ts
function buildBrowserCandidates(
  input: string,
  entries: BrowserSearchEntry[],
  entryIndex: BrowserEntryIndex | null,
  tabs: BrowserTabEntry[],
  nicknames: BrowserSearchNicknameSetting[],
  options: { limitPerKind?: number } = {}
): Record<BrowserSearchResultKind, BrowserSearchResult[]> {
  const openTabs = getOpenTabCandidates(input, tabs);
  void entryIndex; // entryIndex no longer used for candidate filtering; kept for signature symmetry with callers.
  return {
    'open-tab': openTabs,
    bookmark: getBrowserEntryCandidates('bookmark', input, entries, {
      nicknames,
      limit: options.limitPerKind,
    }),
    history: getBrowserEntryCandidates('history', input, entries, {
      limit: options.limitPerKind,
    }),
  };
}
```

(The `void entryIndex;` line is a one-line suppression — `entryIndex` is still passed by callers for the `historyByTimeEntryIds`/`bookmarksByBrowserOrderEntryIds` and `profileCountsByKind` data, which is consumed via the other paths in this file. If TypeScript flags the parameter as unused after this change, just drop it — but several callers pass it, so leaving the parameter avoids a wider rewrite.)

- [ ] **Step 7: Remove `candidateEntryIds` plumbing from `getBrowserEntryCandidates`**

In `getBrowserEntryCandidates` (lines 959-1112), do these edits:

a) Remove `candidateEntryIds?: number[] | null;` from the options type at line 971.

b) Remove the early-return block that branches on `options.candidateEntryIds` for the empty-query case. Currently lines 984-1025 (`if (!hasQuery && options.limit && options.limit > 0 && options.candidateEntryIds) { ... }`) — this branch existed only as a fast path through the precomputed history-by-time array. Replace it with a path that uses `historyByTimeEntryIds` / `bookmarksByBrowserOrderEntryIds` directly via a new `options.preferredEntryIds` argument supplied by the no-query callsites below.

Concretely, change the options type to add:

```ts
preferredEntryIds?: number[] | null;
```

…and change the empty-query block to:

```ts
if (!hasQuery && options.limit && options.limit > 0 && options.preferredEntryIds) {
  for (const entryId of options.preferredEntryIds) {
    const entry = entries[entryId];
    if (!entry) continue;
    if (entry.type !== entryType) continue;
    if (kind === 'history' && profileFilter && !profileFilter.has(getEntryProfileKey(entry))) continue;
    const index = getBrowserEntrySearchIndex(entry);
    const savedNickname = kind === 'bookmark'
      ? findBookmarkNickname(entry, options.nicknames || [])
      : '';
    const freshnessFactor = kind === 'history' ? getHistoryFreshnessFactor(entry.lastUsedAt) : 1;
    results.push({
      id: `browser-result-${kind}:${entry.id}`,
      kind,
      title: entry.query || entry.host || entry.url,
      subtitle: options.includeHistoryTimestamp && kind === 'history'
        ? buildHistorySubtitle(entry, Boolean(options.showHistoryProfileContext))
        : buildBrowserSubtitle(entry.sourceProfileName || '', '', entry.host),
      url: entry.url,
      actionInput: entry.url,
      focusAvailable: false,
      faviconUrl: index.faviconUrl,
      source: entry.source,
      sourceProfileId: entry.sourceProfileId ? getEntryProfileKey(entry) : undefined,
      browserName: index.browserLabel,
      profileName: entry.sourceProfileName || entry.sourceProfileId,
      bookmarkFolder: entry.bookmarkFolder,
      bookmarkOrder: entry.bookmarkOrder,
      lastUsedAt: entry.lastUsedAt,
      score: kind === 'history'
        ? freshnessFactor * 650 + getHistoryFrequencyScore(entry.useCount, freshnessFactor)
        : 250,
      completion: '',
      nickname: savedNickname,
      nicknameMatch: false,
      matchKind: 'subsequence',
      rawMatchScore: 0,
    });
    if (results.length >= options.limit) break;
  }
  return results;
}
```

c) In the same function, the `const candidateEntries = options.candidateEntryIds ? options.candidateEntryIds.map(...) : entries;` line (~1026-1028) becomes just:

```ts
const candidateEntries = entries;
```

- [ ] **Step 8: Wire `preferredEntryIds` from `getBookmarkResults` / `getHistoryResults`**

These hook-returned helpers already had access to the empty-query fast-path via `candidateEntryIds`. Find them in `useBrowserSearch.ts` (around lines 335-360):

```ts
const getBookmarkResults = useCallback((rawInput: string, limit = MAX_SCOPED_BOOKMARK_RESULTS): BrowserSearchResult[] => {
  const index = entryIndexRef.current;
  return filterBrowserResultsForKind('bookmark', decorateBrowserResults(getBrowserEntryCandidates('bookmark', rawInput, entriesRef.current, {
    preserveBookmarkOrder: !rawInput.trim(),
    limit,
    nicknames: nicknamesRef.current,
    preferredEntryIds: rawInput.trim() ? undefined : index?.bookmarksByBrowserOrderEntryIds,
  }), profilesRef.current), profileFiltersRef.current, profilesRef.current);
}, []);

const getHistoryResults = useCallback((
  rawInput: string,
  profileIds?: string[] | null,
  showProfileContext = false,
  limit = MAX_SCOPED_HISTORY_RESULTS
): BrowserSearchResult[] => {
  const index = entryIndexRef.current;
  return filterBrowserResultsForKind('history', decorateBrowserResults(getBrowserEntryCandidates('history', rawInput, entriesRef.current, {
    preserveHistoryChronology: true,
    includeHistoryTimestamp: true,
    showHistoryProfileContext: showProfileContext,
    profileIds,
    limit,
    preferredEntryIds: rawInput.trim() ? undefined : index?.historyByTimeEntryIds,
  }), profilesRef.current), profileFiltersRef.current, profilesRef.current);
}, []);
```

(Only the `candidateEntryIds: ...` line changes to `preferredEntryIds: ...` — same value, renamed to match the new option name. The empty-query fast-path still works.)

- [ ] **Step 9: Type-check**

```bash
npx tsc --noEmit -p tsconfig.renderer.json
```

Expected: clean. If TS complains about the `void entryIndex;` line being a no-op, replace it with `// eslint-disable-next-line @typescript-eslint/no-unused-vars` above the parameter — the param is still needed because callers pass it.

- [ ] **Step 10: Manual smoke test**

Run the app with browser search enabled. With ~8k entries in history, type:

- `git` → expected: `github.com` history results appear, autocomplete suggests `github.com`.
- `youtu` (substring match, not prefix) → expected: `youtube.com` results still appear, powered by the linear `searchBlob.includes` path.
- (empty query) → expected: recent history items show in chronological order — this uses the `preferredEntryIds` path.

If any of these regress, you've broken the linear scan. Re-check the `tokenMatched` early-exit at line ~1044 (in the post-Task-3 numbering) — it MUST still read from `index.searchBlob` (Task 4 will inline that read; until then, it stays on the index field).

- [ ] **Step 11: Commit**

```bash
git add src/renderer/src/hooks/useBrowserSearch.ts
git commit -m "perf(launcher): drop prefix/contains index maps from browser search

The 4 Map<string, number[]> prefix/contains lookups were upfront-computed
duplicates of the linear searchBlob.includes(token) check that runs in
the per-entry inner loop anyway. Removing them frees ~22 MB of retained
heap. Renames candidateEntryIds → preferredEntryIds for the empty-query
fast path (which is unrelated to the prefix index and is preserved)."
```

---

## Task 4: Slim `BrowserEntrySearchIndex` (drop `searchBlob` / `faviconUrl` / `browserLabel`)

**Files:**
- Modify: `src/renderer/src/hooks/useBrowserSearch.ts:641-648` (`BrowserEntrySearchIndex` type)
- Modify: `src/renderer/src/hooks/useBrowserSearch.ts:1408-1433` (`getBrowserEntrySearchIndex`)
- Modify: `src/renderer/src/hooks/useBrowserSearch.ts:1044-1052` (token-match early-exit reads `searchBlob`)
- Modify: `src/renderer/src/hooks/useBrowserSearch.ts:1005-1008` and `1086-1089` (result decoration uses `index.faviconUrl` / `index.browserLabel`)
- Modify: `src/renderer/src/hooks/useBrowserSearch.ts:990-1023` (the empty-query block from Task 3, Step 7b also uses `index.faviconUrl` / `index.browserLabel`)

Why: of the 6 fields in `BrowserEntrySearchIndex`, only `normalizedQuery`, `normalizedUrl`, and `searchFields` are hot enough to justify caching per-entry. `searchBlob` is a join of strings already on `searchFields`. `faviconUrl` is a one-line transform of `entry.url`. `browserLabel` is a one-line enum lookup on `entry.source`. Computing them at the call site instead of storing them frees ~7 MB.

- [ ] **Step 1: Slim the `BrowserEntrySearchIndex` type**

Replace lines 641-648:

```ts
type BrowserEntrySearchIndex = {
  normalizedQuery: string;
  normalizedUrl: string;
  searchFields: TokenSearchField[];
};
```

- [ ] **Step 2: Slim `getBrowserEntrySearchIndex`**

Replace the function body inside `getBrowserEntrySearchIndex` (lines 1408-1433) to stop computing the three dropped fields. The new body:

```ts
function getBrowserEntrySearchIndex(entry: BrowserSearchEntry): BrowserEntrySearchIndex {
  const cacheKey = String(entry.id || `${entry.source}:${entry.sourceProfileId || ''}:${entry.type}:${entry.url}`);
  const fingerprint = getBrowserEntrySearchFingerprint(entry);
  const cached = browserEntrySearchIndexCache.get(cacheKey);
  if (cached?.fingerprint === fingerprint) {
    // Bump recency for LRU (added in Task 5).
    browserEntrySearchIndexCache.delete(cacheKey);
    browserEntrySearchIndexCache.set(cacheKey, cached);
    return cached.index;
  }
  const searchFields: TokenSearchField[] = [
    { value: normalizeForTokenSearch(entry.query), weight: 1.15 },
    { value: normalizeForTokenSearch(entry.url, BROWSER_ENTRY_INDEX_MAX_URL_CHARS), weight: 1 },
    { value: normalizeForTokenSearch(entry.host), weight: 1 },
    { value: normalizeForTokenSearch(entry.bookmarkFolder || ''), weight: 0.65 },
    { value: normalizeForTokenSearch(entry.sourceProfileName || entry.sourceProfileId || ''), weight: 0.35 },
    { value: normalizeForTokenSearch(getBrowserSourceLabel(entry.source)), weight: 0.3 },
  ];
  const index: BrowserEntrySearchIndex = {
    normalizedQuery: String(entry.query || '').trim().toLowerCase(),
    normalizedUrl: normalizeUrlForCompletion(entry.url || entry.host, BROWSER_ENTRY_INDEX_MAX_URL_CHARS),
    searchFields,
  };
  browserEntrySearchIndexCache.set(cacheKey, { fingerprint, index });
  return index;
}
```

(The `delete` + `set` on cache hit is wiring for Task 5's LRU; harmless until then because the Map still has insertion-order semantics.)

- [ ] **Step 3: Update the token-match `includes` check to compute searchBlob locally**

Find the per-entry inner-loop block (currently around lines 1044-1052):

```ts
if (!nicknameMatch && hasSearchInput && activeQueryTokens.length > 0) {
  let tokenMatched = true;
  for (const token of activeQueryTokens) {
    if (!index.searchBlob.includes(token)) {
      tokenMatched = false;
      break;
    }
  }
  if (!tokenMatched) continue;
}
```

Replace `index.searchBlob` with a locally-computed join. Hoist the computation outside the token loop so it runs once per entry, not once per token:

```ts
if (!nicknameMatch && hasSearchInput && activeQueryTokens.length > 0) {
  const searchBlob = index.searchFields.map((f) => f.value).filter(Boolean).join(' ');
  let tokenMatched = true;
  for (const token of activeQueryTokens) {
    if (!searchBlob.includes(token)) {
      tokenMatched = false;
      break;
    }
  }
  if (!tokenMatched) continue;
}
```

- [ ] **Step 4: Replace `index.faviconUrl` and `index.browserLabel` reads at result-build sites**

Two sites push BrowserSearchResult objects that read these fields. They appear inside `getBrowserEntryCandidates`. After Task 3's edits, the line numbers shifted — find both occurrences of `faviconUrl: index.faviconUrl,` and replace with:

```ts
faviconUrl: getFaviconUrlForUrl(entry.url),
```

…and both occurrences of `browserName: index.browserLabel,` with:

```ts
browserName: getBrowserSourceLabel(entry.source),
```

There should be exactly two of each, both in the same function (`getBrowserEntryCandidates`): one in the empty-query `preferredEntryIds` block, one in the main loop.

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit -p tsconfig.renderer.json
```

Expected: clean. If TS complains that `index.searchBlob`, `index.faviconUrl`, or `index.browserLabel` is still referenced somewhere, find the remaining usage and fix it the same way.

- [ ] **Step 6: Manual smoke test**

Run the app. Type a 3-letter token that should match a known history URL by substring (e.g. `tub` for youtube.com): expected result still appears with the correct favicon and browser label.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/hooks/useBrowserSearch.ts
git commit -m "perf(launcher): slim BrowserEntrySearchIndex to 3 hot fields

Drops searchBlob (recomputed inline at the token-match check),
faviconUrl (recomputed via getFaviconUrlForUrl at render time), and
browserLabel (recomputed via getBrowserSourceLabel at render time).
Cuts ~7 MB of retained heap on top of Task 3's win."
```

---

## Task 5: LRU-cap `browserEntrySearchIndexCache` at 2,000 entries

**Files:**
- Modify: `src/renderer/src/hooks/useBrowserSearch.ts:666` (cache declaration)
- Modify: `src/renderer/src/hooks/useBrowserSearch.ts:1408-1433` (`getBrowserEntrySearchIndex` — cache writes)

Why: even with the slimmed index from Task 4, an unbounded cache still grows to all 8,516 entries (~2 MB). Bounding at 2,000 with LRU keeps it sub-500 KB while preserving fast repeat-query performance.

- [ ] **Step 1: Add the LRU cap constant**

Below the existing `BROWSER_ENTRY_INDEX_MAX_URL_CHARS` constant (currently line 665):

```ts
const BROWSER_ENTRY_SEARCH_INDEX_CACHE_MAX = 2_000;
```

- [ ] **Step 2: Update the cache write to evict the oldest on overflow**

In `getBrowserEntrySearchIndex`, replace the final cache write line:

```ts
browserEntrySearchIndexCache.set(cacheKey, { fingerprint, index });
```

with:

```ts
browserEntrySearchIndexCache.set(cacheKey, { fingerprint, index });
if (browserEntrySearchIndexCache.size > BROWSER_ENTRY_SEARCH_INDEX_CACHE_MAX) {
  const oldestKey = browserEntrySearchIndexCache.keys().next().value;
  if (oldestKey !== undefined) browserEntrySearchIndexCache.delete(oldestKey);
}
```

(`Map#keys()` returns keys in insertion order; we re-insert on cache hit in Task 4 Step 2, so the head is genuinely the LRU entry.)

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit -p tsconfig.renderer.json
```

Expected: clean.

- [ ] **Step 4: Manual sanity test**

Run the app. Type queries that should sweep more than 2,000 distinct entries (e.g. type random 2-letter prefixes for ~30 seconds). The app should remain responsive; no console errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/hooks/useBrowserSearch.ts
git commit -m "perf(launcher): cap browser-entry search-index cache at 2,000 entries

Use Map insertion-order as LRU recency; evict the oldest entry when
size exceeds 2,000. With Task 4's slim payload, peak cache footprint
drops from ~16 MB to ~500 KB."
```

---

## Task 6: Normalize bangs at the IPC boundary; stop spread-copying

**Files:**
- Modify: `src/renderer/src/hooks/useWebSearchController.ts:497-525` (bangs IPC effect — call `normalizeBangDefinition`)
- Modify: `src/renderer/src/hooks/useWebSearchController.ts:73` (`webSearchDisabledBangKeys` → derive a `Set` ref)
- Modify: `src/renderer/src/hooks/useWebSearchController.ts:110-148` (`effectiveSearchBangs` + `enabledSearchBangs` memos)
- Modify: any reader of `bang.disabled` inside `useWebSearchController.ts` (search for `.disabled` after the rewrite to confirm everyone reads the new Set).

Why: bangs land in renderer state twice — raw catalog (shape A, ~870 KB) + spread-copied normalized catalog with `defaultPopularityRank` (shape B, ~1.95 MB). Normalizing once at the IPC boundary collapses to one shape; not spread-copying for the `disabled` flag collapses the second normalized allocation entirely.

- [ ] **Step 1: Use `normalizeBangDefinition` at IPC boundary**

Replace the bangs-fetch effect body (post-Task-2 version). The new effect:

```ts
useEffect(() => {
  if (!browserSearchEnabled) {
    setWebSearchBangCatalog([]);
    return;
  }
  let cancelled = false;
  window.electron.webSearchListBangs?.()
    .then((entries: WebSearchBangEntry[]) => {
      if (cancelled || !Array.isArray(entries)) return;
      const next = entries
        .map((entry): SearchBangDefinition | null => {
          const rawKey = String(entry?.key || '').trim().toLowerCase().replace(/^!+/, '');
          if (!rawKey) return null;
          return normalizeBangDefinition({
            key: rawKey,
            aliases: Array.isArray(entry.aliases) ? entry.aliases : [],
            name: String(entry.name || rawKey),
            host: String(entry.host || 'duckduckgo.com'),
            category: entry.category,
            subcategory: entry.subcategory,
            template: String(entry.urlTemplate || 'https://duckduckgo.com/?q=!{bang}%20{query}'),
            source: entry.source || 'duckduckgo',
            rankHint: entry.rankHint,
          });
        })
        .filter((entry): entry is SearchBangDefinition => Boolean(entry));
      setWebSearchBangCatalog(next);
    })
    .catch(() => {});
  return () => {
    cancelled = true;
  };
}, [browserSearchEnabled]);
```

- [ ] **Step 2: Replace the `effectiveSearchBangs` memo with a non-copying view**

Replace lines 110-143 with:

```ts
const effectiveSearchBangs = useMemo(() => {
  const byKey = new Map<string, SearchBangDefinition>();
  for (const entry of webSearchBangCatalog) {
    byKey.set(entry.key, entry);
  }
  for (const entry of SEARCH_BANGS) {
    const normalized = normalizeBangDefinition(entry);
    byKey.set(normalized.key, normalized);
  }
  for (const entry of webSearchBangCustomProviders) {
    const normalized = normalizeBangDefinition({
      key: entry.key,
      aliases: entry.aliases,
      name: entry.name,
      host: entry.host,
      template: entry.template,
      category: 'Custom',
      source: 'custom',
    });
    byKey.set(normalized.key, normalized);
  }
  for (const override of webSearchBangOverrides) {
    const current = byKey.get(override.key);
    if (!current) continue;
    byKey.set(override.key, {
      ...current,
      aliases: override.aliases.filter((alias) => alias !== override.key),
    });
  }
  return Array.from(byKey.values());
}, [webSearchBangCatalog, webSearchBangOverrides, webSearchBangCustomProviders]);
```

Key differences vs the current memo: (1) the catalog entries are stored by reference, not spread-copied; (2) the `disabled` flag is no longer baked into the per-entry shape; (3) seed and custom-provider entries are still allocated fresh because they need normalization, but they're a small fraction (~25) of the total.

- [ ] **Step 3: Derive a disabled-set; expose it where `bang.disabled` was read**

Add a memo right below `effectiveSearchBangs`:

```ts
const disabledBangKeySet = useMemo(
  () => new Set(webSearchDisabledBangKeys.map((key) => key.toLowerCase())),
  [webSearchDisabledBangKeys]
);
```

Update the `enabledSearchBangs` memo:

```ts
const enabledSearchBangs = useMemo(
  () => effectiveSearchBangs.filter((bang) => !disabledBangKeySet.has(bang.key)),
  [effectiveSearchBangs, disabledBangKeySet]
);
```

- [ ] **Step 4: Update other `bang.disabled` consumers**

Find every remaining `.disabled` read inside `useWebSearchController.ts` (search for `bang.disabled` and `.disabled` more broadly). Each becomes `disabledBangKeySet.has(bang.key)` instead. Common sites include the "show hidden" filter at line ~417, and any UI hook that surfaces disabled bangs. Each call site changes:

```ts
// before:
effectiveSearchBangs.filter((bang) => bang.disabled)
// after:
effectiveSearchBangs.filter((bang) => disabledBangKeySet.has(bang.key))
```

Run a grep before declaring done:

```bash
grep -n "\.disabled" src/renderer/src/hooks/useWebSearchController.ts
```

Expected: no remaining hits inside the controller. If any survive, they're reading `disabled` off the bang shape — fix them.

- [ ] **Step 5: Drop `disabled` from any consumer outside this hook**

The hook returns `effectiveSearchBangs` / `enabledSearchBangs` to `App.tsx`. Verify external consumers don't depend on `bang.disabled` — only on the filtered list. Grep:

```bash
grep -rn "bang\.disabled" src/renderer/
```

Expected: zero hits outside `useWebSearchController.ts` (which should also be clean after Step 4).

- [ ] **Step 6: Type-check**

```bash
npx tsc --noEmit -p tsconfig.renderer.json
```

Expected: clean. If `SearchBangDefinition` type still declares `disabled?: boolean`, leave it — the field can be set by callers if needed; we just stop writing it from the memo.

- [ ] **Step 7: Manual smoke test**

Run the app:

- `!g foo` → Google search.
- `!yt foo` → YouTube search.
- Open Settings → Browser Search → disable a bang. Confirm: `!<that-key>` no longer triggers it; the bangs settings list still shows it in the "disabled" state.
- Re-enable it. Confirm: `!<that-key>` works again.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/hooks/useWebSearchController.ts
git commit -m "perf(launcher): normalize bangs once at IPC boundary

Bangs are normalized as they arrive over IPC, and effectiveSearchBangs
becomes a non-copying view: catalog entries are stored by reference, the
disabled flag is held in a separate Set keyed by bang.key. Cuts the
duplicated bangs shapes (13,520 × 2) down to one. Saves ~1.5 MB."
```

---

## Task 7: End-to-end verification

**Files:** none (runtime verification only).

- [ ] **Step 1: Type-check both project halves**

```bash
npx tsc --noEmit -p tsconfig.main.json
npx tsc --noEmit -p tsconfig.renderer.json
```

Expected: both clean.

- [ ] **Step 2: Build and launch**

```bash
npm run build:main && npm run dev
```

- [ ] **Step 3: Take a heap snapshot with `browserSearch.enabled = false`**

In the launcher: Settings → Advanced → toggle Browser Search OFF. Open DevTools for the launcher renderer window. Memory tab → Take heap snapshot.

Expected heap structure:
- `{fingerprint, index} ×N` row: **absent** (the cache was cleared on disable).
- `{normalizedQuery, normalizedUrl, searchFields} ×N`: **absent**.
- `{value, weight} ×N`: **absent** or far below 51,096.
- Bangs object shapes (×13,520): **absent**.
- Tabs entries: **absent**.
- Total retained: **~45 MB ± 5 MB** (v24 baseline).

- [ ] **Step 4: Take a heap snapshot with `browserSearch.enabled = true`**

Toggle Browser Search back ON. Use the launcher briefly (type a few queries) to warm the LRU cache. Snapshot.

Expected:
- `{fingerprint, index} ×N`: present but `N <= 2000` (LRU cap).
- `{normalizedQuery, normalizedUrl, searchFields} ×N`: present with **3 fields**, not 6 (no `searchBlob`/`faviconUrl`/`browserLabel`).
- `{value, weight}`: present, but ≤ `2000 × 6 = 12,000` (not 51,096).
- `Map ×N` retaining: **< 5 MB total** (the 4 prefix/contains Maps are gone — only `historyByTimeEntryIds`-supporting Maps + small profile-count Maps remain).
- `Array`: **< 50,000 instances** (was 262,277).
- Bangs object shapes: present **once** (~13,520), not twice.
- Total retained: **~55 MB ± 5 MB**.

- [ ] **Step 5: Functional regression sweep**

With browser search enabled:

- Type a URL host prefix you have history for (e.g. `git` → `github.com`): autocomplete suggests the host, hitting Enter opens it.
- Type a substring of a known title (e.g. `tube` → YouTube history items): results appear in the list.
- Type the title of a bookmark: bookmark result appears.
- `!g pizza` → opens `https://www.google.com/search?q=pizza`.
- `!yt foo` → opens YouTube search.
- `!gh tanstack` → opens GitHub search.
- With `alphaChromiumRootSearchEnabled = true` and a Chrome window open: type a URL of an open tab → "Focus tab" action appears, activates the existing tab on Enter.

If any of these regress, find the matching task's change and audit the path.

- [ ] **Step 6: Round-trip toggle test**

Toggle browser search off → take snapshot (expect ~45 MB) → toggle on → take snapshot (expect ~55 MB) → toggle off → take snapshot (expect ~45 MB).

Validates that disable correctly drops `browserEntrySearchIndexCache`, `webSearchBangCatalog`, and tabs.

- [ ] **Step 7: Performance sanity check**

Empty the launcher input, then type a 4-letter query (e.g. `mail`) one character at a time. Each keystroke's first-paint latency target: under 30 ms (was under 10 ms with the eager prefix Maps). On an 8k-entry history this is well within acceptable; if you see noticeable lag, profile via Performance tab — most likely cause would be the new per-entry `searchBlob` join from Task 4, which can be moved into a per-`getBrowserEntryCandidates` shared local if needed.

- [ ] **Step 8: Final commit**

Nothing to commit — this task is verification only. If verification surfaced fixes, commit those with `fix(launcher): ...` messages.

---

## Out of scope

- Main-process memory (the main-side `cache` in `browser-search-history.ts` is ~3.8 MB on 8k entries — fine).
- Moving the index to the main process (LRU + drop-prefix-Maps gets us to target).
- Refactoring `useBrowserSearch.ts` for general readability.
- Trimming `BrowserSearchEntry` fields added by `bc21e36a` — they're needed for current features.
