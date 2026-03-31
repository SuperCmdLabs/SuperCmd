/**
 * Canvas Store
 *
 * Manages Excalidraw canvases with persistence:
 * - Metadata index stored in canvas.json (sync writes, stays small)
 * - Scene data stored per-canvas in data/{id}.excalidraw (async writes, can be large)
 * - Thumbnails stored as data/{id}.thumb.svg (async writes)
 * - Pin/unpin, duplicate, search by title
 */

import { app, dialog, BrowserWindow, SaveDialogOptions } from 'electron';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';

// ─── Types ──────────────────────────────────────────────────────────

export interface Canvas {
  id: string;
  title: string;
  icon: string;              // emoji icon (default: palette)
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface CanvasScene {
  elements: any[];
  appState: Record<string, any>;
  files: Record<string, any>;
}

// ─── Cache ──────────────────────────────────────────────────────────

let canvasCache: Canvas[] | null = null;

// ─── Paths ──────────────────────────────────────────────────────────

function getCanvasDir(): string {
  const dir = path.join(app.getPath('userData'), 'canvas');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getCanvasDataDir(): string {
  const dir = path.join(getCanvasDir(), 'data');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getCanvasIndexPath(): string {
  return path.join(getCanvasDir(), 'canvas.json');
}

function getScenePath(id: string): string {
  return path.join(getCanvasDataDir(), `${id}.excalidraw`);
}

function getThumbnailPath(id: string): string {
  return path.join(getCanvasDataDir(), `${id}.thumb.svg`);
}

// ─── Persistence (index) ────────────────────────────────────────────

function loadFromDisk(): Canvas[] {
  try {
    const filePath = getCanvasIndexPath();
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        return parsed.map((item: any) => ({
          id: String(item.id || crypto.randomUUID()),
          title: String(item.title || ''),
          icon: typeof item.icon === 'string' ? item.icon : '🎨',
          pinned: Boolean(item.pinned),
          createdAt: typeof item.createdAt === 'number' ? item.createdAt : Date.now(),
          updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : Date.now(),
        }));
      }
    }
  } catch (e) {
    console.error('Failed to load canvases from disk:', e);
  }
  return [];
}

function saveIndexToDisk(): void {
  try {
    const filePath = getCanvasIndexPath();
    fs.writeFileSync(filePath, JSON.stringify(canvasCache || [], null, 2), 'utf-8');
  } catch (e) {
    console.error('Failed to save canvas index to disk:', e);
  }
}

// ─── Public API ─────────────────────────────────────────────────────

export function initCanvasStore(): void {
  canvasCache = loadFromDisk();
  console.log(`[Canvas] Loaded ${canvasCache.length} canvas(es)`);
  cleanupOrphanedFiles();
}

export function getAllCanvases(): Canvas[] {
  if (!canvasCache) canvasCache = loadFromDisk();
  return [...canvasCache].sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) {
      return a.pinned ? -1 : 1;
    }
    return b.updatedAt - a.updatedAt;
  });
}

export function searchCanvases(query: string): Canvas[] {
  const all = getAllCanvases();
  if (!query.trim()) return all;
  const lowerQuery = query.toLowerCase();
  return all.filter((c) => c.title.toLowerCase().includes(lowerQuery));
}

export function getCanvasById(id: string): Canvas | null {
  if (!canvasCache) canvasCache = loadFromDisk();
  return canvasCache.find((c) => c.id === id) || null;
}

export function createCanvas(data: {
  title?: string;
  icon?: string;
}): Canvas {
  if (!canvasCache) canvasCache = loadFromDisk();

  const canvas: Canvas = {
    id: crypto.randomUUID(),
    title: data.title || 'Untitled Canvas',
    icon: data.icon || '🎨',
    pinned: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  canvasCache.push(canvas);
  saveIndexToDisk();

  // Write empty scene file
  const emptyScene: CanvasScene = { elements: [], appState: {}, files: {} };
  fsp.writeFile(getScenePath(canvas.id), JSON.stringify(emptyScene), 'utf-8').catch((e) => {
    console.error('Failed to create empty scene file:', e);
  });

  return canvas;
}

export function updateCanvas(
  id: string,
  data: Partial<Pick<Canvas, 'title' | 'icon' | 'pinned'>>
): Canvas | null {
  if (!canvasCache) canvasCache = loadFromDisk();

  const index = canvasCache.findIndex((c) => c.id === id);
  if (index === -1) return null;

  const canvas = canvasCache[index];
  if (data.title !== undefined) canvas.title = data.title;
  if (data.icon !== undefined) canvas.icon = data.icon;
  if (data.pinned !== undefined) canvas.pinned = Boolean(data.pinned);
  canvas.updatedAt = Date.now();

  saveIndexToDisk();
  return { ...canvas };
}

export function deleteCanvas(id: string): boolean {
  if (!canvasCache) canvasCache = loadFromDisk();

  const index = canvasCache.findIndex((c) => c.id === id);
  if (index === -1) return false;

  canvasCache.splice(index, 1);
  saveIndexToDisk();

  // Cascade delete scene and thumbnail files
  const scenePath = getScenePath(id);
  const thumbPath = getThumbnailPath(id);
  fsp.unlink(scenePath).catch(() => {});
  fsp.unlink(thumbPath).catch(() => {});

  return true;
}

export function duplicateCanvas(id: string): Canvas | null {
  if (!canvasCache) canvasCache = loadFromDisk();
  const original = canvasCache.find((c) => c.id === id);
  if (!original) return null;

  const duplicate: Canvas = {
    ...original,
    id: crypto.randomUUID(),
    title: `${original.title} Copy`,
    pinned: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  canvasCache.push(duplicate);
  saveIndexToDisk();

  // Copy scene file
  const srcPath = getScenePath(id);
  const dstPath = getScenePath(duplicate.id);
  fsp.copyFile(srcPath, dstPath).catch((e) => {
    console.error('Failed to duplicate scene file:', e);
    // Write empty scene as fallback
    const emptyScene: CanvasScene = { elements: [], appState: {}, files: {} };
    fsp.writeFile(dstPath, JSON.stringify(emptyScene), 'utf-8').catch(() => {});
  });

  // Copy thumbnail if exists
  const srcThumb = getThumbnailPath(id);
  const dstThumb = getThumbnailPath(duplicate.id);
  fsp.copyFile(srcThumb, dstThumb).catch(() => {});

  return duplicate;
}

export function togglePinCanvas(id: string): Canvas | null {
  if (!canvasCache) canvasCache = loadFromDisk();
  const canvas = canvasCache.find((c) => c.id === id);
  if (!canvas) return null;
  canvas.pinned = !canvas.pinned;
  canvas.updatedAt = Date.now();
  saveIndexToDisk();
  return { ...canvas };
}

// ─── Scene Data ─────────────────────────────────────────────────────

export function getScene(id: string): CanvasScene {
  try {
    const scenePath = getScenePath(id);
    if (fs.existsSync(scenePath)) {
      const data = fs.readFileSync(scenePath, 'utf-8');
      const parsed = JSON.parse(data);
      return {
        elements: Array.isArray(parsed.elements) ? parsed.elements : [],
        appState: parsed.appState || {},
        files: parsed.files || {},
      };
    }
  } catch (e) {
    console.error(`Failed to load scene for canvas ${id}:`, e);
  }
  return { elements: [], appState: {}, files: {} };
}

export async function saveScene(id: string, scene: CanvasScene): Promise<void> {
  try {
    await fsp.writeFile(getScenePath(id), JSON.stringify(scene), 'utf-8');
    // Update timestamp in index
    if (!canvasCache) canvasCache = loadFromDisk();
    const canvas = canvasCache.find((c) => c.id === id);
    if (canvas) {
      canvas.updatedAt = Date.now();
      saveIndexToDisk();
    }
  } catch (e) {
    console.error(`Failed to save scene for canvas ${id}:`, e);
    throw e;
  }
}

// ─── Thumbnails ─────────────────────────────────────────────────────

export async function saveThumbnail(id: string, svgString: string): Promise<void> {
  try {
    await fsp.writeFile(getThumbnailPath(id), svgString, 'utf-8');
  } catch (e) {
    console.error(`Failed to save thumbnail for canvas ${id}:`, e);
  }
}

export function getThumbnail(id: string): string | null {
  try {
    const thumbPath = getThumbnailPath(id);
    if (fs.existsSync(thumbPath)) {
      return fs.readFileSync(thumbPath, 'utf-8');
    }
  } catch (e) {
    console.error(`Failed to load thumbnail for canvas ${id}:`, e);
  }
  return null;
}

// ─── Export ─────────────────────────────────────────────────────────

export async function exportCanvas(
  id: string,
  format: 'json',
  parentWindow?: BrowserWindow
): Promise<boolean> {
  const canvas = getCanvasById(id);
  if (!canvas) return false;

  const ext = 'json';
  const filterName = 'Excalidraw JSON';

  const dialogOptions: SaveDialogOptions = {
    title: 'Export Canvas',
    defaultPath: `${canvas.title.replace(/[/\\?%*:|"<>]/g, '-')}.${ext}`,
    filters: [{ name: filterName, extensions: [ext] }],
  };
  const result = parentWindow
    ? await dialog.showSaveDialog(parentWindow, dialogOptions)
    : await dialog.showSaveDialog(dialogOptions);

  if (result.canceled || !result.filePath) return false;

  const scene = getScene(id);
  fs.writeFileSync(result.filePath, JSON.stringify(scene, null, 2), 'utf-8');
  return true;
}

// ─── Canvas Lib Status ──────────────────────────────────────────────

export function getCanvasLibDir(): string {
  return path.join(app.getPath('userData'), 'canvas-lib');
}

export function isCanvasLibInstalled(): boolean {
  const libDir = getCanvasLibDir();
  return fs.existsSync(path.join(libDir, 'excalidraw-bundle.js'));
}

// ─── Orphan Cleanup ─────────────────────────────────────────────────

function cleanupOrphanedFiles(): void {
  try {
    const dataDir = getCanvasDataDir();
    if (!fs.existsSync(dataDir)) return;

    const files = fs.readdirSync(dataDir);
    const indexIds = new Set((canvasCache || []).map((c) => c.id));
    let cleaned = 0;

    for (const file of files) {
      const match = file.match(/^(.+?)\.(?:excalidraw|thumb\.svg)$/);
      if (match) {
        const fileId = match[1];
        if (!indexIds.has(fileId)) {
          fs.unlinkSync(path.join(dataDir, file));
          cleaned++;
        }
      }
    }

    if (cleaned > 0) {
      console.log(`[Canvas] Cleaned up ${cleaned} orphaned file(s)`);
    }
  } catch (e) {
    console.error('Failed to cleanup orphaned canvas files:', e);
  }
}
