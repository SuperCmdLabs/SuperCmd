import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const runnerPath = path.join(root, 'src/main/script-command-runner.ts');

function makeElectronMockSource(appPaths) {
  return `
    const paths = ${JSON.stringify(appPaths)};
    export const app = {
      getPath(name) {
        return paths[name] || paths.userData;
      },
    };
  `;
}

function makeSettingsMockSource(scriptCommandFolders) {
  return `
    export function loadSettings() {
      return { scriptCommandFolders: ${JSON.stringify(scriptCommandFolders)} };
    }
  `;
}

function makeInstrumentedFsSource(metricsKey) {
  return `
    import realFs from 'node:fs';

    const metrics = globalThis[${JSON.stringify(metricsKey)}];

    function countReadFile(value, options) {
      if (Buffer.isBuffer(value)) return value.byteLength;
      const encoding = typeof options === 'string'
        ? options
        : options && typeof options === 'object' && options.encoding
          ? options.encoding
          : 'utf8';
      return Buffer.byteLength(String(value), encoding);
    }

    export const constants = realFs.constants;
    export const existsSync = realFs.existsSync.bind(realFs);
    export const mkdirSync = realFs.mkdirSync.bind(realFs);
    export const readdirSync = realFs.readdirSync.bind(realFs);
    export const writeFileSync = realFs.writeFileSync.bind(realFs);
    export const chmodSync = realFs.chmodSync.bind(realFs);
    export const unlinkSync = realFs.unlinkSync.bind(realFs);
    export const openSync = (...args) => {
      metrics.openSyncCalls += 1;
      return realFs.openSync(...args);
    };
    export const closeSync = realFs.closeSync.bind(realFs);
    export const accessSync = realFs.accessSync.bind(realFs);
    export const readFileSync = (filePath, options) => {
      const value = realFs.readFileSync(filePath, options);
      metrics.readFileSyncCalls += 1;
      metrics.readFileSyncBytes += countReadFile(value, options);
      return value;
    };
    export const readSync = (...args) => {
      const bytesRead = realFs.readSync(...args);
      metrics.readSyncCalls += 1;
      metrics.readSyncBytes += Math.max(0, Number(bytesRead) || 0);
      return bytesRead;
    };

    export default {
      ...realFs,
      constants,
      existsSync,
      mkdirSync,
      readdirSync,
      writeFileSync,
      chmodSync,
      unlinkSync,
      openSync,
      closeSync,
      accessSync,
      readFileSync,
      readSync,
    };
  `;
}

function resetMetrics(metrics) {
  for (const key of Object.keys(metrics)) {
    metrics[key] = 0;
  }
}

export async function loadScriptCommandRunner({
  homeDir = os.homedir(),
  tempDir = os.tmpdir(),
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'supercmd-user-data-')),
  scriptCommandFolders = [],
  instrumentFs = false,
} = {}) {
  const metricsKey = `__supercmdScriptCommandFsMetrics_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2)}`;
  const metrics = {
    readFileSyncCalls: 0,
    readFileSyncBytes: 0,
    readSyncCalls: 0,
    readSyncBytes: 0,
    openSyncCalls: 0,
  };
  globalThis[metricsKey] = metrics;

  const plugins = [
    {
      name: 'supercmd-script-command-runner-mocks',
      setup(pluginBuild) {
        pluginBuild.onResolve({ filter: /^electron$/ }, () => ({
          path: 'electron-mock',
          namespace: 'supercmd-mocks',
        }));
        pluginBuild.onLoad({ filter: /^electron-mock$/, namespace: 'supercmd-mocks' }, () => ({
          contents: makeElectronMockSource({ home: homeDir, temp: tempDir, userData: userDataDir }),
          loader: 'js',
        }));

        pluginBuild.onResolve({ filter: /^\.\/settings-store$/ }, () => ({
          path: 'settings-store-mock',
          namespace: 'supercmd-mocks',
        }));
        pluginBuild.onLoad({ filter: /^settings-store-mock$/, namespace: 'supercmd-mocks' }, () => ({
          contents: makeSettingsMockSource(scriptCommandFolders),
          loader: 'js',
        }));
      },
    },
  ];

  if (instrumentFs) {
    plugins.push({
      name: 'supercmd-script-command-fs-instrumentation',
      setup(pluginBuild) {
        pluginBuild.onResolve({ filter: /^fs$/ }, () => ({
          path: 'fs-instrumented',
          namespace: 'supercmd-fs',
        }));
        pluginBuild.onLoad({ filter: /^fs-instrumented$/, namespace: 'supercmd-fs' }, () => ({
          contents: makeInstrumentedFsSource(metricsKey),
          loader: 'js',
        }));
      },
    });
  }

  const result = await build({
    entryPoints: [runnerPath],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    plugins,
  });

  const output = result.outputFiles[0]?.text;
  if (!output) {
    throw new Error('Failed to bundle script-command-runner.ts');
  }

  const moduleUrl = `data:text/javascript;base64,${Buffer.from(output).toString('base64')}#${metricsKey}`;
  const module = await import(moduleUrl);

  return {
    module,
    metrics,
    resetMetrics: () => resetMetrics(metrics),
    root,
  };
}
