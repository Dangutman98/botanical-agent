// -----------------------------------------------------------------------------
// Paragraph/sentence-aware text chunker
// -----------------------------------------------------------------------------
// The previous chunker sliced text every N characters regardless of content,
// cutting mid-sentence and mid-word. This groups paragraphs (and, for a
// paragraph longer than the target size, sentences) into chunks that respect
// real text boundaries, only falling back to a hard character cut for a single
// "word" longer than the max size (pathological input, not real prose).
// -----------------------------------------------------------------------------

export interface ChunkOptions {
  targetSize?: number;
  maxSize?: number;
  minSize?: number;
}

const DEFAULTS: Required<ChunkOptions> = {
  targetSize: 1000,
  maxSize: 1500,
  minSize: 200,
};

// Splits on one or more blank lines (paragraph breaks).
function splitParagraphs(text: string): string[] {
  return text.split(/\n\s*\n+/).map((p) => p.trim()).filter(Boolean);
}

// Splits on sentence-ending punctuation (., !, ?, Hebrew sof-pasuk not needed) followed by
// whitespace, keeping the punctuation attached to its sentence.
function splitSentences(text: string): string[] {
  const matches = text.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g);
  return (matches || [text]).map((s) => s.trim()).filter(Boolean);
}

// Breaks a single unit (sentence or paragraph) that alone exceeds maxSize into hard
// character-boundary slices. Only reachable for pathological input with no punctuation.
function hardSplit(unit: string, maxSize: number): string[] {
  const parts: string[] = [];
  for (let i = 0; i < unit.length; i += maxSize) {
    parts.push(unit.slice(i, i + maxSize));
  }
  return parts;
}

/**
 * Groups text into chunks along paragraph and sentence boundaries. Chunks are filled
 * toward `targetSize`, never exceed `maxSize`, and a trailing chunk under `minSize` is
 * merged into the previous chunk when possible instead of shipped as a scrap.
 */
export function chunkText(text: string, options: ChunkOptions = {}): string[] {
  const { targetSize, maxSize, minSize } = { ...DEFAULTS, ...options };
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  // Flatten the document into an ordered list of units no larger than maxSize:
  // paragraphs when they fit, else their sentences, else hard character slices.
  const units: string[] = [];
  for (const paragraph of splitParagraphs(normalized)) {
    if (paragraph.length <= maxSize) {
      units.push(paragraph);
      continue;
    }
    for (const sentence of splitSentences(paragraph)) {
      if (sentence.length <= maxSize) {
        units.push(sentence);
      } else {
        units.push(...hardSplit(sentence, maxSize));
      }
    }
  }

  // Fill each chunk by appending units (each already <= maxSize on its own) until the
  // running chunk reaches targetSize or the next unit would push it past maxSize.
  const chunks: string[] = [];
  let current = '';
  for (const unit of units) {
    if (!current) {
      current = unit;
      continue;
    }
    const candidate = `${current}\n\n${unit}`;
    if (candidate.length <= maxSize && current.length < targetSize) {
      current = candidate;
    } else {
      chunks.push(current);
      current = unit;
    }
  }
  if (current) chunks.push(current);

  // Merge a too-small trailing chunk into its predecessor rather than shipping a scrap,
  // as long as the merge still fits under maxSize.
  if (chunks.length > 1) {
    const last = chunks[chunks.length - 1];
    if (last.length < minSize) {
      const merged = `${chunks[chunks.length - 2]}\n\n${last}`;
      if (merged.length <= maxSize) {
        chunks.splice(chunks.length - 2, 2, merged);
      }
    }
  }

  return chunks.filter((c) => c.length >= Math.min(minSize, normalized.length));
}
