// -----------------------------------------------------------------------------
// מחולל הוקטורים (Vector Embeddings Generator)
// -----------------------------------------------------------------------------
// קובץ זה אחראי לקחת טקסט חופשי (שאילתה או פסקת מידע) ולהפוך אותו
// למערך מתמטי של 384 מספרים (וקטור צפוף) בעזרת מודל ה-AI "multilingual-e5-small".
//
// מתחבר ל:
// 1. API חיצוני של HuggingFace (בעדיפות ראשונה, חוסך משאבי שרת).
// 2. מנוע ONNX מקומי (Xenova/transformers) כגיבוי רק בסביבת פיתוח/סריקה.
// -----------------------------------------------------------------------------

// משתנה גלובלי (Singleton) להחזקת המודל המקומי בזיכרון, אם הופעל הגיבוי
let localExtractor: any = null;

// קריאת האסימון (Token) של Hugging Face ממשתני הסביבה
const rawToken = process.env.HF_TOKEN || '';
const HF_TOKEN = rawToken.toLowerCase() === 'none' ? '' : rawToken;

// api-inference.huggingface.co (the previous endpoint) has been retired and no longer
// resolves at all. router.huggingface.co is HF's current Inference Providers gateway.
const HF_ROUTER_URL = 'https://router.huggingface.co/hf-inference/models/intfloat/multilingual-e5-small/pipeline/feature-extraction';

// Query embeddings are cached by normalized query text so a repeated question costs zero
// HF calls. This is an in-memory, per-warm-container cache (Vercel functions are reused
// across nearby invocations) - not persistent, but free and meaningfully reduces load on
// a free-tier HF quota.
const queryEmbeddingCache = new Map<string, number[]>();

export class EmbeddingUnavailableError extends Error {}

/**
 * פונקציה: getEmbedding
 * מה היא עושה: מייצרת וקטור סמנטי של 384 ממדים.
 * למה היא חכמה (Hybrid Approach):
 * 1. מנסה קודם את שרתי HuggingFace בחינם (ללא עומס זיכרון על השרת שלנו).
 * 2. נופלת לגיבוי עיבוד מקומי (CPU) *רק* על המחשב המקומי ולא בייצור (Serverless), כדי למנוע קריסות של זיכרון ב-Lambda.
 *
 * Throws EmbeddingUnavailableError (rather than swallowing the failure) when both paths
 * fail, so the caller can surface a visibly degraded response instead of silently
 * serving BM25-only results as if nothing happened - the exact silence that let the
 * previous HF endpoint sit dead in production for months without anyone noticing.
 */
export async function getEmbedding(text: string, isQuery = true): Promise<number[]> {
  const prefix = isQuery ? 'query: ' : 'passage: ';
  const queryText = text.startsWith('query:') || text.startsWith('passage:') ? text : `${prefix}${text}`;

  const cacheKey = isQuery ? queryText.trim().toLowerCase() : null;
  if (cacheKey && queryEmbeddingCache.has(cacheKey)) {
    return queryEmbeddingCache.get(cacheKey)!;
  }

  console.info(`[embeddings] Generating embedding (isQuery=${isQuery}) for: "${text.slice(0, 40)}..."`);

  // 1. Try the remote HuggingFace router (works without a token too, subject to its
  // shared free-tier rate limit; a real token gets a dedicated quota).
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (HF_TOKEN) headers['Authorization'] = `Bearer ${HF_TOKEN}`;

    const hfResponse = await fetch(HF_ROUTER_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ inputs: queryText }),
      signal: AbortSignal.timeout(10000),
    });

    if (hfResponse.ok) {
      const result = await hfResponse.json();
      let vector: number[] = [];
      if (Array.isArray(result) && Array.isArray(result[0])) {
        vector = result[0];
      } else if (Array.isArray(result) && typeof result[0] === 'number') {
        vector = result;
      }

      if (vector.length === 384) {
        console.info('[embeddings] Successfully generated embedding via Hugging Face router');
        if (cacheKey) queryEmbeddingCache.set(cacheKey, vector);
        return vector;
      }
      console.warn(`[embeddings] Invalid vector length returned: ${vector.length}, falling back`);
    } else {
      const errText = await hfResponse.text();
      console.warn(`[embeddings] Hugging Face router failed with status ${hfResponse.status}: ${errText}`);
    }
  } catch (err) {
    console.warn('[embeddings] Remote Hugging Face router error, falling back to local model:', err);
  }

  // Detect serverless environment (AWS Lambda or Vercel)
  const isServerless = !!process.env.AWS_LAMBDA_FUNCTION_NAME || !!process.env.VERCEL || process.env.NODE_ENV === 'production';

  if (isServerless) {
    console.error('[embeddings] Remote Hugging Face router failed. Local execution is disabled in serverless/production to prevent timeouts & crashes.');
    throw new EmbeddingUnavailableError('Remote embedding generation failed. Serverless local execution blocked.');
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
    const vector = Array.from(output.data) as number[];
    if (cacheKey) queryEmbeddingCache.set(cacheKey, vector);
    return vector;
  } catch (err) {
    console.error('[embeddings] Local embedding pipeline failed:', err);
    throw new EmbeddingUnavailableError('Failed to generate vector embedding.');
  }
}
