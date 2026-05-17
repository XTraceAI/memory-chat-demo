import { MemoryClient } from '@xtraceai/memory';

let _memory: MemoryClient | null = null;

/** Lazily-instantiated memory client. Validates env vars on first call, not at import time
 *  (so `next build` doesn't need a real key). */
export function getMemory(): MemoryClient {
  if (_memory) return _memory;

  const apiKey = process.env.XTRACE_API_KEY;
  const orgId = process.env.XTRACE_ORG_ID;
  if (!apiKey) throw new Error('Missing XTRACE_API_KEY env var. Set it in .env.local.');
  if (!orgId) throw new Error('Missing XTRACE_ORG_ID env var. Set it in .env.local.');

  _memory = new MemoryClient({
    apiKey,
    orgId,
    baseUrl: process.env.XTRACE_BASE_URL ?? 'https://api.staging.xtrace.ai',
  });
  return _memory;
}

/** Hardcoded demo identity. One user, one conversation. */
export const DEMO_USER_ID = process.env.DEMO_USER_ID ?? 'demo-user';
export const DEMO_CONV_ID = process.env.DEMO_CONV_ID ?? 'demo-conv';
