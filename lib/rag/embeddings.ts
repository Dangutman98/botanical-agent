import { pipeline, env } from '@xenova/transformers';

// Configure ONNX model loader to use process environment cache or local fallback
env.allowLocalModels = true;
env.cacheDir = process.env.TRANSFORMERS_CACHE || '/tmp';

// Singleton placeholder for local model backup
let localExtractor: any = null;

// Read Hugging Face authorization tokens from environment variables
const HF_TOKEN = process.env.HF_TOKEN || process.env.HUGGINGFACE_API_KEY || '';

/**
 * Generates a 384-dimensional vector embedding for the input text using multilingual-e5-small.
 * Uses a robust, zero-cold-start hybrid approach:
 * 1. Queries the remote Hugging Face Inference API (instant, no local execution/memory overhead).
 * 2. Falls back to local WASM execution via @xenova/transformers if the remote endpoint is unavailable.
 */
export async function getEmbedding(text: string, isQuery = true): Promise<number[]> {
  // Multilingual-E5 models require queries to be prefixed with "query: " and documents/passages with "passage: "
  const prefix = isQuery ? 'query: ' : 'passage: ';
  const queryText = text.startsWith('query:') || text.startsWith('passage:') ? text : `${prefix}${text}`;

  console.info(`[embeddings] Generating embedding (isQuery=${isQuery}) for: "${text.slice(0, 40)}..."`);

  // 1. Try remote Hugging Face Inference API first (avoids serverless memory constraints & function timeouts)
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (HF_TOKEN) {
      headers['Authorization'] = `Bearer ${HF_TOKEN}`;
    }

    const hfResponse = await fetch(
      'https://api-inference.huggingface.co/models/intfloat/multilingual-e5-small',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ inputs: queryText }),
      }
    );

    if (hfResponse.ok) {
      const result = await hfResponse.json();
      let vector: number[] = [];

      // Hugging Face returns either [[values]] or [values] based on parameters
      if (Array.isArray(result) && Array.isArray(result[0])) {
        vector = result[0];
      } else if (Array.isArray(result) && typeof result[0] === 'number') {
        vector = result;
      }

      if (vector.length === 384) {
        console.info('[embeddings] Successfully generated embedding via Hugging Face Inference API');
        return vector;
      } else {
        console.warn(`[embeddings] Hugging Face API returned invalid vector length: ${vector.length}, falling back to local`);
      }
    } else {
      console.warn(`[embeddings] Hugging Face API failed with status ${hfResponse.status}: ${await hfResponse.text()}, falling back to local`);
    }
  } catch (err) {
    console.warn('[embeddings] Remote Hugging Face API error, falling back to local model:', err);
  }

  // 2. Fallback to local CPU-execution in @xenova/transformers
  try {
    if (!localExtractor) {
      console.info('[embeddings] Loading local multilingual-e5-small model...');
      localExtractor = await pipeline('feature-extraction', 'Xenova/multilingual-e5-small');
    }
    const output = await localExtractor(queryText, { pooling: 'mean', normalize: true });
    console.info('[embeddings] Successfully generated embedding via local transformers pipeline');
    return Array.from(output.data);
  } catch (err) {
    console.error('[embeddings] Local embedding pipeline failed:', err);
    throw new Error('Failed to generate vector embedding.');
  }
}
