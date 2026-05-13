/**
 * Auto Quit Manager
 *
 * Background service that automatically quits apps after they've been
 * inactive (not frontmost) for a configurable timeout.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface AutoQuitAppEntry {
  bundleId: string;
  appName: string;
  appPath: string;
  timeoutSeconds: number;
}

// Protected apps that should never be auto-quit
const PROTECTED_BUNDLE_IDS = new Set([
  'com.apple.finder',
  'com.apple.loginwindow',
  'com.apple.dock',
  'com.apple.SystemUIServer',
  'com.electron.supercmd',
  'com.supercmd.app',
]);

// Music apps that should not be quit while playing
const MUSIC_BUNDLE_IDS = new Set([
  'com.spotify.client',
  'com.apple.Music',
  'com.apple.iTunes',
]);

let pollInterval: ReturnType<typeof setInterval> | null = null;
let lastFrontmostAt = new Map<string, number>(); // bundleId → timestamp
let autoQuitApps: AutoQuitAppEntry[] = [];
let checking = false;

/**
 * Get the frontmost app's bundle ID via AppleScript
 */
async function getFrontmostBundleId(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('/usr/bin/osascript', [
      '-l', 'AppleScript',
      '-e', 'tell application "System Events" to get bundle identifier of first application process whose frontmost is true',
    ]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

// Strict bundle ID validation: only allow alphanumeric, dots, and hyphens
const BUNDLE_ID_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9.\-]*$/;

function isValidBundleId(bundleId: string): boolean {
  return BUNDLE_ID_REGEX.test(bundleId) && bundleId.length <= 255;
}

/**
 * Quit an app by bundle ID using NSWorkspace terminate
 */
async function quitApp(bundleId: string): Promise<void> {
  if (!isValidBundleId(bundleId)) return; // Reject malformed bundle IDs

  const script = `
    use framework "AppKit"
    set runningApps to current application's NSWorkspace's sharedWorkspace()'s runningApplications()
    repeat with runningApp in runningApps
      try
        set bid to runningApp's bundleIdentifier() as text
        if bid is "${bundleId}" then
          runningApp's terminate()
        end if
      end try
    end repeat
  `;
  try {
    await execFileAsync('/usr/bin/osascript', ['-l', 'AppleScript', '-e', script]);
  } catch {
    // Ignore quit failures (app may have already quit)
  }
}

/**
 * Check if system is recording audio/video (CoreAudio active)
 */
async function isSystemRecording(): Promise<boolean> {
  try {
    // Check if any audio input device is actively recording
    const { stdout } = await execFileAsync('/usr/bin/osascript', [
      '-l', 'AppleScript',
      '-e', 'do shell script "ioreg -c AppleHDAEngineInput | grep -c IOAudioEngineState\\ =\\ 1 2>/dev/null || echo 0"',
    ]);
    return parseInt(stdout.trim(), 10) > 0;
  } catch {
    return false;
  }
}

/**
 * Check if music is currently playing (Spotify or Apple Music)
 */
async function isMusicPlaying(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('/usr/bin/osascript', [
      '-l', 'AppleScript',
      '-e', `
        set isPlaying to false
        try
          tell application "System Events"
            if exists (process "Spotify") then
              tell application "Spotify" to if player state is playing then set isPlaying to true
            end if
          end tell
        end try
        try
          tell application "System Events"
            if exists (process "Music") then
              tell application "Music" to if player state is playing then set isPlaying to true
            end if
          end tell
        end try
        return isPlaying as text
      `,
    ]);
    return stdout.trim() === 'true';
  } catch {
    return false;
  }
}

/**
 * Check all tracked apps and quit those that exceeded their timeout
 */
async function checkAndQuit(): Promise<void> {
  if (checking) return;
  if (autoQuitApps.length === 0) return;
  checking = true;
  try {
    // Pause all auto-quit if system is recording
    const recording = await isSystemRecording();
    if (recording) return;

    const frontmostBundleId = await getFrontmostBundleId();
    if (!frontmostBundleId) return;

    // Check if music is playing (protect music apps)
    const musicPlaying = await isMusicPlaying();

    const now = Date.now();

    // Update frontmost timestamp
    lastFrontmostAt.set(frontmostBundleId, now);

    // Check each auto-quit app
    for (const entry of autoQuitApps) {
      // Skip if this app is currently frontmost
      if (entry.bundleId === frontmostBundleId) continue;

      // Skip protected apps
      if (PROTECTED_BUNDLE_IDS.has(entry.bundleId)) continue;

      // Skip music apps if music is playing
      if (musicPlaying && MUSIC_BUNDLE_IDS.has(entry.bundleId)) continue;

      const lastActive = lastFrontmostAt.get(entry.bundleId);
      if (lastActive === undefined) {
        // First time seeing this app — record now as baseline
        lastFrontmostAt.set(entry.bundleId, now);
        continue;
      }

      const inactiveMs = now - lastActive;
      const timeoutMs = entry.timeoutSeconds * 1000;

      if (inactiveMs >= timeoutMs) {
        await quitApp(entry.bundleId);
        // Remove from tracking so we don't try to quit again
        lastFrontmostAt.delete(entry.bundleId);
      }
    }

    // Prune lastFrontmostAt entries for apps no longer tracked or frontmost
    const trackedBundleIds = new Set(autoQuitApps.map((e) => e.bundleId));
    for (const bundleId of lastFrontmostAt.keys()) {
      if (!trackedBundleIds.has(bundleId) && bundleId !== frontmostBundleId) {
        lastFrontmostAt.delete(bundleId);
      }
    }
  } finally {
    checking = false;
  }
}

/**
 * Start the auto-quit polling loop
 */
export function startAutoQuit(apps: AutoQuitAppEntry[]): void {
  autoQuitApps = apps;
  if (pollInterval) return; // Already running
  if (apps.length === 0) return;

  // Initialize all tracked apps with current time
  const now = Date.now();
  for (const app of apps) {
    if (!lastFrontmostAt.has(app.bundleId)) {
      lastFrontmostAt.set(app.bundleId, now);
    }
  }

  pollInterval = setInterval(checkAndQuit, 5000);
}

/**
 * Stop the auto-quit polling loop
 */
export function stopAutoQuit(): void {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

/**
 * Update the app list (restarts polling if needed)
 */
export function updateAutoQuitApps(apps: AutoQuitAppEntry[]): void {
  autoQuitApps = apps;
  if (apps.length === 0) {
    stopAutoQuit();
    lastFrontmostAt.clear();
  } else if (!pollInterval) {
    startAutoQuit(apps);
  }
}

/**
 * Add an app to auto-quit
 */
export function addAutoQuitApp(entry: AutoQuitAppEntry): void {
  if (PROTECTED_BUNDLE_IDS.has(entry.bundleId)) return;
  if (!isValidBundleId(entry.bundleId)) return;
  const existing = autoQuitApps.findIndex(a => a.bundleId === entry.bundleId);
  if (existing >= 0) {
    autoQuitApps[existing] = entry;
  } else {
    autoQuitApps.push(entry);
  }
  // Set baseline timestamp
  lastFrontmostAt.set(entry.bundleId, Date.now());
  if (!pollInterval) {
    startAutoQuit(autoQuitApps);
  }
}

/**
 * Remove an app from auto-quit
 */
export function removeAutoQuitApp(bundleId: string): void {
  autoQuitApps = autoQuitApps.filter(a => a.bundleId !== bundleId);
  lastFrontmostAt.delete(bundleId);
  if (autoQuitApps.length === 0) {
    stopAutoQuit();
  }
}

/**
 * Get the current auto-quit app list
 */
export function getAutoQuitApps(): AutoQuitAppEntry[] {
  return [...autoQuitApps];
}
