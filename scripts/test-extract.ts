import { queryHybridBotanicalKnowledge } from '../lib/rag/hybrid-store';
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

const GROQ_MODEL = 'llama-3.1-8b-instant';

async function testExtract() {
  const entity = 'גרעיני חמניה';
  console.log(`🧪 Diagnosing /api/extract-profile locally for: "${entity}"...`);

  try {
    console.log('1. Testing RAG hybrid store query...');
    const contextDocs = await queryHybridBotanicalKnowledge(entity, 3);
    console.log(`RAG returned ${contextDocs.length} documents.`);

    let contextBlock = '';
    if (contextDocs.length > 0) {
      contextBlock = '\n\nContext Material:\n' +
        contextDocs.map((d, i) =>
          `[${i + 1}] ${d.title}\n${d.content.slice(0, 2000)}`
        ).join('\n\n');
    } else {
      contextBlock = '\n\nContext Material:\nNo specific sources found in current knowledge base, compile standard clinical values.';
    }

    const enrichedSystemPrompt = EXTRACTION_SYSTEM_PROMPT + contextBlock;

    console.log('2. Querying Groq API...');
    const apiKey = process.env.GROQ_API_KEY;
    console.log('GROQ_API_KEY presence:', !!apiKey);

    if (!apiKey) {
      throw new Error('GROQ_API_KEY is not defined in environment!');
    }

    const groq = new Groq({ apiKey });

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
    console.log('Groq returned content successfully.');
    
    console.log('3. Parsing JSON output...');
    const parsed = JSON.parse(responseText);
    console.log('Parsed successfully:', JSON.stringify(parsed, null, 2).slice(0, 300) + '...');
  } catch (error) {
    console.error('❌ Diagnostic failed with error:', error);
  }
}

testExtract();
