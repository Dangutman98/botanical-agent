import { describe, it, expect } from 'vitest';
import { BM25, type Chunk } from './bm25';

function chunk(id: string, title: string, content: string): Chunk {
  return { id, title, url: `https://example.com/${id}`, content };
}

describe('BM25', () => {
  it('returns no results for an empty index', () => {
    const bm25 = new BM25([]);
    expect(bm25.search('anything')).toEqual([]);
  });

  it('finds an exact keyword match and ranks it above unrelated documents', () => {
    const bm25 = new BM25([
      chunk('a', 'Curcumin', 'This article discusses turmeric and curcumin extensively.'),
      chunk('b', 'Unrelated', 'This article is about something else entirely.'),
    ]);
    const results = bm25.search('curcumin');
    expect(results.length).toBe(1);
    expect(results[0].chunk.id).toBe('a');
  });

  it('matches a Hebrew document via a prefixed inflected query term (the normalization fix)', () => {
    const bm25 = new BM25([
      chunk('a', 'צמח מרפא', 'מאמר על צמח שימושי לבריאות.'),
    ]);
    // "וצמח" (and-plant) should match a document containing bare "צמח" after normalization —
    // this was impossible before the Hebrew prefix/suffix stripping was wired in.
    const results = bm25.search('וצמח');
    expect(results.length).toBe(1);
    expect(results[0].chunk.id).toBe('a');
  });

  it('respects topK', () => {
    const chunks = Array.from({ length: 10 }, (_, i) => chunk(`c${i}`, 'Turmeric', 'turmeric turmeric turmeric'));
    const bm25 = new BM25(chunks);
    expect(bm25.search('turmeric', 3).length).toBe(3);
  });

  it('rebuilding with build() replaces the previous index entirely', () => {
    const bm25 = new BM25([chunk('a', 'Old', 'old content about ginger')]);
    expect(bm25.search('ginger').length).toBe(1);
    bm25.build([chunk('b', 'New', 'new content about turmeric')]);
    expect(bm25.search('ginger').length).toBe(0);
    expect(bm25.search('turmeric').length).toBe(1);
  });
});
