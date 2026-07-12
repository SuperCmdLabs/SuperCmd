#!/usr/bin/env node

import assert from 'assert/strict';
import fs from 'fs';
import path from 'path';
import test from 'node:test';
import { createRequire } from 'module';
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
  if (request === './quicklink-icons') return { renderQuickLinkIconGlyph: () => null };
  if (request.startsWith('../icons/')) return { __esModule: true, default: makeComponent(path.basename(request)) };
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

const {
  createRootCommandScoreIndex,
  rankCommands,
  rankCommandsWithIndex,
} = loadTsModule('src/renderer/src/utils/command-helpers.tsx');

const commands = [
  { id: 'notes-app', title: 'Notes', subtitle: 'Application', category: 'app' },
  { id: 'search-notes', title: 'Search Notes', subtitle: 'Extension command', category: 'extension' },
  { id: 'release-notes', title: 'Release Notes', subtitle: 'Documentation', category: 'system' },
  { id: 'quick-note', title: 'Quick Note', subtitle: 'Create a note', category: 'system', alwaysOnTop: true },
  { id: 'clipboard', title: 'Clipboard History', subtitle: 'Recent copied text', category: 'system' },
];

const aliases = {
  'search-notes': 'sn',
  'quick-note': 'note',
};

function compact(matches) {
  return matches.map(({ command, matchKind, matchScore }) => ({
    id: command.id,
    matchKind,
    matchScore,
  }));
}

test('indexed root command ranking preserves deterministic order and match metadata', () => {
  const index = createRootCommandScoreIndex(commands, aliases);
  const indexedMatches = compact(rankCommandsWithIndex(index, 'note'));

  assert.deepEqual(indexedMatches.map((match) => match.id), [
    'quick-note',
    'notes-app',
    'release-notes',
    'search-notes',
    'clipboard',
  ]);
  assert.deepEqual(indexedMatches, compact(rankCommands(commands, 'note', aliases)));
  assert.equal(indexedMatches[0].matchKind, 'alias-exact');
  assert.ok(indexedMatches[0].matchScore > indexedMatches[1].matchScore);
});
