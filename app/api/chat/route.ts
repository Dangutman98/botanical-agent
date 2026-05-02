import axios from 'axios';
import * as cheerio from 'cheerio';
import Groq from 'groq-sdk';

const SYSTEM_PROMPT =
  'You are a practical botanical assistant. Give concise, accurate plant guidance. ' +
  'If uncertain, say you are unsure. Do not invent facts. Prefer simple language. ' +
  'IMPORTANT: You must respond ONLY in the language the user uses (Hebrew or English). NEVER use Chinese, Korean, or any other language. ' +
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

let groqClient: Groq | null = null;
function getGroq(): Groq {
  if (!groqClient) {
    groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY || 'dummy-build-key' });
  }
  return groqClient;
}

type ChatRequest = { message: string; threadId?: string };

export async function POST(req: Request) {
  const isColdStart = !preloadDone;
  if (isColdStart) console.info('[chat] cold start detected, waiting for preload...');

  const { message, threadId }: ChatRequest = await req.json();
  const resolvedThreadId = threadId ?? 'default-thread';

  if (!message?.trim()) {
    return Response.json({ error: 'Message is required' }, { status: 400 });
  }

  const reqStart = Date.now();
  console.info('[chat] incoming', { messagePreview: message.slice(0, 100), coldStart: isColdStart });

  if (!preloadDone) {
    await preloadSources();
  }

  // Send all preloaded content to the model
  const allContext = sourceIndex.length > 0
    ? sourceIndex.map((m) => `SOURCE: ${m.title} (${m.url})\n${m.text.slice(0, 400)}\n`).join('\n')
    : 'No sources were loaded.';

  const userContent = `User asked: "${message}"\n\nHere is the content from our sources:\n${allContext}\n\nAnswer based on this content. Cite URLs in Sources: section.`;

  console.info('[chat] prompt ready', {
    totalSources: sourceIndex.length,
    promptLength: userContent.length,
    elapsedMs: Date.now() - reqStart,
  });

  try {
    const groqStart = Date.now();
    const completion = await getGroq().chat.completions.create({
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
      sourcesFetched: sourceIndex.length,
      textLength: text.length,
      textPreview: text.slice(0, 100),
    });

    return Response.json({ text, sourcesFetched: sourceIndex.length, coldStart: isColdStart });
  } catch (error) {
    console.error('[chat] failed', { error });
    const errorMsg = error instanceof Error ? error.message : 'Agent failed';
    return Response.json({ error: errorMsg }, { status: 500 });
  }
}
