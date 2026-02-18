/**
 * platform/darwin.ts
 *
 * macOS implementation of PlatformCapabilities.
 * Logic is self-contained here so main.ts can migrate to it incrementally.
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

const electron = require('electron');
const { app, systemPreferences } = electron;

// ── Helpers ───────────────────────────────────────────────────────────────────

function getNativeBinaryPath(name: string): string {
  const base = path.join(__dirname, '..', 'native', name);
  if (app.isPackaged) {
    return base.replace('app.asar', 'app.asar.unpacked');
  }
  return base;
}

// ── Implementation ────────────────────────────────────────────────────────────

export const darwin: PlatformCapabilities = {
  readMicrophoneAccessStatus(): MicrophoneAccessStatus {
    try {
      const raw = String(
        systemPreferences.getMediaAccessStatus('microphone') || ''
      ).toLowerCase();
      if (
        raw === 'granted' ||
        raw === 'denied' ||
        raw === 'restricted' ||
        raw === 'not-determined'
      ) {
        return raw;
      }
      return 'unknown';
    } catch {
      return 'unknown';
    }
  },

  async requestMicrophoneAccessViaNative(
    prompt: boolean
  ): Promise<MicrophonePermissionResult | null> {
    const fs = require('fs');
    const { spawn } = require('child_process');

    const binaryPath = getNativeBinaryPath('microphone-access');
    if (!fs.existsSync(binaryPath)) return null;

    return new Promise<MicrophonePermissionResult | null>((resolve) => {
      const args = prompt ? ['--prompt'] : [];
      const proc = spawn(binaryPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';

      proc.stdout.on('data', (chunk: Buffer | string) => {
        stdout += String(chunk || '');
      });
      proc.on('error', () => resolve(null));
      proc.on('close', () => {
        try {
          const lines = stdout.split('\n').filter(Boolean);
          for (const line of lines) {
            const parsed = JSON.parse(line);
            if (parsed && typeof parsed === 'object') {
              resolve(parsed as MicrophonePermissionResult);
              return;
            }
          }
        } catch {}
        resolve(null);
      });
    });
  },

  probeAudioDurationMs(audioPath: string): number | null {
    const target = String(audioPath || '').trim();
    if (!target) return null;
    try {
      const { spawnSync } = require('child_process');
      const result = spawnSync('/usr/bin/afinfo', [target], {
        encoding: 'utf-8',
        timeout: 4000,
      });
      const output = `${String(result?.stdout || '')}\n${String(result?.stderr || '')}`;
      const secMatch = /estimated duration:\s*([0-9]+(?:\.[0-9]+)?)\s*sec/i.exec(output);
      const seconds = secMatch ? Number(secMatch[1]) : NaN;
      if (Number.isFinite(seconds) && seconds > 0) {
        return Math.round(seconds * 1000);
      }
    } catch {}
    return null;
  },

  resolveSpeakBackend(): LocalSpeakBackend | null {
    try {
      const mod = require('node-edge-tts');
      const ctor = mod?.EdgeTTS || mod?.default?.EdgeTTS || mod?.default || mod;
      if (typeof ctor === 'function') return 'edge-tts';
    } catch {}
    return 'system-say';
  },

  spawnHotkeyHoldMonitor(
    keyCode: number,
    modifiers: HotkeyModifiers,
    holdMs: number
  ): ChildProcess | null {
    const fs = require('fs');
    const binaryPath = getNativeBinaryPath('hotkey-hold-monitor');
    if (!fs.existsSync(binaryPath)) return null;

    const { spawn } = require('child_process');
    try {
      return spawn(
        binaryPath,
        [
          String(keyCode),
          modifiers.cmd ? '1' : '0',
          modifiers.ctrl ? '1' : '0',
          modifiers.shift ? '1' : '0',
          modifiers.alt ? '1' : '0',
          String(holdMs),
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] }
      );
    } catch {
      return null;
    }
  },

  spawnSnippetExpander(keywords: string[]): ChildProcess | null {
    const fs = require('fs');
    const expanderPath = getNativeBinaryPath('snippet-expander');
    if (!fs.existsSync(expanderPath)) return null;

    const { spawn } = require('child_process');
    try {
      return spawn(expanderPath, [JSON.stringify(keywords)], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      return null;
    }
  },

  async pickColor(): Promise<string | null> {
    const fs = require('fs');
    const binaryPath = getNativeBinaryPath('color-picker');
    if (!fs.existsSync(binaryPath)) return null;

    return new Promise<string | null>((resolve) => {
      const { spawn } = require('child_process');
      const proc = spawn(binaryPath, [], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';

      proc.stdout.on('data', (chunk: Buffer | string) => {
        stdout += String(chunk || '');
      });
      proc.on('error', () => resolve(null));
      proc.on('close', () => {
        const color = stdout.trim();
        resolve(color || null);
      });
    });
  },
};
