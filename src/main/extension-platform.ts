export type RaycastPlatform = 'macOS' | 'Windows' | 'Linux';

function normalizePlatform(value: unknown): RaycastPlatform | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;

  if (normalized === 'macos' || normalized === 'darwin' || normalized === 'mac') {
    return 'macOS';
  }
  if (normalized === 'windows' || normalized === 'win32' || normalized === 'win') {
    return 'Windows';
  }
  if (normalized === 'linux') {
    return 'Linux';
  }
  return null;
}

export function getCurrentRaycastPlatform(): RaycastPlatform {
  if (process.platform === 'win32') return 'Windows';
  if (process.platform === 'linux') return 'Linux';
  return 'macOS';
}

export function getManifestPlatforms(manifest: any): RaycastPlatform[] {
  if (!manifest || typeof manifest !== 'object') return [];
  if (!Array.isArray(manifest.platforms)) return [];

  const supported = new Set<RaycastPlatform>();
  for (const raw of manifest.platforms) {
    const normalized = normalizePlatform(raw);
    if (normalized) supported.add(normalized);
  }
  return [...supported];
}

export function isManifestPlatformCompatible(manifest: any): boolean {
  const supported = getManifestPlatforms(manifest);
  if (supported.length === 0) return true;
  return supported.includes(getCurrentRaycastPlatform());
}

export function isCommandPlatformCompatible(cmd: any): boolean {
  if (!cmd || typeof cmd !== 'object') return false;
  if (!Object.prototype.hasOwnProperty.call(cmd, 'platforms')) return true;
  return isManifestPlatformCompatible(cmd);
}
