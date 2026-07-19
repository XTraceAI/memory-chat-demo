import { tool } from 'ai';
import { z } from 'zod';

/**
 * Mock flight tools for the procedural-memory demo. Server-only (imports `ai`) —
 * never import from a client component.
 *
 * The catalog is rigged so the cheapest *daytime* option (what a price-optimizing
 * agent books by default) has a MIDDLE seat and a stop. The group's real
 * preference — aisle seat, nonstop, comfort over price — is something the model
 * won't volunteer on its own (it leaves `seat`/`nonstop` unset), so the agent
 * gets it "wrong" until the group teaches it. That correction becomes a
 * directive; `withDirectiveRecall` then injects it so the agent books JL-005.
 */
export type Flight = {
  id: string;
  airline: string;
  depart: string;
  durationH: number;
  stops: number;
  redeye: boolean;
  seat: 'aisle' | 'window' | 'middle';
  price: number;
};

const CATALOG: Flight[] = [
  { id: 'DL-277', airline: 'Delta',  depart: '23:55', durationH: 14.0, stops: 1, redeye: true,  seat: 'aisle',  price: 372 },
  { id: 'UA-881', airline: 'United', depart: '11:20', durationH: 13.0, stops: 1, redeye: false, seat: 'middle', price: 455 },
  { id: 'JL-005', airline: 'JAL',    depart: '09:40', durationH: 12.5, stops: 0, redeye: false, seat: 'aisle',  price: 505 },
  { id: 'NH-812', airline: 'ANA',    depart: '13:15', durationH: 12.0, stops: 0, redeye: false, seat: 'window', price: 530 },
];

/** Higher is better: daytime, nonstop, aisle, shorter. */
function comfortScore(f: Flight): number {
  let s = 0;
  if (!f.redeye) s += 3;
  if (f.stops === 0) s += 2;
  if (f.seat === 'aisle') s += 1;
  return s - f.durationH / 10;
}

export const flightTools = {
  findFlights: tool({
    description:
      'Search available flights to Tokyo for the group trip and return ranked options. ' +
      'Call this before booking.',
    inputSchema: z.object({
      sort: z.enum(['price', 'comfort', 'duration']).default('price').describe('Ranking priority'),
      redeye: z.boolean().optional().describe('Set to false to exclude overnight red-eye flights'),
      nonstop: z.boolean().optional().describe('Set to true to require nonstop flights'),
      seat: z.enum(['aisle', 'window', 'any']).default('any').describe('Preferred seat type'),
      maxPrice: z.number().optional().describe('Only flights at or under this USD price'),
    }),
    execute: async ({ sort, redeye, nonstop, seat, maxPrice }) => {
      let flights = CATALOG.slice();
      if (redeye === false) flights = flights.filter((f) => !f.redeye);
      if (nonstop === true) flights = flights.filter((f) => f.stops === 0);
      if (seat && seat !== 'any') flights = flights.filter((f) => f.seat === seat);
      if (typeof maxPrice === 'number') flights = flights.filter((f) => f.price <= maxPrice);
      const cmp: Record<string, (a: Flight, b: Flight) => number> = {
        price: (a, b) => a.price - b.price,
        duration: (a, b) => a.durationH - b.durationH,
        comfort: (a, b) => comfortScore(b) - comfortScore(a),
      };
      flights.sort(cmp[sort] ?? cmp.price);
      return { criteria: { sort, redeye: redeye ?? null, nonstop: nonstop ?? null, seat }, flights };
    },
  }),

  bookFlight: tool({
    description: 'Book one flight by its id. Returns a confirmation.',
    inputSchema: z.object({
      flightId: z.string().describe('The flight id to book, e.g. "JL-005"'),
    }),
    execute: async ({ flightId }) => {
      const f = CATALOG.find((x) => x.id === flightId);
      if (!f) return `No flight found with id ${flightId}.`; // string → reactive recall can fire
      return {
        booked: true,
        confirmation: `TM-${f.id}-${f.depart.replace(':', '')}`,
        flight: f,
        summary: `${f.airline} ${f.id} · dep ${f.depart} · ${f.redeye ? 'red-eye' : 'daytime'} · ${f.stops === 0 ? 'nonstop' : `${f.stops} stop`} · ${f.seat} seat · $${f.price}`,
      };
    },
  }),

  notifyGroup: tool({
    description: 'Notify the trip group with a short message once a booking is made.',
    inputSchema: z.object({
      message: z.string().describe('The message to send to the group'),
    }),
    execute: async ({ message }) => ({ notified: true, message }),
  }),
};
