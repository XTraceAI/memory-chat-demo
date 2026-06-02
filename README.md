# Memory Chat — shared trip demo (TripMate)

A small Next.js demo of the [`@xtraceai/memory`](https://www.npmjs.com/package/@xtraceai/memory) SDK paired with the [Vercel AI SDK](https://sdk.vercel.ai) and GPT-4o-mini.

**TripMate** is a collaborative trip-planning assistant. Two travelers — **Alice** and **Bob** — are planning one **Tokyo trip**. The assistant answers each of them using three layers of memory at once, blended into a single prompt by one `recall()` call:

| Layer | Scope axis | Example |
|---|---|---|
| **Personal** | `user_id` | Alice is vegetarian and likes boutique hotels; Bob is a budget-minded ramen fan |
| **Shared trip** | `group_ids` | "May 10–17", "staying near Shibuya", "one group sushi dinner" — visible to everyone on the trip |
| **Travel guide** | `app_id` | "buy the JR Pass before arrival", "tipping isn't customary", "Afuri = yuzu ramen" — seeded by the product, read by all |

Switch traveler in the header and watch the **personal** slice change while the **trip** and **guide** stay shared. The **Context** tab shows the exact assembled prompt, sectioned by source, with author attribution (`you:` / `alice:` / `bob:`).

## The point

`recall()` is the combined read that plain `search()` can't express, because search AND-narrows every axis you pass. Each turn:

1. **Recall** unions three independent scope pools — *personal* OR *trip* OR *guide* — dedupes, score-ranks, and renders **one** source-sectioned context block.
2. **Call the LLM** with that block injected into the system prompt.
3. **Ingest** the turn back under the traveler's `user_id` *and* offer it to the trip group — the ingest classifier tags only the trip-relevant facts. The guide (`app_id`) is never written from chat.

```ts
// app/api/chat/route.ts — one recall unions three scopes
const { prompt } = await client.memories.recall({
  query,
  pools: [
    { user_id: persona },           // this traveler's own prefs
    { group_ids: [tripGroupId] },   // the trip's shared facts (cross-user)
    { app_id: 'tripmate-guide' },   // the provider travel knowledge base
  ],
});
// axes AND within a pool; the three pools OR. The guide rows render under their
// own section, not framed as the user's memory.
```

## Run locally

```bash
cp .env.example .env.local
# Fill in XTRACE_API_KEY, XTRACE_ORG_ID, OPENAI_API_KEY (XTRACE_BASE_URL optional)

npm install
npm run dev
# → http://localhost:3000
```

Then click **Seed demo** once to register the trip group and load Alice/Bob/trip/guide memories, and start asking questions like *"where should we grab dinner near the hotel the first night?"*

## How the pieces fit

| File | Role |
|---|---|
| [`lib/personas.ts`](./lib/personas.ts) | Persona constants (Alice/Bob) — SDK-free so the client bundle stays light. |
| [`lib/memory.ts`](./lib/memory.ts) | Lazy `MemoryClient`; trip-group + product-KB constants; `getTripGroupId()` find-or-create helper. |
| [`app/api/seed/route.ts`](./app/api/seed/route.ts) | One-shot seed: registers the trip group and ingests personal / trip / guide memories. Idempotent. |
| [`app/api/chat/route.ts`](./app/api/chat/route.ts) | POST chat. `recall()` (3 pools) → inject → `streamText` → `onFinish` ingest (user + group). |
| [`app/api/recall/route.ts`](./app/api/recall/route.ts) | Returns the assembled `recall()` prompt + per-scope counts for the **Context** panel. |
| [`app/api/memories/route.ts`](./app/api/memories/route.ts) | GET list/search scoped to the selected traveler; DELETE wipes both travelers (guide stays). |
| [`app/page.tsx`](./app/page.tsx) | Chat UI, persona switcher, and the tabbed sidebar (**Context** / **Memories**). |

## How memory is wired

The `recall()` call above is the whole story: one request, three scopes, one prompt. Group resolution (`grp_…` → name) and source-sectioning happen inside the SDK. Tagging is best-effort at ingest — the classifier decides which extracted facts belong to the trip group based on the group's prompt.

> The `@xtraceai/memory/ai-sdk` subpath also ships `createXtraceMemory` (a "memory just works" model wrapper) and `memoryTools` (tool-calling). This demo calls `recall()` directly so the three-scope assembly is visible — but `memoryTools` accepts `group_ids` if you'd rather let the LLM drive.

## Deploy

Pushes to `main` auto-deploy via Vercel. Set the env vars in **Project Settings → Environment Variables**:

- `XTRACE_API_KEY`
- `XTRACE_ORG_ID`
- `OPENAI_API_KEY`
- *(optional)* `XTRACE_BASE_URL`, `DEMO_CONV_ID`

## What this demo deliberately doesn't have

- Auth / login — the two travelers are hardcoded personas, not real accounts. **Knowing a group id is the access boundary**; a real app maps its own users to `user_id`s and decides which `group_ids` to send.
- Per-traveler chat history across reloads (memory persists; the chat thread doesn't — that's the point).
- Tests, and streaming-UI polish beyond the Vercel AI SDK defaults.
