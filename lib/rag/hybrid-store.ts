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
  topK = 5,
  secondaryQuery?: string
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
      body: JSON.stringify({ vector, topK: 20, includeMetadata: true }),
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

  // 2. Try Sparse Keyword Search (Local BM25 query) — bilingual: search with both original and translated query
  try {
    const bm25 = getBM25Instance();
    if (bm25) {
      const primaryResults = bm25.search(userQuery, 20).map(res => res.chunk);
      console.info(`[hybrid-store] BM25 primary search found ${primaryResults.length} sparse candidates.`);

      if (secondaryQuery && secondaryQuery.trim() !== userQuery.trim()) {
        const secondaryResults = bm25.search(secondaryQuery, 20).map(res => res.chunk);
        console.info(`[hybrid-store] BM25 secondary (bilingual) search found ${secondaryResults.length} sparse candidates.`);

        // Merge and deduplicate: primary results first, then any unique secondary results
        const seenKeys = new Set(primaryResults.map(c => `${c.url}::${c.title}`));
        const merged = [...primaryResults];
        for (const chunk of secondaryResults) {
          const key = `${chunk.url}::${chunk.title}`;
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            merged.push(chunk);
          }
        }
        sparseCandidates = merged;
      } else {
        sparseCandidates = primaryResults;
      }
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

  // Filter out any noisy sitemap URLs from both candidate lists before fusion
  const isCleanUrl = (url: string) => !url.includes('sitemap') && !url.includes('מפת-אתר') && !url.includes('מפת_אתר');
  denseCandidates = denseCandidates.filter(c => isCleanUrl(c.url));
  sparseCandidates = sparseCandidates.filter(c => isCleanUrl(c.url));

  // 4. Blend dense and sparse results using Reciprocal Rank Fusion
  const fusedResults = reciprocalRankFusion(
    denseCandidates,
    sparseCandidates,
    30,   // RRF constant k
    1.5,  // Dense weight (multilingual semantic — works cross-language)
    1.0   // BM25 weight (keyword match — monolingual, complementary)
  );

  // 5. Diversify: limit to max 2 chunks per URL to ensure results come from
  //    different articles/plants (prevents 5 chunks from the same Bacopa article)
  const urlCounts = new Map<string, number>();
  const diverseResults: { title: string; url: string; content: string }[] = [];
  for (const doc of fusedResults) {
    const count = urlCounts.get(doc.url) || 0;
    if (count < 2) {
      diverseResults.push(doc);
      urlCounts.set(doc.url, count + 1);
      if (diverseResults.length >= topK) break;
    }
  }

  console.info(`[hybrid-store] Returning ${diverseResults.length} diverse results (from ${urlCounts.size} unique URLs).`);
  return diverseResults;
}
