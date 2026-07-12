#!/usr/bin/env node

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const hookSource = fs.readFileSync('src/renderer/src/hooks/useSpeakManager.ts', 'utf8');

function loadTsModule(filePath) {
  const resolvedPath = path.resolve(filePath);
  const source = fs.readFileSync(resolvedPath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
    },
    fileName: resolvedPath,
  });

  const module = { exports: {} };
  const sandbox = {
    module,
    exports: module.exports,
    require,
    console,
    Promise,
    String,
    RegExp,
  };
  vm.runInNewContext(transpiled.outputText, sandbox, { filename: resolvedPath });
  return module.exports;
}

function makeRecorder(currentVoice = 'en-US-EricNeural') {
  const calls = [];
  const configuredModels = [];
  const configuredEdgeVoices = [];
  const appliedOptions = [];

  return {
    calls,
    configuredModels,
    configuredEdgeVoices,
    appliedOptions,
    options: {
      getCurrentVoice: () => currentVoice,
      setConfiguredTtsModel: (value) => configuredModels.push(value),
      setConfiguredEdgeTtsVoice: (value) => configuredEdgeVoices.push(value),
      updateSpeakOptions: async (patch) => {
        calls.push(patch);
        currentVoice = patch.voice;
        return { voice: patch.voice, rate: '+0%' };
      },
      setSpeakOptions: (next) => {
        appliedOptions.push(next);
      },
    },
  };
}

const {
  applySpeakSettings,
  buildElevenLabsSpeakModel,
  parseElevenLabsSpeakModel,
  resolveSpeakSettings,
} = loadTsModule('src/renderer/src/utils/speak-settings-sync.ts');

function assertJsonEqual(actual, expected) {
  assert.equal(JSON.stringify(actual), JSON.stringify(expected));
}

test('speak settings sync uses initial load and settings-updated listener, not polling', () => {
  assert.match(hookSource, /window\.electron\.getSettings\(\)\.then\(syncFromSettings\)/);
  assert.match(hookSource, /window\.electron\.onSettingsUpdated\?\.\(\(settings\) =>/);
  assert.match(hookSource, /cleanupSettings\?\.\(\)/);
  assert.doesNotMatch(hookSource, /setInterval\(\s*syncFromSettings/);
  assert.doesNotMatch(hookSource, /clearInterval\(/);
});

test('initial settings load applies configured Edge TTS voice once', async () => {
  const recorder = makeRecorder('en-US-EricNeural');

  await applySpeakSettings({
    ai: {
      textToSpeechModel: 'edge-tts',
      edgeTtsVoice: 'en-US-GuyNeural',
    },
  }, recorder.options);

  assert.deepEqual(recorder.configuredModels, ['edge-tts']);
  assert.deepEqual(recorder.configuredEdgeVoices, ['en-US-GuyNeural']);
  assertJsonEqual(recorder.calls, [{ voice: 'en-US-GuyNeural', restartCurrent: false }]);
  assertJsonEqual(recorder.appliedOptions, [{ voice: 'en-US-GuyNeural', rate: '+0%' }]);
});

test('live settings update switches to ElevenLabs voice without extra idle updates', async () => {
  const recorder = makeRecorder('en-US-GuyNeural');

  await applySpeakSettings({
    ai: {
      textToSpeechModel: buildElevenLabsSpeakModel('elevenlabs-multilingual-v2', 'AZnzlk1XvdvUeBnXmlld'),
      edgeTtsVoice: 'en-US-GuyNeural',
    },
  }, recorder.options);

  await applySpeakSettings({
    ai: {
      textToSpeechModel: buildElevenLabsSpeakModel('elevenlabs-multilingual-v2', 'AZnzlk1XvdvUeBnXmlld'),
      edgeTtsVoice: 'en-US-GuyNeural',
    },
  }, recorder.options);

  assertJsonEqual(recorder.calls, [{ voice: 'AZnzlk1XvdvUeBnXmlld', restartCurrent: false }]);
  assertJsonEqual(recorder.appliedOptions, [{ voice: 'AZnzlk1XvdvUeBnXmlld', rate: '+0%' }]);
});

test('ElevenLabs model parser and resolver preserve model and default voice behavior', () => {
  assertJsonEqual(parseElevenLabsSpeakModel('elevenlabs-turbo-v2@pNInz6obpgDQGcFmaJgB'), {
    model: 'elevenlabs-turbo-v2',
    voiceId: 'pNInz6obpgDQGcFmaJgB',
  });
  assert.equal(resolveSpeakSettings({ ai: { textToSpeechModel: 'elevenlabs-multilingual-v2' } }).targetVoice, '21m00Tcm4TlvDq8ikWAM');
});
