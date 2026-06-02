'use client';

import { useChat } from '@ai-sdk/react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { PERSONAS, DEFAULT_PERSONA, personaName, type PersonaId } from '@/lib/personas';

type StoredMemory = {
  id: string;
  type: 'fact' | 'artifact' | 'episode';
  text: string;
  created_at: string;
  score?: number | null;
  group_ids?: string[];
  details?: { status?: string; fact_type?: string } | null;
};

type ScopeStat = { scope: string; count: number };
type RecallContext = { prompt: string; scopes: ScopeStat[] } | null;
type SidebarTab = 'context' | 'memories';

export default function Home() {
  const [persona, setPersona] = useState<PersonaId>(DEFAULT_PERSONA);
  const [tab, setTab] = useState<SidebarTab>('memories');

  const [memories, setMemories] = useState<StoredMemory[]>([]);
  const [memoriesLoading, setMemoriesLoading] = useState(false);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());

  const [context, setContext] = useState<RecallContext>(null);
  const [contextLoading, setContextLoading] = useState(false);

  const [input, setInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [seeding, setSeeding] = useState(false);

  // Track ids we've already seen so we only highlight true deltas.
  const seenIdsRef = useRef<Set<string>>(new Set());
  const isInitialLoadRef = useRef(true);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queryRef = useRef('');
  // Keep the current persona reachable from stable callbacks (transport, onFinish).
  const personaRef = useRef<PersonaId>(persona);
  // Monotonic request ids: a fetch only writes its result/clears its loading flag
  // if it's still the latest of its kind. Prevents an in-flight fetch for the old
  // persona (or an earlier query) from clobbering newer state after it resolves.
  const memoriesReqRef = useRef(0);
  const contextReqRef = useRef(0);

  const resetHighlights = useCallback(() => {
    setNewIds(new Set());
    seenIdsRef.current = new Set();
    isInitialLoadRef.current = true;
  }, []);

  const refreshMemories = useCallback(async (q: string = '') => {
    const reqId = ++memoriesReqRef.current;
    setMemoriesLoading(true);
    try {
      const p = personaRef.current;
      const base = `/api/memories?persona=${p}`;
      const url = q ? `${base}&q=${encodeURIComponent(q)}` : base;
      const res = await fetch(url, { cache: 'no-store' });
      const data = await res.json();
      // Superseded by a newer refresh (debounce / onFinish / persona switch)?
      // Drop the result so it can't clobber the latest data or highlight diff.
      if (memoriesReqRef.current !== reqId) return;
      const active: StoredMemory[] = (data.memories ?? []).filter(
        (m: StoredMemory) => m.details?.status !== 'retracted',
      );
      setMemories(active);

      // Highlight "just added" only in list mode — meaningless during search.
      if (!q) {
        const currentIds = new Set(active.map((m) => m.id));
        if (!isInitialLoadRef.current) {
          const justAdded = new Set([...currentIds].filter((id) => !seenIdsRef.current.has(id)));
          if (justAdded.size > 0) {
            setNewIds(justAdded);
            if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
            highlightTimerRef.current = setTimeout(() => setNewIds(new Set()), 10_000);
          }
        }
        seenIdsRef.current = currentIds;
        isInitialLoadRef.current = false;
      }
    } catch (err) {
      if (memoriesReqRef.current === reqId) console.error('Failed to fetch memories:', err);
    } finally {
      // Only the latest refresh owns the loading flag (per-handler lifecycle).
      if (memoriesReqRef.current === reqId) setMemoriesLoading(false);
    }
  }, []);

  const { messages, sendMessage, status, setMessages } = useChat({
    onFinish: () => {
      // Ingest runs server-side and is awaited before the stream closes, so the
      // new (tagged) memory should be queryable by the time we refresh.
      refreshMemories(queryRef.current);
    },
  });

  // Preview the exact context recall() assembles for a query + the current persona.
  const previewContext = useCallback(async (query: string) => {
    const reqId = ++contextReqRef.current;
    setContextLoading(true);
    try {
      const res = await fetch('/api/recall', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query, persona: personaRef.current }),
      });
      const data = await res.json();
      // Drop if a newer preview started or the persona switched mid-flight.
      if (contextReqRef.current !== reqId) return;
      setContext(data);
    } catch (err) {
      if (contextReqRef.current === reqId) console.error('Failed to fetch recall context:', err);
    } finally {
      if (contextReqRef.current === reqId) setContextLoading(false);
    }
  }, []);

  // Debounce the memory-search input (300ms).
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery.trim()), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  useEffect(() => {
    queryRef.current = debouncedQuery;
  }, [debouncedQuery]);

  useEffect(() => {
    // Deliberate external-system sync: (re)load the memory list on mount and
    // whenever the debounced search query changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshMemories(debouncedQuery);
  }, [debouncedQuery, refreshMemories]);

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    };
  }, []);

  const busy = status === 'streaming' || status === 'submitted';

  // Switching traveler resets the thread + context and reloads their memories.
  // This lives in the event handler (not an effect) so it's a single, explicit
  // transition rather than a cascade. personaRef updates first so the refetch
  // and the chat transport pick up the new persona immediately.
  const onPersona = (p: PersonaId) => {
    if (p === persona) return;
    personaRef.current = p;
    contextReqRef.current++; // invalidate any in-flight context preview
    setPersona(p);
    setMessages([]);
    setContext(null);
    setMemories([]); // don't show the previous traveler's memories mid-load
    resetHighlights();
    setSearchQuery('');
    setTab('memories');
    refreshMemories(''); // bumps memoriesReqRef → supersedes any in-flight fetch
  };

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    // Per-message body carries the active persona to the chat route.
    sendMessage({ text }, { body: { persona } });
    previewContext(text);
    setTab('context');
    setInput('');
  };

  const onSeed = async () => {
    setSeeding(true);
    try {
      await fetch('/api/seed', { method: 'POST' });
      resetHighlights();
      await refreshMemories('');
    } catch (err) {
      console.error('Seed failed:', err);
    } finally {
      setSeeding(false);
    }
  };

  const onReset = async () => {
    if (!confirm('Wipe all traveler memories (Alice + Bob). The travel guide stays. Continue?')) return;
    await fetch('/api/memories', { method: 'DELETE' });
    contextReqRef.current++; // invalidate any in-flight context preview
    setContext(null);
    setMessages([]);
    setMemories([]);
    resetHighlights();
    setSearchQuery('');
    refreshMemories('');
  };

  return (
    <main className="flex h-screen flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <Header
        persona={persona}
        onPersona={onPersona}
        onSeed={onSeed}
        onReset={onReset}
        seeding={seeding}
      />
      <div className="flex flex-1 overflow-hidden">
        <ChatPane
          persona={persona}
          messages={messages}
          status={status}
          input={input}
          setInput={setInput}
          onSubmit={onSubmit}
        />
        <Sidebar
          tab={tab}
          onTab={setTab}
          persona={persona}
          context={context}
          contextLoading={contextLoading}
          memories={memories}
          loading={memoriesLoading}
          onRefresh={() => refreshMemories(debouncedQuery)}
          newIds={newIds}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          isSearching={debouncedQuery.length > 0}
        />
      </div>
    </main>
  );
}

function Header({
  persona,
  onPersona,
  onSeed,
  onReset,
  seeding,
}: {
  persona: PersonaId;
  onPersona: (p: PersonaId) => void;
  onSeed: () => void;
  onReset: () => void;
  seeding: boolean;
}) {
  return (
    <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div>
        <h1 className="text-base font-semibold">TripMate · shared trip memory</h1>
        <p className="text-xs text-zinc-500">
          <code className="font-mono">recall()</code> unions personal + trip + travel-guide memory · powered by{' '}
          <code className="font-mono">@xtraceai/memory</code>
        </p>
      </div>
      <div className="flex items-center gap-3">
        <PersonaSwitcher persona={persona} onPersona={onPersona} />
        <button
          onClick={onSeed}
          disabled={seeding}
          className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
        >
          {seeding ? 'Seeding…' : 'Seed demo'}
        </button>
        <button
          onClick={onReset}
          className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
        >
          Reset
        </button>
      </div>
    </header>
  );
}

function PersonaSwitcher({
  persona,
  onPersona,
}: {
  persona: PersonaId;
  onPersona: (p: PersonaId) => void;
}) {
  const active = PERSONAS.find((p) => p.id === persona);
  return (
    <div className="flex flex-col items-end">
      <div className="flex rounded-md border border-zinc-300 p-0.5 dark:border-zinc-700">
        {PERSONAS.map((p) => (
          <button
            key={p.id}
            onClick={() => onPersona(p.id)}
            className={
              'rounded px-3 py-1 text-xs font-medium transition ' +
              (p.id === persona
                ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100')
            }
          >
            {p.name}
          </button>
        ))}
      </div>
      {active && <p className="mt-0.5 text-[10px] text-zinc-400">{active.blurb}</p>}
    </div>
  );
}

type ChatMessage = ReturnType<typeof useChat>['messages'][number];

function ChatPane({
  persona,
  messages,
  status,
  input,
  setInput,
  onSubmit,
}: {
  persona: PersonaId;
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
        {messages.length === 0 && <EmptyState persona={persona} />}
        <div className="mx-auto flex max-w-2xl flex-col gap-4">
          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}
          {status === 'submitted' && <div className="text-xs italic text-zinc-500">thinking…</div>}
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
            placeholder={`Ask as ${personaName(persona)} — try "where should we eat near the hotel?"`}
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

function EmptyState({ persona }: { persona: PersonaId }) {
  const suggestions = [
    'Where should we grab dinner near the hotel the first night?',
    'What should I pack and sort out before we fly?',
    'Plan a low-key first afternoon once we land.',
  ];
  return (
    <div className="mx-auto max-w-2xl pt-16 text-center text-zinc-500">
      <p className="mb-2 text-sm">
        You&apos;re chatting as <strong>{personaName(persona)}</strong>. The assistant blends{' '}
        <strong>your</strong> preferences, the <strong>trip&apos;s</strong> shared facts, and a{' '}
        <strong>travel guide</strong> — all in one <code className="font-mono">recall()</code>.
      </p>
      <p className="mb-4 text-xs text-zinc-400">
        New here? Hit <strong>Seed demo</strong> first, then try a question. Switch traveler to see the
        personal slice change while the trip + guide stay shared.
      </p>
      <div className="flex flex-col gap-2 text-xs">
        <p className="text-zinc-400">Try:</p>
        {suggestions.map((s) => (
          <p
            key={s}
            className="rounded bg-white px-3 py-2 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800"
          >
            {s}
          </p>
        ))}
      </div>
    </div>
  );
}

function Sidebar({
  tab,
  onTab,
  persona,
  context,
  contextLoading,
  memories,
  loading,
  onRefresh,
  newIds,
  searchQuery,
  onSearchChange,
  isSearching,
}: {
  tab: SidebarTab;
  onTab: (t: SidebarTab) => void;
  persona: PersonaId;
  context: RecallContext;
  contextLoading: boolean;
  memories: StoredMemory[];
  loading: boolean;
  onRefresh: () => void;
  newIds: Set<string>;
  searchQuery: string;
  onSearchChange: (v: string) => void;
  isSearching: boolean;
}) {
  return (
    <aside className="flex w-96 flex-shrink-0 flex-col overflow-hidden border-l border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex border-b border-zinc-200 dark:border-zinc-800">
        <TabButton active={tab === 'context'} onClick={() => onTab('context')}>
          Context
        </TabButton>
        <TabButton active={tab === 'memories'} onClick={() => onTab('memories')}>
          {personaName(persona)}&apos;s memories
        </TabButton>
      </div>
      {tab === 'context' ? (
        <ContextPanel context={context} loading={contextLoading} />
      ) : (
        <MemoryPanel
          memories={memories}
          loading={loading}
          onRefresh={onRefresh}
          newIds={newIds}
          searchQuery={searchQuery}
          onSearchChange={onSearchChange}
          isSearching={isSearching}
        />
      )}
    </aside>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={
        'flex-1 px-4 py-2.5 text-xs font-semibold transition ' +
        (active
          ? 'border-b-2 border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100'
          : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200')
      }
    >
      {children}
    </button>
  );
}

const SCOPE_LABELS: Record<string, string> = {
  personal: 'Personal',
  shared: 'Trip',
  scope: 'Guide',
};

function ContextPanel({ context, loading }: { context: RecallContext; loading: boolean }) {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="border-b border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-sm font-semibold">Assembled context</h2>
        <p className="mt-0.5 text-[11px] text-zinc-500">
          The single prompt <code className="font-mono">recall()</code> built for the last question —
          personal + trip + guide, deduped and sectioned.
        </p>
        {context && context.scopes.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {context.scopes.map((s, i) => (
              <span
                key={`${s.scope}-${i}`}
                className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
              >
                {SCOPE_LABELS[s.scope] ?? s.scope} · {s.count}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <p className="text-xs text-zinc-500">Assembling…</p>
        ) : context && context.prompt ? (
          <pre className="whitespace-pre-wrap break-words rounded-md border border-zinc-200 bg-zinc-50 p-3 font-mono text-[11px] leading-relaxed text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
            {context.prompt}
          </pre>
        ) : (
          <p className="text-xs text-zinc-500">
            Send a message to see the personal + trip + guide context the assistant was given.
          </p>
        )}
      </div>
    </div>
  );
}

function MemoryPanel({
  memories,
  loading,
  onRefresh,
  newIds,
  searchQuery,
  onSearchChange,
  isSearching,
}: {
  memories: StoredMemory[];
  loading: boolean;
  onRefresh: () => void;
  newIds: Set<string>;
  searchQuery: string;
  onSearchChange: (v: string) => void;
  isSearching: boolean;
}) {
  const sorted = isSearching
    ? memories
    : [...memories].sort((a, b) => {
        const aNew = newIds.has(a.id) ? 1 : 0;
        const bNew = newIds.has(b.id) ? 1 : 0;
        if (aNew !== bNew) return bNew - aNew;
        return (b.created_at ?? '').localeCompare(a.created_at ?? '');
      });

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="border-b border-zinc-200 p-4 dark:border-zinc-800">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">{isSearching ? 'Search results' : 'Stored memories'}</h2>
            {!isSearching && newIds.size > 0 && (
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
        <div className="relative">
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search this traveler's memories…"
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 pr-7 text-xs outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-800"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              ×
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {memories.length === 0 ? (
          <p className="text-xs text-zinc-500">
            {isSearching
              ? `No matches for "${searchQuery.trim()}". Try different words.`
              : 'No memories yet. Hit “Seed demo”, or chat — facts you share get extracted and tagged here.'}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {sorted.map((m) => {
              const isNew = !isSearching && newIds.has(m.id);
              const isShared = (m.group_ids?.length ?? 0) > 0;
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
                    {isShared && (
                      <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                        shared · trip
                      </span>
                    )}
                    {isSearching && typeof m.score === 'number' && (
                      <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-mono tabular-nums text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                        {m.score.toFixed(2)}
                      </span>
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
      </div>
    </div>
  );
}
