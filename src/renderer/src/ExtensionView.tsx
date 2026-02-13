/**
 * Extension View
 *
 * Dynamically loads and renders a community extension's UI
 * inside the SuperCmd overlay.
 *
 * The extension code (built to CJS by esbuild) is executed with a
 * custom `require()` that provides React and our @raycast/api shim.
 */

import * as React from 'react';
import { useState, useEffect, useMemo, useCallback } from 'react';
import * as ReactDOM from 'react-dom';
import * as JsxRuntime from 'react/jsx-runtime';
import { ArrowLeft, AlertTriangle } from 'lucide-react';
import * as RaycastAPI from './raycast-api';
import { NavigationContext, setExtensionContext, setGlobalNavigation, ExtensionContextType, ExtensionInfoReactContext } from './raycast-api';

// Also import @raycast/utils stubs from our shim
import * as RaycastUtils from './raycast-api';

// ─── React Module for Extensions ────────────────────────────────────
// Extensions MUST use the exact same React instance as the host app.
//
// IMPORTANT: Vite creates an ESM namespace object for `import * as React`.
// This namespace object might not behave correctly when accessed from CJS code.
// We create a plain object with all React exports to ensure compatibility.

// Create React module for extensions
// We simply return the actual React import - no copying, no wrapping
// This ensures extensions get the exact same React that the host uses
console.log('[React] Setting up React for extensions');
console.log('[React] React.version:', React.version);
console.log('[React] React.useState:', typeof React.useState);

// ─── JSX Runtime for Extensions ─────────────────────────────────────
// We use the actual jsx-runtime import to ensure full compatibility.
// The JsxRuntime is imported at the top as `import * as JsxRuntime from 'react/jsx-runtime'`

// Re-export for external type access
export type { ExtensionContextType };

interface ExtensionViewProps {
  code: string;
  title: string;
  mode: string;
  error?: string; // build-time error from main process
  onClose: () => void;
  // Extension metadata
  extensionName?: string;
  extensionDisplayName?: string;
  extensionIconDataUrl?: string;
  commandName?: string;
  assetsPath?: string;
  supportPath?: string;
  extensionPath?: string;
  owner?: string;
  preferences?: Record<string, any>;
  launchArguments?: Record<string, any>;
  launchContext?: Record<string, any>;
  fallbackText?: string | null;
  launchType?: 'userInitiated' | 'background';
}

/**
 * Error boundary to catch runtime errors in extensions.
 */
class ExtensionErrorBoundary extends React.Component<
  { children: React.ReactNode; onError: (err: Error) => void },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ExtensionErrorBoundary] Caught error:', error.message);
    console.error('[ExtensionErrorBoundary] Stack:', error.stack);
    console.error('[ExtensionErrorBoundary] Component stack:', errorInfo.componentStack);
    this.props.onError(error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-white/50 p-8 overflow-auto">
          <AlertTriangle className="w-8 h-8 text-red-400/60 mb-3" />
          <p className="text-sm text-red-400/80 font-medium mb-1">
            Extension Error
          </p>
          <p className="text-xs text-white/30 text-center max-w-sm mb-4">
            {this.state.error.message}
          </p>
          <pre className="text-[10px] text-white/20 text-left max-w-full overflow-x-auto whitespace-pre-wrap">
            {this.state.error.stack?.split('\n').slice(0, 10).join('\n')}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Node.js built-in stubs ─────────────────────────────────────────
// Raycast extensions run in a full Node.js environment inside Raycast.
// In SuperCmd, extensions run in the renderer (browser context).
// We provide comprehensive stubs so that bundled code that calls
// require('os'), require('buffer'), etc. doesn't crash on import.
//
// The goal: never throw during module import. Individual calls may
// no-op or return empty values, but the extension should still render.

const noop = () => {};
const noopAsync = (..._args: any[]) => Promise.resolve();
const noopCb = (...args: any[]) => {
  const cb = args[args.length - 1];
  if (typeof cb === 'function') cb(null);
};

// ── Buffer polyfill ─────────────────────────────────────────────
// Many Node libraries (csv-parse, jose, etc.) depend on Buffer.from(),
// Buffer.isBuffer(), Buffer.concat(), and Buffer.alloc() behaving like
// the real Node.js Buffer. A plain Uint8Array doesn't cut it because
// libraries check `Buffer.isBuffer(x)` for type guards.

const _bufferMarker = Symbol('Buffer');

class BufferPolyfill extends Uint8Array {
  declare [_bufferMarker]: true;

  // Allow new Buffer(string), new Buffer(number), new Buffer(array)
  constructor(arg: any, encodingOrOffset?: any, length?: number) {
    // Must call super first with a valid argument
    if (typeof arg === 'string') {
      super(new TextEncoder().encode(arg));
    } else if (typeof arg === 'number') {
      super(arg);
    } else if (arg instanceof ArrayBuffer) {
      if (typeof encodingOrOffset === 'number') {
        super(arg, encodingOrOffset, length);
      } else {
        super(arg);
      }
    } else if (ArrayBuffer.isView(arg)) {
      super(arg.buffer as ArrayBuffer, arg.byteOffset, arg.byteLength);
    } else if (Array.isArray(arg)) {
      super(arg);
    } else {
      super(0);
    }
    // Set marker after super
    (this as any)[_bufferMarker] = true;
  }

  toString(encoding?: string): string {
    if (encoding === 'base64') {
      let binary = '';
      for (let i = 0; i < this.length; i++) binary += String.fromCharCode(this[i]);
      return btoa(binary);
    }
    if (encoding === 'hex') {
      return Array.from(this).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    // utf8 / ascii / default
    return new TextDecoder().decode(this);
  }

  toJSON() {
    return { type: 'Buffer', data: Array.from(this) };
  }

  slice(start?: number, end?: number): BufferPolyfill {
    const sliced = super.slice(start, end);
    return BufferPolyfill.from(sliced) as BufferPolyfill;
  }

  write(str: string, offset?: number) {
    const bytes = new TextEncoder().encode(str);
    this.set(bytes, offset ?? 0);
    return bytes.length;
  }

  copy(target: Uint8Array, targetStart?: number, sourceStart?: number, sourceEnd?: number) {
    const slice = this.subarray(sourceStart ?? 0, sourceEnd ?? this.length);
    target.set(slice, targetStart ?? 0);
    return slice.length;
  }

  equals(other: Uint8Array): boolean {
    if (this.length !== other.length) return false;
    for (let i = 0; i < this.length; i++) {
      if (this[i] !== other[i]) return false;
    }
    return true;
  }

  compare(other: Uint8Array): number {
    const len = Math.min(this.length, other.length);
    for (let i = 0; i < len; i++) {
      if (this[i] < other[i]) return -1;
      if (this[i] > other[i]) return 1;
    }
    return this.length - other.length;
  }

  readUInt8(offset: number) { return this[offset]; }
  readUInt16BE(offset: number) { return (this[offset] << 8) | this[offset + 1]; }
  readUInt16LE(offset: number) { return this[offset] | (this[offset + 1] << 8); }
  readUInt32BE(offset: number) { return ((this[offset] << 24) | (this[offset+1] << 16) | (this[offset+2] << 8) | this[offset+3]) >>> 0; }
  readUInt32LE(offset: number) { return (this[offset] | (this[offset+1] << 8) | (this[offset+2] << 16) | (this[offset+3] << 24)) >>> 0; }
  readInt8(offset: number) { const v = this[offset]; return v > 127 ? v - 256 : v; }
  readInt16BE(offset: number) { const v = this.readUInt16BE(offset); return v > 32767 ? v - 65536 : v; }
  readInt16LE(offset: number) { const v = this.readUInt16LE(offset); return v > 32767 ? v - 65536 : v; }

  static from(value: any, encodingOrOffset?: any, length?: any): BufferPolyfill {
    if (typeof value === 'string') {
      const encoding = encodingOrOffset || 'utf8';
      if (encoding === 'base64' || encoding === 'base64url') {
        const str = value.replace(/-/g, '+').replace(/_/g, '/');
        const binary = atob(str);
        const buf = new BufferPolyfill(binary.length);
        for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i);
        return buf;
      }
      if (encoding === 'hex') {
        const buf = new BufferPolyfill(value.length / 2);
        for (let i = 0; i < value.length; i += 2) {
          buf[i / 2] = parseInt(value.substring(i, i + 2), 16);
        }
        return buf;
      }
      return new BufferPolyfill(value);
    }
    if (value instanceof ArrayBuffer) {
      return new BufferPolyfill(value, encodingOrOffset, length);
    }
    if (ArrayBuffer.isView(value)) {
      return new BufferPolyfill(value.buffer, value.byteOffset, value.byteLength);
    }
    if (Array.isArray(value)) {
      return new BufferPolyfill(value);
    }
    // Fallback: treat as iterable or return empty
    try {
      return new BufferPolyfill(Array.from(value as any));
    } catch {
      return new BufferPolyfill(0);
    }
  }

  static alloc(size: number, fill?: any): BufferPolyfill {
    const buf = new BufferPolyfill(size);
    if (fill !== undefined) {
      const fillByte = typeof fill === 'number' ? fill : (typeof fill === 'string' ? fill.charCodeAt(0) : 0);
      buf.fill(fillByte);
    }
    return buf;
  }

  static allocUnsafe(size: number): BufferPolyfill {
    return new BufferPolyfill(size);
  }

  static isBuffer(obj: any): boolean {
    return obj instanceof BufferPolyfill || (obj && obj[_bufferMarker] === true);
  }

  static isEncoding(encoding: string): boolean {
    return ['utf8', 'utf-8', 'ascii', 'latin1', 'binary', 'base64', 'base64url', 'hex', 'ucs2', 'ucs-2', 'utf16le'].includes(encoding?.toLowerCase?.() ?? '');
  }

  static concat(list: Uint8Array[], totalLength?: number): BufferPolyfill {
    if (!list || list.length === 0) return BufferPolyfill.alloc(0);
    const total = totalLength ?? list.reduce((acc, b) => acc + b.length, 0);
    const result = BufferPolyfill.alloc(total);
    let offset = 0;
    for (const buf of list) {
      result.set(buf, offset);
      offset += buf.length;
      if (offset >= total) break;
    }
    return result;
  }

  static byteLength(str: string, encoding?: string): number {
    if (encoding === 'base64' || encoding === 'base64url') {
      return Math.ceil(str.length * 3 / 4);
    }
    return new TextEncoder().encode(str).length;
  }

  static compare(a: Uint8Array, b: Uint8Array): number {
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      if (a[i] < b[i]) return -1;
      if (a[i] > b[i]) return 1;
    }
    return a.length - b.length;
  }
}

const BlobCompat: any =
  (globalThis as any).Blob ||
  class BlobCompatPolyfill {
    private _data: Uint8Array;
    type: string;
    constructor(parts: any[] = [], options: { type?: string } = {}) {
      const chunks: Uint8Array[] = [];
      for (const part of parts || []) {
        if (part == null) continue;
        if (part instanceof Uint8Array) {
          chunks.push(part);
        } else if (part instanceof ArrayBuffer) {
          chunks.push(new Uint8Array(part));
        } else if (ArrayBuffer.isView(part)) {
          chunks.push(new Uint8Array(part.buffer, part.byteOffset, part.byteLength));
        } else {
          chunks.push(new TextEncoder().encode(String(part)));
        }
      }
      const total = chunks.reduce((n, c) => n + c.length, 0);
      const merged = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) {
        merged.set(c, offset);
        offset += c.length;
      }
      this._data = merged;
      this.type = options?.type ? String(options.type).toLowerCase() : '';
    }
    get size() { return this._data.byteLength; }
    async arrayBuffer() { return this._data.buffer.slice(this._data.byteOffset, this._data.byteOffset + this._data.byteLength); }
    async text() { return new TextDecoder().decode(this._data); }
    stream() {
      if (typeof ReadableStream === 'undefined') return undefined;
      const bytes = this._data;
      return new ReadableStream({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      });
    }
    slice(start?: number, end?: number, type?: string) {
      const s = start ?? 0;
      const e = end ?? this._data.length;
      const sub = this._data.slice(s, e);
      return new BlobCompat([sub], { type: type ?? this.type });
    }
    get [Symbol.toStringTag]() { return 'Blob'; }
  };

const FileCompat: any =
  (globalThis as any).File ||
  class FileCompatPolyfill extends BlobCompat {
    name: string;
    lastModified: number;
    constructor(parts: any[] = [], fileName = '', options: { type?: string; lastModified?: number } = {}) {
      super(parts, options);
      this.name = String(fileName);
      this.lastModified = typeof options?.lastModified === 'number' ? options.lastModified : Date.now();
    }
    get [Symbol.toStringTag]() { return 'File'; }
  };

// ── fs stub (localStorage-backed for persistence) ────────────────
// Extensions like todo-list use fs.readFileSync/writeFileSync for data.
// We back basic file operations with localStorage so data persists.

const FS_PREFIX = 'sc-fs:';
const fsMemoryStore = new Map<string, string>();

function getStoredText(path: string): string | null {
  if (fsMemoryStore.has(path)) return fsMemoryStore.get(path) ?? null;
  return localStorage.getItem(FS_PREFIX + path);
}

function setStoredText(path: string, value: string): void {
  try {
    localStorage.setItem(FS_PREFIX + path, value);
    fsMemoryStore.delete(path);
  } catch {
    // Fallback for large payloads (e.g. cached JSON files) that exceed localStorage quota.
    fsMemoryStore.set(path, value);
  }
}

function removeStoredText(path: string): void {
  fsMemoryStore.delete(path);
  localStorage.removeItem(FS_PREFIX + path);
}

function normalizeFsPath(input: any): string {
  if (!input) return '';
  if (typeof input === 'string') {
    const maybeDecodePath = (value: string): string => {
      if (!value.includes('%')) return value;
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    };
    if (input.startsWith('file://')) {
      try {
        return maybeDecodePath(decodeURIComponent(new URL(input).pathname));
      } catch {
        return maybeDecodePath(input.replace(/^file:\/\//, ''));
      }
    }
    return maybeDecodePath(input);
  }
  if (typeof input === 'object' && typeof input.href === 'string' && input.protocol === 'file:') {
    try {
      return decodeURIComponent(input.pathname || new URL(input.href).pathname);
    } catch {
      return String(input.href).replace(/^file:\/\//, '');
    }
  }
  return String(input);
}

function fsStatResult(exists: boolean, isDir = false, size = 0) {
  return {
    isFile: () => exists && !isDir,
    isDirectory: () => isDir,
    isSymbolicLink: () => false,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    size: exists ? size : 0,
    mtime: new Date(),
    atime: new Date(),
    ctime: new Date(),
    birthtime: new Date(),
    mode: 0o644,
    uid: 501,
    gid: 20,
    dev: 0,
    ino: 0,
    nlink: 1,
  };
}

const commandPathCache = new Map<string, string | null>();

function isBareCommandPath(p: string): boolean {
  if (!p) return false;
  if (p.includes('/') || p.includes('\\')) return false;
  if (p.startsWith('.')) return false;
  return /^[A-Za-z0-9._+-]+$/.test(p);
}

function resolveCommandOnPath(command: string): string | null {
  if (!isBareCommandPath(command)) return null;
  if (commandPathCache.has(command)) return commandPathCache.get(command) || null;
  try {
    const result = (window as any).electron?.execCommandSync?.(
      '/bin/zsh',
      ['-lc', `command -v -- ${JSON.stringify(command)} 2>/dev/null || true`],
      {}
    );
    const resolved = (result?.stdout || '').trim();
    if (resolved && resolved.includes('/')) {
      commandPathCache.set(command, resolved);
      return resolved;
    }
    const commonDirs = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'];
    for (const dir of commonDirs) {
      const candidate = `${dir}/${command}`;
      if ((window as any).electron?.fileExistsSync?.(candidate)) {
        commandPathCache.set(command, candidate);
        return candidate;
      }
    }
  } catch {}
  commandPathCache.set(command, null);
  return null;
}

function resolveExecutablePath(input: any): string {
  const raw = typeof input === 'string' ? input : String(input ?? '');
  if (!raw) return raw;

  const bareResolved = resolveCommandOnPath(raw);
  if (bareResolved) return bareResolved;

  if (raw.startsWith('/')) {
    try {
      const exists = (window as any).electron?.fileExistsSync?.(raw);
      if (exists) return raw;
      const base = raw.split('/').filter(Boolean).pop() || '';
      if (base) {
        const alt = resolveCommandOnPath(base);
        if (alt) return alt;
      }
    } catch {}
  }

  return raw;
}

function rewriteShellCommandForMissingBinary(command: string): string {
  if (!command || typeof command !== 'string') return command;
  const match = command.match(/^\s*(?:"([^"]+)"|'([^']+)'|(\S+))(.*)$/s);
  if (!match) return command;
  const first = match[1] || match[2] || match[3] || '';
  const rest = match[4] || '';
  const resolved = resolveExecutablePath(first);
  if (!resolved || resolved === first) return command;
  return `${JSON.stringify(resolved)}${rest}`;
}

function resolveFsLookupPath(input: any): string {
  const path = normalizeFsPath(input);
  return resolveCommandOnPath(path) || path;
}

function toUint8Array(chunk: any): Uint8Array {
  if (chunk instanceof Uint8Array) return chunk;
  if (chunk instanceof ArrayBuffer) return new Uint8Array(chunk);
  if (ArrayBuffer.isView(chunk)) return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  if (typeof chunk === 'string') return new TextEncoder().encode(chunk);
  return new TextEncoder().encode(String(chunk ?? ''));
}

const fsStub: Record<string, any> = {
  existsSync: (p: any) => {
    const path = resolveFsLookupPath(p);
    // Check localStorage first
    if (getStoredText(path) !== null) return true;
    // Fall back to real file system via sync IPC
    try {
      return (window as any).electron?.fileExistsSync?.(path) ?? false;
    } catch {
      return false;
    }
  },
  readFileSync: (p: any, opts?: any) => {
    const path = resolveFsLookupPath(p);
    // Check localStorage first
    const content = getStoredText(path);
    if (content !== null) {
      if (opts?.encoding || typeof opts === 'string') return content;
      return BufferPolyfill.from(content);
    }
    // Fall back to real file system via sync IPC (for reading extension assets etc.)
    try {
      const result = (window as any).electron?.readFileSync?.(path);
      if (result && result.data !== null) {
        if (opts?.encoding || typeof opts === 'string') return result.data;
        return BufferPolyfill.from(result.data);
      }
    } catch { /* fall through to ENOENT */ }
    const err: any = new Error(`ENOENT: no such file or directory, open '${path}'`);
    err.code = 'ENOENT';
    err.errno = -2;
    err.syscall = 'open';
    err.path = path;
    throw err;
  },
  writeFileSync: (p: string, data: any) => {
    const path = resolveFsLookupPath(p);
    const str = typeof data === 'string' ? data : (data?.toString?.() ?? String(data));
    setStoredText(path, str);
  },
  mkdirSync: noop, // Directories are implicit with localStorage
  readdirSync: (p: string) => {
    const path = resolveFsLookupPath(p);
    const prefix = FS_PREFIX + (path.endsWith('/') ? path : path + '/');
    const results: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) {
        const rest = key.slice(prefix.length);
        const firstSlash = rest.indexOf('/');
        const entry = firstSlash === -1 ? rest : rest.slice(0, firstSlash);
        if (entry && !results.includes(entry)) results.push(entry);
      }
    }
    return results;
  },
  statSync: (p: any) => {
    const path = resolveFsLookupPath(p);
    const content = getStoredText(path);
    if (content !== null) return fsStatResult(true, false, content.length);
    try {
      const result = (window as any).electron?.statSync?.(path);
      if (result?.exists) return fsStatResult(true, result.isDirectory);
    } catch {}
    return fsStatResult(false);
  },
  lstatSync: (p: any) => {
    const path = resolveFsLookupPath(p);
    const content = getStoredText(path);
    if (content !== null) return fsStatResult(true, false, content.length);
    try {
      const result = (window as any).electron?.statSync?.(path);
      if (result?.exists) return fsStatResult(true, result.isDirectory);
    } catch {}
    return fsStatResult(false);
  },
  realpathSync: (p: string) => resolveFsLookupPath(p),
  unlinkSync: (p: string) => { removeStoredText(resolveFsLookupPath(p)); },
  rmdirSync: noop,
  rmSync: (p: string) => { removeStoredText(resolveFsLookupPath(p)); },
  renameSync: (oldPath: string, newPath: string) => {
    const src = resolveFsLookupPath(oldPath);
    const dest = resolveFsLookupPath(newPath);
    const content = getStoredText(src);
    if (content !== null) {
      setStoredText(dest, content);
      removeStoredText(src);
    }
  },
  copyFileSync: (src: string, dest: string) => {
    const source = resolveFsLookupPath(src);
    const destination = resolveFsLookupPath(dest);
    const content = getStoredText(source);
    if (content !== null) setStoredText(destination, content);
  },
  chmodSync: noop,
  accessSync: (p: any) => {
    const path = resolveFsLookupPath(p);
    if (getStoredText(path) !== null) return;
    try {
      if ((window as any).electron?.fileExistsSync?.(path)) return;
    } catch {}
    const err: any = new Error(`ENOENT: no such file or directory, access '${path}'`);
    err.code = 'ENOENT';
    throw err;
  },
  openSync: () => 0,
  closeSync: noop,
  readSync: () => 0,
  writeSync: () => 0,
  createReadStream: (p: any) => {
    const path = resolveFsLookupPath(p);
    const s: any = new (nodeBuiltinStubs?.stream?.Readable || class {})();
    const content = getStoredText(path);
    setTimeout(() => {
      if (content != null) {
        const bytes = toUint8Array(content);
        s.emit?.('data', bytes);
      }
      s.emit?.('end');
      s.emit?.('close');
    }, 0);
    return s;
  },
  createWriteStream: (p: any) => {
    const filePath = resolveFsLookupPath(p);
    const s: any = new WritableStub();
    const chunks: Uint8Array[] = [];
    const defer = (fn: () => void) => {
      if (typeof queueMicrotask === 'function') queueMicrotask(fn);
      else Promise.resolve().then(fn);
    };
    let ended = false;
    s.write = (chunk: any, _enc?: any, cb?: Function) => {
      chunks.push(toUint8Array(chunk));
      const callback = typeof cb === 'function' ? cb : typeof _enc === 'function' ? _enc : null;
      if (callback) callback(null);
      return true;
    };
    s.end = (chunk?: any, _enc?: any, cb?: Function) => {
      if (ended) return s;
      ended = true;
      s.writableEnded = true;
      if (chunk != null && typeof chunk !== 'function') chunks.push(toUint8Array(chunk));
      const total = chunks.reduce((sum, c) => sum + c.length, 0);
      const merged = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) { merged.set(c, off); off += c.length; }
      const callback = typeof cb === 'function' ? cb : typeof _enc === 'function' ? _enc : null;
      // Write real binary to disk via IPC (extensions use this for CLI binary downloads)
      const doWrite = async () => {
        try {
          const writeBinary = (window as any).electron?.fsWriteBinaryFile;
          if (typeof writeBinary === 'function') {
            await Promise.race([
              writeBinary(filePath, merged),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error(`Timed out writing file: ${filePath}`)), 45_000)
              ),
            ]);
          } else {
            // Fallback for environments without binary file bridge.
            setStoredText(filePath, new TextDecoder().decode(merged));
          }
          defer(() => {
            if (callback) callback(null);
            s.emit('finish');
            s.emit('close');
          });
        } catch (e: any) {
          const err = e instanceof Error ? e : new Error(String(e ?? 'write failed'));
          defer(() => {
            if (callback) callback(err);
            s.emit('error', err);
            s.emit('close');
          });
        }
      };
      doWrite();
      return s;
    };
    return s;
  },
  readFile: (p: string, ...args: any[]) => {
    const path = resolveFsLookupPath(p);
    const cb = args[args.length - 1];
    const content = getStoredText(path);
    if (typeof cb === 'function') {
      if (content !== null) {
        cb(null, content);
      } else {
        // Fall back to real file system
        ((window as any).electron?.readFile?.(path) as Promise<string>)
          ?.then((data: string) => {
            if (data !== '') cb(null, data);
            else { const err: any = new Error(`ENOENT: no such file or directory, open '${path}'`); err.code = 'ENOENT'; cb(err, null); }
          })
          ?.catch(() => { const err: any = new Error(`ENOENT: no such file or directory, open '${path}'`); err.code = 'ENOENT'; cb(err, null); })
          ?? (() => { const err: any = new Error(`ENOENT: no such file or directory, open '${path}'`); err.code = 'ENOENT'; cb(err, null); })();
      }
    }
  },
  writeFile: (p: string, data: any, ...args: any[]) => {
    const path = resolveFsLookupPath(p);
    const cb = args[args.length - 1];
    const str = typeof data === 'string' ? data : (data?.toString?.() ?? String(data));
    setStoredText(path, str);
    if (typeof cb === 'function') cb(null);
  },
  mkdir: (_p: string, ...args: any[]) => {
    const cb = args[args.length - 1];
    if (typeof cb === 'function') cb(null);
  },
  access: (p: string, ...args: any[]) => {
    const path = resolveFsLookupPath(p);
    const cb = args[args.length - 1];
    if (typeof cb === 'function') {
      if (getStoredText(path) !== null) cb(null);
      else {
        try {
          if ((window as any).electron?.fileExistsSync?.(path)) { cb(null); return; }
        } catch {}
        const err: any = new Error(`ENOENT: no such file or directory, access '${path}'`);
        err.code = 'ENOENT';
        cb(err);
      }
    }
  },
  stat: (p: string, ...args: any[]) => {
    const cb = args[args.length - 1];
    if (typeof cb !== 'function') return;
    const path = resolveFsLookupPath(p);
    const content = getStoredText(path);
    if (content !== null) {
      cb(null, fsStatResult(true, false, content.length));
      return;
    }
    try {
      const result = (window as any).electron?.statSync?.(path);
      if (result?.exists) {
        cb(null, fsStatResult(true, result.isDirectory));
        return;
      }
    } catch {}
    const err: any = new Error(`ENOENT: no such file or directory, stat '${path}'`);
    err.code = 'ENOENT';
    cb(err);
  },
  lstat: (p: string, ...args: any[]) => {
    const cb = args[args.length - 1];
    if (typeof cb !== 'function') return;
    const path = resolveFsLookupPath(p);
    const content = getStoredText(path);
    if (content !== null) {
      cb(null, fsStatResult(true, false, content.length));
      return;
    }
    try {
      const result = (window as any).electron?.statSync?.(path);
      if (result?.exists) {
        cb(null, fsStatResult(true, result.isDirectory));
        return;
      }
    } catch {}
    const err: any = new Error(`ENOENT: no such file or directory, lstat '${path}'`);
    err.code = 'ENOENT';
    cb(err);
  },
  realpath: (p: string, ...args: any[]) => {
    const path = resolveFsLookupPath(p);
    const cb = args[args.length - 1];
    if (typeof cb === 'function') cb(null, path);
  },
  readdir: (p: string, ...args: any[]) => {
    const cb = args[args.length - 1];
    if (typeof cb === 'function') cb(null, fsStub.readdirSync(p));
  },
  unlink: (p: string, ...args: any[]) => {
    const path = resolveFsLookupPath(p);
    const cb = args[args.length - 1];
    removeStoredText(path);
    if (typeof cb === 'function') cb(null);
  },
  rename: (oldPath: string, newPath: string, ...args: any[]) => {
    const cb = args[args.length - 1];
    fsStub.renameSync(oldPath, newPath);
    if (typeof cb === 'function') cb(null);
  },
  watch: () => ({ close: noop, on: noop }),
  watchFile: noop,
  unwatchFile: noop,
  constants: { F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1 },
  promises: {
    readFile: async (p: string, opts?: any) => {
      const path = resolveFsLookupPath(p);
      const content = getStoredText(path);
      if (content !== null) {
        if (opts?.encoding || typeof opts === 'string') return content;
        return BufferPolyfill.from(content);
      }
      // Fall back to real file system
      try {
        const data = await (window as any).electron?.readFile?.(path);
        if (data !== undefined && data !== '') {
          if (opts?.encoding || typeof opts === 'string') return data;
          return BufferPolyfill.from(data);
        }
      } catch { /* fall through */ }
      const err: any = new Error(`ENOENT: no such file or directory, open '${path}'`);
      err.code = 'ENOENT';
      throw err;
    },
    writeFile: async (p: string, data: any) => {
      const path = resolveFsLookupPath(p);
      const str = typeof data === 'string' ? data : (data?.toString?.() ?? String(data));
      setStoredText(path, str);
    },
    mkdir: async (p: string, opts?: any) => {
      const dirPath = resolveFsLookupPath(p);
      const mkdirArgs = opts?.recursive ? ['-p', dirPath] : [dirPath];
      const result = await (window as any).electron?.execCommand?.('/bin/mkdir', mkdirArgs, {});
      if (result?.exitCode && result.exitCode !== 0) {
        throw new Error(result.stderr || `mkdir failed with exit code ${result.exitCode}`);
      }
    },
    readdir: async (p: string) => fsStub.readdirSync(p),
    stat: async (p: string) => {
      const path = resolveFsLookupPath(p);
      const content = getStoredText(path);
      if (content !== null) return fsStatResult(true, false, content.length);
      try {
        const result = (window as any).electron?.statSync?.(path);
        if (result?.exists) return fsStatResult(true, result.isDirectory);
      } catch {}
      const err: any = new Error(`ENOENT: no such file or directory, stat '${path}'`);
      err.code = 'ENOENT';
      throw err;
    },
    lstat: async (p: string) => {
      const path = resolveFsLookupPath(p);
      const content = getStoredText(path);
      if (content !== null) return fsStatResult(true, false, content.length);
      try {
        const result = (window as any).electron?.statSync?.(path);
        if (result?.exists) return fsStatResult(true, result.isDirectory);
      } catch {}
      const err: any = new Error(`ENOENT: no such file or directory, lstat '${path}'`);
      err.code = 'ENOENT';
      throw err;
    },
    realpath: async (p: string) => resolveFsLookupPath(p),
    access: async (p: string) => {
      const path = resolveFsLookupPath(p);
      if (getStoredText(path) !== null) return;
      try {
        if ((window as any).electron?.fileExistsSync?.(path)) return;
      } catch {}
      const err: any = new Error(`ENOENT: no such file or directory, access '${path}'`);
      err.code = 'ENOENT';
      throw err;
    },
    unlink: async (p: string) => { removeStoredText(resolveFsLookupPath(p)); },
    rm: async (p: string, opts?: any) => {
      const rmPath = resolveFsLookupPath(p);
      removeStoredText(rmPath);
      const rmArgs = opts?.recursive ? ['-rf', rmPath] : [rmPath];
      const result = await (window as any).electron?.execCommand?.('/bin/rm', rmArgs, {});
      if (result?.exitCode && result.exitCode !== 0) {
        throw new Error(result.stderr || `rm failed with exit code ${result.exitCode}`);
      }
    },
    rename: async (oldPath: string, newPath: string) => { fsStub.renameSync(oldPath, newPath); },
    copyFile: async (src: string, dest: string) => { fsStub.copyFileSync(src, dest); },
    chmod: async (p: string, mode: string | number) => {
      const chmodPath = resolveFsLookupPath(p);
      const result = await (window as any).electron?.execCommand?.('/bin/chmod', [String(mode), chmodPath], {});
      if (result?.exitCode && result.exitCode !== 0) {
        throw new Error(result.stderr || `chmod failed with exit code ${result.exitCode}`);
      }
    },
    open: noopAsync,
  },
};

// ── path stub ───────────────────────────────────────────────────
const pathStub = {
  join: (...parts: string[]) => parts.filter(Boolean).join('/').replace(/\/+/g, '/'),
  resolve: (...parts: string[]) => {
    const joined = parts.filter(Boolean).join('/');
    return joined.startsWith('/') ? joined : '/' + joined;
  },
  dirname: (p: string) => {
    const parts = p.split('/');
    return parts.length > 1 ? parts.slice(0, -1).join('/') || '/' : '.';
  },
  basename: (p: string, ext?: string) => {
    const base = p.split('/').pop() || '';
    return ext && base.endsWith(ext) ? base.slice(0, -ext.length) : base;
  },
  extname: (p: string) => { const m = p.match(/\.[^./]+$/); return m ? m[0] : ''; },
  sep: '/',
  delimiter: ':',
  posix: null as any, // filled below
  win32: null as any,
  parse: (p: string) => {
    const ext = pathStub.extname(p);
    const base = pathStub.basename(p);
    const dir = pathStub.dirname(p);
    const name = ext ? base.slice(0, -ext.length) : base;
    return { root: p.startsWith('/') ? '/' : '', dir, base, ext, name };
  },
  format: (obj: any) => [obj.dir || obj.root, obj.base || (obj.name + (obj.ext || ''))].filter(Boolean).join('/'),
  isAbsolute: (p: string) => p.startsWith('/'),
  normalize: (p: string) => p.replace(/\/+/g, '/'),
  relative: (_from: string, _to: string) => '',
  toNamespacedPath: (p: string) => p,
};
pathStub.posix = pathStub;
pathStub.win32 = pathStub; // On macOS all paths are POSIX; win32 delegates to the same impl

// ── os stub (with constants.signals and constants.errno) ────────
// Use real home directory exposed via preload (lazy so it works even if module loads early)
function _getHomedir(): string {
  return (window as any).electron?.homeDir || '/tmp';
}
const osStub: Record<string, any> = {
  homedir: () => _getHomedir(),
  tmpdir: () => '/tmp',
  platform: () => 'darwin',
  arch: () => 'x64',
  type: () => 'Darwin',
  release: () => '24.0.0',
  hostname: () => 'localhost',
  cpus: () => [{ model: 'CPU', speed: 2400, times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 } }],
  totalmem: () => 8 * 1024 * 1024 * 1024,
  freemem: () => 4 * 1024 * 1024 * 1024,
  loadavg: () => [0, 0, 0],
  uptime: () => 3600,
  userInfo: () => { const h = _getHomedir(); return { username: h.split('/').pop() || 'user', uid: 501, gid: 20, shell: '/bin/zsh', homedir: h }; },
  networkInterfaces: () => ({}),
  endianness: () => 'LE',
  EOL: '\n',
  devNull: '/dev/null',
  constants: {
    UV_UDP_REUSEADDR: 4,
    dlopen: {},
    errno: {
      E2BIG: 7, EACCES: 13, EADDRINUSE: 48, EADDRNOTAVAIL: 49,
      EAFNOSUPPORT: 47, EAGAIN: 35, EALREADY: 37, EBADF: 9,
      EBADMSG: 94, EBUSY: 16, ECANCELED: 89, ECHILD: 10,
      ECONNABORTED: 53, ECONNREFUSED: 61, ECONNRESET: 54,
      EDEADLK: 11, EDESTADDRREQ: 39, EDOM: 33, EDQUOT: 69,
      EEXIST: 17, EFAULT: 14, EFBIG: 27, EHOSTUNREACH: 65,
      EIDRM: 90, EILSEQ: 92, EINPROGRESS: 36, EINTR: 4,
      EINVAL: 22, EIO: 5, EISCONN: 56, EISDIR: 21,
      ELOOP: 62, EMFILE: 24, EMLINK: 31, EMSGSIZE: 40,
      EMULTIHOP: 95, ENAMETOOLONG: 63, ENETDOWN: 50,
      ENETRESET: 52, ENETUNREACH: 51, ENFILE: 23,
      ENOBUFS: 55, ENODATA: 96, ENODEV: 19, ENOENT: 2,
      ENOEXEC: 8, ENOLCK: 77, ENOLINK: 97, ENOMEM: 12,
      ENOMSG: 91, ENOPROTOOPT: 42, ENOSPC: 28, ENOSR: 98,
      ENOSTR: 99, ENOSYS: 78, ENOTCONN: 57, ENOTDIR: 20,
      ENOTEMPTY: 66, ENOTSOCK: 38, ENOTSUP: 45,
      ENOTTY: 25, ENXIO: 6, EOPNOTSUPP: 102,
      EOVERFLOW: 84, EPERM: 1, EPIPE: 32, EPROTO: 100,
      EPROTONOSUPPORT: 43, EPROTOTYPE: 41, ERANGE: 34,
      EROFS: 30, ESPIPE: 29, ESRCH: 3, ESTALE: 70,
      ETIME: 101, ETIMEDOUT: 60, ETXTBSY: 26,
      EWOULDBLOCK: 35, EXDEV: 18,
    },
    signals: {
      SIGHUP: 1, SIGINT: 2, SIGQUIT: 3, SIGILL: 4, SIGTRAP: 5,
      SIGABRT: 6, SIGIOT: 6, SIGBUS: 10, SIGFPE: 8, SIGKILL: 9,
      SIGUSR1: 30, SIGSEGV: 11, SIGUSR2: 31, SIGPIPE: 13,
      SIGALRM: 14, SIGTERM: 15, SIGCHLD: 20, SIGCONT: 19,
      SIGSTOP: 17, SIGTSTP: 18, SIGTTIN: 21, SIGTTOU: 22,
      SIGURG: 16, SIGXCPU: 24, SIGXFSZ: 25, SIGVTALRM: 26,
      SIGPROF: 27, SIGWINCH: 28, SIGIO: 23, SIGINFO: 29,
      SIGSYS: 12,
    },
    priority: {
      PRIORITY_LOW: 19,
      PRIORITY_BELOW_NORMAL: 10,
      PRIORITY_NORMAL: 0,
      PRIORITY_ABOVE_NORMAL: -7,
      PRIORITY_HIGH: -14,
      PRIORITY_HIGHEST: -20,
    },
  },
};

// ── crypto stub ─────────────────────────────────────────────────
const cryptoStub = {
  randomUUID: () => crypto.randomUUID?.() || Math.random().toString(36).slice(2),
  createHash: (alg?: string) => ({
    update: function(data: any) { return this; },
    digest: (enc?: string) => enc === 'hex' ? Math.random().toString(16).slice(2) : BufferPolyfill.from(Math.random().toString(36).slice(2)),
    copy: function() { return this; },
  }),
  createHmac: (alg?: string, key?: any) => ({
    update: function(data: any) { return this; },
    digest: (enc?: string) => enc === 'hex' ? Math.random().toString(16).slice(2) : BufferPolyfill.from(Math.random().toString(36).slice(2)),
  }),
  randomBytes: (n: number) => { const buf = BufferPolyfill.alloc(n); crypto.getRandomValues(buf); return buf; },
  randomFillSync: (buf: any, offset?: number, size?: number) => {
    const view = new Uint8Array(buf.buffer || buf, offset ?? 0, size ?? buf.length);
    crypto.getRandomValues(view);
    return buf;
  },
  randomFill: (buf: any, ...args: any[]) => {
    const cb = args[args.length - 1];
    try { cryptoStub.randomFillSync(buf); if (typeof cb === 'function') cb(null, buf); } catch (e) { if (typeof cb === 'function') cb(e); }
  },
  getRandomValues: (arr: any) => crypto.getRandomValues(arr),
  createCipheriv: () => ({ update: () => BufferPolyfill.alloc(0), final: () => BufferPolyfill.alloc(0) }),
  createDecipheriv: () => ({ update: () => BufferPolyfill.alloc(0), final: () => BufferPolyfill.alloc(0) }),
  pbkdf2: noopCb,
  pbkdf2Sync: () => BufferPolyfill.alloc(32),
  scrypt: noopCb,
  scryptSync: () => BufferPolyfill.alloc(32),
  timingSafeEqual: (a: Uint8Array, b: Uint8Array) => {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
  },
  constants: {},
  webcrypto: globalThis.crypto,
};

// ── events stub ─────────────────────────────────────────────────
class EventEmitterStub {
  private _events: Record<string, Function[]> = {};
  private _maxListeners = 10;

  on(event: string, fn: Function) { (this._events[event] ??= []).push(fn); return this; }
  off(event: string, fn: Function) { this._events[event] = (this._events[event] || []).filter(f => f !== fn); return this; }
  once(event: string, fn: Function) {
    const wrapped = (...args: any[]) => { this.off(event, wrapped); fn(...args); };
    return this.on(event, wrapped);
  }
  emit(event: string, ...args: any[]) {
    for (const fn of this._events[event] || []) { try { fn(...args); } catch {} }
    return (this._events[event] || []).length > 0;
  }
  addListener(event: string, fn: Function) { return this.on(event, fn); }
  removeListener(event: string, fn: Function) { return this.off(event, fn); }
  removeAllListeners(event?: string) {
    if (event) delete this._events[event]; else this._events = {};
    return this;
  }
  listenerCount(event: string) { return (this._events[event] || []).length; }
  listeners(event: string) { return [...(this._events[event] || [])]; }
  rawListeners(event: string) { return this.listeners(event); }
  eventNames() { return Object.keys(this._events); }
  setMaxListeners(n: number) { this._maxListeners = n; return this; }
  getMaxListeners() { return this._maxListeners; }
  prependListener(event: string, fn: Function) { (this._events[event] ??= []).unshift(fn); return this; }
  prependOnceListener(event: string, fn: Function) { return this.prependListener(event, fn); }
}

// Node's `require("events")` returns the EventEmitter constructor itself
// (with helpers attached as properties). Some libs (e.g. ws) do:
//   const EventEmitter = require("events");
//   class X extends EventEmitter {}
// so the module value must be a constructable function/class.
const eventsStub: any = EventEmitterStub;
eventsStub.EventEmitter = EventEmitterStub;
eventsStub.default = EventEmitterStub;
eventsStub.once = async (emitter: any, event: string) => new Promise(resolve => emitter.once(event, resolve));
eventsStub.on = async function* (emitter: any, event: string) {
  while (true) {
    const value = await eventsStub.once(emitter, event);
    yield value;
  }
};

// ── stream stubs ────────────────────────────────────────────────
class ReadableStub extends EventEmitterStub {
  readable = true;
  readableEnded = false;
  destroyed = false;
  _readableState: any;
  _writableState: any;
  constructor() {
    super();
    this._readableState = { readable: true };
    this._writableState = undefined;
  }
  read() { return null; }
  pipe(dest: any) {
    this.on('data', (chunk: any) => {
      try { dest?.write?.(chunk); } catch {}
    });
    this.on('end', () => {
      try { dest?.end?.(); } catch {}
    });
    return dest;
  }
  unpipe() { return this; }
  pause() { return this; }
  resume() { return this; }
  destroy() { this.destroyed = true; this.emit('close'); return this; }
  push(chunk: any) {
    if (chunk === null) {
      this.readableEnded = true;
      this.emit('end');
      return false;
    }
    this.emit('data', chunk);
    return true;
  }
  unshift(chunk: any) {
    if (chunk === null || chunk === undefined) return;
    this.emit('data', chunk);
  }
  setEncoding() { return this; }
  [Symbol.asyncIterator]() {
    return { next: async () => ({ done: true, value: undefined }) };
  }
  static from(iterable: any) {
    const s = new ReadableStub();
    setTimeout(async () => {
      try {
        if (iterable && typeof iterable[Symbol.asyncIterator] === 'function') {
          for await (const chunk of iterable) s.emit('data', chunk);
        } else if (iterable && typeof iterable[Symbol.iterator] === 'function') {
          for (const chunk of iterable) s.emit('data', chunk);
        }
      } finally {
        s.emit('end');
        s.emit('close');
      }
    }, 0);
    return s;
  }
  static fromWeb(webStream: any) {
    const s = new ReadableStub();
    const iteratorFactory = () => {
      if (webStream && typeof webStream[Symbol.asyncIterator] === 'function') {
        return webStream[Symbol.asyncIterator]();
      }
      if (webStream && typeof webStream.getReader === 'function') {
        const reader = webStream.getReader();
        return {
          next: async () => {
            const { done, value } = await reader.read();
            if (done) {
              try { reader.releaseLock?.(); } catch {}
            }
            return { done, value };
          },
          return: async () => {
            try { reader.releaseLock?.(); } catch {}
            return { done: true, value: undefined };
          },
        };
      }
      return {
        next: async () => ({ done: true, value: undefined }),
      };
    };
    (s as any)[Symbol.asyncIterator] = iteratorFactory;
    setTimeout(async () => {
      try {
        const iterator = iteratorFactory();
        while (true) {
          const { done, value } = await iterator.next();
          if (done) break;
          s.emit('data', value);
        }
        s.emit('end');
      } catch (e) {
        s.emit('error', e);
      } finally {
        s.emit('close');
      }
    }, 0);
    return s;
  }
}

class WritableStub extends EventEmitterStub {
  writable = true;
  writableEnded = false;
  destroyed = false;
  _readableState: any;
  _writableState: any;
  constructor() {
    super();
    this._readableState = undefined;
    this._writableState = { writable: true };
  }
  write(_chunk: any, _enc?: any, cb?: Function) { if (typeof cb === 'function') cb(); else if (typeof _enc === 'function') _enc(); return true; }
  end(_chunk?: any, _enc?: any, cb?: Function) {
    this.writableEnded = true;
    const callback = typeof cb === 'function' ? cb : typeof _enc === 'function' ? _enc : typeof _chunk === 'function' ? _chunk : null;
    const defer = typeof queueMicrotask === 'function'
      ? queueMicrotask
      : (fn: () => void) => Promise.resolve().then(fn);
    defer(() => {
      if (callback) (callback as Function)();
      this.emit('finish');
      this.emit('close');
    });
    return this;
  }
  destroy() { this.destroyed = true; this.emit('close'); return this; }
  cork() {}
  uncork() {}
  setDefaultEncoding() { return this; }
}

class TransformStub extends ReadableStub {
  writable = true;
  private _transformImpl?: (chunk: any, encoding: any, callback: Function) => void;
  private _flushImpl?: (callback: Function) => void;
  constructor(options?: any) {
    super();
    this._writableState = { writable: true };
    if (options && typeof options === 'object') {
      if (typeof options.transform === 'function') this._transformImpl = options.transform;
      if (typeof options.flush === 'function') this._flushImpl = options.flush;
    }
  }
  write(chunk: any, enc?: any, cb?: Function) {
    const encoding = typeof enc === 'string' ? enc : undefined;
    const callback = typeof cb === 'function' ? cb : typeof enc === 'function' ? enc : noop;
    const done = (err?: any, out?: any) => {
      if (err) {
        this.emit('error', err);
      } else if (out !== undefined && out !== null) {
        this.emit('data', out);
      }
      callback(err ?? null);
    };
    try {
      if (this._transformImpl) {
        this._transformImpl.call(this, chunk, encoding, done);
      } else {
        this._transform(chunk, encoding, done);
      }
    } catch (e) {
      done(e);
    }
    return true;
  }
  end(_chunk?: any, _enc?: any, cb?: Function) {
    const callback = typeof cb === 'function' ? cb : typeof _enc === 'function' ? _enc : typeof _chunk === 'function' ? _chunk : null;
    const finalize = () => {
      this.emit('finish');
      this.emit('end');
      if (callback) (callback as Function)();
    };
    try {
      if (typeof _chunk !== 'function' && _chunk != null) {
        this.write(_chunk, typeof _enc === 'string' ? _enc : undefined, noop);
      }
      if (this._flushImpl) {
        this._flushImpl.call(this, (err: any, out?: any) => {
          if (err) this.emit('error', err);
          if (out !== undefined && out !== null) this.emit('data', out);
          finalize();
        });
      } else {
        this._flush((err: any) => {
          if (err) this.emit('error', err);
          finalize();
        });
      }
    } catch (e) {
      this.emit('error', e);
      finalize();
    }
    return this;
  }
  _transform(chunk: any, enc: any, cb: Function) { cb(null, chunk); }
  _flush(cb: Function) { cb(); }
}

class PassThroughStub extends TransformStub {}

class DuplexStub extends TransformStub {}

class NetSocketStub extends DuplexStub {
  connecting = false;
  destroyed = false;
  remoteAddress?: string;
  remotePort?: number;
  localAddress?: string;
  localPort?: number;
  encrypted?: boolean;
  connect(..._args: any[]) { this.connecting = false; setTimeout(() => this.emit('connect'), 0); return this; }
  write(_chunk?: any, _enc?: any, cb?: Function) { if (typeof cb === 'function') cb(); return true; }
  end(_chunk?: any, _enc?: any, cb?: Function) { if (typeof cb === 'function') cb(); this.emit('end'); this.emit('close'); return this; }
  destroy(_err?: any) { this.destroyed = true; this.emit('close'); return this; }
  setEncoding() { return this; }
  setTimeout(_ms?: number, cb?: Function) { if (typeof cb === 'function') setTimeout(() => cb(), 0); return this; }
  setNoDelay() { return this; }
  setKeepAlive() { return this; }
  address() { return { address: this.localAddress || '127.0.0.1', family: 'IPv4', port: this.localPort || 0 }; }
  ref() { return this; }
  unref() { return this; }
}

// Node's `require("stream")` is callable (Stream constructor) and also has
// Readable/Writable/... properties. Some libraries (e.g. node-fetch) rely on
// `value instanceof require("stream")`, so the module itself must be a function/class.
class StreamModuleStub extends EventEmitterStub {}
const streamStub: any = StreamModuleStub;
streamStub.Readable = ReadableStub;
streamStub.Writable = WritableStub;
streamStub.Transform = TransformStub;
streamStub.PassThrough = PassThroughStub;
streamStub.Duplex = DuplexStub;
streamStub.Stream = StreamModuleStub;
streamStub.pipeline = (...args: any[]) => {
  const hasCb = typeof args[args.length - 1] === 'function';
  if (hasCb) {
    streamPipelineCompat(...args).catch(() => {});
    return args[args.length - 2] || new PassThroughStub();
  }
  return streamPipelineCompat(...args);
};
streamStub.finished = (stream: any, cb: Function) => { if (typeof cb === 'function') setTimeout(() => cb(null), 0); };

async function streamPipelineCompat(...args: any[]) {
  const hasCb = typeof args[args.length - 1] === 'function';
  const cb = hasCb ? args.pop() : null;
  const streams = args;
  const src = streams[0];
  const dest = streams[streams.length - 1];

  const asAsyncIterable = (source: any) => {
    if (source && typeof source[Symbol.asyncIterator] === 'function') return source;
    if (source && typeof source.getReader === 'function') {
      return {
        async *[Symbol.asyncIterator]() {
          const reader = source.getReader();
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              yield value;
            }
          } finally {
            try { reader.releaseLock?.(); } catch {}
          }
        },
      };
    }
    return {
      async *[Symbol.asyncIterator]() {},
    };
  };

  try {
    for await (const chunk of asAsyncIterable(src) as any) {
      if (dest && typeof dest.write === 'function') {
        await new Promise<void>((resolve, reject) => {
          try {
            const ret = dest.write(chunk, (err: any) => (err ? reject(err) : resolve()));
            if (ret !== false && dest.write.length < 2) resolve();
          } catch (e) {
            reject(e);
          }
        });
      }
    }
    if (dest && typeof dest.end === 'function') {
      await new Promise<void>((resolve, reject) => {
        try { dest.end((err: any) => (err ? reject(err) : resolve())); } catch (e) { reject(e); }
      });
    }
    if (cb) cb(null);
    return dest;
  } catch (e) {
    if (cb) cb(e);
    throw e;
  }
}

// ── child_process stub ──────────────────────────────────────────
const fakeChildProcess: any = new EventEmitterStub();
fakeChildProcess.stdin = new WritableStub();
fakeChildProcess.stdout = new ReadableStub();
fakeChildProcess.stderr = new ReadableStub();
fakeChildProcess.pid = 0;
fakeChildProcess.exitCode = null;
fakeChildProcess.kill = noop;
fakeChildProcess.ref = noop;
fakeChildProcess.unref = noop;
fakeChildProcess.disconnect = noop;
fakeChildProcess.connected = false;

const childProcessStub = {
  // Some git flows probe paths that can legitimately disappear (deleted/moved files).
  // Raycast ignores these transient ENOENT stat-style failures; we do the same.
  // Keep this very narrow so real command failures still surface.
  _isGitInvocation: (commandOrFile: string, execArgs?: string[]) => {
    const file = String(commandOrFile || '').toLowerCase();
    const argsJoined = Array.isArray(execArgs) ? execArgs.join(' ').toLowerCase() : '';
    return /\bgit(\s|$)/.test(file) || file.endsWith('/git') || /\bgit(\s|$)/.test(argsJoined);
  },
  _isBenignMissingPathError: (message: string) => {
    const lower = String(message || '').toLowerCase();
    if (!lower.includes('enoent') || !lower.includes('no such file or directory')) return false;
    return /\b(stat|lstat|access|scandir)\b/.test(lower);
  },
  _shouldSuppressMissingPathError: (commandOrFile: string, message: string, execArgs?: string[]) => {
    return childProcessStub._isGitInvocation(commandOrFile, execArgs)
      && childProcessStub._isBenignMissingPathError(message);
  },
  exec: (...args: any[]) => {
    // Parse arguments: exec(command[, options][, callback])
    const command = args[0];
    let options: any = {};
    let cb: any = null;
    if (typeof args[1] === 'function') { cb = args[1]; }
    else if (typeof args[1] === 'object') { options = args[1]; cb = typeof args[2] === 'function' ? args[2] : null; }
    else if (typeof args[2] === 'function') { cb = args[2]; }

    // Actually execute via IPC bridge
    const cp: any = { ...fakeChildProcess };
    if (typeof command === 'string' && (window as any).electron?.execCommand) {
      const normalizedCommand = rewriteShellCommandForMissingBinary(command);
      (window as any).electron.execCommand(
        '/bin/zsh', ['-lc', normalizedCommand],
        { shell: false, env: options?.env, cwd: options?.cwd }
      ).then((result: any) => {
        if (cb) {
          const stderrOrMsg = String(result?.stderr || '');
          if (childProcessStub._shouldSuppressMissingPathError(normalizedCommand, stderrOrMsg)) {
            cb(null, '', '');
            return;
          }
          if (result.exitCode !== 0 && !result.stdout) {
            const err: any = new Error(result.stderr || `Command failed with exit code ${result.exitCode}`);
            err.code = result.exitCode;
            err.stderr = result.stderr;
            cb(err, result.stdout || '', result.stderr || '');
          } else {
            cb(null, result.stdout || '', result.stderr || '');
          }
        }
      }).catch((e: any) => {
        if (cb && childProcessStub._shouldSuppressMissingPathError(normalizedCommand, String(e?.message || e || ''))) {
          cb(null, '', '');
          return;
        }
        if (cb) cb(e, '', '');
      });
    } else {
      if (cb) setTimeout(() => cb(null, '', ''), 0);
    }
    return cp;
  },
  execSync: (command: string) => {
    const normalizedCommand = rewriteShellCommandForMissingBinary(command);
    const result = (window as any).electron?.execCommandSync?.(
      '/bin/zsh',
      ['-lc', normalizedCommand],
      { shell: false }
    );
    if (result?.exitCode && result.exitCode !== 0) {
      const stderrOrMsg = String(result?.stderr || '');
      if (childProcessStub._shouldSuppressMissingPathError(normalizedCommand, stderrOrMsg)) {
        return BufferPolyfill.from('');
      }
      const err: any = new Error(result.stderr || `Command failed with exit code ${result.exitCode}`);
      err.status = result.exitCode;
      err.stderr = result.stderr;
      err.stdout = result.stdout;
      throw err;
    }
    return BufferPolyfill.from(result?.stdout || '');
  },
  execFile: (...args: any[]) => {
    // Parse arguments: execFile(file[, args][, options][, callback])
    const file = resolveExecutablePath(args[0]);
    let execArgs: string[] = [];
    let options: any = {};
    let cb: any = null;

    // Find callback (last function argument)
    for (let i = args.length - 1; i >= 1; i--) {
      if (typeof args[i] === 'function') { cb = args[i]; break; }
    }
    // Find args array and options
    if (Array.isArray(args[1])) {
      execArgs = args[1];
      if (typeof args[2] === 'object' && args[2] !== null && !Array.isArray(args[2])) options = args[2];
    } else if (typeof args[1] === 'object' && args[1] !== null && !Array.isArray(args[1]) && typeof args[1] !== 'function') {
      options = args[1];
    }

    const cp: any = { ...fakeChildProcess };
    if ((window as any).electron?.execCommand) {
      (window as any).electron.execCommand(file, execArgs, { shell: false, env: options?.env, cwd: options?.cwd })
        .then((result: any) => {
          if (cb) {
            const stderrOrMsg = String(result?.stderr || '');
            if (childProcessStub._shouldSuppressMissingPathError(file, stderrOrMsg, execArgs)) {
              cb(null, '', '');
              return;
            }
            if (result.exitCode !== 0 && !result.stdout) {
              const err: any = new Error(result.stderr || `Command failed with exit code ${result.exitCode}`);
              err.code = result.exitCode;
              cb(err, result.stdout || '', result.stderr || '');
            } else {
              cb(null, result.stdout || '', result.stderr || '');
            }
          }
        }).catch((e: any) => {
          if (cb && childProcessStub._shouldSuppressMissingPathError(file, String(e?.message || e || ''), execArgs)) {
            cb(null, '', '');
            return;
          }
          if (cb) cb(e, '', '');
        });
    } else {
      if (cb) setTimeout(() => cb(null, '', ''), 0);
    }
    return cp;
  },
  execFileSync: (...args: any[]) => {
    const file = resolveExecutablePath(args[0]);
    let execArgs: string[] = [];
    let options: any = {};

    if (Array.isArray(args[1])) {
      execArgs = args[1];
      if (typeof args[2] === 'object' && args[2] !== null && !Array.isArray(args[2])) options = args[2];
    } else if (typeof args[1] === 'object' && args[1] !== null && !Array.isArray(args[1])) {
      options = args[1];
    }

    const result = (window as any).electron?.execCommandSync?.(
      file,
      execArgs,
      { shell: false, env: options?.env, cwd: options?.cwd, input: options?.input }
    ) || { stdout: '', stderr: '', exitCode: 0 };

    if (result.exitCode !== 0) {
      const stderrOrMsg = String(result?.stderr || '');
      if (childProcessStub._shouldSuppressMissingPathError(file, stderrOrMsg, execArgs)) {
        return options?.encoding ? '' : BufferPolyfill.from('');
      }
      const err: any = new Error(result.stderr || `Command failed with exit code ${result.exitCode}`);
      err.status = result.exitCode;
      err.stderr = result.stderr;
      err.stdout = result.stdout;
      throw err;
    }

    if (options?.encoding) return result.stdout || '';
    return BufferPolyfill.from(result.stdout || '');
  },
  spawn: (...args: any[]) => {
    const file = resolveExecutablePath(args[0]);
    const spawnArgs = Array.isArray(args[1]) ? args[1] : [];
    const options = (typeof args[2] === 'object' && args[2]) ? args[2] : {};
    const cp: any = new EventEmitterStub();
    cp.stdin = new WritableStub();
    cp.stdout = new ReadableStub();
    cp.stderr = new ReadableStub();
    cp.pid = 0;
    cp.exitCode = null;
    cp.kill = noop;
    cp.ref = noop;
    cp.unref = noop;
    cp.disconnect = noop;
    const electron = (window as any).electron;
    if (electron?.spawnProcess) {
      // Streaming spawn: main process runs the binary and forwards stdout/stderr chunks in real-time.
      // This is the generic solution for all extensions using child_process.spawn with progressive output.
      let pid: number | null = null;
      const cleanups: Array<() => void> = [];
      const cleanup = () => { cleanups.forEach(fn => fn()); cleanups.length = 0; };
      let didHandleTerminalEvent = false;
      type PendingSpawnEvent =
        | { kind: 'stdout'; p: number; data: any; seq?: number }
        | { kind: 'stderr'; p: number; data: any; seq?: number }
        | { kind: 'exit'; p: number; code: number }
        | { kind: 'error'; p: number; message: string };
      const pendingEvents: PendingSpawnEvent[] = [];
      const isForCurrentProcess = (p: number) => pid !== null && p === pid;

      const endChildStreams = () => {
        try { cp.stdout.emit('end'); } catch {}
        try { cp.stdout.emit('close'); } catch {}
        try { cp.stderr.emit('end'); } catch {}
        try { cp.stderr.emit('close'); } catch {}
      };
      const processSpawnEvent = (event: PendingSpawnEvent) => {
        if (!isForCurrentProcess(event.p)) return;
        if (didHandleTerminalEvent) return;
        if (event.kind === 'stdout') {
          cp.stdout.emit('data', BufferPolyfill.from(toUint8Array(event.data)));
          return;
        }
        if (event.kind === 'stderr') {
          cp.stderr.emit('data', BufferPolyfill.from(toUint8Array(event.data)));
          return;
        }
        if (event.kind === 'exit') {
          didHandleTerminalEvent = true;
          endChildStreams();
          cleanup();
          cp.exitCode = event.code;
          cp.emit('close', event.code, null);
          cp.emit('exit', event.code, null);
          return;
        }
        didHandleTerminalEvent = true;
        cleanup();
        const err = new Error(event.message);
        cp.stderr.emit('data', BufferPolyfill.from(event.message));
        cp.emit('error', err);
        endChildStreams();
        cp.emit('close', 1, null);
        cp.emit('exit', 1, null);
      };
      const queueOrProcess = (event: PendingSpawnEvent) => {
        if (pid === null) {
          pendingEvents.push(event);
          return;
        }
        processSpawnEvent(event);
      };
      const flushPendingEvents = () => {
        if (pid === null || pendingEvents.length === 0) return;
        const events = pendingEvents.splice(0, pendingEvents.length);
        for (const event of events) {
          processSpawnEvent(event);
        }
      };
      if (typeof electron.onSpawnEvent === 'function') {
        cleanups.push(
          electron.onSpawnEvent((event: { pid: number; seq: number; type: 'stdout' | 'stderr' | 'exit' | 'error'; data?: any; code?: number; message?: string }) => {
            if (!event || typeof event !== 'object') return;
            if (event.type === 'stdout') {
              queueOrProcess({ kind: 'stdout', p: event.pid, data: event.data, seq: event.seq });
              return;
            }
            if (event.type === 'stderr') {
              queueOrProcess({ kind: 'stderr', p: event.pid, data: event.data, seq: event.seq });
              return;
            }
            if (event.type === 'exit') {
              queueOrProcess({ kind: 'exit', p: event.pid, code: Number(event.code ?? 0) });
              return;
            }
            if (event.type === 'error') {
              queueOrProcess({ kind: 'error', p: event.pid, message: String(event.message || 'spawn failed') });
            }
          })
        );
      } else {
        // Backward-compatible fallback: older main processes emit separate channels.
        cleanups.push(electron.onSpawnStdout((p: number, data: Uint8Array) => {
          queueOrProcess({ kind: 'stdout', p, data });
        }));
        cleanups.push(electron.onSpawnStderr((p: number, data: Uint8Array) => {
          queueOrProcess({ kind: 'stderr', p, data });
        }));
        cleanups.push(electron.onSpawnExit((p: number, code: number) => {
          queueOrProcess({ kind: 'exit', p, code });
        }));
        cleanups.push(electron.onSpawnError((p: number, message: string) => {
          queueOrProcess({ kind: 'error', p, message });
        }));
      }

      cp.kill = () => { if (pid !== null) electron.killSpawnProcess?.(pid); };

      electron.spawnProcess(file, spawnArgs, {
        shell: options?.shell ?? false,
        env: options?.env,
        cwd: options?.cwd,
      }).then((result: { pid: number }) => {
        pid = result.pid;
        cp.pid = pid;
        flushPendingEvents();
      }).catch((err: any) => {
        cleanup();
        const message = String(err?.message || err || 'spawn failed');
        cp.stderr.emit('data', BufferPolyfill.from(message));
        cp.emit('error', new Error(message));
        cp.emit('close', 1, null);
        cp.emit('exit', 1, null);
      });
    } else if (electron?.execCommand) {
      // Fallback for environments without streaming spawn: collect all output then emit
      electron.execCommand(
        file,
        spawnArgs,
        { shell: options?.shell ?? false, env: options?.env, cwd: options?.cwd, input: options?.input }
      ).then((result: any) => {
        const stderrOrMsg = String(result?.stderr || '');
        if (childProcessStub._shouldSuppressMissingPathError(file, stderrOrMsg, spawnArgs)) {
          cp.emit('close', 0, null);
          cp.emit('exit', 0, null);
          return;
        }
        if (result?.stdout) cp.stdout.emit('data', BufferPolyfill.from(result.stdout));
        if (result?.stderr) cp.stderr.emit('data', BufferPolyfill.from(result.stderr));
        const code = result?.exitCode ?? 0;
        cp.emit('close', code, null);
        cp.emit('exit', code, null);
      }).catch((err: any) => {
        if (childProcessStub._shouldSuppressMissingPathError(file, String(err?.message || err || ''), spawnArgs)) {
          cp.emit('close', 0, null);
          cp.emit('exit', 0, null);
          return;
        }
        const message = String(err?.message || err || 'spawn failed');
        cp.stderr.emit('data', BufferPolyfill.from(message));
        cp.emit('error', new Error(message));
        cp.emit('close', 1, null);
        cp.emit('exit', 1, null);
      });
    } else {
      setTimeout(() => { cp.emit('close', 0, null); }, 0);
    }
    return cp;
  },
  spawnSync: (command: string, spawnArgs?: string[], options?: any) => {
    const resolvedCommand = resolveExecutablePath(command);
    const result = (window as any).electron?.execCommandSync?.(
      resolvedCommand,
      Array.isArray(spawnArgs) ? spawnArgs : [],
      { shell: options?.shell ?? false, env: options?.env, cwd: options?.cwd, input: options?.input }
    ) || { stdout: '', stderr: '', exitCode: 0 };

    const stdoutBuf = BufferPolyfill.from(result.stdout || '');
    const stderrBuf = BufferPolyfill.from(result.stderr || '');
    if ((result.exitCode ?? 0) !== 0
      && childProcessStub._shouldSuppressMissingPathError(resolvedCommand, String(result?.stderr || ''), Array.isArray(spawnArgs) ? spawnArgs : [])) {
      return {
        pid: 0,
        output: [null, BufferPolyfill.from(''), BufferPolyfill.from('')],
        stdout: BufferPolyfill.from(''),
        stderr: BufferPolyfill.from(''),
        status: 0,
        signal: null,
        error: undefined,
      };
    }
    return {
      pid: 0,
      output: [null, stdoutBuf, stderrBuf],
      stdout: stdoutBuf,
      stderr: stderrBuf,
      status: result.exitCode ?? 0,
      signal: null,
      error: undefined,
    };
  },
  fork: () => ({ ...fakeChildProcess }),
};

// ── timers stubs ────────────────────────────────────────────────
const timersStub = {
  setTimeout: globalThis.setTimeout.bind(globalThis),
  setInterval: globalThis.setInterval.bind(globalThis),
  clearTimeout: globalThis.clearTimeout.bind(globalThis),
  clearInterval: globalThis.clearInterval.bind(globalThis),
  setImmediate: (fn: Function, ...args: any[]) => globalThis.setTimeout(() => fn(...args), 0),
  clearImmediate: globalThis.clearTimeout.bind(globalThis),
};

const timersPromisesStub = {
  setTimeout: (ms: number) => new Promise((r) => globalThis.setTimeout(r, ms)),
  setInterval: async function* (ms: number) { while (true) { await new Promise(r => globalThis.setTimeout(r, ms)); yield; } },
  setImmediate: () => Promise.resolve(),
  scheduler: { wait: (ms: number) => new Promise(r => globalThis.setTimeout(r, ms)) },
};

// ── util stub ───────────────────────────────────────────────────
const promisifyCustomSymbol = Symbol.for('nodejs.util.promisify.custom');

const utilStub: Record<string, any> = {
  promisify: (fn: any) => {
    if (fn && fn[promisifyCustomSymbol]) return fn[promisifyCustomSymbol];
    return (...args: any[]) => new Promise((resolve, reject) => {
      fn(...args, (err: any, ...results: any[]) => {
        if (err) {
          reject(err);
          return;
        }
        if (results.length <= 1) {
          resolve(results[0]);
          return;
        }
        // Match child_process exec/execFile promisified shape: { stdout, stderr }
        if (results.length === 2) {
          resolve({ stdout: results[0], stderr: results[1] });
          return;
        }
        resolve(results);
      });
    });
  },
  callbackify: (fn: any) => (...args: any[]) => {
    const cb = args.pop();
    fn(...args).then((r: any) => cb(null, r)).catch((e: any) => cb(e));
  },
  format: (...args: any[]) => args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' '),
  inspect: (o: any) => { try { return JSON.stringify(o, null, 2); } catch { return String(o); } },
  deprecate: (fn: any) => fn,
  inherits: (ctor: any, superCtor: any) => { ctor.super_ = superCtor; Object.setPrototypeOf(ctor.prototype, superCtor.prototype); },
  types: {
    isDate: (v: any) => v instanceof Date,
    isRegExp: (v: any) => v instanceof RegExp,
    isPromise: (v: any) => v instanceof Promise,
    isArrayBuffer: (v: any) => v instanceof ArrayBuffer,
    isAnyArrayBuffer: (v: any) => v instanceof ArrayBuffer || (typeof SharedArrayBuffer !== 'undefined' && v instanceof SharedArrayBuffer),
    isTypedArray: (v: any) => ArrayBuffer.isView(v) && !(v instanceof DataView),
    isBoxedPrimitive: (v: any) =>
      v instanceof Number
      || v instanceof String
      || v instanceof Boolean
      || (typeof BigInt !== 'undefined' && typeof (v as any) === 'object' && Object.prototype.toString.call(v) === '[object BigInt]')
      || (typeof Symbol !== 'undefined' && typeof (v as any) === 'object' && Object.prototype.toString.call(v) === '[object Symbol]'),
    isNumberObject: (v: any) => v instanceof Number,
    isStringObject: (v: any) => v instanceof String,
    isBooleanObject: (v: any) => v instanceof Boolean,
    isBigIntObject: (v: any) => typeof (v as any) === 'object' && Object.prototype.toString.call(v) === '[object BigInt]',
    isSymbolObject: (v: any) => typeof (v as any) === 'object' && Object.prototype.toString.call(v) === '[object Symbol]',
  },
  TextDecoder,
  TextEncoder,
  isDeepStrictEqual: (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b),
};
utilStub.promisify.custom = promisifyCustomSymbol;

// ── process stub ────────────────────────────────────────────────
const processStub: Record<string, any> = {
  env: { NODE_ENV: 'production', HOME: '/tmp', PATH: '', USER: 'user' },
  cwd: () => '/',
  chdir: noop,
  platform: 'darwin',
  arch: 'x64',
  version: 'v20.0.0',
  versions: { node: '20.0.0', v8: '11.0.0', modules: '115' },
  argv: ['/usr/local/bin/node'],
  argv0: 'node',
  execArgv: [],
  execPath: '/usr/local/bin/node',
  pid: 1,
  ppid: 0,
  title: 'SuperCmd',
  exit: noop,
  abort: noop,
  kill: noop,
  on: function() { return processStub; },
  off: function() { return processStub; },
  once: function() { return processStub; },
  emit: () => false,
  addListener: function() { return processStub; },
  removeListener: function() { return processStub; },
  removeAllListeners: function() { return processStub; },
  listeners: () => [],
  listenerCount: () => 0,
  nextTick: (fn: Function, ...args: any[]) => Promise.resolve().then(() => fn(...args)),
  stdout: { write: noop, isTTY: false, fd: 1, columns: 80, rows: 24 },
  stderr: { write: noop, isTTY: false, fd: 2, columns: 80, rows: 24 },
  stdin: { read: () => null, isTTY: false, fd: 0, on: noop, resume: noop, pause: noop },
  hrtime: Object.assign(
    (prev?: [number, number]) => {
      const now = performance.now();
      const s = Math.floor(now / 1000);
      const ns = Math.floor((now % 1000) * 1e6);
      if (prev) return [s - prev[0], ns - prev[1]];
      return [s, ns];
    },
    { bigint: () => BigInt(Math.floor(performance.now() * 1e6)) }
  ),
  memoryUsage: () => ({ rss: 0, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0 }),
  cpuUsage: () => ({ user: 0, system: 0 }),
  uptime: () => performance.now() / 1000,
  umask: () => 0o22,
  getuid: () => 501,
  getgid: () => 20,
  config: { variables: {} },
  release: { name: 'node' },
  features: {},
  binding: () => ({}),
  _linkedBinding: () => ({}),
};

// ── react-dom/server stub ───────────────────────────────────────
// Some extensions import react-dom/server for SSR. We provide a
// minimal implementation using React.createElement to render to string.
const reactDomServerStub = {
  renderToString: (element: any) => {
    try {
      // Simple recursive serializer for React elements
      return serializeReactElement(element);
    } catch {
      return '';
    }
  },
  renderToStaticMarkup: (element: any) => {
    try {
      return serializeReactElement(element);
    } catch {
      return '';
    }
  },
  renderToPipeableStream: (element: any) => ({
    pipe: (writable: any) => { writable?.end?.(serializeReactElement(element)); return writable; },
    abort: noop,
  }),
};

function serializeReactElement(element: any): string {
  if (element == null || typeof element === 'boolean') return '';
  if (typeof element === 'string' || typeof element === 'number') return String(element);
  if (Array.isArray(element)) return element.map(serializeReactElement).join('');
  if (typeof element !== 'object') return '';
  if (element.type && element.props) {
    const tag = typeof element.type === 'string' ? element.type : 'div';
    const children = element.props.children;
    const inner = children != null ? serializeReactElement(children) : '';
    return `<${tag}>${inner}</${tag}>`;
  }
  return '';
}

// ── Assemble all stubs ──────────────────────────────────────────
const nodeBuiltinStubs: Record<string, any> = {
  fs: fsStub,
  'fs/promises': fsStub.promises,
  path: pathStub,
  os: osStub,
  crypto: cryptoStub,
  events: eventsStub,
  child_process: childProcessStub,
  timers: timersStub,
  'timers/promises': timersPromisesStub,
  buffer: {
    Buffer: BufferPolyfill,
    SlowBuffer: BufferPolyfill,
    Blob: BlobCompat,
    File: FileCompat,
    kMaxLength: 2 ** 31 - 1,
    INSPECT_MAX_BYTES: 50,
    constants: { MAX_LENGTH: 2 ** 31 - 1, MAX_STRING_LENGTH: 2 ** 28 - 16 },
  },
  util: utilStub,
  stream: streamStub,
  'stream/promises': {
    pipeline: streamPipelineCompat,
    finished: async (_stream: any) => {},
  },
  'stream/web': {
    ReadableStream: globalThis.ReadableStream,
    WritableStream: globalThis.WritableStream,
    TransformStream: globalThis.TransformStream,
  },
  url: {
    URL: globalThis.URL,
    URLSearchParams: globalThis.URLSearchParams,
    parse: (u: string) => { try { const url = new URL(u); return url; } catch { return { href: u }; } },
    format: (u: any) => typeof u === 'string' ? u : u?.href ?? '',
    resolve: (from: string, to: string) => { try { return new URL(to, from).href; } catch { return to; } },
    fileURLToPath: (u: string) => u.replace('file://', ''),
    pathToFileURL: (p: string) => new URL(`file://${p}`),
  },
  querystring: {
    parse: (s: string) => {
      const result: Record<string, string | string[]> = {};
      for (const [key, val] of new URLSearchParams(s)) {
        if (key in result) {
          const existing = result[key];
          result[key] = Array.isArray(existing) ? [...existing, val] : [existing, val];
        } else {
          result[key] = val;
        }
      }
      return result;
    },
    stringify: (o: any) => {
      const parts: string[] = [];
      for (const [key, val] of Object.entries(o)) {
        if (Array.isArray(val)) {
          for (const v of val) parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
        } else if (val != null) {
          parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(val))}`);
        }
      }
      return parts.join('&');
    },
    encode: (o: any) => {
      const parts: string[] = [];
      for (const [key, val] of Object.entries(o)) {
        if (Array.isArray(val)) {
          for (const v of val) parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
        } else if (val != null) {
          parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(val))}`);
        }
      }
      return parts.join('&');
    },
    decode: (s: string) => {
      const result: Record<string, string | string[]> = {};
      for (const [key, val] of new URLSearchParams(s)) {
        if (key in result) {
          const existing = result[key];
          result[key] = Array.isArray(existing) ? [...existing, val] : [existing, val];
        } else {
          result[key] = val;
        }
      }
      return result;
    },
    escape: encodeURIComponent,
    unescape: decodeURIComponent,
  },
  http: {
    request: (...args: any[]) => { const w = new WritableStub(); setTimeout(() => w.emit('response', new ReadableStub()), 0); return w; },
    get: (...args: any[]) => { const w = new WritableStub(); setTimeout(() => w.emit('response', new ReadableStub()), 0); w.end(); return w; },
    Agent: class { destroy() {} },
    STATUS_CODES: { 200: 'OK', 201: 'Created', 204: 'No Content', 301: 'Moved Permanently', 302: 'Found', 304: 'Not Modified', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 500: 'Internal Server Error' },
    METHODS: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'],
    createServer: () => ({ listen: noop, close: noop, on: noop }),
    globalAgent: { destroy: noop },
  },
  https: {
    request: (...args: any[]) => { const w = new WritableStub(); setTimeout(() => w.emit('response', new ReadableStub()), 0); return w; },
    get: (...args: any[]) => { const w = new WritableStub(); setTimeout(() => w.emit('response', new ReadableStub()), 0); w.end(); return w; },
    Agent: class { destroy() {} },
    createServer: () => ({ listen: noop, close: noop, on: noop }),
    globalAgent: { destroy: noop },
  },
  assert: Object.assign(
    (v: any, msg?: string) => { if (!v) throw new Error(msg || 'Assertion failed'); },
    {
      ok: (v: any, msg?: string) => { if (!v) throw new Error(msg || 'Assertion failed'); },
      equal: (a: any, b: any) => { if (a != b) throw new Error(`${a} != ${b}`); },
      strictEqual: (a: any, b: any) => { if (a !== b) throw new Error(`${a} !== ${b}`); },
      deepEqual: noop,
      deepStrictEqual: noop,
      notEqual: noop,
      notStrictEqual: noop,
      throws: noop,
      doesNotThrow: noop,
      rejects: noopAsync,
      doesNotReject: noopAsync,
      fail: (msg?: string) => { throw new Error(msg || 'Assertion failed'); },
      AssertionError: class extends Error {},
    }
  ),
  net: {
    Socket: NetSocketStub,
    createServer: () => ({ listen: noop, close: noop, on: noop, address: () => ({}) }),
    createConnection: () => new NetSocketStub(),
    connect: () => new NetSocketStub(),
    isIP: (s: string) => /^\d+\.\d+\.\d+\.\d+$/.test(s) ? 4 : 0,
    isIPv4: (s: string) => /^\d+\.\d+\.\d+\.\d+$/.test(s),
    isIPv6: () => false,
  },
  tls: {
    TLSSocket: NetSocketStub,
    connect: () => {
      const s = new NetSocketStub();
      s.encrypted = true;
      setTimeout(() => s.emit('secureConnect'), 0);
      return s;
    },
    createServer: () => ({ listen: noop, close: noop, on: noop }),
  },
  dns: { lookup: noopCb, resolve: noopCb, resolve4: noopCb, resolve6: noopCb, promises: { lookup: noopAsync, resolve: noopAsync } },
  dgram: { createSocket: () => new EventEmitterStub() },
  cluster: { isMaster: true, isPrimary: true, isWorker: false, on: noop, fork: noop },
  tty: { isatty: () => false, ReadStream: class {}, WriteStream: class {} },
  v8: { serialize: () => BufferPolyfill.alloc(0), deserialize: () => undefined },
  vm: { createContext: (o: any) => o, runInContext: noop, runInNewContext: noop, Script: class { runInContext() {} runInNewContext() {} } },
  worker_threads: { isMainThread: true, parentPort: null, Worker: class {}, workerData: null },
  zlib: {
    gzipSync: (buf: any) => buf,
    gunzipSync: (buf: any) => buf,
    deflateSync: (buf: any) => buf,
    inflateSync: (buf: any) => buf,
    createGzip: () => new TransformStub(),
    createGunzip: () => new TransformStub(),
    createDeflate: () => new TransformStub(),
    createInflate: () => new TransformStub(),
    constants: {},
  },
  module: {
    createRequire: () => (id: string) => {
      if (id in nodeBuiltinStubs) return nodeBuiltinStubs[id];
      return {};
    },
    builtinModules: ['fs', 'path', 'os', 'crypto', 'http', 'https', 'stream', 'events', 'url', 'util', 'buffer', 'child_process', 'net', 'tls', 'dns', 'zlib', 'querystring', 'assert', 'timers'],
    Module: class {},
  },
  readline: {
    createInterface: () => ({
      on: noop, close: noop, question: noopCb,
      [Symbol.asyncIterator]() { return { next: async () => ({ done: true, value: undefined }) }; },
    }),
  },
  perf_hooks: { performance: globalThis.performance, PerformanceObserver: class { observe() {} disconnect() {} } },
  string_decoder: { StringDecoder: class { write(b: any) { return typeof b === 'string' ? b : new TextDecoder().decode(b); } end() { return ''; } } },
  process: processStub,
  constants: osStub.constants, // alias
  punycode: { toASCII: (s: string) => s, toUnicode: (s: string) => s, encode: (s: string) => s, decode: (s: string) => s },
  async_hooks: {
    createHook: () => ({ enable: noop, disable: noop }),
    executionAsyncId: () => 0,
    triggerAsyncId: () => 0,
    executionAsyncResource: () => ({}),
    AsyncResource: class {
      type: string;
      constructor(type = 'ASYNCRESOURCE') {
        this.type = type;
      }
      runInAsyncScope(fn: Function, thisArg?: any, ...args: any[]) {
        return fn.apply(thisArg, args);
      }
      emitDestroy() {}
      asyncId() { return 0; }
      triggerAsyncId() { return 0; }
    },
    AsyncLocalStorage: class {
      run(_store: any, fn: Function, ...args: any[]) { return fn(...args); }
      getStore() { return undefined; }
      enterWith(_store: any) {}
      disable() {}
    },
  },
  diagnostics_channel: { channel: () => ({ subscribe: noop, unsubscribe: noop, publish: noop }), hasSubscribers: () => false },
  'node:test': { describe: noop, it: noop, test: noop },

  // ── Third-party packages kept external so the renderer shim can intercept them ──
  // These are marked external in esbuild so extensions don't bundle them inline.
  // All file I/O is routed through the main process via IPC.

  // axios: HTTP client — returns a ReadableStub for responseType:'stream' so
  // extensions can pipe the response to a createWriteStream for binary CLI downloads.
  axios: (() => {
    const makeAxios = (defaults?: any) => {
      const inst: any = async function axiosInstance(config: any) {
        return inst.request(config);
      };
      inst.defaults = defaults || {};
      inst.interceptors = {
        request: { use: noop, eject: noop, clear: noop },
        response: { use: noop, eject: noop, clear: noop },
      };
      inst.request = async (config: any) => inst.get(config?.url || '', config);
      inst.get = async (url: string, config?: any) => {
        const responseType = config?.responseType || 'json';
        if (responseType === 'stream' || responseType === 'arraybuffer') {
          // Route binary downloads through the main process (Node.js) to bypass CORS restrictions.
          // The renderer's fetch() is blocked by CORS on CDN binary endpoints that don't send
          // Access-Control-Allow-Origin headers (e.g. speedtest, GitHub releases).
          let rawBytes: Uint8Array;
          try {
            const binaryDownloader = (window as any).electron?.httpDownloadBinary;
            if (typeof binaryDownloader !== 'function') {
              throw new Error('Binary download bridge unavailable');
            }
            rawBytes = await Promise.race([
              binaryDownloader(url),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('Binary download timed out')), 45_000)
              ),
            ]);
          } catch (e: any) {
            const err: any = new Error(e?.message || 'Download failed');
            err.isAxiosError = true;
            throw err;
          }
          const bytes = toUint8Array(rawBytes);
          if (responseType === 'arraybuffer') {
            return { data: bytes.buffer, status: 200, headers: {} };
          }
          // responseType === 'stream': wrap in a ReadableStub so .pipe(writer) works
          const stream = new ReadableStub();
          const chunkSize = 64 * 1024;
          let emitted = false;
          const emitChunks = () => {
            if (emitted) return;
            emitted = true;
            try {
              for (let i = 0; i < bytes.length; i += chunkSize) {
                stream.emit('data', bytes.subarray(i, Math.min(i + chunkSize, bytes.length)));
              }
            } catch (e: any) {
              stream.emit('error', e instanceof Error ? e : new Error(String(e ?? 'streaming failed')));
            } finally {
              stream.emit('end');
              stream.emit('close');
            }
          };

          const originalPipe = stream.pipe.bind(stream);
          stream.pipe = (dest: any) => {
            // Deterministic pipe path for binary downloads: write all chunks and end destination.
            // This avoids timing differences between browser-like streams and Node streams.
            const defer = typeof queueMicrotask === 'function'
              ? queueMicrotask
              : (fn: () => void) => Promise.resolve().then(fn);
            defer(() => {
              try {
                if (dest && typeof dest.write === 'function') {
                  for (let i = 0; i < bytes.length; i += chunkSize) {
                    dest.write(bytes.subarray(i, Math.min(i + chunkSize, bytes.length)));
                  }
                }
                if (dest && typeof dest.end === 'function') {
                  dest.end();
                }
              } catch (e: any) {
                const err = e instanceof Error ? e : new Error(String(e ?? 'pipe failed'));
                try { dest?.emit?.('error', err); } catch {}
                stream.emit('error', err);
              } finally {
                emitChunks();
              }
            });
            return dest ?? originalPipe(dest);
          };

          setTimeout(emitChunks, 0);
          return { data: stream, status: 200, headers: {} };
        }
        // JSON / text responses: use fetch (no binary data, CORS is fine for APIs)
        const fetchHeaders: Record<string, string> = config?.headers || {};
        let response: Response;
        try {
          response = await fetch(url, { headers: fetchHeaders });
        } catch (e: any) {
          const err: any = new Error(e?.message || 'Network error');
          err.isAxiosError = true;
          throw err;
        }
        if (!response.ok) {
          const err: any = new Error(`Request failed with status code ${response.status}`);
          err.isAxiosError = true;
          err.response = { status: response.status, data: null, headers: {} };
          throw err;
        }
        const resHeaders: Record<string, string> = {};
        response.headers.forEach((v, k) => { resHeaders[k] = v; });
        if (responseType === 'blob') {
          return { data: await response.blob(), status: response.status, headers: resHeaders };
        }
        const text = await response.text();
        let data: any = text;
        try { data = JSON.parse(text); } catch {}
        return { data, status: response.status, headers: resHeaders };
      };
      inst.post = async (url: string, body?: any, config?: any) => {
        const res = await fetch(url, {
          method: 'POST',
          body: body != null ? JSON.stringify(body) : undefined,
          headers: { 'Content-Type': 'application/json', ...(config?.headers || {}) },
        });
        const text = await res.text();
        let data: any = text;
        try { data = JSON.parse(text); } catch {}
        return { data, status: res.status };
      };
      inst.put = inst.patch = inst.delete = inst.head = inst.options = inst.post;
      inst.create = (cfg?: any) => makeAxios({ ...inst.defaults, ...cfg });
      inst.isAxiosError = (e: any) => !!(e?.isAxiosError);
      inst.CancelToken = { source: () => ({ token: {}, cancel: noop }) };
      inst.all = Promise.all.bind(Promise);
      inst.spread = (fn: Function) => (arr: any[]) => fn(...arr);
      return inst;
    };
    const axiosInstance = makeAxios();
    axiosInstance.default = axiosInstance;
    return axiosInstance;
  })(),

  // tar: archive extraction — routes to the system `tar` binary via execCommand
  tar: {
    extract: async (options: { file: string; cwd?: string; filter?: (path: string) => boolean }) => {
      const { file, cwd } = options;
      const args = ['-xzf', file];
      if (cwd) args.push('-C', cwd);
      const result = await (window as any).electron?.execCommand?.('/usr/bin/tar', args, {});
      if (result && result.exitCode !== 0) {
        throw new Error(result.stderr || `tar extraction failed with code ${result.exitCode}`);
      }
    },
    create: noopAsync,
    list: noopAsync,
    replace: noopAsync,
    update: noopAsync,
  },

  // extract-zip: ZIP extraction (Windows path; macOS uses tar above)
  'extract-zip': async (file: string, options: { dir: string }) => {
    const result = await (window as any).electron?.execCommand?.(
      '/usr/bin/unzip', ['-o', file, '-d', options.dir], {}
    );
    if (result && result.exitCode !== 0) {
      throw new Error(result.stderr || `unzip failed with code ${result.exitCode}`);
    }
  },

  // sha256-file: callback-based SHA256 hash of a file on disk
  'sha256-file': (filePath: string, callback: (err: Error | null, hash: string | null) => void) => {
    (window as any).electron?.execCommand?.(
      '/usr/bin/openssl', ['dgst', '-sha256', '-hex', filePath], {}
    ).then((result: any) => {
      if (result?.exitCode !== 0) {
        callback(new Error(result?.stderr || 'sha256 failed'), null);
        return;
      }
      // openssl output: "SHA256(file)= <hash>\n" or "SHA2-256(file)= <hash>"
      const match = (result.stdout || '').match(/=\s*([0-9a-f]{64})/i);
      callback(null, match ? match[1] : null);
    }).catch((e: any) => callback(e, null));
  },
};

// Also map node: prefixed versions
for (const [key, val] of Object.entries({ ...nodeBuiltinStubs })) {
  if (!key.startsWith('node:')) {
    nodeBuiltinStubs[`node:${key}`] = val;
  }
}

// ─── Inject globals that extensions expect ──────────────────────────

function ensureGlobals() {
  const g = globalThis as any;
  // process — many libraries check process.env, process.platform, etc.
  if (!g.process || !g.process.version) {
    g.process = processStub;
  }
  // Buffer — critical for csv-parse, jose, human-signals, etc.
  if (!g.Buffer || !g.Buffer.isBuffer) {
    g.Buffer = BufferPolyfill;
  }
  // global — some CJS code references `global` instead of `globalThis`
  if (!g.global) {
    g.global = globalThis;
  }
  // setImmediate — Node.js global, not available in browsers
  if (!g.setImmediate) {
    g.setImmediate = (fn: Function, ...args: any[]) => setTimeout(() => fn(...args), 0);
    g.clearImmediate = clearTimeout;
  }
  // __filename / __dirname — some libraries check these
  if (!g.__filename) g.__filename = '/index.js';
  if (!g.__dirname) g.__dirname = '/';
  // queueMicrotask
  if (!g.queueMicrotask) g.queueMicrotask = (fn: Function) => Promise.resolve().then(() => fn());

  // fetch bridge — route extension HTTP(S) through main process to avoid CORS.
  // Keep native fetch for non-HTTP URLs and unsupported body types.
  if (!g.__SUPERCOMMAND_NATIVE_FETCH && typeof g.fetch === 'function') {
    g.__SUPERCOMMAND_NATIVE_FETCH = g.fetch.bind(g);
  }
  if (!g.__SUPERCOMMAND_FETCH_PATCHED) {
    const nativeFetch = g.__SUPERCOMMAND_NATIVE_FETCH;
    const isHttpUrl = (value: string) => /^https?:\/\//i.test(value);
    const toHeadersObject = (headersLike: any): Record<string, string> => {
      const out: Record<string, string> = {};
      if (!headersLike) return out;
      try {
        const normalized = new Headers(headersLike as HeadersInit);
        normalized.forEach((v, k) => {
          out[k] = v;
        });
      } catch {
        if (typeof headersLike === 'object') {
          for (const [k, v] of Object.entries(headersLike)) {
            out[k] = String(v);
          }
        }
      }
      return out;
    };
    const normalizeBody = async (body: any): Promise<string | undefined> => {
      if (body == null) return undefined;
      if (typeof body === 'string') return body;
      if (body instanceof URLSearchParams) return body.toString();
      if (body instanceof Blob) return await body.text();
      if (typeof body === 'object') return JSON.stringify(body);
      return String(body);
    };

    g.fetch = async (input: any, init?: any) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input?.url || String(input ?? '');

      // Only proxy HTTP(S) requests.
      if (!isHttpUrl(url) || !(window as any).electron?.httpRequest) {
        return typeof nativeFetch === 'function' ? nativeFetch(input, init) : fetch(input, init);
      }

      // FormData/streams are not representable via current IPC payload. Fall back.
      const requestBody = init?.body;
      if (
        requestBody instanceof FormData ||
        requestBody instanceof ReadableStream ||
        (typeof requestBody === 'object' && requestBody?.getReader)
      ) {
        return typeof nativeFetch === 'function' ? nativeFetch(input, init) : fetch(input, init);
      }

      const method = (init?.method || input?.method || 'GET').toUpperCase();
      const headers = {
        ...toHeadersObject(input?.headers),
        ...toHeadersObject(init?.headers),
      };
      const body = await normalizeBody(requestBody);

      const ipcRes = await (window as any).electron.httpRequest({
        url,
        method,
        headers,
        body,
      });

      if (!ipcRes || ipcRes.status === 0) {
        if (typeof nativeFetch === 'function') {
          try {
            return await nativeFetch(input, init);
          } catch (nativeErr: any) {
            const proxyMsg = ipcRes?.statusText || `Failed to fetch ${url}`;
            const nativeMsg = nativeErr?.message || String(nativeErr);
            throw new TypeError(`${proxyMsg}; native fetch fallback failed: ${nativeMsg}`);
          }
        }
        throw new TypeError(ipcRes?.statusText || `Failed to fetch ${url}`);
      }

      const response = new Response(ipcRes.bodyText ?? '', {
        status: ipcRes.status,
        statusText: ipcRes.statusText || '',
        headers: ipcRes.headers || {},
      });

      try {
        Object.defineProperty(response, 'url', { value: ipcRes.url || url });
      } catch {}

      return response;
    };

    g.__SUPERCOMMAND_FETCH_PATCHED = true;
  }
}

/**
 * Execute extension code and extract the default export.
 * Returns either a React component or a raw function (for no-view commands).
 *
 * The code is a CJS bundle produced by esbuild at install time.
 * It may `require()` React, @raycast/api, Node built-ins, and third-party
 * packages. All of these are intercepted by our `fakeRequire`.
 */
function loadExtensionExport(
  code: string,
  extensionPath?: string
): Function | null {
  // Make sure Node globals (process, Buffer, global) are available
  ensureGlobals();

  // Update PATH to include extension binaries
  if (extensionPath && (globalThis as any).process) {
    const systemPath = process.env.PATH || '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';
    const nodeBinPath = `${extensionPath}/node_modules/.bin`;
    const extBinPath = `${extensionPath}/bin`;
    const homeDir = (window as any).electron?.homeDir || '~';

    // Build PATH with:
    // 1. Extension's node_modules/.bin (for npm-installed binaries)
    // 2. Extension's bin directory (for custom binaries)
    // 3. Extension root (some binaries are in the root)
    // 4. System PATH
    (globalThis as any).process.env.PATH = [
      nodeBinPath,
      extBinPath,
      extensionPath,
      systemPath
    ].join(':');

    // Also set HOME for binaries that need it
    (globalThis as any).process.env.HOME = homeDir;
  }

  try {
    const moduleExports: any = {};
    const fakeModule = { exports: moduleExports };

    // Custom require that provides our shim modules.
    // This is the critical bridge between extension code and the
    // SuperCmd renderer environment. Every module an extension
    // might `require()` must be handled here.
    //
    // IMPORTANT: We track React requires to verify the same instance is always returned.
    let reactRequireCount = 0;
    const fakeRequire: any = (name: string): any => {
      // Track all requires for debugging
      if (name === 'react' || name.startsWith('react/') || name === 'react-dom') {
        reactRequireCount++;
        console.log(`[fakeRequire] #${reactRequireCount} require("${name}")`);
      }
      // ── React & friends ─────────────────────────────────────
      // CRITICAL: Extensions MUST use the same React instance as the host.
      // Using a different React instance causes "Invalid hook call" errors.
      //
      // The key insight: React's hooks work by reading from ReactCurrentDispatcher
      // which is set during render. We MUST return the exact same React module
      // that ReactDOM uses, otherwise the dispatcher won't be shared.
      switch (name) {
        case 'react': {
          // Return React directly - the exact same module the host uses
          console.log('[fakeRequire] Providing React directly');
          (globalThis as any).__SUPERCOMMAND_REACT = React;
          return React;
        }
        case 'react-dom':
        case 'react-dom/client':
          console.log('[fakeRequire] Providing ReactDOM');
          console.log('[fakeRequire] ReactDOM.createRoot:', (ReactDOM as any).createRoot);
          return ReactDOM;
        case 'react-dom/server':
          return reactDomServerStub;
        case 'react/jsx-runtime':
        case 'react/jsx-dev-runtime': {
          // Return the actual jsx-runtime to ensure JSX creates elements
          // using the same React.createElement
          console.log('[fakeRequire] Providing jsx-runtime');
          console.log('[fakeRequire] JsxRuntime.Fragment === React.Fragment:', JsxRuntime.Fragment === React.Fragment);
          console.log('[fakeRequire] JsxRuntime.Fragment === React.Fragment:', JsxRuntime.Fragment === React.Fragment);
          return JsxRuntime;
        }

        // ── Raycast API shim ────────────────────────────────────
        case '@raycast/api':
          return RaycastAPI;
        case '@raycast/utils':
          return RaycastUtils;

        // ── Native addons — must be stubbed ─────────────────────
        // re2: native C++ regex — stub with RegExp fallback
        case 're2': {
          const RE2 = class extends RegExp {
            constructor(pattern: any, flags?: string) {
              super(typeof pattern === 'string' ? pattern : pattern?.source || '', flags);
            }
          };
          return RE2;
        }
        // better-sqlite3: native database addon
        case 'better-sqlite3':
          return class Database {
            prepare() { return { run: noop, get: () => undefined, all: () => [], bind: function() { return this; } }; }
            exec() { return this; }
            pragma() { return []; }
            close() {}
            transaction(fn: any) { return fn; }
          };

        // ── Commonly used npm packages that might not be bundled ─
        case 'node-fetch':
        case 'undici': {
          const ipcFetch = async (input: any, init?: any): Promise<any> => {
            return await (globalThis as any).fetch(input, init);
          };

          if (name === 'node-fetch') {
            class AbortError extends Error {
              type = 'aborted';
              constructor(message = 'The operation was aborted.') {
                super(message);
                this.name = 'AbortError';
              }
            }
            const nodeFetch: any = async (input: any, init?: any) => {
              try {
                return await ipcFetch(input, init);
              } catch (e: any) {
                if (e?.name === 'AbortError') throw new AbortError(e?.message);
                throw e;
              }
            };
            nodeFetch.default = nodeFetch;
            nodeFetch.AbortError = AbortError;
            nodeFetch.Headers = globalThis.Headers;
            nodeFetch.Request = globalThis.Request;
            nodeFetch.Response = globalThis.Response;
            nodeFetch.FetchError = Error;
            nodeFetch.isRedirect = (code: number) => [301, 302, 303, 307, 308].includes(code);
            return nodeFetch;
          }

          // undici
          const request = async (input: any, init?: any) => {
            const response = await ipcFetch(input, init);
            const bodyText = await response.text();
            return {
              statusCode: response.status,
              headers: Object.fromEntries(response.headers?.entries?.() || []),
              body: {
                text: async () => bodyText,
                json: async () => JSON.parse(bodyText),
                arrayBuffer: async () => new TextEncoder().encode(bodyText).buffer,
              },
            };
          };
          const undici: any = {
            fetch: ipcFetch,
            request,
            Headers: globalThis.Headers,
            Request: globalThis.Request,
            Response: globalThis.Response,
            FormData: globalThis.FormData,
            Blob: BlobCompat,
            File: FileCompat,
            Dispatcher: class {},
            Agent: class {},
            ProxyAgent: class {},
            MockAgent: class {},
            setGlobalDispatcher: noop,
            getGlobalDispatcher: () => undefined,
          };
          undici.default = undici;
          return undici;
        }
        default:
          break;
      }

      // ── Node.js built-in modules ─────────────────────────────
      if (name in nodeBuiltinStubs) {
        return nodeBuiltinStubs[name];
      }

      // ── Swift native bridges (Raycast-specific) ────────────
      // Provide JS implementations for swift: imports
      if (name.startsWith('swift:')) {
        if (name.includes('color-picker')) {
          return {
            pickColor: async () => {
              try {
                const result = await window.electron.nativePickColor();
                return result;
              } catch (e) {
                console.error('Native color picker failed:', e);
                return undefined;
              }
            },
          };
        }
        // Unknown swift module — return empty
        return {};
      }

      // ── Handle deep imports (e.g. 'stream/web', 'util/types') ─
      const slashIdx = name.indexOf('/');
      if (slashIdx > 0) {
        const base = name.slice(0, slashIdx);
        const sub = name.slice(slashIdx + 1);
        const baseStub = nodeBuiltinStubs[base] || nodeBuiltinStubs[`node:${base}`];
        if (baseStub && sub in baseStub) {
          return baseStub[sub];
        }
        if (baseStub) return baseStub;
      }

      // ── Fallback: return a safe empty module with Proxy ───────
      // Instead of returning a plain {} which might crash when
      // the extension accesses methods, return a Proxy that
      // returns noop functions for any property access.
      console.warn(`Extension tried to require unknown module: "${name}"`);
      return new Proxy({}, {
        get(_target, prop) {
          if (prop === '__esModule') return true;
          if (prop === 'default') return new Proxy({}, { get: () => noop });
          if (prop === Symbol.toPrimitive) return () => '';
          if (prop === Symbol.iterator) return undefined;
          if (prop === 'then') return undefined; // Don't make it thenable
          return noop;
        },
      });
    };

    // Some CJS code does `require.resolve()`
    fakeRequire.resolve = (name: string) => name;
    fakeRequire.cache = {};
    fakeRequire.extensions = {};
    fakeRequire.main = undefined;

    // Execute the CJS bundle in a function scope.
    // We pass all the standard CJS arguments plus `process`, `Buffer`,
    // and `global` to ensure they are always in scope even when the
    // extension code references them without importing.
    const fn = new Function(
      'exports',
      'require',
      'module',
      '__filename',
      '__dirname',
      'process',
      'Buffer',
      'global',
      'globalThis',
      'setImmediate',
      'clearImmediate',
      code
    );

    fn(
      moduleExports,
      fakeRequire,
      fakeModule,
      '/extension/index.js',
      '/extension',
      processStub,
      BufferPolyfill,
      globalThis,
      globalThis,
      (cb: Function, ...args: any[]) => setTimeout(() => cb(...args), 0),
      clearTimeout,
    );

    // Get the default export
    const exported =
      fakeModule.exports.default || fakeModule.exports;

    console.log('[loadExtensionExport] Extension loaded successfully');
    console.log('[loadExtensionExport] Exported type:', typeof exported);
    console.log('[loadExtensionExport] Exported name:', exported?.name);
    console.log('[loadExtensionExport] Exported function:', exported?.toString?.().slice(0, 200));

    if (typeof exported === 'function') {
      return exported;
    }

    if (typeof exported === 'object' && exported !== null) {
      // Some extensions export an object with a default key
      console.warn('Extension exported an object, not a function. Trying to wrap it.');
      return () => exported;
    }

    console.error('Extension did not export a function. Got:', typeof exported, exported);
    return null;
  } catch (e: any) {
    console.error('Failed to load extension:', e?.message || e);
    console.error('Stack:', e?.stack);
    return null;
  }
}

/**
 * Wrapper component for "no-view" commands (async functions that
 * don't return JSX). Executes the function, shows brief feedback, then closes.
 */
const NoViewRunner: React.FC<{
  fn: Function;
  title: string;
  onClose: () => void;
  launchArguments?: Record<string, any>;
  launchContext?: Record<string, any>;
  fallbackText?: string | null;
  launchType?: 'userInitiated' | 'background';
}> = ({
  fn,
  title,
  onClose,
  launchArguments = {},
  launchContext,
  fallbackText,
  launchType = 'userInitiated',
}) => {
  const [status, setStatus] = useState<'running' | 'done' | 'error'>('running');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await fn({
          arguments: launchArguments,
          launchType,
          launchContext,
          fallbackText,
        });
        if (!cancelled) {
          setStatus('done');
          setTimeout(() => onClose(), 600);
        }
      } catch (e: any) {
        if (!cancelled) {
          setStatus('error');
          setErrorMsg(e?.message || 'Command failed');
        }
      }
    })();

    return () => { cancelled = true; };
  }, [fn, onClose, launchArguments, launchContext, fallbackText, launchType]);

  return (
    <div className="flex flex-col items-center justify-center h-full gap-3">
      {status === 'running' && (
        <>
          <div className="w-5 h-5 border-2 border-white/20 border-t-white/70 rounded-full animate-spin" />
          <p className="text-sm text-white/50">Running {title}…</p>
        </>
      )}
      {status === 'done' && (
        <p className="text-sm text-green-400/80">✓ Done</p>
      )}
      {status === 'error' && (
        <div className="text-center px-6">
          <AlertTriangle className="w-6 h-6 text-red-400/60 mx-auto mb-2" />
          <p className="text-sm text-red-400/80">{errorMsg}</p>
          <button
            onClick={onClose}
            className="mt-3 text-xs text-white/40 hover:text-white/70 transition-colors"
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
};

/**
 * Render a view command as a React component.
 */
const ViewRenderer: React.FC<{
  Component: React.FC;
  launchArguments?: Record<string, any>;
  launchContext?: Record<string, any>;
  fallbackText?: string | null;
  launchType?: 'userInitiated' | 'background';
}> = ({
  Component,
  launchArguments = {},
  launchContext,
  fallbackText,
  launchType = 'userInitiated',
}) => {
  // Simple test that hooks work here
  const [test] = useState('ok');
  console.log('[ViewRenderer] Hooks work here, rendering extension...');
  // Pass standard Raycast props: arguments (command arguments) and launchType
  return React.createElement(Component, {
    arguments: launchArguments,
    launchType,
    launchContext,
    fallbackText,
  } as any);
};

const ScopedExtensionContext: React.FC<{
  ctx: ExtensionContextType;
  children: React.ReactNode;
}> = ({ ctx, children }) => {
  // Ensure each extension subtree re-establishes its own context at render time.
  // This avoids global context races between visible and hidden extension runners.
  setExtensionContext(ctx);
  return <>{children}</>;
};

const ExtensionView: React.FC<ExtensionViewProps> = ({
  code,
  title,
  mode,
  error: buildError,
  onClose,
  extensionName = '',
  extensionDisplayName = '',
  extensionIconDataUrl = '',
  commandName = '',
  assetsPath = '',
  supportPath = '/tmp/supercommand',
  extensionPath = '',
  owner = '',
  preferences = {},
  launchArguments = {},
  launchContext,
  fallbackText,
  launchType = 'userInitiated',
}) => {
  const [error, setError] = useState<string | null>(buildError || null);
  const [navStack, setNavStack] = useState<React.ReactElement[]>([]);

  // Set extension context before loading (so getPreferenceValues etc. work)
  useEffect(() => {
    setExtensionContext({
      extensionName,
      extensionDisplayName,
      extensionIconDataUrl,
      commandName,
      assetsPath,
      supportPath,
      owner,
      preferences,
      commandMode: mode as 'view' | 'no-view' | 'menu-bar',
    });
  }, [extensionName, extensionDisplayName, extensionIconDataUrl, commandName, assetsPath, supportPath, owner, preferences, mode]);

  // Load the extension's default export (skip if there was a build error)
  const ExtExport = useMemo(() => {
    if (buildError || !code) return null;
    // Set context before loading so it's available during module execution
    setExtensionContext({
      extensionName,
      extensionDisplayName,
      extensionIconDataUrl,
      commandName,
      assetsPath,
      supportPath,
      owner,
      preferences,
      commandMode: mode as 'view' | 'no-view' | 'menu-bar',
    });
    return loadExtensionExport(code, extensionPath);
  }, [code, buildError, extensionName, extensionDisplayName, extensionIconDataUrl, commandName, assetsPath, supportPath, extensionPath, owner, preferences, mode]);

  // Is this a no-view command? Trust the mode from package.json.
  // NOTE: 'menu-bar' commands ARE React components (they use hooks),
  // so they should NOT be treated as no-view. Only 'no-view' commands
  // are simple async functions that can be called directly.
  const isNoView = mode === 'no-view';

  // Navigation context
  const push = useCallback((element: React.ReactElement) => {
    setNavStack((prev) => [...prev, element]);
  }, []);

  const pop = useCallback(() => {
    setNavStack((prev) => {
      if (prev.length > 0) return prev.slice(0, -1);
      // If stack is empty, close the extension view
      onClose();
      return prev;
    });
  }, [onClose]);

  const popToRoot = useCallback(() => {
    setNavStack([]);
  }, []);

  const navValue = useMemo(() => {
    const value = { push, pop, popToRoot };
    // Update global ref for executePrimaryAction
    setGlobalNavigation(value);
    return value;
  }, [push, pop, popToRoot]);

  // Handle Escape globally for all extensions:
  // pop when nested, otherwise close extension view.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      if (navStack.length > 0) pop();
      else onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, pop, navStack.length]);

  if (error) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-5 py-3.5 border-b border-white/[0.06]">
          <button
            onClick={onClose}
            className="text-white/40 hover:text-white/70 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <span className="text-sm text-white/70">{title}</span>
        </div>
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center">
            <AlertTriangle className="w-8 h-8 text-red-400/60 mx-auto mb-3" />
            <p className="text-sm text-red-400/80">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!ExtExport) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-5 py-3.5 border-b border-white/[0.06]">
          <button
            onClick={onClose}
            className="text-white/40 hover:text-white/70 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <span className="text-sm text-white/70">{title}</span>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-white/40">
            Failed to load extension
          </p>
        </div>
      </div>
    );
  }

  // ─── No-view command: execute the function directly ───────────
  if (isNoView) {
    const scopedCtx: ExtensionContextType = {
      extensionName,
      extensionDisplayName,
      extensionIconDataUrl,
      commandName,
      assetsPath,
      supportPath,
      owner,
      preferences,
      commandMode: mode as 'view' | 'no-view' | 'menu-bar',
    };
    return (
      <div className="flex flex-col h-full">
        <ScopedExtensionContext ctx={scopedCtx}>
          <NoViewRunner
            fn={ExtExport}
            title={title}
            onClose={onClose}
            launchArguments={launchArguments}
            launchContext={launchContext}
            fallbackText={fallbackText}
            launchType={launchType}
          />
        </ScopedExtensionContext>
      </div>
    );
  }

  // ─── View command: render as React component ──────────────────
  const currentView =
    navStack.length > 0 ? navStack[navStack.length - 1] : null;

  // Per-extension React context (safe for concurrent menu-bar extensions)
  const extInfoValue = useMemo(() => ({
    extId: `${extensionName}/${commandName}`,
    assetsPath,
    commandMode: (mode || 'view') as 'view' | 'no-view' | 'menu-bar',
    extensionDisplayName: extensionDisplayName || extensionName,
    extensionIconDataUrl: extensionIconDataUrl || '',
  }), [extensionName, extensionDisplayName, extensionIconDataUrl, commandName, assetsPath, mode]);

  const scopedCtx = useMemo<ExtensionContextType>(() => ({
    extensionName,
    extensionDisplayName,
    extensionIconDataUrl,
    commandName,
    assetsPath,
    supportPath,
    owner,
    preferences,
    commandMode: mode as 'view' | 'no-view' | 'menu-bar',
  }), [
    extensionName,
    extensionDisplayName,
    extensionIconDataUrl,
    commandName,
    assetsPath,
    supportPath,
    owner,
    preferences,
    mode,
  ]);

  return (
    <ExtensionInfoReactContext.Provider value={extInfoValue}>
      <NavigationContext.Provider value={navValue}>
        <ScopedExtensionContext ctx={scopedCtx}>
          <ExtensionErrorBoundary onError={(e) => setError(e.message)}>
            {currentView || (
              <ViewRenderer
                Component={ExtExport as React.FC}
                launchArguments={launchArguments}
                launchContext={launchContext}
                fallbackText={fallbackText}
                launchType={launchType}
              />
            )}
          </ExtensionErrorBoundary>
        </ScopedExtensionContext>
      </NavigationContext.Provider>
    </ExtensionInfoReactContext.Provider>
  );
};

export default ExtensionView;
