import Groq from 'groq-sdk';
import { browseBotanicalSites } from '@/lib/agent/browser-tool';

const SYSTEM_PROMPT = `You are a direct, expert botanical assistant.
Give concise, accurate plant guidance based ONLY on the provided sources.

CRITICAL RULES:
1. NEVER tell the user to "visit a website" or click a link.
2. FOCUS ON THERAPEUTIC VALUE: Explain exactly HOW the plant helps with the user's specific problem based on the text. DO NOT give botanical trivia or geographical history.
3. You are strictly forbidden from inventing information.
4. Respond ONLY in Hebrew. ABSOLUTELY NO Chinese, Japanese, or Korean characters.
5. NEVER place URLs inline inside your text response.

FORMATTING SOURCES (CRITICAL):
Do NOT use Markdown link syntax like [text](url).
Always end your answer with a "מקורות:" section.
List ONLY the specific, actual sources that provided the information.
Format each source as a simple text bullet: * Site Name - https://domain.com
Do not invent sources.`;

const GROQ_MODEL = 'llama-3.3-70b-versatile';

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

    const messages: any[] = [{ role: 'system', content: SYSTEM_PROMPT }];

    if (history && Array.isArray(history)) {
      history.forEach((msg) => {
        messages.push({ role: msg.role, content: msg.content });
      });
    }

    messages.push({ role: 'user', content: message });

    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY || 'dummy-build-key' });
    
    console.info('[chat] Calling Groq to evaluate tool usage...');
    
    const completion1 = await groq.chat.completions.create({
      messages: messages,
      model: GROQ_MODEL,
      temperature: 0.1,
      tools: [searchTool as any],
      tool_choice: 'auto',
    });

    const responseMessage = completion1.choices[0]?.message;
    
    if (responseMessage?.tool_calls && responseMessage.tool_calls.length > 0) {
      const toolCall = responseMessage.tool_calls[0];
      
      // Trust the LLM to format the keyword correctly based on the new strict Tool description
      let rawKeyword = JSON.parse(toolCall.function.arguments).search_keyword;
      
      // DEVOPS FIX: Regex Bouncer - Allow ONLY Hebrew letters and spaces. Strip everything else.
      let cleanKeyword = rawKeyword.replace(/[^א-ת\s]/g, '').trim();
      
      // Fallback in case the LLM completely hallucinated a non-Hebrew word and the string is now empty
      if (!cleanKeyword) {
        console.warn(`[chat] LLM hallucinated non-Hebrew keyword: ${rawKeyword}. Falling back to default.`);
        cleanKeyword = "ריכוז"; 
      }
      
      console.info(`[chat] LLM raw: "${rawKeyword}", Sanitized keyword: "${cleanKeyword}"`);
      
      const sites = await browseBotanicalSites(cleanKeyword, process.env.GROQ_API_KEY);
      
      const allContext = sites.length > 0
        ? sites.map((m) => {
            let cleanUrl = m.url;
            try { cleanUrl = new URL(m.url).origin; } catch(e){} 
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