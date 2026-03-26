/**
 * Builds the Excalidraw bundle for SuperCmd Canvas.
 *
 * React/ReactDOM are externalized — the host renderer MUST set
 * window.React and window.ReactDOM before this script loads.
 */

import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync, existsSync, readdirSync, cpSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, 'dist');

mkdirSync(distDir, { recursive: true });

console.log('[canvas-app] Building Excalidraw bundle...');

await esbuild.build({
  entryPoints: [join(__dirname, 'entry.js')],
  bundle: true,
  format: 'iife',
  outfile: join(distDir, 'excalidraw-bundle.js'),
  minify: true,
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  plugins: [{
    name: 'externalize-react',
    setup(build) {
      // Catch ALL react-related imports
      build.onResolve({ filter: /^react(-dom)?(\/.*)?$/ }, (args) => ({
        path: args.path,
        namespace: 'ext-react',
      }));

      build.onLoad({ filter: /.*/, namespace: 'ext-react' }, (args) => {
        const p = args.path;

        // react-dom/client -> window.ReactDOM
        if (p === 'react-dom' || p === 'react-dom/client' || p.startsWith('react-dom/')) {
          return { contents: 'module.exports = window.ReactDOM;', loader: 'js' };
        }

        // react/jsx-runtime and react/jsx-dev-runtime
        if (p === 'react/jsx-runtime' || p === 'react/jsx-dev-runtime') {
          return {
            contents: `
              var React = window.React;
              function jsx(type, props, key) {
                var newProps = {};
                var children = props.children;
                for (var k in props) {
                  if (k !== 'children') newProps[k] = props[k];
                }
                if (key !== undefined) newProps.key = key;
                if (children !== undefined) {
                  if (Array.isArray(children)) {
                    return React.createElement.apply(React, [type, newProps].concat(children));
                  }
                  return React.createElement(type, newProps, children);
                }
                return React.createElement(type, newProps);
              }
              module.exports = {
                jsx: jsx,
                jsxs: jsx,
                jsxDEV: jsx,
                Fragment: React.Fragment,
              };
            `,
            loader: 'js',
          };
        }

        // react -> window.React
        return { contents: 'module.exports = window.React;', loader: 'js' };
      });
    },
  }],
  loader: {
    '.woff2': 'dataurl',
    '.woff': 'dataurl',
    '.ttf': 'dataurl',
    '.png': 'dataurl',
    '.svg': 'dataurl',
  },
});

// Copy CSS if it exists separately
const excalidrawPkgDir = join(__dirname, 'node_modules', '@excalidraw', 'excalidraw', 'dist');
if (existsSync(excalidrawPkgDir)) {
  const cssFiles = readdirSync(excalidrawPkgDir).filter(f => f.endsWith('.css'));
  for (const cssFile of cssFiles) {
    copyFileSync(join(excalidrawPkgDir, cssFile), join(distDir, 'excalidraw-bundle.css'));
    console.log(`[canvas-app] Copied CSS: ${cssFile}`);
    break;
  }
}

console.log('[canvas-app] Build complete → dist/');
