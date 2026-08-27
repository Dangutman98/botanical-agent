// -----------------------------------------------------------------------------
// Hebrew token normalization
// -----------------------------------------------------------------------------
// The BM25 tokenizer previously did plain lowercase + word-splitting, so
// "כורכום", "לכורכום" (to-turmeric), "וכורכום" (and-turmeric), and "כורכומין"
// (curcumin) were four unrelated terms with zero overlap. Hebrew attaches
// single-letter prefixes (ו/ה/ב/ל/מ/ש/כ — "and/the/in/to/from/that/as") and
// common suffixes (ים/ות plural) directly onto words with no separator, which
// a Latin-script tokenizer has no equivalent of.
//
// This is a light, conservative stemmer, not a real morphological analyzer:
// it strips at most one leading prefix letter and one trailing plural suffix,
// only when the remainder is long enough to plausibly still be a word, and
// does so without a dictionary. Two known, accepted false-positive classes:
//   1. A genuine short word that happens to start with a prefix letter gets
//      mangled (e.g. "הוא" — "he" — is a complete word, not ה + "וא").
//   2. A bare word whose OWN first letter is one of the 7 prefix letters
//      (ו/ב/כ/ל/מ/ש/ה) gets that letter stripped just like a real prefix
//      would — e.g. "כורכום" (turmeric) itself starts with כ, so the bare
//      word and an inflected form like "לכורכום" don't converge to the same
//      stem. Exact repeated forms still match fine; only some cross-inflection
//      matches don't. See the test file for both classes made explicit.
// -----------------------------------------------------------------------------

const NIQQUD_RANGE = /[֑-ׇ]/g;
const PREFIX_LETTERS = new Set(['ו', 'ב', 'כ', 'ל', 'מ', 'ש', 'ה']);
const MIN_STEM_LENGTH = 2;

/** Strips Hebrew niqqud (vowel points) and cantillation marks. */
export function stripNiqqud(text: string): string {
  return text.replace(NIQQUD_RANGE, '');
}

function isHebrewLetter(ch: string): boolean {
  return ch >= 'א' && ch <= 'ת';
}

function isAllHebrew(token: string): boolean {
  return token.length > 0 && [...token].every(isHebrewLetter);
}

/**
 * Normalizes a single already-lowercased token: strips niqqud, then at most one
 * leading single-letter prefix and one trailing plural suffix, each only when
 * doing so leaves a stem of at least MIN_STEM_LENGTH. Non-Hebrew tokens (English,
 * numbers, mixed) are returned unchanged.
 */
export function normalizeHebrewToken(token: string): string {
  const original = stripNiqqud(token);
  if (!isAllHebrew(original)) return original;

  let stem = original;

  if (PREFIX_LETTERS.has(stem[0]) && stem.length - 1 >= MIN_STEM_LENGTH) {
    stem = stem.slice(1);
  }

  if ((stem.endsWith('ים') || stem.endsWith('ות')) && stem.length - 2 >= MIN_STEM_LENGTH) {
    stem = stem.slice(0, -2);
  }

  return stem.length >= MIN_STEM_LENGTH ? stem : original;
}
