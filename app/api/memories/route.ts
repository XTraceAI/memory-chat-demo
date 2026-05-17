import { getMemory, DEMO_USER_ID } from '@/lib/memory';

export const dynamic = 'force-dynamic';

/** List memories for the demo user, newest first. */
export async function GET() {
  try {
    const env = await getMemory().memories.listPage({
      user_id: DEMO_USER_ID,
      limit: 50,
    });
    return Response.json({
      memories: env.data.map((m) => ({
        id: m.id,
        type: m.type,
        text: m.text,
        created_at: m.created_at,
        details: m.details,
      })),
      has_more: env.has_more,
    });
  } catch (err) {
    console.error('[memories] list failed:', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

/** Wipe all memories for the demo user — soft delete via the API. */
export async function DELETE() {
  try {
    let count = 0;
    for await (const m of getMemory().memories.list({ user_id: DEMO_USER_ID, limit: 100 })) {
      await getMemory().memories.delete(m.id).catch(() => {/* tolerate already-deleted */});
      count++;
    }
    return Response.json({ deleted: count });
  } catch (err) {
    console.error('[memories] delete failed:', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
