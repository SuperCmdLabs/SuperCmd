// Import a TypeScript module from a test by bundling it with esbuild on the fly.
// This lets focused script tests run real production source without requiring a
// separate build step.

import { build } from 'esbuild';

export async function importTs(absPath) {
  const result = await build({
    bundle: true,
    entryPoints: [absPath],
    format: 'esm',
    platform: 'node',
    target: 'node20',
    write: false,
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}
