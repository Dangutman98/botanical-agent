import axios from 'axios';
import * as cheerio from 'cheerio';
import Groq from 'groq-sdk';

const SYSTEM_PROMPT =
  'You are a practical botanical assistant. Give concise, accurate plant guidance. ' +
  'If uncertain, say you are unsure. Do not invent facts. Prefer simple language. ' +
  'IMPORTANT: You must respond ONLY in the language the user uses (Hebrew or English). NEVER use Chinese, Korean, or any other language. ' +
  'Common Hebrew plant name translations: מרווה=sage. קמומיל=chamomile. שמן זית=olive oil. ' +
  'Always end your answer with a "Sources:" section listing URLs from the provided content.';

const SOURCES = [
  { name: 'Bara', url: 'https://bara.co.il/' },
  { name: 'AJCN', url: 'https://ajcn.nutrition.org/' },
  { name: 'NCCIH Herbs', url: 'https://www.nccih.nih.gov/health/herbsataglance' },
  { name: 'Naturopedia', url: 'https://www.naturopedia.com/' },
  { name: 'MedlinePlus', url: 'https://medlineplus.gov/' },
  { name: 'Trifolium', url: 'https://trifolium.co.il/%d7%90%d7%99%d7%a0%d7%93%d7%a7%d7%a1-%d7%a6%d7%9e%d7%97%d7%99-%d7%9e%d7%a8%d7%a4%d7%90/' },
];

const GROQ_MODEL = 'llama-3.1-8b-instant';

type SourceEntry = {
  url: string;
  title: string;
  text: string;
  sourceName: string;
};

let sourceIndex: SourceEntry[] = [];
let preloadDone = false;

const FETCH_TIMEOUT_MS = 5000;

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const { data, status } = await axios.get(url, {
      timeout: FETCH_TIMEOUT_MS,
      maxRedirects: 2,
      validateStatus: (c) => c < 500,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0' },
    });
    if (status >= 400) return null;
    return typeof data === 'string' ? data : String(data);
  } catch {
    return null;
  }
}

function extractText(html: string): { title: string; body: string } {
  const $ = cheerio.load(html);
  $('script, style, nav, header, footer, iframe, noscript, img, svg').remove();
  const title = $('title').text().replace(/\s+/g, ' ').trim();
  const body = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 2000);
  return { title: title || 'Unknown', body };
}

export async function preloadSources() {
  if (preloadDone) return;
  console.info('[preload] starting...');
  const start = Date.now();

  const results = await Promise.all(
    SOURCES.map(async (source) => {
      const html = await fetchHtml(source.url);
      if (!html) {
        console.warn(`[preload] failed: ${source.name}`);
        return null;
      }
      const { title, body } = extractText(html);
      return { url: source.url, title, text: body, sourceName: source.name };
    })
  );

  sourceIndex = results.filter((r): r is SourceEntry => r !== null && r.text.length > 30);
  preloadDone = true;
  console.info(`[preload] done! ${sourceIndex.length}/${SOURCES.length} pages in ${(Date.now() - start) / 1000}s`);
}

preloadSources();

const PLANT_TRANSLATIONS: Record<string, string[]> = {
  'מרווה': ['sage', 'salvia'],
  'קמומיל': ['chamomile', 'matricaria'],
  'שמן זית': ['olive oil', 'olive'],
  'ג\'ינג\'ר': ['ginger'],
  'ג\'ינגר': ['ginger'],
  'כורכום': ['turmeric', 'curcumin'],
  'נענע': ['mint', 'peppermint', 'mentha'],
  'אכינצאה': ['echinacea'],
  'ג\'ינקו': ['ginkgo', 'ginkgo biloba'],
  'שיבולת שועל': ['oat'],
  'שום': ['garlic', 'allium'],
  'לוונדר': ['lavender'],
  'לבנדר': ['lavender'],
  'אלוורה': ['aloe', 'aloe vera'],
  'היביסקוס': ['hibiscus'],
  'סנט ג\'ון': ['st john', 'hypericum'],
  'פסיפלורה': ['passion flower', 'passiflora'],
  'וולריאן': ['valerian'],
  'גלדיולה': ['gladiola'],
  'סויה': ['soy', 'soybean'],
  'חילבה': ['fenugreek'],
  'דקל ננסי': ['saw palmetto'],
  'שיער': ['hair'],
  'עור': ['skin'],
  'בטן': ['stomach', 'abdomen', 'belly', 'gut'],
  'כאב': ['pain', 'ache'],
  'עיכול': ['digestion', 'digestive'],
  'שינה': ['sleep', 'insomnia'],
  'חרדה': ['anxiety'],
  'דיכאון': ['depression'],
  'ראש': ['head', 'headache'],
  'לב': ['heart', 'cardiovascular'],
  'סוכרת': ['diabetes', 'blood sugar'],
  'לחץ דם': ['blood pressure', 'hypertension'],
  'דלקת': ['inflammation', 'inflammatory'],
  'אומגה': ['omega'],
  'ויטמין': ['vitamin'],
  'אבץ': ['zinc'],
  'ברזל': ['iron'],
  'מגנזיום': ['magnesium'],
  'סידן': ['calcium'],
};

function expandSearchTerms(query: string): string[] {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const expanded = new Set<string>(words);

  for (const word of words) {
    const translations = PLANT_TRANSLATIONS[word];
    if (translations) {
      for (const t of translations) {
        expanded.add(t);
      }
    }
  }

  return Array.from(expanded);
}

function searchIndex(query: string): SourceEntry[] {
  const terms = expandSearchTerms(query);

  return sourceIndex
    .map((src) => {
      const lower = src.text.toLowerCase() + ' ' + src.title.toLowerCase();
      const score = terms.filter((term) => lower.includes(term.toLowerCase())).length;
      return { src, score };
    })
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((m) => m.src);
}

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

type ChatRequest = { message: string; threadId?: string };

export async function POST(req: Request) {
  const { message, threadId }: ChatRequest = await req.json();
  const resolvedThreadId = threadId ?? 'default-thread';

  if (!message?.trim()) {
    return Response.json({ error: 'Message is required' }, { status: 400 });
  }

  const reqStart = Date.now();
  console.info('[chat] incoming', { messagePreview: message.slice(0, 100) });

  const matches = searchIndex(message);
  const sourcesFetched = matches.length;

  let userContent = `User asked: "${message}"`;

  if (matches.length > 0) {
    const context = matches
      .map((m) => `SOURCE: ${m.title} (${m.url})\n${m.text.slice(0, 400)}\n`)
      .join('\n');
    userContent += `\n\nRelevant sources:\n${context}\n\nAnswer based on this content. Cite URLs in Sources: section.`;
  } else {
    userContent += `\n\nNo matching content found. Answer from general knowledge and end with "Sources: לא נמצאו מקורות רלוונטיים במקורות שלנו."`;
  }

  console.info('[chat] prompt ready', {
    sourcesFound: matches.length,
    promptLength: userContent.length,
    elapsedMs: Date.now() - reqStart,
  });

  try {
    const groqStart = Date.now();
    const completion = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      model: GROQ_MODEL,
      temperature: 0.1,
      max_tokens: 512,
    });

    const text = completion.choices[0]?.message?.content ?? 'No response';

    console.info('[chat] done', {
      totalMs: Date.now() - reqStart,
      groqMs: Date.now() - groqStart,
      sourcesFetched,
      textLength: text.length,
      textPreview: text.slice(0, 100),
    });

    return Response.json({ text, sourcesFetched });
  } catch (error) {
    console.error('[chat] failed', { error });
    const errorMsg = error instanceof Error ? error.message : 'Agent failed';
    return Response.json({ error: errorMsg }, { status: 500 });
  }
}
