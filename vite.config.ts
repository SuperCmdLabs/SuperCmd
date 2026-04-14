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

export default defineConfig({
  plugins: [react(), writeDevUrlPlugin()],
  root: path.join(__dirname, 'src/renderer'),
  base: './',
  build: {
    outDir: path.join(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    minify: false, // Keep unminified for debugging extension errors
  },
  server: {
    port: 5173,
  },
});
