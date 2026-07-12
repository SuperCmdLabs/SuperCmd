#!/usr/bin/env node

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const FORM_RUNTIME_PATH = 'src/renderer/src/raycast-api/form-runtime.tsx';
const FORM_RUNTIME_STATE_PATH = 'src/renderer/src/raycast-api/form-runtime-state.ts';
const FIELD_CHANGE_COUNTS = [10, 100, 1000];

function importStateHelpers() {
  const source = fs.readFileSync(FORM_RUNTIME_STATE_PATH, 'utf8');
  const executableSource = source
    .replace(/export type FormErrorMap = Record<string, string>;\n\n/, '')
    .replace(/export function /g, 'function ')
    .replace(/: FormErrorMap/g, '')
    .replace(/: string/g, '');

  const context = {};
  vm.runInNewContext(`${executableSource}\nthis.clearFormFieldError = clearFormFieldError;\nthis.setFormFieldError = setFormFieldError;`, context);
  return {
    clearFormFieldError: context.clearFormFieldError,
    setFormFieldError: context.setFormFieldError,
  };
}

function analyzeFormRuntimeSource() {
  const source = fs.readFileSync(FORM_RUNTIME_PATH, 'utf8');
  return {
    usesClearHelper: source.includes('const next = clearFormFieldError(previous, id);'),
    usesSetHelper: source.includes('const next = setFormFieldError(previous, id, error);'),
    skipsPublishWhenUnchanged: source.includes('if (next === previous) return previous;'),
  };
}

function measureNoErrorFieldChanges(clearFormFieldError, fieldChanges) {
  let errors = {};
  let currentSnapshot = errors;
  let errorIdentityChanges = 0;

  for (let index = 0; index < fieldChanges; index += 1) {
    const next = clearFormFieldError(errors, `field-${index}`);
    if (next !== currentSnapshot) {
      errorIdentityChanges += 1;
    }
    currentSnapshot = next;
    errors = next;
  }

  return { fieldChanges, errorIdentityChanges };
}

function getMetrics() {
  const { clearFormFieldError, setFormFieldError } = importStateHelpers();
  return {
    noExistingErrors: FIELD_CHANGE_COUNTS.map((count) => measureNoErrorFieldChanges(clearFormFieldError, count)),
    clearExistingErrorPreservesOthers: (() => {
      const previous = { first: 'Required', second: 'Invalid' };
      const next = clearFormFieldError(previous, 'first');
      return {
        changedIdentity: next !== previous,
        clearedFieldMissing: !Object.prototype.hasOwnProperty.call(next, 'first'),
        preservedOtherField: next.second === 'Invalid',
      };
    })(),
    setSameError: (() => {
      const previous = { first: 'Required' };
      const next = setFormFieldError(previous, 'first', 'Required');
      return { changedIdentity: next !== previous };
    })(),
    setNewError: (() => {
      const previous = { first: 'Required' };
      const next = setFormFieldError(previous, 'first', 'Invalid');
      return { changedIdentity: next !== previous, value: next.first };
    })(),
  };
}

if (process.argv.includes('--report')) {
  console.log(JSON.stringify({ source: analyzeFormRuntimeSource(), metrics: getMetrics() }, null, 2));
} else {
  test('Form setValue skips error state updates when the field has no error', () => {
    const source = analyzeFormRuntimeSource();
    assert.equal(source.usesClearHelper, true, 'Form setValue should use the guarded error clear helper');
    assert.equal(source.skipsPublishWhenUnchanged, true, 'unchanged errors should not republish the global error snapshot');

    for (const metric of getMetrics().noExistingErrors) {
      assert.equal(metric.errorIdentityChanges, 0, `${metric.fieldChanges} no-error changes should keep the same errors object`);
    }
  });

  test('Form setValue still clears an existing field error only', () => {
    const metric = getMetrics().clearExistingErrorPreservesOthers;
    assert.equal(metric.changedIdentity, true, 'clearing an existing error should publish a new errors object');
    assert.equal(metric.clearedFieldMissing, true, 'the changed field error should be removed');
    assert.equal(metric.preservedOtherField, true, 'unrelated field errors should be preserved');
  });

  test('Form setError skips same-value updates but publishes changed errors', () => {
    const source = analyzeFormRuntimeSource();
    assert.equal(source.usesSetHelper, true, 'Form setError should use the guarded error set helper');

    const metrics = getMetrics();
    assert.equal(metrics.setSameError.changedIdentity, false, 'setting the same error should keep the previous errors object');
    assert.equal(metrics.setNewError.changedIdentity, true, 'setting a different error should publish a new errors object');
    assert.equal(metrics.setNewError.value, 'Invalid');
  });
}
