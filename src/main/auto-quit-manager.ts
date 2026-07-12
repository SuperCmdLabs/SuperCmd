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
let trackedBundleIds = new Set<string>();
let trackedMusicBundleIds = new Set<string>();
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

function rebuildTrackedBundleIds(): void {
  trackedBundleIds = new Set();
  trackedMusicBundleIds = new Set();
  for (const entry of autoQuitApps) {
    trackedBundleIds.add(entry.bundleId);
    if (MUSIC_BUNDLE_IDS.has(entry.bundleId)) {
      trackedMusicBundleIds.add(entry.bundleId);
    }
  }
}

function setAutoQuitApps(apps: AutoQuitAppEntry[]): void {
  autoQuitApps = apps;
  rebuildTrackedBundleIds();
}

function seedMissingLastFrontmostTimestamps(now: number): void {
  for (const app of autoQuitApps) {
    if (!lastFrontmostAt.has(app.bundleId)) {
      lastFrontmostAt.set(app.bundleId, now);
    }
  }
}

function getDueAutoQuitCandidates(now: number): AutoQuitAppEntry[] {
  const dueCandidates: AutoQuitAppEntry[] = [];

  for (const entry of autoQuitApps) {
    if (PROTECTED_BUNDLE_IDS.has(entry.bundleId)) continue;

    const lastActive = lastFrontmostAt.get(entry.bundleId);
    if (lastActive === undefined) {
      // First time seeing this app; record now as the inactivity baseline.
      lastFrontmostAt.set(entry.bundleId, now);
      continue;
    }

    const inactiveMs = now - lastActive;
    const timeoutMs = entry.timeoutSeconds * 1000;
    if (inactiveMs >= timeoutMs) {
      dueCandidates.push(entry);
    }
  }

  return dueCandidates;
}

function pruneLastFrontmostEntries(frontmostBundleId: string | null): void {
  for (const bundleId of lastFrontmostAt.keys()) {
    if (!trackedBundleIds.has(bundleId) && bundleId !== frontmostBundleId) {
      lastFrontmostAt.delete(bundleId);
    }
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
    const now = Date.now();
    const dueCandidates = getDueAutoQuitCandidates(now);
    if (dueCandidates.length === 0) {
      pruneLastFrontmostEntries(null);
      return;
    }

    const frontmostBundleId = await getFrontmostBundleId();
    if (!frontmostBundleId) return;

    // Update frontmost timestamp
    lastFrontmostAt.set(frontmostBundleId, now);

    const nonFrontmostDueCandidates = dueCandidates.filter(
      (entry) => entry.bundleId !== frontmostBundleId
    );
    if (nonFrontmostDueCandidates.length === 0) {
      pruneLastFrontmostEntries(frontmostBundleId);
      return;
    }

    // Pause auto-quit only when a non-frontmost tracked app is actually due.
    const recording = await isSystemRecording();
    if (recording) {
      pruneLastFrontmostEntries(frontmostBundleId);
      return;
    }

    const hasDueMusicApp = nonFrontmostDueCandidates.some((entry) =>
      trackedMusicBundleIds.has(entry.bundleId)
    );
    const musicPlaying = hasDueMusicApp ? await isMusicPlaying() : false;

    for (const entry of nonFrontmostDueCandidates) {
      if (musicPlaying && MUSIC_BUNDLE_IDS.has(entry.bundleId)) continue;

      await quitApp(entry.bundleId);
      // Remove from tracking so we don't try to quit again
      lastFrontmostAt.delete(entry.bundleId);
    }

    pruneLastFrontmostEntries(frontmostBundleId);
  } finally {
    checking = false;
  }
}

/**
 * Start the auto-quit polling loop
 */
export function startAutoQuit(apps: AutoQuitAppEntry[]): void {
  setAutoQuitApps(apps);
  if (apps.length === 0) return;

  // Initialize all tracked apps with current time
  seedMissingLastFrontmostTimestamps(Date.now());

  if (pollInterval) return; // Already running
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
  setAutoQuitApps(apps);
  if (apps.length === 0) {
    stopAutoQuit();
    lastFrontmostAt.clear();
  } else if (!pollInterval) {
    startAutoQuit(apps);
  } else {
    seedMissingLastFrontmostTimestamps(Date.now());
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
  rebuildTrackedBundleIds();
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
  setAutoQuitApps(autoQuitApps.filter(a => a.bundleId !== bundleId));
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
