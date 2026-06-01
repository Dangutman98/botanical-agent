import fs from 'fs';
import path from 'path';
import { BM25, type Chunk } from './bm25';
import { getEmbedding } from './embeddings';

const CHUNKS_FILE = path.join(process.cwd(), 'lib', 'rag', 'chunks.json');

// In-memory cache for BM25 search engine
let bm25Instance: BM25 | null = null;
let lastLoadedChunksLength = -1;

function getBM25Instance(): BM25 | null {
  try {
    if (!fs.existsSync(CHUNKS_FILE)) {
      return null;
    }

    const data = fs.readFileSync(CHUNKS_FILE, 'utf-8');
    const chunks: Chunk[] = JSON.parse(data);

    if (chunks.length === 0) {
      return null;
    }

    // Only rebuild BM25 index if new chunks were added
    if (!bm25Instance || chunks.length !== lastLoadedChunksLength) {
      console.info(`[hybrid-store] Building BM25 index over ${chunks.length} chunks...`);
      bm25Instance = new BM25(chunks);
      lastLoadedChunksLength = chunks.length;
      console.info('[hybrid-store] BM25 index built successfully');
    }

    return bm25Instance;
  } catch (error) {
    console.error('[hybrid-store] Failed to load/build BM25 index:', error);
    return null;
  }
}

// Thread-safe chunk saver to cache raw texts locally during crawling
export async function saveChunkLocally(chunk: { title: string; url: string; content: string }): Promise<void> {
  try {
    const parentDir = path.dirname(CHUNKS_FILE);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    let chunks: Chunk[] = [];
    if (fs.existsSync(CHUNKS_FILE)) {
      const data = fs.readFileSync(CHUNKS_FILE, 'utf-8');
      chunks = JSON.parse(data);
    }

    const exists = chunks.some(c => c.url === chunk.url && c.title === chunk.title);
    if (!exists) {
      const id = Buffer.from(chunk.url + chunk.title).toString('base64').slice(0, 50);
      chunks.push({ id, ...chunk });
      fs.writeFileSync(CHUNKS_FILE, JSON.stringify(chunks, null, 2), 'utf-8');
      console.log(`[hybrid-store] Saved chunk locally: "${chunk.title}"`);
    }
  } catch (error) {
    console.error('[hybrid-store] Failed to save chunk locally:', error);
  }
}

// Reciprocal Rank Fusion (RRF) algorithm to blend dense & sparse lists
export function reciprocalRankFusion(
  denseResults: { title: string; url: string; content: string }[],
  sparseResults: Chunk[],
  rrfK = 30,
  denseWeight = 0.5,
  bm25Weight = 2.0
): { title: string; url: string; content: string }[] {
  const scoreMap = new Map<string, { doc: { title: string; url: string; content: string }; score: number }>();
  const getDocKey = (url: string, title: string) => `${url}::${title}`;

  // 1. Process dense (vector semantic) ranks
  denseResults.forEach((doc, index) => {
    const rank = index + 1;
    const key = getDocKey(doc.url, doc.title);
    const score = denseWeight * (1 / (rrfK + rank));
    scoreMap.set(key, { doc, score });
  });

  // 2. Process sparse (BM25 keyword) ranks
  sparseResults.forEach((doc, index) => {
    const rank = index + 1;
    const key = getDocKey(doc.url, doc.title);
    const score = bm25Weight * (1 / (rrfK + rank));

    const existing = scoreMap.get(key);
    if (existing) {
      existing.score += score;
    } else {
      scoreMap.set(key, {
        doc: { title: doc.title, url: doc.url, content: doc.content },
        score,
      });
    }
  });

  // 3. Sort by combined fusion score descending
  const fused = Array.from(scoreMap.values());
  fused.sort((a, b) => b.score - a.score);

  return fused.map(f => f.doc);
}

// Global hybrid search entry point
export async function queryHybridBotanicalKnowledge(
  userQuery: string,
  topK = 3
): Promise<{ title: string; url: string; content: string }[]> {
  console.info('[hybrid-store] Querying hybrid store for:', userQuery);

  let denseCandidates: { title: string; url: string; content: string }[] = [];
  let sparseCandidates: Chunk[] = [];

  // 1. Try Dense Semantic Search (Remote HuggingFace + Pinecone)
  try {
    const vector = await getEmbedding(userQuery, true);

    const pineconeResponse = await fetch(`https://${process.env.PINECONE_HOST}/query`, {
      method: 'POST',
      headers: {
        'Api-Key': process.env.PINECONE_API_KEY || '',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ vector, topK: 15, includeMetadata: true }),
    });

    if (pineconeResponse.ok) {
      const data = await pineconeResponse.json();
      const matches = data.matches || [];
      denseCandidates = matches.map((m: any) => ({
        title: m.metadata?.title || '',
        url: m.metadata?.url || '',
        content: m.metadata?.content || '',
      }));
    } else {
      console.warn('[hybrid-store] Pinecone query failed with status:', pineconeResponse.status);
    }
  } catch (error) {
    console.warn('[hybrid-store] Dense semantic search failed (HuggingFace/Pinecone error). Falling back to pure BM25 keyword search:', error);
  }

  // 2. Try Sparse Keyword Search (Local BM25 query)
  try {
    const bm25 = getBM25Instance();
    if (bm25) {
      sparseCandidates = bm25.search(userQuery, 15).map(res => res.chunk);
      console.info(`[hybrid-store] Local BM25 search found ${sparseCandidates.length} sparse candidates.`);
    } else {
      console.warn('[hybrid-store] BM25 cache is empty or chunks.json is missing.');
    }
  } catch (error) {
    console.error('[hybrid-store] Local BM25 search failed:', error);
  }

  // 3. Fail-safe: if both returned absolutely nothing, output warning
  if (denseCandidates.length === 0 && sparseCandidates.length === 0) {
    console.warn('[hybrid-store] Both dense and sparse search returned zero results.');
    return [];
  }

  // 4. Blend dense and sparse results using Reciprocal Rank Fusion
  const fusedResults = reciprocalRankFusion(
    denseCandidates,
    sparseCandidates,
    30,   // RRF constant k
    0.5,  // Dense weight
    2.0   // BM25 weight (Heavily prioritize exact Hebrew plant keyword matches)
  );

  console.info(`[hybrid-store] Successfully fused and returned top ${topK} results.`);
  return fusedResults.slice(0, topK);
}
