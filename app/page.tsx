'use client';

import { useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '/api/chat';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
};

function parseSources(text: string): { content: string; sources: string[] } {
  const match = text.match(/^(.*?)(\n\s*מקורות:\s*\n?)([\s\S]*)$/i);
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

function renderMarkdown(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|https?:\/\/[^\s]+)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    if (part.startsWith('http://') || part.startsWith('https://')) {
      return <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="underline" style={{ color: 'var(--accent)' }}>{part}</a>;
    }
    return part;
  });
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  const { content, sources } = isUser ? { content: message.text, sources: [] } : parseSources(message.text);

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
        <div className="mb-2 leading-relaxed" style={{ color: 'var(--agent-text)', wordBreak: 'break-word', overflowWrap: 'break-word' }}>
          {content.split('\n').map((line, i) => (
            <p key={i} className="mb-1">{renderMarkdown(line)}</p>
          ))}
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
                const urlMatch = src.match(/(https?:\/\/[^\s]+)/);
                const url = urlMatch ? urlMatch[1] : '';
                const displayName = src.replace(/(https?:\/\/[^\s]+)/, '').replace(/-?\s*$/, '').trim();

                return (
                  <div key={i} className="rounded-md px-3 py-1.5 text-sm" style={{ background: 'var(--source-bg)' }}>
                    {url ? (
                      <a href={url} target="_blank" rel="noopener noreferrer"
                         className="underline hover:no-underline"
                         style={{ color: 'var(--accent)', wordBreak: 'break-all' }}>
                        {displayName || url}
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
  const [status, setStatus] = useState<'ready' | 'loading'>('ready');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = input.trim();
    if (!text) return;

    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: 'user', text };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setStatus('loading');
    setError(null);

    try {
      const history = messages.map((msg) => ({
        role: msg.role,
        content: msg.text,
      }));

      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history }),
      });

      if (response.status === 429) {
        setError('המכסה של ה-API אזלה. נסה שוב בעוד מספר דקות.');
        return;
      }

      if (!response.ok) {
        let errorMsg = 'הבקשה נכשלה. נסה שוב.';
        try {
          const errData = await response.json();
          if (errData?.error) {
            errorMsg = errData.error;
          }
        } catch {}
        throw new Error(errorMsg);
      }

      const data: { text?: string } = await response.json();
      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        text: data.text ?? 'אין תשובה',
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err: any) {
      setError(err.message || 'הבקשה נכשלה. נסה שוב.');
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

        {status === 'loading' && (
          <div className="flex justify-end mb-4 animate-fadeIn">
            <div className="rounded-2xl rounded-bl-md px-5 py-3" style={{ background: 'var(--agent-bubble)', boxShadow: '0 2px 8px var(--shadow)' }}>
              <div className="flex gap-1">
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
            disabled={status === 'loading'}
            dir="rtl"
          />
          <button
            type="submit"
            className="rounded-xl px-6 py-3 text-white text-sm font-medium transition-all hover:opacity-90 disabled:opacity-50 cursor-pointer"
            style={{ background: 'var(--accent)' }}
            disabled={!input.trim() || status === 'loading'}
          >
            שלח
          </button>
        </form>
      </footer>
    </div>
  );
}
