import { getMemory, DEMO_USER_ID, DEMO_CONV_ID } from '@/lib/memory';
import type { Memory } from '@xtraceai/memory';

export const dynamic = 'force-dynamic';

/**
 * List memories visible for the demo session.
 *
 * Two passes: facts are user-scoped (user_id), episodes are conv-scoped
 * (conv_id) — listing by user_id alone misses the episodes, so we run
 * both and dedupe by id.
 */
export async function GET() {
  try {
    const client = getMemory().memories;
    const [byUser, byConv] = await Promise.all([
      client.listPage({ user_id: DEMO_USER_ID, limit: 50 }),
      client.listPage({ conv_id: DEMO_CONV_ID, limit: 50 }),
    ]);

    const merged = new Map<string, Memory>();
    for (const m of [...byUser.data, ...byConv.data]) merged.set(m.id, m);
    const all = Array.from(merged.values()).sort((a, b) =>
      (b.created_at ?? '').localeCompare(a.created_at ?? ''),
    );

    return Response.json({
      memories: all.map((m) => ({
        id: m.id,
        type: m.type,
        text: m.text,
        created_at: m.created_at,
        details: m.details,
      })),
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
