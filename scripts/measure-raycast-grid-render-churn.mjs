#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL, fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gridItemsPath = path.join(repoRoot, 'src/renderer/src/raycast-api/grid-runtime-items.tsx');

const visibleCells = readNumberArg('--visible-cells', 112);
const itemCount = readNumberArg('--items', 4096);
const selectionSteps = readNumberArg('--selection-steps', 1200);
const iterations = readNumberArg('--iterations', 15);
const warmups = readNumberArg('--warmups', 3);
const jsonOnly = process.argv.includes('--json');

function readNumberArg(name, fallback) {
  const raw = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (!raw) return fallback;
  const value = Number(raw.slice(name.length + 1));
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

const tmpDir = await fs.mkdtemp(path.join(repoRoot, '.raycast-grid-render-measure-'));
const entryPath = path.join(tmpDir, 'entry.tsx');
const bundlePath = path.join(tmpDir, 'bundle.mjs');

await fs.writeFile(entryPath, `
import React from 'react';
import { renderToString } from 'react-dom/server';
import { performance } from 'node:perf_hooks';
import { createGridItemsRuntime } from ${JSON.stringify(gridItemsPath)};

type Metrics = {
  cellRenderCount: number;
};

const GRID_DEFAULT_COLUMNS = 5;

declare global {
  // eslint-disable-next-line no-var
  var __raycastGridCellMetrics: Metrics | undefined;
}

const visibleCells = ${visibleCells};
const itemCount = ${itemCount};
const selectionSteps = ${selectionSteps};
const iterations = ${iterations};
const warmups = ${warmups};
const jsonOnly = ${JSON.stringify(jsonOnly)};
const noop = () => {};

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] || 0;
}

function percentile(values: number[], pct: number): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * pct) - 1));
  return sorted[index] || 0;
}

function resolveGridIconSource(source: string): string {
  const value = String(source || '').trim();
  if (!value) return '';
  if (value.startsWith('http') || value.startsWith('data:') || value.startsWith('sc-asset:') || value.startsWith('/')) {
    return value;
  }
  if (/\\.(svg|png|jpe?g|gif|webp|ico|tiff?)$/i.test(value)) {
    return \`sc-asset://ext-asset/benchmark/\${value}\`;
  }
  return value;
}

const { GridItemRenderer } = createGridItemsRuntime(resolveGridIconSource);

class MiniNode {
  nodeType: number;
  nodeName: string;
  tagName: string;
  ownerDocument: any;
  childNodes: any[];
  parentNode: any;
  style: Record<string, string>;
  attributes: Record<string, string>;
  namespaceURI: string;
  _text: string;

  constructor(nodeType: number, nodeName: string, ownerDocument?: any) {
    this.nodeType = nodeType;
    this.nodeName = nodeName;
    this.tagName = nodeName;
    this.ownerDocument = ownerDocument || this;
    this.childNodes = [];
    this.parentNode = null;
    this.style = {};
    this.attributes = {};
    this.namespaceURI = 'http://www.w3.org/1999/xhtml';
    this._text = '';
  }

  appendChild(child: any) {
    this.childNodes.push(child);
    child.parentNode = this;
    return child;
  }

  insertBefore(child: any, before: any) {
    const index = this.childNodes.indexOf(before);
    if (index < 0) return this.appendChild(child);
    this.childNodes.splice(index, 0, child);
    child.parentNode = this;
    return child;
  }

  removeChild(child: any) {
    const index = this.childNodes.indexOf(child);
    if (index >= 0) this.childNodes.splice(index, 1);
    child.parentNode = null;
    return child;
  }

  setAttribute(name: string, value: string) {
    this.attributes[name] = String(value);
  }

  removeAttribute(name: string) {
    delete this.attributes[name];
  }

  addEventListener() {}
  removeEventListener() {}
  focus() {}

  get firstChild() {
    return this.childNodes[0] || null;
  }

  get lastChild() {
    return this.childNodes[this.childNodes.length - 1] || null;
  }

  get textContent() {
    return this._text;
  }

  set textContent(value: string) {
    this._text = String(value);
    this.childNodes = [];
  }
}

class MiniText extends MiniNode {
  nodeValue: string;

  constructor(text: string, ownerDocument: any) {
    super(3, '#text', ownerDocument);
    this.nodeValue = String(text);
  }
}

class MiniDocument extends MiniNode {
  documentElement: MiniNode;
  body: MiniNode;
  defaultView: any;

  constructor() {
    super(9, '#document');
    this.ownerDocument = this;
    this.documentElement = new MiniNode(1, 'HTML', this);
    this.body = new MiniNode(1, 'BODY', this);
    this.defaultView = globalThis;
  }

  createElement(tag: string) {
    return new MiniNode(1, tag.toUpperCase(), this);
  }

  createElementNS(namespaceURI: string, tag: string) {
    const node = new MiniNode(1, tag.toUpperCase(), this);
    node.namespaceURI = namespaceURI;
    return node;
  }

  createTextNode(text: string) {
    return new MiniText(text, this);
  }

  addEventListener() {}
  removeEventListener() {}
}

function installMiniDom() {
  const document = new MiniDocument();
  (globalThis as any).document = document;
  (globalThis as any).window = globalThis;
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: 'supercmd-grid-benchmark' },
    configurable: true,
  });
  (globalThis as any).HTMLElement = MiniNode;
  (globalThis as any).HTMLIFrameElement = class {};
}

function makeContent(index: number): any {
  switch (index % 10) {
    case 0:
      return \`cover-\${index}.png\`;
    case 1:
      return { source: \`Icon.Circle\`, color: 'blue' };
    case 2:
      return { source: \`https://img.example.test/\${index}.webp\`, fallback: 'Image', mask: 'roundedRectangle' };
    case 3:
      return { value: \`Icon.Star\`, color: 'yellow' };
    case 4:
      return { value: { fileIcon: \`/Applications/App \${index}.app\` } };
    case 5:
      return { source: { light: \`light-\${index}.png\`, dark: \`dark-\${index}.png\` }, tintColor: 'green' };
    case 6:
      return { color: index % 2 === 0 ? '#32d74b' : 'magenta' };
    case 7:
      return { source: \`data:image/gif;base64,R0lGODlhAQABAAAAACw=\` };
    case 8:
      return { fileIcon: \`/Users/test/Documents/file-\${index}.md\` };
    default:
      return null;
  }
}

function makeAccessory(index: number): any {
  switch (index % 6) {
    case 0:
      return { icon: 'Icon.CheckCircle', tooltip: \`Ready \${index}\` };
    case 1:
      return { icon: { value: 'Icon.Tag', color: 'orange' }, tooltip: \`Tagged \${index}\` };
    case 2:
      return { icon: { source: \`badge-\${index}.svg\`, tintColor: 'purple' }, tooltip: \`Badge \${index}\` };
    case 3:
      return { icon: { source: { light: 'light-badge.png', dark: 'dark-badge.png' } } };
    default:
      return undefined;
  }
}

const cells = Array.from({ length: visibleCells }, (_, index) => ({
  title: \`Grid Item \${String(index).padStart(4, '0')}\`,
  subtitle: index % 3 === 0 ? \`Subtitle \${index}\` : undefined,
  content: makeContent(index),
  accessory: makeAccessory(index),
  isSelected: false,
  dataIdx: index,
  itemHeight: 128 + (index % 3) * 24,
  fit: index % 4 === 0 ? 'fill' : 'contain',
  inset: index % 5 === 0 ? 'zero' : index % 5 === 1 ? 'md' : index % 5 === 2 ? 'lg' : 'sm',
}));

function renderVisibleWindow(selectedIdx: number) {
  globalThis.__raycastGridCellMetrics = { cellRenderCount: 0 };
  const started = performance.now();
  const html = renderToString(
    <div>
      {cells.map((cell) => (
        <GridItemRenderer
          key={cell.dataIdx}
          title={cell.title}
          subtitle={cell.subtitle}
          content={cell.content}
          accessory={cell.accessory}
          isSelected={cell.dataIdx === selectedIdx}
          dataIdx={cell.dataIdx}
          itemHeight={cell.itemHeight}
          fit={cell.fit}
          inset={cell.inset}
          onSelect={noop}
          onActivate={noop}
          onContextAction={noop}
        />
      ))}
    </div>,
  );

  return {
    durationMs: performance.now() - started,
    cellRenderCount: globalThis.__raycastGridCellMetrics?.cellRenderCount || 0,
    htmlLength: html.length,
  };
}

function GridSelectionWindow({ selectedIdx }: { selectedIdx: number }) {
  return (
    <div>
      {cells.map((cell) => (
        <GridItemRenderer
          key={cell.dataIdx}
          title={cell.title}
          subtitle={cell.subtitle}
          content={cell.content}
          accessory={cell.accessory}
          isSelected={cell.dataIdx === selectedIdx}
          dataIdx={cell.dataIdx}
          itemHeight={cell.itemHeight}
          fit={cell.fit}
          inset={cell.inset}
          onSelect={() => {}}
          onActivate={() => {}}
          onContextAction={() => {}}
        />
      ))}
    </div>
  );
}

async function measureClientSelectionChurn() {
  installMiniDom();
  const [{ createRoot }, { flushSync }] = await Promise.all([
    import('react-dom/client'),
    import('react-dom'),
  ]);
  const container = document.createElement('div');
  const root = createRoot(container);

  flushSync(() => {
    root.render(<GridSelectionWindow selectedIdx={0} />);
  });

  globalThis.__raycastGridCellMetrics = { cellRenderCount: 0 };
  const started = performance.now();
  for (let step = 1; step <= selectionSteps; step += 1) {
    flushSync(() => {
      root.render(<GridSelectionWindow selectedIdx={step % visibleCells} />);
    });
  }

  const durationMs = performance.now() - started;
  root.unmount();

  return {
    durationMs,
    cellRenderCount: globalThis.__raycastGridCellMetrics?.cellRenderCount || 0,
  };
}

function makeGridGroups() {
  const items = Array.from({ length: itemCount }, (_, index) => ({
    item: {
      id: \`grid-\${index}\`,
      order: index,
      props: {
        id: \`grid-\${index}\`,
        title: \`Grid Item \${index}\`,
        subtitle: index % 4 === 0 ? \`Subtitle \${index}\` : undefined,
        content: makeContent(index),
        accessory: makeAccessory(index),
      },
      section: index < itemCount / 2
        ? { id: 'section-a', title: 'Section A' }
        : { id: 'section-b', title: 'Section B', columns: 4, aspectRatio: '3/2', fit: 'fill', inset: 'lg' },
    },
    globalIdx: index,
  }));

  return [
    { key: 'section-a', title: 'Section A', section: { id: 'section-a', title: 'Section A' }, items: items.slice(0, Math.floor(itemCount / 2)) },
    {
      key: 'section-b',
      title: 'Section B',
      section: { id: 'section-b', title: 'Section B', columns: 4, aspectRatio: '3/2', fit: 'fill', inset: 'lg' },
      items: items.slice(Math.floor(itemCount / 2)),
    },
  ];
}

function buildMeasurementGridLayout(groups: ReturnType<typeof makeGridGroups>) {
  const rows: Array<{ startIdx: number; endIdx: number; top: number; bottom: number; columns: number }> = [];
  let top = 0;
  for (const group of groups) {
    const columns = Number(group.section?.columns) > 0 ? Number(group.section.columns) : GRID_DEFAULT_COLUMNS;
    for (let offset = 0; offset < group.items.length; offset += columns) {
      const rowItems = group.items.slice(offset, offset + columns);
      const rowHeight = Math.max(...rowItems.map(({ item }) => 128 + (item.order % 3) * 24));
      const startIdx = rowItems[0]?.globalIdx ?? 0;
      const endIdx = rowItems[rowItems.length - 1]?.globalIdx ?? startIdx;
      rows.push({ startIdx, endIdx, top, bottom: top + rowHeight, columns });
      top += rowHeight + 8;
    }
  }
  return { rows };
}

function findLayoutRow(layout: ReturnType<typeof buildMeasurementGridLayout>, itemIndex: number) {
  return layout.rows.find((row) => itemIndex >= row.startIdx && itemIndex <= row.endIdx) || layout.rows[0];
}

function getColumnsForItemIndex(layout: ReturnType<typeof buildMeasurementGridLayout>, itemIndex: number, fallback: number): number {
  return findLayoutRow(layout, itemIndex)?.columns || fallback;
}

function getScrollTopForItemIndex(
  layout: ReturnType<typeof buildMeasurementGridLayout>,
  itemIndex: number,
  options: { currentScrollTop: number; viewportHeight: number },
) {
  const row = findLayoutRow(layout, itemIndex);
  if (!row) return options.currentScrollTop;
  if (row.top < options.currentScrollTop) return row.top;
  if (row.bottom > options.currentScrollTop + options.viewportHeight) return row.bottom - options.viewportHeight;
  return options.currentScrollTop;
}

const layout = buildMeasurementGridLayout(makeGridGroups());

function measureSelectionScroll() {
  let selectedIdx = 0;
  let scrollTop = 0;
  let scrollUpdates = 0;
  let scrollDistance = 0;
  let columnsChecksum = 0;
  const viewportHeight = 640;
  const started = performance.now();

  for (let step = 0; step < selectionSteps; step += 1) {
    const columns = getColumnsForItemIndex(layout, selectedIdx, GRID_DEFAULT_COLUMNS);
    columnsChecksum += columns;
    const direction = step % 29 === 0 ? -1 : 1;
    selectedIdx = Math.max(0, Math.min(itemCount - 1, selectedIdx + direction * columns));
    const nextScrollTop = getScrollTopForItemIndex(layout, selectedIdx, {
      currentScrollTop: scrollTop,
      viewportHeight,
    });
    if (Math.abs(nextScrollTop - scrollTop) >= 1) {
      scrollUpdates += 1;
      scrollDistance += Math.abs(nextScrollTop - scrollTop);
      scrollTop = nextScrollTop;
    }
  }

  return {
    durationMs: performance.now() - started,
    selectionSteps,
    scrollUpdates,
    finalScrollTop: scrollTop,
    scrollDistance,
    columnsChecksum,
  };
}

for (let i = 0; i < warmups; i += 1) {
  renderVisibleWindow(i % visibleCells);
  measureSelectionScroll();
}

const cellSamples = Array.from({ length: iterations }, (_, index) => renderVisibleWindow(index % visibleCells));
const scrollSamples = Array.from({ length: iterations }, () => measureSelectionScroll());
const selectionChurnSamples = [];
for (let index = 0; index < iterations; index += 1) {
  selectionChurnSamples.push(await measureClientSelectionChurn());
}
const cellDurations = cellSamples.map((sample) => sample.durationMs);
const scrollDurations = scrollSamples.map((sample) => sample.durationMs);
const selectionChurnDurations = selectionChurnSamples.map((sample) => sample.durationMs);

const summary = {
  visibleCells,
  itemCount,
  selectionSteps,
  iterations,
  cellRender: {
    cellRenderCount: cellSamples[0]?.cellRenderCount || 0,
    medianDurationMs: median(cellDurations),
    p95DurationMs: percentile(cellDurations, 0.95),
    minDurationMs: Math.min(...cellDurations),
    maxDurationMs: Math.max(...cellDurations),
    htmlLength: cellSamples[0]?.htmlLength || 0,
  },
  selectionScroll: {
    scrollUpdates: scrollSamples[0]?.scrollUpdates || 0,
    finalScrollTop: scrollSamples[0]?.finalScrollTop || 0,
    scrollDistance: scrollSamples[0]?.scrollDistance || 0,
    columnsChecksum: scrollSamples[0]?.columnsChecksum || 0,
    medianDurationMs: median(scrollDurations),
    p95DurationMs: percentile(scrollDurations, 0.95),
    minDurationMs: Math.min(...scrollDurations),
    maxDurationMs: Math.max(...scrollDurations),
  },
  selectionRenderChurn: {
    cellRenderCount: selectionChurnSamples[0]?.cellRenderCount || 0,
    medianDurationMs: median(selectionChurnDurations),
    p95DurationMs: percentile(selectionChurnDurations, 0.95),
    minDurationMs: Math.min(...selectionChurnDurations),
    maxDurationMs: Math.max(...selectionChurnDurations),
  },
};

if (!jsonOnly) {
  console.log(\`Raycast Grid render churn measurement (visibleCells=\${visibleCells}, items=\${itemCount}, iterations=\${iterations})\`);
  console.log([
    '- visible cell render',
    \`cellRenders=\${summary.cellRender.cellRenderCount}\`,
    \`median=\${summary.cellRender.medianDurationMs.toFixed(3)}ms\`,
    \`p95=\${summary.cellRender.p95DurationMs.toFixed(3)}ms\`,
    \`min=\${summary.cellRender.minDurationMs.toFixed(3)}ms\`,
    \`max=\${summary.cellRender.maxDurationMs.toFixed(3)}ms\`,
  ].join(' | '));
  console.log([
    '- rapid selection scroll',
    \`steps=\${selectionSteps}\`,
    \`scrollUpdates=\${summary.selectionScroll.scrollUpdates}\`,
    \`median=\${summary.selectionScroll.medianDurationMs.toFixed(3)}ms\`,
    \`p95=\${summary.selectionScroll.p95DurationMs.toFixed(3)}ms\`,
  ].join(' | '));
  console.log([
    '- selection render churn',
    \`steps=\${selectionSteps}\`,
    \`cellRenders=\${summary.selectionRenderChurn.cellRenderCount}\`,
    \`median=\${summary.selectionRenderChurn.medianDurationMs.toFixed(3)}ms\`,
    \`p95=\${summary.selectionRenderChurn.p95DurationMs.toFixed(3)}ms\`,
  ].join(' | '));
}

console.log(JSON.stringify(summary, null, 2));
`);

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
    plugins: [{
      name: 'instrument-grid-item-renderer',
      setup(build) {
        build.onLoad({ filter: /grid-runtime-items\.tsx$/ }, async (args) => {
          let source = await fs.readFile(args.path, 'utf8');
          const marker = '    const swatchColor = getGridColor(content);';
          if (!source.includes(marker)) {
            throw new Error('Unable to instrument GridItemRenderer render count.');
          }
          source = source.replace(
            marker,
            '    const __gridMetrics = (globalThis.__raycastGridCellMetrics ||= { cellRenderCount: 0 });\n    __gridMetrics.cellRenderCount += 1;\n' + marker,
          );
          return { contents: source, loader: 'tsx' };
        });
      },
    }],
    logLevel: 'silent',
  });

  await import(pathToFileURL(bundlePath).href);
} finally {
  await fs.rm(tmpDir, { recursive: true, force: true });
}
