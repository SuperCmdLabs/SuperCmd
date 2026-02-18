/**
 * platform/index.ts
 *
 * Exports the correct PlatformCapabilities implementation for the current OS.
 * Import from here — never from darwin.ts or windows.ts directly.
 *
 *   import { platform } from './platform';
 *   const status = platform.readMicrophoneAccessStatus();
 */

export type {
  PlatformCapabilities,
  MicrophoneAccessStatus,
  MicrophonePermissionResult,
  LocalSpeakBackend,
  HotkeyModifiers,
} from './interface';

import { darwin } from './darwin';
import { windows } from './windows';

export const platform =
  process.platform === 'win32' ? windows : darwin;
