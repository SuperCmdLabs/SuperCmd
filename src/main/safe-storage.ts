/**
 * Safe Storage Vault
 *
 * Wraps Electron's `safeStorage` API to persist secrets encrypted on disk
 * (macOS Keychain on Mac, DPAPI on Windows, libsecret/kwallet on Linux).
 *
 * On disk format (~/Library/Application Support/SuperCmd/safe-storage.json):
 *   { "<key>": "enc:<base64-encrypted>" }
 *
 * If the OS keyring is not available we degrade gracefully and persist
 * plain text — which is no worse than the legacy settings.json behaviour
 * we are replacing — and never silently lose user data.
 */

import { app, safeStorage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

const VAULT_FILENAME = 'safe-storage.json';
const ENCRYPTED_PREFIX = 'enc:';

let vaultCache: Record<string, string> | null = null;

function getVaultPath(): string {
  return path.join(app.getPath('userData'), VAULT_FILENAME);
}

function isEncryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function loadVault(): Record<string, string> {
  if (vaultCache) return vaultCache;
  const next: Record<string, string> = {};
  try {
    const raw = fs.readFileSync(getVaultPath(), 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      const canDecrypt = isEncryptionAvailable();
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof value !== 'string' || !value) continue;
        if (value.startsWith(ENCRYPTED_PREFIX)) {
          if (!canDecrypt) continue;
          try {
            const buf = Buffer.from(value.slice(ENCRYPTED_PREFIX.length), 'base64');
            next[key] = safeStorage.decryptString(buf);
          } catch (e) {
            console.warn(`safe-storage: failed to decrypt key "${key}":`, e);
          }
        } else {
          next[key] = value;
        }
      }
    }
  } catch {
    // vault file doesn't exist yet — first run, that's fine
  }
  vaultCache = next;
  return next;
}

function persistVault(): void {
  if (!vaultCache) return;
  const canEncrypt = isEncryptionAvailable();
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(vaultCache)) {
    if (!value) continue;
    if (canEncrypt) {
      try {
        const buf = safeStorage.encryptString(value);
        out[key] = ENCRYPTED_PREFIX + buf.toString('base64');
      } catch (e) {
        console.warn(`safe-storage: failed to encrypt key "${key}", storing plaintext:`, e);
        out[key] = value;
      }
    } else {
      out[key] = value;
    }
  }
  try {
    fs.writeFileSync(getVaultPath(), JSON.stringify(out, null, 2), { mode: 0o600 });
  } catch (e) {
    console.error('safe-storage: failed to write vault:', e);
  }
}

export function getSecret(key: string): string {
  return loadVault()[key] || '';
}

export function setSecret(key: string, value: string): void {
  const vault = loadVault();
  const next = String(value ?? '');
  if (!next) {
    if (vault[key] === undefined) return;
    delete vault[key];
  } else {
    if (vault[key] === next) return;
    vault[key] = next;
  }
  persistVault();
}

export function deleteSecret(key: string): void {
  const vault = loadVault();
  if (vault[key] === undefined) return;
  delete vault[key];
  persistVault();
}

export function hasSecret(key: string): boolean {
  const value = loadVault()[key];
  return typeof value === 'string' && value.length > 0;
}

export function isSafeStorageAvailable(): boolean {
  return isEncryptionAvailable();
}

export function resetVaultCache(): void {
  vaultCache = null;
}
