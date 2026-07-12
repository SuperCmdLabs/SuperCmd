// Import a self-contained TypeScript module from a test by transpiling it with
// esbuild on the fly. This lets the recovery tests run the *real* production
// source (renderer-recovery.ts, reload-budget.ts) instead of grepping it.
//
// By default this only works for modules with no relative imports of their own.
// Tests can pass stubs to bundle main-process modules with lightweight mocks.

import { build, transform } from 'esbuild';
import fs from 'node:fs';

export async function importTs(absPath, options = {}) {
  const stubs = options.stubs || {};
  if (Object.keys(stubs).length > 0) {
    const result = await build({
      entryPoints: [absPath],
      bundle: true,
      platform: 'node',
      format: 'esm',
      write: false,
      plugins: [
        {
          name: 'supercmd-test-stubs',
          setup(pluginBuild) {
            for (const [specifier, contents] of Object.entries(stubs)) {
              const escapedSpecifier = specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              pluginBuild.onResolve({ filter: new RegExp(`^${escapedSpecifier}$`) }, () => ({
                path: specifier,
                namespace: 'supercmd-test-stubs',
              }));
              pluginBuild.onLoad({ filter: new RegExp(`^${escapedSpecifier}$`), namespace: 'supercmd-test-stubs' }, () => ({
                contents,
                loader: 'js',
              }));
            }
          },
        },
      ],
    });
    const output = result.outputFiles[0]?.text;
    if (!output) {
      throw new Error(`Failed to bundle ${absPath}`);
    }
    const dataUrl = 'data:text/javascript;base64,' + Buffer.from(output).toString('base64');
    return import(dataUrl);
  }

  const src = fs.readFileSync(absPath, 'utf8');
  const { code } = await transform(src, { loader: 'ts', format: 'esm' });
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}
