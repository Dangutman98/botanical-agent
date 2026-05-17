import { pipeline, env, type FeatureExtractionPipeline } from '@xenova/transformers';

env.allowLocalModels = true;

let extractor: FeatureExtractionPipeline | null = null;

async function getExtractor() {
  if (!extractor) {
    console.info('[vector-store] Loading embedding model...');
    extractor = await pipeline('feature-extraction', 'Xenova/multilingual-e5-small');
    console.info('[vector-store] Embedding model loaded');
  }
  return extractor;
}

export async function queryBotanicalKnowledge(userQuery: string): Promise<{ title: string; url: string; content: string }[]> {
  console.info('[vector-store] queryBotanicalKnowledge for:', userQuery);

  try {
    const model = await getExtractor();

    const output = await model(`query: ${userQuery}`, { pooling: 'mean', normalize: true });
    const vector = Array.from(output.data);

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
