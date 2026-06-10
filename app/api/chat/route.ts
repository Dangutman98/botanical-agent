import Groq from 'groq-sdk';
import type { ChatCompletionMessageParam } from 'groq-sdk/resources/chat/completions';
import { queryHybridBotanicalKnowledge } from '@/lib/rag/hybrid-store';

const SYSTEM_PROMPT = `You are a direct, expert botanical and herbal medicine assistant.
Give concise, accurate plant guidance based ONLY on the provided sources.

CRITICAL RULES:
1. NEVER tell the user to "visit a website" or click a link.
2. FOCUS ON SPECIFIC PLANTS: You MUST name the actual specific herbs/plants found in the text (e.g., "בקופה", "רודיולה", "ג'ינקו", "ויטניה").
3. DO NOT LIST WEBSITE MENUS: Ignore generic site categories like "חליטות צמחים", "פטריות בריאות", "צמחי מרפא עתיקים", or "שמנים אתריים". Extract the actual therapeutic plants mentioned in the article body!
4. If the source text does not mention specific plant names, respond with "המאמרים שנמצאו לא ציינו שמות ספציפיים של צמחים". Do not invent plants.
5. Respond ONLY in Hebrew. ABSOLUTELY NO Chinese, Japanese, or Korean characters.
6. MARKDOWN TABLES: ONLY format the response as a Markdown table when the user explicitly requests a table or spreadsheet. For general conversational questions, respond with clear text, bullet points, or paragraphs.

TOPIC DISCIPLINE (CRITICAL):
7. NEVER switch topics! If the user asked about a SPECIFIC plant (e.g., ריישי / reishi), ALL of your answer must be about THAT plant only.
8. If a source document mentions multiple plants (e.g., ריישי AND שיטאקה), extract ONLY the information about the plant the user asked about. Ignore all other plants in that document.
9. This rule applies ONLY when the user asks about a SPECIFIC plant by name: If the retrieved sources do NOT contain relevant information about that specific plant, say "לא נמצא מידע רלוונטי במאגרים" — do NOT substitute with a different plant. However, for GENERAL questions (e.g., "איזה צמחים עוזרים לסטרס", "מה טוב לשינה"), you MUST answer with ALL relevant plants found in the sources.
10. For follow-up questions (e.g., "מה הדרך הכי טובה לצרוך אותו"), always refer to the plant from the previous conversation context. NEVER introduce a new plant topic.

FORMATTING SOURCES (CRITICAL):
Do NOT use Markdown link syntax like [text](url).
Always end your answer with a "מקורות:" section.
You MUST list EVERY source that contributed to your answer.
Format each source as a simple text bullet using the ACTUAL article title from the context (not a generic placeholder) followed by the URL.
Example: * ריישי - יתרונות בריאותיים - https://bara.co.il/reishi/
NEVER write generic text like "Page Title" or "Site Name" — always use the real title from the [N] context blocks above.`;

const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';

type ChatRequest = {
  message: string;
  history?: { role: 'user' | 'assistant'; content: string }[]
};

/**
 * Uses a fast Groq LLM call to resolve pronouns, expand context, and translate the query
 * into bilingual search terms so BM25 can match across Hebrew and English databases.
 */
async function expandQueryWithContext(
  message: string,
  history: { role: 'user' | 'assistant'; content: string }[]
): Promise<{ resolvedQuery: string; secondaryQuery: string }> {
  // If no history, just generate a translation
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY || 'dummy-build-key' });

  const recentHistory = history.slice(-4); // last 2 exchanges

  const contextMessages: ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: `You are a query expansion assistant for a botanical knowledge base.
Your job is to take the user's latest message and conversation history, then output TWO things:
1. "resolved": The user's message with ALL pronouns and references resolved to explicit plant/herb names from conversation context. If the message already has an explicit plant name, keep it. If no context clues exist, return the message as-is.
2. "secondary": A translation of the key botanical search terms to the OTHER language. If the input is in Hebrew, provide English botanical terms. If in English, provide Hebrew terms. Include the plant name, common names, and 2-3 relevant keywords.

IMPORTANT: Output ONLY a valid JSON object, nothing else. Example:
{"resolved": "מה היתרונות הבריאותיים של ריישי", "secondary": "reishi ganoderma lucidum health benefits"}

Another example:
{"resolved": "what are the benefits of astragalus", "secondary": "אסטרגלוס קטב חלבוני יתרונות בריאותיים"}`,
    },
  ];

  // Add recent chat history for context
  for (const msg of recentHistory) {
    contextMessages.push({ role: msg.role, content: msg.content.slice(0, 300) });
  }

  contextMessages.push({ role: 'user', content: `Expand this query: "${message}"` });

  try {
    const completion = await groq.chat.completions.create({
      messages: contextMessages,
      model: GROQ_MODEL,
      temperature: 0,
      max_tokens: 200,
    });

    const raw = completion.choices[0]?.message?.content?.trim() || '';
    console.info('[chat] Query expansion raw output:', raw);

    // Parse JSON response
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        resolvedQuery: parsed.resolved || message,
        secondaryQuery: parsed.secondary || '',
      };
    }
  } catch (error) {
    console.warn('[chat] Query expansion failed, using original message:', error);
  }

  // Fallback: use original message
  return { resolvedQuery: message, secondaryQuery: '' };
}

export async function POST(req: Request) {
  try {
    const { message, history }: ChatRequest = await req.json();

    if (!message?.trim()) {
      return Response.json({ error: 'Message is required' }, { status: 400 });
    }

    // Step 1: Expand the query with context resolution + bilingual translation
    const safeHistory = (history && Array.isArray(history)) ? history : [];
    console.info('[chat] Expanding query with context...');
    const { resolvedQuery, secondaryQuery } = await expandQueryWithContext(message, safeHistory);
    console.info(`[chat] Resolved query: "${resolvedQuery}"`);
    console.info(`[chat] Secondary (bilingual) query: "${secondaryQuery}"`);

    // Step 2: Query hybrid vector store with the expanded bilingual queries
    console.info('[chat] Querying hybrid vector store...');
    const contextDocs = await queryHybridBotanicalKnowledge(resolvedQuery, 6, secondaryQuery || undefined);

    let contextBlock = '';
    if (contextDocs.length > 0) {
      contextBlock = '\n\nContext Material:\n' +
        contextDocs.map((d, i) =>
          `[${i + 1}] ${d.title}\nURL: ${d.url}\n${d.content.slice(0, 800)}`
        ).join('\n\n');
    } else {
      contextBlock = '\n\nContext Material:\nNo relevant sources were found in the knowledge base.';
    }

    const enrichedSystemPrompt = SYSTEM_PROMPT + contextBlock;

    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: enrichedSystemPrompt },
    ];

    if (safeHistory.length > 0) {
      // Limit to last 6 messages (3 exchanges) to stay within token budget
      const recentHistory = safeHistory.slice(-6);
      for (const msg of recentHistory) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    messages.push({ role: 'user', content: message });

    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY || 'dummy-build-key' });

    console.info('[chat] Sending to Groq for final answer...');
    const completion = await groq.chat.completions.create({
      messages,
      model: GROQ_MODEL,
      temperature: 0.3,
      frequency_penalty: 0.5,
    });

    const text = completion.choices[0]?.message?.content ?? 'No response';
    return Response.json({ text, sourcesFetched: contextDocs.length });
  } catch (error) {
    console.error('[chat] FATAL ERROR', { error });
    const errorMsg = error instanceof Error ? error.message : 'Agent failed';
    return Response.json({ error: errorMsg }, { status: 500 });
  }
}
