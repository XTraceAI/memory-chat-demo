import { convertToModelMessages, streamText, type UIMessage } from 'ai';
import { openai } from '@ai-sdk/openai';
import { getMemory, DEMO_USER_ID, DEMO_CONV_ID } from '@/lib/memory';

export const maxDuration = 60;

/** Extract concatenated text from a UIMessage's parts. */
function textOf(msg: UIMessage): string {
  return msg.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('');
}

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
  const lastUserText = lastUserMsg ? textOf(lastUserMsg).trim() : '';

  // 1. Pull relevant memories for the user, scoped to their query
  let contextBlock = '';
  if (lastUserText) {
    try {
      const search = await getMemory().memories.search({
        query: lastUserText,
        filters: { user_id: DEMO_USER_ID },
        limit: 8,
      });
      if (search.data.length > 0) {
        contextBlock =
          '\n\nWhat you already know about this user from prior conversations:\n' +
          search.data.map((m) => `- ${m.text}`).join('\n');
      }
    } catch (err) {
      console.error('[chat] memory.search failed:', err);
    }
  }

  const system = `You are a helpful, friendly assistant. Use the user's prior context to personalize your answers naturally — don't constantly remind them you "remembered something" or say things like "based on what I know about you". Just incorporate the context the way a thoughtful friend would. If there's no prior context, respond normally.${contextBlock}`;

  const result = streamText({
    model: openai('gpt-4o-mini'),
    system,
    messages: await convertToModelMessages(messages),
    onFinish: async ({ text }) => {
      // 2. Ingest the user + assistant turn back into memory.
      //    `wait: true` makes the new memories queryable on the next turn
      //    without an explicit polling step.
      if (!lastUserText || !text.trim()) return;
      try {
        const job = await getMemory().memories.ingest(
          {
            messages: [
              { role: 'user', content: lastUserText },
              { role: 'assistant', content: text },
            ],
            user_id: DEMO_USER_ID,
            conv_id: DEMO_CONV_ID,
          },
          { wait: true },
        );
        console.log(`[chat] ingest ${job.status}; created=${job.result?.memories_created?.length ?? 0}`);
      } catch (err) {
        console.error('[chat] memory.ingest failed:', err);
      }
    },
  });

  return result.toUIMessageStreamResponse();
}
