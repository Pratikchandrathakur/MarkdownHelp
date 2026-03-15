import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Copy, FileText, LayoutTemplate, BookOpen, Wand2,
  Check, Play, Github, X, Download, Square, Sparkles,
} from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';

/* ── Helper: Preprocess AI Markdown ─────────────────────── */
// AI often generates "#Heading" instead of "# Heading" which breaks parsing
// It also sometimes escapes bold asterisks like \*\*text\*\*
const cleanMarkdown = (text: string) => {
  return text
    // Remove wrapping ```markdown and ``` if the AI output the entire response inside a code block
    .replace(/^```[a-z]*\n?/i, '') // Removes leading ```markdown
    .replace(/\n?```$/i, '')       // Removes trailing ```
    .replace(/^(#{1,6})(?=[^\s#])/gm, '$1 ') // Fix missing space after #
    .replace(/\\\*/g, '*') // Fix escaped asterisks
    .replace(/\\\+/g, '+') // Fix escaped pluses
    .replace(/\\-/g, '-'); // Fix escaped minuses
};

/* ── Mode definitions ─────────────────────────────────────── */
const MODES = [
  {
    id: 'standard',
    name: 'Standard',
    icon: FileText,
    description: 'Overview, install, usage, license',
  },
  {
    id: 'minimal',
    name: 'Minimal',
    icon: LayoutTemplate,
    description: 'Just the absolute basics',
  },
  {
    id: 'detailed',
    name: 'Detailed',
    icon: BookOpen,
    description: 'API docs, architecture, contributing',
  },
  {
    id: 'opensource',
    name: 'Open Source',
    icon: Github,
    description: 'Badges, community, contributing guide',
  },
];

/* ── System prompts ───────────────────────────────────────── */
const getSystemPrompt = (mode: string) => {
  const base = `You are an expert technical writer and open-source maintainer. Your task is to take the user's unformatted, messy, or unstructured text and convert it into a beautiful, well-structured, and highly readable GitHub README.md file.
Identify the main project name and make it an H1 (#).
Create logical sections using H2 (##) and H3 (###) subheadings.
Whenever you detect a list of items, convert them to bullet points (-).
If you detect a sequence or steps (like installation instructions), use numbered lists (1.).
Bold key terms for emphasis.
If you detect code snippets or terminal commands, wrap them in proper markdown code blocks with syntax highlighting (e.g., \`\`\`bash or \`\`\`javascript).
If you detect tabular data, format it as a Markdown table.
Add placeholder badges at the top under the H1 if appropriate (e.g., license, build status).
Do NOT change the original meaning of the text, only enhance its structure and format it as a README. Return ONLY the formatted markdown, without any conversational filler.`;

  switch (mode) {
    case 'minimal':
      return `${base}\n\nMODE: Minimal README. Keep it very concise. Include only: Project Title, Description, Installation, and Usage.`;
    case 'detailed':
      return `${base}\n\nMODE: Detailed README. Be extremely thorough. Include sections for: Project Title, Description, Features, Architecture/Tech Stack, Prerequisites, Installation, Usage, API Documentation (if applicable), Troubleshooting, and License.`;
    case 'opensource':
      return `${base}\n\nMODE: Open Source README. Focus on community engagement. Include sections for: Project Title, Badges, Description, Features, Installation, Usage, Contributing Guidelines, Code of Conduct, License, and Acknowledgements.`;
    default:
      return `${base}\n\nMODE: Standard README. Include sections for: Project Title, Description, Features, Installation, Usage, and License.`;
  }
};

/* ── Toast component ──────────────────────────────────────── */
function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2400);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-toast-in">
      <div className="glass flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-xl text-sm font-medium text-emerald-300">
        <Check className="w-4 h-4 shrink-0" />
        {message}
      </div>
    </div>
  );
}

/* ── Word / char counter ──────────────────────────────────── */
function WordCount({ text }: { text: string }) {
  const trimmed = text.trim();
  const words = trimmed ? trimmed.split(/\s+/).length : 0;
  const chars = text.length;
  return (
    <span className="text-xs text-zinc-500 tabular-nums">
      {chars.toLocaleString()} chars · {words.toLocaleString()} words
    </span>
  );
}

/* ── Main App ─────────────────────────────────────────────── */
export default function App() {
  const [inputText, setInputText]     = useState('');
  const [outputText, setOutputText]   = useState('');
  const [mode, setMode]               = useState(MODES[0].id);
  const [isGenerating, setIsGenerating] = useState(false);
  const [toast, setToast]             = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  /* ── Generate ─────────────────────────────────────────── */
  const handleGenerate = useCallback(async () => {
    if (!inputText.trim() || isGenerating) return;

    setIsGenerating(true);
    setOutputText('');

    if (abortControllerRef.current) abortControllerRef.current.abort();
    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${import.meta.env.VITE_OPENROUTER_API_KEY}`,
          'HTTP-Referer': window.location.href,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'meta-llama/llama-3.3-70b-instruct:free',
          messages: [
            { role: 'system', content: getSystemPrompt(mode) },
            { role: 'user',   content: inputText },
          ],
          stream: true,
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) throw new Error(`API Error: ${response.status} ${response.statusText}`);

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let full = '';

      while (true) {
        if (abortControllerRef.current?.signal.aborted) break;
        const { done, value } = await reader.read();
        if (done) break;

        const lines = decoder.decode(value).split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const json = JSON.parse(line.slice(6));
              if (json.choices?.[0]?.delta?.content) {
                full += json.choices[0].delta.content;
                setOutputText(full);
              }
            } catch { /* skip invalid JSON */ }
          }
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error('Error generating markdown:', err);
        setOutputText(prev => prev + `\n\n**Error:** ${err.message}`);
      }
    } finally {
      setIsGenerating(false);
    }
  }, [inputText, mode, isGenerating]);

  /* ── Stop ─────────────────────────────────────────────── */
  const handleStop = () => {
    abortControllerRef.current?.abort();
    setIsGenerating(false);
  };

  /* ── Keyboard shortcut ────────────────────────────────── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        handleGenerate();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleGenerate]);

  /* ── Copy ─────────────────────────────────────────────── */
  const handleCopy = () => {
    if (!outputText) return;
    navigator.clipboard.writeText(outputText);
    setToast('Markdown copied to clipboard!');
  };

  /* ── Download ─────────────────────────────────────────── */
  const handleDownload = () => {
    if (!outputText) return;
    const blob = new Blob([outputText], { type: 'text/markdown' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'README.md';
    a.click();
    URL.revokeObjectURL(url);
    setToast('README.md downloaded!');
  };

  /* ── Render ───────────────────────────────────────────── */
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">

      {/* ── Toast ───────────────────────────────────────── */}
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}

      {/* ── Header ──────────────────────────────────────── */}
      <header className="glass border-b border-zinc-800/60 px-6 py-4 sticky top-0 z-10">
        <div className="max-w-screen-2xl mx-auto flex items-center justify-between gap-4">
          {/* Brand */}
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="bg-emerald-500/15 border border-emerald-500/30 p-2.5 rounded-xl animate-pulse-glow">
                <Wand2 className="w-5 h-5 text-emerald-400" />
              </div>
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight leading-none gradient-text">
                README Generator
              </h1>
              <p className="text-xs text-zinc-500 mt-0.5">
                Turn messy notes into stunning&nbsp;
                <span className="text-emerald-500/80">README.md</span> files
              </p>
            </div>
          </div>

          {/* Generate / Stop */}
          <div className="flex items-center gap-3">
            <kbd className="hidden md:flex items-center gap-1 text-xs text-zinc-500 bg-zinc-800/60 border border-zinc-700 px-2 py-1 rounded-md font-mono">
              ⌘↵
            </kbd>
            {isGenerating ? (
              <button
                onClick={handleStop}
                className="flex items-center gap-2 bg-red-600/90 hover:bg-red-500 text-white px-4 py-2 rounded-lg font-medium text-sm transition-all shadow-lg"
              >
                <Square className="w-4 h-4" />
                Stop
              </button>
            ) : (
              <button
                onClick={handleGenerate}
                disabled={!inputText.trim()}
                className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white px-4 py-2 rounded-lg font-medium text-sm transition-all shadow-lg card-glow disabled:shadow-none"
              >
                <Play className="w-4 h-4" />
                Generate
              </button>
            )}
          </div>
        </div>
      </header>

      {/* ── Mode Selector ───────────────────────────────── */}
      <div className="border-b border-zinc-800/60 bg-zinc-900/40 px-6 py-3">
        <div className="max-w-screen-2xl mx-auto grid grid-cols-2 sm:grid-cols-4 gap-2">
          {MODES.map(m => {
            const Icon    = m.icon;
            const active  = mode === m.id;
            return (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all duration-200 ${
                  active
                    ? 'border-emerald-500/50 bg-emerald-500/10 card-glow'
                    : 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-700 hover:bg-zinc-800/60'
                }`}
              >
                <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-emerald-400' : 'text-zinc-500'}`} />
                <div>
                  <p className={`text-sm font-semibold leading-none ${active ? 'text-emerald-300' : 'text-zinc-300'}`}>
                    {m.name}
                  </p>
                  <p className="text-xs text-zinc-500 mt-1 leading-tight">{m.description}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── 3-Column Editor ─────────────────────────────── */}
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-4 p-4 overflow-hidden h-[calc(100vh-137px)]">

        {/* Column 1 — Input ───────────────────────────── */}
        <div className="flex flex-col rounded-xl border border-zinc-800 overflow-hidden bg-zinc-900/60 shadow-sm">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-800 bg-zinc-800/40">
            <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Raw Input</span>
            {inputText && (
              <button
                onClick={() => setInputText('')}
                className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                title="Clear input"
              >
                <X className="w-3.5 h-3.5" /> Clear
              </button>
            )}
          </div>
          <textarea
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            placeholder="Paste your messy project description, notes, or code dumps here…"
            className="flex-1 bg-transparent p-4 resize-none text-zinc-300 placeholder:text-zinc-600 leading-relaxed text-sm"
          />
          <div className="px-4 py-2 border-t border-zinc-800 flex items-center justify-between">
            <WordCount text={inputText} />
          </div>
        </div>

        {/* Column 2 — Markdown Output ─────────────────── */}
        <div className="flex flex-col rounded-xl border border-zinc-800 overflow-hidden bg-zinc-900/60 shadow-sm">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-800 bg-zinc-800/40">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Markdown</span>
              {isGenerating && (
                <span className="text-xs text-emerald-400 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping inline-block" />
                  Generating…
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleCopy}
                disabled={!outputText}
                title="Copy markdown"
                className="flex items-center gap-1.5 text-xs font-medium text-zinc-400 hover:text-zinc-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors px-2.5 py-1.5 rounded-lg hover:bg-zinc-700/60"
              >
                <Copy className="w-3.5 h-3.5" /> Copy
              </button>
              <button
                onClick={handleDownload}
                disabled={!outputText}
                title="Download README.md"
                className="flex items-center gap-1.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white px-2.5 py-1.5 rounded-lg transition-all disabled:cursor-not-allowed"
              >
                <Download className="w-3.5 h-3.5" /> Download
              </button>
            </div>
          </div>
          <textarea
            value={outputText}
            readOnly
            placeholder="Formatted README.md will appear here…"
            className={`flex-1 bg-transparent p-4 resize-none text-zinc-400 font-mono text-xs leading-relaxed ${outputText ? 'animate-fade-in' : ''} ${isGenerating ? 'typing-cursor' : ''}`}
          />
          <div className="px-4 py-2 border-t border-zinc-800">
            <WordCount text={outputText} />
          </div>
        </div>

        {/* Column 3 — Preview ──────────────────────────── */}
        <div className="flex flex-col rounded-xl border border-zinc-800 overflow-hidden bg-zinc-900/60 shadow-sm">
          <div className="px-4 py-2.5 border-b border-zinc-800 bg-zinc-800/40">
            <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Preview</span>
          </div>
          <div className="flex-1 p-6 lg:p-10 overflow-y-auto bg-zinc-950/50 custom-scrollbar">
            {outputText ? (
              <div className="prose prose-invert prose-zinc max-w-none animate-fade-in
                prose-p:leading-relaxed prose-p:text-zinc-300
                prose-headings:font-semibold prose-headings:tracking-tight prose-headings:text-zinc-100
                prose-h1:text-3xl prose-h1:mb-6 prose-h1:bg-gradient-to-br prose-h1:from-emerald-400 prose-h1:to-emerald-200 prose-h1:bg-clip-text prose-h1:text-transparent
                prose-h2:text-2xl prose-h2:mt-10 prose-h2:mb-4 prose-h2:border-b prose-h2:border-zinc-800/60 prose-h2:pb-2
                prose-h3:text-xl prose-h3:text-emerald-50
                prose-a:text-emerald-400 prose-a:no-underline hover:prose-a:text-emerald-300 hover:prose-a:underline
                prose-strong:text-zinc-200 prose-strong:font-semibold
                prose-ul:list-disc prose-ol:list-decimal prose-li:marker:text-emerald-500/50
                prose-hr:border-zinc-800/60
                prose-blockquote:border-l-emerald-500/50 prose-blockquote:bg-zinc-900/30 prose-blockquote:py-1 prose-blockquote:px-4 prose-blockquote:rounded-r-lg prose-blockquote:text-zinc-400 prose-blockquote:not-italic
                prose-code:text-emerald-300 prose-code:bg-zinc-900 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-code:text-[0.85em] prose-code:font-medium prose-code:before:content-none prose-code:after:content-none
                prose-pre:bg-zinc-950 prose-pre:border prose-pre:border-zinc-800/80 prose-pre:shadow-lg prose-pre:text-sm prose-pre:rounded-xl prose-pre:p-4
                prose-img:rounded-xl prose-img:border prose-img:border-zinc-800/60 prose-img:shadow-md
                prose-table:border-collapse prose-th:bg-zinc-900/50 prose-th:p-3 prose-th:text-left prose-th:text-xs prose-th:uppercase prose-th:tracking-wider prose-th:text-zinc-400 prose-th:border-b prose-th:border-zinc-800
                prose-td:p-3 prose-td:border-b prose-td:border-zinc-800/50 prose-td:text-sm prose-td:text-zinc-300">
                <Markdown remarkPlugins={[remarkGfm, remarkBreaks]}>
                  {cleanMarkdown(outputText)}
                </Markdown>
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-zinc-600 gap-4 animate-slide-up">
                <div className="relative">
                  <div className="w-16 h-16 rounded-2xl border border-zinc-800 bg-zinc-900 flex items-center justify-center">
                    <Sparkles className="w-7 h-7 text-zinc-700" />
                  </div>
                  <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  </div>
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-zinc-500">Preview will appear here</p>
                  <p className="text-xs text-zinc-600 mt-1">Paste your text and click Generate</p>
                </div>
              </div>
            )}
          </div>
        </div>

      </main>
    </div>
  );
}
