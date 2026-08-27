// -----------------------------------------------------------------------------
// רכיב צד-לקוח הראשי (Main Frontend Component)
// -----------------------------------------------------------------------------
// זהו העמוד המרכזי של האפליקציה (Chat UI).
// הוא אחראי על:
// 1. ניהול המצב (State) של הצ'אט (הודעות, טעינה, שגיאות).
// 2. תקשורת מול ה-Backend (שליחת הודעות ל- API /api/chat).
// 3. תצוגה - רינדור בועות הצ'אט, תמיכה ב-Markdown, ועיצוב תגיות המקורות.
// 4. ייצוא נתונים - חילוץ טבלאות קליניות מתוך הצ'אט וייצואן לאקסל.
// -----------------------------------------------------------------------------

'use client';

import { useState, useEffect, useRef } from 'react';
// @ts-ignore
import XLSX from 'xlsx-js-style';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '/api/chat';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
};

type TableData = {
  headers: string[];
  rows: string[][];
  title: string;
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

// Extracts RAG sources from assistant responses by cleanly splitting at the sources marker
function parseSources(text: string): { content: string; sources: string[] } {
  const marker = "מקורות";
  const index = text.lastIndexOf(marker);
  
  if (index !== -1 && index > text.length * 0.3) {
    const content = text.slice(0, index).trim();
    
    // Clean up leading colons, asterisks, bold characters, or newlines from the sources section
    let sourcesBlock = text.slice(index + marker.length).trim();
    sourcesBlock = sourcesBlock
      .replace(/^[:*#\s\-\u200b]+/, '') // strip leading colons, asterisks, hashes, spaces, and dashes
      .trim();

    const sources = sourcesBlock
      .split(/\n/)
      .map((line) => line.trim().replace(/^[-•*]\s*/, '').replace(/\s*[-•*]$/, '').trim())
      .filter(Boolean);

    // Remove any unclosed markdown bold tags at the end of the text content
    const cleanContent = content.replace(/\*\*$/, '').trim();
    return { content: cleanContent, sources };
  }
  
  return { content: text.trim(), sources: [] };
}

// Renders styled text containing bold elements and hyperlink triggers with friendly, space-saving display names
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
      // Resolve the friendly display name for the domain instead of printing the raw URL
      const friendlyName = getDomainFriendlyName(part);
      return (
        <a 
          key={i} 
          href={part} 
          target="_blank" 
          rel="noopener noreferrer" 
          className="underline hover:opacity-85 font-medium transition-opacity" 
          style={{ color: 'var(--accent)' }}
        >
          {friendlyName}
        </a>
      );
    }
    return part;
  });
}

// Scans backward through chat messages to parse the latest Markdown table
function extractLastTableFromMessages(messages: ChatMessage[], defaultPlantName?: string): TableData | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== 'assistant') continue;

    const lines = msg.text.split('\n');
    let inTable = false;
    let headers: string[] = [];
    const rows: string[][] = [];
    let dividerIndex = -1;

    for (let j = 0; j < lines.length; j++) {
      const line = lines[j].trim();
      
      // A table line must start and end with the | character
      if (line.startsWith('|') && line.endsWith('|')) {
        const cells = line
          .split('|')
          .map(c => c.trim())
          .filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);

        // Detect standard Markdown table divider row
        const isDivider = cells.length > 0 && cells.every(c => /^[:-]+$/.test(c));
        
        if (isDivider) {
          dividerIndex = j;
          inTable = true;
          if (j > 0) {
            const prevLine = lines[j - 1].trim();
            if (prevLine.startsWith('|') && prevLine.endsWith('|')) {
              headers = prevLine
                .split('|')
                .map(c => c.trim())
                .filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
            }
          }
          continue;
        }

        if (inTable && dividerIndex !== -1 && j > dividerIndex) {
          rows.push(cells);
        }
      } else {
        if (inTable && rows.length > 0) {
          break;
        }
      }
    }

    if (headers.length > 0 && rows.length > 0) {
      let title = 'פרופיל רכיבים קליני';
      if (defaultPlantName && defaultPlantName.trim()) {
        title = `פרופיל רכיבים: ${defaultPlantName.trim()}`;
      } else {
        // Look for the last user message containing keywords to extract the plant name
        let plantName = '';
        for (let k = messages.length - 1; k >= 0; k--) {
          const userMsg = messages[k];
          if (userMsg.role === 'user') {
            const match = userMsg.text.match(/(?:עבור|של|בצמח|במזון)\s+([א-ת\s]+)/);
            if (match) {
              plantName = match[1].trim();
              break;
            }
          }
        }

        if (plantName) {
          title = `פרופיל רכיבים: ${plantName}`;
        } else {
          const textBeforeTable = lines.slice(0, Math.max(0, dividerIndex - 1)).join(' ').trim();
          const titleMatch = textBeforeTable.match(/(?:עבור|של|בצמח|במזון)\s+([א-ת\s]+)/);
          if (titleMatch) {
            title = `פרופיל רכיבים: ${titleMatch[1].trim()}`;
          } else {
            const cleanPreText = textBeforeTable.replace(/[*#]/g, '').trim();
            if (cleanPreText.length > 0) {
              title = cleanPreText.slice(0, 45) + (cleanPreText.length > 45 ? '...' : '');
            }
          }
        }
      }

      return { headers, rows, title };
    }
  }

  return null;
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
                // Strip trailing asterisks or bullets (common alignment artifacts in RTL layouts)
                const cleanSrc = src.trim().replace(/\s*[-•*]$/, '').trim();

                const urlMatch = cleanSrc.match(/(https?:\/\/[^\s]+)/);
                const url = urlMatch ? urlMatch[1] : '';
                
                let displayName = cleanSrc
                  .replace(/(https?:\/\/[^\s]+)/, '')
                  .replace(/^[-•*]\s*/, '')
                  .replace(/^[-–—]\s*/, '')
                  .replace(/\s*[-–—]$/, '')
                  .trim();
                  
                // Strip the generic placeholder "Site Name" if present to avoid display clutter
                if (displayName.toLowerCase().includes('site name')) {
                  displayName = displayName
                    .replace(/site name/gi, '')
                    .replace(/^[-–—\s]+/, '')
                    .replace(/[-–—\s]+$/, '')
                    .trim();
                }
                  
                try {
                  displayName = decodeURIComponent(displayName);
                } catch {}

                const friendlyDomain = getDomainFriendlyName(url);
                const displayTitle = displayName && displayName !== '-' 
                  ? `${friendlyDomain}: ${displayName}` 
                  : friendlyDomain;

                if (!url) {
                  return (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-green-50 text-green-700 text-xs font-medium border border-green-100"
                    >
                      {displayTitle}
                    </span>
                  );
                }

                return (
                  <a
                    key={i}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-green-50 text-green-700 hover:bg-green-100 text-xs font-medium transition-colors border border-green-100 hover:border-green-200"
                  >
                    {displayTitle}
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="opacity-70">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
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

  const [sidebarOpen, setSidebarOpen] = useState<boolean>(false);

  // State for the plant or component name typed in the sidebar
  const [plantInput, setPlantInput] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scrolling utility to focus the newest messages
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, status]);

  // Compiles and exports the last parsed markdown table from the chat history to MS Excel (.xlsx) client-side
  const handleExportLastTable = () => {
    const table = extractLastTableFromMessages(messages, plantInput);
    if (!table) {
      alert("לא נמצאה טבלה בצ'אט לייצוא. אנא הפק טבלה תחילה באמצעות הכלי או בצ'אט.");
      return;
    }

    // Resolve title: prioritize current plantInput over stored title
    const plantName = plantInput.trim();
    const resolvedTitle = plantName ? `פרופיל רכיבים: ${plantName}` : table.title;

    // Build the sheet dataset with headers, parsed rows, and styled banners
    const titleRow = [resolvedTitle];
    const dateRow = [`הופק בתאריך: ${new Date().toLocaleDateString('he-IL')} על ידי העוזר הבוטני המאובטח`];
    const blankRow: string[] = [];

    // Combine sections into one grid structure
    const aoaData = [
      titleRow,
      dateRow,
      blankRow,
      table.headers,
      ...table.rows
    ];

    const ws = XLSX.utils.aoa_to_sheet(aoaData);

    // Apply RTL view to the worksheet
    ws['!views'] = [{ RTL: true }];

    // Iterate over cells to apply custom styles
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');
    for (let R = range.s.r; R <= range.e.r; ++R) {
      for (let C = range.s.c; C <= range.e.c; ++C) {
        const cellRef = XLSX.utils.encode_cell({ r: R, c: C });
        const cell = ws[cellRef];
        if (!cell) continue;

        if (R === 0) {
          // Main title row
          cell.s = {
            font: { name: "Segoe UI", sz: 14, bold: true, color: { rgb: "065F46" } },
            alignment: { horizontal: "right" }
          };
        } else if (R === 1) {
          // Sub-date metadata row
          cell.s = {
            font: { name: "Segoe UI", sz: 10, italic: true, color: { rgb: "4B5563" } },
            alignment: { horizontal: "right" }
          };
        } else if (R === 3) {
          // Table column headers
          cell.s = {
            fill: { fgColor: { rgb: "D1FAE5" } }, // light green background (emerald-100 style)
            font: { name: "Segoe UI", sz: 11, bold: true, color: { rgb: "065F46" } },
            alignment: { horizontal: "right", vertical: "center" },
            border: {
              top: { style: "thin", color: { rgb: "A7F3D0" } },
              bottom: { style: "thin", color: { rgb: "A7F3D0" } },
              left: { style: "thin", color: { rgb: "A7F3D0" } },
              right: { style: "thin", color: { rgb: "A7F3D0" } }
            }
          };
        } else if (R > 3) {
          // Data cells
          cell.s = {
            font: { name: "Segoe UI", sz: 11 },
            alignment: { horizontal: "right", vertical: "center" },
            border: {
              top: { style: "thin", color: { rgb: "E5E7EB" } },
              bottom: { style: "thin", color: { rgb: "E5E7EB" } },
              left: { style: "thin", color: { rgb: "E5E7EB" } },
              right: { style: "thin", color: { rgb: "E5E7EB" } }
            }
          };
        }
      }
    }

    // Auto-fit column widths dynamically to prevent clipping in Excel
    const maxCols = table.headers.length;
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
    XLSX.utils.book_append_sheet(wb, ws, 'פרופיל רכיבים');

    const fileName = `${resolvedTitle.replace(/\s+/g, '_')}.xlsx`;
    XLSX.writeFile(wb, fileName);
  };

  // Core helper to post questions to the RAG backend API and handle response states
  const sendMessage = async (text: string) => {
    if (!text) return;

    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: 'user', text };
    setMessages((prev) => [...prev, userMessage]);
    setStatus('loading');
    setError(null);

    try {
      // Fetch latest messages from state callback to build correct history array
      let currentMessages: ChatMessage[] = [];
      setMessages((prev) => {
        currentMessages = prev;
        return prev;
      });

      const history = currentMessages.slice(0, -1).map((msg) => ({
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

      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        text: rawText,
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err: any) {
      setError(err.message || 'הבקשה נכשלה. נסה שוב.');
    } finally {
      setStatus('ready');
    }
  };

  // Triggers automated prompt to the bot asking for a clinical table for a specific botanical
  const handleTriggerTableGeneration = async (plantName: string) => {
    const trimmed = plantName.trim();
    if (!trimmed) return;
    const prompt = `אנא הפק טבלה קלינית מפורטת עבור ${trimmed} בפורמט טבלת Markdown רשמית ותקנית (עם עמודות מופרדות בסימני צינור |). הטבלה צריכה להציג בצורה מסודרת את הרכיבים הפעילים/התזונתיים, התוויות קליניות והתוויות נגד. שימוש בטבלת Markdown הכרחי לצורך ייצוא תקין לקובץ Excel!`;
    await sendMessage(prompt);
  };

  // Submits the naturopath's question from the manual chat input
  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput('');
    await sendMessage(text);
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
                <h3 className="text-sm font-bold text-stone-800 dark:text-stone-100">מייצא טבלאות לצ'אט ואקסל</h3>
              </div>
              <Tooltip text="כלי זה מאפשר לכם להפיק בקלות טבלאות קליניות מפורטות על כל צמח, שמן או מזון, ולייצא אותן ישירות לקובץ אקסל מעוצב ומסודר בלחיצת כפתור אחת!" />
            </div>

            {/* Step-by-Step Friendly Instructions with Input Trigger Form */}
            <div className="rounded-lg border border-stone-200/80 dark:border-slate-800/80 p-3 bg-stone-50 dark:bg-slate-900/50 space-y-3">
              <div className="text-center pb-2 border-b border-stone-200/60 dark:border-slate-800/60">
                <span className="text-2xl block mb-1">📋</span>
                <p className="text-xs font-bold text-emerald-700 dark:text-emerald-400">איך להפיק קובץ אקסל?</p>
              </div>
              <div className="text-[11px] text-stone-600 dark:text-stone-400 space-y-2 leading-relaxed">
                <p>כלי זה מפיק עבורכם טבלת ערכים מקיפה המבוססת אך ורק על מקורות רפואיים מהימנים.</p>
                <ol className="list-decimal list-inside space-y-1 text-stone-500 dark:text-stone-400">
                  <li>הקלידו את שם הרכיב או הצמח למטה.</li>
                  <li>לחצו על <strong>"הפק טבלה בצ'אט"</strong>.</li>
                  <li>העוזר הבוטני יסרוק את המאגר ויציג טבלה מפורטת בצ'אט.</li>
                  <li>לחצו על <strong>"ייצא טבלה אחרונה לאקסל"</strong> כדי להוריד את הטבלה.</li>
                </ol>
              </div>

              <div className="pt-3 border-t border-stone-200/60 dark:border-slate-800/60 space-y-2">
                <label className="block text-[10px] font-bold text-stone-700 dark:text-stone-300">
                  שם הצמח, השמן או המאכל:
                </label>
                <input
                  type="text"
                  className="w-full rounded-lg border border-stone-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs outline-none transition-all focus:ring-2 focus:ring-emerald-500/50 text-stone-800 dark:text-stone-100"
                  placeholder="למשל: ג'ינג'ר, שמן אורגנו, גרעיני חמניה..."
                  value={plantInput}
                  onChange={(e) => setPlantInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (plantInput.trim() && status !== 'loading') {
                        handleTriggerTableGeneration(plantInput);
                      }
                    }
                  }}
                  disabled={status === 'loading'}
                  dir="rtl"
                />
                <div className="flex flex-col gap-2 pt-2">
                  <button
                    onClick={() => handleTriggerTableGeneration(plantInput)}
                    disabled={!plantInput.trim() || status === 'loading'}
                    className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-white font-bold text-xs shadow-md transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:scale-100 disabled:cursor-not-allowed cursor-pointer hover:shadow-lg"
                    style={{ background: 'var(--accent)' }}
                  >
                    <span>✨ הפק טבלה בצ'אט</span>
                  </button>
                  <button
                    onClick={handleExportLastTable}
                    className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-white font-bold text-xs shadow-md transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] cursor-pointer hover:shadow-lg"
                    style={{ background: 'var(--emerald-bubble, #10b981)' }}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    <span>📥 ייצא טבלה אחרונה לאקסל</span>
                  </button>
                </div>
              </div>
            </div>
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
            {/* Glowing dot if active table is ready to download */}
            {messages.some(m => m.role === 'assistant' && m.text.includes('|') && m.text.includes('---')) && (
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

        {/* Persistent medical disclaimer banner */}
        <div
          className="px-4 py-2 text-center text-[11px] font-medium border-b"
          style={{ background: 'var(--accent-light)', color: 'var(--accent)', borderColor: 'var(--accent-light)' }}
        >
          ⚠️ המידע כאן מבוסס על מאגר מקורות ואינו תחליף לייעוץ רפואי מקצועי. יש להתייעץ עם רופא/ה או רוקח/ת לפני שימוש בכל צמח מרפא.
        </div>

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
