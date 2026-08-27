import { describe, it, expect } from 'vitest';
import { reciprocalRankFusion } from './hybrid-store';
import type { Chunk } from './bm25';

function doc(url: string, title: string) {
  return { title, url, content: 'content' };
}

function chunk(url: string, title: string): Chunk {
  return { id: url, title, url, content: 'content' };
}

describe('reciprocalRankFusion', () => {
  it('ranks a document appearing in both lists above one appearing in only one', () => {
    const dense = [doc('https://a.com', 'A'), doc('https://b.com', 'B')];
    const sparse = [chunk('https://b.com', 'B'), chunk('https://c.com', 'C')];
    const fused = reciprocalRankFusion(dense, sparse);
    expect(fused[0].url).toBe('https://b.com'); // appears in both -> combined score wins
  });

  it('returns documents from a list even when the other list is empty', () => {
    const fused = reciprocalRankFusion([doc('https://a.com', 'A')], []);
    expect(fused.map((d) => d.url)).toEqual(['https://a.com']);
  });

  it('returns an empty array when both inputs are empty', () => {
    expect(reciprocalRankFusion([], [])).toEqual([]);
  });

  it('respects rank order within a single source: earlier rank scores higher', () => {
    const dense = [doc('https://first.com', 'First'), doc('https://second.com', 'Second')];
    const fused = reciprocalRankFusion(dense, []);
    expect(fused[0].url).toBe('https://first.com');
    expect(fused[1].url).toBe('https://second.com');
  });

  it('a higher bm25Weight lets a sparse-only result outrank a lower-ranked dense-only result', () => {
    const dense = [doc('https://dense-weak.com', 'Weak dense hit, ranked last'), doc('https://dense-strong.com', 'Strong dense hit')];
    const sparse = [chunk('https://sparse-strong.com', 'Strong sparse hit')];
    const fused = reciprocalRankFusion(dense, sparse, 30, 0.1, 10);
    // With bm25Weight cranked way up relative to denseWeight, the sparse-only result
    // should beat the weaker (second-ranked) dense-only result.
    const sparseIdx = fused.findIndex((d) => d.url === 'https://sparse-strong.com');
    const weakDenseIdx = fused.findIndex((d) => d.url === 'https://dense-weak.com');
    expect(sparseIdx).toBeLessThan(weakDenseIdx);
  });
});
