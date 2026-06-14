#!/usr/bin/env node

import test from 'node:test';
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

function assertIncludes(source, needle) {
  assert.ok(source.includes(needle), `Source should include: ${needle}`);
}

function assertNotIncludes(source, needle) {
  assert.ok(!source.includes(needle), `Source should not include: ${needle}`);
}

test('Browser search lag fix', async (t) => {
  await t.test('main history module exports required functions', () => {
    assertIncludes(files.history, 'getBrowserSearchRevision');
    assertIncludes(files.history, 'getBrowserSearchStats');
    assertIncludes(files.history, 'seenBookmarkKeys');
    assertIncludes(files.history, 'existingBookmarkByKey');
  });

  await t.test('main IPC handlers are registered', () => {
    assertIncludes(files.main, "ipcMain.handle('browser-search:revision'");
    assertIncludes(files.main, "ipcMain.handle('browser-search:stats'");
    assertIncludes(files.main, 'revision: getCombinedBrowserSearchRevision()');
  });

  await t.test('main refresh guard checks revision before refresh', () => {
    assertIncludes(files.main, 'const beforeRevision = bsGetBrowserSearchRevision();');
    assertIncludes(files.main, 'bsGetBrowserSearchRevision() !== beforeRevision');
  });

  await t.test('preload API exports browser search methods', () => {
    assertIncludes(files.preload, 'browserSearchRevision');
    assertIncludes(files.preload, 'browserSearchStats');
  });

  await t.test('renderer types include browser search types', () => {
    assertIncludes(files.types, 'BrowserSearchStats');
    assertIncludes(files.types, 'BrowserSearchEntryListPayload');
  });

  await t.test('browser search hook has required state and methods', () => {
    assertIncludes(files.hook, 'entriesRevisionRef');
    assertIncludes(files.hook, 'refreshEntriesIfStale');
    assertIncludes(files.hook, 'historyByTimeEntryIds');
    assertIncludes(files.hook, 'bookmarksByBrowserOrderEntryIds');
    assertIncludes(files.hook, 'BROWSER_ENTRY_INDEX_MAX_TOKEN_LENGTH = 128');
    assertIncludes(files.hook, 'BROWSER_ENTRY_INDEX_MAX_URL_CHARS = 4096');
  });

  await t.test('local commands use refreshEntriesIfStale not refreshEntries', () => {
    const localBookmarksBlock = files.localCommands.match(/if \(commandId === BROWSER_SEARCH_BOOKMARKS_COMMAND_ID\) \{[\s\S]*?return true;/)?.[0] || '';
    const localHistoryBlock = files.localCommands.match(/if \(commandId === BROWSER_SEARCH_HISTORY_COMMAND_ID\) \{[\s\S]*?return true;/)?.[0] || '';
    assertNotIncludes(localBookmarksBlock, 'refreshBrowserEntries();');
    assertNotIncludes(localHistoryBlock, 'refreshBrowserEntries();');
    assertIncludes(localBookmarksBlock, 'refreshBrowserEntriesIfStale();');
    assertIncludes(localHistoryBlock, 'refreshBrowserEntriesIfStale();');
  });

  await t.test('window-shown handler uses refreshEntriesIfStale not refreshEntries', () => {
    const shownBookmarksBlock = files.windowShown.match(/if \(routedSystemCommandId === BROWSER_SEARCH_BOOKMARKS_COMMAND_ID\) \{[\s\S]*?return;/)?.[0] || '';
    const shownHistoryBlock = files.windowShown.match(/if \(routedSystemCommandId === BROWSER_SEARCH_HISTORY_COMMAND_ID\) \{[\s\S]*?return;/)?.[0] || '';
    assertNotIncludes(shownBookmarksBlock, 'refreshBrowserEntries();');
    assertNotIncludes(shownHistoryBlock, 'refreshBrowserEntries();');
    assertIncludes(shownBookmarksBlock, 'refreshBrowserEntriesIfStale();');
    assertIncludes(shownHistoryBlock, 'refreshBrowserEntriesIfStale();');
  });

  await t.test('advanced settings displays browser search stats', () => {
    assertIncludes(files.settings, 'browserSearchStats');
    assertIncludes(files.settings, 'browserSearchStats?.profileCountsByKind?.history');
    assertNotIncludes(files.settings, 'window.electron.browserSearchListEntries()');
  });
});
