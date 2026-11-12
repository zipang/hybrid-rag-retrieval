# T0008 — Conversational retrieval agent on the Vercel AI SDK

- **Track**: Chat agent and retrieval application
- **Wave**: 2 (integration — builds on the weighted retrieval API)
- **Status**: review
- **Owner**: coding sub-agent, supervised by CTO
- **Started**: 2026-11-12
- **Depends on**: T0009
- **Blocks**: T0010, T0011
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
  - `src/components/app/MessageBubble.tsx` — the current text-only message
    surface that this ticket renders as Markdown.
  - `agents/` — the committed directory of agent resources. `agents/default.md`
    is the generic default; `agents/slogans.md` and `agents/citations.md` are
    examples.
  - `src/server/agent/resource.ts` — the agent-resource loader and the
    `AgentResource` type. Owns the resource format for the whole project.
  - `.opencode/agents/retrieval-agent.md` — the OpenCode wrapper that loads the
    generic default agent, so the agent can be tested directly in OpenCode.
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
  - `react-markdown@10.1.0` and `remark-gfm@4.0.1`, the browser Markdown
    renderer:
    - <https://github.com/remarkjs/react-markdown#readme>
    - <https://github.com/remarkjs/remark-gfm#readme>

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

"Done" means: a French question produces a French answer, written in Markdown,
whose every claim cites a record that a tool returned; the interface renders the
Markdown and shows the sources under the answer; and a question with no matching
record produces a plain statement instead of an invented slogan.

The durable instructions of the agent are **not code**. An agent is a
**resource**: a Markdown document with a YAML frontmatter, loaded at runtime from
the agent directory and never hard-coded in TypeScript, never imported, and never
bundled. The repository commits the `agents/` directory as data. The default
agent is **generic**: it answers questions about a collection of text records
with the tools and the budget it is given, and it names no language and no
dataset. A specialized agent, such as `agents/slogans.md`, is a separate resource.
The team edits a resource over time, and OpenCode can load the same resource for
direct testing.

The agent directory is configurable (`AGENTS_DIR`, default `agents/`). The chat
selects an agent by id (the request's `agentId`, else `AGENT_ID`, else
`default`) and loads it **once per chat session**, then caches it.

The retrieval backend is the weighted API that `T0009` delivers. The agent's
tools call `retrieveWeighted`, so the model can search, page with a real cursor,
and see the per-index scores behind each record. The legacy `retrieveHybrid`
path is obsolete and this ticket does not use it.

## Confirmed Intent

- Build on the **weighted** `retrieveWeighted` contract from `T0009`. This ticket
  depends on `T0009`.
- Deliver the **backend agent and the chat user interface**.
- Give the agent **two tools**: one search tool and one pagination tool.
- The answer format is **cited Markdown plus a structured source list**. The
  agent may use bold, italic, lists, and tables.
- The agent is a **resource**: a Markdown document with a YAML frontmatter,
  loaded at runtime from the agent directory, never hard-coded in TypeScript and
  never bundled. The repository commits the `agents/` directory as data.
- The **default agent is generic**: it answers about a collection of text records
  with the tools and the budget it is given, and names no language and no dataset.
- A specialized agent (`agents/slogans.md`) is a separate resource.
- The chat selects an agent by id and loads it **once per session**.
- The user interface renders the answer with **`react-markdown` and
  `remark-gfm`**, mapped to the design-system primitives.
- The agent may **search again** when the first results are weak, inside a
  **bounded step budget**.
- Transport the answer and the sources with the AI SDK **UI message stream**.
- Add `@ai-sdk/react` and use `useChat` in the browser.

## Scope Boundary

Create or modify **only** these paths.

### May create

- `agents/` (new directory)
  - `default.md` — the generic default agent resource.
  - `citations.md` — an example resource, for a citation corpus.
  - The directory ignores every other file, so a deployment adds local agents
    without committing them.
- `src/server/agent/` (new directory)
  - `sources.ts`, `sources.test.ts` — the `AgentSource` type and the pure source
    collection helper.
  - `session-store.ts`, `session-store.test.ts` — the per-conversation search
    snapshot store.
  - `tools.ts`, `tools.test.ts` — `searchRecords` and `fetchNextPage`.
  - `resource.ts`, `resource.test.ts` — the `AgentResource` type, the frontmatter
    parser, `loadAgentResource`, and `listAgentResources`.
  - `agent.ts`, `agent.test.ts` — the `ToolLoopAgent` factory and its exported
    UI message type.
- `src/components/app/MarkdownText.tsx` and `MarkdownText.css` — the Markdown
  renderer, built on `react-markdown` and `remark-gfm`.
- `src/components/app/SourcesPanel.tsx` and `SourcesPanel.css` — the source list.
- `src/components/app/ToolActivity.tsx` and `ToolActivity.css` — optional, a
  one-line notice when the agent runs another search.
- `.opencode/agents/retrieval-agent.md` — the OpenCode wrapper. YAML frontmatter
  plus a body that points at `agents/default.md`.

### May modify

- `src/server/chat.ts` and `src/server/chat.test.ts`.
- `src/server/index.ts` — wire the tools, the session store, and the agent
  directory.
- `src/components/app/ChatPanel.tsx` — move to `useChat`.
- `src/components/app/MessageBubble.tsx` — render the assistant text through
  `MarkdownText`.
- `src/components/README.md` — document the new components.
- `src/components/AGENTS.md` — document the narrow Markdown-rendering exception
  to the raw-element rule.
- `package.json` and `bun.lock` — add `@ai-sdk/react@4.0.127`,
  `react-markdown@10.1.0`, and `remark-gfm@4.0.1`.
- `.env.sample` — document `AGENT_MAX_STEPS`, `AGENTS_DIR`, and `AGENT_ID`.
- `.gitignore` — ignore `agents/*` except `default.md` and `citations.md`.
- `README.md` — describe the agent behavior and the agent resources.

### May delete

- `src/server/agent/retrieval-agent.md`, `src/server/agent/prompt.ts`, and
  `src/server/agent/prompt.test.ts` — superseded by `agents/` and
  `src/server/agent/resource.ts`.

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

### 6. The agent resource

An agent is a **resource**. It is a Markdown document with a YAML frontmatter.
It is never hard-coded in TypeScript, never imported, and never bundled; it is
data, not code.

The resources live in the agent directory: `AGENTS_DIR`, default `agents/`. One
agent is one file, `<id>.md`. The `id` is the file name without `.md`. The
repository commits the directory as data.

The frontmatter carries two required fields:

| Field         | Type   | Meaning                                                                     |
| ------------- | ------ | --------------------------------------------------------------------------- |
| `description` | string | A short description, non-empty, for listing and choosing.                   |
| `language`    | string | A language code, non-empty, for example `fr`. The agent's primary language. |

The body holds the five required level-two sections, in this order:

| Heading            | Holds                                                        |
| ------------------ | ------------------------------------------------------------ |
| `## Role`          | The persona: what the agent answers, from which records.     |
| `## Workflow`      | The ordered steps the agent follows.                         |
| `## Tool rules`    | When and how to call `searchRecords` and `fetchNextPage`.    |
| `## Answer format` | The rules for the answer text, including the Markdown rules. |
| `## Budget`        | The step budget.                                             |

The committed resources are **examples only**:

- `agents/default.md` — the **generic default** (section 6.1).
- `agents/citations.md` — an example for a citation corpus.

Every other file under `agents/` is **local**: the repository ignores `agents/*`
except those two, so a deployment adds its own agents without committing them.
The directory therefore holds only `.md` agent files; a `README.md` would be
listed as an agent, so the format is documented elsewhere.

The loader lives in `resource.ts`:

```ts
/** One agent resource: a Markdown document with a YAML frontmatter. */
export type AgentResource = {
  /** Identifier, from the file name without `.md`. */
  id: string;
  /** Short description from the frontmatter, for listing. */
  description: string;
  /** Response language code from the frontmatter, for example `fr`. */
  language: string;
  /** The Markdown body, used verbatim as the system prompt. */
  instructions: string;
};

/** Listing form of a resource, without the body. */
export type AgentResourceSummary = Pick<AgentResource, "id" | "description" | "language">;

/** Parse one resource from its id and full text. Throws on a bad frontmatter or body. */
export const parseAgentResource: (id: string, text: string) => AgentResource;

/** Read one resource from `AGENTS_DIR`. Throws when the file is missing. */
export const loadAgentResource: (id: string) => AgentResource;

/** List the available resources, sorted by id. */
export const listAgentResources: () => AgentResourceSummary[];
```

The per-session cache lives in `resource.ts` too:

```ts
/** In-memory cache of the agent loaded for each chat session. */
export type AgentSessionCache = {
  /** Return the resource for one session, loading it once per session. */
  get: (sessionId: string, agentId: string) => AgentResource;
};

/** Create a per-session agent cache over a loader. */
export const createAgentSessionCache: (load: (id: string) => AgentResource) => AgentSessionCache;
```

Rules, each with a test:

- The frontmatter is delimited by `---` lines and parsed with `Bun.YAML.parse`.
  A missing frontmatter, a missing `description`, or a missing `language` throws
  an `Error` that names the problem.
- `parseAgentResource` validates the five body sections (present, in order,
  non-empty) exactly as the former loader did.
- An id is a lowercase slug: it matches `/^[a-z0-9][a-z0-9-]*$/`. An id that does
  not match is rejected with an `Error` that names the id only. This rejects
  path traversal such as `../README` before any file is read.
- `loadAgentResource(id)` reads `AGENTS_DIR/<id>.md`. A missing file throws an
  `Error` that names the id only, never a filesystem path.
- `listAgentResources()` reads the directory and returns one summary per `.md`
  file, sorted by `id`.
- The text is injectable: `parseAgentResource(id, text)` takes the text, so the
  tests are hermetic and read no file.
- `createAgentSessionCache(load)` calls `load` on the first `get` for a session,
  and returns the cached resource on the next `get` for the same session and
  agent without calling `load` again. A different session loads again. A
  different `agentId` for the same session replaces the cached resource.
- The cache is bounded by a maximum session count, as
  `createSearchSessionStore` is. The bound never changes which resource a valid
  session resolves.
- The `loadAgentResource` and `listAgentResources` tests set `AGENTS_DIR` to a
  temporary directory of fixtures, so they never depend on a local, uncommitted
  resource. One integration test may load the committed `default` resource.
- No agent instruction is hard-coded in TypeScript.

Each resource body must carry every rule of its section below. A test asserts that
each resource contains its required entries, and that `Role` and `Budget` are
non-empty. The test asserts presence, not exact prose.

#### 6.1 The generic default (`agents/default.md`)

Role:

- The agent answers questions about a collection of text records.
- It answers in the language of the question.
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

- Write the answer in **Markdown**. Bold, italic, lists, and tables are allowed.
- Cite each claim with the identifying fields of the record, in parentheses.
- Cite only records that a tool returned.
- When no record answers the question, say so plainly and name the queries that
  failed.
- End with one short sentence that gives the number of records consulted.

Budget:

- The agent has at most 6 steps. It uses them to search and then to answer. It
  must answer before the budget ends.

#### 6.2 The citations example (`agents/citations.md`)

It mirrors the generic default, with two specializations:

- `language: fr`, and the Role says the agent answers about a corpus of
  literary citations and answers in French.
- The Answer format cites each claim with the author and the year.

#### 6.3 The budget alignment

The `## Budget` section of `agents/default.md` states a plain number, and the
default of `maxSteps` in section 7 is `6`. A test asserts the two are equal, so
the resource text and the runtime bound cannot drift.

### 7. The `POST /api/chat` handler

```ts
/** Dependencies of the chat endpoint. Tests inject fakes. */
export type ChatDependencies = {
  /** Weighted retriever behind the two tools. */
  retriever: Pick<WeightedRetriever, "retrieveWeighted">;
  /** Search session store. */
  sessions: SearchSessionStore;
  /** Per-session agent cache, so the resource is read once per session. */
  agents: AgentSessionCache;
  /** Agent id used when the request does not name one. */
  defaultAgentId: string;
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

The default weights are `{ semantic: 0.5, keyword: 0.5 }` and the default minimum
score is `0.5`. The default **excludes** the `syntax` index, so a search never
reads the `ast` vector. They are dependencies so a test overrides them and so
T0010 can tune them against the evaluation. `SloganFields` is the field
configuration type from `src/server/api.ts`.

Request:

- `POST` with a JSON body `{ id?: string; agentId?: string; messages: UIMessage[] }`.
- `id` is the conversation identifier. When it is absent or not a non-empty
  string, the handler uses `"anonymous"`.
- `agentId` selects the agent resource. It is trimmed; when it is absent or not a
  non-empty string, the handler uses `defaultAgentId`.
- `OPTIONS` returns `204` with the CORS headers.
- A method other than `POST` returns `405`.
- A missing `AI_API_KEY` returns `500` with a clear message, before any model
  call.
- A missing or empty `messages` array returns `400`.

Behavior:

- The tools are created once per request, bound to the retriever, the session
  store, and the session identifier from the body.
- The agent resource is resolved through the cache, once per session:
  `const resource = agents.get(sessionId, agentId)`.
- A `ToolLoopAgent` is built once per request:
  - `model` from `createModel(env, identity)`;
  - `instructions: resource.instructions`;
  - `tools`;
  - `stopWhen: stepCountIs(maxSteps)`.
- The handler returns the **UI message stream**:
  `createAgentUIStreamResponse({ agent, uiMessages: body.messages, abortSignal: request.signal, onError })`.
- `onError` is a `UIMessageStreamOptions` member of
  `createAgentUIStreamResponse`, **not** a `ToolLoopAgent` setting: the installed
  `ToolLoopAgentSettings` has no `onError` member. Its documented signature is
  `onError: (error: unknown) => string`. It logs the stream error server-side and
  returns the client message `"An error occurred."`, so no secret reaches the
  client.
- The handler does not call `convertToModelMessages` itself. The agent and
  `createAgentUIStreamResponse` validate the UI messages and convert them to
  model messages.
- The existing request body shape and the error status codes do not change, so a
  current client keeps working for the text.

### 8. Documented AI SDK surface

These are the only AI SDK calls the ticket uses. Each row quotes the documented
signature and its source. The bundled documentation is the primary source; it
matches the installed `ai@7.0.124`.

| Call                          | Documented signature                                                                                                                                                                                                                                                                                                                                                                   | Source                                                                                                                                                                             |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `new ToolLoopAgent({...})`    | `new ToolLoopAgent({ model, instructions, tools, stopWhen })`. `model: LanguageModel` (required); `instructions: Instructions` (optional); `tools: Record<string, Tool>` (optional); `stopWhen: StopCondition \| StopCondition[]` (optional, default `isStepCount(20)`). The class "accepts all the same settings as `generateText` and `streamText`". It has **no** `onError` member. | bundled `node_modules/ai/docs/07-reference/01-ai-sdk-core/16-tool-loop-agent.mdx`; <https://ai-sdk.dev/docs/reference/ai-sdk-core/tool-loop-agent>                                 |
| `createAgentUIStreamResponse` | `createAgentUIStreamResponse({ agent, uiMessages, abortSignal, ...UIMessageStreamOptions }) => Promise<Response>`. `agent: Agent` (required; must implement `.stream()` and define `tools`); `uiMessages: unknown[]` (required).                                                                                                                                                       | bundled `node_modules/ai/docs/07-reference/01-ai-sdk-core/18-create-agent-ui-stream-response.mdx`; <https://ai-sdk.dev/docs/reference/ai-sdk-core/create-agent-ui-stream-response> |
| `InferAgentUIMessage`         | `InferAgentUIMessage<typeof agent>` infers the UI message type of an agent instance.                                                                                                                                                                                                                                                                                                   | bundled `node_modules/ai/docs/07-reference/01-ai-sdk-core/16-tool-loop-agent.mdx`, section `Types`                                                                                 |
| `tool`                        | `tool({ description, inputSchema, execute })`. `execute: (input, { toolCallId, messages, abortSignal }) => RESULT`.                                                                                                                                                                                                                                                                    | bundled `node_modules/ai/docs/07-reference/01-ai-sdk-core/20-tool.mdx`; <https://ai-sdk.dev/docs/reference/ai-sdk-core/tool>                                                       |
| `jsonSchema`                  | `jsonSchema<T>(schema)` builds the `inputSchema` from a JSON Schema object.                                                                                                                                                                                                                                                                                                            | bundled `node_modules/ai/docs/07-reference/01-ai-sdk-core/25-json-schema.mdx`; <https://ai-sdk.dev/docs/reference/ai-sdk-core/json-schema>                                         |
| `onError`                     | `UIMessageStreamOptions.onError: (error: unknown) => string`. Process a stream error, e.g. to log it; it returns the message to include in the data stream. Passed to `createAgentUIStreamResponse`, not `ToolLoopAgent`.                                                                                                                                                              | bundled `node_modules/ai/docs/07-reference/01-ai-sdk-core/02-stream-text.mdx`, section `toUIMessageStream` → `UIMessageStreamOptions.onError`                                      |
| `stepCountIs`                 | `stepCountIs(n)` returns a `StopCondition`. The bundled docs name the same function `isStepCount`; the installed package exports it as `stepCountIs`.                                                                                                                                                                                                                                  | bundled `node_modules/ai/docs/07-reference/01-ai-sdk-core/16-tool-loop-agent.mdx`; <https://ai-sdk.dev/docs/agents/loop-control>                                                   |
| `useChat`                     | `useChat({ transport })` returns `{ messages, status, error, sendMessage, stop }`.                                                                                                                                                                                                                                                                                                     | <https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat>                                                                                                                             |
| `DefaultChatTransport`        | `new DefaultChatTransport({ api: "/api/chat" })`.                                                                                                                                                                                                                                                                                                                                      | <https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat>                                                                                                                             |

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

**Documented UI dependencies.** The Markdown renderer runs in the browser, so
`Bun.markdown` does not apply here. These two packages are the browser surface,
and this ticket quotes their documented signatures.

| Call         | Documented signature                                                                                                                                                                                                                                                                                                                       | Source                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| `Markdown`   | `import Markdown from "react-markdown"`. Default export. Rendered as `<Markdown remarkPlugins={[remarkGfm]} skipHtml components={map}>{text}</Markdown>`. Props: `children: string`; `components: Components`; `remarkPlugins: Array<Plugin>`; `skipHtml: boolean` (default `false`). It renders safely with no `dangerouslySetInnerHTML`. | <https://github.com/remarkjs/react-markdown#readme>     |
| `Components` | `type Components = { [Key in Extract<ElementType, string>]?: ElementType<ComponentProps<Key> & ExtraProps> }`. Each entry receives the element's props plus `node`. Keys are HTML tag names, such as `p`, `strong`, `table`.                                                                                                               | <https://github.com/remarkjs/react-markdown#components> |
| `remarkGfm`  | `import remarkGfm from "remark-gfm"`. Passed in `remarkPlugins`. It adds tables, strikethrough, task lists, autolinks, and footnotes.                                                                                                                                                                                                      | <https://github.com/remarkjs/remark-gfm#readme>         |

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
  - `text` renders in a `MessageBubble`; the assistant body is rendered as
    Markdown through `MarkdownText`;
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
- `MarkdownText` wraps `react-markdown` and is the only Markdown renderer:
  - `remarkPlugins={[remarkGfm]}` and `skipHtml` true, so raw HTML in the model
    output is ignored;
  - `components` maps `p`, `strong`, `em`, `code`, `a`, and `h1`–`h6` to
    `Text` and `Heading` where a primitive fits;
  - `ul`, `ol`, `li`, and the GFM `table` family render as token-styled
    elements, because the kit has no primitive for them.
- `MarkdownText` is the only component that may render a raw `<ul>`, `<ol>`,
  `<li>`, `<table>`, `<thead>`, `<tbody>`, `<tr>`, `<th>`, or `<td>`. This
  narrow exception to the raw-element rule is documented in
  `src/components/AGENTS.md` and `src/components/README.md`.
- Every color, space, and radius in `MarkdownText.css` is read from a token. No
  new design token is added, so `DESIGN.md` does not change.
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
| `AGENTS_DIR`      | Directory of agent resources.             | `agents/`                   |
| `AGENT_ID`        | Agent id used when a request names none.  | `default`                   |

## TDD Tasks

- [x] **T8.0 — AI SDK tool skill (CTO-owned)**: install the official `ai-sdk`
      skill into `.agents/skills/` and record it in `skills-lock.json`. It
      replaces the former documentation mirror. **Done**: `bunx skills add
vercel/ai -s ai-sdk -a opencode -y`, and the `TOOL SKILLS` section of the
      root `AGENTS.md` lists it.
- [x] **T8.1 — Agent source and source collection**: write failing tests for
      `collectSources(messages)` — deduplication by `id`, ordering by `score`
      then `id`, ignoring non-tool parts and tool errors — then implement it.
      Files: `src/server/agent/sources.ts`, `src/server/agent/sources.test.ts`.
      Verify: `bun test src/server/agent/sources.test.ts`. Depends on: nothing.
- [x] **T8.2 — Search session store**: write failing tests for `save`, `read`,
      and `update` — first page, next page, last page, foreign session, expired
      token, malformed token, opaque token, bound — then implement it. Injected
      clock and token generator. Files: `src/server/agent/session-store.ts`,
      `src/server/agent/session-store.test.ts`. Verify:
      `bun test src/server/agent/session-store.test.ts`. Depends on: T8.1.
- [x] **T8.3 — Tool `searchRecords`**: write failing tests with a fake retriever
      — the `WeightedQuery` built from the input, the fixed weights and
      `minScore`, the `pageSize` default and clamp, the first page, `hasMore`,
      the `AgentSource` mapping, a blank query, a retrieval error — then implement
      it. Files: `src/server/agent/tools.ts`, `src/server/agent/tools.test.ts`.
      Verify: `bun test src/server/agent/tools.test.ts`. Depends on: T8.2.
- [x] **T8.4 — Tool `fetchNextPage`**: write failing tests — next page, last
      page, the stored binding re-supplied, the cursor advanced, unknown token,
      foreign token, malformed token, an expired retrieval cursor — then
      implement it. Every failure returns `{ error }` and never throws. Files:
      `src/server/agent/tools.ts`, `src/server/agent/tools.test.ts`. Verify:
      `bun test src/server/agent/tools.test.ts`. Depends on: T8.3.
- [x] **T8.5 — Agent resource and loader**: create `agents/default.md` (generic)
      and `agents/citations.md`; add the `.gitignore` rules that ignore `agents/*`
      except those two; then write failing tests for `parseAgentResource`,
      `loadAgentResource`, `listAgentResources`, and `createAgentSessionCache` —
      frontmatter present with `description` and `language`; a missing field
      throws; the five body sections present, in order, and non-empty; a missing
      section throws; a missing file throws; an id with a path separator or a dot
      (`../README`) is rejected before any read; the list is sorted by id; the
      cache loads once per session, reloads for a new session, replaces the entry
      for a different `agentId`, and is bounded by a session count — then implement
      `resource.ts`. The `loadAgentResource` and `listAgentResources` tests point
      `AGENTS_DIR` at a temporary fixture directory, so they never depend on a
      local, uncommitted resource. A test asserts the `agents/default.md` budget
      number equals the default `maxSteps`. Delete the superseded
      `src/server/agent/retrieval-agent.md`, `src/server/agent/prompt.ts`, and
      `src/server/agent/prompt.test.ts`. Files: `agents/default.md`,
      `agents/citations.md`, `.gitignore`, `src/server/agent/resource.ts`,
      `src/server/agent/resource.test.ts`. Verify:
      `bun test src/server/agent/resource.test.ts`. Depends on: T8.4.
- [x] **T8.6 — Chat handler**: write failing tests with a fake model and a fake
      retriever — `OPTIONS` `204`, `405`, `400`, `500` before any model call, the
      tool set, the step budget, the UI-message-stream response, and the agent
      resolution (an explicit `agentId`, the `defaultAgentId` fallback, and the
      per-session cache) — then implement the handler with `ToolLoopAgent` and
      `createAgentUIStreamResponse` as section 7 describes. The agent's
      `instructions` come from `agents.get(sessionId, agentId).instructions`.
      Apply the version note of section 8: use the stop condition export name that
      `bunx tsc --noEmit` accepts for `ai@7.0.124`. Files: `src/server/chat.ts`,
      `src/server/chat.test.ts`, `src/server/agent/agent.ts`,
      `src/server/agent/agent.test.ts`, `src/server/index.ts`. Verify:
      `bun test src/server/chat.test.ts`. Depends on: T8.5.
- [x] **T8.7 — Chat surface**: add `@ai-sdk/react@4.0.127`,
      `react-markdown@10.1.0`, and `remark-gfm@4.0.1`; move `ChatPanel` to
      `useChat`; add `SourcesPanel`; add `MarkdownText` and render the assistant
      body through it; and follow `src/components/AGENTS.md`: no raw layout
      element outside the documented Markdown exception, no ad-hoc style, CSS
      scoped under an id, no `border-radius`, no `box-shadow`. Document the
      Markdown exception in `src/components/AGENTS.md` and
      `src/components/README.md`. Files:
      `src/components/app/ChatPanel.tsx`, `src/components/app/MessageBubble.tsx`,
      `src/components/app/MarkdownText.tsx`,
      `src/components/app/MarkdownText.css`,
      `src/components/app/SourcesPanel.tsx`,
      `src/components/app/SourcesPanel.css`, `src/components/AGENTS.md`,
      `src/components/README.md`, `package.json`, `bun.lock`. Verify:
      `bunx tsc --noEmit` and a manual browser check of one question with one
      source, one question with no source, and one answer that uses bold and a
      table. Depends on: T8.6.
- [x] **T8.8 — Gates and product documentation**: describe the agent behavior and
      the agent resources in `README.md` without naming the ticket — the committed
      examples are `default.md` and `citations.md`, and every other file under
      `agents/` is local and ignored — and document `AGENT_MAX_STEPS`, `AGENTS_DIR`,
      and `AGENT_ID` in `.env.sample`. Run the gates in this order and paste the
      exact output into the Implementation Notes:

  ```sh
  bun fmt
  bun fmt --check
  bun run lint
  bun test
  bunx tsc --noEmit
  ```

  Files: `README.md`, `.env.sample`. Depends on: T8.7.

- [x] **T8.9 — OpenCode wrapper (CTO-owned)**: create
      `.opencode/agents/retrieval-agent.md` with the YAML frontmatter
      (`description`, `mode: primary`, read-only `permissions`) and a body that
      tells the agent to read `agents/default.md` and adopt it as its
      instructions. Files: `.opencode/agents/retrieval-agent.md`. Verify: the
      agent appears in OpenCode and answers a question. Depends on: T8.5.

## Acceptance Criteria

Each criterion is observable and testable.

1. A question in French produces a French answer, written in Markdown, whose
   every claim cites a record that a tool returned.
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
8. The user interface shows the answer rendered as Markdown — bold, italic,
   lists, and tables are formatted, not shown as raw characters — and a
   deduplicated source list, each source with its brand, year, and slogan.
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
13. The agent is loaded from a resource in `agents/` (`AGENTS_DIR`). The default
    agent is generic: it names no language and no dataset. A missing frontmatter
    field, a missing, out-of-order, or empty required section, or a missing file
    fails the test suite. No agent instruction is hard-coded in TypeScript.
14. An `agentId` that is not a lowercase slug — for example `../README` — is
    rejected before any file is read, and no error message contains a filesystem
    path.
15. Only `agents/default.md` and `agents/citations.md` are committed. Every other
    file under `agents/` is ignored by Git, and the test suite passes on a fresh
    clone that holds only the two examples.

## Known limitation

The agent's default weights are `{ semantic: 0.5, keyword: 0.5 }`: they
**exclude** the `syntax` index. The `syntax` (`ast`) index is not selected until
the multi-vector syntax search is operational, because a search that selects
`syntax` fails when the index is missing: `retrieveWeighted` calls
`assertSyntaxReady` before any transport query, and a generation with no ready
syntax run throws. The weights are injected, so a deployment with a ready syntax
index selects it by weight; T0010 tunes the weights and the minimum score against
the evaluation.

The default agent resource states the step budget as a plain number (`6`),
because the team chose a fully static resource over runtime templating. The
runtime bound is the `maxSteps` dependency, whose default is also `6`. A test
asserts the two agree, but a deployment that sets `AGENT_MAX_STEPS` to another
value changes only the runtime bound: the resource text then describes a budget
the runtime does not enforce. T0010 or a later ticket may template the budget
when that matters.

## Risks and mitigations

| Risk                                                           | Impact                           | Mitigation                                                                                                          |
| -------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| The bundled docs and `ai@7.0.124` disagree on an export name   | Build failure                    | `bunx tsc --noEmit` is the authority; keep the working name and record the discrepancy                              |
| `@ai-sdk/react` installs a second copy of `ai`                 | Duplicate state, subtle bugs     | Pin `@ai-sdk/react@4.0.127`, whose `ai` dependency is `7.0.124`; check the tree after install                       |
| `react-markdown` emits raw elements the design system forbids  | Design-system violation          | One narrow exception, documented in `src/components/AGENTS.md`; map what the primitives cover, token-style the rest |
| The resource's hard-coded budget drifts from `AGENT_MAX_STEPS` | The prompt lies about the budget | A test asserts the resource number equals the default `maxSteps`; the risk is recorded in the Known limitation      |
| `react-markdown` and its tree grow the browser bundle          | Slower first load                | The renderer is small (CommonMark + GFM); measure the bundle once and accept or reconsider                          |
| `ToolLoopAgent` lacks an option the ticket needs               | Blocked task                     | Stop and report to the CTO with the bundled path consulted; do not read `node_modules/ai/src/**`                    |
| A prompt rule is present but the model ignores it              | Weak answers                     | The workflow and tool rules are explicit and numbered; a manual browser check covers one weak-result question       |
| The model loops without a bound                                | Cost and latency                 | `AGENT_MAX_STEPS` bounds the tool loop                                                                              |
| New UI components drift from the Design System                 | Visual regression                | Compose existing primitives; the Markdown exception is documented; no new token; `src/components/AGENTS.md` review  |

## Glossary

- **Agent**: a language model that can call tools in a loop before it answers.
- **Cursor**: an opaque token that continues a paginated result list. It hides
  the position and binds the page to one conversation and one search.
- **GFM**: GitHub Flavored Markdown. The Markdown extension that adds tables,
  strikethrough, task lists, and autolinks. `remark-gfm` adds it to
  `react-markdown`.
- **Markdown**: a plain-text format for formatted prose. `**bold**`, `*italic*`,
  and `| a | b |` tables. The agent writes its answer in Markdown.
- **`MarkdownText`**: the browser component that renders the agent's Markdown
  answer. It wraps `react-markdown` and `remark-gfm`.
- **Agent resource**: one Markdown document with a YAML frontmatter
  (`description`, `language`) that holds the agent's durable instructions. It
  lives in `agents/`, is loaded at runtime, and is never hard-coded. The team
  improves it over time.
- **OpenCode wrapper**: the thin `.opencode/agents/retrieval-agent.md` file with
  YAML frontmatter and a body that loads `agents/default.md`, so OpenCode can run
  the agent for direct testing.
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

## Implementation Notes

### What was built

T8.5, T8.6, and T8.8 are complete. T8.1–T8.4 and T8.7 were already done and are
unchanged. T8.9 (the OpenCode wrapper) is CTO-owned.

**T8.5 — Agent resources.**

- Created `agents/default.md` (generic), `agents/slogans.md`, and
  `agents/citations.md`. Each carries the YAML frontmatter (`description`,
  `language`) and the five required body sections.
- Created `src/server/agent/resource.ts` + `resource.test.ts`:
  `AgentResource`, `AgentResourceSummary`, `parseAgentResource`,
  `loadAgentResource`, `listAgentResources`, `AgentSessionCache`,
  `createAgentSessionCache`.
- The frontmatter is parsed with `Bun.YAML.parse` (built in; no new dependency).
- Deleted the superseded `src/server/agent/retrieval-agent.md`,
  `src/server/agent/prompt.ts`, and `src/server/agent/prompt.test.ts`.

**T8.6 — Chat handler.**

- `ChatDependencies` gains `loadAgent`, `agents`, and `defaultAgentId`. The
  handler resolves the resource through `agents.get(sessionId, agentId)` and
  uses `resource.instructions` as the system prompt.
- `agentId` falls back to `defaultAgentId` when the body names none.
- `src/server/index.ts` wires `createAgentSessionCache(loadAgentResource)` and
  `defaultAgentId: process.env.AGENT_ID ?? "default"`.

**T8.8 — Documentation.**

- `README.md` describes the agent behavior and the agent resources, and lists
  `agents/` in the project layout and glossary.
- `.env.sample` documents `AGENT_MAX_STEPS`, `AGENTS_DIR`, and `AGENT_ID`.

### Architectural decisions

- **An agent is data, not code.** A resource is a Markdown document with a YAML
  frontmatter, committed under `agents/` and read at runtime. `resource.ts` is
  the only module that knows the format; nothing in TypeScript hard-codes an
  instruction, and the client never imports `resource.ts`.
- **The loader reads `AGENTS_DIR` at call time.** `loadAgentResource` and
  `listAgentResources` resolve `process.env.AGENTS_DIR ?? "agents"` on each
  call, so a test pins the directory and a deployment can move it.
- **One cache per process, keyed by session.** `createAgentSessionCache(load)`
  keeps one entry per session (`{ agentId, resource }`). A later `get` for the
  same session and agent returns the cached resource; a new session loads again;
  a new agent id replaces the entry.
- **The generic default uses `language: und`.** The format requires a non-empty
  `language`, but the default agent must name no language. `und` is the BCP-47
  code for an undetermined language, so the metadata is honest and the body says
  the agent answers "in the language of the question".

### Deviations from the Contract

1. **`stepCountIs` vs `isStepCount`.** As before, the bundled docs name the stop
   condition `isStepCount`, but `ai@7.0.124` exports `stepCountIs`.
   `bunx tsc --noEmit` accepts `stepCountIs`; the working name is kept.
2. **`onError` is not a `ToolLoopAgent` setting.** Contract §7 now agrees: the
   handler passes `onError` to `createAgentUIStreamResponse`
   (`UIMessageStreamOptions.onError: (error: unknown) => string`). It logs the
   error server-side and returns the generic `"An error occurred."`.
3. **`loadAgent` and `agents` are both dependencies.** The handler uses `agents`
   for resolution; `loadAgent` builds the cache in `index.ts` and is the
   injectable seam for a test. This follows the Contract's dependency list.

### Not done

- T8.9 (OpenCode wrapper) — CTO-owned.
- The manual browser check (T8.7) — CTO/PM-owned.

### Gate output

```text
$ bun fmt
Formatted 0 files, 181 unchanged [14.26ms]

$ bun fmt --check
All 181 files are formatted.

$ bun run lint
$ biome lint .
Checked 109 files in 47ms. No fixes applied.

$ bun test
bun test v1.4.4 (38afee6c8)

 573 pass
 0 fail
 4693 expect() calls
Ran 573 tests across 34 files. [2.74s]

$ bunx tsc --noEmit
(no output)
```

### T8.9 — OpenCode wrapper (CTO)

Updated `.opencode/agents/retrieval-agent.md`: `mode: primary`, a `description`,
and read-only `permissions` (deny `edit`, `write`, `bash`, `subagent`). Its body
now points at the agent resource `agents/default.md` and tells the agent to read
and adopt it. The file is `bun fmt`-clean. The wrapper runs in OpenCode, where the
product tools are not wired, so it is for iterating on the resource's wording,
not for a live search. Loading it in the OpenCode TUI is a manual step for the
CEO/PM.

### Review fixes

Applied the five review items.

1. **Path traversal (Blocker) — fixed.** `resource.ts` now validates the id
   against `/^[a-z0-9][a-z0-9-]*$/` in `assertValidId`, called by both
   `parseAgentResource` and `loadAgentResource` before any file is read. A
   rejected id names the id only; the missing-file error also names the id only
   and never a filesystem path. New tests cover `../README`, `a/b`, `..`, an
   empty id, an uppercase id, and a dotted id, plus two assertions that a
   rejection message contains no path. The chat handler now trims `agentId`, so
   `" default "` resolves; a test covers the trim.
2. **Unused dependency dropped.** `loadAgent` is removed from
   `ChatDependencies` (the Contract no longer lists it). `index.ts` builds the
   cache with `createAgentSessionCache(loadAgentResource)`. `chat.test.ts`
   injects only `agents` and `defaultAgentId`; the recording loader now builds
   the cache.
3. **Cache bounded.** `createAgentSessionCache(load, options?)` takes
   `maxSessions` (default 256) and evicts the least recently used session. New
   tests show the bound keeps a valid session's resource correct and evicts the
   oldest session.
4. **Parsed strings trimmed.** `readRequiredString` trims the returned
   `description` and `language`; a test covers a quoted, padded frontmatter.
5. **Stale term renamed.** `agent.ts` now says "loaded from the agent resource".

Test counts: 580 pass, 0 fail, 4709 expect() calls across 34 files.

```text
$ bun fmt
Formatted 0 files, 181 unchanged [12.67ms]

$ bun fmt --check
All 181 files are formatted.

$ bun run lint
$ biome lint .
Checked 109 files in 49ms. No fixes applied.

$ bun test
bun test v1.4.4 (38afee6c8)

 580 pass
 0 fail
 4709 expect() calls
Ran 580 tests across 34 files. [2.73s]

$ bunx tsc --noEmit
(no output)
```

### Committed agent set

The committed example set is now `agents/default.md` and `agents/citations.md`
only. `agents/slogans.md` is no longer committed, and the file was deleted from
the working tree.

- **`.gitignore`** ignores `agents/*` except `default.md` and `citations.md`,
  with a comment that the other agents are local. A local `slogans.md` is
  ignored by Git (`git check-ignore` confirms the rule).
- **`resource.test.ts` is hermetic.** `loadAgentResource` and
  `listAgentResources` now read a temporary fixture directory created in the
  test (`mkdtempSync`), with known `.md` files (`alpha.md`, `beta.md`), and the
  previous `AGENTS_DIR` is saved and restored around every test. The
  `slogans`-specific test is replaced by a fixture-based "specialized resource"
  test. One integration test still loads the committed `default` resource and
  asserts it is generic and its budget equals `DEFAULT_MAX_STEPS`. No committed
  test depends on a local resource.
- **`README.md`** lists only `default.md` and `citations.md` as committed
  examples and states that every other file under `agents/` is local and ignored
  by Git. The `agents/slogans.md` mention is removed.
- **`chat.test.ts`** uses `citations` instead of `slogans` as its arbitrary
  agent id, so no committed test names the removed resource.

Gate output after the change:

```text
$ bun fmt
Formatted 0 files, 180 unchanged [13.25ms]

$ bun fmt --check
All 180 files are formatted.

$ bun run lint
$ biome lint .
Checked 109 files in 46ms. No fixes applied.

$ bun test
bun test v1.4.4 (38afee6c8)

 578 pass
 0 fail
 4710 expect() calls
Ran 578 tests across 34 files. [2.83s]

$ bunx tsc --noEmit
(no output)
```

### Default weights exclude the syntax index

`DEFAULT_WEIGHTS` changed from `{ syntax: 0.5, semantic: 0.3, keyword: 0.2 }` to
`{ semantic: 0.5, keyword: 0.5 }`. The agent never selects the `ast` index until
the multi-vector syntax search is operational, so a search cannot fail on a
missing syntax state. The Contract §7 and the Known limitation are updated. The
`GET /api/slogans` surface is unaffected: it takes explicit weights per request.
