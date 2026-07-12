// Import a TypeScript/TSX module from a test by bundling it with esbuild on the
// fly. Bundling lets tests execute selected production modules that have local
// imports instead of falling back to grep-only assertions.

import { build } from 'esbuild';
import path from 'node:path';

let importNonce = 0;

const DEFAULT_STUB_MODULES = new Set([
  '@phosphor-icons/react',
  '@raycast/api',
  'electron',
  'electron-liquid-glass',
  'lucide-react',
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-dev-runtime',
  'react/jsx-runtime',
]);

const ASSET_RE = /\.(?:css|less|sass|scss|svg|png|jpe?g|gif|webp|ico|icns|woff2?|ttf|otf|eot)$/i;

export async function importTs(absPath, options = {}) {
  const resolvedPath = path.resolve(absPath);
  const { code } = await bundleTs(resolvedPath, options);
  const dataUrl = [
    'data:text/javascript;base64,',
    Buffer.from(code).toString('base64'),
    `#${encodeURIComponent(resolvedPath)}-${importNonce++}`,
  ].join('');
  return import(dataUrl);
}

export async function bundleTs(absPath, options = {}) {
  const result = await build({
    absWorkingDir: options.root || process.cwd(),
    entryPoints: [path.resolve(absPath)],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: options.target || 'node20',
    sourcemap: options.sourcemap || false,
    logLevel: 'silent',
    banner: options.browserGlobals === false ? undefined : { js: BROWSER_GLOBALS_BANNER },
    define: {
      'process.env.NODE_ENV': '"test"',
      ...(options.define || {}),
    },
    loader: {
      '.js': 'js',
      '.jsx': 'jsx',
      '.ts': 'ts',
      '.tsx': 'tsx',
      '.json': 'json',
      ...(options.loader || {}),
    },
    external: options.external || [],
    plugins: [
      tsImportStubPlugin(options),
      ...(options.plugins || []),
    ],
  });

  return { code: result.outputFiles[0].text };
}

function tsImportStubPlugin(options) {
  const stubModules = new Set([...DEFAULT_STUB_MODULES, ...Object.keys(options.stubs || {})]);
  for (const specifier of options.stubModules || []) stubModules.add(specifier);

  return {
    name: 'ts-import-test-stubs',
    setup(esbuild) {
      esbuild.onResolve({ filter: /.*/ }, (args) => {
        if (stubModules.has(args.path) || ASSET_RE.test(args.path)) {
          return { path: args.path, namespace: 'ts-import-stub' };
        }
        return null;
      });

      esbuild.onLoad({ filter: /.*/, namespace: 'ts-import-stub' }, (args) => ({
        contents: options.stubs?.[args.path] || defaultStubFor(args.path),
        loader: 'js',
      }));
    },
  };
}

function defaultStubFor(specifier) {
  if (specifier === 'electron') return ELECTRON_STUB;
  if (specifier === 'react') return REACT_STUB;
  if (specifier === 'react/jsx-runtime' || specifier === 'react/jsx-dev-runtime') return JSX_RUNTIME_STUB;
  if (specifier === 'react-dom' || specifier === 'react-dom/client') return REACT_DOM_STUB;
  if (ASSET_RE.test(specifier)) return ASSET_STUB;
  return GENERIC_PROXY_STUB;
}

const BROWSER_GLOBALS_BANNER = `
const __scNoop = () => {};
const __scMakeStorage = () => {
  const map = new Map();
  return {
    getItem: (key) => map.has(String(key)) ? map.get(String(key)) : null,
    setItem: (key, value) => { map.set(String(key), String(value)); },
    removeItem: (key) => { map.delete(String(key)); },
    clear: () => { map.clear(); },
  };
};
var document = globalThis.document || {
  addEventListener: __scNoop,
  removeEventListener: __scNoop,
  createElement: () => ({ style: {}, setAttribute: __scNoop, appendChild: __scNoop, remove: __scNoop }),
  body: { appendChild: __scNoop, removeChild: __scNoop },
};
var navigator = globalThis.navigator || { platform: 'test', userAgent: 'node' };
var localStorage = globalThis.localStorage || __scMakeStorage();
var sessionStorage = globalThis.sessionStorage || __scMakeStorage();
var window = globalThis.window || {
  document,
  navigator,
  localStorage,
  sessionStorage,
  addEventListener: __scNoop,
  removeEventListener: __scNoop,
  dispatchEvent: () => true,
  electron: {},
  location: { href: 'about:blank', reload: __scNoop },
};
var requestAnimationFrame = globalThis.requestAnimationFrame || ((callback) => setTimeout(() => callback(Date.now()), 0));
var cancelAnimationFrame = globalThis.cancelAnimationFrame || ((id) => clearTimeout(id));
`;

const ELECTRON_STUB = `
const noop = () => {};
const asyncNoop = async () => undefined;
const home = process.env.HOME || process.cwd();
const paths = {
  appData: process.cwd(),
  desktop: home + '/Desktop',
  documents: home + '/Documents',
  downloads: home + '/Downloads',
  home,
  temp: process.env.TMPDIR || process.cwd(),
  userData: process.env.SUPERCMD_TEST_USER_DATA || process.cwd(),
};
const app = {
  isPackaged: false,
  getAppPath: () => process.cwd(),
  getName: () => 'SuperCmd Test',
  getPath: (name) => paths[name] || process.cwd(),
  getVersion: () => '0.0.0-test',
  isReady: () => true,
  whenReady: asyncNoop,
  on: noop,
  once: noop,
  quit: noop,
  relaunch: noop,
  requestSingleInstanceLock: () => true,
  setAsDefaultProtocolClient: () => true,
};
class BrowserWindow {
  constructor() {
    this.webContents = {
      executeJavaScript: asyncNoop,
      on: noop,
      once: noop,
      send: noop,
      setWindowOpenHandler: noop,
    };
  }
  loadFile() { return Promise.resolve(); }
  loadURL() { return Promise.resolve(); }
  on() {}
  once() {}
  show() {}
  hide() {}
  close() {}
  destroy() {}
  isDestroyed() { return false; }
}
const ipcMain = { handle: noop, on: noop, once: noop, removeAllListeners: noop, removeHandler: noop };
const ipcRenderer = { invoke: asyncNoop, send: noop, on: noop, once: noop, removeAllListeners: noop, removeListener: noop };
const shell = { openExternal: asyncNoop, openPath: async () => '', showItemInFolder: noop };
const dialog = {
  showErrorBox: noop,
  showMessageBox: async () => ({ response: 0 }),
  showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
  showSaveDialog: async () => ({ canceled: true, filePath: '' }),
};
const clipboard = {
  readText: () => '',
  writeText: noop,
  readImage: () => ({ isEmpty: () => true, toDataURL: () => '' }),
  writeImage: noop,
};
const nativeTheme = { shouldUseDarkColors: false, on: noop, removeListener: noop };
const screen = {
  getAllDisplays: () => [],
  getPrimaryDisplay: () => ({ bounds: { x: 0, y: 0, width: 1024, height: 768 }, workArea: { x: 0, y: 0, width: 1024, height: 768 }, scaleFactor: 1 }),
};
const safeStorage = {
  decryptString: (value) => Buffer.from(value).toString('utf8'),
  encryptString: (value) => Buffer.from(String(value)),
  isEncryptionAvailable: () => false,
};
module.exports = { app, BrowserWindow, clipboard, dialog, ipcMain, ipcRenderer, nativeTheme, safeStorage, screen, shell };
`;

const REACT_STUB = `
const noop = () => {};
const createElement = (type, props, ...children) => ({ type, props: { ...(props || {}), children } });
class Component {
  constructor(props) {
    this.props = props || {};
    this.state = {};
  }
  setState(update) {
    this.state = { ...this.state, ...(typeof update === 'function' ? update(this.state, this.props) : update) };
  }
}
const createContext = (value) => ({
  Consumer: ({ children }) => typeof children === 'function' ? children(value) : children,
  Provider: ({ children }) => children,
  _currentValue: value,
});
const React = {
  Component,
  PureComponent: Component,
  Fragment: Symbol.for('react.fragment'),
  createContext,
  createElement,
  createRef: () => ({ current: null }),
  forwardRef: (render) => render,
  lazy: (loader) => loader,
  memo: (component) => component,
  startTransition: (callback) => callback(),
  useCallback: (callback) => callback,
  useContext: (context) => context?._currentValue,
  useEffect: noop,
  useId: () => 'test-id',
  useLayoutEffect: noop,
  useMemo: (factory) => factory(),
  useReducer: (reducer, initialArg, init) => [init ? init(initialArg) : initialArg, noop],
  useRef: (value) => ({ current: value }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, noop],
};
module.exports = React;
module.exports.default = React;
module.exports.__esModule = true;
`;

const JSX_RUNTIME_STUB = `
const Fragment = Symbol.for('react.fragment');
const jsx = (type, props, key) => ({ type, key, props: props || {} });
module.exports = { Fragment, jsx, jsxs: jsx };
module.exports.default = module.exports;
module.exports.__esModule = true;
`;

const REACT_DOM_STUB = `
const root = { render() {}, unmount() {} };
module.exports = {
  createPortal: (children) => children,
  createRoot: () => root,
  hydrateRoot: () => root,
  render() {},
  unmountComponentAtNode() {},
};
module.exports.default = module.exports;
module.exports.__esModule = true;
`;

const ASSET_STUB = `
module.exports = '';
module.exports.default = '';
`;

const GENERIC_PROXY_STUB = `
const makeStub = (name = 'stub') => new Proxy(function stub() {}, {
  apply: () => undefined,
  construct: () => ({}),
  get: (_target, prop) => {
    if (prop === '__esModule') return true;
    if (prop === Symbol.toStringTag) return 'Module';
    return makeStub(String(prop));
  },
});
module.exports = makeStub();
module.exports.default = module.exports;
`;
