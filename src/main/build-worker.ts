/**
 * Build Worker — runs esbuild in a forked child process.
 *
 * Reasoning: esbuild's V8 compilation and libuv I/O (file resolution,
 * plugin execution) run inside the worker's own event loop, so they
 * cannot re-enter the Electron main process's Cocoa event loop and
 * cause the re-entrant hang pattern.
 *
 * The main process sends build options over IPC, the worker runs
 * esbuild.build(options), and sends back the result.
 */
import { builtinModules } from 'module';

function requireEsbuild(): any {
  try {
    const mainPath = require.resolve('esbuild');
    if (mainPath.includes('app.asar')) {
      const unpackedPath = mainPath.replace('app.asar', 'app.asar.unpacked');
      if (fsExistsSync(unpackedPath)) return require(unpackedPath);
    }
    return require('esbuild');
  } catch {
    return require('esbuild');
  }
}

function fsExistsSync(p: string): boolean {
  try {
    return require('fs').existsSync(p);
  } catch {
    return false;
  }
}

type BuildRequest = {
  id: number;
  type: 'build';
  options: any;
  label: string;
};

type BuildResponse =
  | { id: number; ok: true }
  | { id: number; ok: false; error: string; missingBareImports?: string[] };

function send(response: BuildResponse): void {
  try {
    if (typeof process.send === 'function') {
      process.send(response);
    }
  } catch {}
}

function extractMissingBareImports(error: any): string[] {
  const errors = Array.isArray(error?.errors) ? error.errors : [];
  const found = new Set<string>();
  const nodeBuiltins = new Set<string>(builtinModules);

  for (const err of errors) {
    const text = String(err?.text || '');
    const match = text.match(/Could not resolve\s+"([^"]+)"/);
    if (!match) continue;
    const specifier = match[1];
    if (
      !specifier ||
      specifier.startsWith('.') ||
      specifier.startsWith('/') ||
      specifier.includes(':')
    ) {
      continue;
    }
    const parts = specifier.split('/');
    const pkgName = specifier.startsWith('@')
      ? parts.slice(0, 2).join('/')
      : parts[0];
    if (!pkgName) continue;
    if (nodeBuiltins.has(pkgName)) continue;
    if (pkgName.startsWith('@raycast/')) continue;
    found.add(pkgName);
  }
  return [...found];
}

async function handleBuild(request: BuildRequest): Promise<BuildResponse> {
  try {
    const esbuild = requireEsbuild();
    await esbuild.build(request.options);
    return { id: request.id, ok: true };
  } catch (error: any) {
    const missing = extractMissingBareImports(error);
    return {
      id: request.id,
      ok: false,
      error: error?.message || String(error),
      missingBareImports: missing.length > 0 ? missing : undefined,
    };
  }
}

process.on('message', (message: any) => {
  if (!message || typeof message !== 'object') return;
  if (message.type === 'build') {
    handleBuild(message as BuildRequest).then(send);
  }
});

process.on('uncaughtException', (error) => {
  console.error('[BuildWorker] Uncaught exception:', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('[BuildWorker] Unhandled rejection:', reason);
});
