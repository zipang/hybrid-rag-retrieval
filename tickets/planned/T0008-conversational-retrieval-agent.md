# T0008 — Conversational retrieval agent on the Vercel AI SDK

- **Track**: Chat agent and retrieval application
- **Wave**: 1 (independent)
- **Status**: planned
- **Depends on**: nothing
- **Blocks**: nothing
- **References**:
  - `src/server/chat.ts` — the current single-tool chat handler that this ticket replaces.
  - `src/server/chat.test.ts` — the current chat tests.
  - `src/lib/slogan-retrieval.ts` — `Retriever`, `RetrievalOptions`, `SloganHit`.
  - `src/lib/result-pages.ts` — the cursor and snapshot patterns to follow.
  - `src/components/app/ChatPanel.tsx` — the current hand-rolled chat surface.
  - `DESIGN.md` and `src/components/AGENTS.md` — the UI rules.
  - Vercel AI SDK, `ai@7.0.124` and `@ai-sdk/react@4.0.127`:
    - <https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text>
    - <https://ai-sdk.dev/docs/reference/ai-sdk-core/tool>
    - <https://ai-sdk.dev/docs/reference/ai-sdk-core/json-schema>
    - <https://ai-sdk.dev/docs/reference/ai-sdk-core/convert-to-model-messages>
    - <https://ai-sdk.dev/docs/agents/loop-control>
    - <https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling>
    - <https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol>
    - <https://ai-sdk.dev/docs/ai-sdk-ui/streaming-data>
    - <https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat>
    - <https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-tool-usage>

## Context & Goal

Today `POST /api/chat` is a thin wrapper. It defines one tool, `searchSlogans`,
that runs a single hybrid query with `topK`. The system prompt tells the model to
call the tool once and to answer in plain text. The handler streams plain text
back with `toTextStreamResponse()`, and the browser appends that text to a
bubble.

That shape cannot do four things the product needs:

1. **It cannot show its sources.** The answer is text. The records behind it
   never reach the user interface as data.
2. **It cannot page.** `retrieveHybrid` returns one `topK`-bounded list. There is
   no way to ask for the next records.
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

The retrieval backend does not change. The agent calls the current
`retrieveHybrid` through its tools. A later ticket swaps the tool backend for the
weighted cursor API that `T0004` delivers, without changing the tool surface the
model sees.

## Confirmed Intent

- Build on the **current** `retrieveHybrid` contract. This ticket does not depend
  on `T0004`.
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
- `docs/Qdrant - 1.19.1/` and `docs/Qdrant - 1.20.0/`.
- The root `AGENTS.md` and `docs/README.md`. The CTO updates them for the AI SDK
  documentation mirror (T8.0 below).

### Append-only shared files

None. This ticket owns `src/server/chat.ts` alone.

## Contract

Every unit and integration test is written against this section.

### 1. The retrieval backend is unchanged

The agent calls the current retriever interface. Source:
`src/lib/slogan-retrieval.ts`.

```ts
/** Ranking options for one legacy retrieval. */
export type RetrievalOptions = {
  /** Maximum number of fused results. Defaults to 5. */
  topK?: number;
  /** Lower bound on the year field, inclusive. */
  yearFrom?: number;
  /** Upper bound on the year field, inclusive. */
  yearTo?: number;
};

/** Legacy hybrid retriever bound to one embedder and one Qdrant collection. */
export type Retriever = {
  retrieveHybrid: (query: string, options?: RetrievalOptions) => Promise<SloganHit[]>;
};
```

`retrieveHybrid` returns a flat, fused list. It has **no cursor**. The agent
therefore owns pagination over the ranked list that one call returns. The
"Known limitation" section below records the honest bound of that design.

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
  /** Fused retrieval score, as returned by the retriever. */
  score: number;
};
```

`AgentSource` is the shape that the tools return to the model **and** the shape
that the user interface renders. One shape, two consumers.

### 3. Tool `searchRecords`

```ts
/** Input of the `searchRecords` tool. */
export type SearchRecordsInput = {
  /** Search text. Required and non-empty after trim. */
  query: string;
  /** Records returned in this first page. Default 5, clamped to [1, 20]. */
  pageSize?: number;
  /** Lower publication year bound, inclusive. */
  yearFrom?: number;
  /** Upper publication year bound, inclusive. */
  yearTo?: number;
};

/** Output of the `searchRecords` tool. */
export type SearchRecordsOutput = {
  /** First page of the ranked result list. */
  results: AgentSource[];
  /** True when the cached list holds records beyond this page. */
  hasMore: boolean;
  /** Opaque continuation cursor. Present exactly when `hasMore` is true. */
  nextCursor?: string;
};
```

Rules:

- The tool calls
  `retrieveHybrid(query, { topK: SEARCH_WINDOW, yearFrom, yearTo })`, with the
  fixed `SEARCH_WINDOW = 20`.
- It caches the returned ranked list for the conversation, keyed by the session
  identifier of the request (section 7).
- It returns the first `pageSize` records. `pageSize` defaults to 5 and is
  clamped to `[1, 20]`.
- `hasMore` is true when the cached list has more records than the returned page.
  `nextCursor` is present exactly when `hasMore` is true.
- A blank `query` returns `{ results: [], hasMore: false }` and does not call the
  retriever. The tool never throws for a blank query.
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

- The tool reads the next `pageSize` records from the cached list. It uses the
  same `pageSize` as the originating `searchRecords` call.
- A cursor that is unknown, expired, malformed, or from another session returns
  `{ error: "..." }`. The tool **never throws** for a bad cursor, so the model
  can call `searchRecords` again.
- The last page has no `nextCursor` and `hasMore: false`.

### 5. Search session store

```ts
/** In-memory store of ranked result lists, one per conversation. */
export type SearchSessionStore = {
  /** Cache one ranked list for a session and return its cursor. */
  save: (sessionId: string, records: AgentSource[]) => string;
  /** Read one page. Returns `undefined` for an unknown, foreign, or expired cursor. */
  read: (sessionId: string, cursor: string, pageSize: number) => { results: AgentSource[]; nextCursor?: string } | undefined;
};
```

Invariants, each with a test:

- A cursor from another session returns `undefined`.
- An unknown, expired, or malformed cursor returns `undefined`.
- The cursor is opaque. It is a base64url token, not a readable offset.
- The store is bounded by a maximum snapshot count and a time-to-live. The bound
  never changes which records a valid cursor returns.
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
2. Build the query from the content words of the question. Keep year filters out
   of the query text; pass them as `yearFrom` and `yearTo`.
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
- Use `yearFrom` and `yearTo` only when the question names a period.
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
  /** Hybrid retriever behind the two tools. */
  retriever: Pick<Retriever, "retrieveHybrid">;
  /** Search snapshot store. */
  sessions: SearchSessionStore;
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
- `streamText` is called with:
  - `system: buildSystemPrompt()`;
  - `messages: await convertToModelMessages(body.messages, { tools })`;
  - `tools`;
  - `stopWhen` set to the step budget;
  - `onError` that logs the stream error and never logs a secret.
- The handler returns the **UI message stream**:
  `result.toUIMessageStreamResponse()`.
- The existing request body shape and the error status codes do not change, so a
  current client keeps working for the text.

### 8. Documented AI SDK surface

These are the only AI SDK calls the ticket uses. Each row quotes the documented
signature and its source.

| Call                     | Documented signature                                                                                                                       | Source                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `streamText`             | `streamText({ model, system, messages, tools, stopWhen, onError })` returns a result with a `.stream` and a response helper.               | <https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text>               |
| `tool`                   | `tool({ description, inputSchema, execute })`. `execute: (input, { toolCallId, messages, abortSignal }) => RESULT`.                        | <https://ai-sdk.dev/docs/reference/ai-sdk-core/tool>                      |
| `jsonSchema`             | `jsonSchema<T>(schema)` builds the `inputSchema` from a JSON Schema object.                                                                | <https://ai-sdk.dev/docs/reference/ai-sdk-core/json-schema>               |
| `convertToModelMessages` | `convertToModelMessages(messages, { tools })` converts `UIMessage[]` to `ModelMessage[]`.                                                  | <https://ai-sdk.dev/docs/reference/ai-sdk-core/convert-to-model-messages> |
| `stopWhen`               | `stopWhen: <step condition>` stops the tool loop. The live docs show `isStepCount(n)`.                                                     | <https://ai-sdk.dev/docs/agents/loop-control>                             |
| UI message stream        | `result.toUIMessageStreamResponse()`. Fallback: `createUIMessageStreamResponse({ stream: toUIMessageStream({ stream: result.stream }) })`. | <https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol>                       |
| `useChat`                | `useChat({ transport })` returns `{ messages, status, error, sendMessage, stop }`.                                                         | <https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat>                    |
| `DefaultChatTransport`   | `new DefaultChatTransport({ api: "/api/chat" })`.                                                                                          | <https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat>                    |

**Version note, and it is important.** The documentation site is not versioned.
It shows `isStepCount`, while the installed `ai@7.0.124` exports `stepCountIs`,
which the current `src/server/chat.ts` already uses and which the current tests
pass. The rule for this ticket is:

- Use the export name that the **pinned** version provides.
- `bunx tsc --noEmit` is the authority on the name. It proves the export exists.
- Do not rename working code without that proof.
- Record the discrepancy in the Implementation Notes.

### 9. Client

- Add `@ai-sdk/react@4.0.127` to `package.json`. That version depends on
  `ai@7.0.124`, the installed core version. `@ai-sdk/react` pins `ai` exactly,
  so the two versions must be chosen as a pair. A different `@ai-sdk/react`
  would install a second copy of `ai`.
- `ChatPanel` uses
  `useChat({ transport: new DefaultChatTransport({ api: "/api/chat" }) })`.
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

- [ ] **T8.0 — AI SDK documentation mirror (CTO-owned)**: mirror the Vercel AI
      SDK documentation with the `librarian` agent and the `index-tool-docs`
      skill into `docs/ai - 7.0.124/`. Verify the mirror contains the
      `streamText`, `tool`, `stream-protocol`, and `use-chat` pages. Then update
      the root `AGENTS.md` `LOCAL DOCUMENTATION FOR TOOLS` section and
      `docs/README.md`. A coding sub-agent must not do this task.
- [ ] **T8.1 — Agent source and source collection**: write failing tests for
      `collectSources(messages)` — deduplication by `id`, ordering by `score`
      then `id`, ignoring non-tool parts and tool errors — then implement it.
      Files: `src/server/agent/sources.ts`, `src/server/agent/sources.test.ts`.
      Verify: `bun test src/server/agent/sources.test.ts`. Depends on: nothing.
- [ ] **T8.2 — Search session store**: write failing tests for `save` and `read`
      — first page, next page, last page, foreign session, expired cursor,
      malformed cursor, opaque cursor, bound — then implement it. Injected clock
      and token generator. Files: `src/server/agent/session-store.ts`,
      `src/server/agent/session-store.test.ts`. Verify:
      `bun test src/server/agent/session-store.test.ts`. Depends on: T8.1.
- [ ] **T8.3 — Tool `searchRecords`**: write failing tests with a fake retriever
      — `RetrievalOptions` built from the input, `pageSize` default and clamp,
      first page, `hasMore`, blank query — then implement it. Files:
      `src/server/agent/tools.ts`, `src/server/agent/tools.test.ts`. Verify:
      `bun test src/server/agent/tools.test.ts`. Depends on: T8.2.
- [ ] **T8.4 — Tool `fetchNextPage`**: write failing tests — next page, last
      page, unknown cursor, foreign cursor, malformed cursor — then implement it.
      Every failure returns `{ error }` and never throws. Files:
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
      the handler. Apply the version note of section 8: use the `stopWhen` export
      name that `bunx tsc --noEmit` accepts for `ai@7.0.124`. Files:
      `src/server/chat.ts`, `src/server/chat.test.ts`, `src/server/index.ts`.
      Verify: `bun test src/server/chat.test.ts`. Depends on: T8.5.
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
11. The retrieval backend files are unchanged, and the only tools the model can
    call are `searchRecords` and `fetchNextPage`.
12. `bun fmt --check`, `bun run lint`, `bun test`, and `bunx tsc --noEmit` all
    pass.

## Known limitation

The current `retrieveHybrid` is `topK`-bounded and has no cursor. Pagination
therefore covers the first `SEARCH_WINDOW = 20` ranked records of one search, not
the whole corpus. This is honest and bounded. The follow-up ticket, after `T0004`
closes, replaces the tool backend with the weighted cursor API
(`src/lib/retrieval.ts` and `src/lib/result-pages.ts`) and removes the window.
The tool surface the model sees does not change.

## Risks and mitigations

| Risk                                                             | Impact                       | Mitigation                                                                                                    |
| ---------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------- |
| The live AI SDK docs and `ai@7.0.124` disagree on an export name | Build failure                | `bunx tsc --noEmit` is the authority; keep the working name and record the discrepancy                        |
| `@ai-sdk/react` installs a second copy of `ai`                   | Duplicate state, subtle bugs | Pin `@ai-sdk/react@4.0.127`, whose `ai` dependency is `7.0.124`; check the tree after install                 |
| A prompt rule is present but the model ignores it                | Weak answers                 | The workflow and tool rules are explicit and numbered; a manual browser check covers one weak-result question |
| The model loops without a bound                                  | Cost and latency             | `AGENT_MAX_STEPS` bounds the tool loop                                                                        |
| New UI components drift from the Design System                   | Visual regression            | Compose existing primitives only; no new token; `src/components/AGENTS.md` review                             |

## Glossary

- **Agent**: a language model that can call tools in a loop before it answers.
- **Cursor**: an opaque token that continues a paginated result list. It hides
  the position and binds the page to one conversation and one search.
- **Hybrid retrieval**: a search that fuses a dense vector score and a keyword
  score into one ranking.
- **RAG**: retrieval-augmented generation. The model answers from records that a
  search returned, not from its training data.
- **Source**: one record that the agent consulted. The user interface shows the
  sources under the answer.
- **Step**: one model generation plus the tool calls it requested.
- **Tool**: a function that the model may call. This ticket gives the model two:
  `searchRecords` and `fetchNextPage`.
- **UI message stream**: the AI SDK response format that carries text, tool
  calls, tool results, and data parts to the browser as Server-Sent Events.
- **`useChat`**: the React hook from `@ai-sdk/react` that reads a UI message
  stream and exposes the messages and the request state.
