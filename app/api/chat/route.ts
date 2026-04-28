import { convertToModelMessages, streamText, type UIMessage } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

const ollama = createOpenAICompatible({
  name: 'ollama',
  apiKey: 'ollama',
  baseURL: process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434/v1',
});

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();
  const model = process.env.OLLAMA_MODEL ?? 'opencoder';
  const configuredMaxTokens = Number(process.env.OLLAMA_MAX_TOKENS ?? '100');
  const maxOutputTokens = Number.isFinite(configuredMaxTokens) && configuredMaxTokens > 0
    ? configuredMaxTokens
    : 100;
  const modelMessages = await convertToModelMessages(messages);

  const result = streamText({
    model: ollama(model),
    system:
      'You are a practical botanical assistant. Give concise, accurate plant guidance. ' +
      'If uncertain, say you are unsure. Do not invent facts. Prefer simple language.',
    messages: modelMessages,
    maxOutputTokens,
    temperature: 0.1,
  });

  return result.toUIMessageStreamResponse();
}