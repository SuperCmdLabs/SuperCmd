import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

/**
 * In packaged apps, dist/native/ lives in app.asar.unpacked (see
 * asarUnpack in package.json) because child_process.spawn is not
 * asar-aware. Swap the path before handing to spawn.
 */
export function resolvePackagedUnpackedPath(candidatePath: string): string {
  if (!app.isPackaged) return candidatePath;
  if (!candidatePath.includes('app.asar')) return candidatePath;
  const unpackedPath = candidatePath.replace('app.asar', 'app.asar.unpacked');
  try {
    if (fs.existsSync(unpackedPath)) {
      return unpackedPath;
    }
  } catch {}
  return candidatePath;
}

export function getNativeBinaryPath(name: string): string {
  const base = path.join(__dirname, '..', 'native', name);
  return resolvePackagedUnpackedPath(base);
}
