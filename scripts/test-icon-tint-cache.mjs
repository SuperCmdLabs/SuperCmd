#!/usr/bin/env node

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const MEASURE_ONLY = process.env.SUPERCMD_TINT_CACHE_MEASURE_ONLY === '1';
const ITERATIONS = 10_000;

const NAMED_COLORS = new Map([
  ['black', { r: 0, g: 0, b: 0 }],
  ['blue', { r: 0, g: 0, b: 255 }],
  ['green', { r: 0, g: 128, b: 0 }],
  ['red', { r: 255, g: 0, b: 0 }],
  ['rebeccapurple', { r: 102, g: 51, b: 153 }],
  ['white', { r: 255, g: 255, b: 255 }],
]);

function parseRgbTriplet(value) {
  const match = String(value).match(/^rgba?\(([^)]+)\)$/i);
  if (!match) return null;
  const parts = match[1].split(',').map((part) => Number.parseFloat(part.trim()));
  if (parts.length < 3 || parts.slice(0, 3).some((part) => Number.isNaN(part))) return null;
  return {
    r: Math.max(0, Math.min(255, Math.round(parts[0]))),
    g: Math.max(0, Math.min(255, Math.round(parts[1]))),
    b: Math.max(0, Math.min(255, Math.round(parts[2]))),
  };
}

function parseHexColor(value) {
  const hex = String(value).trim();
  const match = hex.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (!match) return null;
  const raw = match[1];
  const normalized = raw.length === 3
    ? raw.split('').map((part) => `${part}${part}`).join('')
    : raw.slice(0, 6);
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function toCssRgb(color) {
  return `rgb(${color.r}, ${color.g}, ${color.b})`;
}

function createStyleDeclaration() {
  let color = '';
  return {
    position: '',
    visibility: '',
    pointerEvents: '',
    get color() {
      return color;
    },
    set color(value) {
      const raw = String(value || '').trim();
      if (!raw) {
        color = '';
        return;
      }
      if (parseHexColor(raw) || parseRgbTriplet(raw) || NAMED_COLORS.has(raw.toLowerCase()) || /^var\(--[^)]+\)$/i.test(raw)) {
        color = raw;
        return;
      }
      color = '';
    },
  };
}

function resolveComputedColor(value, cssVariables) {
  const raw = String(value || '').trim();
  const variableMatch = raw.match(/^var\((--[^)]+)\)$/i);
  const color = variableMatch ? String(cssVariables.get(variableMatch[1]) || '').trim() : raw;
  const rgb = parseHexColor(color) || parseRgbTriplet(color) || NAMED_COLORS.get(color.toLowerCase());
  return rgb ? toCssRgb(rgb) : color;
}

function createIconTintHarness() {
  const moduleCache = new Map();
  const cssVariables = new Map([
    ['--surface-base-rgb', '247, 248, 250'],
    ['--accent-color', '#336699'],
  ]);
  let dark = false;
  let rootStyleVersion = 0;
  let elementCreations = 0;
  let bodyAppends = 0;
  let bodyChildCount = 0;
  let computedStyleCalls = 0;
  let throwOnElementComputedStyle = false;
  const observerCallbacks = new Map();

  const documentElement = {
    get className() {
      return dark ? 'dark' : '';
    },
    classList: {
      contains(className) {
        return className === 'dark' && dark;
      },
    },
    getAttribute(attributeName) {
      if (attributeName !== 'style') return '';
      return `--style-version: ${rootStyleVersion}`;
    },
  };
  const documentHead = {};
  const documentBody = {
    appendChild(element) {
      bodyAppends += 1;
      if (element.parentNode !== this) bodyChildCount += 1;
      element.parentNode = this;
    },
    removeChild(element) {
      if (element.parentNode === this) {
        bodyChildCount -= 1;
        element.parentNode = null;
      }
    },
  };

  const documentStub = {
    documentElement,
    head: documentHead,
    body: documentBody,
    createElement() {
      elementCreations += 1;
      return {
        parentNode: null,
        style: createStyleDeclaration(),
        remove() {
          this.parentNode?.removeChild?.(this);
          this.parentNode = null;
        },
      };
    },
  };

  const windowStub = {
    getComputedStyle(target) {
      computedStyleCalls += 1;
      if (target === documentElement) {
        return {
          color: dark ? 'rgb(255, 255, 255)' : 'rgb(17, 23, 32)',
          getPropertyValue(variableName) {
            return cssVariables.get(variableName) || '';
          },
        };
      }
      if (throwOnElementComputedStyle) throw new Error('forced getComputedStyle failure');
      return {
        color: resolveComputedColor(target?.style?.color, cssVariables),
        getPropertyValue() {
          return '';
        },
      };
    },
  };

  class MutationObserverStub {
    constructor(callback) {
      this.callback = callback;
      this.target = null;
    }

    observe(target) {
      this.target = target;
      if (!observerCallbacks.has(target)) observerCallbacks.set(target, new Set());
      observerCallbacks.get(target).add(this.callback);
    }

    disconnect() {
      if (this.target) observerCallbacks.get(this.target)?.delete(this.callback);
      this.target = null;
    }
  }

  function loadTsModule(filePath) {
    const resolvedPath = path.resolve(filePath);
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
      if (request.startsWith('.')) {
        const candidate = path.resolve(path.dirname(resolvedPath), request);
        for (const suffix of ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx']) {
          const nextPath = `${candidate}${suffix}`;
          if (fs.existsSync(nextPath) && fs.statSync(nextPath).isFile()) {
            if (nextPath.endsWith('.ts') || nextPath.endsWith('.tsx')) return loadTsModule(nextPath);
            return require(nextPath);
          }
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
      window: windowStub,
      document: documentStub,
      MutationObserver: MutationObserverStub,
    };

    vm.runInNewContext(transpiled.outputText, sandbox, { filename: resolvedPath });
    return module.exports;
  }

  function setDark(nextDark) {
    dark = nextDark;
    cssVariables.set('--surface-base-rgb', dark ? '30, 31, 36' : '247, 248, 250');
  }

  function setCssVariable(variableName, value) {
    cssVariables.set(variableName, value);
    rootStyleVersion += 1;
  }

  function setStylesheetCssVariable(variableName, value) {
    cssVariables.set(variableName, value);
    for (const callback of observerCallbacks.get(documentHead) || []) {
      callback([{ type: 'childList', target: documentHead }]);
    }
  }

  function setThrowOnElementComputedStyle(shouldThrow) {
    throwOnElementComputedStyle = shouldThrow;
  }

  function resetCounts() {
    elementCreations = 0;
    bodyAppends = 0;
    bodyChildCount = 0;
    computedStyleCalls = 0;
  }

  return {
    assets: loadTsModule('src/renderer/src/raycast-api/icon-runtime-assets.tsx'),
    setDark,
    setCssVariable,
    setStylesheetCssVariable,
    setThrowOnElementComputedStyle,
    resetCounts,
    get counts() {
      return {
        elementCreations,
        bodyAppends,
        bodyChildCount,
        computedStyleCalls,
      };
    },
  };
}

function measureScenario(name, scenario) {
  const harness = createIconTintHarness();
  const start = performance.now();
  const result = scenario(harness);
  const elapsedMs = performance.now() - start;
  const counts = harness.counts;
  console.log(
    `icon-tint-cache measurement: scenario=${name} iterations=${ITERATIONS} elementCreations=${counts.elementCreations} bodyAppends=${counts.bodyAppends} getComputedStyle=${counts.computedStyleCalls} elapsedMs=${elapsedMs.toFixed(3)}`,
  );
  return { result, counts };
}

function assertCacheCount(actual, max, label) {
  if (MEASURE_ONLY) return;
  assert.ok(actual <= max, `${label}: expected <= ${max}, got ${actual}`);
}

test('icon tint color cache', async (t) => {
  await t.test('preserves string, hex, invalid, and object tint semantics', () => {
    const harness = createIconTintHarness();
    const { resolveTintColor } = harness.assets;

    assert.equal(resolveTintColor('336699'), '#336699');
    assert.equal(resolveTintColor('#336699'), '#336699');
    assert.equal(resolveTintColor('rebeccapurple'), 'rebeccapurple');
    assert.equal(resolveTintColor('definitely-not-a-color'), undefined);

    const tint = { light: 'red', dark: 'blue' };
    assert.equal(resolveTintColor(tint), 'red');
    harness.setDark(true);
    assert.equal(resolveTintColor(tint), 'blue');

    assert.equal(resolveTintColor({ light: 'red' }), 'red');
    harness.setDark(false);
    assert.equal(resolveTintColor({ dark: 'blue' }), 'blue');
  });

  await t.test('caches repeated string tint validation', () => {
    const { result, counts } = measureScenario('resolveTintColor-string', (harness) => {
      let resolved;
      for (let i = 0; i < ITERATIONS; i += 1) {
        resolved = harness.assets.resolveTintColor('336699');
      }
      return resolved;
    });

    assert.equal(result, '#336699');
    assertCacheCount(counts.elementCreations, 1, 'string tint validation element creations');
  });

  await t.test('caches repeated object tint validation per selected theme color', () => {
    const { result, counts } = measureScenario('resolveTintColor-object-light-dark', (harness) => {
      const tint = { light: 'red', dark: 'blue' };
      let resolved = '';
      for (let i = 0; i < ITERATIONS; i += 1) {
        resolved = harness.assets.resolveTintColor(tint) || '';
      }
      harness.setDark(true);
      for (let i = 0; i < ITERATIONS; i += 1) {
        resolved = harness.assets.resolveTintColor(tint) || '';
      }
      return resolved;
    });

    assert.equal(result, 'blue');
    assertCacheCount(counts.elementCreations, 2, 'object tint validation element creations');
  });

  await t.test('caches readable tint DOM parsing and root CSS variable reads', () => {
    const { result, counts } = measureScenario('resolveReadableTintColor-repeat', (harness) => {
      let resolved;
      for (let i = 0; i < ITERATIONS; i += 1) {
        resolved = harness.assets.resolveReadableTintColor('#777777', { minContrast: 4.25 });
      }
      return resolved;
    });

    assert.equal(typeof result, 'string');
    assertCacheCount(counts.elementCreations, 2, 'readable tint element creations');
    assertCacheCount(counts.computedStyleCalls, 2, 'readable tint getComputedStyle calls');
  });

  await t.test('invalidates readable tint results when theme or root style changes', () => {
    const harness = createIconTintHarness();
    const { resolveReadableTintColor } = harness.assets;

    const light = resolveReadableTintColor('#777777', { minContrast: 4.25 });
    const lightCounts = harness.counts;
    harness.setDark(true);
    const dark = resolveReadableTintColor('#777777', { minContrast: 4.25 });
    const darkCounts = harness.counts;
    harness.setCssVariable('--surface-base-rgb', '5, 5, 5');
    const darker = resolveReadableTintColor('#777777', { minContrast: 4.25 });

    assert.notEqual(light, dark);
    assert.equal(typeof dark, 'string');
    assert.equal(darker, '#777777');
    assert.notEqual(dark, darker);
    assert.ok(darkCounts.computedStyleCalls > lightCounts.computedStyleCalls);
    assert.ok(harness.counts.computedStyleCalls > darkCounts.computedStyleCalls);
  });

  await t.test('invalidates readable tint results when stylesheet variables change', () => {
    const harness = createIconTintHarness();
    const { resolveReadableTintColor } = harness.assets;

    const light = resolveReadableTintColor('#777777', { minContrast: 4.25 });
    const lightCounts = harness.counts;
    harness.setStylesheetCssVariable('--surface-base-rgb', '5, 5, 5');
    const darker = resolveReadableTintColor('#777777', { minContrast: 4.25 });

    assert.equal(darker, '#777777');
    assert.notEqual(light, darker);
    assert.ok(harness.counts.computedStyleCalls > lightCounts.computedStyleCalls);
  });

  await t.test('removes temporary color parse element when computed style throws', () => {
    const harness = createIconTintHarness();
    const { resolveReadableTintColor } = harness.assets;

    harness.setThrowOnElementComputedStyle(true);
    assert.equal(resolveReadableTintColor('#777777', { minContrast: 4.25 }), '#777777');
    assert.equal(harness.counts.bodyChildCount, 0);
  });
});
