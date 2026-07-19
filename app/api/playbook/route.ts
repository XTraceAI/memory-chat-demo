import { getMemory, getTripGroupId, TRIP_NAMESPACE } from '@/lib/memory';
import { PERSONAS } from '@/lib/personas';
import type { Memory } from '@xtraceai/memory';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** A clean personal *preference* fact — not a booking status, group rule, or
 *  episode. Heuristic, but keeps the "prefers" list free of noise. */
function isPreference(m: Memory): boolean {
  if (m.type !== 'fact') return false;
  const t = m.text.toLowerCase();
  // A fact under this user_id is theirs even if the classifier also group-tagged
  // it; distinguish a personal preference from a group rule by wording, not scope.
  if (t.includes('group')) return false; // a group rule, not a personal pref
  if (/\bbook(ed|ing|s)?\b/.test(t)) return false; // booking status / procedure
  if (/\bconfirm/.test(t)) return false;
  // No trailing \b so conjugations match too (prefer→prefers, want→wants, love→loves).
  return /\b(prefer|love|like|enjoy|want|hate|avoid|always|never)/.test(t);
}

/** Trim the "User prefers …" framing so it reads as a bullet under a name. */
function cleanPref(text: string): string {
  return text
    .replace(/^the user('s)?\s+/i, '')
    .replace(/^user('s)?\s+/i, '')
    .replace(/^(strongly\s+)?(prefers?|wants?|likes?|loves?|enjoys?)\s+/i, '')
    .replace(/\.$/, '')
    .trim();
}

/**
 * The two memory layers the panel shows:
 *   - `rules`       → group directives (procedural, shared by everyone), via the
 *                     tool-call tripwire at group scope.
 *   - `preferences` → each traveler's own preference facts (personal, per user).
 */
export async function GET() {
  try {
    const trip = await getTripGroupId();
    const client = getMemory().memories;

    const rulesRes = await client.trigger({
      entities: ['findFlights', 'bookFlight', 'notifyGroup'],
      group_ids: [trip],
      namespace: TRIP_NAMESPACE,
      mode: 'retrieve',
    });
    const rules = (rulesRes.data ?? []).map((d) => {
      const det = (d.details ?? {}) as { observation_count?: number | null };
      return { id: d.id, text: d.text, observation_count: det.observation_count ?? null };
    });

    const preferences: Record<string, { id: string; text: string }[]> = {};
    for (const p of PERSONAS) {
      const page = await client.listPage({ user_id: p.id, limit: 50 });
      preferences[p.id] = page.data
        .filter(isPreference)
        .slice(0, 5)
        .map((m) => ({ id: m.id, text: cleanPref(m.text) }));
    }

    return Response.json({ rules, preferences });
  } catch (err) {
    console.error('[playbook] failed:', err);
    return Response.json({ rules: [], preferences: {}, error: String(err) });
  }
}
