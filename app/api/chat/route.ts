import { handleChatRequest } from '@/lib/controllers/chat.controller';

/**
 * מוקד ה-API הראשי של הצ'אט. (Next.js App Router API Route)
 * כל הלוגיקה המורכבת (RAG, הרחבת שאילתה, LLM) הוצאה ל-chat.controller.ts
 * כדי לשמור על קובץ זה "רזה" וקל לקריאה.
 */
export async function POST(req: Request) {
  return handleChatRequest(req);
}
