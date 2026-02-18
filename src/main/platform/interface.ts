/**
 * platform/interface.ts
 *
 * Contract every platform implementation must satisfy.
 * main.ts imports from platform/index.ts — never from darwin.ts or windows.ts directly.
 */

import type { ChildProcess } from 'child_process';

// ── Shared types ─────────────────────────────────────────────────────────────

export type MicrophoneAccessStatus =
  | 'granted'
  | 'denied'
  | 'restricted'
  | 'not-determined'
  | 'unknown';

export interface MicrophonePermissionResult {
  granted: boolean;
  status: MicrophoneAccessStatus;
  requested?: boolean;
  error?: string;
}

/** Backends available for local (offline) text-to-speech. */
export type LocalSpeakBackend = 'edge-tts' | 'system-say';

export interface HotkeyModifiers {
  cmd: boolean;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
}

// ── Platform interface ────────────────────────────────────────────────────────

export interface PlatformCapabilities {
  /**
   * Read the current microphone permission status without prompting the user.
   * On platforms that have no permission model (Windows), returns 'granted'.
   */
  readMicrophoneAccessStatus(): MicrophoneAccessStatus;

  /**
   * Invoke the native helper to request (or probe) microphone access.
   * Returns null on platforms where the helper is unavailable.
   */
  requestMicrophoneAccessViaNative(
    prompt: boolean
  ): Promise<MicrophonePermissionResult | null>;

  /**
   * Use a platform audio inspection tool to measure the duration of an audio
   * file. Returns null when the tool is unavailable (all non-macOS platforms).
   */
  probeAudioDurationMs(audioPath: string): number | null;

  /**
   * Resolve which local speech backend to use.
   * 'system-say' is macOS-only; 'edge-tts' works everywhere.
   * Returns null when neither is available.
   */
  resolveSpeakBackend(): LocalSpeakBackend | null;

  /**
   * Spawn the native hotkey-hold monitor process.
   * Returns null on platforms where the binary is unavailable.
   */
  spawnHotkeyHoldMonitor(
    keyCode: number,
    modifiers: HotkeyModifiers,
    holdMs: number
  ): ChildProcess | null;

  /**
   * Spawn the native snippet-expander process with the given keyword list.
   * Returns null on platforms where the binary is unavailable.
   */
  spawnSnippetExpander(keywords: string[]): ChildProcess | null;

  /**
   * Open the platform color-picker and resolve with the picked hex color,
   * or null if the user cancelled or the feature is unavailable.
   */
  pickColor(): Promise<string | null>;
}
