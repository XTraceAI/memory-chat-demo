import { getMemory, toPersona } from '@/lib/memory';
import type { Memory } from '@xtraceai/memory';

export const dynamic = 'force-dynamic';

/**
 * List or search the selected traveler's memories (the "Memories" tab).
 *
 * - `?q=<text>` → vector search scoped to this persona (top-level `user_id` axis).
 * - no `q`      → list this persona's memories, newest first.
 *
 * Rows tagged to a group carry `group_ids`, so the UI can badge "shared".
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q')?.trim();
  const persona = toPersona(searchParams.get('persona'));

  try {
    const client = getMemory().memories;

    if (q) {
      const results = await client.search({ query: q, user_id: persona, limit: 25 });
      return Response.json({
        mode: 'search',
        query: q,
        persona,
        memories: results.data.map(shape),
      });
    }

    const page = await client.listPage({ user_id: persona, limit: 50 });
    const all = [...page.data].sort((a, b) =>
      (b.created_at ?? '').localeCompare(a.created_at ?? ''),
    );
    return Response.json({ mode: 'list', persona, memories: all.map(shape) });
  } catch (err) {
    console.error('[memories] list/search failed:', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

/** Wipe both travelers' memories (personal + their trip-group contributions).
 *  The provider KB (a different pseudo-user) is left intact so re-seeding stays
 *  cheap. */
export async function DELETE() {
  try {
    const client = getMemory().memories;
    let deleted = 0;
    for (const user of ['alice', 'bob']) {
      for await (const m of client.list({ user_id: user, limit: 100 })) {
        await client.delete(m.id).catch(() => {/* tolerate already-deleted */});
        deleted++;
      }
    }
    return Response.json({ deleted });
  } catch (err) {
    console.error('[memories] delete failed:', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

function shape(m: Memory) {
  return {
    id: m.id,
    type: m.type,
    text: m.text,
    score: (m as Memory & { score?: number | null }).score ?? null,
    created_at: m.created_at,
    group_ids: m.group_ids ?? [],
    details: m.details,
  };
}
