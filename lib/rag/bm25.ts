export interface Chunk {
  id: string;
  title: string;
  url: string;
  content: string;
}

export class BM25 {
  private chunks: Chunk[] = [];
  private docLengths: number[] = [];
  private avgDocLength = 0;
  private docTermFreqs: Map<string, number>[] = []; // Map of term -> frequency for each document
  private docFreqs: Map<string, number> = new Map(); // Term -> number of documents containing it
  private k1: number;
  private b: number;

  constructor(chunks: Chunk[], k1 = 1.5, b = 0.75) {
    this.k1 = k1;
    this.b = b;
    this.build(chunks);
  }

  private tokenize(text: string): string[] {
    if (!text) return [];
    // Lowercase and extract Hebrew & English alphanumeric words
    const cleanText = text.toLowerCase();
    const matches = cleanText.match(/[\w\u0590-\u05ff]+/g);
    return matches || [];
  }

  public build(chunks: Chunk[]): void {
    this.chunks = chunks;
    this.docLengths = [];
    this.docTermFreqs = [];
    this.docFreqs.clear();

    if (chunks.length === 0) {
      this.avgDocLength = 0;
      return;
    }

    let totalLength = 0;

    for (const chunk of chunks) {
      // Index both title and content
      const tokens = this.tokenize(`${chunk.title} ${chunk.content}`);
      this.docLengths.push(tokens.length);
      totalLength += tokens.length;

      const termFreqMap = new Map<string, number>();
      for (const token of tokens) {
        termFreqMap.set(token, (termFreqMap.get(token) || 0) + 1);
      }
      this.docTermFreqs.push(termFreqMap);

      // Increment doc frequencies for unique tokens in this doc
      for (const token of termFreqMap.keys()) {
        this.docFreqs.set(token, (this.docFreqs.get(token) || 0) + 1);
      }
    }

    this.avgDocLength = totalLength / chunks.length;
  }

  private idf(term: string): number {
    const n = this.docFreqs.get(term) || 0;
    const N = this.chunks.length;
    // Standard BM25 IDF with smoothing
    return Math.log((N - n + 0.5) / (n + 0.5) + 1);
  }

  public search(query: string, topK = 15): { chunk: Chunk; score: number }[] {
    const queryTokens = this.tokenize(query);
    if (queryTokens.length === 0 || this.chunks.length === 0) {
      return [];
    }

    const scores: { chunk: Chunk; score: number }[] = [];

    for (let i = 0; i < this.chunks.length; i++) {
      const chunk = this.chunks[i];
      const docLen = this.docLengths[i];
      const termFreqMap = this.docTermFreqs[i];
      let score = 0;

      for (const token of queryTokens) {
        const f = termFreqMap.get(token) || 0;
        if (f > 0) {
          const termIdf = this.idf(token);
          const numerator = f * (this.k1 + 1);
          const denominator = f + this.k1 * (1 - this.b + this.b * (docLen / this.avgDocLength));
          score += termIdf * (numerator / denominator);
        }
      }

      if (score > 0) {
        scores.push({ chunk, score });
      }
    }

    // Sort descending by relevance score
    scores.sort((a, b) => b.score - a.score);
    return scores.slice(0, topK);
  }
}
