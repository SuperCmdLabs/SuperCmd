#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL, fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rowPath = path.join(repoRoot, 'src/renderer/src/components/LauncherCommandRow.tsx');
const listPath = path.join(repoRoot, 'src/renderer/src/components/LauncherCommandList.tsx');

const rowCount = readNumberArg('--rows', 5000);
const iterations = readNumberArg('--iterations', 5);
const warmups = readNumberArg('--warmups', 1);
const jsonOnly = process.argv.includes('--json');

function readNumberArg(name, fallback) {
  const raw = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (!raw) return fallback;
  const value = Number(raw.slice(name.length + 1));
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

const tmpDir = await fs.mkdtemp(path.join(repoRoot, '.launcher-command-list-measure-'));
const entryPath = path.join(tmpDir, 'entry.tsx');
const bundlePath = path.join(tmpDir, 'bundle.mjs');

await fs.writeFile(entryPath, `
import React from 'react';
import { renderToString } from 'react-dom/server';
import LauncherCommandList from ${JSON.stringify(listPath)};

type CommandInfo = {
  id: string;
  title: string;
  subtitle?: string;
  keywords?: string[];
  iconDataUrl?: string;
  iconEmoji?: string;
  iconName?: string;
  category: 'app' | 'settings' | 'system' | 'extension' | 'script';
  path?: string;
  browserResultKind?: 'open-tab' | 'bookmark' | 'history' | 'search';
  browserFaviconUrl?: string;
};

type LauncherCommandSection = {
  title: string;
  items: CommandInfo[];
};

type Metrics = {
  rowRenderCount: number;
};

declare global {
  // eslint-disable-next-line no-var
  var __launcherCommandListMetrics: Metrics | undefined;
}

const rowCount = ${rowCount};
const iterations = ${iterations};
const warmups = ${warmups};
const jsonOnly = ${JSON.stringify(jsonOnly)};

const TRANSLATIONS: Record<string, string> = {
  'launcher.badges.application': 'Application',
  'launcher.badges.bookmark': 'Bookmark',
  'launcher.badges.extension': 'Extension',
  'launcher.badges.history': 'History',
  'launcher.badges.openTab': 'Open Tab',
  'launcher.badges.quickLink': 'Quick Link',
  'launcher.badges.script': 'Script',
  'launcher.badges.settings': 'System Settings',
  'launcher.categories.browser': 'Browser',
  'launcher.categories.files': 'Files',
  'launcher.categories.recent': 'Recent',
  'launcher.categories.search': 'Search',
  'launcher.sections.pinned': 'Pinned',
  'launcher.sections.results': 'Results',
  'launcher.sections.selectedText': 'Selected Text',
  'launcher.status.discoveringApps': 'Discovering apps...',
  'launcher.status.noMatchingResults': 'No matching results',
  'common.system': 'System',
  'read.title': 'Read',
  'settings.title': 'Settings',
  'whisper.title': 'Whisper',
};

function t(key: string): string {
  return TRANSLATIONS[key] || key;
}

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] || 0;
}

function makeCommand(index: number, titlePrefix = 'Command'): CommandInfo {
  const kind = index % 9;
  const base = {
    id: \`measure-command-\${index}\`,
    title: \`\${titlePrefix} \${String(index).padStart(5, '0')}\`,
    subtitle: index % 4 === 0 ? \`Workspace action \${index}\` : undefined,
    keywords: ['measure', 'launcher', String(index)],
  };
  if (kind === 0) {
    return { ...base, category: 'app', path: \`/Applications/Measure \${index}.app\`, iconDataUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' };
  }
  if (kind === 1) {
    return { ...base, category: 'system', id: \`system-measure-\${index}\` };
  }
  if (kind === 2) {
    return { ...base, category: 'extension', path: \`measure-extension/command-\${index}\` };
  }
  if (kind === 3) {
    return { ...base, category: 'script', iconEmoji: '>' };
  }
  if (kind === 4) {
    return { ...base, category: 'system', browserResultKind: 'history', browserFaviconUrl: 'https://example.com/favicon.ico' };
  }
  if (kind === 5) {
    return { ...base, category: 'system', browserResultKind: 'open-tab' };
  }
  if (kind === 6) {
    return { ...base, category: 'system', browserResultKind: 'bookmark' };
  }
  if (kind === 7) {
    return { ...base, category: 'system', id: \`quicklink-measure-\${index}\`, iconName: 'Link' };
  }
  return { ...base, category: 'settings' };
}

function makeSections(commands: CommandInfo[], titles: string[]): LauncherCommandSection[] {
  const perSection = Math.max(1, Math.ceil(commands.length / titles.length));
  return titles.map((title, sectionIndex) => ({
    title,
    items: commands.slice(sectionIndex * perSection, (sectionIndex + 1) * perSection),
  })).filter((section) => section.items.length > 0);
}

function flatten(sections: LauncherCommandSection[]): CommandInfo[] {
  return sections.flatMap((section) => section.items);
}

const rootCommands = Array.from({ length: rowCount }, (_, index) => makeCommand(index));
const queryCommands = Array.from({ length: rowCount }, (_, index) => makeCommand(index, 'Query Match')).reverse();
const narrowedCommands = Array.from({ length: Math.max(1, Math.floor(rowCount * 0.6)) }, (_, index) => makeCommand(index * 2, 'Filtered Match'));

const rootSections = makeSections(rootCommands, ['', 'Pinned', 'Recent', 'Results', 'Files']);
const querySections = makeSections(queryCommands, ['Results', 'Browser', 'Files', 'Search']);
const narrowedSections = makeSections(narrowedCommands, ['Results', 'Browser', 'Files']);

const scenarios = [
  { name: 'root results initial', sections: rootSections, selectedIndex: 0 },
  { name: 'selection moves to middle', sections: rootSections, selectedIndex: Math.floor(rowCount / 2) },
  { name: 'selection moves to end', sections: rootSections, selectedIndex: rowCount - 1 },
  { name: 'query update same-size reshuffle', sections: querySections, selectedIndex: 0 },
  { name: 'query update narrowed-large', sections: narrowedSections, selectedIndex: Math.min(20, narrowedCommands.length - 1) },
];

const noop = () => {};

function renderScenario(scenario: typeof scenarios[number]) {
  const displayCommands = flatten(scenario.sections);
  const listRef = { current: null };
  const itemRefs = { current: [] };
  globalThis.__launcherCommandListMetrics = { rowRenderCount: 0 };
  const started = performance.now();
  const html = renderToString(
    <LauncherCommandList
      listRef={listRef as React.RefObject<HTMLDivElement>}
      itemRefs={itemRefs as React.MutableRefObject<(HTMLDivElement | null)[]>}
      isLoading={false}
      isHidden={false}
      displayCommands={displayCommands as any}
      sections={scenario.sections as any}
      calcResult={null}
      calcOffset={0}
      selectedIndex={scenario.selectedIndex}
      commandAliases={{}}
      commandHotkeys={{
        'measure-command-2': 'Command+Shift+P',
        'measure-command-7': 'Control+Option+L',
        'quicklink-measure-16': 'Hyper+K',
      }}
      onCalculatorCopy={noop}
      onCommandClick={noop}
      onCommandContextMenu={noop}
      t={t}
    />
  );
  const durationMs = performance.now() - started;
  return {
    name: scenario.name,
    durationMs,
    rowRenderCount: globalThis.__launcherCommandListMetrics?.rowRenderCount || 0,
    commandCount: displayCommands.length,
    htmlLength: html.length,
  };
}

for (let i = 0; i < warmups; i += 1) {
  for (const scenario of scenarios) {
    renderScenario(scenario);
  }
}

const results = scenarios.map((scenario) => {
  const samples = Array.from({ length: iterations }, () => renderScenario(scenario));
  return {
    name: scenario.name,
    commandCount: samples[0]?.commandCount || 0,
    rowRenderCount: samples[0]?.rowRenderCount || 0,
    medianDurationMs: median(samples.map((sample) => sample.durationMs)),
    minDurationMs: Math.min(...samples.map((sample) => sample.durationMs)),
    maxDurationMs: Math.max(...samples.map((sample) => sample.durationMs)),
    htmlLength: samples[0]?.htmlLength || 0,
  };
});

const totalRows = results.reduce((sum, result) => sum + result.rowRenderCount, 0);
const totalMedianMs = results.reduce((sum, result) => sum + result.medianDurationMs, 0);
const summary = { rowCount, iterations, results, totalRows, totalMedianMs };

if (!jsonOnly) {
  console.log(\`LauncherCommandList render measurement (rows=\${rowCount}, iterations=\${iterations})\`);
  for (const result of results) {
    console.log([
      \`- \${result.name}\`,
      \`commands=\${result.commandCount}\`,
      \`rowRenders=\${result.rowRenderCount}\`,
      \`median=\${result.medianDurationMs.toFixed(2)}ms\`,
      \`min=\${result.minDurationMs.toFixed(2)}ms\`,
      \`max=\${result.maxDurationMs.toFixed(2)}ms\`,
    ].join(' | '));
  }
  console.log(\`Total row renders per scenario sequence: \${totalRows}\`);
  console.log(\`Total median render time per scenario sequence: \${totalMedianMs.toFixed(2)}ms\`);
}
console.log(JSON.stringify(summary, null, 2));
`);

const instrumentLauncherRowPlugin = {
  name: 'instrument-launcher-command-row',
  setup(build) {
    build.onLoad({ filter: /LauncherCommandRow\.tsx$/ }, async (args) => {
      let source = await fs.readFile(args.path, 'utf8');
      if (path.resolve(args.path) === rowPath) {
        const marker = '}) => {\n';
        if (!source.includes(marker)) {
          throw new Error('Unable to instrument LauncherCommandRow render counter.');
        }
        source = source.replace(marker, `${marker}  const __launcherMetrics = (globalThis.__launcherCommandListMetrics ||= { rowRenderCount: 0 });\n  __launcherMetrics.rowRenderCount += 1;\n`);
      }
      return { contents: source, loader: 'tsx' };
    });
  },
};

try {
  await esbuild.build({
    entryPoints: [entryPath],
    outfile: bundlePath,
    absWorkingDir: repoRoot,
    bundle: true,
    format: 'esm',
    platform: 'node',
    jsx: 'automatic',
    packages: 'external',
    nodePaths: [path.join(repoRoot, 'node_modules')],
    loader: {
      '.svg': 'dataurl',
      '.png': 'dataurl',
    },
    plugins: [instrumentLauncherRowPlugin],
    logLevel: 'silent',
  });

  await import(pathToFileURL(bundlePath).href);
} finally {
  await fs.rm(tmpDir, { recursive: true, force: true });
}
