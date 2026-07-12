import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// SECURITY: The renderer must run with `nodeIntegration: false` and
// `sandbox: true`. Node APIs are exposed exclusively through a preload
// script + contextBridge, and privileged operations go through an
// allowlisted IPC channel set. Do NOT re-enable nodeIntegration or
// disable the sandbox — see SECURITY.md for the full threat model.

export default defineConfig({
  plugins: [react()],
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

