import { MemoryClient } from '@xtraceai/memory';

let _memory: MemoryClient | null = null;

/** Lazily-instantiated memory client. Validates env vars on first call, not at
 *  import time (so `next build` doesn't need a real key).
 *
 *  Base URL: the SDK defaults to production. Set `XTRACE_BASE_URL` to point at
 *  staging (or any deployment) without hardcoding a URL in source.
 */
export function getMemory(): MemoryClient {
  if (_memory) return _memory;

  const apiKey = process.env.XTRACE_API_KEY;
  const orgId = process.env.XTRACE_ORG_ID;
  if (!apiKey) throw new Error('Missing XTRACE_API_KEY env var. Set it in .env.local.');
  if (!orgId) throw new Error('Missing XTRACE_ORG_ID env var. Set it in .env.local.');

  _memory = new MemoryClient({
    apiKey,
    orgId,
    baseUrl: process.env.XTRACE_BASE_URL, // undefined → SDK default (prod)
  });
  return _memory;
}

/**
 * Demo scenario — "TripMate", a collaborative trip-planning assistant.
 *
 * Three layers of memory, unioned by `recall()` into one prompt:
 *   - personal   → `user_id`   each traveler's own preferences (private to them)
 *   - shared trip → `group_ids` facts the whole party shares (cross-user)
 *   - provider KB → `app_id`   a travel guide the product seeds; everyone reads,
 *                              no chat writes to it
 */
// Persona constants live in a client-safe module (no SDK import) so the UI can
// import them without bundling the memory client. Re-exported for the routes.
export {
  PERSONAS,
  DEFAULT_PERSONA,
  toPersona,
  personaName,
  type PersonaId,
} from './personas';

/** One shared conversation thread for the trip. */
export const CONV_ID = process.env.DEMO_CONV_ID ?? 'tokyo-trip-2026';

/**
 * Namespace the trip's learned *directives* (lessons / procedures) live under.
 * This is the axis that transfers a learned rule from one traveler to another:
 * `agentic: true` ingest captures directives here, and `withDirectiveRecall` /
 * `trigger` read them back by the same namespace — so a rule Alice teaches is
 * live for Bob without re-teaching. (Directives ignore `group_ids`; the shared
 * namespace is what makes them cross-actor.)
 */
export const TRIP_NAMESPACE = process.env.DEMO_TRIP_NAMESPACE ?? 'trip:tokyo-2026-may';

/** The shared trip group — created on demand, found by name. */
export const TRIP_GROUP_NAME = 'Tokyo Trip — May 2026';
export const TRIP_GROUP_PROMPT =
  'Group-level decisions for the shared Tokyo trip in May 2026 that apply to the whole ' +
  'party’s itinerary: dates, flight routing (nonstop vs stops), airports, hotels, budget ' +
  'per person, reservations, and group plans. NOT individual seat choices — a seat is ' +
  'personal to each traveler.';

/** The product provider's travel knowledge base — read by everyone, written by no chat. */
export const PRODUCT_APP_ID = 'tripmate-guide';
/** Pseudo-user the KB is ingested under (KB is read by app_id, not by user). */
export const KB_SEED_USER = 'tripmate-system';

let _tripGroupId: string | null = null;

/** Find-or-create the trip group; cached for the life of the process. */
export async function getTripGroupId(): Promise<string> {
  if (_tripGroupId) return _tripGroupId;
  const groups = await getMemory().groups.list();
  const existing = groups.find((g) => g.name === TRIP_GROUP_NAME && g.status !== 'archived');
  _tripGroupId = existing
    ? existing.id
    : (await getMemory().groups.create({ name: TRIP_GROUP_NAME, prompt: TRIP_GROUP_PROMPT })).id;
  return _tripGroupId;
}
