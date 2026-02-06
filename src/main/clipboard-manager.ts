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
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export interface ClipboardItem {
  id: string;
  type: 'text' | 'image' | 'url' | 'file';
  content: string; // For text/url/file: the actual content. For images: file path
  preview?: string; // Short preview for display
  timestamp: number;
  source?: string; // Application name that copied
  metadata?: {
    // For images
    width?: number;
    height?: number;
    size?: number; // bytes
    format?: string;
    // For files
    filename?: string;
  };
}

const MAX_ITEMS = 1000;
const POLL_INTERVAL = 1000; // 1 second
const MAX_TEXT_LENGTH = 100_000; // Don't store huge text items
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB max per image

let clipboardHistory: ClipboardItem[] = [];
let lastClipboardText = '';
let lastClipboardImage: Buffer | null = null;
let pollInterval: NodeJS.Timeout | null = null;
let isEnabled = true;

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

// ─── Persistence ────────────────────────────────────────────────────

function loadHistory(): void {
  try {
    const historyPath = getHistoryFilePath();
    if (fs.existsSync(historyPath)) {
      const data = fs.readFileSync(historyPath, 'utf-8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        // Verify image files still exist
        clipboardHistory = parsed.filter((item) => {
          if (item.type === 'image') {
            return fs.existsSync(item.content);
          }
          return true;
        });
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

function addTextItem(text: string): void {
  if (!text || text.length === 0 || text.length > MAX_TEXT_LENGTH) return;
  
  const type = detectType(text);
  const preview = text.length > 200 ? text.substring(0, 200) + '...' : text;
  
  const item: ClipboardItem = {
    id: crypto.randomUUID(),
    type,
    content: text,
    preview,
    timestamp: Date.now(),
  };
  
  if (type === 'file') {
    const filename = path.basename(text);
    item.metadata = { filename };
  }
  
  clipboardHistory.unshift(item);
  if (clipboardHistory.length > MAX_ITEMS) {
    clipboardHistory.pop();
  }
  
  saveHistory();
}

function addImageItem(image: ReturnType<typeof nativeImage.createFromDataURL>): void {
  try {
    const size = image.getSize();
    if (size.width === 0 || size.height === 0) return;
    
    const png = image.toPNG();
    if (png.length === 0 || png.length > MAX_IMAGE_SIZE) return;
    
    // Save image to disk
    const imageId = crypto.randomUUID();
    const imagePath = path.join(getImagesDir(), `${imageId}.png`);
    fs.writeFileSync(imagePath, png);
    
    const item: ClipboardItem = {
      id: imageId,
      type: 'image',
      content: imagePath,
      timestamp: Date.now(),
      metadata: {
        width: size.width,
        height: size.height,
        size: png.length,
        format: 'png',
      },
    };
    
    clipboardHistory.unshift(item);
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

function pollClipboard(): void {
  if (!isEnabled) return;
  
  try {
    // Check for images first (higher priority)
    const image = clipboard.readImage();
    if (!image.isEmpty()) {
      const png = image.toPNG();
      const hash = hashBuffer(png);
      
      if (!lastClipboardImage || hashBuffer(lastClipboardImage) !== hash) {
        lastClipboardImage = png;
        addImageItem(image);
        return;
      }
    }
    
    // Check for text
    const text = clipboard.readText();
    if (text && text !== lastClipboardText) {
      lastClipboardText = text;
      addTextItem(text);
    }
  } catch (e) {
    console.error('Clipboard poll error:', e);
  }
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
  } catch {}
  
  // Start polling
  if (pollInterval) {
    clearInterval(pollInterval);
  }
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

export function copyItemToClipboard(id: string): boolean {
  const item = clipboardHistory.find((i) => i.id === id);
  if (!item) return false;
  
  try {
    // Temporarily disable monitoring to avoid re-adding this item
    isEnabled = false;
    
    if (item.type === 'image') {
      const image = nativeImage.createFromPath(item.content);
      clipboard.writeImage(image);
    } else {
      clipboard.writeText(item.content);
    }
    
    // Move this item to the front of history
    const index = clipboardHistory.indexOf(item);
    if (index > 0) {
      clipboardHistory.splice(index, 1);
      clipboardHistory.unshift(item);
      saveHistory();
    }
    
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
