import Groq from 'groq-sdk';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'groq-sdk/resources/chat/completions';
import { browseBotanicalSites } from '@/lib/agent/browser-tool';

const SYSTEM_PROMPT = `You are a direct, expert botanical assistant.
Give concise, accurate plant guidance based ONLY on the provided sources.

CRITICAL RULES:
1. NEVER tell the user to "visit a website" or click a link.
2. FOCUS ON SPECIFIC PLANTS: You MUST name the actual specific herbs/plants found in the text (e.g., "בקופה", "רודיולה", "ג'ינקו", "ויטניה").
3. DO NOT LIST WEBSITE MENUS: Ignore generic site categories like "חליטות צמחים", "פטריות בריאות", "צמחי מרפא עתיקים", or "שמנים אתריים". Extract the actual therapeutic plants mentioned in the article body!
4. If the source text does not mention specific plant names, respond with "המאמרים שנמצאו לא ציינו שמות ספציפיים של צמחים". Do not invent plants.
5. Respond ONLY in Hebrew. ABSOLUTELY NO Chinese, Japanese, or Korean characters.

FORMATTING SOURCES (CRITICAL):
Do NOT use Markdown link syntax like [text](url).
Always end your answer with a "מקורות:" section.
You MUST list EVERY source that contributed to your answer. If you reviewed 6 sources and extracted plants from 4 of them, list all 4.
Format each source as a simple text bullet: * Site Name - https://domain.com`;

const GROQ_MODEL = 'llama-3.1-8b-instant';

// The Tool definition is now MUCH stricter about how to construct the query
const searchTool = {
  type: 'function',
  function: {
    name: 'search_botanical_sites',
    description: 'Search botanical websites for information based on a core medical concept.',
    parameters: {
      type: 'object',
      properties: {
        search_keyword: {
          type: 'string',
          description: 'Extract the core medical condition, symptom, or system from the user prompt. CRITICAL: Use EXACTLY ONE OR TWO WORDS in Hebrew. EXAMPLES: If user asks "צמחים לשיפור הריכוז" -> output "ריכוז". If user asks "הפרעות קשב וריכוז" -> output "קשב וריכוז". If user asks "בעיות עיכול קשות" -> output "עיכול". NEVER include filler words like "צמחים", "עבור", "טיפול", "הכי טובים".',
        },
      },
      required: ['search_keyword'],
    },
  },
};

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

    const messages: ChatCompletionMessageParam[] = [{ role: 'system', content: SYSTEM_PROMPT }];

    if (history && Array.isArray(history)) {
      history.forEach((msg) => {
        messages.push({ role: msg.role, content: msg.content });
      });
    }

    messages.push({ role: 'user', content: message });

    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY || 'dummy-build-key' });
    
    console.info('[chat] Calling Groq to evaluate tool usage...');
    
    let responseMessage;
    try {
      const completion1 = await groq.chat.completions.create({
        messages: messages,
        model: GROQ_MODEL,
        temperature: 0.1,
        tools: [searchTool as unknown as ChatCompletionTool],
        tool_choice: 'auto',
      });
      responseMessage = completion1.choices[0]?.message;
    } catch (toolError) {
      console.error('[chat] Tool call failed, falling back to plain LLM:', toolError);
      const fallbackCompletion = await groq.chat.completions.create({
        messages: messages,
        model: GROQ_MODEL,
        temperature: 0.1,
      });
      const text = fallbackCompletion.choices[0]?.message?.content ?? 'No response';
      return Response.json({ text, sourcesFetched: 0 });
    }

    if (responseMessage?.tool_calls && responseMessage.tool_calls.length > 0) {
      const toolCall = responseMessage.tool_calls[0];
      
      let rawKeyword = "ריכוז"; // Default fallback
      
      // DEVOPS FIX: Safely parse the LLM's JSON. If the LLM goes crazy and breaks the JSON, 
      // we catch the error, log it, and use the default keyword instead of crashing the server.
      try {
        const parsedArgs = JSON.parse(toolCall.function.arguments);
        if (parsedArgs && parsedArgs.search_keyword) {
           rawKeyword = parsedArgs.search_keyword;
        }
      } catch {
        console.error(`[chat] LLM returned invalid JSON for tool arguments:`, toolCall.function.arguments);
      }
      
      // The rest of the Regex Bouncer remains the same
      let cleanKeyword = rawKeyword.replace(/[^א-ת\s]/g, '').trim();
      
      if (!cleanKeyword) {
        console.warn(`[chat] Sanitized keyword is empty. Falling back to default.`);
        cleanKeyword = "ריכוז"; 
      }
      
      console.info(`[chat] LLM raw: "${rawKeyword}", Sanitized keyword: "${cleanKeyword}"`);
      
      const sites = await browseBotanicalSites(cleanKeyword, process.env.GROQ_API_KEY);
      
      const allContext = sites.length > 0
        ? sites.map((m) => {
            let cleanUrl = m.url;
            try { cleanUrl = new URL(m.url).origin; } catch{} 
            return `SOURCE: ${m.title} (${cleanUrl})\n${m.content}\n`;
          }).join('\n')
        : 'No relevant sources were found.';
      
      messages.push(responseMessage);
      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: `Search Results for "${cleanKeyword}":\n\n${allContext}`,
      });
      
      const finalCompletion = await groq.chat.completions.create({
        messages: messages,
        model: GROQ_MODEL,
        temperature: 0.1,
      });
      
      const text = finalCompletion.choices[0]?.message?.content ?? 'No response';
      return Response.json({ text, sourcesFetched: sites.length });
    }
    
    const text = responseMessage?.content ?? 'No response';
    return Response.json({ text, sourcesFetched: 0 });

  } catch (error) {
    console.error('[chat] FATAL ERROR', { error });
    const errorMsg = error instanceof Error ? error.message : 'Agent failed';
    return Response.json({ error: errorMsg }, { status: 500 });
  }
}