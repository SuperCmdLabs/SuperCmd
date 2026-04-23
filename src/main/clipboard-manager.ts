/**
 * Clipboard Manager
 *
 * Monitors macOS clipboard and stores history of text, images, and URLs.
 * - Polls clipboard every 1 second
 * - Stores up to 1000 items
 * - Persists to disk (JSON for metadata, separate files for images)
 * - Supports text, images (png/jpg/gif/webp), URLs, and file paths
 */

import { app, clipboard, nativeImage } from 'electron';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

/**
 * Write a GIF file to macOS pasteboard with file URL + GIF data + TIFF
 * fallback via NSPasteboard so apps like Twitter/Slack treat it as a GIF
 * file upload and other apps get a static fallback.
 */
function writeGifToClipboard(filePath: string): boolean {
  try {
    const swift = `
import Cocoa
let filePath = CommandLine.arguments[1]
let fileUrl = URL(fileURLWithPath: filePath)
guard let gifData = try? Data(contentsOf: fileUrl) else { exit(1) }
let image = NSImage(data: gifData)
let pb = NSPasteboard.general
pb.clearContents()
pb.writeObjects([fileUrl as NSURL])
pb.addTypes([NSPasteboard.PasteboardType("com.compuserve.gif"), .tiff], owner: nil)
pb.setData(gifData, forType: NSPasteboard.PasteboardType("com.compuserve.gif"))
if let tiff = image?.tiffRepresentation {
    pb.setData(tiff, forType: .tiff)
}
`;
    execFileSync('swift', ['-e', swift, filePath], { stdio: 'ignore', timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

export interface ClipboardItem {
  id: string;
  type: 'text' | 'image' | 'url' | 'file';
  content: string; // For text/url/file: the actual content. For images: file path
  preview?: string; // Short preview for display
  timestamp: number;
  pinned?: boolean;
  source?: string; // Application name that copied
  metadata?: {
    // For images
    width?: number;
    height?: number;
    size?: number; // bytes
    format?: string;
    // For files
    filename?: string;
    // Original file path at the moment of copy — used as a fallback preview
    // source when our saved copy is missing or fails to decode.
    sourcePath?: string;
  };
}

const MAX_ITEMS = 1000;
const POLL_INTERVAL = 1000; // 1 second
const MAX_TEXT_LENGTH = 100_000; // Don't store huge text items
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB max per image
const INTERNAL_CLIPBOARD_PROBE_REGEX = /^__supercmd_[a-z0-9_]+_probe__\d+_[a-z0-9]+$/i;

let clipboardHistory: ClipboardItem[] = [];
let lastClipboardText = '';
let lastClipboardImage: Buffer | null = null;
let lastClipboardFilePath = '';
let pollInterval: NodeJS.Timeout | null = null;
let isEnabled = true;
// Bundle IDs (lower-cased) whose copies should be skipped. Kept lowercase
// so membership checks are case-insensitive against whatever macOS reports.
let blacklistedAppBundleIds: Set<string> = new Set();

// ─── Paths ──────────────────────────────────────────────────────────

function getClipboardDir(): string {
  const dir = path.join(app.getPath('userData'), 'clipboard-history');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getImagesDir(): string {
  const dir = path.join(getClipboardDir(), 'images');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getHistoryFilePath(): string {
  return path.join(getClipboardDir(), 'history.json');
}

function sortClipboardHistory(): void {
  clipboardHistory.sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) {
      return a.pinned ? -1 : 1;
    }
    return b.timestamp - a.timestamp;
  });
}

// ─── Persistence ────────────────────────────────────────────────────

function loadHistory(): void {
  try {
    const historyPath = getHistoryFilePath();
    if (fs.existsSync(historyPath)) {
      const data = fs.readFileSync(historyPath, 'utf-8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        // Verify image files still exist and drop internal probe artifacts.
        const filtered = parsed.filter((item) => {
          if (item.type === 'image') {
            return fs.existsSync(item.content);
          }
          if (item.type === 'text' || item.type === 'url' || item.type === 'file') {
            const normalized = normalizeTextForComparison(item.content);
            if (!normalized) return false;
            if (INTERNAL_CLIPBOARD_PROBE_REGEX.test(normalized)) return false;
          }
          return true;
        });
        // Dedupe text-like entries on load while preserving newest-first ordering.
        const dedupeKeys = new Set<string>();
        clipboardHistory = filtered.filter((item) => {
          if (item.type !== 'text' && item.type !== 'url' && item.type !== 'file') return true;
          const key = `${item.type}:${normalizeTextForComparison(item.content).toLowerCase()}`;
          if (dedupeKeys.has(key)) return false;
          dedupeKeys.add(key);
          return true;
        }).map((item) => ({
          ...item,
          pinned: Boolean(item?.pinned),
        }));
        sortClipboardHistory();
        console.log(`Loaded ${clipboardHistory.length} clipboard items from disk`);
      }
    }
  } catch (e) {
    console.error('Failed to load clipboard history:', e);
    clipboardHistory = [];
  }
}

function saveHistory(): void {
  try {
    const historyPath = getHistoryFilePath();
    fs.writeFileSync(historyPath, JSON.stringify(clipboardHistory, null, 2));
  } catch (e) {
    console.error('Failed to save clipboard history:', e);
  }
}

// ─── Clipboard Monitoring ───────────────────────────────────────────

function hashBuffer(buf: Buffer): string {
  return crypto.createHash('md5').update(buf).digest('hex');
}

function getCurrentFrontmostBundleId(): string | undefined {
  if (process.platform !== 'darwin') return undefined;
  try {
    const asn = String(
      execFileSync('/usr/bin/lsappinfo', ['front'], { encoding: 'utf-8', timeout: 500, stdio: ['ignore', 'pipe', 'ignore'] }) || ''
    ).trim();
    if (!asn) return undefined;
    const info = String(
      execFileSync(
        '/usr/bin/lsappinfo',
        ['info', '-only', 'bundleid', asn],
        { encoding: 'utf-8', timeout: 500, stdio: ['ignore', 'pipe', 'ignore'] }
      ) || ''
    );
    const bundleId =
      info.match(/"CFBundleIdentifier"\s*=\s*"([^"]*)"/)?.[1]?.trim() ||
      info.match(/"bundleid"\s*=\s*"([^"]*)"/i)?.[1]?.trim() ||
      undefined;
    return bundleId || undefined;
  } catch {
    return undefined;
  }
}

function isFrontmostAppBlacklisted(): boolean {
  if (blacklistedAppBundleIds.size === 0) return false;
  const bundleId = getCurrentFrontmostBundleId();
  if (!bundleId) return false;
  return blacklistedAppBundleIds.has(bundleId.toLowerCase());
}

function detectType(text: string): 'url' | 'file' | 'text' {
  const trimmed = text.trim();
  
  // URL detection
  try {
    const url = new URL(trimmed);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return 'url';
    }
  } catch {}
  
  // File path detection (macOS paths)
  if (trimmed.startsWith('/') || trimmed.startsWith('~')) {
    // Check if it looks like a valid path
    const expanded = trimmed.replace('~', process.env.HOME || '');
    if (fs.existsSync(expanded)) {
      return 'file';
    }
  }
  
  return 'text';
}

function normalizeTextForComparison(text: string): string {
  return String(text || '').replace(/\r\n/g, '\n').trim();
}

function findComparableTextItemIndex(type: ClipboardItem['type'], normalizedContent: string): number {
  if (!normalizedContent) return -1;
  // Text-like dedupe: text/url/file entries with same normalized content.
  return clipboardHistory.findIndex((item) => {
    if (item.type !== 'text' && item.type !== 'url' && item.type !== 'file') return false;
    if (item.type !== type) return false;
    return normalizeTextForComparison(item.content) === normalizedContent;
  });
}

function addTextItem(text: string): void {
  const normalized = normalizeTextForComparison(text);
  if (!normalized || normalized.length > MAX_TEXT_LENGTH) return;
  if (INTERNAL_CLIPBOARD_PROBE_REGEX.test(normalized)) return;

  // If the text looks like a bare filename (no slash) and the pasteboard is
  // carrying a file URL, promote it to a file entry with the full path so the
  // metadata panel shows a useful source path.
  let effectiveContent = normalized;
  let resolvedFilePath: string | null = null;
  if (!normalized.includes('/') && !normalized.startsWith('http')) {
    const filePath = readClipboardFilePath();
    if (filePath && path.basename(filePath) === normalized) {
      effectiveContent = filePath;
      resolvedFilePath = filePath;
    }
  }
  const normalizedResolved = normalizeTextForComparison(effectiveContent);
  const type = detectType(normalizedResolved);
  const preview = normalizedResolved.length > 200 ? normalizedResolved.substring(0, 200) + '...' : normalizedResolved;

  const existingIndex = findComparableTextItemIndex(type, normalizedResolved);
  if (existingIndex >= 0) {
    const existing = clipboardHistory[existingIndex];
    existing.timestamp = Date.now();
    existing.preview = preview;
    existing.content = normalizedResolved;
    if (type === 'file') {
      const filename = path.basename(normalizedResolved);
      existing.metadata = {
        ...(existing.metadata || {}),
        filename,
        ...(resolvedFilePath ? { sourcePath: resolvedFilePath } : {}),
      };
    }
    sortClipboardHistory();
    saveHistory();
    return;
  }

  const item: ClipboardItem = {
    id: crypto.randomUUID(),
    type,
    content: normalizedResolved,
    preview,
    timestamp: Date.now(),
  };

  if (type === 'file') {
    const filename = path.basename(normalizedResolved);
    item.metadata = {
      filename,
      ...(resolvedFilePath ? { sourcePath: resolvedFilePath } : {}),
    };
  }

  clipboardHistory.unshift(item);
  sortClipboardHistory();
  if (clipboardHistory.length > MAX_ITEMS) {
    clipboardHistory.pop();
  }

  saveHistory();
}

function addImageItem(
  image: ReturnType<typeof nativeImage.createFromDataURL>,
  rawGifData?: Buffer,
  sourceFilename?: string
): void {
  try {
    const size = image.getSize();
    if (size.width === 0 || size.height === 0) return;

    const isGif = !!rawGifData;
    const dataToSave = rawGifData || image.toPNG();
    if (dataToSave.length === 0 || dataToSave.length > MAX_IMAGE_SIZE) return;

    const ext = isGif ? 'gif' : 'png';

    // Save image to disk
    const imageId = crypto.randomUUID();
    const imagePath = path.join(getImagesDir(), `${imageId}.${ext}`);
    fs.writeFileSync(imagePath, dataToSave);

    const item: ClipboardItem = {
      id: imageId,
      type: 'image',
      content: imagePath,
      timestamp: Date.now(),
      metadata: {
        width: size.width,
        height: size.height,
        size: dataToSave.length,
        format: ext,
        ...(sourceFilename ? { filename: sourceFilename } : {}),
      },
    };

    clipboardHistory.unshift(item);
    sortClipboardHistory();
    if (clipboardHistory.length > MAX_ITEMS) {
      const removed = clipboardHistory.pop();
      // Delete old image file
      if (removed && removed.type === 'image' && fs.existsSync(removed.content)) {
        try {
          fs.unlinkSync(removed.content);
        } catch {}
      }
    }

    saveHistory();
  } catch (e) {
    console.error('Failed to save clipboard image:', e);
  }
}

function decodeFileUrlCandidate(raw: string): string | null {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;
  const first = trimmed.split(/\r?\n|\0/)[0].trim();
  if (!first) return null;
  try {
    if (first.startsWith('file://')) {
      return decodeURIComponent(new URL(first).pathname);
    }
  } catch {}
  if (first.startsWith('/')) return first;
  return null;
}

function readClipboardFilePathViaOsascript(): string | null {
  if (process.platform !== 'darwin') return null;
  try {
    const { execFileSync } = require('child_process');
    // `the clipboard as «class furl»` returns the file URL if the pasteboard
    // has a file reference, throws otherwise. -e is a single AppleScript.
    const out = execFileSync(
      '/usr/bin/osascript',
      ['-e', 'POSIX path of (the clipboard as «class furl»)'],
      { timeout: 500, stdio: ['ignore', 'pipe', 'ignore'] }
    ).toString().trim();
    if (!out) return null;
    if (out.startsWith('/')) return out;
    return null;
  } catch {
    return null;
  }
}

function clipboardLooksLikeFileCopy(): boolean {
  try {
    const formats = clipboard.availableFormats();
    for (const fmt of formats) {
      const lower = fmt.toLowerCase();
      if (
        lower === 'public.file-url' ||
        lower === 'nsfilenamespboardtype' ||
        lower.includes('file-url') ||
        lower.includes('filenames')
      ) {
        return true;
      }
    }
  } catch {}
  return false;
}

// Cache the osascript result for the last-seen clipboard "signature" so we
// don't spawn a subprocess on every 1 s poll. We invalidate the cache when
// readText or readImage changes.
let lastOsascriptSignature = '';
let lastOsascriptResult: string | null = null;

function computeClipboardSignature(): string {
  try {
    const text = clipboard.readText();
    const img = clipboard.readImage();
    const imgHash = !img.isEmpty() ? hashBuffer(img.toPNG()).slice(0, 16) : '';
    return `${text.length}:${text.slice(0, 64)}:${imgHash}`;
  } catch {
    return '';
  }
}

function readClipboardFilePath(): string | null {
  // Fast path: try the common pasteboard UTIs directly.
  const candidateFormats = [
    'public.file-url',
    'NSFilenamesPboardType',
  ];
  for (const fmt of candidateFormats) {
    try {
      const viaString = decodeFileUrlCandidate(clipboard.read(fmt));
      if (viaString && fs.existsSync(viaString)) return viaString;
    } catch {}
    try {
      const buf = clipboard.readBuffer(fmt);
      if (buf && buf.length > 0) {
        const viaBuffer = decodeFileUrlCandidate(buf.toString('utf8'));
        if (viaBuffer && fs.existsSync(viaBuffer)) return viaBuffer;
      }
    } catch {}
  }
  // If the plain-text slot happens to be a valid existing path, use it.
  try {
    const asText = decodeFileUrlCandidate(clipboard.readText());
    if (asText && fs.existsSync(asText)) return asText;
  } catch {}
  // Always try osascript as a fallback — it reliably catches file URLs on
  // all macOS versions regardless of how Electron exposes pasteboard UTIs.
  // Cache the result per clipboard signature so we don't spawn a subprocess
  // on every poll when the clipboard hasn't changed.
  const signature = computeClipboardSignature();
  if (signature && signature === lastOsascriptSignature) {
    return lastOsascriptResult;
  }
  const viaOsascript = readClipboardFilePathViaOsascript();
  lastOsascriptSignature = signature;
  lastOsascriptResult = viaOsascript && fs.existsSync(viaOsascript) ? viaOsascript : null;
  return lastOsascriptResult;
}

const IMAGE_FILE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.heic', '.heif',
  '.bmp', '.tiff', '.tif', '.svg', '.ico',
]);

function isImageFilePath(filePath: string): boolean {
  return IMAGE_FILE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function pollClipboard(): void {
  if (!isEnabled) return;

  try {
    // A file URL on the pasteboard (Finder copy) takes priority over
    // readImage() — Finder places the file's *generic icon* as the clipboard
    // image, not the actual contents, and a filename-only text representation,
    // which would otherwise produce two extra junk entries per copy.
    const clipboardFilePath = readClipboardFilePath();
    if (clipboardFilePath) {
      if (clipboardFilePath !== lastClipboardFilePath) {
        if (isFrontmostAppBlacklisted()) {
          // Seed the caches so we don't keep re-checking the same paste as "new"
          // on every poll once the user leaves the blacklisted app.
          lastClipboardFilePath = clipboardFilePath;
          try { lastClipboardText = clipboard.readText() || ''; } catch {}
          try {
            const img = clipboard.readImage();
            if (!img.isEmpty()) lastClipboardImage = img.toPNG();
          } catch {}
          return;
        }
        console.log(`[Clipboard] File URL detected on pasteboard: ${clipboardFilePath}`);
        const handled = handleClipboardFileCopy(clipboardFilePath);
        if (handled) {
          lastClipboardFilePath = clipboardFilePath;
          // Seed the image/text caches with whatever the file copy is showing
          // on the pasteboard so subsequent polls treat it as "already seen".
          try { lastClipboardText = clipboard.readText() || ''; } catch {}
          try {
            const img = clipboard.readImage();
            if (!img.isEmpty()) lastClipboardImage = img.toPNG();
          } catch {}
        }
      }
      // Whether or not this specific path was handled *this* poll, the
      // pasteboard currently holds a file reference. Skip image/text paths
      // entirely — otherwise we'd create:
      //   (a) a generic-document-icon image entry from readImage(), and
      //   (b) a bare-filename text entry from readText()
      // alongside the real file entry.
      return;
    }

    // No file URL on the clipboard. If the Finder-style formats still show
    // up (e.g. we couldn't extract the path but it looks like a file copy),
    // skip the image/text paths too to avoid the same two junk entries.
    if (clipboardLooksLikeFileCopy()) {
      return;
    }

    // Check for GIF data first (clipboard.readImage loses animation)
    let rawGifData: Buffer | undefined;
    try {
      const gifBuf = clipboard.readBuffer('com.compuserve.gif');
      if (gifBuf && gifBuf.length > 4) {
        // Verify GIF magic bytes (GIF87a or GIF89a)
        if (gifBuf[0] === 0x47 && gifBuf[1] === 0x49 && gifBuf[2] === 0x46) {
          rawGifData = gifBuf;
        }
      }
    } catch {}

    // Check for images (higher priority than text)
    const image = clipboard.readImage();
    if (!image.isEmpty()) {
      const hashSource = rawGifData || image.toPNG();
      const hash = hashBuffer(hashSource);

      if (!lastClipboardImage || hashBuffer(lastClipboardImage) !== hash) {
        if (isFrontmostAppBlacklisted()) {
          // Seed the image cache so subsequent polls don't re-trigger.
          lastClipboardImage = hashSource;
          return;
        }
        lastClipboardImage = hashSource;
        addImageItem(image, rawGifData);
        return;
      }
    }

    // Check for text
    const text = clipboard.readText();
    if (text && text !== lastClipboardText) {
      if (isFrontmostAppBlacklisted()) {
        lastClipboardText = text;
        return;
      }
      lastClipboardText = text;
      addTextItem(text);
    }
  } catch (e) {
    console.error('Clipboard poll error:', e);
  }
}

function handleClipboardFileCopy(filePath: string): boolean {
  if (!fs.existsSync(filePath)) {
    console.log(`[Clipboard] File URL on pasteboard but path does not exist: ${filePath}`);
    return false;
  }
  const filename = path.basename(filePath);

  if (isImageFilePath(filePath)) {
    try {
      const stat = fs.statSync(filePath);
      if (stat.size === 0 || stat.size > MAX_IMAGE_SIZE) {
        console.log(`[Clipboard] Skipping image file (size=${stat.size}): ${filePath}`);
        return false;
      }

      // Copy the file as-is into our images dir. Going through
      // nativeImage.createFromBuffer() drops unsupported formats (HEIC, SVG,
      // some WebP), so keep the original bytes and let the renderer <img>
      // tag — which uses the system image decoder via file:// — render it.
      const imageId = crypto.randomUUID();
      const ext = path.extname(filePath).toLowerCase().replace(/^\./, '') || 'bin';
      const imagePath = path.join(getImagesDir(), `${imageId}.${ext}`);
      fs.copyFileSync(filePath, imagePath);
      console.log(`[Clipboard] Copied image file → ${imagePath} (filename=${filename}, size=${stat.size})`);

      let width = 0;
      let height = 0;
      try {
        const img = nativeImage.createFromPath(imagePath);
        if (!img.isEmpty()) {
          const size = img.getSize();
          width = size.width;
          height = size.height;
        }
      } catch {}

      const item: ClipboardItem = {
        id: imageId,
        type: 'image',
        content: imagePath,
        timestamp: Date.now(),
        metadata: {
          width,
          height,
          size: stat.size,
          format: ext,
          filename,
          sourcePath: filePath,
        },
      };

      clipboardHistory.unshift(item);
      sortClipboardHistory();
      if (clipboardHistory.length > MAX_ITEMS) {
        const removed = clipboardHistory.pop();
        if (removed && removed.type === 'image' && fs.existsSync(removed.content)) {
          try { fs.unlinkSync(removed.content); } catch {}
        }
      }
      saveHistory();
      return true;
    } catch (e) {
      console.error('[Clipboard] Failed to capture image file, falling back to file entry:', e);
      // Fall through to add as file entry so we at least don't lose it.
    }
  }

  // Non-image file (or image capture failed) — add a single file entry
  // keyed on the real path with filename metadata.
  addTextItem(filePath);
  return true;
}

// ─── Public API ─────────────────────────────────────────────────────

export function startClipboardMonitor(): void {
  loadHistory();
  
  // Initial read
  try {
    lastClipboardText = clipboard.readText();
    const image = clipboard.readImage();
    if (!image.isEmpty()) {
      lastClipboardImage = image.toPNG();
    }
    lastClipboardFilePath = readClipboardFilePath() || '';
  } catch {}
  
  // Start polling
  if (pollInterval) {
    clearInterval(pollInterval);
  }
  // Run one poll immediately so changes right after startup are captured.
  pollClipboard();
  pollInterval = setInterval(pollClipboard, POLL_INTERVAL);
  
  console.log('Clipboard monitor started');
}

export function stopClipboardMonitor(): void {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  console.log('Clipboard monitor stopped');
}

export function getClipboardHistory(): ClipboardItem[] {
  return clipboardHistory;
}

/**
 * Drop non-pinned entries whose timestamp is older than `retentionDays`.
 * `null` / undefined / non-positive = no-op (keep forever).
 * Returns the number of entries removed.
 */
export function pruneClipboardHistoryOlderThan(retentionDays: number | null | undefined): number {
  if (retentionDays == null) return 0;
  const days = Number(retentionDays);
  if (!Number.isFinite(days) || days <= 0) return 0;

  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const before = clipboardHistory.length;
  const kept: ClipboardItem[] = [];
  for (const item of clipboardHistory) {
    if (item.pinned) {
      kept.push(item);
      continue;
    }
    if (typeof item.timestamp !== 'number' || item.timestamp >= cutoff) {
      kept.push(item);
      continue;
    }
    if (item.type === 'image' && fs.existsSync(item.content)) {
      try { fs.unlinkSync(item.content); } catch {}
    }
  }
  const removed = before - kept.length;
  if (removed > 0) {
    clipboardHistory = kept;
    saveHistory();
    console.log(`Pruned ${removed} clipboard item${removed === 1 ? '' : 's'} older than ${days} day${days === 1 ? '' : 's'}`);
  }
  return removed;
}

export function clearClipboardHistory(): void {
  // Delete all image files
  for (const item of clipboardHistory) {
    if (item.type === 'image' && fs.existsSync(item.content)) {
      try {
        fs.unlinkSync(item.content);
      } catch {}
    }
  }
  
  clipboardHistory = [];
  saveHistory();
  console.log('Clipboard history cleared');
}

export function deleteClipboardItem(id: string): boolean {
  const index = clipboardHistory.findIndex((item) => item.id === id);
  if (index === -1) return false;
  
  const item = clipboardHistory[index];
  
  // Delete image file if it exists
  if (item.type === 'image' && fs.existsSync(item.content)) {
    try {
      fs.unlinkSync(item.content);
    } catch {}
  }
  
  clipboardHistory.splice(index, 1);
  saveHistory();
  
  return true;
}

export function getClipboardItemById(id: string): ClipboardItem | null {
  const item = clipboardHistory.find((i) => i.id === id);
  return item ? { ...item } : null;
}

export function togglePinClipboardItem(id: string): ClipboardItem | null {
  const item = clipboardHistory.find((i) => i.id === id);
  if (!item) return null;

  item.pinned = !Boolean(item.pinned);
  sortClipboardHistory();
  saveHistory();
  return { ...item };
}

export function copyItemToClipboard(id: string): boolean {
  const item = clipboardHistory.find((i) => i.id === id);
  if (!item) return false;

  try {
    // Temporarily disable monitoring to avoid re-adding this item
    isEnabled = false;

    if (item.type === 'image') {
      const ext = path.extname(item.content).toLowerCase();
      if (ext === '.gif' && fs.existsSync(item.content)) {
        // Write GIF via NSPasteboard with both com.compuserve.gif (animated)
        // and public.tiff (static fallback) so GIF-aware apps get animation.
        if (!writeGifToClipboard(item.content)) {
          // Fallback: write raw GIF buffer only
          const gifData = fs.readFileSync(item.content);
          clipboard.clear();
          clipboard.writeBuffer('com.compuserve.gif', gifData);
        }
      } else {
        const imageUtis: Record<string, string> = {
          '.png': 'public.png',
          '.jpg': 'public.jpeg',
          '.jpeg': 'public.jpeg',
          '.webp': 'org.webmproject.webp',
          '.bmp': 'com.microsoft.bmp',
          '.tiff': 'public.tiff',
          '.tif': 'public.tiff',
          '.heic': 'public.heic',
        };
        const imageUti = imageUtis[ext];

        if (imageUti && process.platform === 'darwin' && fs.existsSync(item.content)) {
          const rawData = fs.readFileSync(item.content);
          clipboard.clear();
          clipboard.writeBuffer(imageUti, rawData);

          // Keep a PNG fallback for apps that ignore the source UTI but can
          // still accept a standard raster image payload on paste.
          const fallbackImage = nativeImage.createFromPath(item.content);
          if (!fallbackImage.isEmpty()) {
            clipboard.writeBuffer('public.png', fallbackImage.toPNG());
          }
        } else {
          const image = nativeImage.createFromPath(item.content);
          clipboard.writeImage(image);
        }
      }
      // Update lastClipboardImage so the next poll doesn't see a "new" image
      // and create a duplicate entry.
      try {
        const img = clipboard.readImage();
        if (!img.isEmpty()) {
          lastClipboardImage = img.toPNG();
        }
      } catch {}
    } else {
      clipboard.writeText(item.content);
      lastClipboardText = item.content;
    }

    // Bump recency for sorting; pinned items still stay grouped above non-pinned.
    item.timestamp = Date.now();
    sortClipboardHistory();
    saveHistory();
    
    // Re-enable monitoring after a short delay
    setTimeout(() => {
      isEnabled = true;
    }, 500);
    
    return true;
  } catch (e) {
    isEnabled = true;
    console.error('Failed to copy item to clipboard:', e);
    return false;
  }
}

export function setClipboardAppBlacklist(bundleIds: string[] | null | undefined): void {
  const next = new Set<string>();
  if (Array.isArray(bundleIds)) {
    for (const entry of bundleIds) {
      const normalized = String(entry || '').trim().toLowerCase();
      if (normalized) next.add(normalized);
    }
  }
  blacklistedAppBundleIds = next;
}

export function setClipboardMonitorEnabled(enabled: boolean): void {
  isEnabled = enabled;
  if (enabled && !pollInterval) {
    startClipboardMonitor();
  } else if (!enabled && pollInterval) {
    stopClipboardMonitor();
  }
}

export function searchClipboardHistory(query: string): ClipboardItem[] {
  if (!query) return clipboardHistory;
  
  const lowerQuery = query.toLowerCase();
  return clipboardHistory.filter((item) => {
    if (item.type === 'text' || item.type === 'url' || item.type === 'file') {
      return item.content.toLowerCase().includes(lowerQuery);
    }
    return false;
  });
}
