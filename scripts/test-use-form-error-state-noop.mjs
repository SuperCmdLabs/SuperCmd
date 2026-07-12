#!/usr/bin/env node

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const USE_FORM_PATH = path.join(repoRoot, 'src/renderer/src/raycast-api/hooks/use-form.ts');
const FORM_RUNTIME_STATE_PATH = path.join(repoRoot, 'src/renderer/src/raycast-api/form-runtime-state.ts');
const FIELD_CHANGE_COUNTS = [10, 100, 1000];

function importStateHelpers() {
  const source = fs.readFileSync(FORM_RUNTIME_STATE_PATH, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
    },
    fileName: 'form-runtime-state.ts',
  });
  const context = { exports: {} };
  vm.runInNewContext(transpiled.outputText, context);
  return {
    clearFormFieldError: context.exports.clearFormFieldError,
    setFormFieldError: context.exports.setFormFieldError,
  };
}

function parseUseFormSource() {
  return ts.createSourceFile(
    USE_FORM_PATH,
    fs.readFileSync(USE_FORM_PATH, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
}

function isIdentifier(node, name) {
  return ts.isIdentifier(node) && node.text === name;
}

function walk(node, visitor) {
  visitor(node);
  ts.forEachChild(node, (child) => walk(child, visitor));
}

function importsStateHelpers(sourceFile) {
  let found = false;
  walk(sourceFile, (node) => {
    if (found || !ts.isImportDeclaration(node)) return;
    if (!ts.isStringLiteral(node.moduleSpecifier) || node.moduleSpecifier.text !== '../form-runtime-state') return;
    const namedBindings = node.importClause?.namedBindings;
    if (!namedBindings || !ts.isNamedImports(namedBindings)) return;
    const importedNames = new Set(namedBindings.elements.map((element) => element.name.text));
    found = importedNames.has('clearFormFieldError') && importedNames.has('setFormFieldError');
  });
  return found;
}

function callContainsHelper(node, helperName) {
  let found = false;
  walk(node, (child) => {
    if (
      !found &&
      ts.isCallExpression(child) &&
      isIdentifier(child.expression, helperName)
    ) {
      found = true;
    }
  });
  return found;
}

function countSetErrorsHelperUses(sourceFile, helperName) {
  let count = 0;
  walk(sourceFile, (node) => {
    if (!ts.isCallExpression(node) || !isIdentifier(node.expression, 'setErrors')) return;
    const updater = node.arguments[0];
    if (!updater) return;
    if (callContainsHelper(updater, helperName)) count += 1;
  });
  return count;
}

function analyzeUseFormSource() {
  const sourceFile = parseUseFormSource();
  return {
    importsStateHelpers: importsStateHelpers(sourceFile),
    clearHelperSetErrorsCalls: countSetErrorsHelperUses(sourceFile, 'clearFormFieldError'),
    setHelperSetErrorsCalls: countSetErrorsHelperUses(sourceFile, 'setFormFieldError'),
  };
}

function previousClearFormFieldError(previous, id) {
  const next = { ...previous };
  delete next[id];
  return next;
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
    noExistingErrors: FIELD_CHANGE_COUNTS.map((count) => {
      const before = measureNoErrorFieldChanges(previousClearFormFieldError, count);
      const after = measureNoErrorFieldChanges(clearFormFieldError, count);
      return {
        fieldChanges: count,
        beforeIdentityChanges: before.errorIdentityChanges,
        afterIdentityChanges: after.errorIdentityChanges,
      };
    }),
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
  console.log(JSON.stringify({ source: analyzeUseFormSource(), metrics: getMetrics() }, null, 2));
} else {
  test('useForm setValue skips error state updates when the field has no error', () => {
    const source = analyzeUseFormSource();
    assert.equal(source.importsStateHelpers, true, 'useForm should import the guarded error state helpers');
    assert.equal(source.clearHelperSetErrorsCalls, 1, 'useForm setValue should use the guarded error clear helper');

    for (const metric of getMetrics().noExistingErrors) {
      assert.equal(metric.beforeIdentityChanges, metric.fieldChanges, `${metric.fieldChanges} previous no-error changes cloned errors every time`);
      assert.equal(metric.afterIdentityChanges, 0, `${metric.fieldChanges} no-error changes should keep the same errors object`);
    }
  });

  test('useForm setValue still clears an existing field error only', () => {
    const metric = getMetrics().clearExistingErrorPreservesOthers;
    assert.equal(metric.changedIdentity, true, 'clearing an existing error should publish a new errors object');
    assert.equal(metric.clearedFieldMissing, true, 'the changed field error should be removed');
    assert.equal(metric.preservedOtherField, true, 'unrelated field errors should be preserved');
  });

  test('useForm validation error writes skip same-value updates but publish changed errors', () => {
    const source = analyzeUseFormSource();
    assert.equal(source.setHelperSetErrorsCalls, 2, 'useForm validation paths should use the guarded error set helper');

    const metrics = getMetrics();
    assert.equal(metrics.setSameError.changedIdentity, false, 'setting the same error should keep the previous errors object');
    assert.equal(metrics.setNewError.changedIdentity, true, 'setting a different error should publish a new errors object');
    assert.equal(metrics.setNewError.value, 'Invalid');
  });
}
