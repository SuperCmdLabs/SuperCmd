#!/usr/bin/env node

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { importTs } from './lib/ts-import.mjs';

const REMOUNT_CYCLES = 5;
const CURRENT_REQUEST_ID = 'ollama-pull-current';
const OTHER_REQUEST_ID = 'ollama-pull-stale';
const PREFERRED_MODEL = 'llama3.2';

const {
  registerOllamaPullListeners,
  toOllamaPullProgressState,
} = await importTs(path.resolve('src/renderer/src/settings/ollamaPullProgress.ts'));

function createBridge({ returnCleanup }) {
  const emitter = new EventEmitter();

  function subscribe(channel, callback) {
    const listener = (data) => callback(data);
    emitter.on(channel, listener);
    if (!returnCleanup) return undefined;
    return () => emitter.removeListener(channel, listener);
  }

  return {
    onOllamaPullProgress: (callback) => subscribe('ollama-pull-progress', callback),
    onOllamaPullDone: (callback) => subscribe('ollama-pull-done', callback),
    onOllamaPullError: (callback) => subscribe('ollama-pull-error', callback),
    emitProgress: (data) => emitter.emit('ollama-pull-progress', data),
    emitDone: (data) => emitter.emit('ollama-pull-done', data),
    emitError: (data) => emitter.emit('ollama-pull-error', data),
    listenerCounts: () => ({
      progress: emitter.listenerCount('ollama-pull-progress'),
      done: emitter.listenerCount('ollama-pull-done'),
      error: emitter.listenerCount('ollama-pull-error'),
    }),
  };
}

function createStateRecorder() {
  let activeRequestId = CURRENT_REQUEST_ID;
  let preferredModel = PREFERRED_MODEL;
  const metrics = {
    progressWrites: 0,
    progressResets: 0,
    doneRefreshes: 0,
    errorMessages: 0,
    errorClearsScheduled: 0,
    clearActivePulls: 0,
    pullingModelClears: 0,
    refreshedModels: [],
    errors: [],
  };

  return {
    get activeRequestId() {
      return activeRequestId;
    },
    get metrics() {
      return metrics;
    },
    resetActivePull() {
      activeRequestId = CURRENT_REQUEST_ID;
      preferredModel = PREFERRED_MODEL;
    },
    optionsForFixed(bridge) {
      return {
        bridge,
        getActiveRequestId: () => activeRequestId,
        getPreferredModel: () => preferredModel,
        clearActivePull: () => {
          activeRequestId = null;
          preferredModel = undefined;
          metrics.clearActivePulls += 1;
        },
        setPullingModel: (modelName) => {
          if (modelName === null) metrics.pullingModelClears += 1;
        },
        setPullProgress: (progress) => {
          if (progress.status === '' && progress.percent === 0) {
            metrics.progressResets += 1;
          } else {
            metrics.progressWrites += 1;
          }
        },
        setOllamaError: (error) => {
          if (error) {
            metrics.errorMessages += 1;
            metrics.errors.push(error);
          }
        },
        scheduleErrorClear: () => {
          metrics.errorClearsScheduled += 1;
        },
        refreshOllamaStatus: (modelName) => {
          metrics.doneRefreshes += 1;
          metrics.refreshedModels.push(modelName);
        },
      };
    },
    optionsForLegacy(bridge) {
      return {
        bridge,
        getPreferredModel: () => preferredModel,
        clearActivePull: () => {
          activeRequestId = null;
          preferredModel = undefined;
          metrics.clearActivePulls += 1;
        },
        setPullingModel: (modelName) => {
          if (modelName === null) metrics.pullingModelClears += 1;
        },
        setPullProgress: (progress) => {
          if (progress.status === '' && progress.percent === 0) {
            metrics.progressResets += 1;
          } else {
            metrics.progressWrites += 1;
          }
        },
        setOllamaError: (error) => {
          if (error) {
            metrics.errorMessages += 1;
            metrics.errors.push(error);
          }
        },
        scheduleErrorClear: () => {
          metrics.errorClearsScheduled += 1;
        },
        refreshOllamaStatus: (modelName) => {
          metrics.doneRefreshes += 1;
          metrics.refreshedModels.push(modelName);
        },
      };
    },
  };
}

function registerLegacyAITabPullListeners({
  bridge,
  clearActivePull,
  getPreferredModel,
  refreshOllamaStatus,
  scheduleErrorClear,
  setOllamaError,
  setPullingModel,
  setPullProgress,
}) {
  bridge.onOllamaPullProgress((data) => {
    setPullProgress(toOllamaPullProgressState(data));
  });
  bridge.onOllamaPullDone(() => {
    const preferredModel = getPreferredModel();
    clearActivePull();
    setPullingModel(null);
    setPullProgress({ status: '', percent: 0 });
    refreshOllamaStatus(preferredModel);
  });
  bridge.onOllamaPullError((data) => {
    clearActivePull();
    setPullingModel(null);
    setPullProgress({ status: '', percent: 0 });
    setOllamaError(data.error);
    scheduleErrorClear();
  });
  return () => {};
}

function mountAndUnmountRepeatedly(register, bridge, state, cycles) {
  for (let index = 0; index < cycles; index += 1) {
    const cleanup = register(bridge, state);
    cleanup();
  }
  return register(bridge, state);
}

function progressPayload(overrides = {}) {
  return {
    requestId: CURRENT_REQUEST_ID,
    status: 'pulling manifest',
    digest: 'sha256:test',
    total: 100,
    completed: 25,
    ...overrides,
  };
}

function runLifecycleScenario({ label, bridge, register }) {
  const state = createStateRecorder();
  const cleanupActiveMount = mountAndUnmountRepeatedly(register, bridge, state, REMOUNT_CYCLES);

  bridge.emitProgress(progressPayload());
  state.resetActivePull();
  bridge.emitDone({ requestId: CURRENT_REQUEST_ID });
  state.resetActivePull();
  bridge.emitError({ requestId: CURRENT_REQUEST_ID, error: 'pull failed' });
  cleanupActiveMount();

  const result = {
    label,
    remountCycles: REMOUNT_CYCLES,
    metrics: state.metrics,
    listenerCountsAfterCleanup: bridge.listenerCounts(),
  };
  console.log(`[ollama-pull ${label}] ${JSON.stringify(result)}`);
  return result;
}

test('AITab-like remount churn does not multiply Ollama pull listeners after cleanup', () => {
  const before = runLifecycleScenario({
    label: 'before-inline-listeners',
    bridge: createBridge({ returnCleanup: false }),
    register: (bridge, state) => registerLegacyAITabPullListeners(state.optionsForLegacy(bridge)),
  });
  const after = runLifecycleScenario({
    label: 'after-cleanup-listeners',
    bridge: createBridge({ returnCleanup: true }),
    register: (bridge, state) => registerOllamaPullListeners(state.optionsForFixed(bridge)),
  });

  assert.deepEqual({
    progressWrites: before.metrics.progressWrites,
    doneRefreshes: before.metrics.doneRefreshes,
    errorMessages: before.metrics.errorMessages,
  }, {
    progressWrites: REMOUNT_CYCLES + 1,
    doneRefreshes: REMOUNT_CYCLES + 1,
    errorMessages: REMOUNT_CYCLES + 1,
  });
  assert.deepEqual(before.listenerCountsAfterCleanup, {
    progress: REMOUNT_CYCLES + 1,
    done: REMOUNT_CYCLES + 1,
    error: REMOUNT_CYCLES + 1,
  });

  assert.deepEqual({
    progressWrites: after.metrics.progressWrites,
    doneRefreshes: after.metrics.doneRefreshes,
    errorMessages: after.metrics.errorMessages,
  }, {
    progressWrites: 1,
    doneRefreshes: 1,
    errorMessages: 1,
  });
  assert.deepEqual(after.listenerCountsAfterCleanup, { progress: 0, done: 0, error: 0 });
  assert.deepEqual(after.metrics.refreshedModels, [PREFERRED_MODEL]);
});

test('Ollama pull listeners ignore stale request ids and dedupe identical progress', () => {
  const bridge = createBridge({ returnCleanup: true });
  const state = createStateRecorder();
  const cleanup = registerOllamaPullListeners(state.optionsForFixed(bridge));

  bridge.emitProgress(progressPayload({ requestId: OTHER_REQUEST_ID, completed: 75 }));
  bridge.emitDone({ requestId: OTHER_REQUEST_ID });
  bridge.emitError({ requestId: OTHER_REQUEST_ID, error: 'stale failure' });
  assert.deepEqual({
    progressWrites: state.metrics.progressWrites,
    doneRefreshes: state.metrics.doneRefreshes,
    errorMessages: state.metrics.errorMessages,
  }, {
    progressWrites: 0,
    doneRefreshes: 0,
    errorMessages: 0,
  });

  bridge.emitProgress(progressPayload({ completed: 25 }));
  bridge.emitProgress(progressPayload({ completed: 25 }));
  bridge.emitProgress(progressPayload({ completed: 25.1 }));
  bridge.emitProgress(progressPayload({ status: 'pulling layers', completed: 25.1 }));

  assert.equal(state.metrics.progressWrites, 2);
  cleanup();
  assert.deepEqual(bridge.listenerCounts(), { progress: 0, done: 0, error: 0 });
});
