import { pipeline, env } from '@xenova/transformers';
import { saveChunkLocally } from '@/lib/rag/hybrid-store';

env.allowLocalModels = true;
env.cacheDir = '/tmp';

export async function POST(req: Request) {
  try {
    const body: { title: string; url: string; content: string } = await req.json();

    if (!body.title || !body.url || !body.content) {
      return Response.json({ error: 'title, url, and content are required' }, { status: 400 });
    }

    console.log('[Ingestion] Starting pipeline initialization...');
    const extractor = await pipeline('feature-extraction', 'Xenova/multilingual-e5-small');
    console.log('[Ingestion] Pipeline loaded successfully, generating embeddings...');

    const output = await extractor(`passage: ${body.content}`, { pooling: 'mean', normalize: true });
    const vector = Array.from(output.data);
    console.log('[Ingestion] Embeddings generated, sending to Pinecone...');

    const id = Buffer.from(body.url + body.title).toString('base64').slice(0, 50);

    const pineconeResponse = await fetch(`https://${process.env.PINECONE_HOST}/vectors/upsert`, {
      method: 'POST',
      headers: {
        'Api-Key': process.env.PINECONE_API_KEY || '',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        vectors: [{
          id,
          values: vector,
          metadata: { title: body.title, url: body.url, content: body.content },
        }],
      }),
    });

    if (!pineconeResponse.ok) {
      const errorBody = await pineconeResponse.text();
      console.error('[ingestion] Pinecone upsert failed:', pineconeResponse.status, errorBody);
      return Response.json({ error: 'Pinecone upsert failed' }, { status: 502 });
    }

    const result = await pineconeResponse.json();
    console.info('[ingestion] Successfully upserted:', id);

    // Save chunk locally for BM25 keyword index caching
    await saveChunkLocally({ title: body.title, url: body.url, content: body.content });

    return Response.json({ id, upserted: result });
  } catch (error) {
    console.error('[Ingestion Error]:', error);
    return Response.json({ error: 'Ingestion failed', details: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
