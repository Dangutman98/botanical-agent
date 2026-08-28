export async function GET(req: Request) {
  const results: Record<string, unknown> = {};
  const url = new URL(req.url);
  const testQuery = url.searchParams.get('q') || 'כורכום';

  // 0. Diagnose whether the BM25 corpus file actually made it into this deployment's
  // serverless bundle. Added while tracking down a bug where chunks.json wasn't traced into
  // the Vercel function bundle, causing every keyword search to silently return zero results.
  try {
    const fs = await import('fs');
    const path = await import('path');
    const chunksPath = path.join(process.cwd(), 'lib', 'rag', 'chunks.json');
    const exists = fs.existsSync(chunksPath);
    if (exists) {
      const stat = fs.statSync(chunksPath);
      const { BM25 } = await import('@/lib/rag/bm25');
      const chunks = JSON.parse(fs.readFileSync(chunksPath, 'utf-8'));
      const bm25 = new BM25(chunks);
      const sample = bm25.search(testQuery, 3);
      results['corpus'] = {
        chunksJsonPath: chunksPath,
        exists: true,
        sizeMB: (stat.size / 1024 / 1024).toFixed(2),
        chunkCount: chunks.length,
        sampleQuery: testQuery,
        sampleMatches: sample.length,
        sampleTitles: sample.map((s) => s.chunk.title.slice(0, 60)),
      };
    } else {
      results['corpus'] = { chunksJsonPath: chunksPath, exists: false };
    }
  } catch (e: any) {
    results['corpus'] = { error: e.message };
  }

  // 0b. Exercise the actual retrieval function used by /api/chat (dense + sparse + RRF),
  // not just a reimplementation, to see whether the real code path finds anything.
  try {
    const { queryHybridBotanicalKnowledge } = await import('@/lib/rag/hybrid-store');
    const { results: hybridResults, denseSearchDegraded } = await queryHybridBotanicalKnowledge(testQuery, 4);
    results['hybridRetrieval'] = {
      sampleQuery: testQuery,
      resultCount: hybridResults.length,
      denseSearchDegraded,
      titles: hybridResults.map((r) => r.title.slice(0, 60)),
    };
  } catch (e: any) {
    results['hybridRetrieval'] = { error: e.message };
  }

  // 1. Check env vars presence (masked)
  const groqKey = process.env.GROQ_API_KEY || '';
  const pineconeKey = process.env.PINECONE_API_KEY || '';
  const pineconeHost = process.env.PINECONE_HOST || '';

  results['env'] = {
    GROQ_API_KEY: groqKey ? `✅ present (${groqKey.slice(0, 4)}...${groqKey.slice(-4)})` : '❌ MISSING',
    PINECONE_API_KEY: pineconeKey ? `✅ present (${pineconeKey.slice(0, 4)}...${pineconeKey.slice(-4)})` : '❌ MISSING',
    PINECONE_HOST: pineconeHost ? `✅ ${pineconeHost}` : '❌ MISSING',
  };

  // 2. Test Groq API key
  try {
    const groqRes = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: `Bearer ${groqKey}` },
    });
    const groqData = await groqRes.json();
    results['groq'] = groqRes.ok
      ? `✅ OK (${groqData.data?.length ?? 0} models available)`
      : `❌ ${groqRes.status} - ${JSON.stringify(groqData)}`;
  } catch (e: any) {
    results['groq'] = `❌ Network error: ${e.message}`;
  }

  // 3. Test Pinecone
  try {
    const pineconeRes = await fetch(`https://${pineconeHost}/describe_index_stats`, {
      method: 'POST',
      headers: {
        'Api-Key': pineconeKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    const pineconeData = await pineconeRes.json();
    results['pinecone'] = pineconeRes.ok
      ? `✅ OK - ${JSON.stringify(pineconeData)}`
      : `❌ ${pineconeRes.status} - ${JSON.stringify(pineconeData)}`;
  } catch (e: any) {
    results['pinecone'] = `❌ Network error: ${e.message}`;
  }

  return Response.json(results, { status: 200 });
}
