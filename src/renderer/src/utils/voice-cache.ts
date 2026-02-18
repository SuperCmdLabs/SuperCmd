/**
 * Shared cache for ElevenLabs voices
 * Used by both Settings (AITab) and Speak widget (useSpeakManager)
 */

import type { ElevenLabsVoice } from '../../types/electron';

interface CacheEntry {
  voices: ElevenLabsVoice[];
  timestamp: number;
}

let cache: CacheEntry | null = null;

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export function getCachedElevenLabsVoices(): ElevenLabsVoice[] | null {
  if (!cache) return null;
  const now = Date.now();
  if (now - cache.timestamp > CACHE_TTL) {
    cache = null;
    return null;
  }
  return cache.voices;
}

export function setCachedElevenLabsVoices(voices: ElevenLabsVoice[]): void {
  cache = {
    voices,
    timestamp: Date.now(),
  };
}

export function clearElevenLabsVoiceCache(): void {
  cache = null;
}
