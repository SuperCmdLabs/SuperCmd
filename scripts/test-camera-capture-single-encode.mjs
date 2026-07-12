#!/usr/bin/env node

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importTs } from './lib/ts-import.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cameraExtensionPath = path.join(root, 'src/renderer/src/CameraExtension.tsx');
const cameraCapturePath = path.join(root, 'src/renderer/src/camera-capture.ts');
const mainPath = path.join(root, 'src/main/main.ts');

const {
  createCapturePreview,
  createCapturePreviewUrlManager,
  encodeCanvasAsPngBlob,
} = await importTs(cameraCapturePath);

function makeMockCanvas(blob = new Blob(['fake-png'], { type: 'image/png' })) {
  const calls = {
    toBlob: [],
    toDataURL: [],
  };

  return {
    calls,
    toBlob(callback, type) {
      calls.toBlob.push(type);
      callback(blob);
    },
    toDataURL(type) {
      calls.toDataURL.push(type);
      return 'data:image/png;base64,legacy-preview';
    },
  };
}

function makeMockUrlApi() {
  const created = [];
  const revoked = [];

  return {
    created,
    revoked,
    api: {
      createObjectURL(blob) {
        const objectUrl = `blob:supercmd-test-${created.length + 1}`;
        created.push({ objectUrl, blob });
        return objectUrl;
      },
      revokeObjectURL(objectUrl) {
        revoked.push(objectUrl);
      },
    },
  };
}

test('Camera capture single-encode path', async (t) => {
  await t.test('mock canvas catches the legacy duplicate encode baseline', async () => {
    const canvas = makeMockCanvas();

    canvas.toDataURL('image/png');
    await new Promise((resolve) => {
      canvas.toBlob(resolve, 'image/png');
    });

    assert.deepEqual(canvas.calls.toDataURL, ['image/png']);
    assert.deepEqual(canvas.calls.toBlob, ['image/png']);
  });

  await t.test('production capture encoding calls toBlob once and never toDataURL', async () => {
    const expectedBlob = new Blob(['fake-png'], { type: 'image/png' });
    const canvas = makeMockCanvas(expectedBlob);

    const blob = await encodeCanvasAsPngBlob(canvas);

    assert.equal(blob, expectedBlob);
    assert.deepEqual(canvas.calls.toBlob, ['image/png']);
    assert.deepEqual(canvas.calls.toDataURL, []);
  });

  await t.test('capture preview is shown from an object URL', () => {
    const { api, created, revoked } = makeMockUrlApi();
    const manager = createCapturePreviewUrlManager(api);
    const blob = new Blob(['preview'], { type: 'image/png' });

    const preview = createCapturePreview(blob, manager);

    assert.deepEqual(preview, { url: 'blob:supercmd-test-1', visible: true });
    assert.equal(created.length, 1);
    assert.equal(created[0].blob, blob);
    assert.deepEqual(revoked, []);
  });

  await t.test('object URL is revoked when preview is cleared', () => {
    const { api, revoked } = makeMockUrlApi();
    const manager = createCapturePreviewUrlManager(api);

    createCapturePreview(new Blob(['preview'], { type: 'image/png' }), manager);
    assert.equal(manager.getCurrentUrl(), 'blob:supercmd-test-1');

    manager.clear();

    assert.equal(manager.getCurrentUrl(), null);
    assert.deepEqual(revoked, ['blob:supercmd-test-1']);
  });

  await t.test('object URL is revoked when preview manager is disposed on unmount', () => {
    const { api, revoked } = makeMockUrlApi();
    const manager = createCapturePreviewUrlManager(api);

    createCapturePreview(new Blob(['preview'], { type: 'image/png' }), manager);
    manager.dispose();

    assert.equal(manager.getCurrentUrl(), null);
    assert.deepEqual(revoked, ['blob:supercmd-test-1']);
  });

  await t.test('component wires the object URL preview to clear and unmount paths', () => {
    const source = fs.readFileSync(cameraExtensionPath, 'utf8');

    assert.ok(source.includes('const captureBlob = await encodeCanvasAsPngBlob(canvas);'));
    assert.ok(source.includes("from './camera-capture';"));
    assert.ok(!source.includes('.toDataURL('));
    assert.ok(source.includes('src={capturePreviewUrl}'));
    assert.ok(source.includes('clearCapturePreview();'));
    assert.ok(source.includes('capturePreviewUrlManagerRef.current?.dispose();'));
  });
});

test('Camera capture save path avoids redundant mkdir subprocess', async (t) => {
  await t.test('camera capture writes image bytes without shelling out for mkdir', () => {
    const source = fs.readFileSync(cameraExtensionPath, 'utf8');

    assert.ok(!source.includes('/bin/mkdir'));
    assert.ok(!source.includes("['-p', saveDir]"));
    assert.ok(source.includes('const saveDir = homeDir ? `${homeDir}/Pictures/SuperCmd Captures` : \'/tmp/SuperCmd Captures\';'));
    assert.ok(source.includes('const savePath = `${saveDir}/supercmd-capture-${timestamp}.png`;'));
    assert.ok(source.includes('const bytes = new Uint8Array(await captureBlob.arrayBuffer());'));
    assert.ok(source.includes('await window.electron.fsWriteBinaryFile(savePath, bytes);'));
  });

  await t.test('fsWriteBinaryFile IPC creates parent directories recursively', () => {
    const source = fs.readFileSync(mainPath, 'utf8');
    const mkdirLine = 'await fs.promises.mkdir(nodePath.dirname(filePath), { recursive: true });';
    const writeLine = 'await fs.promises.writeFile(filePath, Buffer.from(data));';

    assert.ok(source.includes("ipcMain.handle('fs-write-binary-file'"));
    assert.ok(source.includes(mkdirLine));
    assert.ok(source.includes(writeLine));
    assert.ok(source.indexOf(mkdirLine) < source.indexOf(writeLine));
  });
});
