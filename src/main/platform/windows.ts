/**
 * platform/windows.ts
 *
 * Windows implementations of PlatformCapabilities.
 * Stubs that still need native work return null/safe values with a comment
 * pointing to the follow-up PR that will implement them.
 */

import * as path from 'path';
import type { ChildProcess } from 'child_process';
import type {
  PlatformCapabilities,
  MicrophoneAccessStatus,
  MicrophonePermissionResult,
  LocalSpeakBackend,
  HotkeyModifiers,
} from './interface';

import { app } from 'electron';

// ── Helpers ───────────────────────────────────────────────────────────────────

function getNativeBinaryPath(name: string): string {
  // windows.ts compiles to dist/main/platform/windows.js, so __dirname is
  // dist/main/platform — go up two levels to reach dist/, then into native/.
  const base = path.join(__dirname, '..', '..', 'native', name);
  if (app.isPackaged) {
    return base.replace('app.asar', 'app.asar.unpacked');
  }
  return base;
}

// ── Color picker HTML ────────────────────────────────────────────────────────
// Inlined so the BrowserWindow can load it via a data: URL without needing
// a file on disk (works in both dev and packaged builds).

const COLOR_PICKER_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,sans-serif;padding:16px;background:#f3f3f3;user-select:none}
input[type=color]{display:block;width:100%;height:52px;border:1px solid #bbb;
  border-radius:4px;cursor:pointer;margin-bottom:12px;padding:2px}
.row{display:flex;gap:8px;justify-content:flex-end}
button{padding:5px 18px;border-radius:4px;border:1px solid #bbb;cursor:pointer;
  background:#e9e9e9;font-size:13px}
button.ok{background:#0078d4;color:#fff;border-color:#0067b8}
button:active{opacity:.8}
</style></head>
<body>
  <input type="color" id="c" value="#3b82f6">
  <div class="row">
    <button onclick="window.close()">Cancel</button>
    <button class="ok" id="ok">OK</button>
  </div>
  <script>
    // nodeIntegration is true for this internal-only window.
    const { ipcRenderer } = require('electron');
    function pick() {
      ipcRenderer.send('__sc-color-picked', document.getElementById('c').value);
    }
    document.getElementById('ok').addEventListener('click', pick);
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') window.close();
      if (e.key === 'Enter') pick();
    });
  </script>
</body></html>`;

// ── Implementation ────────────────────────────────────────────────────────────

export const windows: PlatformCapabilities = {
  readMicrophoneAccessStatus(): MicrophoneAccessStatus {
    // Windows manages microphone access at the OS level; Electron can call
    // getUserMedia directly. Return 'granted' so the app doesn't block the user.
    return 'granted';
  },

  async requestMicrophoneAccessViaNative(
    _prompt: boolean
  ): Promise<MicrophonePermissionResult | null> {
    // No native Swift helper on Windows. The renderer uses getUserMedia instead.
    return null;
  },

  probeAudioDurationMs(_audioPath: string): number | null {
    // afinfo is macOS-only. Will be replaced with a cross-platform probe
    // (ffprobe or the Web Audio API duration) in a follow-up PR.
    return null;
  },

  resolveSpeakBackend(): LocalSpeakBackend | null {
    // 'system-say' is macOS-only. Try edge-tts (works on Windows).
    try {
      const mod = require('node-edge-tts');
      const ctor = mod?.EdgeTTS || mod?.default?.EdgeTTS || mod?.default || mod;
      if (typeof ctor === 'function') return 'edge-tts';
    } catch {}
    return null;
  },

  spawnHotkeyHoldMonitor(
    keyCode: number,
    modifiers: HotkeyModifiers
  ): ChildProcess | null {
    // Uses hotkey-hold-monitor.exe compiled from src/native/hotkey-hold-monitor.c
    // via `npm run build:native`. The binary emits JSON over stdout with the same
    // protocol as the macOS Swift binary ({"ready"}, {"pressed"}, {"released"}).
    const fs = require('fs');
    const { spawn } = require('child_process');

    const binaryPath = getNativeBinaryPath('hotkey-hold-monitor.exe');
    if (!fs.existsSync(binaryPath)) {
      console.warn(
        '[Windows][hold] hotkey-hold-monitor.exe not found.',
        'Run `npm run build:native` to compile it.',
        binaryPath
      );
      return null;
    }

    try {
      return spawn(
        binaryPath,
        [
          String(keyCode),
          modifiers.cmd   ? '1' : '0',
          modifiers.ctrl  ? '1' : '0',
          modifiers.alt   ? '1' : '0',
          modifiers.shift ? '1' : '0',
          modifiers.fn    ? '1' : '0',
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] }
      );
    } catch {
      return null;
    }
  },

  spawnSnippetExpander(_keywords: string[]): ChildProcess | null {
    // Snippet expansion requires a system-wide keyboard hook.
    // Windows implementation will be added in a follow-up PR.
    return null;
  },

  async pickColor(): Promise<string | null> {
    // Opens a small Electron window with a native <input type="color"> element.
    // nodeIntegration is enabled only for this fully-internal window so we can
    // send the result back via ipcRenderer without a preload script.
    const { BrowserWindow, ipcMain } = require('electron');

    return new Promise<string | null>((resolve) => {
      let settled = false;
      const settle = (color: string | null) => {
        if (settled) return;
        settled = true;
        resolve(color);
      };

      const win = new BrowserWindow({
        width: 300,
        height: 130,
        resizable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        alwaysOnTop: true,
        title: 'Pick a Color',
        webPreferences: {
          // nodeIntegration is intentionally true here — this window loads
          // only the inlined COLOR_PICKER_HTML string and never navigates
          // elsewhere.
          nodeIntegration: true,
          contextIsolation: false,
        },
      });

      const onPicked = (_evt: any, color: string) => {
        settle(color || null);
        if (!win.isDestroyed()) win.close();
      };

      ipcMain.once('__sc-color-picked', onPicked);

      win.on('closed', () => {
        ipcMain.removeListener('__sc-color-picked', onPicked);
        settle(null);
      });

      win.loadURL(
        `data:text/html;charset=utf-8,${encodeURIComponent(COLOR_PICKER_HTML)}`
      );
    });
  },
};
