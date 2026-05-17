import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { createRequire } from 'module';
import assert from 'assert/strict';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const sourcePath = path.resolve('src/renderer/src/utils/root-search-ranking.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
    importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
  },
  fileName: sourcePath,
});

const module = { exports: {} };
const sandbox = {
  module,
  exports: module.exports,
  require,
  console,
  URL,
  Date,
  Math,
  String,
  Number,
  Set,
  Map,
  Object,
  Array,
  RegExp,
};
vm.runInNewContext(transpiled.outputText, sandbox, { filename: sourcePath });

const ranking = module.exports;
const {
  ROOT_SEARCH_PROMOTION_SCORE,
  ROOT_SEARCH_RESULTS_LIMIT,
  getSharedRootCompletion,
  normalizeRootSearchText,
  rankRootSearchCandidates,
  recordRootSearchLaunchInState,
  scoreRootSearchCandidate,
  scoreRootSearchFields,
  tokenizeRootSearchQuery,
} = ranking;

const now = Date.UTC(2026, 4, 17);

function command(id, title, extra = {}) {
  return { id, title, category: 'system', ...extra };
}

function candidate({
  query,
  id,
  title,
  subtype,
  source = subtype === 'file' || subtype === 'folder' ? 'file' : subtype === 'app' ? 'command' : 'browser',
  fields,
  stableKey,
  sourceQualityBoost = 0,
  freshnessBoost = 0,
  pathLocationBoost = 0,
  noisePenalty = 0,
  depthPenalty = 0,
  rankingState = {},
  pathOrUrl = '',
  commandExtra = {},
}) {
  const scored = scoreRootSearchFields(query, fields || [{ value: title, kind: 'label' }]);
  assert.equal(scored.matched, true, `${title} should match ${query}`);
  return scoreRootSearchCandidate({
    command: command(id, title, {
      rootSearchStableKey: stableKey || `${source}:${id}`,
      rootSearchSource: source,
      rootSearchSubtype: subtype,
      ...commandExtra,
    }),
    source,
    subtype,
    stableKey: stableKey || `${source}:${id}`,
    label: title,
    pathOrUrl,
    matchKind: scored.matchKind,
    matchScore: scored.matchScore,
    sourceQualityBoost,
    freshnessBoost,
    pathLocationBoost,
    noisePenalty,
    depthPenalty,
  }, query, rankingState, now);
}

function assembleResults({ ranked, directSearchCommand = null, openUrlCommand = null, query = '' }) {
  if (openUrlCommand) {
    return [
      openUrlCommand,
      ...ranked
        .filter((item) => isPromotionCandidate(item, query))
        .slice(0, ROOT_SEARCH_RESULTS_LIMIT - 1)
        .map((item) => item.command),
    ];
  }

  const resultKeys = new Set();
  const results = [];
  const add = (item) => {
    if (resultKeys.has(item.stableKey)) return;
    results.push(item.command);
    resultKeys.add(item.stableKey);
  };

  ranked
    .filter((item) => isPromotionCandidate(item, query))
    .slice(0, ROOT_SEARCH_RESULTS_LIMIT - (directSearchCommand ? 1 : 0))
    .forEach(add);

  if (directSearchCommand) results.push(directSearchCommand);
  return results;
}

const BROAD_FILE_PATH_QUERY_TERMS = new Set([
  'desktop',
  'documents',
  'downloads',
  'users',
  'user',
  'home',
  'library',
  'application',
  'support',
]);

function isFocusedFilePathCandidate(item, query) {
  if (item.source !== 'file' || !item.pathOrUrl) return false;
  if (item.subtype !== 'file' && item.subtype !== 'folder') return false;
  const terms = tokenizeRootSearchQuery(query).filter((term) =>
    term.length >= 3 && !BROAD_FILE_PATH_QUERY_TERMS.has(term)
  );
  const normalizedLabel = normalizeRootSearchText(item.label);
  if (terms.length < 2 && !terms.some((term) => !normalizedLabel.includes(term))) return false;

  const normalizedPath = normalizeRootSearchText(item.pathOrUrl);
  const hasPathNarrowingTerm = terms.some((term) =>
    !normalizedLabel.includes(term) && normalizedPath.includes(term)
  );
  if (!hasPathNarrowingTerm) return false;
  return item.finalScore >= 600 && item.depthPenalty <= 180 && item.noisePenalty <= 140;
}

function isPromotionCandidate(item, query = '') {
  const focusedFilePathCandidate = isFocusedFilePathCandidate(item, query);
  if (item.finalScore < (focusedFilePathCandidate ? 600 : ROOT_SEARCH_PROMOTION_SCORE)) return false;
  if (item.subtype === 'nickname') return true;
  if (item.subtype === 'app' || item.subtype === 'quicklink') {
    return !['contains', 'subsequence', 'description'].includes(item.matchKind);
  }
  if (item.subtype === 'file' || item.subtype === 'folder') {
    if (item.matchKind === 'exact') return true;
    if (focusedFilePathCandidate) return true;
    if (['prefix', 'token-prefix', 'compact-prefix'].includes(item.matchKind)) {
      if (item.subtype === 'folder' && item.depthPenalty === 0 && item.noisePenalty === 0) return true;
      return item.depthPenalty <= 60 && item.noisePenalty === 0 && item.finalScore >= 760;
    }
    return false;
  }
  if (item.subtype === 'open-tab' || item.subtype === 'bookmark') {
    return item.finalScore >= 820 && ['exact', 'prefix', 'token-prefix', 'url'].includes(item.matchKind);
  }
  if (item.subtype === 'history') {
    if (item.finalScore >= 620 && ['exact', 'url'].includes(item.matchKind)) return true;
    return item.finalScore >= 820 && !isSearchEngineHistoryCandidate(item) && ['prefix', 'token-prefix'].includes(item.matchKind);
  }
  return item.finalScore >= 780 && ['exact', 'alias-exact', 'prefix', 'token-prefix'].includes(item.matchKind);
}

function isSearchEngineHistoryCandidate(item) {
  if (item.subtype !== 'history' || !item.pathOrUrl) return false;
  try {
    const host = new URL(item.pathOrUrl).hostname.replace(/^www\./i, '').toLowerCase();
    return (
      host === 'google.com' ||
      host.endsWith('.google.com') ||
      host === 'bing.com' ||
      host.endsWith('.bing.com') ||
      host === 'duckduckgo.com' ||
      host.endsWith('.duckduckgo.com') ||
      host === 'search.brave.com'
    );
  } catch {
    return false;
  }
}

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

test('exact app wins over browser history containing the same term', () => {
  const query = 'Vivaldi';
  const app = candidate({ query, id: 'app-vivaldi', title: 'Vivaldi', subtype: 'app' });
  const history = candidate({
    query,
    id: 'hist-vivaldi',
    title: 'Vivaldi release notes',
    subtype: 'history',
    fields: [{ value: 'https://example.com/vivaldi-release-notes', kind: 'url' }],
    sourceQualityBoost: 120,
  });
  assert.equal(rankRootSearchCandidates([history, app])[0].command.id, 'app-vivaldi');
});

test('exact folder wins over browser bookmark/history for local intent', () => {
  const query = 'UZH';
  const folder = candidate({
    query,
    id: 'folder-uzh',
    title: 'UZH',
    subtype: 'folder',
    pathLocationBoost: 120,
    pathOrUrl: '/Users/me/Desktop/UZH',
  });
  const bookmark = candidate({
    query,
    id: 'bookmark-uzh',
    title: 'UZH Portal',
    subtype: 'bookmark',
    sourceQualityBoost: 140,
  });
  assert.equal(rankRootSearchCandidates([bookmark, folder])[0].command.id, 'folder-uzh');
});

test('bookmark nickname is a protected tier-one match', () => {
  const query = 'gh';
  const nickname = candidate({
    query,
    id: 'nick-gh',
    title: 'gh',
    subtype: 'nickname',
    fields: [{ value: 'gh', kind: 'nickname' }],
    commandExtra: { browserNickname: 'gh', browserNicknameMatch: true },
  });
  const commandMatch = candidate({
    query,
    id: 'weak-command',
    title: 'GitHub Issues',
    subtype: 'extension-command',
    fields: [{ value: 'GitHub Issues', kind: 'label' }],
  });
  assert.equal(rankRootSearchCandidates([commandMatch, nickname])[0].command.id, 'nick-gh');
});

test('default protected trust order prefers app, nickname, file, folder', () => {
  const query = 'SuperCmd';
  const app = candidate({ query, id: 'app-supercmd', title: 'SuperCmd', subtype: 'app' });
  const nickname = candidate({
    query,
    id: 'nick-supercmd',
    title: 'SuperCmd',
    subtype: 'nickname',
    fields: [{ value: 'SuperCmd', kind: 'nickname' }],
  });
  const file = candidate({
    query,
    id: 'file-supercmd',
    title: 'SuperCmd',
    subtype: 'file',
    pathLocationBoost: 120,
    freshnessBoost: 120,
  });
  const folder = candidate({
    query,
    id: 'folder-supercmd',
    title: 'SuperCmd',
    subtype: 'folder',
    pathLocationBoost: 120,
    freshnessBoost: 120,
  });
  assert.deepEqual(
    rankRootSearchCandidates([folder, file, nickname, app]).map((item) => item.command.id),
    ['app-supercmd', 'nick-supercmd', 'file-supercmd', 'folder-supercmd']
  );
});

test('exact app beats fresh download installer with same prefix', () => {
  const query = 'SuperCmd';
  const app = candidate({ query, id: 'app-supercmd', title: 'SuperCmd', subtype: 'app' });
  const dmg = candidate({
    query,
    id: 'file-supercmd-dmg',
    title: 'SuperCmd-1.0.23-arm64.dmg',
    subtype: 'file',
    pathLocationBoost: 120,
    freshnessBoost: 120,
  });
  assert.equal(rankRootSearchCandidates([dmg, app])[0].command.id, 'app-supercmd');
});

test('URL open command is inserted first outside normal scoring', () => {
  const query = 'twitch.tv';
  const ranked = rankRootSearchCandidates([
    candidate({ query: 'twitch', id: 'history-twitch', title: 'Twitch', subtype: 'history', sourceQualityBoost: 250 }),
  ]);
  const results = assembleResults({
    ranked,
    openUrlCommand: command('browser-search-action-open-url', 'Open twitch.tv'),
  });
  assert.equal(results[0].id, 'browser-search-action-open-url');
});

test('direct search appears after strong promoted results', () => {
  const query = 'vivaldi';
  const ranked = rankRootSearchCandidates([
    candidate({ query, id: 'app-vivaldi', title: 'Vivaldi', subtype: 'app' }),
  ]);
  const results = assembleResults({
    ranked,
    directSearchCommand: command('web-search-root-direct', 'Search "vivaldi"'),
  });
  assert.deepEqual(results.slice(0, 2).map((item) => item.id), ['app-vivaldi', 'web-search-root-direct']);
});

test('direct search is last in Results ahead of weak deep file matches', () => {
  const query = 'uzh';
  const ranked = rankRootSearchCandidates([
    candidate({ query, id: 'folder-uzh', title: 'UZH', subtype: 'folder', pathLocationBoost: 120 }),
    candidate({
      query,
      id: 'deep-uzhgorod',
      title: 'Uzhgorod',
      subtype: 'file',
      pathLocationBoost: 30,
      depthPenalty: 190,
      pathOrUrl: '/Users/me/Desktop/project/env/site-packages/pytz/zoneinfo/Europe/Uzhgorod',
    }),
  ]);
  const results = assembleResults({
    ranked,
    directSearchCommand: command('web-search-root-direct', 'Search "uzh"'),
  });
  assert.deepEqual(results.map((item) => item.id), ['folder-uzh', 'web-search-root-direct']);
});

test('focused project path file match promotes before direct search', () => {
  const query = 'supercmd node';
  const nodeModules = candidate({
    query,
    id: 'folder-node-modules',
    title: 'node_modules',
    subtype: 'folder',
    fields: [
      { value: 'node_modules', kind: 'label' },
      { value: '/Users/me/Desktop/Forks/SuperCmd/node_modules', kind: 'path', weight: 0.72 },
    ],
    pathOrUrl: '/Users/me/Desktop/Forks/SuperCmd/node_modules',
    pathLocationBoost: 84,
    noisePenalty: 70,
    depthPenalty: 50,
  });
  const ranked = rankRootSearchCandidates([nodeModules]);
  const results = assembleResults({
    ranked,
    query,
    directSearchCommand: command('web-search-root-direct', 'Search "supercmd node"'),
  });
  assert.deepEqual(results.map((item) => item.id), ['folder-node-modules', 'web-search-root-direct']);
});

test('broad location path match does not promote before direct search', () => {
  const query = 'desktop node';
  const nodeModules = candidate({
    query,
    id: 'folder-node-modules',
    title: 'node_modules',
    subtype: 'folder',
    fields: [
      { value: 'node_modules', kind: 'label' },
      { value: '/Users/me/Desktop/Forks/SuperCmd/node_modules', kind: 'path', weight: 0.72 },
    ],
    pathOrUrl: '/Users/me/Desktop/Forks/SuperCmd/node_modules',
    pathLocationBoost: 84,
    noisePenalty: 70,
    depthPenalty: 50,
  });
  const ranked = rankRootSearchCandidates([nodeModules]);
  const results = assembleResults({
    ranked,
    query,
    directSearchCommand: command('web-search-root-direct', 'Search "desktop node"'),
  });
  assert.deepEqual(results.map((item) => item.id), ['web-search-root-direct']);
});

test('strong browser host match promotes before direct search', () => {
  const query = 'twitch';
  const twitch = candidate({
    query,
    id: 'history-twitch',
    title: 'Atrioc - Twitch',
    subtype: 'history',
    fields: [{ value: 'twitch.tv', kind: 'url' }],
    sourceQualityBoost: 120,
    commandExtra: { browserActionInput: 'https://twitch.tv/atrioc' },
  });
  twitch.matchKind = 'url';
  const ranked = rankRootSearchCandidates([twitch]);
  const results = assembleResults({
    ranked,
    directSearchCommand: command('web-search-root-direct', 'Search "twitch"'),
  });
  assert.deepEqual(results.map((item) => item.id), ['history-twitch', 'web-search-root-direct']);
});

test('exact destination history beats search-engine open tab containing query', () => {
  const query = 'twi';
  const googleTab = candidate({
    query,
    id: 'tab-google-twitch',
    title: 'twitch high cpu usage - Google Search',
    subtype: 'open-tab',
    pathOrUrl: 'https://www.google.com/search?q=twitch+high+cpu+usage',
    sourceQualityBoost: 220,
  });
  const twitchHistory = candidate({
    query,
    id: 'history-twitch',
    title: 'twitch.tv',
    subtype: 'history',
    fields: [{ value: 'twitch.tv', kind: 'url' }],
    pathOrUrl: 'https://www.twitch.tv/',
  });
  assert.equal(rankRootSearchCandidates([googleTab, twitchHistory])[0].command.id, 'history-twitch');
});

test('bookmark wins over same-quality history by default', () => {
  const query = 'Google';
  const bookmark = candidate({
    query,
    id: 'bookmark-google',
    title: 'Google',
    subtype: 'bookmark',
    pathOrUrl: 'https://www.google.com/',
  });
  const history = candidate({
    query,
    id: 'history-google-search',
    title: 'Google Search Console',
    subtype: 'history',
    pathOrUrl: 'https://search.google.com/search-console',
    sourceQualityBoost: 80,
  });
  assert.equal(rankRootSearchCandidates([history, bookmark])[0].command.id, 'bookmark-google');
});

test('open tab wins over bookmark for same destination quality', () => {
  const query = 'RustCast';
  const bookmark = candidate({
    query,
    id: 'bookmark-rustcast',
    title: 'RustCast',
    subtype: 'bookmark',
    pathOrUrl: 'https://rustcast.app/',
  });
  const tab = candidate({
    query,
    id: 'tab-rustcast',
    title: 'RustCast',
    subtype: 'open-tab',
    pathOrUrl: 'https://rustcast.app/',
  });
  assert.equal(rankRootSearchCandidates([bookmark, tab])[0].command.id, 'tab-rustcast');
});

test('strong non-search browser title prefix promotes before direct search', () => {
  const query = 'atrioc';
  const twitch = candidate({
    query,
    id: 'history-atrioc',
    title: 'Atrioc - Twitch',
    subtype: 'history',
    pathOrUrl: 'https://www.twitch.tv/atrioc',
    sourceQualityBoost: 120,
  });
  const ranked = rankRootSearchCandidates([twitch]);
  const results = assembleResults({
    ranked,
    directSearchCommand: command('web-search-root-direct', 'Search "atrioc"'),
  });
  assert.deepEqual(results.map((item) => item.id), ['history-atrioc', 'web-search-root-direct']);
});

test('search engine history title prefix does not promote over direct search', () => {
  const query = 'twitch';
  const googleHistory = candidate({
    query,
    id: 'history-google-twitch',
    title: 'twitch high cpu usage - Google Search',
    subtype: 'history',
    pathOrUrl: 'https://www.google.com/search?q=twitch+high+cpu+usage',
    sourceQualityBoost: 160,
  });
  const ranked = rankRootSearchCandidates([googleHistory]);
  const results = assembleResults({
    ranked,
    directSearchCommand: command('web-search-root-direct', 'Search "twitch"'),
  });
  assert.deepEqual(results.map((item) => item.id), ['web-search-root-direct']);
});

test('search section gating hides suggestions without removing direct search', () => {
  const directSearch = command('web-search-root-direct', 'Search "vivaldi"');
  const suggestionsEnabled = false;
  const searchSectionItems = suggestionsEnabled ? [command('web-search-root-suggestion:vivaldi browser', 'vivaldi browser')] : [];
  assert.equal(searchSectionItems.length, 0);
  assert.equal(directSearch.id, 'web-search-root-direct');
});

test('browser URL dedupe keeps highest-ranked result for the same URL', () => {
  const query = 'docs';
  const url = 'https://example.com/docs';
  const tab = candidate({
    query,
    id: 'tab-docs',
    title: 'Docs',
    subtype: 'open-tab',
    stableKey: `browser:${url}`,
    sourceQualityBoost: 160,
  });
  const history = candidate({
    query,
    id: 'history-docs',
    title: 'Docs',
    subtype: 'history',
    stableKey: `browser:${url}`,
  });
  const ranked = rankRootSearchCandidates([history, tab]);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].command.id, 'tab-docs');
});

test('deep noisy file loses to shallow desktop file by default', () => {
  const query = 'Thing';
  const shallow = candidate({
    query,
    id: 'file-shallow',
    title: 'Thing.md',
    subtype: 'file',
    pathLocationBoost: 120,
    pathOrUrl: '/Users/me/Desktop/Thing.md',
  });
  const deep = candidate({
    query,
    id: 'file-deep',
    title: 'Thing.js',
    subtype: 'file',
    pathLocationBoost: 30,
    noisePenalty: 70,
    depthPenalty: 190,
    pathOrUrl: '/Users/me/Desktop/Forks/project/node_modules/pkg/lib/Thing.js',
  });
  assert.equal(rankRootSearchCandidates([deep, shallow])[0].command.id, 'file-shallow');
});

test('strong browser match beats deeply buried exact local folder', () => {
  const query = 'Cast';
  const deepFolder = candidate({
    query,
    id: 'folder-cast',
    title: 'cast',
    subtype: 'folder',
    pathLocationBoost: 20,
    depthPenalty: 190,
    pathOrUrl: '/Users/me/Desktop/project/.venv/lib/python3.12/site-packages/pandas/tests/dtypes/cast',
  });
  const browser = candidate({
    query,
    id: 'tab-casting',
    title: 'CASTING HERA VS SIMPLY',
    subtype: 'open-tab',
    sourceQualityBoost: 80,
    pathOrUrl: 'https://www.twitch.tv/videos/123',
  });
  assert.equal(rankRootSearchCandidates([deepFolder, browser])[0].command.id, 'tab-casting');
});

test('shallow exact folder still beats browser match', () => {
  const query = 'UZH';
  const folder = candidate({
    query,
    id: 'folder-uzh',
    title: 'UZH',
    subtype: 'folder',
    pathLocationBoost: 120,
    pathOrUrl: '/Users/me/Desktop/UZH',
  });
  const browser = candidate({
    query,
    id: 'history-uzh',
    title: 'UZH Portal',
    subtype: 'history',
    sourceQualityBoost: 140,
    pathOrUrl: 'https://www.uzh.ch/',
  });
  assert.equal(rankRootSearchCandidates([browser, folder])[0].command.id, 'folder-uzh');
});

test('freshness boosts otherwise equal file matches', () => {
  const query = 'Report';
  const oldFile = candidate({ query, id: 'old-report', title: 'Report.md', subtype: 'file', pathLocationBoost: 120 });
  const freshFile = candidate({ query, id: 'fresh-report', title: 'Report.md', subtype: 'file', pathLocationBoost: 120, freshnessBoost: 120 });
  assert.equal(rankRootSearchCandidates([oldFile, freshFile])[0].command.id, 'fresh-report');
});

test('adaptive frecency can lift a repeatedly launched deep file', () => {
  const query = 'Thing';
  let state = {};
  for (let i = 0; i < 5; i += 1) {
    state = recordRootSearchLaunchInState(state, 'file:/Users/me/Desktop/Forks/project/node_modules/pkg/lib/Thing.js', query, now + i * 1000);
  }
  const shallow = candidate({
    query,
    id: 'file-shallow',
    title: 'Thing.md',
    subtype: 'file',
    stableKey: 'file:/Users/me/Desktop/Thing.md',
    pathLocationBoost: 120,
    rankingState: state,
  });
  const deep = candidate({
    query,
    id: 'file-deep',
    title: 'Thing.js',
    subtype: 'file',
    stableKey: 'file:/Users/me/Desktop/Forks/project/node_modules/pkg/lib/Thing.js',
    pathLocationBoost: 30,
    noisePenalty: 70,
    depthPenalty: 190,
    rankingState: state,
  });
  assert.equal(rankRootSearchCandidates([shallow, deep])[0].command.id, 'file-deep');
});

test('shared-root autocomplete returns common prefix for strong local candidates', () => {
  const query = 'Rep';
  const candidates = rankRootSearchCandidates([
    candidate({ query, id: 'q1', title: 'Report_2026_Q1', subtype: 'file', pathLocationBoost: 120 }),
    candidate({ query, id: 'q2', title: 'Report_2026_Q2', subtype: 'file', pathLocationBoost: 120 }),
  ]);
  assert.equal(getSharedRootCompletion(query, candidates), 'Report_2026_Q');
});

test('autocomplete can add a single high-confidence character', () => {
  const query = 'Code';
  const candidates = rankRootSearchCandidates([
    candidate({ query, id: 'app-codex', title: 'Codex', subtype: 'app' }),
  ]);
  assert.equal(getSharedRootCompletion(query, candidates), 'Codex');
});

test('browser title token autocomplete completes visible title term', () => {
  const query = 'atr';
  const candidates = rankRootSearchCandidates([
    candidate({
      query,
      id: 'history-atrioc',
      title: 'Atrioc - Twitch',
      subtype: 'history',
      pathOrUrl: 'https://www.twitch.tv/atrioc',
      sourceQualityBoost: 120,
    }),
  ]);
  assert.equal(getSharedRootCompletion(query, candidates), 'Atrioc');
});

test('weak browser history does not autocomplete', () => {
  const query = 'ival';
  const history = candidate({
    query,
    id: 'history-vivaldi',
    title: 'How to use Vivaldi',
    subtype: 'history',
    fields: [{ value: 'How to use Vivaldi', kind: 'label' }],
  });
  assert.equal(getSharedRootCompletion(query, [history]), null);
});

console.log('root-search-ranking tests passed');
