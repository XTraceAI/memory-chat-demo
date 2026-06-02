import {
  getMemory,
  getTripGroupId,
  CONV_ID,
  PRODUCT_APP_ID,
  KB_SEED_USER,
} from '@/lib/memory';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Seed the demo with a relatable, three-layer memory set:
 *   - Alice & Bob personal preferences  (user_id, no group)
 *   - shared Tokyo-trip facts            (group_ids — split across authors so
 *                                         recall attribution is visible)
 *   - a provider travel KB               (app_id, pseudo-user)
 *
 * Idempotent: personal/trip seed only if Alice has no memories yet; the KB only
 * if it's empty — so re-seeding after a Reset doesn't duplicate the guide.
 */

type Turn = { user: string; assistant: string };
type Scope = { user_id: string; conv_id: string; app_id?: string; group_ids?: string[] };

const ALICE_PERSONAL: Turn[] = [
  { user: "I'm vegetarian, so I need places with good veggie options.", assistant: 'Noted — vegetarian.' },
  { user: 'I much prefer small boutique hotels over big chains.', assistant: 'Boutique hotels, got it.' },
  { user: 'Please, no early-morning flights — I hate flying before 10am.', assistant: 'No early flights.' },
];

const BOB_PERSONAL: Turn[] = [
  { user: "I'm a huge ramen and street-food fan.", assistant: 'Noted — ramen lover.' },
  { user: "I'm budget-conscious; I'd rather save on hotels and splurge on food.", assistant: 'Budget-minded, got it.' },
  { user: 'I really want to spend an afternoon in Akihabara for electronics.', assistant: 'Akihabara, noted.' },
];

const TRIP_BY_ALICE: Turn[] = [
  {
    user: "For our Tokyo trip we're going May 10–17, 2026, and I'd love to do one nice group sushi dinner.",
    assistant: 'Trip dates and a group sushi dinner — noted for the trip.',
  },
];

const TRIP_BY_BOB: Turn[] = [
  {
    user: "For the Tokyo trip we're staying near Shibuya station and flying into Narita. Let's keep hotels around $200 a night.",
    assistant: 'Shibuya base, Narita arrival, ~$200/night — noted for the trip.',
  },
];

// The provider KB must hold SPECIFIC, proprietary facts — partner rates,
// concierge picks, member perks. The extractor stores novel info like this but
// discards generic world knowledge ("tipping isn't customary in Japan"), so
// plain travel tips would extract to nothing. These also tie into the personas:
// Afuri ↔ Bob's ramen, Ain Soph ↔ Alice's vegetarianism, Granbell ↔ Shibuya.
const KB: Turn[] = [
  { user: 'TripMate partners with the Granbell Hotel near Shibuya station — members pay $180 a night, a 10% member discount.', assistant: 'Saved the Granbell partner rate.' },
  { user: "TripMate's concierge top pick for ramen near Shibuya is Afuri, known for its yuzu-shio broth.", assistant: 'Saved the Afuri pick.' },
  { user: "TripMate's vegetarian-friendly dinner pick in Shibuya is Ain Soph Journey, a popular plant-based restaurant.", assistant: 'Saved the vegetarian pick.' },
  { user: 'TripMate includes a free Narita Express voucher for members arriving at Narita Airport.', assistant: 'Saved the Narita Express perk.' },
];

function ingest(t: Turn, scope: Scope) {
  return getMemory().memories.ingest(
    {
      messages: [
        { role: 'user', content: t.user },
        { role: 'assistant', content: t.assistant },
      ],
      ...scope,
    },
    { wait: true },
  );
}

export async function POST() {
  try {
    const trip = await getTripGroupId();
    const mem = getMemory().memories;
    const [alice, kb] = await Promise.all([
      mem.listPage({ user_id: 'alice', limit: 1 }),
      mem.listPage({ app_id: PRODUCT_APP_ID, limit: 1 }),
    ]);

    const jobs: Promise<unknown>[] = [];
    const seededPersonal = alice.data.length === 0;
    const seededKb = kb.data.length === 0;

    if (seededPersonal) {
      jobs.push(
        ...ALICE_PERSONAL.map((t) => ingest(t, { user_id: 'alice', conv_id: CONV_ID })),
        ...BOB_PERSONAL.map((t) => ingest(t, { user_id: 'bob', conv_id: CONV_ID })),
        ...TRIP_BY_ALICE.map((t) => ingest(t, { user_id: 'alice', conv_id: CONV_ID, group_ids: [trip] })),
        ...TRIP_BY_BOB.map((t) => ingest(t, { user_id: 'bob', conv_id: CONV_ID, group_ids: [trip] })),
      );
    }
    if (seededKb) {
      jobs.push(
        ...KB.map((t) => ingest(t, { user_id: KB_SEED_USER, conv_id: 'kb-seed', app_id: PRODUCT_APP_ID })),
      );
    }

    await Promise.all(jobs);
    return Response.json({
      tripGroupId: trip,
      ingested: jobs.length,
      seededPersonal,
      seededKb,
    });
  } catch (err) {
    console.error('[seed] failed:', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
