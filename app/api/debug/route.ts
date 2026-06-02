import { getMemory, CONV_ID } from '@/lib/memory';

export const dynamic = 'force-dynamic';

// Dedicated debug identity so pipeline pings don't pollute the Alice/Bob demo.
const DEBUG_USER = 'debug-user';

/**
 * Visit /api/debug to verify the memory pipeline in isolation from the chat flow.
 * Returns env presence, a hardcoded ingest result, and a memory list.
 */
export async function GET() {
  const out: Record<string, unknown> = {
    env: {
      XTRACE_API_KEY: process.env.XTRACE_API_KEY ? `set (len=${process.env.XTRACE_API_KEY.length})` : 'MISSING',
      XTRACE_ORG_ID: process.env.XTRACE_ORG_ID ? `set (len=${process.env.XTRACE_ORG_ID.length})` : 'MISSING',
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ? `set (len=${process.env.OPENAI_API_KEY.length})` : 'MISSING',
      DEBUG_USER,
      CONV_ID,
    },
  };

  try {
    const memory = getMemory();

    // Step 1: list current memories
    const before = await memory.memories.listPage({ user_id: DEBUG_USER, limit: 5 });
    out.list_before = {
      count: before.data.length,
      sample: before.data.slice(0, 3).map((m) => ({ id: m.id, type: m.type, text: m.text })),
    };

    // Step 2: hardcoded ingest with wait=true
    const t0 = Date.now();
    const job = await memory.memories.ingest(
      {
        messages: [
          { role: 'user', content: `Debug ping at ${new Date().toISOString()}. My name is DebugUser and I love testing.` },
          { role: 'assistant', content: 'Noted — DebugUser, loves testing.' },
        ],
        user_id: DEBUG_USER,
        conv_id: CONV_ID,
      },
      { wait: true },
    );
    const ingestMs = Date.now() - t0;
    out.ingest = {
      took_ms: ingestMs,
      job_id: job.id,
      status: job.status,
      memories_created: job.result?.memories_created?.length ?? 0,
      memories_created_sample: job.result?.memories_created?.slice(0, 3) ?? [],
      error: job.error,
    };

    // Step 3: list after
    const after = await memory.memories.listPage({ user_id: DEBUG_USER, limit: 5 });
    out.list_after = {
      count: after.data.length,
      sample: after.data.slice(0, 3).map((m) => ({ id: m.id, type: m.type, text: m.text })),
    };
  } catch (err) {
    out.error = {
      name: err instanceof Error ? err.constructor.name : 'unknown',
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack?.split('\n').slice(0, 5).join('\n') : undefined,
    };
  }

  return Response.json(out, { status: 200 });
}
