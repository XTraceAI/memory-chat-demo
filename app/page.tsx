'use client';

import { useChat } from '@ai-sdk/react';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

type StoredMemory = {
  id: string;
  type: 'fact' | 'artifact' | 'episode';
  text: string;
  created_at: string;
  details?: { status?: string; fact_type?: string } | null;
};

export default function Home() {
  const [memories, setMemories] = useState<StoredMemory[]>([]);
  const [memoriesLoading, setMemoriesLoading] = useState(false);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [input, setInput] = useState('');
  // Track ids we've already seen so we only highlight true deltas — never on
  // first load (where everything would qualify as "new").
  const seenIdsRef = useRef<Set<string>>(new Set());
  const isInitialLoadRef = useRef(true);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { messages, sendMessage, status } = useChat({
    onFinish: () => {
      // Memory ingest runs server-side and is awaited before the stream closes;
      // by the time we land here the new memories should be queryable.
      refreshMemories();
    },
  });

  const refreshMemories = useCallback(async () => {
    setMemoriesLoading(true);
    try {
      const res = await fetch('/api/memories', { cache: 'no-store' });
      const data = await res.json();
      const active: StoredMemory[] = (data.memories ?? []).filter(
        (m: StoredMemory) => m.details?.status !== 'retracted',
      );
      setMemories(active);

      const currentIds = new Set(active.map((m) => m.id));
      if (!isInitialLoadRef.current) {
        const justAdded = new Set(
          [...currentIds].filter((id) => !seenIdsRef.current.has(id)),
        );
        if (justAdded.size > 0) {
          setNewIds(justAdded);
          if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
          highlightTimerRef.current = setTimeout(() => setNewIds(new Set()), 10_000);
        }
      }
      seenIdsRef.current = currentIds;
      isInitialLoadRef.current = false;
    } catch (err) {
      console.error('Failed to fetch memories:', err);
    } finally {
      setMemoriesLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshMemories();
    return () => {
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    };
  }, [refreshMemories]);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || status === 'streaming' || status === 'submitted') return;
    sendMessage({ text });
    setInput('');
  };

  const onReset = async () => {
    if (!confirm('Wipe every memory for this demo user. Continue?')) return;
    await fetch('/api/memories', { method: 'DELETE' });
    setNewIds(new Set());
    seenIdsRef.current = new Set();
    refreshMemories();
  };

  return (
    <main className="flex h-screen flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <Header onReset={onReset} />
      <div className="flex flex-1 overflow-hidden">
        <ChatPane
          messages={messages}
          status={status}
          input={input}
          setInput={setInput}
          onSubmit={onSubmit}
        />
        <MemoryPane
          memories={memories}
          loading={memoriesLoading}
          onRefresh={refreshMemories}
          newIds={newIds}
        />
      </div>
    </main>
  );
}

function Header({ onReset }: { onReset: () => void }) {
  return (
    <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div>
        <h1 className="text-base font-semibold">Memory Chat</h1>
        <p className="text-xs text-zinc-500">
          GPT-4o-mini + <code className="font-mono">@xtraceai/memory</code> · memory persists across page reloads
        </p>
      </div>
      <button
        onClick={onReset}
        className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
      >
        Reset memory
      </button>
    </header>
  );
}

type ChatMessage = ReturnType<typeof useChat>['messages'][number];

function ChatPane({
  messages,
  status,
  input,
  setInput,
  onSubmit,
}: {
  messages: ChatMessage[];
  status: ReturnType<typeof useChat>['status'];
  input: string;
  setInput: (v: string) => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const busy = status === 'streaming' || status === 'submitted';

  return (
    <section className="flex flex-1 flex-col">
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {messages.length === 0 && <EmptyState />}
        <div className="mx-auto flex max-w-2xl flex-col gap-4">
          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}
          {status === 'submitted' && (
            <div className="text-xs italic text-zinc-500">thinking…</div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>
      <form
        onSubmit={onSubmit}
        className="border-t border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <div className="mx-auto flex max-w-2xl gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Say something the assistant should remember…"
            className="flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-800"
            disabled={busy}
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            Send
          </button>
        </div>
      </form>
    </section>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  const text = message.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('');
  return (
    <div className={isUser ? 'flex justify-end' : 'flex justify-start'}>
      <div
        className={`max-w-[85%] rounded-lg px-4 py-2.5 text-sm leading-relaxed ${
          isUser
            ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
            : 'bg-white text-zinc-900 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-100 dark:ring-zinc-800'
        }`}
      >
        {text || <span className="italic opacity-50">…</span>}
      </div>
    </div>
  );
}

function EmptyState() {
  const suggestions = [
    "My name is Sam and I'm vegetarian.",
    'I prefer concise replies over long ones.',
    'I live in Tokyo and work as a graphic designer.',
  ];
  return (
    <div className="mx-auto max-w-2xl pt-16 text-center text-zinc-500">
      <p className="mb-4 text-sm">
        Tell me something about yourself. I&apos;ll remember it across the conversation — and across reloads.
      </p>
      <div className="flex flex-col gap-2 text-xs">
        <p className="text-zinc-400">Try:</p>
        {suggestions.map((s) => (
          <p key={s} className="rounded bg-white px-3 py-2 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
            {s}
          </p>
        ))}
      </div>
    </div>
  );
}

function MemoryPane({
  memories,
  loading,
  onRefresh,
  newIds,
}: {
  memories: StoredMemory[];
  loading: boolean;
  onRefresh: () => void;
  newIds: Set<string>;
}) {
  // Sort: new ones first (so they're easy to spot), then by created_at desc.
  const sorted = [...memories].sort((a, b) => {
    const aNew = newIds.has(a.id) ? 1 : 0;
    const bNew = newIds.has(b.id) ? 1 : 0;
    if (aNew !== bNew) return bNew - aNew;
    return (b.created_at ?? '').localeCompare(a.created_at ?? '');
  });

  return (
    <aside className="w-80 flex-shrink-0 overflow-y-auto border-l border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">What I remember</h2>
          {newIds.size > 0 && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
              +{newIds.size} new
            </span>
          )}
        </div>
        <button
          onClick={onRefresh}
          className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          disabled={loading}
        >
          {loading ? '…' : 'refresh'}
        </button>
      </div>
      {memories.length === 0 ? (
        <p className="text-xs text-zinc-500">
          No memories yet. Send a message that includes a fact about yourself (your name, a preference, where you live) and watch this fill up.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {sorted.map((m) => {
            const isNew = newIds.has(m.id);
            return (
              <li
                key={m.id}
                className={
                  'rounded-md border p-2.5 text-xs transition-all duration-500 ' +
                  (isNew
                    ? 'border-emerald-300 bg-emerald-50 ring-1 ring-emerald-200 dark:border-emerald-700 dark:bg-emerald-950/40 dark:ring-emerald-800'
                    : 'border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950')
                }
              >
                <div className="mb-1 flex items-center gap-2">
                  <span className="rounded bg-zinc-200 px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wide text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                    {m.type}
                  </span>
                  {m.details?.fact_type && (
                    <span className="text-[10px] text-zinc-500">{m.details.fact_type}</span>
                  )}
                  {isNew && (
                    <span className="ml-auto rounded bg-emerald-500 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                      new
                    </span>
                  )}
                </div>
                <p className="text-zinc-700 dark:text-zinc-300">{m.text}</p>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
