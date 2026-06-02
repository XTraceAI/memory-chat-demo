import { convertToModelMessages, streamText, type UIMessage } from 'ai';
import { openai } from '@ai-sdk/openai';
import {
  getMemory,
  getTripGroupId,
  CONV_ID,
  PRODUCT_APP_ID,
  toPersona,
} from '@/lib/memory';

export const maxDuration = 60;

const apiKey = process.env.XTRACE_API_KEY ?? '';
const orgId = process.env.XTRACE_ORG_ID ?? '';

const SYSTEM_PROMPT =
  'You are TripMate, a warm and practical travel-planning assistant helping a ' +
  'group plan a trip together. Use what you know about this traveler, their ' +
  'shared trip, and general travel tips to give specific, useful answers — weave ' +
  "it in naturally; don't announce that you \"remembered\" something. If the " +
  'context below does not cover something, just answer normally. The context is ' +
  'grouped by source: the traveler’s own preferences, the trip’s shared ' +
  'facts, and a travel knowledge base.';

/** Text of the latest user turn — the query we recall against. */
function lastUserText(messages: UIMessage[]): string {
  const u = [...messages].reverse().find((m) => m.role === 'user');
  if (!u) return '';
  return (u.parts ?? [])
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join(' ')
    .trim();
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

  // The whole point of the demo: ONE recall unions the traveler's personal
  // memory, the trip's shared memory, and the provider knowledge base into a
  // single, source-sectioned prompt. AND within a pool; the three pools OR.
  let memoryContext = '';
  if (query) {
    const recall = await getMemory().memories.recall({
      query,
      pools: [{ user_id: persona }, { group_ids: [trip] }, { app_id: PRODUCT_APP_ID }],
      limit: 12,
    });
    memoryContext = recall.prompt;
  }

  const result = streamText({
    model: openai('gpt-4o-mini'),
    system: memoryContext ? `${SYSTEM_PROMPT}\n\n${memoryContext}` : SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
    onFinish: async ({ text }) => {
      // Ingest the turn into the traveler's personal scope AND offer it to the
      // trip group — the classifier tags only the trip-relevant facts. The KB
      // (app_id) is never written from chat.
      if (!query || !text) return;
      await getMemory()
        .memories.ingest(
          {
            messages: [
              { role: 'user', content: query },
              { role: 'assistant', content: text },
            ],
            user_id: persona,
            conv_id: CONV_ID,
            group_ids: [trip],
          },
          // Hold for extraction so the just-added memory is queryable when the
          // client refreshes the sidebar on stream close (matches the seed route).
          { wait: true },
        )
        .catch((e) => console.error('[chat] ingest failed:', e));
    },
  });

  return result.toUIMessageStreamResponse();
}
