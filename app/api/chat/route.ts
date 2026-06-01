import Groq from 'groq-sdk';
import type { ChatCompletionMessageParam } from 'groq-sdk/resources/chat/completions';
import { queryHybridBotanicalKnowledge } from '@/lib/rag/hybrid-store';

const SYSTEM_PROMPT = `You are a direct, expert botanical assistant.
Give concise, accurate plant guidance based ONLY on the provided sources.

CRITICAL RULES:
1. NEVER tell the user to "visit a website" or click a link.
2. FOCUS ON SPECIFIC PLANTS: You MUST name the actual specific herbs/plants found in the text (e.g., "בקופה", "רודיולה", "ג'ינקו", "ויטניה").
3. DO NOT LIST WEBSITE MENUS: Ignore generic site categories like "חליטות צמחים", "פטריות בריאות", "צמחי מרפא עתיקים", or "שמנים אתריים". Extract the actual therapeutic plants mentioned in the article body!
4. If the source text does not mention specific plant names, respond with "המאמרים שנמצאו לא ציינו שמות ספציפיים של צמחים". Do not invent plants.
5. Respond ONLY in Hebrew. ABSOLUTELY NO Chinese, Japanese, or Korean characters.
6. MANDATORY MARKDOWN TABLES: Whenever the user asks for a table, a list of active components, or a plant profile, you MUST format the response inside a structured Markdown table using '|' column separators. This is essential for the system's spreadsheet export tool.

FORMATTING SOURCES (CRITICAL):
Do NOT use Markdown link syntax like [text](url).
Always end your answer with a "מקורות:" section.
You MUST list EVERY source that contributed to your answer.
Format each source as a simple text bullet with the actual article/page title (or site name) and the URL: * Page Title - https://domain.com/url (strictly avoid using the generic placeholder "Site Name").`;

const GROQ_MODEL = 'llama-3.3-70b-versatile';

type ChatRequest = {
  message: string;
  history?: { role: 'user' | 'assistant'; content: string }[]
};

export async function POST(req: Request) {
  try {
    const { message, history }: ChatRequest = await req.json();

    if (!message?.trim()) {
      return Response.json({ error: 'Message is required' }, { status: 400 });
    }

    console.info('[chat] Querying hybrid vector store...');
    const contextDocs = await queryHybridBotanicalKnowledge(message, 5);

    let contextBlock = '';
    if (contextDocs.length > 0) {
      contextBlock = '\n\nContext Material:\n' +
        contextDocs.map((d, i) =>
          `[${i + 1}] ${d.title}\nURL: ${d.url}\n${d.content.slice(0, 2000)}`
        ).join('\n\n');
    } else {
      contextBlock = '\n\nContext Material:\nNo relevant sources were found in the knowledge base.';
    }

    const enrichedSystemPrompt = SYSTEM_PROMPT + contextBlock;

    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: enrichedSystemPrompt },
    ];

    if (history && Array.isArray(history)) {
      for (const msg of history) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    messages.push({ role: 'user', content: message });

    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY || 'dummy-build-key' });

    console.info('[chat] Sending to Groq for final answer...');
    const completion = await groq.chat.completions.create({
      messages,
      model: GROQ_MODEL,
      temperature: 0.4,
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
