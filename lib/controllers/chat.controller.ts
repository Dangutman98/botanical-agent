import Groq from 'groq-sdk';
import type { ChatCompletionMessageParam } from 'groq-sdk/resources/chat/completions';
import { queryHybridBotanicalKnowledge } from '@/lib/rag/hybrid-store';

const SYSTEM_PROMPT = `You are an expert botanical and herbal medicine assistant. You respond ONLY in Hebrew.

GROUNDING (STRICT — highest priority rule):
- Answer ONLY using the provided Context Material. Do NOT supplement with your own botanical or medical
  knowledge, even for general questions, even if you are confident the information is correct.
- If the Context Material does not contain enough information to answer the question, say so explicitly
  in Hebrew (e.g. "אין לי מספיק מידע על כך במאגר הנוכחי") instead of guessing or filling gaps from memory.
  In that case, do NOT include a "מקורות:" section at all — the sources you were given were judged
  insufficient, so listing them as if they supported an answer would be misleading. Only list sources
  you actually relied on to construct a real answer.
- If the user asks "Are there more?" (האם יש עוד?) and the context has no additional plants, say plainly
  that the database has nothing further — do not invent additional plants from your own knowledge.
- This assistant is not a substitute for professional medical advice. Never state or imply a dosage,
  drug interaction, or safety claim that is not directly supported by the Context Material.

HOW TO ANSWER:
- CAREFULLY READ INTENT: Pay close attention to whether the user asks for plants that TREAT/HELP a condition vs plants that CAUSE/WORSEN a condition. Do not provide treatments if they asked for causes. If the sources only have treatments, explicitly state that the database only contains information on treating the condition.
- NAME MATCHING ACCURACY: You MUST accurately pair the Hebrew name with its correct scientific name. NEVER mix them up. For example, do not assign the name "Ashwagandha" to "פשטה משתרעת" (which is Bacopa).
- When the user asks a GENERAL question (e.g., "איזה צמחים עוזרים לסטרס?"), list the specific plants that ARE present in the Context Material, with their Hebrew name, scientific name, and a brief description grounded in the sources. If fewer than 3 plants are covered by the sources, list only those and say the database covers a limited number for this topic.
- When the user asks about a SPECIFIC plant by name, focus ONLY on that plant. Do NOT switch to a different plant.
- For follow-up questions with pronouns like "אותו" or "שלו", refer to the plant discussed earlier in the conversation.

- NEVER translate scientific Latin plant names into literal Hebrew words (e.g., NEVER translate "Inula" to "חמצן", "Oxygen", etc.). If you do not know the accepted Hebrew botanical name, just use the Latin name.
- NEVER confuse food recipes with plants! Do not treat words like "שקשוקה" (Shakshuka), "שייק" (Smoothie), or "מרק" (Soup) as plant names.
- NEVER list website menu categories (e.g., "חליטות צמחים", "פטריות בריאות"). Only name actual plants.
- NEVER tell the user to visit a website.
- NEVER use Chinese/Japanese/Korean characters.
- NEVER format as a table unless the user explicitly asks for one.

SOURCES SECTION:
If — and only if — you gave a real, grounded answer, end it with a "מקורות:" section listing the
sources that actually contributed to that answer. If you said the database has insufficient
information, skip this section entirely (see GROUNDING above).
Format: * Article Title - https://...
You MUST output the EXACT, REAL web address from the context starting with "http". NEVER just output [1], [2], etc. You MUST include the full http URL so the user can click it!
Use the REAL article title and REAL link from the context blocks. Never write "Page Title", "Site Name", or the literal word "URL".`;

const NO_CONTEXT_RESPONSE =
  'אין לי מספיק מידע על כך במאגר הנוכחי. נסו לנסח את השאלה אחרת או לשאול על צמח ספציפי אחר.';

// Groq deprecates/removes models with little notice (llama-3.1-8b-instant, the previous default,
// was silently returning 404s in production before this check existed). Fail loudly instead of
// discovering it via a wall of 500s.
const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const KNOWN_GOOD_GROQ_MODELS = new Set([
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'qwen/qwen3.8-27b',
  'qwen/qwen3.6-27b',
  'groq/compound',
  'groq/compound-mini',
]);
let modelAvailabilityChecked = false;

async function assertGroqModelAvailable(groq: Groq): Promise<void> {
  if (modelAvailabilityChecked) return;
  modelAvailabilityChecked = true;

  if (KNOWN_GOOD_GROQ_MODELS.has(GROQ_MODEL)) return; // fast path, no network call

  try {
    const models = await groq.models.list();
    const available = new Set(models.data.map((m) => m.id));
    if (!available.has(GROQ_MODEL)) {
      console.error(
        `[chat] FATAL: configured GROQ_MODEL "${GROQ_MODEL}" is not available on this Groq account. ` +
          `Available models: ${[...available].join(', ')}`
      );
      throw new Error(`Groq model "${GROQ_MODEL}" is not available. Update GROQ_MODEL.`);
    }
  } catch (error) {
    // Network/auth failure checking availability shouldn't block a request that might still work;
    // an unknown model failure will still surface loudly from the completion call itself.
    console.warn('[chat] Could not verify Groq model availability:', error);
  }
}

type ChatRequest = {
  message: string;
  history?: { role: 'user' | 'assistant'; content: string }[]
};

/**
 * Controller: Handles chat requests by expanding query context, performing RAG search, and prompting Groq LLM.
 * Connects to:
 * 1. Groq LLM API (for query expansion and final generation)
 * 2. Hybrid RAG Store (hybrid-store.ts) -> Pinecone & BM25
 */
export async function handleChatRequest(req: Request) {
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
    const { results: contextDocs, denseSearchDegraded } = await queryHybridBotanicalKnowledge(resolvedQuery, 4, secondaryQuery || undefined);
    if (denseSearchDegraded) {
      console.warn('[chat] Dense (semantic) search was unavailable this request — answering from BM25 keyword search alone.');
    }

    // Code-level grounding guard: with zero retrieved documents there is nothing to ground an
    // answer in, so refuse before ever calling the LLM. This is a hard guarantee, not a prompt
    // request the model can talk itself out of.
    if (contextDocs.length === 0) {
      console.warn('[chat] No context documents retrieved — refusing without calling the LLM.');
      return Response.json({ text: NO_CONTEXT_RESPONSE, sourcesFetched: 0, grounded: false, denseSearchDegraded });
    }

    // Full document text, not truncated: precision over breadth. With only 4 documents
    // retrieved, the answer is more often limited by a fact living past the old 500-char
    // cutoff than by Groq's free-tier token budget.
    const contextBlock = '\n\nContext Material:\n' +
      contextDocs.map((d, i) =>
        `[${i + 1}] ${d.title}\nURL: ${d.url}\n${d.content}`
      ).join('\n\n');

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
    await assertGroqModelAvailable(groq);

    console.info('[chat] Sending to Groq for final answer...');
    const completion = await groq.chat.completions.create({
      messages,
      model: GROQ_MODEL,
      temperature: 0.1,
    });

    const text = completion.choices[0]?.message?.content ?? 'No response';
    return Response.json({ text, sourcesFetched: contextDocs.length, denseSearchDegraded });
  } catch (error) {
    console.error('[chat] FATAL ERROR', { error });
    const errorMsg = error instanceof Error ? error.message : 'Agent failed';
    return Response.json({ error: errorMsg }, { status: 500 });
  }
}

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
