import Groq from 'groq-sdk';
import type { ChatCompletionMessageParam } from 'groq-sdk/resources/chat/completions';
import { queryHybridBotanicalKnowledge } from '@/lib/rag/hybrid-store';

const SYSTEM_PROMPT = `You are an expert botanical and herbal medicine assistant. You respond ONLY in Hebrew.

HOW TO ANSWER:
- CAREFULLY READ INTENT: Pay close attention to whether the user asks for plants that TREAT/HELP a condition vs plants that CAUSE/WORSEN a condition. Do not provide treatments if they asked for causes. If the sources only have treatments, explicitly state that the database only contains information on treating the condition.
- NAME MATCHING ACCURACY: You MUST accurately pair the Hebrew name with its correct scientific name. NEVER mix them up. For example, do not assign the name "Ashwagandha" to "פשטה משתרעת" (which is Bacopa).
- Use the provided Context Material as your PRIMARY source of information.
- You may SUPPLEMENT with your own botanical/medical knowledge when the sources are insufficient — especially for general questions asking about multiple plants.
- When the user asks a GENERAL question (e.g., "איזה צמחים עוזרים לסטרס?"), list MULTIPLE specific plants with their Hebrew name, scientific name, and a brief description of their benefits. Aim for at least 3-5 plants.
- When the user asks about a SPECIFIC plant by name, focus ONLY on that plant. Do NOT switch to a different plant.
- For follow-up questions with pronouns like "אותו" or "שלו", refer to the plant discussed earlier in the conversation.
- If the user asks "Are there more?" (האם יש עוד?), use your own expert knowledge to list additional relevant plants that were not mentioned previously, rather than just saying no.

- NEVER translate scientific Latin plant names into literal Hebrew words (e.g., NEVER translate "Inula" to "חמצן", "Oxygen", etc.). If you do not know the accepted Hebrew botanical name, just use the Latin name.
- NEVER confuse food recipes with plants! Do not treat words like "שקשוקה" (Shakshuka), "שייק" (Smoothie), or "מרק" (Soup) as plant names.
- NEVER list website menu categories (e.g., "חליטות צמחים", "פטריות בריאות"). Only name actual plants.
- NEVER tell the user to visit a website.
- NEVER use Chinese/Japanese/Korean characters.
- NEVER format as a table unless the user explicitly asks for one.

SOURCES SECTION:
End every answer with a "מקורות:" section listing the sources that contributed to your answer.
Format: * Article Title - https://... 
You MUST output the EXACT, REAL web address from the context starting with "http". NEVER just output [1], [2], etc. You MUST include the full http URL so the user can click it!
Use the REAL article title and REAL link from the context blocks. Never write "Page Title", "Site Name", or the literal word "URL".`;

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
    const contextDocs = await queryHybridBotanicalKnowledge(resolvedQuery, 4, secondaryQuery || undefined);

    let contextBlock = '';
    if (contextDocs.length > 0) {
      contextBlock = '\n\nContext Material:\n' +
        contextDocs.map((d, i) =>
          `[${i + 1}] ${d.title}\nURL: ${d.url}\n${d.content.slice(0, 500)}`
        ).join('\n\n');
    } else {
      contextBlock = '\n\nContext Material:\nNo relevant sources were found in the knowledge base.';
    }

    const enrichedSystemPrompt = SYSTEM_PROMPT + contextBlock;

    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: enrichedSystemPrompt },
    ];

    if (safeHistory.length > 0) {
      // Limit to last 4 messages (2 exchanges) to stay within token budget
      const recentHistory = safeHistory.slice(-4);
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
      temperature: 0.1,
    });

    const text = completion.choices[0]?.message?.content ?? 'No response';
    return Response.json({ text, sourcesFetched: contextDocs.length });
  } catch (error) {
    console.error('[chat] FATAL ERROR', { error });
    const errorMsg = error instanceof Error ? error.message : 'Agent failed';
    return Response.json({ error: errorMsg }, { status: 500 });
  }
}
