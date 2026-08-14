#!/usr/bin/env node

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importTs } from './lib/ts-import.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { preserveWhisperTranscript } = await importTs(
  path.join(root, 'src/main/whisper-delivery.ts')
);

test('preserveWhisperTranscript writes a non-empty undelivered transcript to the clipboard', () => {
  const writes = [];
  const preserved = preserveWhisperTranscript('Recover this sentence.', (text) => writes.push(text));

  assert.equal(preserved, true);
  assert.deepEqual(writes, ['Recover this sentence.']);
});

test('preserveWhisperTranscript refuses empty text and contains clipboard-write failures', () => {
  assert.equal(preserveWhisperTranscript('', () => { throw new Error('should not write'); }), false);
  assert.equal(preserveWhisperTranscript('Keep this safe.', () => { throw new Error('clipboard unavailable'); }), false);
});
