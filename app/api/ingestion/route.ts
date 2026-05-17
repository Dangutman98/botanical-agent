import { pipeline } from '@xenova/transformers';

export async function POST(req: Request) {
  try {
    const body: { title: string; url: string; content: string } = await req.json();

    if (!body.title || !body.url || !body.content) {
      return Response.json({ error: 'title, url, and content are required' }, { status: 400 });
    }

    console.info('[ingestion] Generating embedding for:', body.title);

    const extractor = await pipeline('feature-extraction', 'Xenova/multilingual-e5-small', {
      env: { allowLocalModels: true },
    });

    const output = await extractor(`passage: ${body.content}`, { pooling: 'mean', normalize: true });
    const vector = Array.from(output.data);

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

    return Response.json({ id, upserted: result });
  } catch (error) {
    console.error('[ingestion] FATAL ERROR', { error });
    const errorMsg = error instanceof Error ? error.message : 'Ingestion failed';
    return Response.json({ error: errorMsg }, { status: 500 });
  }
}
