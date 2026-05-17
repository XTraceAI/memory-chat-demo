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
| [`lib/memory.ts`](./lib/memory.ts) | Lazy-initialized `MemoryClient` (env-validated on first use). |
| [`app/api/chat/route.ts`](./app/api/chat/route.ts) | POST handler: searches memory, calls `streamText`, ingests the turn in `onFinish` with `wait: true`. |
| [`app/api/memories/route.ts`](./app/api/memories/route.ts) | GET (sidebar list) + DELETE (reset). |
| [`app/page.tsx`](./app/page.tsx) | Chat UI with `useChat`, memory sidebar that refreshes after each turn. |

## Why `wait: true` on ingest

The Memory API is async by default — `POST /v1/memories` returns a job in `pending` / `running`, and extraction takes a few seconds in the background. For a demo, that's the wrong shape: the user finishes a turn, the next message they send should be able to retrieve what was just ingested.

Passing `wait: true` makes the server hold the connection (up to 30s) and only return once the job is terminal. The cost is that the response stream stays open slightly longer at the end of each turn; the benefit is that the sidebar refresh on `onFinish` actually sees the new memories.

## Deploy

Pushes to `main` auto-deploy via Vercel. Set the same three env vars in **Project Settings → Environment Variables**:

- `XTRACE_API_KEY`
- `XTRACE_ORG_ID`
- `OPENAI_API_KEY`

Optionally:
- `XTRACE_BASE_URL` (defaults to `https://api.staging.xtrace.ai`)
- `DEMO_USER_ID` / `DEMO_CONV_ID`

## What this demo deliberately doesn't have

- Multi-user / login flows — one hardcoded `demo-user`
- Chat history persistence across reloads (memory persists; chat thread doesn't — that's actually the demo)
- Multiple conversations / threading
- Tests
- Streaming UI polish beyond the Vercel AI SDK defaults
