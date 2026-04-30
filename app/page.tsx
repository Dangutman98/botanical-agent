'use client';

import { useState } from 'react';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  sources?: string[];
  sourcesFetched?: number;
};

function parseSources(text: string): { content: string; sources: string[] } {
  const match = text.match(/^(.*?)(\n\s*Sources?\s*:?\s*\n?)([\s\S]*)$/i);
  if (match) {
    const content = match[1].trim();
    const sourcesBlock = match[3].trim();
    const sources = sourcesBlock
      .split(/\n/)
      .map((line) => line.replace(/^[-•*]\s*/, '').trim())
      .filter(Boolean);
    return { content, sources };
  }
  return { content: text, sources: [] };
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  const { content, sources } = isUser ? { content: message.text, sources: [] } : parseSources(message.text);
  const sourcesFetched = isUser ? 0 : (message.sourcesFetched ?? 0);

  if (isUser) {
    return (
      <div className="animate-fadeIn flex justify-start mb-4">
        <div className="max-w-[80%] rounded-2xl rounded-br-md px-5 py-3 text-white" style={{ background: 'var(--user-bubble)' }}>
          <p className="leading-relaxed">{content}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fadeIn flex justify-end mb-4">
      <div className="max-w-[85%] rounded-2xl rounded-bl-md px-5 py-3" style={{ background: 'var(--agent-bubble)', boxShadow: '0 2px 8px var(--shadow)' }}>
        {sourcesFetched > 0 && (
          <div className="mb-2 flex items-center gap-1" style={{ color: 'var(--accent)', opacity: 0.7 }}>
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <span className="text-xs font-medium">נבדקו {sourcesFetched} מקורות</span>
          </div>
        )}
        <div className="mb-2">
          <p className="leading-relaxed" style={{ color: 'var(--agent-text)', whiteSpace: 'pre-line' }}>
            {content}
          </p>
        </div>
        {sources.length > 0 && (
          <div className="mt-3 pt-3 border-t" style={{ borderColor: 'var(--accent-light)' }}>
            <div className="flex items-center gap-1 mb-2" style={{ color: 'var(--accent)' }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
              <span className="text-sm font-semibold">מקורות</span>
            </div>
            <div className="space-y-1">
              {sources.map((src, i) => {
                const url = src.startsWith('http') ? src : null;
                return (
                  <div key={i} className="rounded-md px-3 py-1.5 text-sm" style={{ background: 'var(--source-bg)' }}>
                    {url ? (
                      <a href={url} target="_blank" rel="noopener noreferrer" className="underline hover:no-underline" style={{ color: 'var(--accent)', wordBreak: 'break-all' }}>
                        {url}
                      </a>
                    ) : (
                      <span style={{ color: 'var(--agent-text)', opacity: 0.7 }}>{src}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Chat() {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<'ready' | 'submitted'>('ready');
  const [error, setError] = useState<string | null>(null);
  const [threadId] = useState(() => crypto.randomUUID());

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = input.trim();
    if (!text) return;

    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: 'user', text };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setStatus('submitted');
    setError(null);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, threadId }),
      });

      if (response.status === 429) {
        setError('המכסה של ה-API אזלה. נסה שוב בעוד מספר דקות.');
        return;
      }

      if (!response.ok) {
        throw new Error('הבקשה נכשלה');
      }

      const data: { text?: string; sourcesFetched?: number } = await response.json();
      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        text: data.text ?? 'אין תשובה',
        sourcesFetched: data.sourcesFetched,
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch {
      setError('הבקשה נכשלה. נסה שוב.');
    } finally {
      setStatus('ready');
    }
  };

  return (
    <div className="flex flex-col w-full min-h-screen" dir="rtl">
      <header className="sticky top-0 z-10 px-4 py-4 text-center border-b backdrop-blur-md" style={{ background: 'var(--background)', borderColor: 'var(--accent-light)' }}>
        <h1 className="text-xl font-bold" style={{ color: 'var(--accent)' }}>🌿 העוזר הבוטני</h1>
        <p className="text-xs mt-1" style={{ color: 'var(--foreground)', opacity: 0.5 }}>שאל שאלות על צמחי מרפא</p>
      </header>

      <main className="flex-1 px-4 py-6 max-w-xl mx-auto w-full">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center" style={{ color: 'var(--foreground)', opacity: 0.6 }}>
            <span className="text-5xl mb-4">🌱</span>
            <p className="text-lg font-medium mb-2">שלום! אני העוזר הבוטני שלך</p>
            <p className="text-sm">שאל שאלות על צמחי מרפא ואקבל מידע ממקורות מהימנים</p>
          </div>
        )}

        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}

        {status === 'submitted' && (
          <div className="flex justify-end mb-4 animate-fadeIn">
            <div className="rounded-2xl rounded-bl-md px-5 py-3" style={{ background: 'var(--agent-bubble)', boxShadow: '0 2px 8px var(--shadow)' }}>
              <div className="animate-pulse-dots">
                <span className="text-xl" style={{ color: 'var(--accent)' }}>.</span>
                <span className="text-xl" style={{ color: 'var(--accent)' }}>.</span>
                <span className="text-xl" style={{ color: 'var(--accent)' }}>.</span>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="animate-fadeIn rounded-xl border px-4 py-3 mb-4 text-center text-sm" style={{ background: '#fdecea', borderColor: '#f5c6cb', color: '#721c24' }}>
            {error}
          </div>
        )}
      </main>

      <footer className="sticky bottom-0 px-4 py-4 backdrop-blur-md" style={{ background: 'var(--background)' }}>
        <form onSubmit={handleSubmit} className="max-w-xl mx-auto flex gap-2">
          <input
            type="text"
            className="flex-1 rounded-xl px-4 py-3 border outline-none text-sm transition-all focus:ring-2"
            style={{ borderColor: 'var(--accent-light)', background: 'var(--agent-bubble)', color: 'var(--foreground)' }}
            value={input}
            placeholder="שאל שאלה על צמחים..."
            onChange={(e) => setInput(e.target.value)}
            disabled={status === 'submitted'}
            dir="rtl"
          />
          <button
            type="submit"
            className="rounded-xl px-6 py-3 text-white text-sm font-medium transition-all hover:opacity-90 disabled:opacity-50 cursor-pointer"
            style={{ background: 'var(--accent)' }}
            disabled={!input.trim() || status === 'submitted'}
          >
            שלח
          </button>
        </form>
      </footer>
    </div>
  );
}
