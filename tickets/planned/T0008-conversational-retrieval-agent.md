# T0008 — Conversational retrieval agent on the Vercel AI SDK

- **Track**: Chat agent and retrieval application
- **Wave**: 2 (integration — builds on the weighted retrieval API)
- **Status**: planned
- **Depends on**: T0009
- **Blocks**: T0010
- **References**:
  - `tickets/planned/T0009-weighted-retrieval-api.md` — the weighted query and
    the HTTP surface that this ticket builds on. T0009 must be in `review/` or
    `done/` before this ticket starts.
  - `src/lib/retrieval.ts` — `WeightedRetriever`, `retrieveWeighted`.
  - `src/lib/retrieval-contract.ts` — `WeightedQuery`, `WeightedHit`,
    `WeightedResultPage`.
  - `src/server/chat.ts` — the current single-tool chat handler that this ticket replaces.
  - `src/server/chat.test.ts` — the current chat tests.
  - `src/lib/result-pages.ts` — the cursor and snapshot store behind `retrieveWeighted`.
  - `src/components/app/ChatPanel.tsx` — the current hand-rolled chat surface.
  - `DESIGN.md` and `src/components/AGENTS.md` — the UI rules.
  - `.agents/skills/ai-sdk/SKILL.md` — the installed tool skill for the AI SDK.
    Load it before you write AI SDK code.
  - `node_modules/ai/docs/**` — the version-matched documentation that `ai@7.0.124`
    ships inside the package. This is the primary source for this ticket. It is
    the only `node_modules/` path the project allows; `node_modules/ai/src/**` is
    off limits.
  - Vercel AI SDK, `ai@7.0.124` and `@ai-sdk/react@4.0.127`:
    - <https://ai-sdk.dev/docs/getting-started/coding-agents>
    - <https://ai-sdk.dev/docs/reference/ai-sdk-core/tool-loop-agent>
    - <https://ai-sdk.dev/docs/reference/ai-sdk-core/create-agent-ui-stream-response>
    - <https://ai-sdk.dev/docs/reference/ai-sdk-core/tool>
    - <https://ai-sdk.dev/docs/reference/ai-sdk-core/json-schema>
    - <https://ai-sdk.dev/docs/agents/loop-control>
    - <https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling>
    - <https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol>
    - <https://ai-sdk.dev/docs/ai-sdk-ui/streaming-data>
    - <https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat>
    - <https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-tool-usage>

## Context & Goal

Today `POST /api/chat` is a thin wrapper. It defines one tool, `searchSlogans`,
that runs a single legacy hybrid query with `topK`. The system prompt tells the
model to call the tool once and to answer in plain text. The handler streams
plain text back with `toTextStreamResponse()`, and the browser appends that text
to a bubble.

That shape cannot do four things the product needs:

1. **It cannot show its sources.** The answer is text. The records behind it
   never reach the user interface as data.
2. **It cannot page.** The legacy retriever returns one `topK`-bounded list.
   There is no way to ask for the next records.
3. **It cannot search again.** A single tool call is the whole strategy. When the
   first results are weak, the model has no instruction and no budget to refine.
4. **It cannot say "I found nothing".** The prompt has no rule for an empty or
   off-topic result, so the model tends to answer from its own knowledge.

This ticket turns the endpoint into a **conversational retrieval agent**. The
agent has a precise role, a defined workflow, two query tools, a bounded number
of steps, and a defined answer format. It streams its answer and the structured
list of records it consulted to the user interface, which renders both.

"Done" means: a French question produces a French answer whose every claim cites
a record that a tool returned, the interface shows the sources under the answer,
and a question with no matching record produces a plain statement instead of an
invented slogan.

The retrieval backend is the weighted API that `T0009` delivers. The agent's
tools call `retrieveWeighted`, so the model can search, page with a real cursor,
and see the per-index scores behind each record. The legacy `retrieveHybrid`
path is obsolete and this ticket does not use it.

## Confirmed Intent

- Build on the **weighted** `retrieveWeighted` contract from `T0009`. This ticket
  depends on `T0009`.
- Deliver the **backend agent and the chat user interface**.
- Give the agent **two tools**: one search tool and one pagination tool.
- The answer format is **cited prose plus a structured source list**.
- The agent may **search again** when the first results are weak, inside a
  **bounded step budget**.
- Transport the answer and the sources with the AI SDK **UI message stream**.
- Add `@ai-sdk/react` and use `useChat` in the browser.

## Scope Boundary

Create or modify **only** these paths.

### May create

- `src/server/agent/` (new directory)
  - `sources.ts`, `sources.test.ts` — the `AgentSource` type and the pure source
    collection helper.
  - `session-store.ts`, `session-store.test.ts` — the per-conversation search
    snapshot store.
  - `tools.ts`, `tools.test.ts` — `searchRecords` and `fetchNextPage`.
  - `prompt.ts`, `prompt.test.ts` — the system prompt builder.
  - `agent.ts`, `agent.test.ts` — the `ToolLoopAgent` factory and its exported
    UI message type.
- `src/components/app/SourcesPanel.tsx` and `SourcesPanel.css` — the source list.
- `src/components/app/ToolActivity.tsx` and `ToolActivity.css` — optional, a
  one-line notice when the agent runs another search.

### May modify

- `src/server/chat.ts` and `src/server/chat.test.ts`.
- `src/server/index.ts` — wire the tools and the session store.
- `src/components/app/ChatPanel.tsx` — move to `useChat`.
- `src/components/app/MessageBubble.tsx` — only if part-based rendering needs it.
- `src/components/README.md` — document the new components.
- `package.json` and `bun.lock` — add `@ai-sdk/react@4.0.127`.
- `.env.sample` — document `AGENT_MAX_STEPS` when it is added.
- `README.md` — describe the agent behavior.

### Must not touch

- `src/lib/retrieval.ts`, `src/lib/slogan-retrieval.ts`,
  `src/lib/retrieval-contract.ts`, `src/lib/qdrant.ts`, `src/lib/scoring.ts`,
  `src/lib/result-pages.ts`, `src/config/datasets.ts`.
- `design-tokens.css`, `color-variants.css`, `DESIGN.md`. This ticket adds **no
  new design token** and no ad-hoc style.
- `src/components/base/**`, `src/components/layout/**`, `src/components/ui/**`.
  The new components compose these primitives; they never change them.
- `.agents/skills/**` and `skills-lock.json`. The CTO installs and updates the
  tool skills.
- `node_modules/**`, except the documented `node_modules/ai/docs/**` tree. Never
  read `node_modules/ai/src/**` or the source of any other dependency.
- The root `AGENTS.md`. The CTO updates it for the tool-skill registry.

### Append-only shared files

None. This ticket owns `src/server/chat.ts` alone.

## Contract

Every unit and integration test is written against this section.

### 1. The retrieval backend is the weighted API

The agent calls `retrieveWeighted` from `src/lib/retrieval.ts`. Source:
`src/lib/retrieval.ts` and `src/lib/retrieval-contract.ts`.

```ts
/** Fractional contribution weights, one entry per selected index. */
export type IndexWeights = Partial<Record<"syntax" | "semantic" | "keyword", number>>;

/** One query for weighted threshold retrieval. */
export type WeightedQuery = {
  text: string;
  weights: IndexWeights;
  minScore: number;
  pageSize?: number;
  cursor?: string;
  /** Generic Qdrant payload filter. The agent does not set it in this ticket. */
  filters?: PayloadFilter;
  generation?: string;
};

/** One scored record in a weighted result page. */
export type WeightedHit = {
  id: number | string;
  score: number;
  scores: Partial<Record<"syntax" | "semantic" | "keyword", number>>;
  payload: Record<string, unknown>;
};

/** One page of weighted results. */
export type WeightedResultPage = {
  results: WeightedHit[];
  nextCursor?: string;
  metadata: WeightedResultMetadata;
};

/** Weighted retriever bound to one embedder and one Qdrant collection. */
export type WeightedRetriever = {
  retrieveWeighted: (query: WeightedQuery) => Promise<WeightedResultPage>;
};
```

`retrieveWeighted` returns one page of an exhaustive, threshold-qualified
ranking and an opaque `nextCursor`. The cursor binds to the query text, the
weights, the minimum score, the filters, and the index generation
(`src/lib/result-pages.ts`). A caller that reads the next page must therefore
re-supply the same binding. The agent's session store remembers that binding
(section 5).

`WeightedHit.payload` holds the stored record fields. The agent maps them to a
typed source with the slogan field names, exactly as the API handler does.

### 2. The agent source

```ts
/** One record that the agent consulted and may cite. */
export type AgentSource = {
  /** Record identifier. */
  id: number | string;
  /** Publication year. */
  annee: number;
  /** Brand or issuing organization. */
  marque: string;
  /** Campaign name. */
  campagne: string;
  /** Slogan text. */
  slogan: string;
  /** Combined weighted score, as returned by `retrieveWeighted`. */
  score: number;
};
```

`AgentSource` is the shape that the tools return to the model **and** the shape
that the user interface renders. One shape, two consumers. The agent builds it
from one `WeightedHit`: `id` and `score` come from the hit, and `annee`,
`marque`, `campagne`, and `slogan` come from `payload` through the slogan field
names.

### 3. Tool `searchRecords`

```ts
/** Input of the `searchRecords` tool. */
export type SearchRecordsInput = {
  /** Search text. Required and non-empty after trim. */
  query: string;
  /** Records returned in this first page. Default 5, clamped to [1, 20]. */
  pageSize?: number;
};

/** Output of the `searchRecords` tool. */
export type SearchRecordsOutput =
  | {
      /** First page of the ranked result list. */
      results: AgentSource[];
      /** True when the ranked list holds records beyond this page. */
      hasMore: boolean;
      /** Opaque continuation cursor. Present exactly when `hasMore` is true. */
      nextCursor?: string;
    }
  | {
      /** Human-readable reason, so the model can recover and search again. */
      error: string;
    };
```

Rules:

- The tool calls
  `retrieveWeighted({ text: query, weights, minScore, pageSize })`, with the
  agent's fixed `weights` and `minScore` (section 7). It sets no filter in this
  ticket.
- It maps each `WeightedHit` to an `AgentSource` through the slogan field names.
- It stores the query binding (everything except the cursor) in the session store
  for the conversation, keyed by the session identifier (section 7), and returns
  the store's opaque token as `nextCursor`.
- `pageSize` defaults to 5 and is clamped to `[1, 20]`.
- `hasMore` is true exactly when the retrieval page carries a `nextCursor`.
- A blank `query` returns `{ results: [], hasMore: false }` and does not call the
  retriever. The tool never throws for a blank query.
- A retrieval failure (an unavailable index, a parser that cannot load) returns
  `{ error }`. The tool never throws, so the model can recover or report the
  failure.
- The tool never writes to the collection.

### 4. Tool `fetchNextPage`

```ts
/** Input of the `fetchNextPage` tool. */
export type FetchNextPageInput = {
  /** Cursor returned by `searchRecords` or by a previous `fetchNextPage`. */
  cursor: string;
};

/** Output of the `fetchNextPage` tool. */
export type FetchNextPageOutput =
  | {
      /** Next page of the cached ranked list. */
      results: AgentSource[];
      /** True when more records remain. */
      hasMore: boolean;
      /** Opaque continuation cursor. Present exactly when `hasMore` is true. */
      nextCursor?: string;
    }
  | {
      /** Human-readable reason, so the model can recover and search again. */
      error: string;
    };
```

Rules:

- The tool looks the cursor up in the session store for the conversation. The
  entry holds the query binding and the retrieval cursor.
- It calls
  `retrieveWeighted({ ...binding, cursor: retrievalCursor, pageSize })`, where
  `pageSize` is the one the originating `searchRecords` call used.
- It maps each `WeightedHit` to an `AgentSource` and updates the stored retrieval
  cursor with the page's `nextCursor`.
- A cursor that is unknown, expired, malformed, or from another session returns
  `{ error: "..." }`. The tool **never throws** for a bad cursor, so the model
  can call `searchRecords` again.
- A retrieval failure from the cursor call (an expired snapshot, a changed
  generation) returns `{ error: "..." }` and never throws.
- The last page has no `nextCursor` and `hasMore: false`.

### 5. Search session store

```ts
/** One cached search that a conversation can continue. */
export type CachedSearch = {
  /** The weighted query without its cursor. Re-supplied on every page. */
  binding: Omit<WeightedQuery, "cursor" | "pageSize">;
  /** Delivery size chosen by the originating search. */
  pageSize: number;
  /** The retrieval cursor for the next page, or `undefined` when exhausted. */
  cursor?: string;
};

/** In-memory store of the searches that a conversation can continue. */
export type SearchSessionStore = {
  /** Cache one search for a session and return its opaque token. */
  save: (sessionId: string, search: CachedSearch) => string;
  /** Read one cached search. Returns `undefined` for an unknown, foreign, or expired token. */
  read: (sessionId: string, token: string) => CachedSearch | undefined;
  /** Replace the cached retrieval cursor after a page is read. */
  update: (sessionId: string, token: string, cursor: string | undefined) => void;
};
```

Invariants, each with a test:

- A token from another session returns `undefined`.
- An unknown, expired, or malformed token returns `undefined`.
- The token is opaque. It is a base64url string, not a readable offset.
- The store is bounded by a maximum entry count and a time-to-live. The bound
  never changes which records a valid token returns.
- Dependencies are injected: a clock and a token generator, as in
  `src/lib/result-pages.ts`. The tests are hermetic and use a fake clock.

### 6. System prompt

`buildSystemPrompt()` returns a string. It is built from a structured object so
the tests can assert each rule without matching prose:

```ts
/** The rules that the system prompt must carry. */
export type AgentPrompt = {
  /** One paragraph: the role of the agent. */
  role: string;
  /** Ordered steps: the workflow. */
  workflow: string[];
  /** Rules for the two query tools. */
  toolRules: string[];
  /** Rules for the answer text. */
  answerFormat: string[];
  /** The step budget rule. */
  budget: string;
};
```

The prompt must carry every rule below. A test asserts that the rendered string
contains each entry of every array, and that `role` and `budget` are non-empty.

Role:

- The agent answers questions about a collection of French advertising slogans.
- It answers in French.
- It answers **only** from records that a tool returned. It never answers from its
  own knowledge.

Workflow:

1. Call `searchRecords` before every answer.
2. Build the query from the content words of the question. Do not put the whole
   question or its instructions in the query text.
3. Read the results and decide:
   - a record answers the question: write the answer;
   - the results are off-topic, too narrow, or too broad: call `searchRecords`
     again with a better query;
   - the question asks for more records than the first page: call
     `fetchNextPage`.
4. Stop when the answer is grounded, or after at least two different queries
   returned no relevant record.

Tool rules:

- `query` is search text, not the whole question. Strip instructions such as
  "trouve-moi" or "quels sont".
- Do not set `pageSize` above 10 unless the question asks for a long list.
- Never invent a `cursor`. Use only a cursor that a tool returned.
- Never call a tool that is not in the tool list.

Answer format:

- Plain French prose. No Markdown, no tables, no bold.
- Cite each claim with the brand and the year in parentheses, for example
  `(Danone, 1991)`.
- Cite only records that a tool returned.
- When no record answers the question, say so plainly and name the queries that
  failed.
- End with one short sentence that gives the number of records consulted.

Budget:

- The agent has at most `AGENT_MAX_STEPS` steps. It uses them to search and then
  to answer. It must answer before the budget ends.

### 7. The `POST /api/chat` handler

```ts
/** Dependencies of the chat endpoint. Tests inject fakes. */
export type ChatDependencies = {
  /** Weighted retriever behind the two tools. */
  retriever: Pick<WeightedRetriever, "retrieveWeighted">;
  /** Search session store. */
  sessions: SearchSessionStore;
  /** Payload field names that map one hit to a typed source. */
  fields: SloganFields;
  /** Index weights the agent applies to every search. */
  weights: IndexWeights;
  /** Minimum combined score the agent applies to every search. */
  minScore: number;
  /** Chat provider configuration. */
  env: ChatEnv;
  /** Identity that the OpenAI-compatible gateway expects. */
  identity: ChatIdentity;
  /** Build the language model. Tests inject a fake. */
  createModel: (env: ChatEnv, identity: ChatIdentity) => LanguageModel;
  /** Maximum number of generation steps. Defaults to 6. */
  maxSteps?: number;
};
```

The default weights are `{ syntax: 0.5, semantic: 0.3, keyword: 0.2 }` and the
default minimum score is `0.5`. They are dependencies so a test overrides them
and so T0010 can tune them against the evaluation. `SloganFields` is the field
configuration type from `src/server/api.ts`.

Request:

- `POST` with a JSON body `{ id?: string; messages: UIMessage[] }`.
- `id` is the conversation identifier. When it is absent or not a non-empty
  string, the handler uses `"anonymous"`.
- `OPTIONS` returns `204` with the CORS headers.
- A method other than `POST` returns `405`.
- A missing `AI_API_KEY` returns `500` with a clear message, before any model
  call.
- A missing or empty `messages` array returns `400`.

Behavior:

- The tools are created once per request, bound to the retriever, the session
  store, and the session identifier from the body.
- A `ToolLoopAgent` is built once per request:
  - `model` from `createModel(env, identity)`;
  - `instructions: buildSystemPrompt()`;
  - `tools`;
  - `stopWhen: stepCountIs(maxSteps)`;
  - `onError` that logs the stream error and never logs a secret.
- The handler returns the **UI message stream**:
  `createAgentUIStreamResponse({ agent, uiMessages: body.messages, abortSignal: request.signal })`.
- The handler does not call `convertToModelMessages` itself. The agent and
  `createAgentUIStreamResponse` validate the UI messages and convert them to
  model messages.
- The existing request body shape and the error status codes do not change, so a
  current client keeps working for the text.

### 8. Documented AI SDK surface

These are the only AI SDK calls the ticket uses. Each row quotes the documented
signature and its source. The bundled documentation is the primary source; it
matches the installed `ai@7.0.124`.

| Call                          | Documented signature                                                                                                                                                                                                                                                                                                                                            | Source                                                                                                                                                                             |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `new ToolLoopAgent({...})`    | `new ToolLoopAgent({ model, instructions, tools, stopWhen, onError })`. `model: LanguageModel` (required); `instructions: Instructions` (optional); `tools: Record<string, Tool>` (optional); `stopWhen: StopCondition \| StopCondition[]` (optional, default `isStepCount(20)`). The class "accepts all the same settings as `generateText` and `streamText`". | bundled `node_modules/ai/docs/07-reference/01-ai-sdk-core/16-tool-loop-agent.mdx`; <https://ai-sdk.dev/docs/reference/ai-sdk-core/tool-loop-agent>                                 |
| `createAgentUIStreamResponse` | `createAgentUIStreamResponse({ agent, uiMessages, abortSignal, ...UIMessageStreamOptions }) => Promise<Response>`. `agent: Agent` (required; must implement `.stream()` and define `tools`); `uiMessages: unknown[]` (required).                                                                                                                                | bundled `node_modules/ai/docs/07-reference/01-ai-sdk-core/18-create-agent-ui-stream-response.mdx`; <https://ai-sdk.dev/docs/reference/ai-sdk-core/create-agent-ui-stream-response> |
| `InferAgentUIMessage`         | `InferAgentUIMessage<typeof agent>` infers the UI message type of an agent instance.                                                                                                                                                                                                                                                                            | bundled `node_modules/ai/docs/07-reference/01-ai-sdk-core/16-tool-loop-agent.mdx`, section `Types`                                                                                 |
| `tool`                        | `tool({ description, inputSchema, execute })`. `execute: (input, { toolCallId, messages, abortSignal }) => RESULT`.                                                                                                                                                                                                                                             | bundled `node_modules/ai/docs/07-reference/01-ai-sdk-core/20-tool.mdx`; <https://ai-sdk.dev/docs/reference/ai-sdk-core/tool>                                                       |
| `jsonSchema`                  | `jsonSchema<T>(schema)` builds the `inputSchema` from a JSON Schema object.                                                                                                                                                                                                                                                                                     | bundled `node_modules/ai/docs/07-reference/01-ai-sdk-core/25-json-schema.mdx`; <https://ai-sdk.dev/docs/reference/ai-sdk-core/json-schema>                                         |
| `onError`                     | `onError: (event: { error: unknown }) => void`. Called when an error occurs during streaming.                                                                                                                                                                                                                                                                   | bundled `node_modules/ai/docs/07-reference/01-ai-sdk-core/02-stream-text.mdx`, section `onError`                                                                                   |
| `stepCountIs`                 | `stepCountIs(n)` returns a `StopCondition`. The bundled docs name the same function `isStepCount`; the installed package exports it as `stepCountIs`.                                                                                                                                                                                                           | bundled `node_modules/ai/docs/07-reference/01-ai-sdk-core/16-tool-loop-agent.mdx`; <https://ai-sdk.dev/docs/agents/loop-control>                                                   |
| `useChat`                     | `useChat({ transport })` returns `{ messages, status, error, sendMessage, stop }`.                                                                                                                                                                                                                                                                              | <https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat>                                                                                                                             |
| `DefaultChatTransport`        | `new DefaultChatTransport({ api: "/api/chat" })`.                                                                                                                                                                                                                                                                                                               | <https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat>                                                                                                                             |

**Version note, and it is important.** The documentation is not written against
one version. Both the online pages and the bundled docs call the stop condition
`isStepCount`, but the installed `ai@7.0.124` exports that function as
`stepCountIs`. The current `src/server/chat.ts` uses `stepCountIs` and its tests
pass. The rule for this ticket is:

- Use the export name that the **pinned** version provides.
- `bunx tsc --noEmit` is the authority on the name. It proves the export exists.
- Do not rename working code without that proof.
- Record the discrepancy in the Implementation Notes.

**Documentation rule for this ticket.** Read the version-matched documentation in
`node_modules/ai/docs/**` first; the `ai-sdk` tool skill points at it. Use the
online pages only for a topic the bundled docs do not cover. Never read
`node_modules/ai/src/**` or the source of any other dependency. When neither
source documents a capability the ticket needs, stop and report to the CTO.

### 9. Client

- Add `@ai-sdk/react@4.0.127` to `package.json`. That version depends on
  `ai@7.0.124`, the installed core version. `@ai-sdk/react` pins `ai` exactly,
  so the two versions must be chosen as a pair. A different `@ai-sdk/react`
  would install a second copy of `ai`.
- `ChatPanel` uses
  `useChat({ transport: new DefaultChatTransport({ api: "/api/chat" }) })`.
- The message type on the client is `InferAgentUIMessage<typeof agent>`, so the
  tool parts are typed. Export the agent type from `src/server/agent/`.
- The panel renders `message.parts`:
  - `text` renders in a `MessageBubble`;
  - `tool-searchRecords` and `tool-fetchNextPage` with
    `state === "output-available"` contribute their `output.results` to the
    source list;
  - a `tool-*` part with `state === "input-available"` may render a short
    activity notice;
  - every other part type is ignored.
- The source list is deduplicated by record `id` and ordered by descending
  `score`, then by ascending `id`.
- A new `SourcesPanel` component renders the list. It composes only
  `src/components/layout/**`, `src/components/base/**`, and
  `src/components/ui/**`. It reads every color, space, and radius from a token.
- The composer keeps Enter to send and Shift+Enter for a newline.
- `status` drives the disabled state and the streaming indicator. `error` renders
  the error line.
- `collectSources(messages: UIMessage[]): AgentSource[]` is a **pure** helper in
  `src/server/agent/sources.ts`, so it is testable without a browser.

### 10. Environment

| Variable          | Meaning                                   | Default                     |
| ----------------- | ----------------------------------------- | --------------------------- |
| `AI_PROVIDER_URL` | OpenAI-compatible base URL.               | `https://api.openai.com/v1` |
| `AI_API_KEY`      | Provider key. Required.                   | none                        |
| `AI_MODEL`        | Model name.                               | `gpt-4o-mini`               |
| `AGENT_MAX_STEPS` | Maximum generation steps. Integer `>= 1`. | `6`                         |

## TDD Tasks

- [x] **T8.0 — AI SDK tool skill (CTO-owned)**: install the official `ai-sdk`
      skill into `.agents/skills/` and record it in `skills-lock.json`. It
      replaces the former documentation mirror. **Done**: `bunx skills add
vercel/ai -s ai-sdk -a opencode -y`, and the `TOOL SKILLS` section of the
      root `AGENTS.md` lists it.
- [ ] **T8.1 — Agent source and source collection**: write failing tests for
      `collectSources(messages)` — deduplication by `id`, ordering by `score`
      then `id`, ignoring non-tool parts and tool errors — then implement it.
      Files: `src/server/agent/sources.ts`, `src/server/agent/sources.test.ts`.
      Verify: `bun test src/server/agent/sources.test.ts`. Depends on: nothing.
- [ ] **T8.2 — Search session store**: write failing tests for `save`, `read`,
      and `update` — first page, next page, last page, foreign session, expired
      token, malformed token, opaque token, bound — then implement it. Injected
      clock and token generator. Files: `src/server/agent/session-store.ts`,
      `src/server/agent/session-store.test.ts`. Verify:
      `bun test src/server/agent/session-store.test.ts`. Depends on: T8.1.
- [ ] **T8.3 — Tool `searchRecords`**: write failing tests with a fake retriever
      — the `WeightedQuery` built from the input, the fixed weights and
      `minScore`, the `pageSize` default and clamp, the first page, `hasMore`,
      the `AgentSource` mapping, a blank query, a retrieval error — then implement
      it. Files: `src/server/agent/tools.ts`, `src/server/agent/tools.test.ts`.
      Verify: `bun test src/server/agent/tools.test.ts`. Depends on: T8.2.
- [ ] **T8.4 — Tool `fetchNextPage`**: write failing tests — next page, last
      page, the stored binding re-supplied, the cursor advanced, unknown token,
      foreign token, malformed token, an expired retrieval cursor — then
      implement it. Every failure returns `{ error }` and never throws. Files:
      `src/server/agent/tools.ts`, `src/server/agent/tools.test.ts`. Verify:
      `bun test src/server/agent/tools.test.ts`. Depends on: T8.3.
- [ ] **T8.5 — System prompt**: write failing tests that assert each rule of
      section 6 is present, then implement `buildSystemPrompt`. The test asserts
      presence, not exact prose. Files: `src/server/agent/prompt.ts`,
      `src/server/agent/prompt.test.ts`. Verify:
      `bun test src/server/agent/prompt.test.ts`. Depends on: T8.4.
- [ ] **T8.6 — Chat handler**: write failing tests with a fake model and a fake
      retriever — `OPTIONS` `204`, `405`, `400`, `500` before any model call, the
      tool set, the step budget, the UI-message-stream response — then implement
      the handler with `ToolLoopAgent` and `createAgentUIStreamResponse` as
      section 7 describes. Apply the version note of section 8: use the stop
      condition export name that `bunx tsc --noEmit` accepts for `ai@7.0.124`.
      Files: `src/server/chat.ts`, `src/server/chat.test.ts`,
      `src/server/agent/agent.ts`, `src/server/agent/agent.test.ts`,
      `src/server/index.ts`. Verify: `bun test src/server/chat.test.ts`. Depends
      on: T8.5.
- [ ] **T8.7 — Chat surface**: add `@ai-sdk/react@4.0.127`, move `ChatPanel` to
      `useChat`, add `SourcesPanel`, and follow `src/components/AGENTS.md`: no raw
      layout element, no ad-hoc style, CSS scoped under an id, no
      `border-radius`, no `box-shadow`. Files:
      `src/components/app/ChatPanel.tsx`, `src/components/app/SourcesPanel.tsx`,
      `src/components/app/SourcesPanel.css`, `src/components/README.md`,
      `package.json`, `bun.lock`. Verify: `bunx tsc --noEmit` and a manual
      browser check of one question with one source and one question with no
      source. Depends on: T8.6.
- [ ] **T8.8 — Gates and product documentation**: describe the agent behavior in
      `README.md` without naming the ticket, and document `AGENT_MAX_STEPS` in
      `.env.sample`. Run the gates in this order and paste the exact output into
      the Implementation Notes:

  ```sh
  bun fmt
  bun fmt --check
  bun run lint
  bun test
  bunx tsc --noEmit
  ```

  Files: `README.md`, `.env.sample`. Depends on: T8.7.

## Acceptance Criteria

Each criterion is observable and testable.

1. A question in French produces a French answer whose every claim cites a
   record that a tool returned.
2. The agent never answers from its own knowledge: a question with no matching
   record produces a plain statement that nothing was found, and no invented
   slogan.
3. The agent calls `searchRecords` at least once before it answers.
4. When the first search is weak, the agent issues a second `searchRecords` call
   with a different query, inside the step budget.
5. `fetchNextPage` returns the next records of the same ranked list. Following
   every cursor visits each cached record at most once.
6. A cursor from another conversation, an unknown cursor, and a malformed cursor
   each return `{ error }` and never throw.
7. `POST /api/chat` returns a UI message stream. The browser receives text parts
   and the tool parts that carry the sources.
8. The user interface shows the answer and a deduplicated source list, each
   source with its brand, year, and slogan.
9. A missing `AI_API_KEY` returns `500` before any model call. An empty
   `messages` array returns `400`. A non-`POST` method returns `405`.
10. No secret appears in a log line, an error message, or a response.
11. The retrieval files that T0009 owns (`src/lib/retrieval.ts`,
    `src/lib/retrieval-contract.ts`, `src/lib/qdrant.ts`,
    `src/lib/scoring.ts`, `src/lib/result-pages.ts`, `src/server/api.ts`) are
    unchanged, and the only tools the model can call are `searchRecords` and
    `fetchNextPage`.
12. `bun fmt --check`, `bun run lint`, `bun test`, and `bunx tsc --noEmit` all
    pass.

## Known limitation

The agent's default weights include `syntax: 0.5`, so every search reads the
syntax index. The environment must therefore hold a ready syntax index and the
parser model. A search against a missing or incompatible syntax state returns
`{ error }` from the tool instead of a silent fallback; the weights are injected
so a deployment without syntax can pass `{ semantic: 0.5, keyword: 0.5 }`. T0010
tunes the weights and the minimum score against the evaluation.

## Risks and mitigations

| Risk                                                         | Impact                       | Mitigation                                                                                                    |
| ------------------------------------------------------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------- |
| The bundled docs and `ai@7.0.124` disagree on an export name | Build failure                | `bunx tsc --noEmit` is the authority; keep the working name and record the discrepancy                        |
| `@ai-sdk/react` installs a second copy of `ai`               | Duplicate state, subtle bugs | Pin `@ai-sdk/react@4.0.127`, whose `ai` dependency is `7.0.124`; check the tree after install                 |
| `ToolLoopAgent` lacks an option the ticket needs             | Blocked task                 | Stop and report to the CTO with the bundled path consulted; do not read `node_modules/ai/src/**`              |
| A prompt rule is present but the model ignores it            | Weak answers                 | The workflow and tool rules are explicit and numbered; a manual browser check covers one weak-result question |
| The model loops without a bound                              | Cost and latency             | `AGENT_MAX_STEPS` bounds the tool loop                                                                        |
| New UI components drift from the Design System               | Visual regression            | Compose existing primitives only; no new token; `src/components/AGENTS.md` review                             |

## Glossary

- **Agent**: a language model that can call tools in a loop before it answers.
- **Cursor**: an opaque token that continues a paginated result list. It hides
  the position and binds the page to one conversation and one search.
- **RAG**: retrieval-augmented generation. The model answers from records that a
  search returned, not from its training data.
- **Source**: one record that the agent consulted. The user interface shows the
  sources under the answer.
- **Step**: one model generation plus the tool calls it requested.
- **Tool**: a function that the model may call. This ticket gives the model two:
  `searchRecords` and `fetchNextPage`.
- **Tool skill**: a Markdown skill in `.agents/skills/` that tells an agent when
  and why to use a third-party tool, and where its official documentation lives.
- **Tool loop**: the repeat of model step, tool call, and tool result that runs
  until a stop condition is met.
- **`ToolLoopAgent`**: the AI SDK class that runs the tool loop. The ticket
  builds one per request and streams it with `createAgentUIStreamResponse`.
- **Weighted query**: the T0009 query that selects one or more indexes by weight
  and applies a minimum combined score. The agent's tools call it through
  `retrieveWeighted`.
- **UI message stream**: the AI SDK response format that carries text, tool
  calls, tool results, and data parts to the browser as Server-Sent Events.
- **`useChat`**: the React hook from `@ai-sdk/react` that reads a UI message
  stream and exposes the messages and the request state.
