'use client';

import { useChat } from '@ai-sdk/react';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { PERSONAS, DEFAULT_PERSONA, personaName, type PersonaId } from '@/lib/personas';

/** A rule TripMate learned from a correction (the SDK's lesson/procedure). */
type Rule = {
  id: string;
  text: string;
  observation_count: number | null;
};

/** A traveler's own preference fact (personal, per user). */
type Pref = { id: string; text: string };

const PERSONA_AVATAR: Record<string, string> = {
  alice: 'bg-rose-500',
  bob: 'bg-sky-500',
};
function avatarColor(id: string) {
  return PERSONA_AVATAR[id] ?? 'bg-indigo-500';
}

/* ---------------------------------- icons --------------------------------- */
type IconName = 'plane' | 'search' | 'ticket' | 'bell' | 'spark' | 'check' | 'brain';
const ICON_PATHS: Record<IconName, React.ReactNode> = {
  plane: <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </>
  ),
  ticket: (
    <>
      <path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4V7Z" />
      <path d="M12 5v14" strokeDasharray="2 2" />
    </>
  ),
  bell: (
    <>
      <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </>
  ),
  spark: <path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4L12 3Z" />,
  check: <path d="M20 6 9 17l-5-5" />,
  brain: <path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-1 5 3 3 0 0 0 2 4 3 3 0 0 0 5 1V4.5A2.5 2.5 0 0 0 9 4Zm6 0a3 3 0 0 1 3 3 3 3 0 0 1 1 5 3 3 0 0 1-2 4 3 3 0 0 1-5 1" />,
};
function Icon({ name, className = 'h-4 w-4' }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {ICON_PATHS[name]}
    </svg>
  );
}

/* ------------------------------------ app --------------------------------- */
export default function Home() {
  const [persona, setPersona] = useState<PersonaId>(DEFAULT_PERSONA);
  const [rules, setRules] = useState<Rule[]>([]);
  const [preferences, setPreferences] = useState<Record<string, Pref[]>>({});
  const [rulesLoading, setRulesLoading] = useState(false);
  const [input, setInput] = useState('');

  const rulesReqRef = useRef(0);
  // Keep each traveler's chat thread across persona switches — useChat only holds
  // one thread at a time, so we stash the outgoing one and restore the incoming.
  const threadsRef = useRef<Record<string, ChatMessage[]>>({});

  const fetchRules = useCallback(async () => {
    const reqId = ++rulesReqRef.current;
    setRulesLoading(true);
    try {
      const res = await fetch('/api/playbook', { cache: 'no-store' });
      const data = await res.json();
      if (rulesReqRef.current !== reqId) return;
      setRules(data.rules ?? []);
      setPreferences(data.preferences ?? {});
    } catch (err) {
      if (rulesReqRef.current === reqId) console.error('Failed to load rules:', err);
    } finally {
      if (rulesReqRef.current === reqId) setRulesLoading(false);
    }
  }, []);

  const { messages, sendMessage, status, setMessages, stop } = useChat({
    // A newly learned rule can land a moment after the stream closes (the rule
    // is captured server-side as the turn is ingested), so re-check a few times —
    // the panel then updates on its own, no manual refresh needed.
    onFinish: () => {
      fetchRules();
      [2000, 5000, 9000].forEach((ms) => setTimeout(fetchRules, ms));
    },
  });

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchRules();
  }, [fetchRules]);

  const busy = status === 'streaming' || status === 'submitted';

  // Switching traveler halts any stream and swaps in that traveler's own thread
  // (stashing the current one first), so switching back restores the conversation.
  // The learned rules stay — they're shared, so the new traveler already knows them.
  const onPersona = (p: PersonaId) => {
    if (p === persona) return;
    stop();
    threadsRef.current[persona] = messages;
    setPersona(p);
    setMessages(threadsRef.current[p] ?? []);
    fetchRules();
  };

  const send = (text: string) => {
    const t = text.trim();
    if (!t || busy) return;
    sendMessage({ text: t }, { body: { persona } });
    setInput('');
  };

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    send(input);
  };

  const onReset = async () => {
    if (!confirm('Clear everything TripMate has learned and start over?')) return;
    stop();
    rulesReqRef.current++;
    threadsRef.current = {}; // drop both travelers' stashed threads
    await fetch('/api/memories', { method: 'DELETE' });
    setMessages([]);
    setRules([]);
    setPreferences({});
    await fetchRules();
  };

  return (
    <main className="flex h-screen flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <Header persona={persona} onPersona={onPersona} onReset={onReset} />
      <div className="flex flex-1 overflow-hidden">
        <ChatPane
          persona={persona}
          messages={messages}
          status={status}
          input={input}
          setInput={setInput}
          onSubmit={onSubmit}
          onPick={send}
        />
        <RulesPanel rules={rules} preferences={preferences} loading={rulesLoading} onRefresh={fetchRules} />
      </div>
    </main>
  );
}

/* ---------------------------------- header -------------------------------- */
function Header({
  persona,
  onPersona,
  onReset,
}: {
  persona: PersonaId;
  onPersona: (p: PersonaId) => void;
  onReset: () => void;
}) {
  return (
    <header className="flex items-center justify-between gap-4 border-b border-zinc-200 bg-white/80 px-6 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/80">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm">
          <Icon name="plane" className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-[15px] font-semibold leading-tight">TripMate</h1>
          <p className="text-xs text-zinc-500">Books flights for your group — and remembers what you teach it</p>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <PersonaSwitcher persona={persona} onPersona={onPersona} />
        <button
          onClick={onReset}
          className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-600 shadow-sm transition hover:bg-zinc-50 hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
        >
          Start over
        </button>
      </div>
    </header>
  );
}

function PersonaSwitcher({ persona, onPersona }: { persona: PersonaId; onPersona: (p: PersonaId) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="hidden text-xs text-zinc-400 sm:inline">Booking as</span>
      <div className="flex gap-1 rounded-full bg-zinc-100 p-1 dark:bg-zinc-800">
        {PERSONAS.map((p) => {
          const active = p.id === persona;
          return (
            <button
              key={p.id}
              onClick={() => onPersona(p.id)}
              className={
                'flex items-center gap-1.5 rounded-full py-1 pl-1 pr-3 text-xs font-medium transition ' +
                (active
                  ? 'bg-white shadow-sm text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200')
              }
            >
              <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold text-white ${avatarColor(p.id)}`}>
                {p.name[0]}
              </span>
              {p.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ----------------------------------- chat --------------------------------- */
type ChatMessage = ReturnType<typeof useChat>['messages'][number];

/** Guided demo prompts — shown in the empty state and as a persistent, clickable
 *  strip above the input so "try in order" never disappears mid-conversation. */
const SUGGESTIONS: { label: string; prompt: string; note?: string }[] = [
  { label: 'Book a flight', prompt: 'Book me a flight to Tokyo for the trip.' },
  {
    label: 'Group rule: always nonstop',
    prompt: 'For our group, always book nonstop flights — we’re all flying together, even if it costs a bit more.',
  },
  { label: 'My seat: window', prompt: 'For me personally, I’d like a window seat.' },
  { label: 'Book again', prompt: 'Book my flight to Tokyo too.', note: 'switch traveler first' },
];

function ChatPane({
  persona,
  messages,
  status,
  input,
  setInput,
  onSubmit,
  onPick,
}: {
  persona: PersonaId;
  messages: ChatMessage[];
  status: ReturnType<typeof useChat>['status'];
  input: string;
  setInput: (v: string) => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  onPick: (text: string) => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const busy = status === 'streaming' || status === 'submitted';

  return (
    <section className="flex flex-1 flex-col">
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {messages.length === 0 && <EmptyState onPick={onPick} />}
        <div className="mx-auto flex max-w-2xl flex-col gap-4">
          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} persona={persona} />
          ))}
          {status === 'submitted' && (
            <div className="flex items-center gap-2 text-xs text-zinc-400">
              <span className="h-2 w-2 animate-pulse rounded-full bg-indigo-500" />
              TripMate is working…
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>
      <form onSubmit={onSubmit} className="border-t border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto max-w-2xl">
          {messages.length > 0 && (
            <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-medium text-zinc-400">Try in order:</span>
              {SUGGESTIONS.map((s, i) => (
                <button
                  key={s.prompt}
                  type="button"
                  onClick={() => onPick(s.prompt)}
                  className="flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-600 shadow-sm transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:border-indigo-700 dark:hover:bg-indigo-950/40"
                >
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-zinc-100 text-[9px] font-semibold text-zinc-500 dark:bg-zinc-700 dark:text-zinc-200">
                    {i + 1}
                  </span>
                  {s.label}
                  {s.note && <span className="text-[10px] text-zinc-400">· {s.note}</span>}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={`Message TripMate as ${personaName(persona)}…`}
              className="flex-1 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-sm outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100 dark:border-zinc-700 dark:bg-zinc-800 dark:focus:border-indigo-500 dark:focus:ring-indigo-900/40"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              aria-label="Send"
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm transition hover:bg-indigo-500 disabled:opacity-40"
            >
              <Icon name="plane" className="h-4 w-4" />
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}

function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="mx-auto max-w-xl pt-12 text-center">
      <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-sm">
        <Icon name="plane" className="h-6 w-6" />
      </span>
      <h2 className="text-lg font-semibold">Ask TripMate to book a flight</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-zinc-500">
        It suggests the cheapest option and asks before booking. Teach it a{' '}
        <strong className="font-medium text-zinc-700 dark:text-zinc-300">group rule</strong> — like always fly
        nonstop — and every teammate inherits it.{' '}
        <strong className="font-medium text-zinc-700 dark:text-zinc-300">Personal</strong> choices, like your
        seat, stay yours.
      </p>
      <div className="mt-6 flex flex-col gap-2 text-left">
        <p className="text-center text-xs font-medium uppercase tracking-wide text-zinc-400">Try it in order</p>
        {SUGGESTIONS.map((s, i) => (
          <button
            key={s.prompt}
            type="button"
            onClick={() => onPick(s.prompt)}
            className="flex items-start gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 text-left text-sm shadow-sm transition hover:border-indigo-300 hover:bg-indigo-50/50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-indigo-800 dark:hover:bg-indigo-950/30"
          >
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-[11px] font-semibold text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
              {i + 1}
            </span>
            <span className="text-zinc-700 dark:text-zinc-300">{s.prompt}</span>
            {s.note && (
              <span className="ml-auto shrink-0 self-center rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                {s.note}
              </span>
            )}
          </button>
        ))}
      </div>
      <p className="mt-4 text-xs text-zinc-400">Powered by @xtraceai/memory</p>
    </div>
  );
}

/* ------------------------------- message parts ---------------------------- */
type UIPart = {
  type: string;
  text?: string;
  toolName?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  data?: unknown;
};

type FlightRow = {
  id: string;
  airline: string;
  depart: string;
  stops: number;
  redeye: boolean;
  seat: string;
  price: number;
};

function MessageBubble({ message, persona }: { message: ChatMessage; persona: PersonaId }) {
  const isUser = message.role === 'user';
  const parts = (message.parts ?? []) as UIPart[];

  if (isUser) {
    const text = parts.filter((p) => p.type === 'text').map((p) => p.text ?? '').join('');
    return (
      <div className="flex items-start justify-end gap-2">
        <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-zinc-900 px-4 py-2.5 text-sm leading-relaxed text-white dark:bg-zinc-100 dark:text-zinc-900">
          {text}
        </div>
        <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white ${avatarColor(persona)}`}>
          {personaName(persona)[0]}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-2">
      {parts.map((part, i) => {
        if (part.type === 'text') {
          return part.text ? (
            <div
              key={i}
              className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-tl-sm bg-white px-4 py-2.5 text-sm leading-relaxed text-zinc-800 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-200 dark:ring-zinc-800"
            >
              {part.text}
            </div>
          ) : null;
        }
        if (part.type === 'data-hook') {
          return <HookLine key={i} data={part.data} />;
        }
        if (part.type === 'dynamic-tool' || part.type.startsWith('tool-')) {
          const name = part.type === 'dynamic-tool' ? part.toolName ?? 'tool' : part.type.slice(5);
          return <ToolStepCard key={i} name={name} part={part} />;
        }
        return null;
      })}
    </div>
  );
}

/** Plain-English description of a flight search's criteria. */
function describeSearch(input: unknown): string {
  const o = (input ?? {}) as Record<string, unknown>;
  const bits: string[] = [];
  if (o.nonstop === true) bits.push('nonstop');
  if (o.seat && o.seat !== 'any') bits.push(`${o.seat} seat`);
  if (o.sort === 'comfort') bits.push('comfort first');
  if (bits.length === 0) bits.push('cheapest first');
  return bits.join(' · ');
}

const TOOL_META: Record<string, { icon: IconName; title: string; tint: string }> = {
  findFlights: { icon: 'search', title: 'Searched flights', tint: 'text-indigo-600 dark:text-indigo-400' },
  bookFlight: { icon: 'ticket', title: 'Booked the flight', tint: 'text-emerald-600 dark:text-emerald-400' },
  notifyGroup: { icon: 'bell', title: 'Notified the group', tint: 'text-amber-600 dark:text-amber-400' },
};

/** Strip the SDK's <team-directives> wrapper + advisory preamble down to the
 *  learned rule text, so the banner reads like plain English. */
function ruleText(md: string): string {
  let s = md.replace(/<\/?team-directives>/gi, '').replace(/\*\*/g, '');
  const marker = s.match(/\[(?:LESSON|PROCEDURE)\]\s*/i);
  if (marker && marker.index !== undefined) s = s.slice(marker.index + marker[0].length);
  s = s.replace(/^#+\s.*$/gm, '').replace(/\s*\n+\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
  // Keep the human sentence; drop any trailing numbered "1. Call findFlights…" steps.
  return s.split(/\s\d+\.\s/)[0].trim();
}

/** The pre-tool-call hook trace — procedural memory recalled at the moment the
 *  agent is about to act, before it picks the tool's arguments. */
function HookLine({ data }: { data: unknown }) {
  const d = (data ?? {}) as { tool?: string; count?: number; rules?: string[] };
  const tool = d.tool ?? 'tool';
  const count = d.count ?? 0;
  const rules = d.rules ?? [];
  return (
    <div className="w-full max-w-[88%] rounded-lg border border-violet-200 bg-violet-50/60 px-3 py-2 dark:border-violet-900/50 dark:bg-violet-950/20">
      <div className="flex items-center gap-1.5 text-[12px] font-medium">
        <Icon name="spark" className="h-3.5 w-3.5 shrink-0 text-violet-500" />
        {count > 0 ? (
          <span className="text-violet-700 dark:text-violet-300">
            hook fired before <span className="font-mono">{tool}()</span> · {count} directive
            {count > 1 ? 's' : ''}
          </span>
        ) : (
          <span className="text-zinc-400">
            checked the team playbook before <span className="font-mono">{tool}()</span> · no rules yet
          </span>
        )}
      </div>
      {count > 0 && rules.length > 0 && (
        <ul className="mt-1 flex flex-col gap-0.5 pl-5 text-[11px] text-violet-800 dark:text-violet-300">
          {rules.map((r, i) => (
            <li key={i}>• {r}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ToolStepCard({ name, part }: { name: string; part: UIPart }) {
  const meta = TOOL_META[name] ?? { icon: 'search' as IconName, title: name, tint: 'text-zinc-500' };
  const running = part.state === 'input-streaming' || part.state === 'input-available';
  const output =
    part.state === 'output-available' && part.output && typeof part.output === 'object'
      ? (part.output as Record<string, unknown>)
      : undefined;
  const directive = output && typeof output.xtrace_team_directives === 'string' ? (output.xtrace_team_directives as string) : undefined;
  const subtitle = name === 'findFlights' ? describeSearch(part.input) : '';

  return (
    <div className="w-full max-w-[88%] overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center gap-2.5 px-3.5 py-2.5">
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800 ${meta.tint}`}>
          <Icon name={meta.icon} className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[13px] font-medium text-zinc-800 dark:text-zinc-200">
            {meta.title}
            {subtitle && <span className="truncate font-normal text-zinc-400">· {subtitle}</span>}
          </div>
        </div>
        {running ? (
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-indigo-400" />
        ) : (
          <Icon name="check" className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
        )}
      </div>

      {directive && (
        <div className="mx-3.5 mb-2.5 flex items-start gap-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 dark:border-violet-900/50 dark:bg-violet-950/40">
          <Icon name="spark" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-500" />
          <p className="text-[12px] leading-snug text-violet-800 dark:text-violet-300">
            <span className="font-semibold">Used your group&apos;s saved rule:</span> {ruleText(directive)}
          </p>
        </div>
      )}

      {output && (
        <div className="border-t border-zinc-100 px-3.5 py-2.5 dark:border-zinc-800/70">
          <ToolResult name={name} output={output} />
        </div>
      )}
      {part.state === 'output-error' && (
        <div className="px-3.5 py-2.5 text-xs text-red-600">{part.errorText ?? 'Something went wrong'}</div>
      )}
    </div>
  );
}

function ToolResult({ name, output }: { name: string; output: Record<string, unknown> }) {
  if (name === 'findFlights') {
    const flights = (Array.isArray(output.flights) ? output.flights : []) as FlightRow[];
    return (
      <ul className="flex flex-col gap-1 text-xs">
        {flights.slice(0, 4).map((f, i) => (
          <li
            key={f.id}
            className={
              'flex flex-wrap items-center gap-x-2 rounded-md px-1.5 py-1 ' +
              (i === 0 ? 'bg-indigo-50 text-zinc-800 dark:bg-indigo-950/30 dark:text-zinc-200' : 'text-zinc-400 dark:text-zinc-500')
            }
          >
            <span className="font-medium text-zinc-700 dark:text-zinc-300">{f.airline}</span>
            <span>dep {f.depart}</span>
            <span>· {f.redeye ? 'red-eye' : 'daytime'}</span>
            <span>· {f.stops === 0 ? 'nonstop' : `${f.stops} stop`}</span>
            <span>· {f.seat}</span>
            <span className="font-medium text-zinc-600 dark:text-zinc-400">· ${f.price}</span>
            {i === 0 && (
              <span className="ml-auto rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                top match
              </span>
            )}
          </li>
        ))}
      </ul>
    );
  }
  if (name === 'bookFlight') {
    const summary = typeof output.summary === 'string' ? output.summary : null;
    return summary ? (
      <div className="text-xs font-medium text-emerald-700 dark:text-emerald-400">{summary}</div>
    ) : (
      <div className="text-xs text-zinc-500">{String(output.booked ?? 'Booked')}</div>
    );
  }
  if (name === 'notifyGroup') {
    return (
      <div className="text-xs italic text-zinc-500 dark:text-zinc-400">
        “{typeof output.message === 'string' ? output.message : 'The group has been notified.'}”
      </div>
    );
  }
  return <pre className="whitespace-pre-wrap break-words text-[11px] text-zinc-500">{JSON.stringify(output)}</pre>;
}

/* ------------------------------- rules panel ------------------------------ */
function RulesPanel({
  rules,
  preferences,
  loading,
  onRefresh,
}: {
  rules: Rule[];
  preferences: Record<string, Pref[]>;
  loading: boolean;
  onRefresh: () => void;
}) {
  const anyPrefs = PERSONAS.some((p) => (preferences[p.id]?.length ?? 0) > 0);
  const empty = rules.length === 0 && !anyPrefs;
  return (
    <aside className="flex w-96 flex-shrink-0 flex-col overflow-hidden border-l border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="border-b border-zinc-200 p-4 dark:border-zinc-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-300">
              <Icon name="brain" className="h-3.5 w-3.5" />
            </span>
            <h2 className="text-sm font-semibold">What TripMate learned</h2>
          </div>
          <button
            onClick={onRefresh}
            className="text-xs text-zinc-400 transition hover:text-zinc-700 dark:hover:text-zinc-200"
            disabled={loading}
            aria-label="Refresh"
          >
            {loading ? '…' : 'refresh'}
          </button>
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">
          Group rules it picked up from a correction (everyone follows these), plus each traveler’s own preferences.
        </p>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {empty ? (
          <div className="rounded-xl border border-dashed border-zinc-200 px-4 py-8 text-center dark:border-zinc-800">
            <span className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-zinc-100 text-zinc-400 dark:bg-zinc-800">
              <Icon name="spark" className="h-4 w-4" />
            </span>
            <p className="text-xs leading-relaxed text-zinc-500">
              {loading ? 'Loading…' : 'Nothing yet. Book a flight, then correct TripMate once — the rule it learns shows up here for everyone.'}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            <section>
              <SectionHeader>
                <Icon name="spark" className="h-3 w-3 text-violet-500" />
                Group rules
                <span className="font-normal normal-case text-zinc-400">· everyone follows these</span>
              </SectionHeader>
              {rules.length === 0 ? (
                <p className="text-xs text-zinc-400">None yet — correct a booking to create one.</p>
              ) : (
                <ul className="flex flex-col gap-2.5">
                  {rules.map((r) => (
                    <RuleCard key={r.id} rule={r} />
                  ))}
                </ul>
              )}
            </section>
            {PERSONAS.map((p) => (
              <PrefSection key={p.id} persona={p} prefs={preferences[p.id] ?? []} />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
      {children}
    </h3>
  );
}

function PrefSection({ persona, prefs }: { persona: (typeof PERSONAS)[number]; prefs: Pref[] }) {
  return (
    <section>
      <SectionHeader>
        <span className={`flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-semibold text-white ${avatarColor(persona.id)}`}>
          {persona.name[0]}
        </span>
        {persona.name} prefers
      </SectionHeader>
      {prefs.length === 0 ? (
        <p className="pl-0.5 text-xs text-zinc-400">— nothing yet</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {prefs.map((p) => (
            <li
              key={p.id}
              className="flex items-start gap-2 rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-700 ring-1 ring-zinc-100 dark:bg-zinc-800/40 dark:text-zinc-300 dark:ring-zinc-800"
            >
              <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${avatarColor(persona.id)}`} />
              {p.text}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RuleCard({ rule }: { rule: Rule }) {
  const summary = rule.text.split('\n')[0];
  const used = rule.observation_count;
  return (
    <li className="rounded-xl border border-violet-200 bg-violet-50/60 p-3 shadow-sm dark:border-violet-900/50 dark:bg-violet-950/20">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-300">
          <Icon name="spark" className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] leading-snug text-zinc-800 dark:text-zinc-200">{summary}</p>
          <div className="mt-1.5 flex items-center gap-2">
            <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-violet-600 ring-1 ring-violet-200 dark:bg-zinc-900 dark:text-violet-300 dark:ring-violet-900/50">
              learned rule
            </span>
            {typeof used === 'number' && used > 0 && (
              <span className="text-[10px] text-zinc-400">used {used}×</span>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}
