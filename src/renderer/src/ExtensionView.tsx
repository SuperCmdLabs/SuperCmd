/**
 * Extension View
 *
 * Dynamically loads and renders a community extension's UI
 * inside the SuperCommand overlay.
 *
 * The extension code (built to CJS by esbuild) is executed with a
 * custom `require()` that provides React and our @raycast/api shim.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import ReactDOM from 'react-dom';
import * as ReactJsxRuntime from 'react/jsx-runtime';
import { ArrowLeft, AlertTriangle } from 'lucide-react';
import * as RaycastAPI from './raycast-api';
import { NavigationContext } from './raycast-api';

// Also import @raycast/utils stubs from our shim
import * as RaycastUtils from './raycast-api';

interface ExtensionViewProps {
  code: string;
  title: string;
  mode: string;
  error?: string; // build-time error from main process
  onClose: () => void;
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

  componentDidCatch(error: Error) {
    this.props.onError(error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-white/50 p-8">
          <AlertTriangle className="w-8 h-8 text-red-400/60 mb-3" />
          <p className="text-sm text-red-400/80 font-medium mb-1">
            Extension Error
          </p>
          <p className="text-xs text-white/30 text-center max-w-sm">
            {this.state.error.message}
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Node.js built-in stubs ─────────────────────────────────────────
// Raycast extensions run in a full Node.js environment inside Raycast.
// In SuperCommand, extensions run in the renderer (browser context).
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
  [_bufferMarker] = true;

  // Allow new Buffer(string), new Buffer(number), new Buffer(array)
  constructor(arg: any, encodingOrOffset?: any, length?: number) {
    if (typeof arg === 'string') {
      const bytes = new TextEncoder().encode(arg);
      super(bytes);
    } else if (typeof arg === 'number') {
      super(arg);
    } else if (arg instanceof ArrayBuffer) {
      if (typeof encodingOrOffset === 'number') {
        super(arg, encodingOrOffset, length);
      } else {
        super(arg);
      }
    } else if (ArrayBuffer.isView(arg)) {
      super(arg.buffer, arg.byteOffset, arg.byteLength);
    } else if (Array.isArray(arg)) {
      super(arg);
    } else {
      super(0);
    }
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

// ── fs stub ─────────────────────────────────────────────────────
const fakeStatResult = {
  isFile: () => false,
  isDirectory: () => false,
  isSymbolicLink: () => false,
  isBlockDevice: () => false,
  isCharacterDevice: () => false,
  isFIFO: () => false,
  isSocket: () => false,
  size: 0,
  mtime: new Date(0),
  atime: new Date(0),
  ctime: new Date(0),
  birthtime: new Date(0),
  mode: 0,
  uid: 0,
  gid: 0,
  dev: 0,
  ino: 0,
  nlink: 0,
};

const fsStub: Record<string, any> = {
  existsSync: () => false,
  readFileSync: (_p: string, _opts?: any) => '',
  writeFileSync: noop,
  mkdirSync: noop,
  readdirSync: () => [],
  statSync: () => ({ ...fakeStatResult }),
  lstatSync: () => ({ ...fakeStatResult }),
  unlinkSync: noop,
  rmdirSync: noop,
  rmSync: noop,
  renameSync: noop,
  copyFileSync: noop,
  chmodSync: noop,
  accessSync: noop,
  openSync: () => 0,
  closeSync: noop,
  readSync: () => 0,
  writeSync: () => 0,
  createReadStream: () => {
    const s = new (nodeBuiltinStubs?.stream?.Readable || class {})();
    setTimeout(() => s.emit?.('end'), 0);
    return s;
  },
  createWriteStream: () => new (nodeBuiltinStubs?.stream?.Writable || class {})(),
  readFile: noopCb,
  writeFile: noopCb,
  mkdir: noopCb,
  access: noopCb,
  stat: noopCb,
  lstat: noopCb,
  readdir: (...args: any[]) => {
    const cb = args[args.length - 1];
    if (typeof cb === 'function') cb(null, []);
  },
  unlink: noopCb,
  rename: noopCb,
  watch: () => ({ close: noop, on: noop }),
  watchFile: noop,
  unwatchFile: noop,
  constants: { F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1 },
  promises: {
    readFile: noopAsync,
    writeFile: noopAsync,
    mkdir: noopAsync,
    readdir: () => Promise.resolve([]),
    stat: () => Promise.resolve({ ...fakeStatResult }),
    lstat: () => Promise.resolve({ ...fakeStatResult }),
    access: noopAsync,
    unlink: noopAsync,
    rm: noopAsync,
    rename: noopAsync,
    copyFile: noopAsync,
    chmod: noopAsync,
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

// ── os stub (with constants.signals and constants.errno) ────────
const osStub: Record<string, any> = {
  homedir: () => '/tmp',
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
  userInfo: () => ({ username: 'user', uid: 501, gid: 20, shell: '/bin/zsh', homedir: '/tmp' }),
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
  randomBytes: (n: number) => BufferPolyfill.alloc(n),
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

const eventsStub = {
  EventEmitter: EventEmitterStub,
  default: EventEmitterStub,
  once: async (emitter: any, event: string) => new Promise(resolve => emitter.once(event, resolve)),
};

// ── stream stubs ────────────────────────────────────────────────
class ReadableStub extends EventEmitterStub {
  readable = true;
  readableEnded = false;
  destroyed = false;
  read() { return null; }
  pipe(dest: any) { return dest; }
  unpipe() { return this; }
  pause() { return this; }
  resume() { return this; }
  destroy() { this.destroyed = true; this.emit('close'); return this; }
  push(_chunk: any) { return true; }
  unshift(_chunk: any) {}
  setEncoding() { return this; }
  [Symbol.asyncIterator]() {
    return { next: async () => ({ done: true, value: undefined }) };
  }
  static from(iterable: any) {
    const s = new ReadableStub();
    setTimeout(() => { s.emit('end'); }, 0);
    return s;
  }
}

class WritableStub extends EventEmitterStub {
  writable = true;
  writableEnded = false;
  destroyed = false;
  write(_chunk: any, _enc?: any, cb?: Function) { if (typeof cb === 'function') cb(); else if (typeof _enc === 'function') _enc(); return true; }
  end(_chunk?: any, _enc?: any, cb?: Function) {
    this.writableEnded = true;
    const callback = typeof cb === 'function' ? cb : typeof _enc === 'function' ? _enc : typeof _chunk === 'function' ? _chunk : null;
    if (callback) (callback as Function)();
    this.emit('finish');
    return this;
  }
  destroy() { this.destroyed = true; this.emit('close'); return this; }
  cork() {}
  uncork() {}
  setDefaultEncoding() { return this; }
}

class TransformStub extends ReadableStub {
  writable = true;
  write(_chunk: any, _enc?: any, cb?: Function) { if (typeof cb === 'function') cb(); return true; }
  end(_chunk?: any, _enc?: any, cb?: Function) {
    const callback = typeof cb === 'function' ? cb : typeof _enc === 'function' ? _enc : typeof _chunk === 'function' ? _chunk : null;
    if (callback) (callback as Function)();
    this.emit('finish');
    this.emit('end');
    return this;
  }
  _transform(chunk: any, enc: any, cb: Function) { cb(null, chunk); }
  _flush(cb: Function) { cb(); }
}

class PassThroughStub extends TransformStub {}

class DuplexStub extends TransformStub {}

const streamStub = {
  Readable: ReadableStub,
  Writable: WritableStub,
  Transform: TransformStub,
  PassThrough: PassThroughStub,
  Duplex: DuplexStub,
  Stream: ReadableStub,
  pipeline: (...args: any[]) => {
    const cb = args[args.length - 1];
    if (typeof cb === 'function') setTimeout(() => cb(null), 0);
    return args[args.length - 2] || new PassThroughStub();
  },
  finished: (stream: any, cb: Function) => { if (typeof cb === 'function') setTimeout(() => cb(null), 0); },
};

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
  exec: (...args: any[]) => {
    const cb = args[args.length - 1];
    if (typeof cb === 'function') setTimeout(() => cb(null, '', ''), 0);
    return { ...fakeChildProcess };
  },
  execSync: () => BufferPolyfill.from(''),
  execFile: (...args: any[]) => {
    const cb = args[args.length - 1];
    if (typeof cb === 'function') setTimeout(() => cb(null, '', ''), 0);
    return { ...fakeChildProcess };
  },
  execFileSync: () => BufferPolyfill.from(''),
  spawn: () => {
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
    setTimeout(() => { cp.emit('close', 0, null); }, 0);
    return cp;
  },
  spawnSync: () => ({
    pid: 0,
    output: [null, BufferPolyfill.from(''), BufferPolyfill.from('')],
    stdout: BufferPolyfill.from(''),
    stderr: BufferPolyfill.from(''),
    status: 0,
    signal: null,
    error: undefined,
  }),
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
const utilStub: Record<string, any> = {
  promisify: (fn: any) => (...args: any[]) => new Promise((resolve, reject) => {
    fn(...args, (err: any, result: any) => err ? reject(err) : resolve(result));
  }),
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
    isTypedArray: (v: any) => ArrayBuffer.isView(v) && !(v instanceof DataView),
  },
  TextDecoder,
  TextEncoder,
  isDeepStrictEqual: (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b),
};

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
  title: 'supercommand',
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
  buffer: { Buffer: BufferPolyfill, SlowBuffer: BufferPolyfill, kMaxLength: 2 ** 31 - 1, INSPECT_MAX_BYTES: 50, constants: { MAX_LENGTH: 2 ** 31 - 1, MAX_STRING_LENGTH: 2 ** 28 - 16 } },
  util: utilStub,
  stream: streamStub,
  'stream/promises': {
    pipeline: async (...args: any[]) => {},
    finished: async (stream: any) => {},
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
    parse: (s: string) => Object.fromEntries(new URLSearchParams(s)),
    stringify: (o: any) => new URLSearchParams(o).toString(),
    encode: (o: any) => new URLSearchParams(o).toString(),
    decode: (s: string) => Object.fromEntries(new URLSearchParams(s)),
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
    Socket: class extends EventEmitterStub {
      connect() { return this; }
      write() { return true; }
      end() { return this; }
      destroy() { return this; }
      setEncoding() { return this; }
      setTimeout() { return this; }
      setNoDelay() { return this; }
      setKeepAlive() { return this; }
      ref() { return this; }
      unref() { return this; }
      address() { return {}; }
    },
    createServer: () => ({ listen: noop, close: noop, on: noop, address: () => ({}) }),
    createConnection: () => new EventEmitterStub(),
    isIP: (s: string) => /^\d+\.\d+\.\d+\.\d+$/.test(s) ? 4 : 0,
    isIPv4: (s: string) => /^\d+\.\d+\.\d+\.\d+$/.test(s),
    isIPv6: () => false,
  },
  tls: { connect: () => new EventEmitterStub(), createServer: () => ({ listen: noop, close: noop, on: noop }) },
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
  async_hooks: { createHook: () => ({ enable: noop, disable: noop }), executionAsyncId: () => 0, triggerAsyncId: () => 0, AsyncLocalStorage: class { run(store: any, fn: Function, ...args: any[]) { return fn(...args); } getStore() { return undefined; } } },
  diagnostics_channel: { channel: () => ({ subscribe: noop, unsubscribe: noop, publish: noop }), hasSubscribers: () => false },
  'node:test': { describe: noop, it: noop, test: noop },
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
  code: string
): Function | null {
  // Make sure Node globals (process, Buffer, global) are available
  ensureGlobals();

  try {
    const moduleExports: any = {};
    const fakeModule = { exports: moduleExports };

    // Custom require that provides our shim modules.
    // This is the critical bridge between extension code and the
    // SuperCommand renderer environment. Every module an extension
    // might `require()` must be handled here.
    const fakeRequire: any = (name: string): any => {
      // ── React & friends ─────────────────────────────────────
      switch (name) {
        case 'react':
          return React;
        case 'react-dom':
        case 'react-dom/client':
          return ReactDOM;
        case 'react-dom/server':
          return reactDomServerStub;
        case 'react/jsx-runtime':
        case 'react/jsx-dev-runtime':
          return ReactJsxRuntime;

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
        default:
          break;
      }

      // ── Node.js built-in modules ─────────────────────────────
      if (name in nodeBuiltinStubs) {
        return nodeBuiltinStubs[name];
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
}> = ({ fn, title, onClose }) => {
  const [status, setStatus] = useState<'running' | 'done' | 'error'>('running');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await fn();
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
  }, [fn, onClose]);

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
 * We trust the `mode` from package.json to determine if it's a view or no-view command.
 * Never call the component function outside React's render cycle — doing so
 * corrupts hook state (e.g. jotai's useAtom) and causes React internal errors.
 */
const ViewRenderer: React.FC<{ Component: React.FC }> = ({ Component }) => {
  return <Component />;
};

const ExtensionView: React.FC<ExtensionViewProps> = ({
  code,
  title,
  mode,
  error: buildError,
  onClose,
}) => {
  const [error, setError] = useState<string | null>(buildError || null);
  const [navStack, setNavStack] = useState<React.ReactElement[]>([]);

  // Load the extension's default export (skip if there was a build error)
  const ExtExport = useMemo(() => {
    if (buildError || !code) return null;
    return loadExtensionExport(code);
  }, [code, buildError]);

  // Is this a no-view command? Trust the mode from package.json.
  const isNoView = mode === 'no-view' || mode === 'menu-bar';

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

  const navValue = useMemo(() => ({ push, pop }), [push, pop]);

  // Handle Escape when no navigation stack
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Only handle if no input is focused (the List component handles its own Escape)
      if (
        e.key === 'Escape' &&
        navStack.length === 0 &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, navStack.length]);

  if (error) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.06]">
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
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.06]">
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
    return (
      <div className="flex flex-col h-full">
        <NoViewRunner fn={ExtExport} title={title} onClose={onClose} />
      </div>
    );
  }

  // ─── View command: render as React component ──────────────────
  const currentView =
    navStack.length > 0 ? navStack[navStack.length - 1] : null;

  return (
    <NavigationContext.Provider value={navValue}>
      <ExtensionErrorBoundary onError={(e) => setError(e.message)}>
        {currentView || (
          <ViewRenderer Component={ExtExport as React.FC} />
        )}
      </ExtensionErrorBoundary>
    </NavigationContext.Provider>
  );
};

export default ExtensionView;
