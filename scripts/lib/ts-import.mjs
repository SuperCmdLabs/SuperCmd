// Import a self-contained TypeScript module from a test by transpiling it with
// esbuild on the fly. This lets the recovery tests run the *real* production
// source (renderer-recovery.ts, reload-budget.ts) instead of grepping it.
//
// By default this stays intentionally lightweight for dependency-free helpers.
// Tests that need production modules with a few heavy dependencies can pass
// stubs keyed by import specifier.

import { transform } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function toDataUrl(code) {
  return 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
}

async function transformTs(source) {
  const { code } = await transform(source, { loader: 'ts', format: 'esm' });
  return code;
}

function rewriteImportSpecifiers(code, absPath, options) {
  const stubs = options.stubs || {};
  const stubUrls = new Map(Object.keys(stubs).map((specifier) => [specifier, toDataUrl(stubs[specifier])]));

  const rewriteSpecifier = (specifier) => {
    if (stubUrls.has(specifier)) return stubUrls.get(specifier);
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && options.root) {
      const resolved = path.resolve(path.dirname(absPath), specifier);
      return pathToFileURL(resolved).href;
    }
    return specifier;
  };

  return code
    .replace(/(\bfrom\s*["'])([^"']+)(["'])/g, (_match, prefix, specifier, suffix) => `${prefix}${rewriteSpecifier(specifier)}${suffix}`)
    .replace(/(\bimport\s*["'])([^"']+)(["'])/g, (_match, prefix, specifier, suffix) => `${prefix}${rewriteSpecifier(specifier)}${suffix}`);
}

export async function importTs(absPath, options = {}) {
  const src = fs.readFileSync(absPath, 'utf8');
  const code = rewriteImportSpecifiers(await transformTs(src), absPath, options);
  return import(toDataUrl(code));
}
