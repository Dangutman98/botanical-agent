import { queryHybridBotanicalKnowledge } from '@/lib/rag/hybrid-store';
import Groq from 'groq-sdk';

const EXTRACTION_SYSTEM_PROMPT = `You are a clinical database extractor.
You extract structured, precise nutritional, chemical, and vitamin profiles for specific plants/herbs/vegetables/seeds based ONLY on the provided sources.

You MUST respond with a valid, clean JSON object matching this schema exactly, and nothing else (no markdown wrapping, no extra text, just raw JSON):
{
  "entity": "שם הצמח בעברית",
  "profile": [
    {
      "component": "שם הרכיב (למשל: ויטמין C, אשלגן, ג'ינג'רול, סיבים תזונתיים)",
      "type": "סוג (חומר פעיל | ויטמין | מינרל | רכיב תזונתי)",
      "value": "ערך / ריכוז או תיאור כמותי (למשל: 12 מ\"ג ל-100 גרם, ריכוז גבוה, נוכחות מתונה)",
      "indication": "התוויה קלינית קצרה (למשל: שיכוך כאבים, תמיכה במערכת העצבים, הגברת ספיגת ברזל)"
    }
  ],
  "contraindications": "התוויות נגד ואזהרות קליניות קצרות וברורות (למשל: אסור לנשים הרות, שילוב מסוכן עם מדללי דם). אם אין מידע, רשום 'לא נמצאו התוויות נגד רלוונטיות במאגר'."
}

If no components are mentioned in the sources, compile common clinical/naturopathic knowledge for that specific plant to populate at least 4 key components so the naturopath always gets a highly useful clinical sheet.
Respond ONLY in Hebrew.`;

const GROQ_MODEL = 'llama-3.3-70b-versatile';

type ExtractionRequest = {
  entity: string;
};

export async function POST(req: Request) {
  try {
    const { entity }: ExtractionRequest = await req.json();

    if (!entity || entity.toLowerCase() === 'none') {
      return Response.json({ error: 'Entity is required' }, { status: 400 });
    }

    console.info(`[extract-profile] Fetching botanical RAG context for: "${entity}"...`);
    const contextDocs = await queryHybridBotanicalKnowledge(entity, 3);

    let contextBlock = '';
    if (contextDocs.length > 0) {
      contextBlock = '\n\nContext Material:\n' +
        contextDocs.map((d, i) =>
          `[${i + 1}] ${d.title}\n${d.content}`
        ).join('\n\n');
    } else {
      contextBlock = '\n\nContext Material:\nNo specific sources found in current knowledge base, compile standard clinical values.';
    }

    const enrichedSystemPrompt = EXTRACTION_SYSTEM_PROMPT + contextBlock;

    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY || 'dummy-build-key' });

    console.info(`[extract-profile] Querying Groq JSON for: "${entity}"...`);
    const completion = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: enrichedSystemPrompt },
        { role: 'user', content: `חלץ פרופיל רכיבים קליני מפורט עבור הצמח/מזון: ${entity}` }
      ],
      model: GROQ_MODEL,
      response_format: { type: 'json_object' },
      temperature: 0.2
    });

    const responseText = completion.choices[0]?.message?.content || '{}';
    const profileJson = JSON.parse(responseText);

    return Response.json(profileJson);
  } catch (error) {
    console.error('[extract-profile] FATAL ERROR:', error);
    const errorMsg = error instanceof Error ? error.message : 'Extraction failed';
    return Response.json({ error: errorMsg }, { status: 500 });
  }
}
