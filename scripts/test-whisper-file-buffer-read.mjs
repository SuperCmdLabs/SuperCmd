#!/usr/bin/env node

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { importTs } from './lib/ts-import.mjs';

const {
  resolveWhisperFileTranscriptionPlan,
  shouldReadWhisperFileAudioBuffer,
  transcribeWhisperAudioFile,
} = await importTs(path.resolve('src/main/whisper-transcribe-file.ts'));

const AUDIO_PATH = '/tmp/supercmd-whisper-file-buffer-read/input.wav';
const DEFAULT_FILE_BYTES = 73_400_320;

function makeSettings(speechToTextModel) {
  return {
    ai: {
      enabled: true,
      whisperEnabled: true,
      speechToTextModel,
      speechLanguage: 'en-US',
      openaiApiKey: 'openai-key',
      elevenlabsApiKey: 'elevenlabs-key',
      mistralApiKey: 'mistral-key',
    },
  };
}

function makeHarness({ speechToTextModel = 'whispercpp', exists = true, fileBytes = DEFAULT_FILE_BYTES } = {}) {
  const events = [];
  const fakeAudioBuffer = Buffer.from('fake wav bytes');
  const calls = {
    parakeet: [],
    qwen3: [],
    openai: [],
    elevenlabs: [],
    mistral: [],
    whispercpp: [],
  };
  let readCalls = 0;
  let nodeBufferBytes = 0;

  const fs = {
    existsSync(filePath) {
      events.push(`exists:${filePath}`);
      return exists;
    },
    readFileSync(filePath) {
      events.push(`read:${filePath}`);
      readCalls += 1;
      nodeBufferBytes += fileBytes;
      return fakeAudioBuffer;
    },
    unlinkSync(filePath) {
      events.push(`unlink:${filePath}`);
    },
    rmdirSync(dirPath, options) {
      events.push(`rmdir:${dirPath}:${JSON.stringify(options)}`);
    },
  };

  const makeTranscriber = (label) => async (opts) => {
    events.push(`transcribe:${label}`);
    calls[label].push(opts);
    return `${label} transcript`;
  };

  const deps = {
    fs,
    loadSettings: () => makeSettings(speechToTextModel),
    isAIDisabledInSettings: (settings) => settings.ai?.enabled === false,
    normalizeWhisperLanguageCode: (rawLanguage) => String(rawLanguage || 'en-US').split('-')[0].toLowerCase(),
    resolveElevenLabsSttModel: (model) => model.replace(/^elevenlabs-/, '').replace(/-/g, '_') || 'scribe_v1',
    getElevenLabsApiKey: (settings) => settings.ai?.elevenlabsApiKey || '',
    getMistralApiKey: (settings) => settings.ai?.mistralApiKey || '',
    getWhisperCppModelStatus: () => {
      events.push('status:whispercpp');
      return { state: 'downloaded' };
    },
    ensureWhisperCppServer: async () => {
      events.push('ensure:whispercpp');
    },
    sendWhisperCppRequest: async (request) => {
      events.push('send:whispercpp');
      calls.whispercpp.push(request);
      return { text: 'whispercpp transcript' };
    },
    transcribeAudioWithParakeet: makeTranscriber('parakeet'),
    transcribeAudioWithQwen3: makeTranscriber('qwen3'),
    transcribeAudioWithElevenLabs: makeTranscriber('elevenlabs'),
    transcribeAudioWithMistralVoxtral: makeTranscriber('mistral'),
    transcribeAudio: makeTranscriber('openai'),
    whisperCppModelName: 'base',
  };

  return {
    calls,
    deps,
    events,
    fakeAudioBuffer,
    fileBytes,
    get nodeBufferBytes() {
      return nodeBufferBytes;
    },
    get readCalls() {
      return readCalls;
    },
  };
}

function assertCleanupAfter(events, marker) {
  const markerIndex = events.indexOf(marker);
  const unlinkIndex = events.findIndex((event) => event.startsWith('unlink:'));
  const rmdirIndex = events.findIndex((event) => event.startsWith('rmdir:'));

  assert.notEqual(markerIndex, -1, `${marker} should be recorded`);
  assert.ok(unlinkIndex > markerIndex, 'temp audio file should be unlinked after transcription succeeds');
  assert.ok(rmdirIndex > unlinkIndex, 'temp audio directory should be removed after the file unlink');
}

test('provider plan marks only buffer-backed file providers as requiring a Node buffer', () => {
  const cases = [
    ['', 'whispercpp', false],
    ['default', 'whispercpp', false],
    ['whispercpp', 'whispercpp', false],
    ['custom-local-model', 'whispercpp', false],
    ['native', 'native', false],
    ['parakeet', 'parakeet', true],
    ['qwen3', 'qwen3', true],
    ['openai-whisper-1', 'openai', true],
    ['elevenlabs-scribe-v2', 'elevenlabs', true],
    ['mistral-voxtral-mini-latest', 'mistral', true],
  ];

  for (const [speechToTextModel, expectedProvider, expectedRead] of cases) {
    const plan = resolveWhisperFileTranscriptionPlan(speechToTextModel, {
      whisperCppModelName: 'base',
      resolveElevenLabsSttModel: (model) => model,
    });
    assert.equal(plan.provider, expectedProvider, `${speechToTextModel || '(empty)'} provider`);
    assert.equal(
      shouldReadWhisperFileAudioBuffer(plan.provider),
      expectedRead,
      `${speechToTextModel || '(empty)'} read requirement`
    );
  }
});

test('whispercpp file transcription sends the file path without reading a Node buffer', async () => {
  const harness = makeHarness({ speechToTextModel: 'whispercpp' });

  const text = await transcribeWhisperAudioFile({
    audioPath: AUDIO_PATH,
    options: { language: 'en-US' },
    deps: harness.deps,
  });

  assert.equal(text, 'whispercpp transcript');
  assert.equal(harness.readCalls, 0);
  assert.equal(harness.nodeBufferBytes, 0);
  assert.deepEqual(harness.calls.whispercpp, [
    { command: 'transcribe', file: AUDIO_PATH, language: 'en' },
  ]);
  assertCleanupAfter(harness.events, 'send:whispercpp');
});

test('buffer-backed file providers read the audio file once and clean up after transcription', async () => {
  const cases = [
    ['parakeet', 'parakeet'],
    ['qwen3', 'qwen3'],
    ['openai-whisper-1', 'openai'],
    ['elevenlabs-scribe-v2', 'elevenlabs'],
    ['mistral-voxtral-mini-latest', 'mistral'],
  ];

  for (const [speechToTextModel, label] of cases) {
    const harness = makeHarness({ speechToTextModel });

    const text = await transcribeWhisperAudioFile({
      audioPath: AUDIO_PATH,
      options: { language: 'en-US' },
      deps: harness.deps,
    });

    assert.equal(text, `${label} transcript`);
    assert.equal(harness.readCalls, 1, `${label} should read the captured file exactly once`);
    assert.equal(harness.nodeBufferBytes, harness.fileBytes, `${label} should account for one full file buffer read`);
    assert.equal(harness.calls[label].length, 1, `${label} transcriber should be called once`);
    assert.equal(harness.calls[label][0].audioBuffer, harness.fakeAudioBuffer);
    assert.equal(harness.calls[label][0].language, 'en');
    assert.equal(harness.calls[label][0].mimeType, 'audio/wav');
    assert.equal(harness.calls.whispercpp.length, 0, `${label} should not use the whisper.cpp request path`);
    assertCleanupAfter(harness.events, `transcribe:${label}`);
  }
});

test('missing audio file does not read a buffer or run cleanup', async () => {
  const harness = makeHarness({ speechToTextModel: 'openai-whisper-1', exists: false });

  await assert.rejects(
    transcribeWhisperAudioFile({
      audioPath: AUDIO_PATH,
      deps: harness.deps,
    }),
    /Audio file not found/
  );

  assert.equal(harness.readCalls, 0);
  assert.equal(harness.nodeBufferBytes, 0);
  assert.equal(harness.events.some((event) => event.startsWith('unlink:')), false);
  assert.equal(harness.events.some((event) => event.startsWith('rmdir:')), false);
});

test('instrumentation shows whispercpp avoids the legacy eager full-file read', async () => {
  const legacy = makeHarness({ speechToTextModel: 'whispercpp' });
  legacy.deps.fs.readFileSync(AUDIO_PATH);

  const whisperCpp = makeHarness({ speechToTextModel: 'whispercpp' });
  await transcribeWhisperAudioFile({
    audioPath: AUDIO_PATH,
    deps: whisperCpp.deps,
  });

  const openai = makeHarness({ speechToTextModel: 'openai-whisper-1' });
  await transcribeWhisperAudioFile({
    audioPath: AUDIO_PATH,
    deps: openai.deps,
  });

  console.log(
    `[whisper-file-buffer-read] before provider=whispercpp readCalls=${legacy.readCalls} ` +
    `nodeBufferBytes=${legacy.nodeBufferBytes}`
  );
  console.log(
    `[whisper-file-buffer-read] after provider=whispercpp readCalls=${whisperCpp.readCalls} ` +
    `nodeBufferBytes=${whisperCpp.nodeBufferBytes} avoidedNodeBufferBytes=${legacy.nodeBufferBytes}`
  );
  console.log(
    `[whisper-file-buffer-read] after provider=openai readCalls=${openai.readCalls} ` +
    `nodeBufferBytes=${openai.nodeBufferBytes}`
  );

  assert.equal(legacy.readCalls, 1);
  assert.equal(legacy.nodeBufferBytes, DEFAULT_FILE_BYTES);
  assert.equal(whisperCpp.readCalls, 0);
  assert.equal(whisperCpp.nodeBufferBytes, 0);
  assert.equal(openai.readCalls, 1);
  assert.equal(openai.nodeBufferBytes, DEFAULT_FILE_BYTES);
});
