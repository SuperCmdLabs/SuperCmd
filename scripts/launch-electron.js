#!/usr/bin/env node
/**
 * scripts/launch-electron.js
 *
 * Spawns the Electron binary with ELECTRON_RUN_AS_NODE removed from the
 * environment. This is necessary when launching from inside another Electron
 * app (e.g. VS Code / Claude Code) which sets ELECTRON_RUN_AS_NODE=1 in the
 * inherited environment. That flag causes Electron to run as plain Node.js,
 * which breaks require('electron') in the main process.
 */

const { spawn } = require('child_process');
const path = require('path');

const electronBin = require('electron');
const args = process.argv.slice(2).length ? process.argv.slice(2) : ['.'];

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const proc = spawn(electronBin, args, {
  cwd: path.join(__dirname, '..'),
  env,
  stdio: 'inherit',
  windowsHide: false,
});

proc.on('close', (code) => {
  process.exit(code ?? 0);
});

['SIGINT', 'SIGTERM'].forEach((sig) => {
  process.on(sig, () => {
    if (!proc.killed) proc.kill(sig);
  });
});
