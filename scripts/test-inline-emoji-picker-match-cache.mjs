#!/usr/bin/env node

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mainPath = path.join(repoRoot, 'src/main/main.ts');
const emojiDataPath = path.join(repoRoot, 'src/main/emoji-data.json');

function extractEmojiPickerSource(source) {
  const start = source.indexOf('type EmojiEntry = ');
  const end = source.indexOf('\nfunction stopEmojiTriggerMonitor', start);
  assert.notEqual(start, -1, 'Could not find inline emoji picker source start');
  assert.notEqual(end, -1, 'Could not find inline emoji picker source end');
  return source.slice(start, end);
}

function instrumentEmojiPickerSource(source) {
  let instrumented = source.replace(
    'let emojiTriggerData: EmojiEntry[] | null = null;',
    'let emojiTriggerData: EmojiEntry[] | null = __emojiData;'
  );
  instrumented = instrumented.replace(
    'function searchEmojiTriggerMatches(query: string, max = 8): EmojiEntry[] {\n',
    'function searchEmojiTriggerMatches(query: string, max = 8): EmojiEntry[] {\n  __searchCallCount += 1;\n'
  );

  assert.notEqual(instrumented, source, 'Emoji picker source was not instrumented');

  return `
let __searchCallCount = 0;
const __renderCalls = [];
const __writeCommands = [];
const __insertCalls = [];
let emojiTriggerProcess = {
  stdin: {
    write(line) {
      __writeCommands.push(JSON.parse(line));
    },
  },
};
let emojiPickerWindow = null;
let emojiPickerCurrentQuery = '';
let emojiPickerCurrentPrefixLen = 1;
let emojiPickerSelectedIdx = 0;
let emojiPickerCurrentMatches = [];
const path = { join: (...parts) => parts.join('/') };
const app = { getAppPath: () => '' };
const screen = {
  getCursorScreenPoint: () => ({ x: 0, y: 0 }),
  getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
};
const BrowserWindow = class {};
const systemClipboard = { readText: () => '', writeText: () => {} };
function loadSettings() {
  return { emojiPickerExcludedAppBundleIds: [] };
}
function disableWindowAnimation() {}
function createFakeEmojiWindow() {
  return {
    visible: true,
    bounds: null,
    isDestroyed() { return false; },
    isVisible() { return this.visible; },
    showInactive() { this.visible = true; },
    hide() { this.visible = false; },
    getSize() { return [340, 80]; },
    setBounds(bounds) { this.bounds = bounds; },
    webContents: {
      executeJavaScript(js) {
        __renderCalls.push(js);
        return Promise.resolve(undefined);
      },
      setBackgroundThrottling() {},
    },
  };
}

${instrumented}

insertEmojiReplacingTrigger = async function(emoji, queryLen, prefixLen) {
  __insertCalls.push({ emoji, queryLen, prefixLen });
};

globalThis.__emojiPickerTestAccess = {
  reset() {
    emojiPickerCurrentQuery = '';
    emojiPickerCurrentPrefixLen = 1;
    emojiPickerSelectedIdx = 0;
    emojiPickerCurrentMatches = [];
    emojiPickerWindow = createFakeEmojiWindow();
    __searchCallCount = 0;
    __renderCalls.length = 0;
    __writeCommands.length = 0;
    __insertCalls.length = 0;
  },
  async render(query, prefixLen = 1) {
    await renderEmojiPicker(query, { x: 80, y: 120, w: 10, h: 18 }, prefixLen, 'com.supercmd.test');
  },
  nav(key) {
    handleEmojiTriggerNav(key);
  },
  hide() {
    hideEmojiPicker();
  },
  search(query) {
    return searchEmojiTriggerMatches(query);
  },
  resetSearchCount() {
    __searchCallCount = 0;
  },
  state() {
    return {
      query: emojiPickerCurrentQuery,
      prefixLen: emojiPickerCurrentPrefixLen,
      selectedIdx: emojiPickerSelectedIdx,
      matchNames: emojiPickerCurrentMatches.map((entry) => entry.name),
      matchEmojis: emojiPickerCurrentMatches.map((entry) => entry.emoji),
      searchCallCount: __searchCallCount,
      renderCalls: __renderCalls.slice(),
      writeCommands: __writeCommands.slice(),
      insertCalls: __insertCalls.slice(),
      windowVisible: Boolean(emojiPickerWindow?.visible),
    };
  },
};
`;
}

function loadEmojiPickerHarness() {
  const source = fs.readFileSync(mainPath, 'utf8');
  const emojiData = JSON.parse(fs.readFileSync(emojiDataPath, 'utf8')).map((entry) => ({
    name: entry.n,
    emoji: entry.e,
    keywords: entry.k || [],
  }));
  const instrumented = instrumentEmojiPickerSource(extractEmojiPickerSource(source));
  const transpiled = ts.transpileModule(instrumented, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
    },
    fileName: 'inline-emoji-picker-harness.ts',
  });
  const sandbox = {
    __emojiData: emojiData,
    console,
    JSON,
    Promise,
    require,
    setTimeout,
  };
  vm.runInNewContext(transpiled.outputText, sandbox, { filename: 'inline-emoji-picker-harness.js' });
  return { hooks: sandbox.__emojiPickerTestAccess, emojiData };
}

function toPlain(value) {
  return JSON.parse(JSON.stringify(value));
}

function measureRepeatedNavigationSearchWork(search, query, { sequences, steps }) {
  let legacyChecksum = 0;
  let legacySearchCalls = 0;
  const legacyStart = performance.now();
  for (let sequence = 0; sequence < sequences; sequence += 1) {
    let selectedIdx = 0;
    for (let step = 0; step < steps; step += 1) {
      const matchesForHandle = search(query);
      legacySearchCalls += 1;
      if (matchesForHandle.length === 0) break;
      const matchesForUpdate = search(query);
      legacySearchCalls += 1;
      selectedIdx = (selectedIdx + 1 + matchesForUpdate.length) % matchesForUpdate.length;
      legacyChecksum += selectedIdx + matchesForUpdate.length;
    }
  }
  const legacyMs = performance.now() - legacyStart;

  let cachedChecksum = 0;
  let cachedSearchCalls = 0;
  const cachedStart = performance.now();
  for (let sequence = 0; sequence < sequences; sequence += 1) {
    const matches = search(query);
    cachedSearchCalls += 1;
    let selectedIdx = 0;
    for (let step = 0; step < steps; step += 1) {
      selectedIdx = (selectedIdx + 1 + matches.length) % matches.length;
      cachedChecksum += selectedIdx + matches.length;
    }
  }
  const cachedMs = performance.now() - cachedStart;

  return {
    query,
    sequences,
    steps,
    legacy: {
      searchCalls: legacySearchCalls,
      totalMs: Number(legacyMs.toFixed(3)),
      perSequenceMs: Number((legacyMs / sequences).toFixed(4)),
      checksum: legacyChecksum,
    },
    cached: {
      searchCalls: cachedSearchCalls,
      totalMs: Number(cachedMs.toFixed(3)),
      perSequenceMs: Number((cachedMs / sequences).toFixed(4)),
      checksum: cachedChecksum,
    },
    searchCallReduction: Number((legacySearchCalls / cachedSearchCalls).toFixed(1)),
  };
}

test('inline emoji picker reuses rendered matches for navigation and insertion', async () => {
  const { hooks } = loadEmojiPickerHarness();

  hooks.reset();
  await hooks.render('smi');
  const rendered = hooks.state();
  assert.equal(rendered.searchCallCount, 1, 'render should search once for the new query');
  assert.equal(rendered.matchNames.length, 8, 'fixture query should produce a full picker row');

  hooks.resetSearchCount();
  for (let index = 0; index < 20; index += 1) {
    hooks.nav('right');
  }
  const afterRights = hooks.state();
  assert.equal(afterRights.searchCallCount, 0, 'right navigation should not rescan emoji data');
  assert.equal(afterRights.selectedIdx, 20 % rendered.matchNames.length);

  hooks.nav('left');
  const afterLeft = hooks.state();
  assert.equal(afterLeft.searchCallCount, 0, 'left navigation should not rescan emoji data');
  assert.equal(afterLeft.selectedIdx, (afterRights.selectedIdx - 1 + rendered.matchNames.length) % rendered.matchNames.length);

  hooks.nav('enter');
  const afterEnter = hooks.state();
  assert.equal(afterEnter.searchCallCount, 0, 'enter should reuse the rendered match list');
  assert.deepEqual(toPlain(afterEnter.insertCalls), [{
    emoji: rendered.matchEmojis[afterLeft.selectedIdx],
    queryLen: 3,
    prefixLen: 1,
  }]);
  assert.deepEqual(toPlain(afterEnter.matchNames), [], 'hide should clear cached matches after insertion');
  assert.equal(afterEnter.query, '');
});

test('inline emoji picker clears cached matches when a query has no matches', async () => {
  const { hooks } = loadEmojiPickerHarness();

  hooks.reset();
  await hooks.render('smi');
  assert.ok(hooks.state().matchNames.length > 0);

  await hooks.render('zzzzzzzzzz');
  const state = hooks.state();
  assert.equal(state.searchCallCount, 2);
  assert.deepEqual(toPlain(state.matchNames), []);
  assert.equal(state.query, '');
  assert.equal(state.windowVisible, false);
});

test('inline emoji picker repeated navigation search work is cached', () => {
  const { hooks, emojiData } = loadEmojiPickerHarness();
  const measurement = measureRepeatedNavigationSearchWork(hooks.search, 'smi', {
    sequences: 500,
    steps: 20,
  });

  console.log(JSON.stringify({
    inlineEmojiPickerMatchCache: {
      emojiEntries: emojiData.length,
      ...measurement,
    },
  }, null, 2));

  assert.equal(emojiData.length, 1870);
  assert.equal(measurement.legacy.searchCalls, measurement.sequences * measurement.steps * 2);
  assert.equal(measurement.cached.searchCalls, measurement.sequences);
  assert.equal(measurement.searchCallReduction, 40);
  assert.equal(measurement.cached.checksum, measurement.legacy.checksum);
});
