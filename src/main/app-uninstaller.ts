/**
 * App Uninstaller — scans for macOS app remnants
 *
 * Given an .app path, reads its bundle ID and app name from Info.plist,
 * then searches known ~/Library directories for matching files/folders.
 * Returns a list of remnants with paths, sizes, and labels.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { app } from 'electron';

// ─── Types ─────────────────────────────────────────────────────────

export interface AppRemnant {
  path: string;
  label: string;
  location: string;
  sizeBytes: number;
  isAppBundle: boolean;
}

export interface AppUninstallScanResult {
  appName: string;
  bundleId: string;
  appPath: string;
  appIconDataUrl: string;
  remnants: AppRemnant[];
  totalSizeBytes: number;
}

// ─── Helpers ───────────────────────────────────────────────────────

function readPlistValue(plistPath: string, key: string): string {
  try {
    return execFileSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plistPath], {
      encoding: 'utf-8',
      timeout: 3000,
    }).trim();
  } catch {
    return '';
  }
}

function getAppInfo(appPath: string): { bundleId: string; appName: string } {
  const plist = path.join(appPath, 'Contents', 'Info.plist');
  if (!fs.existsSync(plist)) return { bundleId: '', appName: '' };

  const bundleId = readPlistValue(plist, 'CFBundleIdentifier');
  const displayName =
    readPlistValue(plist, 'CFBundleDisplayName') ||
    readPlistValue(plist, 'CFBundleName') ||
    '';
  const appName = displayName || path.basename(appPath, '.app');

  return { bundleId, appName };
}

/** Get directory or file size in bytes using du -sk for speed. */
function getSize(targetPath: string): number {
  try {
    const stat = fs.lstatSync(targetPath);
    if (stat.isFile()) return stat.size;
    const output = execFileSync('/usr/bin/du', ['-sk', targetPath], {
      encoding: 'utf-8',
      timeout: 10000,
    });
    const kb = parseInt(output.split('\t')[0], 10);
    return Number.isFinite(kb) ? kb * 1024 : 0;
  } catch {
    return 0;
  }
}

function tildefy(p: string): string {
  const home = app.getPath('home');
  if (p.startsWith(home)) return '~' + p.slice(home.length);
  return p;
}

// ─── Scanner ───────────────────────────────────────────────────────

interface ScanDir {
  base: string;
  matchBy: 'bundleId' | 'appName' | 'both';
  /** If set, append this suffix to the match name (e.g. ".savedState", ".plist") */
  suffix?: string;
  /** If true, use glob-style partial matching */
  glob?: boolean;
}

export async function scanAppRemnants(appPath: string): Promise<AppUninstallScanResult> {
  const { bundleId, appName } = getAppInfo(appPath);
  const home = app.getPath('home');

  const result: AppUninstallScanResult = {
    appName: appName || path.basename(appPath, '.app'),
    bundleId,
    appPath,
    appIconDataUrl: '', // Icon fetching handled by renderer via getFileIconDataUrl IPC
    remnants: [],
    totalSizeBytes: 0,
  };

  // Add the .app bundle itself
  const appSize = getSize(appPath);
  result.remnants.push({
    path: appPath,
    label: path.basename(appPath),
    location: path.dirname(appPath),
    sizeBytes: appSize,
    isAppBundle: true,
  });
  result.totalSizeBytes += appSize;

  if (!bundleId && !appName) return result;

  // Directories to scan
  const scanDirs: ScanDir[] = [
    { base: path.join(home, 'Library', 'Application Support'), matchBy: 'both' },
    { base: path.join(home, 'Library', 'Caches'), matchBy: 'both' },
    { base: path.join(home, 'Library', 'Preferences'), matchBy: 'bundleId' },
    { base: path.join(home, 'Library', 'Logs'), matchBy: 'both' },
    { base: path.join(home, 'Library', 'HTTPStorages'), matchBy: 'bundleId' },
    { base: path.join(home, 'Library', 'WebKit'), matchBy: 'bundleId' },
    { base: path.join(home, 'Library', 'Saved Application State'), matchBy: 'bundleId', suffix: '.savedState' },
    { base: path.join(home, 'Library', 'Containers'), matchBy: 'bundleId' },
    { base: path.join(home, 'Library', 'Group Containers'), matchBy: 'bundleId', glob: true },
    { base: path.join(home, 'Library', 'LaunchAgents'), matchBy: 'bundleId' },
    { base: '/Library/LaunchAgents', matchBy: 'bundleId' },
    { base: '/Library/LaunchDaemons', matchBy: 'bundleId' },
  ];

  const seen = new Set<string>([appPath]);

  for (const scanDir of scanDirs) {
    if (!fs.existsSync(scanDir.base)) continue;

    let entries: string[];
    try {
      entries = fs.readdirSync(scanDir.base);
    } catch {
      continue;
    }

    const matchNames: string[] = [];
    if (bundleId && (scanDir.matchBy === 'bundleId' || scanDir.matchBy === 'both')) {
      matchNames.push(bundleId);
      const variant = bundleId.replace(/\./g, '-');
      if (variant !== bundleId) matchNames.push(variant);
    }
    if (appName && (scanDir.matchBy === 'appName' || scanDir.matchBy === 'both')) {
      matchNames.push(appName);
      const stripped = appName.replace(/\.app$/i, '');
      if (stripped !== appName) matchNames.push(stripped);
    }

    for (const entry of entries) {
      const entryLower = entry.toLowerCase();
      let matched = false;

      for (const name of matchNames) {
        const nameLower = name.toLowerCase();
        if (scanDir.glob) {
          if (entryLower.includes(nameLower)) { matched = true; break; }
        } else if (scanDir.suffix) {
          if (entryLower === nameLower + scanDir.suffix.toLowerCase()) { matched = true; break; }
        } else if (scanDir.base.endsWith('Preferences')) {
          if (entryLower === nameLower + '.plist' || entryLower.startsWith(nameLower + '.')) { matched = true; break; }
        } else if (scanDir.base.endsWith('LaunchAgents') || scanDir.base.endsWith('LaunchDaemons')) {
          if (entryLower.startsWith(nameLower) && entryLower.endsWith('.plist')) { matched = true; break; }
        } else {
          if (entryLower === nameLower) { matched = true; break; }
        }
      }

      if (!matched) continue;

      const fullPath = path.join(scanDir.base, entry);
      if (seen.has(fullPath)) continue;
      seen.add(fullPath);

      try { fs.lstatSync(fullPath); } catch { continue; }

      const size = getSize(fullPath);
      result.remnants.push({
        path: fullPath,
        label: entry,
        location: tildefy(scanDir.base),
        sizeBytes: size,
        isAppBundle: false,
      });
      result.totalSizeBytes += size;
    }
  }

  return result;
}
