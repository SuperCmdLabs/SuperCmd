// Import a TypeScript module from a test by bundling it with esbuild on the fly.
// Tests may pass simple module stubs for Node built-ins such as `https`.

import { build } from 'esbuild';
import path from 'node:path';

let importNonce = 0;

export async function importTs(absPath, options = {}) {
  const resolvedPath = path.resolve(absPath);
  const result = await build({
    absWorkingDir: options.root || process.cwd(),
    entryPoints: [resolvedPath],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: options.target || 'node20',
    logLevel: 'silent',
    plugins: [stubPlugin(options.stubs || {})],
  });
  const code = result.outputFiles[0].text;
  const dataUrl = [
    'data:text/javascript;base64,',
    Buffer.from(code).toString('base64'),
    `#${encodeURIComponent(resolvedPath)}-${importNonce++}`,
  ].join('');
  return import(dataUrl);
}

function stubPlugin(stubs) {
  const stubSpecifiers = new Set(Object.keys(stubs));
  return {
    name: 'ts-import-stubs',
    setup(esbuild) {
      esbuild.onResolve({ filter: /.*/ }, (args) => {
        if (stubSpecifiers.has(args.path)) {
          return { path: args.path, namespace: 'ts-import-stub' };
        }
        return null;
      });
      esbuild.onLoad({ filter: /.*/, namespace: 'ts-import-stub' }, (args) => ({
        contents: stubs[args.path],
        loader: 'js',
      }));
    },
  };
}
