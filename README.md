# Memory Chat

A small Next.js demo of the [`@xtraceai/memory`](https://www.npmjs.com/package/@xtraceai/memory) SDK paired with the [Vercel AI SDK](https://sdk.vercel.ai) and GPT-4o-mini.

Tell the assistant something about yourself ("I'm vegetarian", "I live in Tokyo", "my name is Sam"). Reload the page. Ask a follow-up. The assistant still knows.

## The point

Every turn does three things:

1. **Search** memory for facts relevant to the user's new message — scoped to a single demo user.
2. **Call the LLM** with those facts injected into the system prompt.
3. **Ingest** the user + assistant turn back into memory so the next turn can use it.

The sidebar shows what the extraction pipeline has pulled out of the conversation so far.

## Run locally

```bash
cp .env.example .env.local
# Fill in XTRACE_API_KEY, XTRACE_ORG_ID, OPENAI_API_KEY in .env.local

npm install
npm run dev
# → http://localhost:3000
```

## How the pieces fit

| File | Role |
|---|---|
| [`lib/memory.ts`](./lib/memory.ts) | Lazy-initialized `MemoryClient` (env-validated on first use). Used by the sidebar list / reset routes. |
| [`app/api/chat/route.ts`](./app/api/chat/route.ts) | POST handler. Wraps the OpenAI model with `createXtraceMemory(...)` from [`@xtraceai/memory/ai-sdk`](https://www.npmjs.com/package/@xtraceai/memory) — search-before-call and ingest-after-call happen inside the wrapper. The route handler is just `streamText({ model, system, messages })`. |
| [`app/api/memories/route.ts`](./app/api/memories/route.ts) | GET (sidebar list) + DELETE (reset). |
| [`app/page.tsx`](./app/page.tsx) | Chat UI with `useChat`, memory sidebar that refreshes after each turn. |

## How memory is wired

The Vercel AI SDK integration ships with `@xtraceai/memory` at the `/ai-sdk` subpath. One line replaces all the manual search/ingest plumbing:

```ts
import { createXtraceMemory } from '@xtraceai/memory/ai-sdk';

const xtrace = createXtraceMemory({ apiKey, orgId, user_id, conv_id });

const result = streamText({
  model: xtrace(openai('gpt-4o-mini')),   // memory-aware wrapper
  messages,
});
```

Behind the scenes, the wrapper:

1. Before each LLM call: searches memory using the latest user message, prepends results as a system block.
2. After each LLM call: ingests the (user, assistant) turn back via `client.memories.ingest({ ..., wait: true })`. `wait: true` keeps the new memory queryable on the next turn without a polling step.

## Deploy

Pushes to `main` auto-deploy via Vercel. Set the same three env vars in **Project Settings → Environment Variables**:

- `XTRACE_API_KEY`
- `XTRACE_ORG_ID`
- `OPENAI_API_KEY`

Optionally:
- `DEMO_USER_ID` / `DEMO_CONV_ID`

## What this demo deliberately doesn't have

- Multi-user / login flows — one hardcoded `demo-user`
- Chat history persistence across reloads (memory persists; chat thread doesn't — that's actually the demo)
- Multiple conversations / threading
- Tests
- Streaming UI polish beyond the Vercel AI SDK defaults
