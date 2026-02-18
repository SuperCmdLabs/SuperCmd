/**
 * platform/windows.ts
 *
 * Windows stubs for PlatformCapabilities.
 * Every method returns a safe value so the app runs without crashing.
 * Real Windows implementations will replace these stubs in follow-up PRs.
 */

import type {
  PlatformCapabilities,
  MicrophoneAccessStatus,
  MicrophonePermissionResult,
  LocalSpeakBackend,
  HotkeyModifiers,
} from './interface';

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
    // afinfo is macOS-only. Will be replaced with a cross-platform probe (ffprobe
    // or the Web Audio API duration) in a follow-up PR.
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
    _keyCode: number,
    _modifiers: HotkeyModifiers,
    _holdMs: number
  ) {
    // Hold-to-talk requires a low-level keyboard hook. Windows implementation
    // (Win32 SetWindowsHookEx / RegisterHotKey) will be added in a follow-up PR.
    return null;
  },

  spawnSnippetExpander(_keywords: string[]) {
    // Snippet expansion requires a system-wide keyboard hook. Windows
    // implementation will be added in a follow-up PR.
    return null;
  },

  async pickColor(): Promise<string | null> {
    // Will use the Win32 ChooseColor dialog or a JS color picker in a follow-up PR.
    return null;
  },
};
