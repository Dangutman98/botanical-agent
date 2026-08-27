// -----------------------------------------------------------------------------
// Corpus validation gate
// -----------------------------------------------------------------------------
// Rejects the two classes of junk that silently made up 68%+ of the previous
// corpus: charset-corrupted text (replacement characters from a decoding
// mismatch) and non-article pages (search results, sitemaps, tag/category
// listings) that a crawler's URL filter let through. Applied at ingest time
// so this can't recur silently, and reused for a one-time cleanup pass over
// existing data.
// -----------------------------------------------------------------------------

const NAV_URL_PATTERNS = [
  /[?&]s=/i,           // WordPress/generic search query param
  /search\.asp/i,      // naturopedia search results
  /sitemap/i,
  /\/tag\//i,
  /\/category\//i,
  /\/page\/\d+\/?$/i,  // pagination
  /\/feed\/?$/i,
];

const NAV_TITLE_PATTERNS = [
  /^מפת אתר/, /^sitemap/i, /^הרשמה לייעוץ/, /^פודקאסטים/, /^בוראים לכם שירות/,
];

export interface ValidationResult {
  valid: boolean;
  reason?: 'corrupted' | 'too_short' | 'nav_url' | 'nav_title';
}

export interface ValidationOptions {
  minLength?: number;
  maxReplacementCharRatio?: number;
}

const DEFAULTS: Required<ValidationOptions> = {
  minLength: 200,
  maxReplacementCharRatio: 0.05,
};

function replacementCharRatio(text: string): number {
  if (!text) return 0;
  const replacementChars = (text.match(/�/g) || []).length;
  return replacementChars / text.length;
}

/**
 * Validates a single candidate chunk before it enters the corpus. Order matters:
 * corruption is checked first since a corrupted chunk is unsalvageable regardless
 * of its URL or length.
 */
export function validateChunk(
  chunk: { title: string; url: string; content: string },
  options: ValidationOptions = {}
): ValidationResult {
  const { minLength, maxReplacementCharRatio } = { ...DEFAULTS, ...options };

  if (replacementCharRatio(chunk.title) > maxReplacementCharRatio || replacementCharRatio(chunk.content) > maxReplacementCharRatio) {
    return { valid: false, reason: 'corrupted' };
  }

  if (NAV_URL_PATTERNS.some((rx) => rx.test(chunk.url))) {
    return { valid: false, reason: 'nav_url' };
  }

  if (NAV_TITLE_PATTERNS.some((rx) => rx.test(chunk.title.trim()))) {
    return { valid: false, reason: 'nav_title' };
  }

  if (chunk.content.trim().length < minLength) {
    return { valid: false, reason: 'too_short' };
  }

  return { valid: true };
}
