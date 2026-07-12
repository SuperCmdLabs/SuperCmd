#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { loadScriptCommandRunner } from './lib/script-command-runner-harness.mjs';

const fileCount = Number(process.env.SUPERCMD_BENCH_SCRIPT_COUNT || 40);
const bodyBytesPerFile = Number(process.env.SUPERCMD_BENCH_SCRIPT_BODY_BYTES || 1024 * 1024);

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function makeLargeScript(title, bodyBytes) {
  const header = `#!/bin/bash
# Required parameters:
# @raycast.schemaVersion 1
# @raycast.title ${title}
# @raycast.mode fullOutput

# Optional parameters:
# @raycast.packageName Benchmark
# @raycast.icon ⚡
# @raycast.description Large script command fixture
# @raycast.needsConfirmation false

exit 0
`;
  const line = `# ${'x'.repeat(253)}\n`;
  const repeatCount = Math.max(0, Math.ceil(bodyBytes / Buffer.byteLength(line)));
  return header + line.repeat(repeatCount);
}

function snapshot(metrics) {
  return {
    readFileSyncCalls: metrics.readFileSyncCalls,
    readFileSyncBytes: metrics.readFileSyncBytes,
    readSyncCalls: metrics.readSyncCalls,
    readSyncBytes: metrics.readSyncBytes,
    openSyncCalls: metrics.openSyncCalls,
    totalBytes: metrics.readFileSyncBytes + metrics.readSyncBytes,
  };
}

function printMetric(label, durationMs, metricSnapshot) {
  console.log(`${label}: ${durationMs.toFixed(1)}ms`);
  console.log(`  readFileSync: ${metricSnapshot.readFileSyncCalls} calls, ${formatBytes(metricSnapshot.readFileSyncBytes)}`);
  console.log(`  readSync: ${metricSnapshot.readSyncCalls} calls, ${formatBytes(metricSnapshot.readSyncBytes)}`);
  console.log(`  total runner bytes read: ${formatBytes(metricSnapshot.totalBytes)}`);
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'supercmd-script-bench-'));
const scriptsDir = path.join(tempRoot, 'script-commands');
const userDataDir = path.join(tempRoot, 'user-data');
fs.mkdirSync(scriptsDir, { recursive: true });
fs.mkdirSync(userDataDir, { recursive: true });

try {
  for (let i = 0; i < fileCount; i += 1) {
    const scriptPath = path.join(scriptsDir, `large-command-${String(i + 1).padStart(3, '0')}.sh`);
    fs.writeFileSync(scriptPath, makeLargeScript(`Large Command ${i + 1}`, bodyBytesPerFile), {
      mode: 0o755,
    });
  }

  process.env.SUPERCMD_SCRIPT_COMMAND_PATHS = scriptsDir;
  const { module: runner, metrics, resetMetrics } = await loadScriptCommandRunner({
    userDataDir,
    scriptCommandFolders: [],
    instrumentFs: true,
  });

  resetMetrics();
  const discoveryStart = performance.now();
  const commands = runner.discoverScriptCommands();
  const discoveryMs = performance.now() - discoveryStart;
  const discoveryMetrics = snapshot(metrics);

  if (commands.length !== fileCount) {
    throw new Error(`Expected ${fileCount} commands, discovered ${commands.length}`);
  }

  resetMetrics();
  const executeStart = performance.now();
  await runner.executeScriptCommand(commands[0].id);
  const executeMs = performance.now() - executeStart;
  const executeMetrics = snapshot(metrics);

  console.log('Script command discovery benchmark');
  console.log(`files: ${fileCount}`);
  console.log(`body bytes per file: ${formatBytes(bodyBytesPerFile)}`);
  printMetric('discovery', discoveryMs, discoveryMetrics);
  printMetric('cached execution shebang lookup', executeMs, executeMetrics);
} finally {
  delete process.env.SUPERCMD_SCRIPT_COMMAND_PATHS;
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
