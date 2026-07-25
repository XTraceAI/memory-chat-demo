import { getMemory, getTripGroupId, toPersona, CONV_ID, PRODUCT_APP_ID, TRIP_NAMESPACE } from '@/lib/memory';
import type { Memory } from '@xtraceai/memory';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // reset deletes item-by-item; don't let Vercel kill it early

type Scope = 'personal' | 'trip' | 'guide';
function toScope(v: string | null): Scope {
  return v === 'trip' || v === 'guide' ? v : 'personal';
}

const newestFirst = (rows: Memory[]) =>
  [...rows].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));

/**
 * Browse or search memories by SCOPE — backs the sidebar's Personal / Trip / Guide
 * tabs, mirroring the three pools recall() unions:
 *   - personal → the selected traveler           (user_id)
 *   - trip     → the shared group, BOTH travelers (group_ids)
 *   - guide    → the provider knowledge base      (app_id)
 *
 * `?q` switches a scope from list (browse) to vector search on the same axis —
 * so the Trip tab's search box is a real cross-user group search.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q')?.trim();
  const persona = toPersona(searchParams.get('persona'));
  const scope = toScope(searchParams.get('scope'));

  try {
    const client = getMemory().memories;
    let rows: Memory[];

    if (scope === 'guide') {
      rows = q
        ? (await client.search({ query: q, app_id: PRODUCT_APP_ID, limit: 25 })).data
        : newestFirst((await client.listPage({ app_id: PRODUCT_APP_ID, limit: 100 })).data);
    } else if (scope === 'trip') {
      const trip = await getTripGroupId();
      if (q) {
        // The canonical cross-user group read: omit user_id, pass group_ids.
        rows = (await client.search({ query: q, group_ids: [trip], limit: 25 })).data;
      } else {
        // `list` can't filter by group_ids, so browse the trip conversation and
        // keep only the group-tagged rows — the shared subset across both travelers.
        const page = await client.listPage({ conv_id: CONV_ID, limit: 100 });
        rows = newestFirst(page.data.filter((m) => (m.group_ids?.length ?? 0) > 0));
      }
    } else {
      rows = q
        ? (await client.search({ query: q, user_id: persona, limit: 25 })).data
        : newestFirst((await client.listPage({ user_id: persona, limit: 50 })).data);
    }

    return Response.json({
      scope,
      persona,
      mode: q ? 'search' : 'list',
      memories: rows.map(shape),
    });
  } catch (err) {
    console.error('[memories] list/search failed:', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

/** Wipe both travelers' memories (personal facts + their trip-group facts) AND
 *  the group's learned directives, so a demo restart is truly cold. The provider
 *  KB (a different pseudo-user) is left intact so re-seeding stays cheap. */
export async function DELETE() {
  try {
    const client = getMemory().memories;
    let deleted = 0;

    // Collect ids first, THEN delete — deleting while paginating can shift the
    // cursor and skip rows. `list` auto-paginates, so this covers all of them.
    for (const user of ['alice', 'bob']) {
      const ids: string[] = [];
      for await (const m of client.list({ user_id: user, limit: 100 })) ids.push(m.id);
      for (const id of ids) {
        await client.delete(id).catch(() => {/* tolerate already-deleted */});
        deleted++;
      }
    }

    // Directives are a separate corpus (not in list/search) — enumerate them via
    // the tripwire on the demo's tool identifiers, then delete each so the next
    // "cold" run is genuinely cold. A single trigger can cap its results, so loop
    // until the tripwire comes back empty.
    try {
      const trip = await getTripGroupId();
      for (let pass = 0; pass < 12; pass++) {
        const res = await client.trigger({
          entities: ['findFlights', 'bookFlight', 'notifyGroup'],
          group_ids: [trip],
          namespace: TRIP_NAMESPACE,
          mode: 'retrieve',
        });
        const rows = res.data ?? [];
        if (rows.length === 0) break;
        for (const d of rows) {
          await client.delete(d.id).catch(() => {/* tolerate */});
          deleted++;
        }
      }
    } catch (e) {
      console.error('[memories] directive clear failed:', e);
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
    user_id: m.user_id,
    group_ids: m.group_ids ?? [],
    app_id: m.app_id ?? null,
    details: m.details,
  };
}
