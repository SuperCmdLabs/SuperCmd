// Import a self-contained TypeScript module from a test by transpiling it with
// esbuild on the fly. This lets the recovery tests run the *real* production
// source (renderer-recovery.ts, reload-budget.ts) instead of grepping it.
//
// Only works for modules with no relative imports of their own — the recovery
// helpers are deliberately dependency-free for exactly this reason.

import { transform } from 'esbuild';
import fs from 'node:fs';

export async function importTs(absPath) {
  const src = fs.readFileSync(absPath, 'utf8');
  const { code } = await transform(src, { loader: 'ts', format: 'esm' });
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}
