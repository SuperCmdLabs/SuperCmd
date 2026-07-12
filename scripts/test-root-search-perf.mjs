#!/usr/bin/env node

import assert from 'assert/strict';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { performance } from 'perf_hooks';
import vm from 'vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const moduleCache = new Map();
const ROOT = process.cwd();

const reactStub = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  Fragment: 'Fragment',
};

function makeComponent(name) {
  return function StubComponent(props) {
    return { type: name, props: props || {}, children: [] };
  };
}

const lucideStub = new Proxy({ __esModule: true }, {
  get(target, prop) {
    if (prop === '__esModule') return true;
    if (prop === 'default') return target;
    return makeComponent(String(prop));
  },
});

function getStubbedModule(request) {
  if (request === 'react') return { __esModule: true, default: reactStub, ...reactStub };
  if (request === 'lucide-react') return lucideStub;
  if (request === './quicklink-icons') {
    return { renderQuickLinkIconGlyph: () => null };
  }
  if (request.startsWith('../icons/')) {
    return { __esModule: true, default: makeComponent(path.basename(request)) };
  }
  return null;
}

function loadTsModule(filePath) {
  const resolvedPath = path.resolve(ROOT, filePath);
  if (moduleCache.has(resolvedPath)) return moduleCache.get(resolvedPath).exports;

  const source = fs.readFileSync(resolvedPath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
    },
    fileName: resolvedPath,
  });

  const module = { exports: {} };
  moduleCache.set(resolvedPath, module);

  const localRequire = (request) => {
    const stubbed = getStubbedModule(request);
    if (stubbed) return stubbed;

    if (request.startsWith('.')) {
      const candidate = path.resolve(path.dirname(resolvedPath), request);
      for (const suffix of ['', '.ts', '.tsx', '.js', '.jsx', '.json', '/index.ts', '/index.tsx']) {
        const nextPath = `${candidate}${suffix}`;
        if (!fs.existsSync(nextPath) || !fs.statSync(nextPath).isFile()) continue;
        if (nextPath.endsWith('.svg')) return '';
        if (nextPath.endsWith('.ts') || nextPath.endsWith('.tsx')) return loadTsModule(nextPath);
        return require(nextPath);
      }
    }

    return require(request);
  };

  const sandbox = {
    module,
    exports: module.exports,
    require: localRequire,
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

  vm.runInNewContext(transpiled.outputText, sandbox, { filename: resolvedPath });
  return module.exports;
}

const commandHelpers = loadTsModule('src/renderer/src/utils/command-helpers.tsx');
const ranking = loadTsModule('src/renderer/src/utils/root-search-ranking.ts');

const { filterCommands, rankCommands } = commandHelpers;
const { scoreRootSearchFields } = ranking;

const COMMAND_COUNT = Number(process.env.SUPERCMD_ROOT_SEARCH_PERF_COMMANDS || 6000);
const ITERATIONS = Number(process.env.SUPERCMD_ROOT_SEARCH_PERF_ITERATIONS || 6);
const WARMUP_ITERATIONS = Number(process.env.SUPERCMD_ROOT_SEARCH_PERF_WARMUPS || 1);

const QUERIES = [
  'notes',
  'clip',
  'window',
  'project alpha',
  'deploy',
  'timer',
  'gh',
  'cmd 42',
];

const WORDS = [
  'Notes',
  'Clipboard',
  'Window',
  'Browser',
  'Settings',
  'Canvas',
  'Timer',
  'Schedule',
  'Project',
  'Deploy',
  'Debug',
  'GitHub',
  'Snippet',
  'Search',
  'Memory',
  'Automation',
];

function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function makeCommands(count) {
  const commands = [];
  const aliases = {};

  for (let i = 0; i < count; i += 1) {
    const primary = WORDS[i % WORDS.length];
    const secondary = WORDS[(i * 7 + 3) % WORDS.length];
    const group = i % 4 === 0 ? 'extension' : i % 4 === 1 ? 'script' : i % 4 === 2 ? 'app' : 'system';
    const command = {
      id: `synthetic-command-${i}`,
      title: `${primary} ${secondary} Command ${i}`,
      subtitle: `${secondary} tools for Project Alpha workspace ${i % 97}`,
      category: group,
      path: group === 'extension' ? `extension-${i % 80}/command-${i}` : undefined,
      keywords: [
        primary,
        secondary,
        `cmd ${i}`,
        i % 9 === 0 ? 'project alpha' : 'workspace',
        i % 11 === 0 ? 'gh github repo' : 'local action',
      ],
      alwaysOnTop: i % 997 === 0,
    };
    commands.push(command);

    if (i % 5 === 0) aliases[command.id] = `${primary.toLowerCase()}-${i}`;
    if (i % 37 === 0) aliases[command.id] = 'gh';
  }

  return { commands, aliases };
}

function rootCommandFields(command, alias) {
  return [
    { value: command.title, kind: 'label', weight: 1 },
    { value: alias, kind: 'alias', weight: 1.08 },
    { value: command.subtitle, kind: 'description', weight: 0.74 },
    ...(command.keywords || []).map((keyword) => ({ value: keyword, kind: 'description', weight: 0.68 })),
  ];
}

function legacyRankCommandFields(command, alias) {
  return [
    { value: command.title, kind: 'label', weight: 1 },
    { value: alias, kind: 'alias', weight: 1.06 },
    { value: command.subtitle, kind: 'description', weight: 0.74 },
    ...(command.keywords || []).map((keyword) => ({ value: keyword, kind: 'description', weight: 0.7 })),
  ];
}

function legacyRootCommandMatches(commands, query, aliases) {
  const normalizedQuery = normalizeSearchText(query);
  const ranked = commands
    .map((command) => {
      const alias = aliases[command.id] || '';
      const firstPass = scoreRootSearchFields(query, legacyRankCommandFields(command, alias));
      if (!firstPass.matched) return null;
      return {
        command,
        score: firstPass.matchScore,
        hasExactAliasMatch: Boolean(alias) && normalizeSearchText(alias) === normalizedQuery,
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.hasExactAliasMatch !== b.hasExactAliasMatch) {
        return Number(b.hasExactAliasMatch) - Number(a.hasExactAliasMatch);
      }
      if (a.command.alwaysOnTop !== b.command.alwaysOnTop) return a.command.alwaysOnTop ? -1 : 1;
      if (b.score !== a.score) return b.score - a.score;
      return a.command.title.localeCompare(b.command.title);
    });

  return ranked
    .map(({ command }) => {
      const scored = scoreRootSearchFields(query, rootCommandFields(command, aliases[command.id] || ''));
      assert.equal(scored.matched, true, `${command.id} lost its second-pass match for ${query}`);
      return {
        id: command.id,
        matchKind: scored.matchKind,
        matchScore: scored.matchScore,
      };
    });
}

function optimizedRootCommandMatches(commands, query, aliases) {
  return rankCommands(commands, query, aliases)
    .map((entry) => {
      if (typeof entry.matchKind === 'string' && typeof entry.matchScore === 'number') {
        return {
          id: entry.command.id,
          matchKind: entry.matchKind,
          matchScore: entry.matchScore,
        };
      }

      const scored = scoreRootSearchFields(query, rootCommandFields(entry.command, aliases[entry.command.id] || ''));
      assert.equal(scored.matched, true, `${entry.command.id} lost its optimized fallback match for ${query}`);
      return {
        id: entry.command.id,
        matchKind: scored.matchKind,
        matchScore: scored.matchScore,
      };
    });
}

function signature(matches) {
  return matches
    .map((match) => `${match.id}:${match.matchKind}:${match.matchScore}`)
    .sort();
}

function assertSameRootCommandMatches(commands, aliases) {
  for (const query of QUERIES) {
    assert.deepEqual(
      signature(optimizedRootCommandMatches(commands, query, aliases)),
      signature(legacyRootCommandMatches(commands, query, aliases)),
      `root command matches changed for query "${query}"`
    );
  }
}

function timeRun(fn) {
  const start = performance.now();
  let total = 0;
  for (const query of QUERIES) {
    total += fn(query);
  }
  return { duration: performance.now() - start, total };
}

function measure(label, fn) {
  for (let i = 0; i < WARMUP_ITERATIONS; i += 1) timeRun(fn);

  const samples = [];
  let total = 0;
  for (let i = 0; i < ITERATIONS; i += 1) {
    const result = timeRun(fn);
    samples.push(result.duration);
    total = result.total;
  }

  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)];
  const min = samples[0];
  const max = samples[samples.length - 1];

  return { label, median, min, max, total };
}

const { commands, aliases } = makeCommands(COMMAND_COUNT);

assertSameRootCommandMatches(commands, aliases);

const legacy = measure('legacy filter + two-pass command scoring', (query) => {
  const filtered = filterCommands(commands, query, aliases);
  const matches = legacyRootCommandMatches(commands, query, aliases);
  return filtered.length + matches.length;
});

const optimized = measure('optimized command scoring path', (query) => {
  const matches = optimizedRootCommandMatches(commands, query, aliases);
  return matches.length;
});

const speedup = legacy.median > 0 ? legacy.median / optimized.median : 0;

console.log('Root search perf harness');
console.log(`commands=${COMMAND_COUNT} queries=${QUERIES.length} iterations=${ITERATIONS} warmups=${WARMUP_ITERATIONS}`);
console.log(`${legacy.label}: median=${legacy.median.toFixed(2)}ms min=${legacy.min.toFixed(2)}ms max=${legacy.max.toFixed(2)}ms total=${legacy.total}`);
console.log(`${optimized.label}: median=${optimized.median.toFixed(2)}ms min=${optimized.min.toFixed(2)}ms max=${optimized.max.toFixed(2)}ms total=${optimized.total}`);
console.log(`speedup=${speedup.toFixed(2)}x`);
