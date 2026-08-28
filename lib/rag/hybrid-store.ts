// -----------------------------------------------------------------------------
// RAG Hybrid Store (מנוע ה-RAG ההיברידי)
// -----------------------------------------------------------------------------
// קובץ זה הוא מוח השליפה (Retrieval) של המערכת.
// הוא משלב שני מנועי חיפוש:
// 1. חיפוש סמנטי (Dense) - מבוסס על משמעות המילים דרך Pinecone + HuggingFace.
// 2. חיפוש מילות מפתח (Sparse) - מבוסס על מופעי מילים מדויקים דרך מנוע BM25 המקומי.
//
// הוא מאחד את התוצאות משני המנועים בעזרת אלגוריתם RRF (Reciprocal Rank Fusion).
// -----------------------------------------------------------------------------

import fs from 'fs';
import path from 'path';
import { BM25, type Chunk } from './bm25';
import { getEmbedding } from './embeddings';

// נתיב לקובץ המטמון המקומי שומר את כל הטקסטים שנשאבו מהאינטרנט.
// מתחבר ל: script של ה-crawler ולמנוע ה-BM25
const CHUNKS_FILE = path.join(process.cwd(), 'lib', 'rag', 'chunks.json');

// מטמון בזיכרון (In-memory cache) למנוע ה-BM25 כדי למנוע בנייה מחדש בכל בקשה.
let bm25Instance: BM25 | null = null;
let lastLoadedChunksLength = -1;

/**
 * פונקציה: getBM25Instance
 * מה היא עושה: טוענת את קובץ ה-chunks מהדיסק ובונה את אינדקס החיפוש המקומי (BM25).
 * מתי נבנה: נבנה רק פעם אחת, או מחדש אם נוספו טקסטים חדשים למאגר (לפי שינוי באורך המערך).
 */
function getBM25Instance(): BM25 | null {
  try {
    if (!fs.existsSync(CHUNKS_FILE)) {
      return null;
    }

    const data = fs.readFileSync(CHUNKS_FILE, 'utf-8');
    const chunks: Chunk[] = JSON.parse(data);

    if (chunks.length === 0) {
      return null;
    }

    // בנה מחדש רק אם יש כמות חדשה של chunks
    if (!bm25Instance || chunks.length !== lastLoadedChunksLength) {
      console.info(`[hybrid-store] Building BM25 index over ${chunks.length} chunks...`);
      bm25Instance = new BM25(chunks);
      lastLoadedChunksLength = chunks.length;
      console.info('[hybrid-store] BM25 index built successfully');
    }

    return bm25Instance;
  } catch (error) {
    console.error('[hybrid-store] Failed to load/build BM25 index:', error);
    return null;
  }
}

/**
 * פונקציה: saveChunkLocally
 * מה היא עושה: שומרת טקסטים חדשים שנסרקו אל הדיסק המקומי (לשימוש עתידי של BM25).
 * לאן מתחברת: נקראת מתוך ingestion.controller.ts במהלך פעולת הסריקה (Crawling).
 */
export async function saveChunkLocally(chunk: { title: string; url: string; content: string }): Promise<void> {
  try {
    const parentDir = path.dirname(CHUNKS_FILE);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    let chunks: Chunk[] = [];
    if (fs.existsSync(CHUNKS_FILE)) {
      const data = fs.readFileSync(CHUNKS_FILE, 'utf-8');
      chunks = JSON.parse(data);
    }

    // מניעת כפילויות עפ"י URL וכותרת
    const exists = chunks.some(c => c.url === chunk.url && c.title === chunk.title);
    if (!exists) {
      const id = Buffer.from(chunk.url + chunk.title).toString('base64').slice(0, 50);
      chunks.push({ id, ...chunk });
      fs.writeFileSync(CHUNKS_FILE, JSON.stringify(chunks, null, 2), 'utf-8');
      console.log(`[hybrid-store] Saved chunk locally: "${chunk.title}"`);
    }
  } catch (error) {
    console.error('[hybrid-store] Failed to save chunk locally:', error);
  }
}

/**
 * אלגוריתם Reciprocal Rank Fusion (RRF)
 * מה הוא עושה: מקבל 2 רשימות דירוג שונות (Pinecone ו-BM25), ומייצר מהן רשימה ממוזגת חכמה.
 * הניקוד מחושב כפונקציה של המיקום של התוצאה ברשימה המקורית.
 * ככל שהתוצאה מדורגת גבוה יותר בשני המנועים יחד, הציון הסופי שלה יזנק.
 */
export function reciprocalRankFusion(
  denseResults: { title: string; url: string; content: string }[],
  sparseResults: Chunk[],
  rrfK = 30,
  // Defaults matched to the only current call site (below): dense gets a modest edge to help
  // cross-lingual matching, bm25 keeps exact-keyword weight. These previously read 0.5/2.0 —
  // the exact opposite ratio of what every real call actually passed — which was never a live
  // bug (the call site always overrode them) but was self-contradictory and misleading.
  denseWeight = 1.5,
  bm25Weight = 1.0
): { title: string; url: string; content: string }[] {
  const scoreMap = new Map<string, { doc: { title: string; url: string; content: string }; score: number }>();
  const getDocKey = (url: string, title: string) => `${url}::${title}`;

  // 1. חישוב ניקוד לרשימת החיפוש הסמנטי (Dense)
  denseResults.forEach((doc, index) => {
    const rank = index + 1;
    const key = getDocKey(doc.url, doc.title);
    const score = denseWeight * (1 / (rrfK + rank));
    scoreMap.set(key, { doc, score });
  });

  // 2. חישוב ניקוד לרשימת חיפוש מילות המפתח (BM25 Sparse)
  sparseResults.forEach((doc, index) => {
    const rank = index + 1;
    const key = getDocKey(doc.url, doc.title);
    const score = bm25Weight * (1 / (rrfK + rank));

    const existing = scoreMap.get(key);
    if (existing) {
      // אם המסמך הופיע גם ברשימה הסמנטית, הוא מקבל בונוס של שילוב הציונים
      existing.score += score;
    } else {
      scoreMap.set(key, {
        doc: { title: doc.title, url: doc.url, content: doc.content },
        score,
      });
    }
  });

  // 3. מיון כל התוצאות מהגבוה לנמוך
  const fused = Array.from(scoreMap.values());
  fused.sort((a, b) => b.score - a.score);

  return fused.map(f => f.doc);
}

/**
 * פונקציה ראשית: queryHybridBotanicalKnowledge
 * מה היא עושה: מנהלת את תהליך שליפת המידע (Retrieval) עבור הצ'אט.
 * שלבים: 1. חיפוש סמנטי, 2. חיפוש מילות מפתח, 3. היתוך RRF, 4. גיוון מקורות.
 * 
 * לאן מתחברת: מופעלת ע"י chat.controller.ts כאשר משתמש שולח הודעה.
 */
export interface HybridQueryResult {
  results: { title: string; url: string; content: string }[];
  // True when dense (semantic) search couldn't run at all this request - e.g. the
  // embedding API is unavailable - so results came from BM25 keyword search alone.
  // Surfaced to the caller instead of being silently swallowed: a silent fallback here
  // is exactly what let the previous HF endpoint sit dead in production for months.
  denseSearchDegraded: boolean;
}

export async function queryHybridBotanicalKnowledge(
  userQuery: string,
  topK = 5,
  secondaryQuery?: string
): Promise<HybridQueryResult> {
  console.info('[hybrid-store] Querying hybrid store for:', userQuery);

  let denseCandidates: { title: string; url: string; content: string }[] = [];
  let sparseCandidates: Chunk[] = [];
  let denseSearchDegraded = false;

  // ---------------------------------------------------------
  // שלב 1: חיפוש סמנטי דרך Vector DB (Pinecone)
  // ---------------------------------------------------------
  try {
    const vector = await getEmbedding(userQuery, true);

    const pineconeResponse = await fetch(`https://${process.env.PINECONE_HOST}/query`, {
      method: 'POST',
      headers: {
        'Api-Key': process.env.PINECONE_API_KEY || '',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ vector, topK: 20, includeMetadata: true }),
    });

    if (pineconeResponse.ok) {
      const data = await pineconeResponse.json();
      const matches = data.matches || [];
      denseCandidates = matches.map((m: any) => ({
        title: m.metadata?.title || '',
        url: m.metadata?.url || '',
        content: m.metadata?.content || '',
      }));
    } else {
      console.warn('[hybrid-store] Pinecone query failed with status:', pineconeResponse.status);
      denseSearchDegraded = true;
    }
  } catch (error) {
    console.warn('[hybrid-store] Dense semantic search failed (HuggingFace/Pinecone error). Falling back to pure BM25 keyword search:', error);
    denseSearchDegraded = true;
  }

  // ---------------------------------------------------------
  // שלב 2: חיפוש מילות מפתח מדויקות במטמון המקומי (BM25)
  // מתבצע חיפוש כפול גם עבור מונח המקור וגם עבור המונח המתורגם.
  // ---------------------------------------------------------
  try {
    const bm25 = getBM25Instance();
    if (bm25) {
      const primaryResults = bm25.search(userQuery, 20).map(res => res.chunk);
      console.info(`[hybrid-store] BM25 primary search found ${primaryResults.length} sparse candidates.`);

      if (secondaryQuery && secondaryQuery.trim() !== userQuery.trim()) {
        const secondaryResults = bm25.search(secondaryQuery, 20).map(res => res.chunk);
        console.info(`[hybrid-store] BM25 secondary (bilingual) search found ${secondaryResults.length} sparse candidates.`);

        // איחוד תוצאות: תוצאות שאילתה ראשית קודם, אח"כ השאילתה המשנית
        const seenKeys = new Set(primaryResults.map(c => `${c.url}::${c.title}`));
        const merged = [...primaryResults];
        for (const chunk of secondaryResults) {
          const key = `${chunk.url}::${chunk.title}`;
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            merged.push(chunk);
          }
        }
        sparseCandidates = merged;
      } else {
        sparseCandidates = primaryResults;
      }
    } else {
      console.warn('[hybrid-store] BM25 cache is empty or chunks.json is missing.');
    }
  } catch (error) {
    console.error('[hybrid-store] Local BM25 search failed:', error);
  }

  // הגנת קריסה: אם שני המנועים לא החזירו כלום
  if (denseCandidates.length === 0 && sparseCandidates.length === 0) {
    console.warn('[hybrid-store] Both dense and sparse search returned zero results.');
    return { results: [], denseSearchDegraded };
  }

  // סינון רעשים של דפי SITEMAP שאולי נשאבו בטעות
  // (the corpus's own validation gate now rejects these at ingest time; this is a
  // defense-in-depth backstop, not the primary filter. Dropped the previous Hebrew
  // substring checks - URLs are percent-encoded, so 'מפת-אתר' never matched a real URL.)
  const isCleanUrl = (url: string) => !url.toLowerCase().includes('sitemap');
  denseCandidates = denseCandidates.filter(c => isCleanUrl(c.url));
  sparseCandidates = sparseCandidates.filter(c => isCleanUrl(c.url));

  // ---------------------------------------------------------
  // שלב 3: מיזוג התוצאות בעזרת Reciprocal Rank Fusion
  // ---------------------------------------------------------
  const fusedResults = reciprocalRankFusion(
    denseCandidates,
    sparseCandidates,
    30,   // קבוע RRF
    1.5,  // משקל סמנטי - מקבל קצת יותר משקל כדי לעזור בחיפוש רב-לשוני
    1.0   // משקל למילות מפתח מדויקות
  );

  // ---------------------------------------------------------
  // שלב 4: גיוון (Diversification) - הגבלת התוצאות ל-2 פסקאות גג מאותו מאמר
  // כדי לא להציף את ה-LLM בטקסט מיותר מאותו המקור על חשבון מקורות אחרים
  // ---------------------------------------------------------
  const urlCounts = new Map<string, number>();
  const diverseResults: { title: string; url: string; content: string }[] = [];
  
  for (const doc of fusedResults) {
    const count = urlCounts.get(doc.url) || 0;
    if (count < 2) {
      diverseResults.push(doc);
      urlCounts.set(doc.url, count + 1);
      if (diverseResults.length >= topK) break;
    }
  }

  console.info(`[hybrid-store] Returning ${diverseResults.length} diverse results (from ${urlCounts.size} unique URLs).`);
  return { results: diverseResults, denseSearchDegraded };
}

