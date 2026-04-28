'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useState } from 'react';

export default function Chat() {
  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({ api: '/api/chat' }),
  });
  const [input, setInput] = useState('');
  const safeInput = input ?? '';

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = safeInput.trim();
    if (!text) return;

    await sendMessage({ text });
    setInput('');
  };

  return (
    <div className="flex flex-col w-full max-w-md py-24 mx-auto stretch">
      <h1 className="text-2xl font-bold mb-4 text-center">Botanical Agent 🌱</h1>
      
      <div className="space-y-4 mb-20">
        {messages.map((m) => (
          <div key={m.id} className={`p-4 rounded-lg ${m.role === 'user' ? 'bg-blue-100 ml-8' : 'bg-gray-100 mr-8'}`}>
            <span className="font-bold">{m.role === 'user' ? 'You' : 'Agent'}: </span>
            {m.parts
              .filter((part) => part.type === 'text')
              .map((part) => ('text' in part ? part.text : ''))
              .join('')}
          </div>
        ))}
      </div>

      {error ? (
        <div className="mb-20 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          Request failed. Check the server terminal for details.
        </div>
      ) : null}

      {status === 'submitted' || status === 'streaming' ? (
        <div className="mb-20 text-sm text-gray-500">Thinking...</div>
      ) : null}

      <form onSubmit={handleSubmit} className="fixed bottom-0 mb-8 flex w-full max-w-md gap-2">
        <input
          className="w-full p-3 border border-gray-300 rounded shadow-xl outline-none focus:ring-2 focus:ring-blue-500"
          value={safeInput}
          placeholder="Ask about plants..."
          onChange={(event) => setInput(event.target.value)}
          disabled={status === 'streaming' || status === 'submitted'}
        />
        <button
          type="submit"
          className="rounded border border-gray-300 bg-white px-4 py-2 shadow hover:bg-gray-50 disabled:opacity-50"
          disabled={!safeInput.trim() || status === 'streaming' || status === 'submitted'}
        >
          Send
        </button>
      </form>
    </div>
  );
}