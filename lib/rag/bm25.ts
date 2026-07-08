// -----------------------------------------------------------------------------
// מנוע חיפוש מילות מפתח (BM25 Sparse Search Engine)
// -----------------------------------------------------------------------------
// קובץ זה מכיל מימוש מלא ומקומי של אלגוריתם BM25 (Okapi BM25).
// זהו אלגוריתם פופולרי לחיפוש טקסטואלי שמדרג מסמכים לפי שכיחות מילות השאילתה בהם (TF-IDF מתקדם).
// המנוע תומך בעברית ואנגלית, ורץ כולו בזיכרון (In-Memory).
// -----------------------------------------------------------------------------

export interface Chunk {
  id: string;
  title: string;
  url: string;
  content: string;
}

export class BM25 {
  private chunks: Chunk[] = [];
  private docLengths: number[] = [];
  private avgDocLength = 0;
  
  // מיפוי של (מילה -> תדירות) עבור כל מסמך
  private docTermFreqs: Map<string, number>[] = []; 
  // מיפוי של (מילה -> כמות המסמכים שהיא מופיעה בהם) עבור חישוב נדירות המילה (IDF)
  private docFreqs: Map<string, number> = new Map(); 
  
  // פרמטרים לכיול האלגוריתם (Tuning)
  private k1: number;
  private b: number;

  constructor(chunks: Chunk[], k1 = 1.5, b = 0.75) {
    this.k1 = k1;
    this.b = b;
    this.build(chunks);
  }

  /**
   * פונקציה: tokenize
   * מה היא עושה: מפרקת טקסט למילים, הופכת לאותיות קטנות (לאנגלית), ומסננת סימני פיסוק.
   * תומכת בעברית (Unicode \u0590-\u05ff) ואנגלית.
   */
  private tokenize(text: string): string[] {
    if (!text) return [];
    // Lowercase and extract Hebrew & English alphanumeric words
    const cleanText = text.toLowerCase();
    const matches = cleanText.match(/[\w\u0590-\u05ff]+/g);
    return matches || [];
  }

  /**
   * פונקציה: build
   * מה היא עושה: בונה את אינדקס החיפוש (Inverted Index) מתוך מערך של טקסטים (Chunks).
   * זמן ריצה: מתבצע פעם אחת בעת עליית השרת או כשמתווסף מידע חדש.
   */
  public build(chunks: Chunk[]): void {
    this.chunks = chunks;
    this.docLengths = [];
    this.docTermFreqs = [];
    this.docFreqs.clear();

    if (chunks.length === 0) {
      this.avgDocLength = 0;
      return;
    }

    let totalLength = 0;

    for (const chunk of chunks) {
      // אנחנו מאנדקסים גם את הכותרת וגם את התוכן של הפסקה
      const tokens = this.tokenize(`${chunk.title} ${chunk.content}`);
      this.docLengths.push(tokens.length);
      totalLength += tokens.length;

      const termFreqMap = new Map<string, number>();
      for (const token of tokens) {
        termFreqMap.set(token, (termFreqMap.get(token) || 0) + 1);
      }
      this.docTermFreqs.push(termFreqMap);

      // עדכון התדירות הכללית (בכמה מסמכים הופיעה כל מילה)
      for (const token of termFreqMap.keys()) {
        this.docFreqs.set(token, (this.docFreqs.get(token) || 0) + 1);
      }
    }

    this.avgDocLength = totalLength / chunks.length;
  }

  /**
   * פונקציה: idf (Inverse Document Frequency)
   * מה היא עושה: מחשבת את נדירות המילה. מילים נדירות מקבלות ניקוד גבוה יותר.
   * משתמשת בנוסחת ההחלקה (Smoothing) הסטנדרטית של BM25.
   */
  private idf(term: string): number {
    const n = this.docFreqs.get(term) || 0;
    const N = this.chunks.length;
    return Math.log((N - n + 0.5) / (n + 0.5) + 1);
  }

  /**
   * פונקציה: search
   * מה היא עושה: מקבלת שאילתת חיפוש, מחשבת ציון BM25 לכל מסמך במאגר,
   * ומחזירה את K המסמכים עם הציון הגבוה ביותר.
   * לאן מתחברת: נקראת ע"י hybrid-store.ts כחלק מהחיפוש המשולב.
   */
  public search(query: string, topK = 15): { chunk: Chunk; score: number }[] {
    const queryTokens = this.tokenize(query);
    if (queryTokens.length === 0 || this.chunks.length === 0) {
      return [];
    }

    const scores: { chunk: Chunk; score: number }[] = [];

    for (let i = 0; i < this.chunks.length; i++) {
      const chunk = this.chunks[i];
      const docLen = this.docLengths[i];
      const termFreqMap = this.docTermFreqs[i];
      let score = 0;

      // חישוב ניקוד עבור כל מילה בשאילתה בנפרד, וסכימה של הציונים
      for (const token of queryTokens) {
        const f = termFreqMap.get(token) || 0;
        if (f > 0) {
          const termIdf = this.idf(token);
          const numerator = f * (this.k1 + 1);
          const denominator = f + this.k1 * (1 - this.b + this.b * (docLen / this.avgDocLength));
          score += termIdf * (numerator / denominator);
        }
      }

      if (score > 0) {
        scores.push({ chunk, score });
      }
    }

    // מיון התוצאות מהציון הגבוה לנמוך
    scores.sort((a, b) => b.score - a.score);
    return scores.slice(0, topK);
  }
}
