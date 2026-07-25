import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  type UIMessage,
} from 'ai';
import { openai } from '@ai-sdk/openai';
import { flightTools } from '@/lib/tools';
import { getMemory, getTripGroupId, CONV_ID, TRIP_NAMESPACE, toPersona } from '@/lib/memory';

export const maxDuration = 60;

const apiKey = process.env.XTRACE_API_KEY ?? '';
const orgId = process.env.XTRACE_ORG_ID ?? '';

const SYSTEM_PROMPT =
  'You are TripMate, a practical assistant that helps a group book flights using tools. ' +
  'FLOW: (1) call findFlights; (2) recommend the single best option in one short sentence ' +
  '(airline, departure time, stops, seat, price) and ask the user to confirm — e.g. “Want me to book it?”; ' +
  '(3) call bookFlight ONLY after the user replies to confirm (“yes”, “book it”, “go ahead”, “sounds good”), ' +
  'then call notifyGroup with a one-line summary. ' +
  'An opening request like “book me a flight” means START THIS FLOW — search and recommend first; it is NOT ' +
  'permission to book. Never call bookFlight in the same turn you first search. ' +
  'Do NOT ask the user about seat/time/budget preferences — just search and recommend. Unless a saved team ' +
  'rule tells you otherwise, optimize for LOWEST PRICE: call findFlights with sort:"price" and NO other ' +
  'filters — do not set nonstop, seat, or maxPrice yourself. Recommend the cheapest option (the first result). ' +
  'Do not apply your own seat/time/comfort judgment.';

/** Text of the latest user turn — the query we recall against. */
function lastUserText(messages: UIMessage[]): string {
  const u = [...messages].reverse().find((m) => m.role === 'user');
  if (!u) return '';
  return textOf(u);
}

/** Flatten a UI message's text parts into a plain string. */
function textOf(m: UIMessage): string {
  return (m.parts ?? [])
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join(' ')
    .trim();
}

function toolCallText(name: string | undefined, input: unknown): string {
  const keys = input && typeof input === 'object' ? Object.keys(input as Record<string, unknown>) : [];
  return `called ${name ?? 'tool'}(${keys.join(', ')})`;
}

/**
 * Flatten a UI message for ingest — text parts PLUS any tool calls. The agentic
 * extractor anchors a directive on the identifiers it sees; the symbol tripwire
 * only fires on exact identifier matches (`findFlights`, arg keys), so prose
 * alone yields a directive that never fires on a real tool call.
 */
function flattenForIngest(m: UIMessage): string {
  const bits: string[] = [];
  for (const part of m.parts ?? []) {
    const p = part as { type: string; text?: string; toolName?: string; input?: unknown };
    if (p.type === 'text') {
      if (p.text) bits.push(p.text);
    } else if (p.type === 'dynamic-tool') {
      bits.push(toolCallText(p.toolName, p.input));
    } else if (p.type.startsWith('tool-')) {
      bits.push(toolCallText(p.type.slice(5), p.input));
    }
  }
  return bits.join(' ').trim();
}

export async function POST(req: Request) {
  if (!apiKey || !orgId) {
    return Response.json(
      { error: 'Missing XTRACE_API_KEY or XTRACE_ORG_ID env vars.' },
      { status: 500 },
    );
  }

  const { messages, persona: rawPersona }: { messages: UIMessage[]; persona?: string } =
    await req.json();
  const persona = toPersona(rawPersona);
  const trip = await getTripGroupId();
  const query = lastUserText(messages);
  const client = getMemory();

  const modelMessages = await convertToModelMessages(messages);

  // PRE-TOOL-CALL recall. Before the model picks its tool arguments, recall the
  // group's saved directives for this turn's tools and inject them into the
  // system prompt, so the agent calls the tool correctly on the FIRST try (no
  // naive → re-run). Read at GROUP scope, NO user_id — scope axes AND together,
  // so a user_id would narrow recall to that traveler's own rules and hide what a
  // teammate taught (verified). Group + namespace is the cross-actor axis. This
  // injects only *procedural* directives — never a semantic preference blend,
  // which would make a cold agent "already know" and kill the wrong→right arc.
  // The trigger runs whether or not anything matches; `hook` carries the count so
  // the UI can show the pre-tool-call hook firing.
  let hook: { tool: string; count: number; rules: string[] } | null = null;
  let teamRules = '';
  if (query) {
    try {
      const trg = await client.memories.trigger({
        entities: ['findFlights', 'bookFlight', 'notifyGroup'],
        task: query,
        group_ids: [trip],
        namespace: TRIP_NAMESPACE,
        mode: 'compose',
      });
      const rows = trg.data ?? [];
      teamRules = typeof trg.context === 'string' ? trg.context : '';
      hook = { tool: 'findFlights', count: rows.length, rules: rows.map((r) => r.text.split('\n')[0].trim()) };
    } catch (e) {
      console.error('[chat] pre-tool recall failed:', e);
    }
  }

  // Only inject the "apply team rules" instruction when rules actually exist —
  // otherwise a cold agent has no reason to filter and just books the cheapest.
  const system = teamRules
    ? `${SYSTEM_PROMPT}\n\nTeam rules for this group — BINDING. Apply these in your findFlights call ` +
      `(they override the lowest-price default; e.g. a "nonstop" rule means set nonstop:true):\n${teamRules}`
    : SYSTEM_PROMPT;

  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      // Surface the pre-tool-call hook as a data part the UI renders as
      // "⚡ hook fired before findFlights(): N directive(s)".
      if (hook) writer.write({ type: 'data-hook', data: hook });

      const result = streamText({
        model: openai('gpt-4o-mini'),
        system,
        tools: flightTools,
        stopWhen: stepCountIs(6), // findFlights → bookFlight → notifyGroup
        messages: modelMessages,
        onFinish: async ({ text, steps }) => {
          if (!query) return;
          // Only learn from a *correction* — a turn that follows a prior answer. The
          // first booking has nothing to correct, so we don't capture a "rule" from it.
          if (!messages.some((m) => m.role === 'assistant')) return;
          // Write path: ingest a short rolling window so the agentic extractor sees
          // the wrong-action → correction contrast. Lead the assistant turn with its
          // tool calls so the captured directive anchors on the tool identifiers
          // (verified: prose-led ingests never match). `agentic: true` is required.
          const window = messages
            .slice(-6)
            .filter((m) => m.role === 'user' || m.role === 'assistant')
            .map((m) => ({ role: m.role as 'user' | 'assistant', content: flattenForIngest(m) }))
            .filter((m) => m.content);

          const toolLine = steps
            .flatMap((s) => s.toolCalls.map((tc) => `called ${tc.toolName}(${Object.keys(tc.input ?? {}).join(', ')})`))
            .join('; ');
          const assistantContent = [toolLine && `[tools: ${toolLine}]`, text?.slice(0, 240)]
            .filter(Boolean)
            .join(' ')
            .trim();
          if (assistantContent) window.push({ role: 'assistant', content: assistantContent });
          if (window.length === 0) return;

          await client.memories
            .ingest(
              {
                messages: window,
                user_id: persona,
                conv_id: CONV_ID,
                group_ids: [trip],
                namespace: TRIP_NAMESPACE,
                agentic: true,
              },
              // Don't block the turn on extraction; the panel polls for the new rule.
              { wait: false },
            )
            .catch((e) => console.error('[chat] agentic ingest failed:', e));
        },
      });

      writer.merge(result.toUIMessageStream());
    },
    onError: (e) => {
      console.error('[chat] stream error:', e);
      return 'Sorry — something went wrong.';
    },
  });

  return createUIMessageStreamResponse({ stream });
}
