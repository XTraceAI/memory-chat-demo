import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from 'ai';
import { openai } from '@ai-sdk/openai';
import { withDirectiveRecall } from '@xtraceai/memory/ai-sdk';
import type { DirectiveMemory } from '@xtraceai/memory';
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
  "rule tells you otherwise, optimize for LOWEST PRICE: call findFlights with sort:'price' and no other " +
  'filters, and recommend the cheapest option (the first result). Do not apply your own seat/time/comfort judgment. ' +
  'IMPORTANT: a findFlights result may include an `xtrace_team_directives` field — these are rules THIS group ' +
  'has already taught you (seat, timing, budget, and similar preferences). Treat them as binding: if a rule ' +
  'conflicts with the criteria you just used, re-run findFlights with the corrected criteria BEFORE recommending.';

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

  // NOTE: this demo intentionally does NOT inject a recall() preference blend
  // into the system prompt. The whole point is the *procedural* path — the agent
  // starts cold, books the cheapest option, gets corrected once, and every
  // traveler's agent then follows the learned directive via the tool-call
  // tripwire. Injecting recalled preferences here would make the agent "already
  // know" and hide the wrong→corrected→transferred arc.

  // Procedural: wrap the tools so every call recalls the group's learned
  // directives and injects them into the tool result. Read at GROUP scope with
  // NO user_id — scope axes AND together, so passing user_id would narrow recall
  // to just that traveler's own directives and hide what a teammate taught
  // (verified). Group + namespace is the cross-actor sharing axis. `onDirectives`
  // records what fired so we can surface it (Playbook / banner).
  const fired: { tool: string; directives: DirectiveMemory[] }[] = [];
  const tools = withDirectiveRecall(
    flightTools,
    client,
    { group_ids: [trip], namespace: TRIP_NAMESPACE, task: query },
    { onDirectives: (directives, toolName) => fired.push({ tool: toolName, directives }) },
  );

  const result = streamText({
    model: openai('gpt-4o-mini'),
    system: SYSTEM_PROMPT,
    tools,
    stopWhen: stepCountIs(6), // allow findFlights → (re-run) → bookFlight → notifyGroup
    messages: await convertToModelMessages(messages),
    onFinish: async ({ text, steps }) => {
      if (!query) return;
      // Only learn from a *correction* — a turn that follows a prior answer. The
      // first booking has nothing to correct, so we don't capture a "rule" from
      // it (otherwise the panel fills with meaningless how-to-book procedures).
      if (!messages.some((m) => m.role === 'assistant')) return;
      // Write path: ingest a short rolling window so the agentic extractor sees
      // the wrong-action → correction contrast and captures a directive under the
      // shared namespace. `agentic: true` is REQUIRED for directive capture.
      const window = messages
        .slice(-6)
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: flattenForIngest(m) }))
        .filter((m) => m.content);

      // Lead the current assistant turn with its tool calls so the captured
      // directive anchors on the tool identifiers (findFlights, arg keys), then a
      // short slice of prose. Leading with identifiers is what makes the directive
      // fire on future calls (verified: prose-led ingests never match).
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
          // Don't block the turn on extraction (it can take many seconds and would
          // keep the UI "busy"). Fire it and return; the extractor runs server-side
          // regardless, and the panel polls for the new rule (see onFinish poll).
          { wait: false },
        )
        .catch((e) => console.error('[chat] agentic ingest failed:', e));

      if (fired.length) {
        console.log(
          '[chat] directives fired:',
          fired.map((f) => `${f.tool}×${f.directives.length}`).join(', '),
        );
      }
    },
  });

  return result.toUIMessageStreamResponse();
}
