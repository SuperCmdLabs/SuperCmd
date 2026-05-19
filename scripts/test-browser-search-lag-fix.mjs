#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';

const files = {
  history: fs.readFileSync('src/main/browser-search-history.ts', 'utf8'),
  main: fs.readFileSync('src/main/main.ts', 'utf8'),
  preload: fs.readFileSync('src/main/preload.ts', 'utf8'),
  types: fs.readFileSync('src/renderer/types/electron.d.ts', 'utf8'),
  hook: fs.readFileSync('src/renderer/src/hooks/useBrowserSearch.ts', 'utf8'),
  localCommands: fs.readFileSync('src/renderer/src/hooks/useLauncherLocalSystemCommands.ts', 'utf8'),
  windowShown: fs.readFileSync('src/renderer/src/hooks/useLauncherWindowShownHandler.ts', 'utf8'),
  settings: fs.readFileSync('src/renderer/src/settings/AdvancedTab.tsx', 'utf8'),
};

function assertIncludes(name, source, needle) {
  assert.ok(source.includes(needle), `${name} should include ${needle}`);
}

function assertNotIncludes(name, source, needle) {
  assert.ok(!source.includes(needle), `${name} should not include ${needle}`);
}

assertIncludes('main history module', files.history, 'getBrowserSearchRevision');
assertIncludes('main history module', files.history, 'getBrowserSearchStats');
assertIncludes('main history module', files.history, 'seenBookmarkKeys');
assertIncludes('main history module', files.history, 'existingBookmarkByKey');

assertIncludes('main IPC', files.main, "ipcMain.handle('browser-search:revision'");
assertIncludes('main IPC', files.main, "ipcMain.handle('browser-search:stats'");
assertIncludes('main IPC', files.main, 'revision: getCombinedBrowserSearchRevision()');
assertIncludes('main refresh guard', files.main, 'const beforeRevision = bsGetBrowserSearchRevision();');
assertIncludes('main refresh guard', files.main, 'bsGetBrowserSearchRevision() !== beforeRevision');

assertIncludes('preload API', files.preload, 'browserSearchRevision');
assertIncludes('preload API', files.preload, 'browserSearchStats');
assertIncludes('renderer types', files.types, 'BrowserSearchStats');
assertIncludes('renderer types', files.types, 'BrowserSearchEntryListPayload');

assertIncludes('browser search hook', files.hook, 'entriesRevisionRef');
assertIncludes('browser search hook', files.hook, 'refreshEntriesIfStale');
assertIncludes('browser search hook', files.hook, 'historyByTimeEntryIds');
assertIncludes('browser search hook', files.hook, 'bookmarksByBrowserOrderEntryIds');
assertIncludes('browser search hook', files.hook, 'BROWSER_ENTRY_INDEX_MAX_TOKEN_LENGTH = 128');
assertIncludes('browser search hook', files.hook, 'BROWSER_ENTRY_INDEX_MAX_URL_CHARS = 4096');
assertIncludes('browser search hook', files.hook, 'new Map<string, { fingerprint: string; index: BrowserEntrySearchIndex }>()');
assertIncludes('browser search hook', files.hook, 'for (const entryId of options.candidateEntryIds)');

const localBookmarksBlock = files.localCommands.match(/if \(commandId === BROWSER_SEARCH_BOOKMARKS_COMMAND_ID\) \{[\s\S]*?return true;/)?.[0] || '';
const localHistoryBlock = files.localCommands.match(/if \(commandId === BROWSER_SEARCH_HISTORY_COMMAND_ID\) \{[\s\S]*?return true;/)?.[0] || '';
assertNotIncludes('local bookmarks open block', localBookmarksBlock, 'refreshBrowserEntries();');
assertNotIncludes('local history open block', localHistoryBlock, 'refreshBrowserEntries();');
assertIncludes('local bookmarks open block', localBookmarksBlock, 'refreshBrowserEntriesIfStale();');
assertIncludes('local history open block', localHistoryBlock, 'refreshBrowserEntriesIfStale();');

const shownBookmarksBlock = files.windowShown.match(/if \(routedSystemCommandId === BROWSER_SEARCH_BOOKMARKS_COMMAND_ID\) \{[\s\S]*?return;/)?.[0] || '';
const shownHistoryBlock = files.windowShown.match(/if \(routedSystemCommandId === BROWSER_SEARCH_HISTORY_COMMAND_ID\) \{[\s\S]*?return;/)?.[0] || '';
assertNotIncludes('window-shown bookmarks block', shownBookmarksBlock, 'refreshBrowserEntries();');
assertNotIncludes('window-shown history block', shownHistoryBlock, 'refreshBrowserEntries();');
assertIncludes('window-shown bookmarks block', shownBookmarksBlock, 'refreshBrowserEntriesIfStale();');
assertIncludes('window-shown history block', shownHistoryBlock, 'refreshBrowserEntriesIfStale();');

assertIncludes('advanced settings', files.settings, 'browserSearchStats');
assertIncludes('advanced settings', files.settings, 'browserSearchStats?.profileCountsByKind?.history');
assertNotIncludes('advanced settings', files.settings, 'window.electron.browserSearchListEntries()');

console.log('browser-search lag-fix tests passed');
