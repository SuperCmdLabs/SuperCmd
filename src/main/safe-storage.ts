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
 *
 * IMPORTANT: encrypted entries we cannot decrypt in this session (e.g.
 * encryption temporarily unavailable, or a single corrupt blob) are
 * preserved verbatim through writes. Without this, a single failed
 * decrypt would mean a later setSecret/deleteSecret would clobber
 * unrelated secrets when the vault file was rewritten.
 */

import { app, safeStorage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

const VAULT_FILENAME = 'safe-storage.json';
const ENCRYPTED_PREFIX = 'enc:';

// Decrypted/plaintext entries we own and can re-write.
let decryptedCache: Record<string, string> | null = null;
// Raw on-disk entries we couldn't read (or chose not to read because
// encryption was unavailable). These are passed through writes verbatim
// so we never destroy a user's secrets we just couldn't open right now.
let unknownRawCache: Record<string, string> | null = null;

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

function loadVault(): void {
  if (decryptedCache && unknownRawCache) return;
  const decrypted: Record<string, string> = {};
  const unknownRaw: Record<string, string> = {};
  try {
    const raw = fs.readFileSync(getVaultPath(), 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      const canDecrypt = isEncryptionAvailable();
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof value !== 'string' || !value) continue;
        if (value.startsWith(ENCRYPTED_PREFIX)) {
          if (!canDecrypt) {
            unknownRaw[key] = value;
            continue;
          }
          try {
            const buf = Buffer.from(value.slice(ENCRYPTED_PREFIX.length), 'base64');
            decrypted[key] = safeStorage.decryptString(buf);
          } catch (e) {
            console.warn(`safe-storage: failed to decrypt key "${key}", preserving raw blob:`, e);
            unknownRaw[key] = value;
          }
        } else {
          decrypted[key] = value;
        }
      }
    }
  } catch {
    // vault file doesn't exist yet — first run, that's fine
  }
  decryptedCache = decrypted;
  unknownRawCache = unknownRaw;
}

function persistVault(): boolean {
  loadVault();
  const canEncrypt = isEncryptionAvailable();
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(decryptedCache!)) {
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
  // Preserve unreadable encrypted entries verbatim so we don't destroy them
  // by rewriting the file from a partial cache.
  for (const [key, raw] of Object.entries(unknownRawCache!)) {
    if (key in out) continue;
    out[key] = raw;
  }
  try {
    fs.writeFileSync(getVaultPath(), JSON.stringify(out, null, 2), { mode: 0o600 });
    return true;
  } catch (e) {
    console.error('safe-storage: failed to write vault:', e);
    return false;
  }
}

export function getSecret(key: string): string {
  loadVault();
  return decryptedCache![key] || '';
}

/**
 * Persist a secret to the vault. Returns `true` only when the on-disk
 * vault file is successfully written. Callers performing destructive
 * follow-ups (e.g. redacting plaintext from settings.json) MUST check
 * this return value first.
 *
 * Setting an empty value is treated as a delete.
 */
export function setSecret(key: string, value: string): boolean {
  loadVault();
  const next = String(value ?? '');
  if (!next) {
    let changed = false;
    if (decryptedCache![key] !== undefined) {
      delete decryptedCache![key];
      changed = true;
    }
    if (unknownRawCache![key] !== undefined) {
      delete unknownRawCache![key];
      changed = true;
    }
    if (!changed) return true;
    return persistVault();
  }
  if (decryptedCache![key] === next && unknownRawCache![key] === undefined) return true;
  decryptedCache![key] = next;
  delete unknownRawCache![key];
  return persistVault();
}

export function deleteSecret(key: string): boolean {
  loadVault();
  let changed = false;
  if (decryptedCache![key] !== undefined) {
    delete decryptedCache![key];
    changed = true;
  }
  if (unknownRawCache![key] !== undefined) {
    delete unknownRawCache![key];
    changed = true;
  }
  if (!changed) return true;
  return persistVault();
}

export function hasSecret(key: string): boolean {
  loadVault();
  const value = decryptedCache![key];
  return typeof value === 'string' && value.length > 0;
}

export function isSafeStorageAvailable(): boolean {
  return isEncryptionAvailable();
}

export function resetVaultCache(): void {
  decryptedCache = null;
  unknownRawCache = null;
}
