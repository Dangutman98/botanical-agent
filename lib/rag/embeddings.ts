// Singleton placeholder for local model backup
let localExtractor: any = null;

// Read Hugging Face authorization tokens from environment variables, filtering 'none' fallbacks
const rawToken = process.env.HF_TOKEN || process.env.HUGGINGFACE_API_KEY || '';
const HF_TOKEN = rawToken.toLowerCase() === 'none' ? '' : rawToken;

/**
 * Generates a 384-dimensional vector embedding for the input text using multilingual-e5-small.
 * Uses a robust, zero-cold-start hybrid approach with active loading retries:
 * 1. Queries the remote Hugging Face Inference API (instant, no local execution/memory overhead).
 * 2. Safe retries if the remote model is currently loading (cold start on Hugging Face).
 * 3. Falls back to local WASM execution via @xenova/transformers ONLY on local machine (disabled in production serverless).
 */
export async function getEmbedding(text: string, isQuery = true): Promise<number[]> {
  // Multilingual-E5 models require queries to be prefixed with "query: " and documents/passages with "passage: "
  const prefix = isQuery ? 'query: ' : 'passage: ';
  const queryText = text.startsWith('query:') || text.startsWith('passage:') ? text : `${prefix}${text}`;

  console.info(`[embeddings] Generating embedding (isQuery=${isQuery}) for: "${text.slice(0, 40)}..."`);

  // 1. Try remote Hugging Face Inference API with a loading retry loop (bypasses serverless timeouts)
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (HF_TOKEN) {
      headers['Authorization'] = `Bearer ${HF_TOKEN}`;
    }

    let retries = 4;
    let delayMs = 1500; // Wait 1.5 seconds between loading checks

    while (retries > 0) {
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

        // Detect Hugging Face remote model cold loading state
        if (result && result.error && result.error.includes('loading')) {
          const estimatedTime = result.estimated_time || 5;
          console.info(`[embeddings] Hugging Face model is currently loading. Estimated time: ${estimatedTime}s. Retrying in ${delayMs}ms...`);
          retries--;
          await new Promise((resolve) => setTimeout(resolve, Math.min(delayMs, estimatedTime * 1000)));
          continue;
        }

        let vector: number[] = [];
        if (Array.isArray(result) && Array.isArray(result[0])) {
          vector = result[0];
        } else if (Array.isArray(result) && typeof result[0] === 'number') {
          vector = result;
        }

        if (vector.length === 384) {
          console.info('[embeddings] Successfully generated embedding via Hugging Face Inference API');
          return vector;
        } else {
          console.warn(`[embeddings] Invalid vector length returned: ${vector.length}, falling back`);
          break;
        }
      } else {
        // If Hugging Face returns a 503 Service Unavailable, it usually means the model is cold starting
        if (hfResponse.status === 503) {
          console.info(`[embeddings] Remote model is cold-starting (503). Retrying in ${delayMs}ms...`);
          retries--;
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }

        const errText = await hfResponse.text();
        console.warn(`[embeddings] Hugging Face API failed with status ${hfResponse.status}: ${errText}`);
        break;
      }
    }
  } catch (err) {
    console.warn('[embeddings] Remote Hugging Face API error, falling back to local model:', err);
  }

  // Detect serverless environment (AWS Lambda or Vercel)
  const isServerless = !!process.env.AWS_LAMBDA_FUNCTION_NAME || !!process.env.VERCEL || process.env.NODE_ENV === 'production';

  if (isServerless) {
    console.error('[embeddings] Remote Hugging Face API failed. Local execution is disabled in serverless/production to prevent timeouts & crashes.');
    throw new Error('Remote embedding generation failed. Serverless local execution blocked.');
  }

  // 2. Fallback to local CPU-execution in @xenova/transformers (local machine dev/scraping fallback only)
  try {
    if (!localExtractor) {
      console.info('[embeddings] Loading local multilingual-e5-small model dynamically...');
      // Dynamic import prevents loading heavy ONNX runtime modules on serverless environments during cold starts
      const { pipeline, env } = await import('@xenova/transformers');
      
      // Configure ONNX model loader to use environment cache or local fallback
      env.allowLocalModels = true;
      env.cacheDir = process.env.TRANSFORMERS_CACHE || '/tmp';
      
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
