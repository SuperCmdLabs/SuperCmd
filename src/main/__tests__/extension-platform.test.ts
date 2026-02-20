import { describe, expect, it } from 'vitest';
import {
  getManifestPlatforms,
  isCommandPlatformCompatible,
  isManifestPlatformCompatible,
} from '../extension-platform';

describe('extension-platform', () => {
  it('normalizes and deduplicates manifest platforms', () => {
    const platforms = getManifestPlatforms({
      platforms: ['mac', 'darwin', 'linux', 'LINUX', 'win32', 'windows', 'unknown'],
    });

    expect(platforms.sort()).toEqual(['Linux', 'Windows', 'macOS'].sort());
  });

  it('treats missing/invalid manifest platforms as compatible', () => {
    expect(isManifestPlatformCompatible({})).toBe(true);
    expect(isManifestPlatformCompatible({ platforms: 'macOS' })).toBe(true);
  });

  it('checks command compatibility based on explicit platforms', () => {
    expect(isCommandPlatformCompatible(null)).toBe(false);
    expect(isCommandPlatformCompatible({})).toBe(true);

    const isCompatible = isCommandPlatformCompatible({ platforms: ['linux', 'win32', 'darwin'] });
    expect(typeof isCompatible).toBe('boolean');
  });
});
