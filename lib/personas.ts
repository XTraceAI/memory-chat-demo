/**
 * Persona constants — deliberately SDK-free so client components can import them
 * without bundling the memory client. Shared by the UI and the API routes.
 */
export type PersonaId = 'alice' | 'bob';

export const PERSONAS: { id: PersonaId; name: string; blurb: string }[] = [
  { id: 'alice', name: 'Alice', blurb: 'vegetarian · boutique hotels · hates early flights' },
  { id: 'bob', name: 'Bob', blurb: 'ramen fiend · budget-minded · night owl' },
];

export const DEFAULT_PERSONA: PersonaId = 'alice';

/** Normalize an untrusted persona value (e.g. from a request body). */
export function toPersona(v: unknown): PersonaId {
  return v === 'bob' ? 'bob' : 'alice';
}

export function personaName(id: string): string {
  return PERSONAS.find((p) => p.id === id)?.name ?? id;
}
