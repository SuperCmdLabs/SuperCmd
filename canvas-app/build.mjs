/**
 * Builds the Excalidraw UMD bundle for SuperCmd Canvas.
 *
 * Output: dist/
 *   - excalidraw-bundle.js   (UMD, React/ReactDOM externalized as globals)
 *   - excalidraw-bundle.css  (Excalidraw styles)
 *
 * React and ReactDOM are NOT included — the host renderer provides them
 * via window.React and window.ReactDOM.
 */

import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync, existsSync, readdirSync, cpSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, 'dist');

// Ensure dist directory exists
mkdirSync(distDir, { recursive: true });

console.log('[canvas-app] Building Excalidraw bundle...');

// Build the JS bundle
await esbuild.build({
  entryPoints: [join(__dirname, 'entry.js')],
  bundle: true,
  format: 'iife',
  globalName: 'ExcalidrawBundle',
  outfile: join(distDir, 'excalidraw-bundle.js'),
  minify: true,
  external: [],
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  // Externalize React — the host provides it via window globals
  plugins: [{
    name: 'externalize-react',
    setup(build) {
      build.onResolve({ filter: /^react$/ }, () => ({
        path: 'react',
        namespace: 'external-react',
      }));
      build.onResolve({ filter: /^react-dom$|^react-dom\/client$/ }, () => ({
        path: 'react-dom',
        namespace: 'external-react',
      }));
      build.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({
        path: 'react/jsx-runtime',
        namespace: 'external-react',
      }));
      build.onLoad({ filter: /.*/, namespace: 'external-react' }, (args) => {
        if (args.path === 'react' || args.path === 'react/jsx-runtime') {
          return {
            contents: 'module.exports = window.React;',
            loader: 'js',
          };
        }
        return {
          contents: 'module.exports = window.ReactDOM;',
          loader: 'js',
        };
      });
    },
  }],
  loader: {
    '.woff2': 'file',
    '.woff': 'file',
    '.ttf': 'file',
    '.png': 'file',
    '.svg': 'file',
  },
  assetNames: 'assets/[name]-[hash]',
});

// Copy Excalidraw CSS if it exists as a separate file
const excalidrawPkgDir = join(__dirname, 'node_modules', '@excalidraw', 'excalidraw', 'dist');
if (existsSync(excalidrawPkgDir)) {
  const cssFiles = readdirSync(excalidrawPkgDir).filter(f => f.endsWith('.css'));
  for (const cssFile of cssFiles) {
    copyFileSync(join(excalidrawPkgDir, cssFile), join(distDir, 'excalidraw-bundle.css'));
    console.log(`[canvas-app] Copied CSS: ${cssFile}`);
    break; // Only need the first/main CSS file
  }

  // Copy fonts directory if it exists
  const fontsDir = join(excalidrawPkgDir, 'fonts');
  if (existsSync(fontsDir)) {
    const destFontsDir = join(distDir, 'fonts');
    mkdirSync(destFontsDir, { recursive: true });
    cpSync(fontsDir, destFontsDir, { recursive: true });
    console.log('[canvas-app] Copied fonts directory');
  }
}

console.log('[canvas-app] Build complete → dist/');
