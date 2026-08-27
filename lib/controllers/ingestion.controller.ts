import { saveChunkLocally } from '@/lib/rag/hybrid-store';
import { getEmbedding } from '@/lib/rag/embeddings';

/**
 * Controller: מנהל את תהליך הזרקת המידע (Ingestion).
 * מקבל תוכן, יוצר לו וקטור, שומר ב-Pinecone (לחיפוש סמנטי)
 * ושומר במטמון מקומי (לחיפוש מילות מפתח BM25).
 * 
 * מתחבר ל:
 * 1. Pinecone (לשמירת הוקטור)
 * 2. HuggingFace (ליצירת הוקטור דרך getEmbedding)
 * 3. קובץ chunks.json המקומי (דרך saveChunkLocally)
 */
export async function handleIngestionRequest(req: Request) {
  try {
    // This endpoint writes directly into the Pinecone index; without a secret check it was an
    // open write endpoint anyone on the internet could use to poison the knowledge base.
    const configuredSecret = process.env.INGESTION_SECRET;
    if (!configuredSecret) {
      console.error('[Ingestion] INGESTION_SECRET is not configured — refusing all requests.');
      return Response.json({ error: 'Ingestion is not configured' }, { status: 503 });
    }
    const providedSecret = req.headers.get('x-ingestion-secret');
    if (providedSecret !== configuredSecret) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body: { title: string; url: string; content: string } = await req.json();

    if (!body.title || !body.url || !body.content) {
      return Response.json({ error: 'title, url, and content are required' }, { status: 400 });
    }

    console.info('[Ingestion] Generating passage embedding for new document...');
    // Generate document embedding vector using unified embeddings helper as a passage
    const vector = await getEmbedding(body.content, false);
    console.info('[Ingestion] Embeddings generated successfully, indexing to Pinecone...');

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
    console.info('[ingestion] Successfully upserted to Pinecone:', id);

    // Save chunk locally for BM25 keyword index caching
    await saveChunkLocally({ title: body.title, url: body.url, content: body.content });

    return Response.json({ id, upserted: result });
  } catch (error) {
    console.error('[Ingestion Error]:', error);
    return Response.json({ error: 'Ingestion failed', details: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
