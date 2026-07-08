import { handleIngestionRequest } from '@/lib/controllers/ingestion.controller';

/**
 * מוקד ה-API להזרקת מידע (Ingestion).
 * הלוגיקה המלאה (חיבור ל-Pinecone ושמירה למטמון) הועברה ל-ingestion.controller.ts
 * כדי לשמור על הארכיטקטורה נקייה ומסודרת.
 */
export async function POST(req: Request) {
  return handleIngestionRequest(req);
}
