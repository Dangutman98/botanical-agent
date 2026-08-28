/**
 * embed-and-upsert.ts — Batch document embedding + Pinecone upsert
 *
 * Reads lib/rag/chunks.json, generates a 384-dim embedding for every chunk
 * LOCALLY via the same Xenova/multilingual-e5-small ONNX model the query path
 * uses (identical weights to intfloat/multilingual-e5-small, so document and
 * query vectors live in the same space), then bulk-upserts them to Pinecone.
 *
 * This never touches the HuggingFace API: embedding 15k+ documents against a
 * free-tier remote quota is exactly what left the previous corpus 96% missing
 * from the vector index (496 of 12,165 chunks). Local CPU inference on this
 * small model runs at roughly 15-20 chunks/sec sequentially - a few minutes
 * for the whole corpus, no quota, no rate limit.
 *
 * Wipes the existing Pinecone index first: the old vectors' chunk IDs came
 * from a completely different (78%-corrupted) corpus and have no correspondence
 * to today's chunk IDs, so there is nothing to "update" - only stale data to
 * replace with a full rebuild (per the plan's Q33 decision).
 *
 * Run: npx tsx scripts/embed-and-upsert.ts
 * Requirements: PINECONE_API_KEY and PINECONE_HOST in the environment.
 */

import fs from 'fs';
import path from 'path';

const CHUNKS_FILE = path.join(__dirname, '..', 'lib', 'rag', 'chunks.json');
const UPSERT_BATCH_SIZE = 100; // Pinecone's recommended max per upsert request
const PROGRESS_LOG_INTERVAL = 500;

interface Chunk {
  id: string;
  title: string;
  url: string;
  content: string;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function wipeExistingIndex(host: string, apiKey: string): Promise<void> {
  console.log('Wiping existing Pinecone vectors (stale corpus, no correspondence to new chunk IDs)...');
  const res = await fetch(`https://${host}/vectors/delete`, {
    method: 'POST',
    headers: { 'Api-Key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ deleteAll: true }),
  });
  if (!res.ok) {
    const text = await res.text();
    // Pinecone free-tier "starter" indexes sometimes reject deleteAll with a 404 when the
    // namespace is already empty - that's fine, not a real failure.
    console.warn(`  delete-all returned ${res.status}: ${text} (continuing - may just mean the index was already empty)`);
  } else {
    console.log('  Index wiped.');
  }
}

async function upsertBatch(host: string, apiKey: string, vectors: { id: string; values: number[]; metadata: Record<string, string> }[]): Promise<void> {
  const res = await fetch(`https://${host}/vectors/upsert`, {
    method: 'POST',
    headers: { 'Api-Key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ vectors }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Pinecone upsert failed: ${res.status} ${text}`);
  }
}

async function main() {
  const apiKey = process.env.PINECONE_API_KEY;
  const host = process.env.PINECONE_HOST;
  if (!apiKey || !host) {
    throw new Error('PINECONE_API_KEY and PINECONE_HOST must be set in the environment.');
  }

  const chunks: Chunk[] = JSON.parse(fs.readFileSync(CHUNKS_FILE, 'utf-8'));
  console.log(`Loaded ${chunks.length} chunks from ${CHUNKS_FILE}\n`);

  await wipeExistingIndex(host, apiKey);

  console.log('\nLoading local embedding model (Xenova/multilingual-e5-small)...');
  const { pipeline, env } = await import('@xenova/transformers');
  env.allowLocalModels = true;
  env.cacheDir = process.env.TRANSFORMERS_CACHE || '.cache/transformers';
  const extractor = await pipeline('feature-extraction', 'Xenova/multilingual-e5-small');
  console.log('Model loaded.\n');

  let batch: { id: string; values: number[]; metadata: Record<string, string> }[] = [];
  let embedded = 0;
  let failed = 0;
  const startedAt = Date.now();

  for (const chunk of chunks) {
    try {
      // Multilingual-E5 requires the "passage: " prefix for documents at index time,
      // matching the "query: " prefix applied to queries at search time.
      const output = await extractor(`passage: ${chunk.content}`, { pooling: 'mean', normalize: true });
      const vector = Array.from(output.data) as number[];

      batch.push({
        id: chunk.id,
        values: vector,
        // Pinecone metadata values must be strings/numbers/booleans; content is capped
        // defensively (Pinecone's metadata size limit is 40KB per vector, well above any
        // single chunk here, but this keeps the payload lean regardless).
        metadata: { title: chunk.title, url: chunk.url, content: chunk.content.slice(0, 4000) },
      });
      embedded++;

      if (batch.length >= UPSERT_BATCH_SIZE) {
        await upsertBatch(host, apiKey, batch);
        batch = [];
      }
    } catch (e) {
      failed++;
      console.warn(`  Failed to embed chunk ${chunk.id} (${chunk.title.slice(0, 40)}): ${errMsg(e)}`);
    }

    if (embedded % PROGRESS_LOG_INTERVAL === 0 && embedded > 0) {
      const elapsedSec = (Date.now() - startedAt) / 1000;
      const rate = embedded / elapsedSec;
      const remaining = chunks.length - embedded - failed;
      console.log(`  ${embedded}/${chunks.length} embedded (${rate.toFixed(1)}/sec, ~${Math.round(remaining / rate)}s remaining)`);
    }
  }

  if (batch.length > 0) {
    await upsertBatch(host, apiKey, batch);
  }

  const totalSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\n${'='.repeat(60)}`);
  console.log('EMBEDDING + UPSERT COMPLETE');
  console.log(`  Embedded : ${embedded}`);
  console.log(`  Failed   : ${failed}`);
  console.log(`  Time     : ${totalSec}s`);
  console.log('='.repeat(60));
}

main().catch((err) => {
  console.error('\nFatal error:', err);
  process.exit(1);
});
