/**
 * Shared cache for ElevenLabs voices
 * Used by both Settings (AITab) and Speak widget (useSpeakManager)
 * Persisted to localStorage to survive window closes
 */

import type { ElevenLabsVoice } from '../../types/electron';

const CACHE_KEY = 'supercmd-elevenlabs-voices-cache';
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

interface CacheEntry {
  voices: ElevenLabsVoice[];
  timestamp: number;
}

function loadFromStorage(): CacheEntry | null {
  try {
    const stored = localStorage.getItem(CACHE_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as CacheEntry;
    // Validate structure
    if (!parsed.voices || !Array.isArray(parsed.voices) || typeof parsed.timestamp !== 'number') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function saveToStorage(entry: CacheEntry): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    // Ignore storage errors (e.g., quota exceeded)
  }
}

export function getCachedElevenLabsVoices(): ElevenLabsVoice[] | null {
  const cached = loadFromStorage();
  if (!cached) return null;

  const now = Date.now();
  if (now - cached.timestamp > CACHE_TTL) {
    // Cache expired, clear it
    try {
      localStorage.removeItem(CACHE_KEY);
    } catch {}
    return null;
  }

  // Do not treat empty lists as a stable cache hit. Empty caches can come from
  // transient network/auth failures and should trigger a fresh fetch next time.
  if (!Array.isArray(cached.voices) || cached.voices.length === 0) {
    try {
      localStorage.removeItem(CACHE_KEY);
    } catch {}
    return null;
  }

  return cached.voices;
}

export function setCachedElevenLabsVoices(voices: ElevenLabsVoice[]): void {
  if (!Array.isArray(voices) || voices.length === 0) {
    clearElevenLabsVoiceCache();
    return;
  }
  const entry: CacheEntry = {
    voices,
    timestamp: Date.now(),
  };
  saveToStorage(entry);
}

export function clearElevenLabsVoiceCache(): void {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {}
}
