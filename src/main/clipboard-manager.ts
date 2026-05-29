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

// Lazy-loaded native addon — provides getPasteboardChangeCount() which returns
// NSPasteboard.general.changeCount (an integer that increments on every write).
// Checking this is O(1) and avoids all pasteboard data reads when nothing changed.
type NativeHelpersAddon = { getPasteboardChangeCount?: () => number };
let _nativeHelpersAddon: NativeHelpersAddon | null = null;
let _nativeHelpersAddonLoaded = false;
function getNativeHelpersAddon(): NativeHelpersAddon | null {
  if (_nativeHelpersAddonLoaded) return _nativeHelpersAddon;
  _nativeHelpersAddonLoaded = true;
  try {
    _nativeHelpersAddon = require(path.join(__dirname, '..', 'native', 'native_helpers.node'));
  } catch {
    _nativeHelpersAddon = null;
  }
  return _nativeHelpersAddon;
}

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
  /** Explicit ordering for pinned items (ascending). Independent of recency so
   * using a pinned item doesn't reorder the pinned group. */
  pinnedOrder?: number;
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
// Store a hash of the last-seen image rather than the full buffer.
// This avoids re-hashing megabytes of PNG data on every poll tick.
let lastClipboardImageHash = '';
let lastClipboardFilePath = '';
let pollInterval: NodeJS.Timeout | null = null;
let isEnabled = true;
// Last-seen NSPasteboard changeCount. -1 = not yet read.
// When changeCount hasn't changed, the pasteboard is identical to the last poll
// and we can skip all reads entirely (O(1) check via native addon).
let lastPasteboardChangeCount = -1;
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
    // Pinned items keep an explicit, recency-independent order so that using a
    // pinned item never rearranges the pinned group.
    if (a.pinned && b.pinned) {
      const ao = Number.isFinite(a.pinnedOrder) ? (a.pinnedOrder as number) : Number.MAX_SAFE_INTEGER;
      const bo = Number.isFinite(b.pinnedOrder) ? (b.pinnedOrder as number) : Number.MAX_SAFE_INTEGER;
      if (ao !== bo) return ao - bo;
      return b.timestamp - a.timestamp;
    }
    return b.timestamp - a.timestamp;
  });
}

/** Largest pinnedOrder currently assigned, or -1 when no pinned items have one. */
function getMaxPinnedOrder(): number {
  let max = -1;
  for (const item of clipboardHistory) {
    if (item.pinned && Number.isFinite(item.pinnedOrder)) {
      max = Math.max(max, item.pinnedOrder as number);
    }
  }
  return max;
}

/** Assign sequential pinnedOrder to any pinned items missing one, preserving
 * their current sorted position. Keeps legacy/persisted data consistent. */
function ensurePinnedOrder(): void {
  sortClipboardHistory();
  let next = 0;
  for (const item of clipboardHistory) {
    if (item.pinned) {
      item.pinnedOrder = next;
      next += 1;
    } else if (item.pinnedOrder !== undefined) {
      delete item.pinnedOrder;
    }
  }
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
        ensurePinnedOrder();
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

// Sample start + middle + end of a buffer so that two same-size images differing
// only in the lower portion (e.g. same-dimension TIFF screenshots) still produce
// different fingerprints, without reading the entire (potentially 48MB) buffer.
function sampleBuffer(buf: Buffer): Buffer {
  const CHUNK = 4096;
  if (buf.length <= CHUNK * 3) return buf;
  const mid = Math.floor((buf.length - CHUNK) / 2);
  return Buffer.concat([buf.slice(0, CHUNK), buf.slice(mid, mid + CHUNK), buf.slice(-CHUNK)]);
}

function buildImageFingerprint(prefix: string, buf: Buffer): string {
  return `${prefix}:${buf.length}:${hashBuffer(sampleBuffer(buf))}`;
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

// macOS pasteboard privacy conventions (nspasteboard.me):
// - Password managers (Keychain Access, 1Password, Bitwarden, …) set
//   `org.nspasteboard.ConcealedType` or `org.nspasteboard.TransientType`
//   to opt out of clipboard history managers.
// - `org.nspasteboard.source` carries the originating bundle ID even when
//   the copying process is a background helper, which is more reliable than
//   asking the OS which app is currently frontmost.
function isClipboardConcealed(): boolean {
  try {
    const formats = clipboard.availableFormats();
    for (const fmt of formats) {
      const lower = String(fmt || '').toLowerCase();
      if (
        lower === 'org.nspasteboard.concealedtype' ||
        lower === 'org.nspasteboard.transienttype' ||
        lower === 'org.nspasteboard.autogeneratedtype'
      ) {
        return true;
      }
    }
  } catch {}
  return false;
}

function getClipboardSourceBundleId(): string | undefined {
  try {
    const raw = clipboard.read('org.nspasteboard.source');
    const trimmed = String(raw || '').trim();
    return trimmed || undefined;
  } catch {
    return undefined;
  }
}

function shouldSkipCurrentClipboard(): boolean {
  if (isClipboardConcealed()) return true;
  if (blacklistedAppBundleIds.size === 0) return false;
  const sourceBundleId = getClipboardSourceBundleId();
  if (sourceBundleId && blacklistedAppBundleIds.has(sourceBundleId.toLowerCase())) {
    return true;
  }
  return isFrontmostAppBlacklisted();
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

// Accepts an already-read image hash to avoid re-reading/re-encoding on each poll.
function computeClipboardSignature(knownImgHash?: string): string {
  try {
    const text = clipboard.readText();
    const imgHash =
      knownImgHash !== undefined
        ? knownImgHash
        : (() => {
            const img = clipboard.readImage();
            return !img.isEmpty() ? hashBuffer(img.toPNG()).slice(0, 16) : '';
          })();
    return `${text.length}:${text.slice(0, 64)}:${imgHash}`;
  } catch {
    return '';
  }
}

function readClipboardFilePath(knownImgHash?: string): string | null {
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
  const signature = computeClipboardSignature(knownImgHash);
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

/**
 * Compute a cheap fingerprint for the image currently on the clipboard without
 * decoding pixels for the common raw clipboard formats. Strategy (in priority
 * order):
 *
 *   GIF  → full GIF buffer hash (GIFs are small)
 *   PNG/JPEG/WebP/HEIC/TIFF → size + sampled raw buffer hash
 *   nativeImage fallback → PNG hash only when Electron reports an image-like
 *                          format we do not know how to read as raw bytes
 *
 * Reading raw format bytes is an OS IPC copy (memory-bandwidth-bound, fast).
 * toPNG() on a large TIFF is a pixel decode + PNG encode (CPU-bound, very slow).
 *
 * Returns the fingerprint string and any pre-read rawGifData.
 */
function readClipboardBufferForFormats(availableFormats: string[], candidates: string[]): Buffer | undefined {
  const availableByLower = new Map(availableFormats.map((format) => [format.toLowerCase(), format]));
  for (const candidate of candidates) {
    const actualFormat = availableByLower.get(candidate.toLowerCase());
    if (!actualFormat) continue;
    try {
      const buf = clipboard.readBuffer(actualFormat);
      if (buf && buf.length > 0) return buf;
    } catch {}
  }
  return undefined;
}

function looksLikeClipboardImageFormat(format: string): boolean {
  const lower = format.toLowerCase();
  return (
    lower.startsWith('image/') ||
    lower === 'public.png' ||
    lower === 'public.jpeg' ||
    lower === 'public.jpg' ||
    lower === 'public.tiff' ||
    lower === 'public.heic' ||
    lower === 'public.heif' ||
    lower === 'com.compuserve.gif' ||
    lower === 'org.webmproject.webp'
  );
}

function getClipboardImageFingerprint(): {
  fingerprint: string;
  rawGifData?: Buffer;
  fallbackImage?: ReturnType<typeof clipboard.readImage>;
} {
  try {
    const formats = clipboard.availableFormats();
    if (!formats.some(looksLikeClipboardImageFormat)) return { fingerprint: '' };

    const gifBuf = readClipboardBufferForFormats(formats, ['com.compuserve.gif', 'image/gif']);
    if (gifBuf && gifBuf.length > 4 &&
        gifBuf[0] === 0x47 && gifBuf[1] === 0x49 && gifBuf[2] === 0x46) {
      return {
        fingerprint: buildImageFingerprint('gif', gifBuf),
        rawGifData: gifBuf,
      };
    }

    const pngBuf = readClipboardBufferForFormats(formats, ['public.png', 'image/png']);
    if (pngBuf && pngBuf.length > 8) {
      return { fingerprint: buildImageFingerprint('png', pngBuf) };
    }

    const jpegBuf = readClipboardBufferForFormats(formats, ['public.jpeg', 'public.jpg', 'image/jpeg', 'image/jpg']);
    if (jpegBuf && jpegBuf.length > 8) {
      return { fingerprint: buildImageFingerprint('jpeg', jpegBuf) };
    }

    const webpBuf = readClipboardBufferForFormats(formats, ['org.webmproject.webp', 'image/webp']);
    if (webpBuf && webpBuf.length > 12) {
      return { fingerprint: buildImageFingerprint('webp', webpBuf) };
    }

    const heicBuf = readClipboardBufferForFormats(formats, ['public.heic', 'public.heif', 'image/heic', 'image/heif']);
    if (heicBuf && heicBuf.length > 12) {
      return { fingerprint: buildImageFingerprint('heic', heicBuf) };
    }

    const tiffBuf = readClipboardBufferForFormats(formats, ['public.tiff', 'image/tiff']);
    if (tiffBuf && tiffBuf.length > 8) {
      return { fingerprint: buildImageFingerprint('tiff', tiffBuf) };
    }

    // Last-resort compatibility for Electron/platform format names we do not
    // know yet. This keeps the CPU fix for common steady-state image polling
    // while still preserving image history when Electron can decode the image.
    const image = clipboard.readImage();
    if (!image.isEmpty()) {
      return {
        fingerprint: buildImageFingerprint('native', image.toPNG()),
        fallbackImage: image,
      };
    }


  } catch {}
  return { fingerprint: '' };
}

function pollClipboard(): void {
  if (!isEnabled) return;

  try {
    // Cheap pre-check: NSPasteboard.changeCount increments on every write.
    // If it hasn't changed since the last poll, nothing is on the clipboard that
    // we haven't already seen — skip all IPC reads entirely.
    const addon = getNativeHelpersAddon();
    if (addon?.getPasteboardChangeCount) {
      const currentChangeCount = addon.getPasteboardChangeCount();
      if (currentChangeCount === lastPasteboardChangeCount) return;
      lastPasteboardChangeCount = currentChangeCount;
    }

    const { fingerprint: imageFingerprint, rawGifData, fallbackImage } = getClipboardImageFingerprint();

    // A file URL on the pasteboard (Finder copy) takes priority over
    // readImage() — Finder places the file's *generic icon* as the clipboard
    // image, not the actual contents, and a filename-only text representation,
    // which would otherwise produce two extra junk entries per copy.
    const clipboardFilePath = readClipboardFilePath(imageFingerprint.slice(0, 16));
    if (clipboardFilePath) {
      if (clipboardFilePath !== lastClipboardFilePath) {
        if (shouldSkipCurrentClipboard()) {
          // Seed the caches so we don't keep re-checking the same paste as "new"
          // on every poll once the user leaves the blacklisted app.
          lastClipboardFilePath = clipboardFilePath;
          try { lastClipboardText = clipboard.readText() || ''; } catch {}
          if (imageFingerprint) lastClipboardImageHash = imageFingerprint;
          return;
        }
        console.log(`[Clipboard] File URL detected on pasteboard: ${clipboardFilePath}`);
        const handled = handleClipboardFileCopy(clipboardFilePath);
        if (handled) {
          lastClipboardFilePath = clipboardFilePath;
          // Seed the image/text caches with whatever the file copy is showing
          // on the pasteboard so subsequent polls treat it as "already seen".
          try { lastClipboardText = clipboard.readText() || ''; } catch {}
          if (imageFingerprint) lastClipboardImageHash = imageFingerprint;
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

    // Check for images (higher priority than text).
    // toPNG() is deferred to addImageItem — only runs when a genuinely new
    // image is detected, not on every steady-state poll.
    if (imageFingerprint && imageFingerprint !== lastClipboardImageHash) {
      if (shouldSkipCurrentClipboard()) {
        lastClipboardImageHash = imageFingerprint;
        return;
      }
      lastClipboardImageHash = imageFingerprint;
      const image = fallbackImage || clipboard.readImage();
      if (!image.isEmpty()) {
        addImageItem(image, rawGifData);
      }
      return;
    }

    // Check for text
    const text = clipboard.readText();
    if (text && text !== lastClipboardText) {
      if (shouldSkipCurrentClipboard()) {
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

  // Seed state from whatever is on the clipboard right now so the first poll
  // doesn't create spurious entries for pre-existing clipboard content.
  // NOTE: do NOT seed lastClipboardImageHash here. The changeCount guard below
  // prevents reprocessing of startup clipboard state. Seeding the hash would
  // permanently block the first user copy of an image that was already on the
  // clipboard when the app launched (fingerprint === seeded hash → skip forever).
  try {
    lastClipboardText = clipboard.readText();
    lastClipboardFilePath = readClipboardFilePath() || '';
    const addon = getNativeHelpersAddon();
    if (addon?.getPasteboardChangeCount) {
      lastPasteboardChangeCount = addon.getPasteboardChangeCount();
    }
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
  if (item.pinned) {
    // Newly pinned items go to the bottom of the pinned group.
    item.pinnedOrder = getMaxPinnedOrder() + 1;
  } else {
    delete item.pinnedOrder;
  }
  sortClipboardHistory();
  saveHistory();
  return { ...item };
}

/** Move a pinned item up or down within the pinned group by swapping its
 * order with the adjacent pinned item. No-op for non-pinned items or edges. */
export function moveClipboardPinnedItem(id: string, direction: 'up' | 'down'): boolean {
  const item = clipboardHistory.find((i) => i.id === id);
  if (!item || !item.pinned) return false;

  ensurePinnedOrder();
  const pinned = clipboardHistory.filter((i) => i.pinned);
  const idx = pinned.findIndex((i) => i.id === id);
  if (idx === -1) return false;
  const target = direction === 'up' ? idx - 1 : idx + 1;
  if (target < 0 || target >= pinned.length) return false;

  const a = pinned[idx];
  const b = pinned[target];
  const tmp = a.pinnedOrder;
  a.pinnedOrder = b.pinnedOrder;
  b.pinnedOrder = tmp;

  sortClipboardHistory();
  saveHistory();
  return true;
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
        const gifData = fs.readFileSync(item.content);
        if (!writeGifToClipboard(item.content)) {
          // Fallback: write raw GIF buffer only
          clipboard.clear();
          clipboard.writeBuffer('com.compuserve.gif', gifData);
        }
        // Seed the hash using the same fingerprint format as getClipboardImageFingerprint().
        lastClipboardImageHash = buildImageFingerprint('gif', gifData);
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

          // For non-PNG formats, also write a PNG fallback so apps that only
          // understand standard raster images can still paste.
          // Skip this for PNG — rawData IS already the PNG bytes.
          //
          // IMPORTANT: getClipboardImageFingerprint() checks PNG before TIFF, so the
          // next poll will fingerprint public.png regardless of the primary UTI. We
          // must seed lastClipboardImageHash from the PNG bytes (not rawData) to
          // prevent the poll from treating our own write as a new image.
          if (imageUti !== 'public.png') {
            const fallbackImage = nativeImage.createFromPath(item.content);
            if (!fallbackImage.isEmpty()) {
              const fallbackPng = fallbackImage.toPNG();
              clipboard.writeBuffer('public.png', fallbackPng);
              // Seed from PNG — matches what the poll will compute.
              lastClipboardImageHash = buildImageFingerprint('png', fallbackPng);
            } else {
              // No PNG written; poll will read the original UTI.
              const prefix = imageUti === 'public.tiff' ? 'tiff' : 'png';
              lastClipboardImageHash = buildImageFingerprint(prefix, rawData);
            }
          } else {
            lastClipboardImageHash = buildImageFingerprint('png', rawData);
          }
        } else {
          const image = nativeImage.createFromPath(item.content);
          clipboard.writeImage(image);
          // Rare fallback path (unknown format/missing UTI). Don't call toPNG() here
          // — the next poll will detect the write as a new image once and save it.
        }
      }
    } else {
      clipboard.writeText(item.content);
      lastClipboardText = item.content;
    }

    // Bump recency for sorting; pinned items still stay grouped above non-pinned.
    item.timestamp = Date.now();
    sortClipboardHistory();
    saveHistory();
    
    // Seed the changeCount so the next poll recognises our write as "already seen"
    // and doesn't create a duplicate entry. This works even if the poll fires
    // before the isEnabled timeout below expires.
    try {
      const addon = getNativeHelpersAddon();
      if (addon?.getPasteboardChangeCount) {
        lastPasteboardChangeCount = addon.getPasteboardChangeCount();
      }
    } catch {}

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
