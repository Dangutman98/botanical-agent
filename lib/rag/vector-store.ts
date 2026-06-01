import { getEmbedding } from './embeddings';

/**
 * Dense vector search query fallback (used when BM25 is not populated or raw vector lookup is required).
 * Resolves the query via unified getEmbedding helper and Pinecone index.
 */
export async function queryBotanicalKnowledge(userQuery: string): Promise<{ title: string; url: string; content: string }[]> {
  console.info('[vector-store] queryBotanicalKnowledge for:', userQuery);

  try {
    // 1. Get embedding using unified embeddings utility
    const vector = await getEmbedding(userQuery, true);

    // 2. Fetch matches from Pinecone remote vector store
    const response = await fetch(`https://${process.env.PINECONE_HOST}/query`, {
      method: 'POST',
      headers: {
        'Api-Key': process.env.PINECONE_API_KEY || '',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ vector, topK: 3, includeMetadata: true }),
    });

    if (!response.ok) {
      console.error('[vector-store] Pinecone query failed:', response.status, await response.text());
      return [];
    }

    const data = await response.json();
    const matches = data.matches || [];

    console.info(`[vector-store] Found ${matches.length} matches`);

    return matches.map((m: { metadata?: { title?: string; url?: string; content?: string } }) => ({
      title: m.metadata?.title || '',
      url: m.metadata?.url || '',
      content: m.metadata?.content || '',
    }));
  } catch (error) {
    console.error('[vector-store] FATAL ERROR:', error);
    return [];
  }
}
