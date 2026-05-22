import { convertToModelMessages, streamText, type UIMessage } from 'ai';
import { openai } from '@ai-sdk/openai';
import { createXtraceMemory } from '@xtraceai/memory/ai-sdk';
import { DEMO_USER_ID, DEMO_CONV_ID } from '@/lib/memory';

export const maxDuration = 60;

const apiKey = process.env.XTRACE_API_KEY ?? '';
const orgId = process.env.XTRACE_ORG_ID ?? '';
const baseUrl = process.env.XTRACE_BASE_URL;   // undefined → SDK default (prod)

// The wrapper handles search-before-call and ingest-after-call for us.
// No manual memory plumbing in the route handler.
const xtrace = createXtraceMemory({
  apiKey,
  orgId,
  ...(baseUrl ? { baseUrl } : {}),
  user_id: DEMO_USER_ID,
  conv_id: DEMO_CONV_ID,
});

const SYSTEM_PROMPT =
  "You are a helpful, friendly assistant. When you have prior context about " +
  "the user, weave it in naturally — don't constantly remind them you " +
  '"remembered something" or say "based on what I know about you". Just ' +
  'incorporate the context the way a thoughtful friend would. If there is ' +
  'no prior context, respond normally.';

export async function POST(req: Request) {
  if (!apiKey || !orgId) {
    return Response.json(
      { error: 'Missing XTRACE_API_KEY or XTRACE_ORG_ID env vars.' },
      { status: 500 },
    );
  }

  const { messages }: { messages: UIMessage[] } = await req.json();

  const result = streamText({
    model: xtrace(openai('gpt-4o-mini')),
    system: SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
  });

  return result.toUIMessageStreamResponse();
}
