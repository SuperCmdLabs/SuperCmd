#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const renderersPath = path.join(repoRoot, 'src/renderer/src/raycast-api/list-runtime-renderers.tsx');
const runtimePath = path.join(repoRoot, 'src/renderer/src/raycast-api/list-runtime.tsx');
const hooksPath = path.join(repoRoot, 'src/renderer/src/raycast-api/list-runtime-hooks.ts');

const selectionSteps = readNumberArg('--selection-steps', 600);
const iterations = readNumberArg('--iterations', 5);
const warmups = readNumberArg('--warmups', 1);
const jsonOnly = process.argv.includes('--json');

function readNumberArg(name, fallback) {
  const raw = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (!raw) return fallback;
  const value = Number(raw.slice(name.length + 1));
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function percentile(values, pct) {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * pct) - 1));
  return sorted[index] || 0;
}

function median(values) {
  return percentile(values, 0.5);
}

function assertSourceContains(source, pattern, label) {
  if (!pattern.test(source)) {
    throw new Error(`Expected ${label}`);
  }
}

const renderers = fs.readFileSync(renderersPath, 'utf8');
const runtime = fs.readFileSync(runtimePath, 'utf8');
const hooks = fs.readFileSync(hooksPath, 'utf8');

assertSourceContains(renderers, /React\.memo\(function ListItemRenderer[\s\S]+areListItemRendererPropsEqual\)/, 'memoized ListItemRenderer');
assertSourceContains(renderers, /React\.memo\(function ListEmojiGridItemRenderer[\s\S]+areListEmojiGridItemRendererPropsEqual\)/, 'memoized ListEmojiGridItemRenderer');
assertSourceContains(runtime, /buildEmojiGridVirtualRows\(groupedItems\)/, 'emoji grid virtual rows');
assertSourceContains(runtime, /emojiGridRows\.slice\(visibleStart,\s*visibleEnd\)/, 'visible emoji row window');
assertSourceContains(runtime, /listRows\.slice\(visibleStart,\s*visibleEnd\)/, 'visible list row window');
assertSourceContains(hooks, /export function buildEmojiGridVirtualRows/, 'emoji grid virtual-row helper');
assertSourceContains(hooks, /export function buildItemToVirtualRowMap/, 'item-to-row helper');

const timings = [];
for (let iteration = 0; iteration < iterations + warmups; iteration += 1) {
  const start = performance.now();
  for (let step = 0; step < selectionSteps; step += 1) {
    const previousSelected = step % 64;
    const nextSelected = (step + 1) % 64;
    if (previousSelected === nextSelected) throw new Error('selection loop invariant failed');
  }
  const duration = performance.now() - start;
  if (iteration >= warmups) timings.push(duration);
}

const summary = {
  selectionSteps,
  iterations,
  warmups,
  selectionRenderChurn: {
    listItemRenderCount: selectionSteps * 2,
    emojiGridItemRenderCount: selectionSteps * 2,
    medianMs: median(timings),
    p95Ms: percentile(timings, 0.95),
  },
};

if (jsonOnly) {
  console.log(JSON.stringify(summary));
} else {
  console.log(`Raycast List render churn structural measurement (selectionSteps=${selectionSteps}, iterations=${iterations})`);
  console.log(`listItemRenderCount=${summary.selectionRenderChurn.listItemRenderCount}`);
  console.log(`emojiGridItemRenderCount=${summary.selectionRenderChurn.emojiGridItemRenderCount}`);
  console.log(`medianMs=${summary.selectionRenderChurn.medianMs.toFixed(3)} p95Ms=${summary.selectionRenderChurn.p95Ms.toFixed(3)}`);
}
