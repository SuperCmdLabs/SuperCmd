#!/usr/bin/env node

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {
  createCachedMenuBarNativeImage,
  createMenuBarNativeImageCache,
} = await import(pathToFileURL(path.join(root, 'src/main/menubar-native-image-cache.ts')).href);

function makeCounters() {
  return {
    createFromBuffer: 0,
    createFromDataURL: 0,
    createFromPath: 0,
    readFileSync: 0,
    resize: 0,
    setTemplateImage: 0,
    statSync: 0,
  };
}

class MockNativeImage {
  constructor(counters, source, width = 32, height = 32, empty = false) {
    this.counters = counters;
    this.source = source;
    this.width = width;
    this.height = height;
    this.empty = empty;
    this.template = undefined;
  }

  isEmpty() {
    return this.empty;
  }

  getSize() {
    return { width: this.width, height: this.height };
  }

  resize(options) {
    this.counters.resize += 1;
    const resized = new MockNativeImage(
      this.counters,
      `${this.source}:resized:${options.width}x${options.height}`,
      options.width,
      options.height,
      this.empty,
    );
    resized.resizeQuality = options.quality;
    return resized;
  }

  setTemplateImage(isTemplate) {
    this.counters.setTemplateImage += 1;
    this.template = isTemplate;
  }
}

function makeNativeImage(counters) {
  return {
    createFromBuffer(_buffer, options = {}) {
      counters.createFromBuffer += 1;
      const logicalSize = options.scaleFactor && options.scaleFactor > 1 ? 18 : 36;
      return new MockNativeImage(counters, `buffer:${options.scaleFactor || 1}`, logicalSize, logicalSize);
    },
    createFromDataURL(dataUrl) {
      counters.createFromDataURL += 1;
      const empty = dataUrl.includes('empty-native-path-svg');
      return new MockNativeImage(counters, `data:${dataUrl.slice(0, 40)}`, 32, 32, empty);
    },
    createFromPath(pathValue) {
      counters.createFromPath += 1;
      const empty = /\.svg$/i.test(pathValue);
      return new MockNativeImage(counters, `path:${pathValue}`, 32, 32, empty);
    },
  };
}

function makeFs(counters, files) {
  return {
    statSync(pathValue) {
      counters.statSync += 1;
      const file = files.get(pathValue);
      if (!file) throw new Error(`ENOENT: ${pathValue}`);
      return {
        size: file.size,
        mtimeMs: file.mtimeMs,
        isFile: () => true,
      };
    },
    readFileSync(pathValue, encoding) {
      assert.equal(encoding, 'utf8');
      counters.readFileSync += 1;
      const file = files.get(pathValue);
      if (!file) throw new Error(`ENOENT: ${pathValue}`);
      return file.body;
    },
  };
}

function pngDataUrl(name) {
  return `data:image/png;base64,${Buffer.from(`png:${name}`).toString('base64')}`;
}

function svgDataUrl(name) {
  return `data:image/svg+xml;base64,${Buffer.from(`<svg>${name}</svg>`).toString('base64')}`;
}

function createIconResolver({ counters, files, sharedCache }) {
  const nativeImage = makeNativeImage(counters);
  const fs = makeFs(counters, files);

  return (icon) => createCachedMenuBarNativeImage({
    cache: sharedCache || createMenuBarNativeImageCache(512),
    nativeImage,
    fs,
    pathValue: icon.pathValue,
    dataUrlValue: icon.dataUrlValue,
    bitmapScale: icon.bitmapScale,
    size: icon.size,
    template: icon.template,
    resizeQuality: icon.resizeQuality,
  });
}

function makeMetricFiles() {
  const files = new Map();
  for (let i = 0; i < 8; i += 1) {
    files.set(`/icons/path-${i}.png`, { size: 100 + i, mtimeMs: 1000 + i, body: `png-${i}` });
  }
  for (let i = 0; i < 4; i += 1) {
    files.set(`/icons/submenu-${i}.svg`, {
      size: 200 + i,
      mtimeMs: 2000 + i,
      body: `<svg>empty-native-path-svg-${i}</svg>`,
    });
  }
  return files;
}

function makeMetricIcons() {
  const icons = [
    {
      dataUrlValue: pngDataUrl('tray'),
      bitmapScale: 2,
      size: 18,
      template: true,
      resizeQuality: 'best',
    },
  ];

  for (let i = 0; i < 16; i += 1) {
    icons.push({ dataUrlValue: svgDataUrl(`item-${i}`), size: 16, template: true });
  }
  for (let i = 0; i < 8; i += 1) {
    icons.push({ dataUrlValue: pngDataUrl(`item-${i}`), bitmapScale: 2, size: 16, template: false });
  }
  for (let i = 0; i < 8; i += 1) {
    icons.push({ pathValue: `/icons/path-${i}.png`, size: 16, template: false });
  }
  for (let i = 0; i < 4; i += 1) {
    icons.push({ pathValue: `/icons/submenu-${i}.svg`, size: 16, template: false });
  }
  return icons;
}

function workCount(counters) {
  return counters.createFromBuffer +
    counters.createFromDataURL +
    counters.createFromPath +
    counters.readFileSync +
    counters.resize;
}

function runRepeatedPayloadMetric({ updates, useSharedCache }) {
  const counters = makeCounters();
  const files = makeMetricFiles();
  const sharedCache = useSharedCache ? createMenuBarNativeImageCache(512) : null;
  const resolveIcon = createIconResolver({ counters, files, sharedCache });
  const icons = makeMetricIcons();

  for (let update = 0; update < updates; update += 1) {
    for (const icon of icons) {
      const image = resolveIcon(icon);
      assert.ok(image, 'metric icon should resolve');
    }
  }

  return counters;
}

test('MenuBarExtra native image cache', async (t) => {
  await t.test('reuses data URL decode and resize work for repeated menu item icons', () => {
    const counters = makeCounters();
    const resolveIcon = createIconResolver({
      counters,
      files: new Map(),
      sharedCache: createMenuBarNativeImageCache(),
    });

    const first = resolveIcon({ dataUrlValue: svgDataUrl('shared'), size: 16, template: true });
    const second = resolveIcon({ dataUrlValue: svgDataUrl('shared'), size: 16, template: true });

    assert.equal(first, second, 'same source, size, scale, and template state should reuse the image');
    assert.equal(counters.createFromDataURL, 1, 'data URL is decoded once');
    assert.equal(counters.resize, 1, 'image is resized once');
    assert.equal(counters.setTemplateImage, 1, 'template state is applied once to the cached image');
  });

  await t.test('keeps template image states isolated in the cache key', () => {
    const counters = makeCounters();
    const resolveIcon = createIconResolver({
      counters,
      files: new Map(),
      sharedCache: createMenuBarNativeImageCache(),
    });
    const dataUrlValue = svgDataUrl('template-split');

    const templated = resolveIcon({ dataUrlValue, size: 16, template: true });
    const original = resolveIcon({ dataUrlValue, size: 16, template: false });

    assert.notEqual(templated, original, 'template and non-template requests must not share a NativeImage object');
    assert.equal(templated.template, true);
    assert.equal(original.template, false);
    assert.equal(counters.createFromDataURL, 2, 'different template states decode separately');
  });

  await t.test('preserves retina data URL handling without repeat buffer decode', () => {
    const counters = makeCounters();
    const resolveIcon = createIconResolver({
      counters,
      files: new Map(),
      sharedCache: createMenuBarNativeImageCache(),
    });
    const dataUrlValue = pngDataUrl('retina-tray');

    const first = resolveIcon({ dataUrlValue, bitmapScale: 2, size: 18, template: true, resizeQuality: 'best' });
    const second = resolveIcon({ dataUrlValue, bitmapScale: 2, size: 18, template: true, resizeQuality: 'best' });

    assert.equal(first, second);
    assert.equal(counters.createFromBuffer, 1, 'retina PNG data URL uses createFromBuffer once');
    assert.equal(counters.createFromDataURL, 0, 'successful buffer decode does not fall back to createFromDataURL');
    assert.equal(counters.resize, 0, 'logical-size retina reps are not resized');
  });

  await t.test('reuses stable path icons and refreshes when file identity changes', () => {
    const counters = makeCounters();
    const files = new Map([
      ['/icons/stable.png', { size: 64, mtimeMs: 10, body: 'png' }],
    ]);
    const resolveIcon = createIconResolver({
      counters,
      files,
      sharedCache: createMenuBarNativeImageCache(),
    });

    const first = resolveIcon({ pathValue: '/icons/stable.png', size: 16, template: false });
    const second = resolveIcon({ pathValue: '/icons/stable.png', size: 16, template: false });
    files.set('/icons/stable.png', { size: 65, mtimeMs: 11, body: 'png-new' });
    const third = resolveIcon({ pathValue: '/icons/stable.png', size: 16, template: false });

    assert.equal(first, second, 'stable file identity should reuse decoded image');
    assert.notEqual(first, third, 'changed file identity should refresh decoded image');
    assert.equal(counters.createFromPath, 2);
    assert.equal(counters.resize, 2);
    assert.equal(counters.statSync, 3, 'path identity is checked each call so changed assets refresh');
  });

  await t.test('caches SVG fallback reads for stable path icons', () => {
    const counters = makeCounters();
    const files = new Map([
      ['/icons/vector.svg', { size: 42, mtimeMs: 100, body: '<svg>empty-native-path-svg</svg>' }],
    ]);
    const resolveIcon = createIconResolver({
      counters,
      files,
      sharedCache: createMenuBarNativeImageCache(),
    });

    const first = resolveIcon({ pathValue: '/icons/vector.svg', size: 16, template: false });
    const second = resolveIcon({ pathValue: '/icons/vector.svg', size: 16, template: false });

    assert.equal(first, second);
    assert.equal(counters.createFromPath, 1, 'native SVG path decode attempted once');
    assert.equal(counters.readFileSync, 1, 'SVG fallback body is read once');
    assert.equal(counters.createFromDataURL, 1, 'SVG fallback data URL is decoded once');
  });

  await t.test('measures repeated accepted payload decode and resize savings', () => {
    const updates = 20;
    const before = runRepeatedPayloadMetric({ updates, useSharedCache: false });
    const after = runRepeatedPayloadMetric({ updates, useSharedCache: true });
    const beforeWork = workCount(before);
    const afterWork = workCount(after);

    t.diagnostic(
      `repeated payload (${updates} updates, 1 tray icon, 36 item/submenu icons): ` +
      `before=${beforeWork} native decode/read/resize operations, after=${afterWork}`,
    );
    t.diagnostic(`before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);

    assert.equal(beforeWork, 1620);
    assert.equal(afterWork, 81);
    assert.ok(afterWork < beforeWork / 10, 'cached path should eliminate repeated native image work');
  });
});
