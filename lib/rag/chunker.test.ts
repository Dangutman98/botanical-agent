import { describe, it, expect } from 'vitest';
import { chunkText } from './chunker';

describe('chunkText', () => {
  it('returns an empty array for empty/whitespace input', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('   \n\n  ')).toEqual([]);
  });

  it('returns the whole text as one chunk when it fits under targetSize', () => {
    const text = 'פסקה קצרה אחת בעברית.';
    expect(chunkText(text)).toEqual([text]);
  });

  it('never splits in the middle of a sentence', () => {
    const sentences = Array.from({ length: 30 }, (_, i) => `זהו משפט מספר ${i} שמכיל כמה מילים כדי לתפוח את האורך.`);
    const text = sentences.join(' ');
    const chunks = chunkText(text, { targetSize: 300, maxSize: 400, minSize: 50 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      // Every chunk must end at a sentence boundary (a '.') or be the final chunk.
      expect(chunk.trim().endsWith('.')).toBe(true);
    }
    // No sentence's text should have been torn in half: rejoining chunks must
    // reproduce every original sentence intact.
    const rejoined = chunks.join(' ');
    for (const s of sentences) {
      expect(rejoined).toContain(s);
    }
  });

  it('never produces a chunk longer than maxSize', () => {
    const paragraphs = Array.from({ length: 10 }, (_, i) =>
      `פסקה ${i}: ${'מילה '.repeat(80)}`
    );
    const text = paragraphs.join('\n\n');
    const chunks = chunkText(text, { targetSize: 500, maxSize: 700, minSize: 100 });
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(700);
    }
  });

  it('hard-splits a single pathological unit with no sentence punctuation', () => {
    const text = 'א'.repeat(5000); // one giant "word", no punctuation anywhere
    const chunks = chunkText(text, { targetSize: 1000, maxSize: 1500, minSize: 200 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(1500);
    }
    expect(chunks.join('')).toBe(text);
  });

  it('drops chunks shorter than minSize when the source itself is longer', () => {
    const longText = 'משפט ראשון עם תוכן ממשי. '.repeat(50) + 'קצר.';
    const chunks = chunkText(longText, { targetSize: 300, maxSize: 400, minSize: 50 });
    for (const chunk of chunks) {
      expect(chunk.length).toBeGreaterThanOrEqual(50);
    }
  });

  it('keeps very short standalone input instead of discarding everything', () => {
    const shortText = 'קצר.';
    expect(chunkText(shortText, { minSize: 200 })).toEqual([shortText]);
  });
});
