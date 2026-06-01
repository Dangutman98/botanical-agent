'use client';

import { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '/api/chat';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
};

type ProfileComponent = {
  component: string;
  type: string;
  value: string;
  indication: string;
};

type BotanicalProfile = {
  entity: string;
  profile: ProfileComponent[];
  contraindications: string;
};

// Custom interactive Tooltip component supporting hover on desktop and tap/click on mobile
function Tooltip({ text }: { text: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <div 
      className="relative inline-block cursor-help group"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onClick={(e) => {
        e.stopPropagation();
        setVisible(!visible);
      }}
    >
      <span className="text-sm select-none p-1 text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300 transition-colors">❓</span>
      {visible && (
        <div 
          className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-3 rounded-lg text-xs leading-relaxed bg-white dark:bg-slate-800 border border-stone-200 dark:border-slate-700 shadow-xl text-stone-700 dark:text-stone-200 transition-all duration-200 animate-fadeIn"
          style={{ direction: 'rtl' }}
        >
          {/* Pointy caret indicator */}
          <div className="absolute top-full left-1/2 -translate-x-1/2 w-2 h-2 bg-white dark:bg-slate-800 border-r border-b border-stone-200 dark:border-slate-700 rotate-45"></div>
          {text}
        </div>
      )}
    </div>
  );
}

// Translates raw crawler links to descriptive site names
function getDomainFriendlyName(urlStr: string): string {
  try {
    const parsed = new URL(urlStr);
    const host = parsed.hostname.replace('www.', '').toLowerCase();
    
    if (host.includes('bara.co.il')) return 'ברא צמחים';
    if (host.includes('trifolium.co.il')) return 'טריפוליום';
    if (host.includes('naturopedia.com')) return 'נטורופדיה';
    if (host.includes('nccih.nih.gov')) return 'NCCIH (מכון הבריאות האמריקאי)';
    if (host.includes('medlineplus.gov')) return 'MedlinePlus';
    if (host.includes('ajcn.nutrition.org')) return 'AJCN (כתב עת לתזונה)';
    
    return parsed.hostname;
  } catch {
    return 'מקור חיצוני';
  }
}

// Extracts RAG sources from assistant responses while filtering the hidden ENTITY tags
function parseSources(text: string): { content: string; sources: string[] } {
  // Strip hidden [ENTITY: ...] tags completely from text display
  const cleanText = text.replace(/\[ENTITY:\s*[^\]]+\]/gi, '').trim();

  const match = cleanText.match(/^(.*?)(\n\s*מקורות:\s*\n?)([\s\S]*)$/i);
  if (match) {
    const content = match[1].trim();
    const sourcesBlock = match[3].trim();
    const sources = sourcesBlock
      .split(/\n/)
      .map((line) => line.replace(/^[-•*]\s*/, '').trim())
      .filter(Boolean);
    return { content, sources };
  }
  return { content: cleanText, sources: [] };
}

// Renders styled text containing bold elements and hyperlink triggers
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
      return (
        <a 
          key={i} 
          href={part} 
          target="_blank" 
          rel="noopener noreferrer" 
          className="underline hover:opacity-85 font-medium transition-opacity" 
          style={{ color: 'var(--accent)' }}
        >
          {part}
        </a>
      );
    }
    return part;
  });
}

// Represents a single text message card in the conversation feed
function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  const { content, sources } = isUser ? { content: message.text, sources: [] } : parseSources(message.text);

  if (isUser) {
    return (
      <div className="animate-fadeIn flex justify-start mb-4">
        <div className="max-w-[85%] rounded-2xl rounded-br-md px-5 py-3 text-white shadow-sm" style={{ background: 'var(--user-bubble)' }}>
          <p className="leading-relaxed text-sm md:text-base whitespace-pre-wrap">{content}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fadeIn flex justify-end mb-4">
      <div className="max-w-[90%] rounded-2xl rounded-bl-md px-5 py-3 border border-stone-200/60 dark:border-slate-800/40" style={{ background: 'var(--agent-bubble)', boxShadow: '0 2px 12px var(--shadow)' }}>
        <div className="mb-2 leading-relaxed text-sm md:text-base" style={{ color: 'var(--agent-text)', wordBreak: 'break-word', overflowWrap: 'break-word' }}>
          {content.split('\n').map((line, i) => (
            <p key={i} className="mb-1">{renderMarkdown(line)}</p>
          ))}
        </div>
        {sources.length > 0 && (
          <div className="mt-3 pt-3 border-t" style={{ borderColor: 'var(--accent-light)' }}>
            <div className="flex items-center gap-1.5 mb-2" style={{ color: 'var(--accent)' }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
              <span className="text-xs font-bold tracking-wide">מקורות קליניים מהימנים</span>
            </div>
            <div className="flex flex-wrap gap-2 mt-2">
              {sources.map((src, i) => {
                const urlMatch = src.match(/(https?:\/\/[^\s]+)/);
                const url = urlMatch ? urlMatch[1] : '';
                
                let displayName = src
                  .replace(/(https?:\/\/[^\s]+)/, '')
                  .replace(/^[-•*]\s*/, '')
                  .replace(/-?\s*$/, '')
                  .trim();
                  
                try {
                  displayName = decodeURIComponent(displayName);
                } catch {}

                const friendlyDomain = getDomainFriendlyName(url);
                const displayTitle = displayName && displayName !== '-' 
                  ? `${friendlyDomain}: ${displayName}` 
                  : friendlyDomain;

                return (
                  <a
                    key={i}
                    href={url || '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all hover:scale-[1.02] hover:opacity-90 active:scale-[0.98] border shadow-sm"
                    style={{
                      background: 'var(--source-bg)',
                      borderColor: 'var(--accent-light)',
                      color: 'var(--accent)',
                      textDecoration: 'none',
                    }}
                    title={url}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                    <span className="truncate max-w-[200px]">{displayTitle}</span>
                  </a>
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

  // States for the custom Clinical Toolbox
  const [activeEntity, setActiveEntity] = useState<string>('None');
  const [profileData, setProfileData] = useState<BotanicalProfile | null>(null);
  const [profileStatus, setProfileStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scrolling utility to focus the newest messages
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, status]);

  // Invokes the structured profiling endpoint to retrieve JSON data for the tracked plant
  const fetchProfile = async (entity: string) => {
    if (!entity || entity.toLowerCase() === 'none') {
      return;
    }
    
    setProfileStatus('loading');
    try {
      const res = await fetch('/api/extract-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity }),
      });
      if (!res.ok) throw new Error('Failed to extract profile');
      const data = await res.json();
      setProfileData(data);
      setProfileStatus('success');
      
      // Auto open sidebar on desktop/mobile when profile is ready to delight the user
      setSidebarOpen(true);
    } catch (err) {
      console.error('Error extracting profile:', err);
      setProfileStatus('error');
    }
  };

  // Compiles and exports structured botanical rows to Microsoft Excel (.xlsx) client-side
  const handleExportToExcel = () => {
    if (!profileData) return;

    // Build the sheet dataset with headers, profile rows, and styled banners
    const titleRow = [`דוח רכיבים טיפולי קליני: ${profileData.entity || activeEntity}`];
    const dateRow = [`הופק בתאריך: ${new Date().toLocaleDateString('he-IL')} על ידי העוזר הבוטני המאובטח`];
    const blankRow: string[] = [];

    const headers = ['רכיב קליני', 'סוג רכיב', 'ערך / ריכוז במזון/צמח', 'התוויה טיפולית / מנגנון פעולה'];
    const rows = (profileData.profile || []).map(item => [
      item.component || '',
      item.type || '',
      item.value || '',
      item.indication || ''
    ]);

    const warningsHeader = ['⚠️ אזהרות והתוויות נגד קליניות:'];
    const warningsText = [profileData.contraindications || 'לא נמצאו אזהרות ספציפיות במאגר.'];

    // Combine sections into one grid structure
    const aoaData = [
      titleRow,
      dateRow,
      blankRow,
      headers,
      ...rows,
      blankRow,
      warningsHeader,
      warningsText
    ];

    const ws = XLSX.utils.aoa_to_sheet(aoaData);

    // Auto-fit column widths dynamically to prevent clipping in Excel
    const maxCols = 4;
    const colWidths = [];
    for (let colIdx = 0; colIdx < maxCols; colIdx++) {
      let maxLen = 15;
      aoaData.forEach(row => {
        if (row[colIdx]) {
          const valStr = String(row[colIdx]);
          if (valStr.length > maxLen) {
            maxLen = valStr.length;
          }
        }
      });
      colWidths.push({ wch: Math.min(maxLen + 3, 50) });
    }
    ws['!cols'] = colWidths;

    // Generate workbook and trigger native browser download
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'פרופיל רכיבים קליני');

    const fileName = `פרופיל_קליני_${profileData.entity || activeEntity}.xlsx`.replace(/\s+/g, '_');
    XLSX.writeFile(wb, fileName);
  };

  // Submits the naturopath's question, fetches response, and parses entity context tags
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
      const rawText = data.text ?? 'אין תשובה';

      // Parse custom [ENTITY: name] tags appended by the model
      const entityMatch = rawText.match(/\[ENTITY:\s*([^\]]+)\]/i);
      let entityName = 'None';
      let cleanText = rawText;

      if (entityMatch) {
        entityName = entityMatch[1].trim();
        cleanText = rawText.replace(/\[ENTITY:\s*[^\]]+\]/gi, '').trim();
      }

      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        text: cleanText,
      };

      setMessages((prev) => [...prev, assistantMessage]);

      // If an active entity is found, invoke automatic profile scraping
      if (entityName !== 'None') {
        setActiveEntity(entityName);
        fetchProfile(entityName);
      }
    } catch (err: any) {
      setError(err.message || 'הבקשה נכשלה. נסה שוב.');
    } finally {
      setStatus('ready');
    }
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-stone-100 dark:bg-slate-900" dir="rtl">
      
      {/* Mobile Sidebar backdrop screen */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 z-30 bg-stone-900/40 backdrop-blur-sm lg:hidden transition-opacity"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Glassmorphic responsive left sidebar container */}
      <aside 
        className={`fixed inset-y-0 left-0 z-40 w-[320px] md:w-[360px] lg:w-96 xl:w-[420px] lg:static lg:translate-x-0 transition-transform duration-300 ease-in-out flex flex-col border-r border-stone-200/80 dark:border-slate-800/80 bg-white/95 dark:bg-slate-950/95 backdrop-blur-md shadow-lg lg:shadow-none ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Sidebar Header Bar */}
        <div className="p-4 border-b border-stone-200/80 dark:border-slate-800/80 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">🧰</span>
            <h2 className="text-lg font-bold text-stone-800 dark:text-stone-100">ארגז כלים קליני</h2>
          </div>
          {/* Mobile close toggle button */}
          <button 
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden p-1.5 rounded-lg hover:bg-stone-100 dark:hover:bg-slate-800 text-stone-500 dark:text-stone-400 cursor-pointer transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        {/* Scrollable list of active and showcase tools */}
        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          
          {/* Active Tool 1: Excel Exporter */}
          <div className="p-4 rounded-xl border border-stone-200/80 dark:border-slate-800/80 bg-stone-50/50 dark:bg-slate-900/40">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-1.5">
                <span className="text-base">📊</span>
                <h3 className="text-sm font-bold text-stone-800 dark:text-stone-100">מייצא פרופיל רכיבים לאקסל</h3>
              </div>
              <Tooltip text="מזהה אוטומטית את צמח המרפא או המזון שעליו דיברתם בצ'אט ומייצר דוח קליני מקיף הכולל ויטמינים, מינרלים, חומרים פעילים והתוויות נגד, מוכן לייצוא ישיר לקובץ אקסל מעוצב." />
            </div>

            {/* Waiting for plant subject topic */}
            {profileStatus === 'idle' && (
              <div className="text-center py-6 px-3 rounded-lg border border-dashed border-stone-200 dark:border-slate-800">
                <span className="text-3xl mb-2 block">🌾</span>
                <p className="text-xs text-stone-500 dark:text-stone-400 font-medium">שוחחו בצ'אט על צמח מרפא או מזון כדי להפיק כאן פרופיל קליני מפורט.</p>
                <p className="text-[10px] text-stone-400 dark:text-stone-500 mt-2 font-medium">לדוגמה: "האם גרעיני חמניה מכילים מגנזיום?" או "ספר לי על הסגולות של ג'ינג'ר"</p>
              </div>
            )}

            {/* Parsing active plant data spinner */}
            {profileStatus === 'loading' && (
              <div className="py-8 text-center space-y-3">
                <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
                <p className="text-xs text-stone-500 dark:text-stone-400 animate-pulse font-medium">מפיק פרופיל רכיבים קליני עבור <span className="font-bold text-emerald-600 dark:text-emerald-400">"{activeEntity}"</span>...</p>
              </div>
            )}

            {/* Error fallback wrapper */}
            {profileStatus === 'error' && (
              <div className="p-3 text-center rounded-lg border border-red-200/80 bg-red-50/50 dark:bg-red-950/20 text-red-700 dark:text-red-300">
                <p className="text-xs font-bold">שגיאה בהפקת הפרופיל הקליני.</p>
                <button 
                  onClick={() => fetchProfile(activeEntity)}
                  className="mt-2 text-[10px] underline font-bold hover:text-red-800 dark:hover:text-red-200 cursor-pointer"
                >
                  נסה שוב
                </button>
              </div>
            )}

            {/* Beautiful loaded profile dataset */}
            {profileStatus === 'success' && profileData && (
              <div className="space-y-4 animate-fadeIn">
                <div className="flex items-center justify-between pb-2 border-b border-stone-200 dark:border-slate-800">
                  <span className="text-xs font-semibold text-stone-500 dark:text-stone-400">צמח פעיל מזוהה:</span>
                  <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300">
                    {profileData.entity || activeEntity}
                  </span>
                </div>

                {/* Grid preview showing top 5 botanical components */}
                <div className="overflow-hidden rounded-lg border border-stone-200 dark:border-slate-800 text-[11px]">
                  <table className="w-full text-right border-collapse">
                    <thead>
                      <tr className="bg-stone-100 dark:bg-slate-800/80 text-stone-600 dark:text-stone-300 font-bold border-b border-stone-200 dark:border-slate-800">
                        <th className="p-2 w-1/3">רכיב</th>
                        <th className="p-2 w-1/4">סוג</th>
                        <th className="p-2 w-1/3">התוויה</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-200/60 dark:divide-slate-800/60">
                      {profileData.profile && profileData.profile.slice(0, 5).map((item, idx) => (
                        <tr key={idx} className="hover:bg-stone-100/30 dark:hover:bg-slate-800/20 text-stone-700 dark:text-stone-300">
                          <td className="p-2 font-semibold">{item.component}</td>
                          <td className="p-2 text-stone-500 dark:text-stone-400">{item.type}</td>
                          <td className="p-2 truncate max-w-[100px]" title={item.indication}>{item.indication}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {profileData.profile && profileData.profile.length > 5 && (
                    <div className="p-1.5 text-center bg-stone-50 dark:bg-slate-900 border-t border-stone-200 dark:border-slate-800 text-[9px] text-stone-400 dark:text-stone-500 font-medium">
                      +{profileData.profile.length - 5} רכיבים נוספים ייכללו בקובץ המלא
                    </div>
                  )}
                </div>

                {/* Contraindications Warning Box */}
                <div className="p-2.5 rounded-lg border border-amber-200 dark:border-amber-950/60 bg-amber-50/50 dark:bg-amber-950/20 text-[10px] text-amber-800 dark:text-amber-300">
                  <div className="font-bold flex items-center gap-1 mb-1">
                    <span>⚠️</span>
                    <span>התוויות נגד ואזהרות:</span>
                  </div>
                  <p className="leading-relaxed font-medium">{profileData.contraindications}</p>
                </div>

                {/* Actionable export trigger button */}
                <button
                  onClick={handleExportToExcel}
                  className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-white font-bold text-xs shadow-md transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] cursor-pointer hover:shadow-lg"
                  style={{ background: 'var(--accent)' }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  <span>ייצא פרופיל מלא לאקסל</span>
                </button>
              </div>
            )}
          </div>

          {/* Locked Showcase Tool 2: Dosage Calculator */}
          <div className="p-4 rounded-xl border border-stone-200/50 dark:border-slate-800/50 bg-stone-50/30 dark:bg-slate-900/10 opacity-75">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <span className="text-base text-stone-400">🧮</span>
                <h3 className="text-sm font-bold text-stone-500 dark:text-stone-400">מחשבון מינונים קליני</h3>
              </div>
              <div className="flex items-center gap-1">
                <Tooltip text="מחשבון המבוסס על משקל המטופל, גיל ורמת הרגישות, ומציג את טווחי המינון המומלצים לצמחי מרפא בטינקטורה, אבקה או כמוסות." />
                <span className="text-[9px] px-1.5 py-0.5 rounded font-bold bg-stone-200 dark:bg-slate-800 text-stone-600 dark:text-stone-400">🔒 בקרוב</span>
              </div>
            </div>
            <p className="text-[10px] text-stone-400 dark:text-stone-500">חישוב מינוני צמחים מבוססי משקל, קבוצות גיל וצורות מתן שונות.</p>
          </div>

          {/* Locked Showcase Tool 3: Formula Builder */}
          <div className="p-4 rounded-xl border border-stone-200/50 dark:border-slate-800/50 bg-stone-50/30 dark:bg-slate-900/10 opacity-75">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <span className="text-base text-stone-400">⚗️</span>
                <h3 className="text-sm font-bold text-stone-500 dark:text-stone-400">בונה פורמולות סינרגטיות</h3>
              </div>
              <div className="flex items-center gap-1">
                <Tooltip text="כלי המאפשר שילוב של מספר צמחי מרפא ליצירת פורמולת טינקטורה מותאמת אישית, תוך חישוב יחסי חומרים פעילים ומניעת התנגשויות תרופתיות." />
                <span className="text-[9px] px-1.5 py-0.5 rounded font-bold bg-stone-200 dark:bg-slate-800 text-stone-600 dark:text-stone-400">🔒 בקרוב</span>
              </div>
            </div>
            <p className="text-[10px] text-stone-400 dark:text-stone-500">בניית מרשמי טינקטורה מרובי צמחים עם סורק התנגשויות מובנה.</p>
          </div>

          {/* Locked Showcase Tool 4: Menu Planner */}
          <div className="p-4 rounded-xl border border-stone-200/50 dark:border-slate-800/50 bg-stone-50/30 dark:bg-slate-900/10 opacity-75">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <span className="text-base text-stone-400">🥗</span>
                <h3 className="text-sm font-bold text-stone-500 dark:text-stone-400">יוצר תפריט תזונתי מותאם</h3>
              </div>
              <div className="flex items-center gap-1">
                <Tooltip text="מתכנן תפריטים שבועי הנגזר מהערכים התזונתיים הדרושים למטופל, המאפשר הרכבת מנות על בסיס רכיבי סופר-פוד ספציפיים." />
                <span className="text-[9px] px-1.5 py-0.5 rounded font-bold bg-stone-200 dark:bg-slate-800 text-stone-600 dark:text-stone-400">🔒 בקרוב</span>
              </div>
            </div>
            <p className="text-[10px] text-stone-400 dark:text-stone-500">הרכבת תפריטים שבועיים על בסיס חוסרים תזונתיים ורכיבי סופר-פוד.</p>
          </div>

        </div>

        {/* Locked Footer Banner */}
        <div className="p-4 border-t border-stone-200/80 dark:border-slate-800/80 text-[10px] text-stone-400 dark:text-stone-500 text-center font-medium bg-stone-50/50 dark:bg-slate-900/20">
          מאגר מאובטח המבוסס על מקורות רפואיים מאושרים בלבד
        </div>
      </aside>

      {/* Main chat viewport */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        
        {/* Sticky Header Bar */}
        <header className="sticky top-0 z-10 px-4 py-3.5 border-b backdrop-blur-md flex items-center justify-between" style={{ background: 'var(--background)', borderColor: 'var(--accent-light)' }}>
          {/* Mobile Sidebar open button */}
          <button 
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden flex items-center gap-1 px-3 py-1.5 rounded-lg border border-stone-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-950 text-xs font-bold text-stone-700 dark:text-stone-200 hover:bg-stone-50 cursor-pointer relative"
          >
            <span>🧰</span>
            <span>ארגז כלים</span>
            {/* Glowing dot if active profile is ready to download */}
            {profileStatus === 'success' && (
              <span className="absolute top-0 right-0 transform translate-x-1 -translate-y-1 flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
              </span>
            )}
          </button>

          {/* Centered brand and description */}
          <div className="text-center flex-1 lg:text-right lg:pr-2">
            <h1 className="text-base md:text-lg font-bold" style={{ color: 'var(--accent)' }}>🌿 העוזר הבוטני המאובטח</h1>
            <p className="text-[10px] mt-0.5 font-medium" style={{ color: 'var(--foreground)', opacity: 0.5 }}>מערכת RAG קלינית סגורה לנטורופתיה</p>
          </div>

          <div className="w-20 lg:w-auto" />
        </header>

        {/* Message Feed panel */}
        <main className="flex-1 overflow-y-auto px-4 py-6 max-w-2xl mx-auto w-full space-y-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center" style={{ color: 'var(--foreground)', opacity: 0.75 }}>
              <span className="text-5xl mb-4 animate-bounce">🌱</span>
              <p className="text-base font-bold mb-1 text-stone-700 dark:text-stone-200">שלום! אני העוזר הבוטני המאובטח שלך</p>
              <p className="text-xs text-stone-500 dark:text-stone-400 max-w-sm leading-relaxed">
                שאלו שאלות קליניות על צמחים, זרעים, שורשים ופירות. אנתח את המידע מתוך המאגר המאושר ואציג רכיבים ומינונים בטוחים.
              </p>
              <div className="mt-6 flex flex-wrap gap-2 justify-center max-w-md">
                <button 
                  onClick={() => { setInput('האם גרעיני חמניה מכילים מגנזיום?'); }}
                  className="text-[10px] px-3 py-1.5 rounded-full border border-stone-200/80 dark:border-slate-800/80 bg-white/50 dark:bg-slate-900/50 hover:bg-stone-100 dark:hover:bg-slate-800 text-stone-600 dark:text-stone-300 font-medium transition-all cursor-pointer"
                >
                  "האם גרעיני חמניה מכילים מגנזיום?"
                </button>
                <button 
                  onClick={() => { setInput('מהם החומרים הפעילים בג\'ינג\'ר ומהן התוויות הנגד?'); }}
                  className="text-[10px] px-3 py-1.5 rounded-full border border-stone-200/80 dark:border-slate-800/80 bg-white/50 dark:bg-slate-900/50 hover:bg-stone-100 dark:hover:bg-slate-800 text-stone-600 dark:text-stone-300 font-medium transition-all cursor-pointer"
                >
                  "מהם החומרים הפעילים בג'ינג'ר ומהן התוויות הנגד?"
                </button>
              </div>
            </div>
          )}

          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}

          {/* Typing/Retrieving indicator bubbles */}
          {status === 'loading' && (
            <div className="flex justify-end mb-4 animate-fadeIn">
              <div className="rounded-2xl rounded-bl-md px-5 py-3 border border-stone-200/60 dark:border-slate-800/40" style={{ background: 'var(--agent-bubble)', boxShadow: '0 2px 12px var(--shadow)' }}>
                <div className="flex gap-1 animate-pulse-dots">
                  <span className="text-xl leading-none" style={{ color: 'var(--accent)' }}>.</span>
                  <span className="text-xl leading-none" style={{ color: 'var(--accent)' }}>.</span>
                  <span className="text-xl leading-none" style={{ color: 'var(--accent)' }}>.</span>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="animate-fadeIn rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/20 px-4 py-3 mb-4 text-center text-xs font-bold text-red-700 dark:text-red-400">
              {error}
            </div>
          )}

          <div ref={messagesEndRef} />
        </main>

        {/* Input Bar Form panel */}
        <footer className="sticky bottom-0 px-4 py-4 backdrop-blur-md" style={{ background: 'var(--background)' }}>
          <form onSubmit={handleSubmit} className="max-w-2xl mx-auto flex gap-2">
            <input
              type="text"
              className="flex-1 rounded-xl px-4 py-3 border outline-none text-xs md:text-sm transition-all focus:ring-2 focus:ring-emerald-500/50"
              style={{ borderColor: 'var(--accent-light)', background: 'var(--agent-bubble)', color: 'var(--foreground)' }}
              value={input}
              placeholder="שאל שאלה על צמחי מרפא או מזונות..."
              onChange={(e) => setInput(e.target.value)}
              disabled={status === 'loading'}
              dir="rtl"
            />
            <button
              type="submit"
              className="rounded-xl px-5 md:px-7 py-3 text-white text-xs md:text-sm font-bold transition-all duration-200 hover:opacity-90 active:scale-[0.98] disabled:opacity-50 cursor-pointer flex items-center gap-1.5 shadow-sm"
              style={{ background: 'var(--accent)' }}
              disabled={!input.trim() || status === 'loading'}
            >
              <span>שלח</span>
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="transform rotate-180">
                <line x1="22" y1="2" x2="11" y2="13"></line>
                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
              </svg>
            </button>
          </form>
        </footer>

      </div>

    </div>
  );
}
