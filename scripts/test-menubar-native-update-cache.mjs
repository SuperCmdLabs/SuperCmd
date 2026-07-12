#!/usr/bin/env node

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importTs } from './lib/ts-import.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {
  createMenuBarNativeUpdateState,
  getMenuBarNativeFileIconIdentityKey,
  getMenuBarNativeItemsKey,
  getMenuBarNativeTitle,
  getMenuBarNativeTooltip,
  isMenuBarNativeIconRefreshNeeded,
  isMenuBarNativeMenuUpdateNeeded,
  isMenuBarNativeTitleUpdateNeeded,
  isMenuBarNativeTooltipUpdateNeeded,
  rememberMenuBarNativeIcon,
  rememberMenuBarNativeMenu,
  rememberMenuBarNativeTitle,
  rememberMenuBarNativeTooltip,
} = await importTs(path.join(root, 'src/main/menubar-native-update-cache.ts'));

function makeItems(overrides = {}) {
  return [
    {
      type: 'label',
      title: 'Timer',
    },
    {
      type: 'submenu',
      id: '__mbi_group',
      title: 'Controls',
      children: [
        {
          type: 'item',
          id: '__mbi_pause',
          title: 'Pause',
          subtitle: 'Current session',
          disabled: false,
          alternate: {
            id: '__mbi_pause_alt',
            title: 'Pause without alert',
          },
          ...overrides,
        },
      ],
    },
    {
      type: 'separator',
    },
    {
      type: 'item',
      id: '__mbi_stop',
      title: 'Stop',
      disabled: true,
    },
  ];
}

function makePayload(overrides = {}) {
  return {
    extId: 'demo/timer',
    iconPath: undefined,
    iconDataUrl: undefined,
    iconEmoji: '*',
    iconTemplate: undefined,
    iconBitmapScale: undefined,
    fallbackIconDataUrl: '',
    title: 'Timer',
    tooltip: 'Timer status',
    items: makeItems(),
    ...overrides,
  };
}

function makeCounters() {
  return {
    createTray: 0,
    resolveTrayIcon: 0,
    setImage: 0,
    setTitle: 0,
    setToolTip: 0,
    buildMenuBarTemplate: 0,
    buildFromTemplate: 0,
    setContextMenu: 0,
    statSync: 0,
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
  };
}

function runUncachedNativeWork(payloads) {
  const counters = makeCounters();
  let trayExists = false;

  for (const payload of payloads) {
    counters.resolveTrayIcon += 1;
    if (!trayExists) {
      counters.createTray += 1;
      trayExists = true;
    } else {
      counters.setImage += 1;
    }

    counters.setTitle += 1;
    if (payload.tooltip) counters.setToolTip += 1;
    counters.buildMenuBarTemplate += 1;
    counters.buildFromTemplate += 1;
    counters.setContextMenu += 1;
  }

  return counters;
}

function runCachedNativeWork(payloads, {
  files = new Map([['/tmp/supercmd-timer.png', { size: 64, mtimeMs: 10 }]]),
  iconResolvesOk = true,
  onBeforePayload,
} = {}) {
  const counters = makeCounters();
  const state = createMenuBarNativeUpdateState();
  const fs = makeFs(counters, files);
  let trayExists = false;

  for (let index = 0; index < payloads.length; index += 1) {
    onBeforePayload?.(index, files);
    const payload = payloads[index];
    const nextFileIdentityKey = getMenuBarNativeFileIconIdentityKey(payload, fs);

    if (!trayExists) {
      counters.resolveTrayIcon += 1;
      counters.createTray += 1;
      trayExists = true;
      rememberMenuBarNativeIcon(state, payload, iconResolvesOk, nextFileIdentityKey);
    } else if (isMenuBarNativeIconRefreshNeeded(state, payload, nextFileIdentityKey)) {
      counters.resolveTrayIcon += 1;
      counters.setImage += 1;
      rememberMenuBarNativeIcon(state, payload, iconResolvesOk, nextFileIdentityKey);
    }

    const nextTitle = getMenuBarNativeTitle(payload, state.lastResolvedTrayIconOk);
    if (isMenuBarNativeTitleUpdateNeeded(state, nextTitle)) {
      counters.setTitle += 1;
      rememberMenuBarNativeTitle(state, nextTitle);
    }

    const nextTooltip = getMenuBarNativeTooltip(payload);
    if (isMenuBarNativeTooltipUpdateNeeded(state, nextTooltip)) {
      counters.setToolTip += 1;
      rememberMenuBarNativeTooltip(state, nextTooltip);
    }

    const nextItemsKey = getMenuBarNativeItemsKey(payload.items);
    if (isMenuBarNativeMenuUpdateNeeded(state, nextItemsKey)) {
      counters.buildMenuBarTemplate += 1;
      counters.buildFromTemplate += 1;
      counters.setContextMenu += 1;
      rememberMenuBarNativeMenu(state, nextItemsKey);
    }
  }

  return counters;
}

test('MenuBarExtra native update cache', async (t) => {
  await t.test('rebuilds stable native menus once across 60 title ticks', () => {
    const payloads = Array.from({ length: 60 }, (_, index) => makePayload({
      title: `Timer ${String(index).padStart(2, '0')}`,
    }));
    const before = runUncachedNativeWork(payloads);
    const after = runCachedNativeWork(payloads);

    t.diagnostic(
      `60 title ticks with unchanged items: before=${before.buildFromTemplate} Menu.buildFromTemplate calls, ` +
      `after=${after.buildFromTemplate}`,
    );
    t.diagnostic(
      `60 title ticks with unchanged items: before=${before.setContextMenu} setContextMenu calls, ` +
      `after=${after.setContextMenu}`,
    );

    assert.equal(before.buildFromTemplate, 60);
    assert.equal(before.setContextMenu, 60);
    assert.equal(after.buildFromTemplate, 1);
    assert.equal(after.setContextMenu, 1);
    assert.equal(after.setTitle, 60, 'changing title text still updates the native title every tick');
    assert.equal(after.setToolTip, 1, 'stable tooltip is applied once');
    assert.equal(after.setImage, 0, 'stable non-file icon payload does not call setImage after tray creation');
  });

  await t.test('rebuilds when serialized item payloads change', () => {
    const payloads = [
      makePayload(),
      makePayload({ title: 'Timer tick' }),
      makePayload({
        title: 'Timer tick 2',
        items: makeItems({
          alternate: {
            id: '__mbi_pause_alt',
            title: 'Pause silently',
          },
        }),
      }),
      makePayload({
        title: 'Timer tick 3',
        items: makeItems({
          alternate: {
            id: '__mbi_pause_alt',
            title: 'Pause silently',
          },
        }),
      }),
    ];
    const after = runCachedNativeWork(payloads);

    assert.equal(after.buildFromTemplate, 2, 'initial menu and changed serialized items rebuild');
    assert.equal(after.setContextMenu, 2);
  });

  await t.test('skips native image refresh for stable file-backed tray icon title ticks', () => {
    const payloads = Array.from({ length: 3 }, (_, index) => makePayload({
      iconEmoji: undefined,
      iconPath: '/tmp/supercmd-timer.png',
      title: `Timer ${index}`,
    }));
    const after = runCachedNativeWork(payloads);

    assert.equal(after.resolveTrayIcon, 1, 'stable file-backed icons resolve only for tray creation');
    assert.equal(after.setImage, 0, 'stable file-backed title ticks skip native setImage');
    assert.equal(after.statSync, 3, 'file identity is checked each accepted update');
    assert.equal(after.setTitle, 3, 'changing title text still updates the native title every tick');
    assert.equal(after.buildFromTemplate, 1);
  });

  await t.test('refreshes file-backed tray icons when file identity changes', () => {
    const payloads = Array.from({ length: 3 }, (_, index) => makePayload({
      iconEmoji: undefined,
      iconPath: '/tmp/supercmd-timer.png',
      title: `Timer ${index}`,
    }));
    const after = runCachedNativeWork(payloads, {
      onBeforePayload(index, files) {
        if (index === 1) {
          files.set('/tmp/supercmd-timer.png', { size: 65, mtimeMs: 11 });
        }
      },
    });

    assert.equal(after.resolveTrayIcon, 2, 'changed file identity re-resolves the tray icon');
    assert.equal(after.setImage, 1, 'changed file identity updates the existing native tray image');
    assert.equal(after.statSync, 3, 'file identity continues to be checked each accepted update');
    assert.equal(after.buildFromTemplate, 1);
  });

  await t.test('refreshes file-backed tray icons when image inputs change', () => {
    const payloads = [
      makePayload({
        iconEmoji: undefined,
        iconPath: '/tmp/supercmd-timer.png',
        iconTemplate: true,
        iconBitmapScale: 1,
        fallbackIconDataUrl: 'data:image/png;base64,ZmFsbGJhY2sx',
      }),
      makePayload({
        iconEmoji: undefined,
        iconPath: '/tmp/supercmd-timer.png',
        iconTemplate: false,
        iconBitmapScale: 1,
        fallbackIconDataUrl: 'data:image/png;base64,ZmFsbGJhY2sx',
      }),
      makePayload({
        iconEmoji: undefined,
        iconPath: '/tmp/supercmd-timer.png',
        iconTemplate: false,
        iconBitmapScale: 2,
        fallbackIconDataUrl: 'data:image/png;base64,ZmFsbGJhY2sx',
      }),
      makePayload({
        iconEmoji: undefined,
        iconPath: '/tmp/supercmd-timer.png',
        iconTemplate: false,
        iconBitmapScale: 2,
        fallbackIconDataUrl: 'data:image/png;base64,ZmFsbGJhY2sy',
      }),
    ];
    const after = runCachedNativeWork(payloads);

    assert.equal(after.resolveTrayIcon, 4, 'template, scale, and fallback changes re-resolve the tray icon');
    assert.equal(after.setImage, 3, 'template, scale, and fallback changes update the existing tray image');
    assert.equal(after.statSync, 4);
    assert.equal(after.buildFromTemplate, 1);
  });

  await t.test('preserves fallback title decisions', () => {
    assert.equal(getMenuBarNativeTitle(makePayload({ title: '', iconEmoji: '+' }), false), '+');
    assert.equal(getMenuBarNativeTitle(makePayload({ title: '', iconEmoji: '' }), false), '\u23f1');
    assert.equal(getMenuBarNativeTitle(makePayload({ title: '', iconEmoji: '' }), true), '');
  });

  await t.test('keeps empty tooltip payloads non-clearing', () => {
    const state = createMenuBarNativeUpdateState();
    const initialTooltip = getMenuBarNativeTooltip(makePayload({ tooltip: 'Timer status' }));
    assert.equal(isMenuBarNativeTooltipUpdateNeeded(state, initialTooltip), true);
    rememberMenuBarNativeTooltip(state, initialTooltip);

    const emptyTooltip = getMenuBarNativeTooltip(makePayload({ tooltip: '' }));
    assert.equal(isMenuBarNativeTooltipUpdateNeeded(state, emptyTooltip), false);
    assert.equal(state.tooltip, 'Timer status');
  });
});
