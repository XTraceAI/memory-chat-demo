import { getMemory, DEMO_USER_ID, DEMO_CONV_ID } from '@/lib/memory';
import type { Memory } from '@xtraceai/memory';

export const dynamic = 'force-dynamic';

/**
 * List or search memories for the demo session.
 *
 * - `?q=<text>` → vector + filter search (user-scoped), ranked by similarity.
 * - no `q`     → list mode. Two passes (user-scoped + conv-scoped) deduped
 *                by id, because episodes are conv-scoped and would be
 *                missed by a user_id-only listing.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q')?.trim();

  try {
    const client = getMemory().memories;

    if (q) {
      const results = await client.search({
        query: q,
        filters: { user_id: DEMO_USER_ID },
        limit: 25,
      });
      return Response.json({
        memories: results.data.map((m) => ({
          id: m.id,
          type: m.type,
          text: m.text,
          score: (m as Memory & { score?: number | null }).score ?? null,
          created_at: m.created_at,
          details: m.details,
        })),
        mode: 'search',
        query: q,
      });
    }

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
      mode: 'list',
    });
  } catch (err) {
    console.error('[memories] list/search failed:', err);
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
