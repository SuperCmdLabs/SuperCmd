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
// Raycast extensions run in Node.js; we run them in the renderer.
// Provide lightweight stubs so the code doesn't crash on import.

const noop = () => {};
const noopAsync = () => Promise.resolve();
const noopCb = (...args: any[]) => {
  const cb = args[args.length - 1];
  if (typeof cb === 'function') cb(null);
};

const fsStub = {
  existsSync: () => false,
  readFileSync: () => '',
  writeFileSync: noop,
  mkdirSync: noop,
  readdirSync: () => [],
  statSync: () => ({ isFile: () => false, isDirectory: () => false, mtime: new Date() }),
  unlinkSync: noop,
  rmdirSync: noop,
  rmSync: noop,
  readFile: noopCb,
  writeFile: noopCb,
  mkdir: noopCb,
  access: noopCb,
  promises: {
    readFile: noopAsync,
    writeFile: noopAsync,
    mkdir: noopAsync,
    readdir: () => Promise.resolve([]),
    stat: () => Promise.resolve({ isFile: () => false, isDirectory: () => false }),
    access: noopAsync,
    unlink: noopAsync,
    rm: noopAsync,
  },
};

const pathStub = {
  join: (...parts: string[]) => parts.filter(Boolean).join('/'),
  resolve: (...parts: string[]) => parts.filter(Boolean).join('/'),
  dirname: (p: string) => p.split('/').slice(0, -1).join('/'),
  basename: (p: string, ext?: string) => {
    const base = p.split('/').pop() || '';
    return ext && base.endsWith(ext) ? base.slice(0, -ext.length) : base;
  },
  extname: (p: string) => { const m = p.match(/\.[^./]+$/); return m ? m[0] : ''; },
  sep: '/',
  parse: (p: string) => ({ dir: '', root: '', base: p, name: p, ext: '' }),
  isAbsolute: (p: string) => p.startsWith('/'),
  normalize: (p: string) => p,
  relative: () => '',
};

const osStub = {
  homedir: () => '/tmp',
  tmpdir: () => '/tmp',
  platform: () => 'darwin',
  type: () => 'Darwin',
  hostname: () => 'localhost',
  cpus: () => [],
  totalmem: () => 0,
  freemem: () => 0,
  EOL: '\n',
};

const cryptoStub = {
  randomUUID: () => crypto.randomUUID?.() || Math.random().toString(36).slice(2),
  createHash: () => ({
    update: () => ({ digest: () => Math.random().toString(36).slice(2) }),
  }),
  randomBytes: (n: number) => new Uint8Array(n),
};

const eventsStub = {
  EventEmitter: class EventEmitter {
    on() { return this; }
    off() { return this; }
    once() { return this; }
    emit() { return false; }
    addListener() { return this; }
    removeListener() { return this; }
    removeAllListeners() { return this; }
  },
  default: undefined as any,
};
eventsStub.default = eventsStub.EventEmitter;

const childProcessStub = {
  exec: noopCb,
  execSync: () => Buffer.from(''),
  spawn: () => ({
    on: noop, stdout: { on: noop }, stderr: { on: noop }, kill: noop,
  }),
};

const timersPromisesStub = {
  setTimeout: (ms: number) => new Promise((r) => setTimeout(r, ms)),
  setInterval: noop,
  setImmediate: () => Promise.resolve(),
};

const bufferStub = {
  Buffer: {
    from: (s: any) => (typeof s === 'string' ? new TextEncoder().encode(s) : new Uint8Array()),
    alloc: (n: number) => new Uint8Array(n),
    isBuffer: () => false,
    concat: () => new Uint8Array(),
  },
};

const utilStub = {
  promisify: (fn: any) => fn,
  format: (...args: any[]) => args.join(' '),
  inspect: (o: any) => JSON.stringify(o),
  TextDecoder,
  TextEncoder,
};

const nodeBuiltinStubs: Record<string, any> = {
  fs: fsStub,
  'fs/promises': fsStub.promises,
  path: pathStub,
  os: osStub,
  crypto: cryptoStub,
  events: eventsStub,
  child_process: childProcessStub,
  timers: { setTimeout: globalThis.setTimeout, setInterval: globalThis.setInterval, clearTimeout: globalThis.clearTimeout, clearInterval: globalThis.clearInterval },
  'timers/promises': timersPromisesStub,
  buffer: bufferStub,
  util: utilStub,
  stream: { Readable: class {}, Writable: class {}, Transform: class {}, PassThrough: class {} },
  'stream/promises': {},
  url: { URL: globalThis.URL, URLSearchParams: globalThis.URLSearchParams, parse: (u: string) => new URL(u) },
  querystring: { parse: (s: string) => Object.fromEntries(new URLSearchParams(s)), stringify: (o: any) => new URLSearchParams(o).toString() },
  http: { request: noop, get: noop },
  https: { request: noop, get: noop },
  assert: (v: any) => { if (!v) throw new Error('Assertion failed'); },
  net: {},
  tls: {},
  dns: {},
  dgram: {},
  cluster: {},
  tty: { isatty: () => false },
  v8: {},
  vm: {},
  worker_threads: {},
  zlib: {},
  module: { createRequire: () => () => ({}) },
  readline: {},
  perf_hooks: { performance: globalThis.performance },
  string_decoder: { StringDecoder: class { write(b: any) { return String(b); } end() { return ''; } } },
  process: { env: {}, cwd: () => '/', platform: 'darwin', version: 'v18.0.0', argv: [], exit: noop, on: noop, nextTick: (fn: () => void) => Promise.resolve().then(fn) },
};

// Also map node: prefixed versions
for (const [key, val] of Object.entries({ ...nodeBuiltinStubs })) {
  nodeBuiltinStubs[`node:${key}`] = val;
}

// ─── Inject globals that extensions expect ──────────────────────────

function ensureGlobals() {
  if (!(globalThis as any).process) {
    (globalThis as any).process = nodeBuiltinStubs.process;
  }
  if (!(globalThis as any).Buffer) {
    (globalThis as any).Buffer = bufferStub.Buffer;
  }
  if (!(globalThis as any).global) {
    (globalThis as any).global = globalThis;
  }
}

/**
 * Execute extension code and extract the default export.
 * Returns either a React component or a raw function (for no-view commands).
 */
function loadExtensionExport(
  code: string
): Function | null {
  // Make sure Node globals are available
  ensureGlobals();

  try {
    const moduleExports: any = {};
    const fakeModule = { exports: moduleExports };

    // Custom require that provides our shim modules
    const fakeRequire = (name: string): any => {
      switch (name) {
        case 'react':
          return React;
        case 'react-dom':
        case 'react-dom/client':
          return ReactDOM;
        case 'react/jsx-runtime':
          return ReactJsxRuntime;
        case '@raycast/api':
          return RaycastAPI;
        case '@raycast/utils':
          return RaycastUtils;
        // re2 is a native C++ regex addon — provide a stub that falls back to RegExp
        case 're2':
          return class RE2 extends RegExp {
            constructor(pattern: string, flags?: string) { super(pattern, flags); }
          };
        default:
          // Check Node.js built-in stubs
          if (name in nodeBuiltinStubs) {
            return nodeBuiltinStubs[name];
          }
          // Return an empty module for unknown deps
          console.warn(
            `Extension tried to require unknown module: "${name}"`
          );
          return {};
      }
    };

    // Execute the CJS bundle in a function scope
    const fn = new Function(
      'exports',
      'require',
      'module',
      '__filename',
      '__dirname',
      code
    );

    fn(moduleExports, fakeRequire, fakeModule, '', '');

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
