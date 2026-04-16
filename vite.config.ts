import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';

const DEV_URL_FILE = path.join(__dirname, 'dist', '.vite-dev-url');

function writeDevUrlPlugin(): Plugin {
  return {
    name: 'supercmd-write-dev-url',
    configureServer(server) {
      try {
        fs.rmSync(DEV_URL_FILE, { force: true });
      } catch {}
      server.httpServer?.once('listening', () => {
        const address = server.httpServer?.address();
        if (address && typeof address === 'object') {
          const url = `http://localhost:${address.port}`;
          fs.mkdirSync(path.dirname(DEV_URL_FILE), { recursive: true });
          fs.writeFileSync(DEV_URL_FILE, url);
          console.log(`[supercmd] Dev URL written: ${url}`);
        }
      });
      const cleanup = () => {
        try { fs.rmSync(DEV_URL_FILE, { force: true }); } catch {}
      };
      process.once('exit', cleanup);
      process.once('SIGINT', cleanup);
      process.once('SIGTERM', cleanup);
    },
  };
}

// The launcher window runs with `nodeIntegration: true` + `sandbox: false`
// so that installed Raycast extensions (curated from the Raycast store) can
// import real `node:*` built-ins — fs, crypto, child_process, stream, etc. —
// at runtime via Electron's require. We mark those built-ins as rollup
// externals so Vite doesn't try to polyfill them into the browser bundle;
// they resolve at runtime instead.
//
// Launcher source code itself doesn't import Node built-ins, so this is
// primarily hygiene: if an extension or dynamically-evaluated module ever
// slips through Vite's pipeline, we want real Node to win, not a polyfill.
const NODE_BUILTIN_EXTERNALS: Array<string | RegExp> = [
  /^node:/,
  'fs', 'fs/promises',
  'path', 'path/posix', 'path/win32',
  'os', 'crypto',
  'child_process', 'events',
  'stream', 'stream/web', 'stream/promises', 'stream/consumers',
  'util', 'util/types', 'buffer',
  'http', 'https', 'net', 'tls',
  'dns', 'dns/promises',
  'url', 'querystring', 'zlib',
  'assert', 'assert/strict',
  'timers', 'timers/promises',
  'module', 'readline', 'readline/promises',
  'perf_hooks', 'string_decoder', 'process',
  'constants', 'punycode', 'async_hooks', 'diagnostics_channel',
  'worker_threads', 'vm', 'v8', 'inspector', 'tty', 'dgram', 'cluster',
  'trace_events', 'wasi',
  'electron',
];

export default defineConfig({
  plugins: [react(), writeDevUrlPlugin()],
  root: path.join(__dirname, 'src/renderer'),
  base: './',
  build: {
    outDir: path.join(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    minify: false, // Keep unminified for debugging extension errors
    rollupOptions: {
      external: NODE_BUILTIN_EXTERNALS,
    },
  },
  optimizeDeps: {
    // Don't let Vite pre-bundle Node built-ins during dev either.
    exclude: NODE_BUILTIN_EXTERNALS.filter((e): e is string => typeof e === 'string'),
  },
  server: {
    port: 5173,
  },
});
