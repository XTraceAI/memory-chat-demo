# TripMate — procedural memory demo

A small Next.js demo of the [`@xtraceai/memory`](https://www.npmjs.com/package/@xtraceai/memory) SDK's **procedural memory** (`withDirectiveRecall` / `trigger`), paired with the [Vercel AI SDK](https://sdk.vercel.ai) and GPT-4o-mini.

**TripMate** is a group flight-booking assistant that books flights with **tools**. The point isn't preferences — it's that an agent **learns your team's tool-use rules from a single correction**, and every other member's agent then follows them, with no re-teaching.

## The 60-second story

1. **Alice:** *"Book me a flight to Tokyo."* — the agent is cold, so it does the naive thing: `findFlights({ sort: "price" })` and books the cheapest option (a middle seat, one stop).
2. **Alice corrects it:** *"For our group, always book an aisle seat and a nonstop flight, comfort over price."*
3. **Switch to Bob** (a different traveler, fresh thread, never taught) and ask *"Book my flight too."* — before `findFlights` runs, the learned **directive** is recalled and injected. Bob's agent **re-runs** `findFlights({ nonstop: true, seat: "aisle" })` and books the right flight. You watch it self-correct on screen.

The learned rule shows up in the **Playbook** tab as a versioned `procedure`, with the tool identifiers it fires on and how many times it's been confirmed.

## Why this is procedural, not preference

`recall()` (semantic memory) would put "Alice likes aisle seats" into the prompt as a *fact*. Procedural memory is different: it records **what a past session actually did** — the tool calls, the correction, the fix — and fires a **symbol tripwire** on the *next* tool call, exact-matching identifiers (`findFlights`, `seat`, `nonstop`) rather than doing a fuzzy query. It's advisory context delivered at the moment a tool runs, and it's shared across agents by scope.

```ts
// app/api/chat/route.ts — wrap the tools; recall + inject directives per call
import { withDirectiveRecall } from '@xtraceai/memory/ai-sdk';

const tools = withDirectiveRecall(
  { findFlights, bookFlight, notifyGroup },
  client,
  { group_ids: [tripGroupId], namespace: TRIP_NAMESPACE, task: query }, // NOTE: no user_id
);
streamText({ model, system, tools, stopWhen: stepCountIs(6), messages });
```

Two things make the transfer work:

- **Read at group scope, no `user_id`.** Scope axes AND together — passing `user_id` narrows recall to *that* traveler's own directives and hides what a teammate taught. Group + namespace is the shared axis.
- **Write with `agentic: true`.** On each turn the route ingests the turn (led by its tool calls) so the extractor captures the wrong→correction contrast as a directive:

```ts
await client.memories.ingest(
  { messages: window, user_id: persona, conv_id, group_ids: [trip], namespace: TRIP_NAMESPACE, agentic: true },
  { wait: true },
);
```

## Run locally

```bash
cp .env.example .env.local
# Fill in XTRACE_API_KEY, XTRACE_ORG_ID, OPENAI_API_KEY (XTRACE_BASE_URL optional → defaults to prod)

npm install
npm run dev
# → http://localhost:3000
```

Then run the numbered prompts in order, switching traveler between 2 and 3. Hit **Reset** to wipe both travelers' memories *and* the learned playbook for a clean cold start.

> Requires `@xtraceai/memory` **≥ 0.5.0** (the `trigger` / `withDirectiveRecall` surface).

## How the pieces fit

| File | Role |
|---|---|
| [`lib/tools.ts`](./lib/tools.ts) | The mock flight tools (`findFlights` / `bookFlight` / `notifyGroup`). The catalog is rigged so the cheapest daytime option is a middle seat, one stop — the "wrong" default until the group teaches otherwise. |
| [`lib/memory.ts`](./lib/memory.ts) | Lazy `MemoryClient`; the trip group + `TRIP_NAMESPACE` (the shared axis directives transfer across). |
| [`app/api/chat/route.ts`](./app/api/chat/route.ts) | `withDirectiveRecall`-wrapped tools → `streamText` (multi-step) → `agentic` ingest on finish (the write path). |
| [`app/api/playbook/route.ts`](./app/api/playbook/route.ts) | `trigger()` at group scope → the learned `lesson` / `procedure` directives for the **Playbook** tab. |
| [`app/api/memories/route.ts`](./app/api/memories/route.ts) | Browse/search the captured facts (sidebar); DELETE wipes both travelers' facts **and** their directives. |
| [`app/page.tsx`](./app/page.tsx) | Chat with per-turn **tool-call cards** (args, results, the "team directive applied" banner) + the **Playbook** sidebar. |

## What this demo deliberately doesn't have

- Auth / login — the two travelers are hardcoded personas. Knowing a group id is the access boundary; a real app maps its own users to `user_id`s and decides which `group_ids` / `namespace` to send.
- A `recall()` preference blend in the chat prompt — deliberately omitted so the *procedural* path is the sole, visible driver (see the note in `app/api/chat/route.ts`). The Personal / Trip / Guide sidebar tabs still browse captured facts if you want to see them.
- Tests, and streaming-UI polish beyond the Vercel AI SDK defaults.
