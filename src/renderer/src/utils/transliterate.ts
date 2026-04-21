/**
 * transliterate.ts
 *
 * Cross-script search utilities. Converts non-Latin input to an approximate
 * Latin form so users can search English-named commands from any script/keyboard.
 *
 * Examples:
 *   "кальк" (Cyrillic) → "calc"   → matches "Calculator"
 *   "कैलकुलेटर" (Devanagari) → "calculetr" → fuzzy-matches "Calculator"
 *   "计算器" (CJK) → "JiSuanQi"  → pinyin matching in List/Grid items
 */

import anyAscii from 'any-ascii';

const NORM_REGEX = /[^\p{L}\p{N}]+/gu;

function containsNonLatinChars(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 127) return true;
  }
  return false;
}

// Apply phonetic normalization to a transliterated Latin string.
// Only called on anyAscii() output — never on raw English input.
function phoneticallyNormalize(text: string): string {
  return (
    text
      .replace(/['''ʼ`]/g, '') // strip transliteration apostrophes (e.g. Cyrillic soft-sign "kal'k" → "kalk")
      .replace(/ai/g, 'a') // Hindi ै/ai diphthong → a (kail → kal)
      .replace(/ei/g, 'e') // ei diphthong → e
      .replace(/ou/g, 'o') // ou diphthong → o
      .replace(/au/g, 'o') // au diphthong → o
      .replace(/ph/g, 'f') // ph → f
      .replace(/q/g, 'k') // q ≡ k
      .replace(/k/g, 'c') // k ≡ c (core phonetic equivalence: Cyrillic к/к → c)
  );
}

function normalizeForSearch(text: string): string {
  return text.normalize('NFKD').toLowerCase().replace(NORM_REGEX, ' ').trim();
}

/**
 * Returns the transliterated+phonetically-normalized form of a search query
 * when the original contains non-Latin characters.
 *
 * Called by filterCommands to add a second scoring pass for cross-script search.
 */
export function getTranslitVariant(
  originalQuery: string,
  normalizedQuery: string,
): { query: string; isVariant: boolean } {
  if (!containsNonLatinChars(originalQuery)) {
    return { query: normalizedQuery, isVariant: false };
  }
  const transliterated = anyAscii(originalQuery);
  const phonetized = phoneticallyNormalize(transliterated);
  const normalized = normalizeForSearch(phonetized);
  return {
    query: normalized,
    isVariant: normalized.length > 0 && normalized !== normalizedQuery,
  };
}

/**
 * Transliterates non-Latin text to a searchable Latin form.
 * Used in List/Grid item filtering for bidirectional script matching.
 * Returns input unchanged if it's already Latin.
 */
export function transliterateForSearch(text: string): string {
  if (!text || !containsNonLatinChars(text)) return text.toLowerCase();
  const transliterated = anyAscii(text);
  const phonetized = phoneticallyNormalize(transliterated);
  return normalizeForSearch(phonetized);
}
