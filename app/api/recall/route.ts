import { getMemory, getTripGroupId, PRODUCT_APP_ID, toPersona } from '@/lib/memory';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * Preview the exact context `recall()` assembles for a query + persona — the
 * same three-pool union the chat route injects. Powers the "Context" panel so
 * the Personal / Trip / Guide sections (and author attribution) are visible.
 */
export async function POST(req: Request) {
  try {
    const { query, persona: rawPersona }: { query?: string; persona?: string } =
      await req.json();
    const q = query?.trim();
    if (!q) return Response.json({ prompt: '', scopes: [], memories: [] });

    const persona = toPersona(rawPersona);
    const trip = await getTripGroupId();

    const r = await getMemory().memories.recall({
      query: q,
      pools: [{ user_id: persona }, { group_ids: [trip] }, { app_id: PRODUCT_APP_ID }],
      limit: 12,
    });

    return Response.json({
      prompt: r.prompt,
      scopes: r.scopes,
      memories: r.memories.map((m) => ({
        id: m.id,
        text: m.text,
        type: m.type,
        score: m.score ?? null,
        user_id: m.user_id,
        group_ids: m.group_ids ?? [],
        app_id: m.app_id ?? null,
      })),
    });
  } catch (err) {
    console.error('[recall] failed:', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
