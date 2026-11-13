# T0013 — Fix the chat interface defects

- **Track**: Chat interface and agent session lifecycle
- **Wave**: 1 (independent)
- **Status**: done
- **Owner**: coding sub-agent, supervised by CTO
- **Started**: 2026-11-13
- **Depends on**: nothing
- **Blocks**: nothing
- **References**:
  - `src/components/pages/ChatPage.tsx`, `src/components/pages/ChatPage.css` — the
    page that composes the header and the two columns.
  - `src/components/app/ChatPanel.tsx`, `src/components/app/ChatPanel.css` — the
    conversation, the composer, and the `useChat` hook.
  - `src/components/app/SourcesPanel.tsx`, `src/components/app/SourcesPanel.css` —
    the source list to move and rewrite.
  - `src/components/app/RetrievalPanel.tsx`, `src/components/app/RetrievalHit.tsx`,
    `src/components/app/RetrievalHit.css` — the dead panel to delete.
  - `src/components/app/MessageBubble.tsx`, `src/components/app/MessageBubble.css` —
    the assistant bubble that shows the turn status.
  - `src/components/app/ToolActivity.tsx`, `src/components/app/ToolActivity.css` —
    the standalone activity notice to delete.
  - `src/server/agent/sources.ts` — `collectSources` and `AgentSource`.
  - `src/server/agent/turn-status.ts` — the turn status derivation (new).
  - `src/server/agent/session-store.ts` — `SearchSessionStore`, `CachedSearch`.
  - `src/server/chat.ts` — `createChatHandler`, the `POST /api/chat` stream.
  - `src/components/AGENTS.md` — the component rules (no UI tests, layout
    primitives, ids for regions).
  - Vercel AI SDK, installed `ai@7.0.124`:
    - `useChat` options (`id`, `generateId`) and `setMessages`:
      <https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat>; local copy
      `node_modules/ai/docs/07-reference/02-ai-sdk-ui/01-use-chat.mdx`.
    - `UIMessageStreamOptions.onEnd`, the end-of-stream callback: local copy
      `node_modules/ai/docs/07-reference/01-ai-sdk-core/02-stream-text.mdx`
      (the `toUIMessageStream` options table).
    - `createAgentUIStreamResponse` accepts `...UIMessageStreamOptions`: local
      copy
      `node_modules/ai/docs/07-reference/01-ai-sdk-core/18-create-agent-ui-stream-response.mdx`.

## Context & Goal

The first proof of concept works, but the chat screen carries four defects and
one server-side leak.

1. **A useless toggle.** `label#page-toggle` holds a checkbox that shows or hides
   the right column (`ChatPage.tsx:49-58`, state `isRetrievalVisible`). It has no
   value for the user.
2. **A dead right column.** `RetrievalPanel` calls `GET /api/slogans?q=…&topK=5`
   and reads `{ results: SloganHit[] }`. Since the weighted API replaced the old
   contract, `topK` is an obsolete parameter: `src/server/api.ts:74` rejects it
   with a `400`, and the response shape changed. The panel therefore always shows
   "La recherche a échoué". It also searches **on its own**, independently of what
   the agent actually queried. It must be replaced by the real agent activity.
3. **No way to start over.** There is no control that clears the conversation.
4. **A server-side leak.** When the agent continues a search, the tool caches a
   **binding** (the query parameters and the retrieval cursor) in the per-session
   store. The store never drops it during normal use: it survives until the
   30-minute time-to-live or the 256-entry bound evicts it. Once the agent has
   assembled its answer, those bindings are dead weight.
5. **No progress feedback.** While the agent works, the user sees nothing: the
   assistant bubble renders only once text exists (`ChatPanel.tsx:107-117`), and a
   standalone notice shows a single, generic line. The bubble must show the turn's
   real state: thinking, data fetching, then merging the results.

"Done" means: the toggle is gone; the right column shows, grouped by query, the
searches the agent really ran and the sources each returned, and it resets on each
new question; a "Nouvelle session" button clears the conversation; the assistant
bubble names the turn state in French while the answer is being built; and the
server drops a session's cached searches as soon as the agent's answer is
finalized.

## Scope Boundary

Create, modify, or delete **only** these paths.

### May create

- `src/server/agent/turn-status.ts` and `turn-status.test.ts`.

### May modify

- `src/components/pages/ChatPage.tsx` and `ChatPage.css`.
- `src/components/app/ChatPanel.tsx` and `ChatPanel.css`.
- `src/components/app/SourcesPanel.tsx` and `SourcesPanel.css`.
- `src/components/app/MessageBubble.tsx` and `MessageBubble.css`.
- `src/components/layout/Grid.tsx` — the JSDoc example only.
- `src/components/ui/Panel.tsx` — the JSDoc example id only.
- `src/components/AGENTS.md` and `src/components/README.md` — the component
  references.
- `DESIGN.md` — the right-column component entry.
- `src/server/agent/sources.ts` and `sources.test.ts`.
- `src/server/agent/session-store.ts` and `session-store.test.ts`.
- `src/server/agent/tools.test.ts` — test-only, so the fake stores satisfy the new
  `clear` member.
- `src/server/chat.ts` and `chat.test.ts`.
- `tickets/README.md` — the board.

### May delete

- `src/components/app/RetrievalPanel.tsx`.
- `src/components/app/RetrievalHit.tsx`.
- `src/components/app/RetrievalHit.css`.
- `src/components/app/ToolActivity.tsx`.
- `src/components/app/ToolActivity.css`.

### Must not touch

- `src/lib/**` — the retrieval library and its contract.
- `src/server/api.ts` and the `GET /api/slogans` surface.
- `src/server/agent/tools.ts`, `agent.ts`, `resource.ts` — the tool contract is
  unchanged.
- `agents/**`, `design-tokens.css`, `color-variants.css`, the root `AGENTS.md`,
  `.agents/**`.
- `node_modules/**`, except the documented `node_modules/ai/docs/**` tree.

## Contract

Every unit and integration test is written against this section.

### 1. The session store drops a session's searches

Add one method to `SearchSessionStore` (`src/server/agent/session-store.ts`):

```ts
/** In-memory store of the searches that a conversation can continue. */
export type SearchSessionStore = {
  /** Cache one search for a session and return its opaque token. */
  save: (sessionId: string, search: CachedSearch) => string;
  /** Read one cached search. Returns `undefined` for an unknown, foreign, or expired token. */
  read: (sessionId: string, token: string) => CachedSearch | undefined;
  /** Replace the cached retrieval cursor after a page is read. */
  update: (sessionId: string, token: string, cursor: string | undefined) => void;
  /** Drop every cached search owned by the session. */
  clear: (sessionId: string) => void;
};
```

Invariants, each with a test:

- After `clear(sessionId)`, `read(sessionId, token)` returns `undefined` for every
  token the session saved.
- `clear(sessionId)` never removes an entry owned by another session: a token
  saved by session `A` still reads under session `A` after `clear("B")`.
- `clear` on a session that saved nothing is a no-op.
- `clear` does not touch the entry count of unrelated sessions and never throws.

### 2. The chat handler clears the session at the end of the turn

`createChatHandler` passes an `onEnd` callback to
`createAgentUIStreamResponse` (`src/server/chat.ts`). The documented option is a
member of `UIMessageStreamOptions`:

```ts
onEnd: (options: {
  messages: UIMessage[];
  isContinuation: boolean;
  responseMessage: UIMessage;
  isAborted: boolean;
  isCancelled?: true;
  outcome: UIMessageStreamOutcome;
  finishReason?: FinishReason;
}) => PromiseLike<void> | void;
```

Source: `node_modules/ai/docs/07-reference/01-ai-sdk-core/02-stream-text.mdx`
(`UIMessageStreamOptions`, the `toUIMessageStream` options table), and
`createAgentUIStreamResponse` accepts `...UIMessageStreamOptions`
(`node_modules/ai/docs/07-reference/01-ai-sdk-core/18-create-agent-ui-stream-response.mdx`).

The handler passes:

```ts
onEnd: () => {
  dependencies.sessions.clear(sessionId);
};
```

It ignores the callback options. Invariants, each with a test:

- When the stream ends after a completed turn, the session's cached searches are
  gone: a later `fetchNextPage` with a cursor from that turn returns the
  `the cursor is unknown or has expired` error.
- When the client aborts or cancels the stream, the session's cached searches are
  still gone.
- `onEnd` clears only the current `sessionId`; another session's cached searches
  survive.

### 3. The turn-scoped activity collector

`src/server/agent/sources.ts` gains one pure function and one type. It reads the
**current turn** only: the tool parts that follow the last `user` message.

```ts
/** One tool call the agent ran in the current turn. */
export type TurnQuery = {
  /** Tool that ran. */
  tool: "searchRecords" | "fetchNextPage";
  /** Search text for `searchRecords`; an empty string for `fetchNextPage`. */
  query: string;
  /** Sources the call returned, in the order the tool returned them. */
  sources: AgentSource[];
};

/** Collect the tool activity of the last turn. */
export const collectTurnActivity: (messages: UIMessage[]) => TurnQuery[];
```

Rules, each with a test:

- The function reads only the parts after the last message whose `role` is `user`.
  A tool call from an earlier turn is not returned.
- Each `output-available` part of type `tool-searchRecords` or `tool-fetchNextPage`
  becomes one `TurnQuery`, in message order.
- For `searchRecords`, `query` is the part input's `query` string, trimmed; an
  absent or non-string input yields `""`.
- For `fetchNextPage`, `query` is `""` (its input carries only a cursor).
- A part whose output is an error object (`{ error }` instead of `{ results }`) is
  skipped.
- No user message, or no tool part after it, yields `[]`.

`collectSources` becomes unused once the UI stops calling it. Remove it when
nothing imports it, and move its behaviour into `collectTurnActivity`. Keep the
per-call source order; do not deduplicate across calls.

### 4. The sources panel, grouped by query

`SourcesPanel` (`src/components/app/SourcesPanel.tsx`) is rewritten to take the
turn activity and render it grouped:

```ts
/** Props of the source list. */
export interface SourcesPanelProps {
  /** Tool calls of the current turn, in order. */
  queries: TurnQuery[];
}
```

- The panel keeps its region id `#sources-panel` and moves to the right column of
  the page grid.
- For each `TurnQuery`, it shows a group: a label and the sources that call
  returned.
  - The label is the `query` text for `searchRecords`.
  - The label is a continuation marker, "Suite (page suivante)", for
    `fetchNextPage`.
  - Each source row keeps the current shape: brand and year, then the slogan.
- An empty `queries` list shows the empty state "Aucune recherche pour l'instant."
- The panel resets on each new question, because `queries` is derived from the
  last turn only (section 3).
- Every element is composed from the kit (`VStack`, `HStack`, `Heading`, `Text`,
  `Panel`). No raw layout element. Region rules stay scoped under `#sources-panel`.

### 5. The page owns the conversation

`ChatPage` (`src/components/pages/ChatPage.tsx`) owns the `useChat` hook and
derives the turn activity:

- `ChatPage` calls `useChat<RetrievalAgentUIMessage>({ transport })` with the same
  `DefaultChatTransport({ api: "/api/chat" })` the panel uses today.
- It computes `queries = collectTurnActivity(messages)` and passes `queries` to
  `SourcesPanel`.
- It removes `#page-toggle`: the checkbox, the `isRetrievalVisible` state, and the
  `#page-toggle` rule in `ChatPage.css`.
- It adds a "Nouvelle session" button in the header, built from `ui/Button`. Its
  handler calls `setMessages([])`.
- `ChatPanel` becomes presentational: it receives the conversation state and the
  two actions from `ChatPage`, and keeps its composer draft locally. It no longer
  calls `useChat` and no longer calls `onQuestionAsked`.

### 6. The assistant turn status line

A new pure module `src/server/agent/turn-status.ts` derives the state of the turn
in flight from the chat status and the messages:

```ts
/** The `status` value that `useChat` reports. */
export type ChatStatus = "submitted" | "streaming" | "ready" | "error";

/** The coarse state of the assistant turn in flight. */
export type TurnStatus = "thinking" | "fetching" | "merging" | "answering";

/** Derive the state of the turn in flight. */
export const readTurnStatus: (status: ChatStatus, messages: UIMessage[]) => TurnStatus;
```

Rules, each with a test:

- `status === "submitted"` → `"thinking"`.
- `status === "streaming"`, in this order, on the last message:
  - it holds a text part with non-empty text → `"answering"`;
  - else it holds a tool part in state `input-available` → `"fetching"`;
  - else it holds a tool part in state `output-available` → `"merging"`;
  - else → `"thinking"`.
- `status === "ready"` or `status === "error"` → `"answering"` (idle; the caller
  hides the line).
- A `tool-` part in state `input-streaming` (arguments still arriving) is not
  `"fetching"`; the function falls through to `"thinking"`.

The UI maps each state to a French label, in `MessageBubble.tsx`:

| `TurnStatus` | Label                                |
| ------------ | ------------------------------------ |
| `thinking`   | "Réflexion…"                         |
| `fetching`   | "Récupération des données…"          |
| `merging`    | "Fusion des résultats…"              |
| `answering`  | no line; the Markdown answer renders |

`MessageBubble` gains one optional prop:

```ts
/** Turn state to show while the answer is being built. */
status?: TurnStatus;
```

- For an assistant bubble, when `status` is `thinking`, `fetching`, or `merging`,
  the bubble shows the label instead of the Markdown body.
- When `status` is `answering` or absent, the bubble renders the Markdown body as
  today.
- `ChatPanel` renders the assistant bubble for the in-flight turn even when it has
  no text yet, so the label appears as soon as the turn starts (including
  `submitted`, before any assistant message exists).
- The standalone `ToolActivity` notice is removed; `ToolActivity.tsx` and
  `ToolActivity.css` are deleted.

### 7. The AI SDK surface, quoted

- `useChat` options (`node_modules/ai/docs/07-reference/02-ai-sdk-ui/01-use-chat.mdx`):

  ```ts
  id?: string; // "If not provided, a random one will be generated."
  setMessages: (messages: UIMessage[] | ((messages: UIMessage[]) => UIMessage[])) => void;
  // "Function to update the messages state locally without triggering an API call."
  ```

  The chat `id` is sent in the request body; `createChatHandler` reads it as the
  `sessionId` (`src/server/chat.ts:99`). This ticket keeps the same `sessionId`
  after "Nouvelle session", because the server now clears its own state at the end
  of every turn (section 2).

- `useChat` status (`node_modules/ai/docs/07-reference/02-ai-sdk-ui/01-use-chat.mdx`):

  ```ts
  status: "submitted" | "streaming" | "ready" | "error";
  // "ready" (idle), "submitted" (request sent), "streaming" (receiving response),
  // or "error" (request failed).
  ```

- Tool part states (`node_modules/ai/docs/04-ai-sdk-ui/03-chatbot-tool-usage.mdx`):
  `input-streaming`, `input-available`, `output-available`, `output-error`.

- `onEnd` (section 2): a member of `UIMessageStreamOptions`, accepted by
  `createAgentUIStreamResponse`.

## TDD Tasks

- [x] **T13.1 — Store clear**: write failing tests for `clear(sessionId)` — it
      drops the session's own entries, keeps another session's entries, and is a
      no-op on an unknown session — then implement it. Files:
      `src/server/agent/session-store.ts`, `src/server/agent/session-store.test.ts`.
      Depends on: nothing.
- [x] **T13.2 — End-of-turn cleanup**: write failing tests that the chat handler
      clears the session store when the stream ends — a completed turn, an aborted
      stream, and a cancelled stream — then pass `onEnd` to
      `createAgentUIStreamResponse`. Files: `src/server/chat.ts`,
      `src/server/chat.test.ts`. Depends on: T13.1.
- [x] **T13.3 — Turn collector**: write failing tests for `collectTurnActivity` —
      the last-turn boundary, a `searchRecords` query, a `fetchNextPage`
      continuation, a skipped error output, and an empty result — then implement
      it and remove `collectSources` when nothing imports it. Files:
      `src/server/agent/sources.ts`, `src/server/agent/sources.test.ts`. Depends
      on: nothing.
- [x] **T13.4 — UI**: lift `useChat` into `ChatPage`; derive `queries`; rewrite
      `SourcesPanel` grouped by query; remove `#page-toggle`; add the "Nouvelle
      session" button; delete `RetrievalPanel`, `RetrievalHit`, and
      `RetrievalHit.css`. Files: `src/components/pages/ChatPage.tsx`,
      `ChatPage.css`, `src/components/app/ChatPanel.tsx`, `ChatPanel.css`,
      `src/components/app/SourcesPanel.tsx`, `SourcesPanel.css`. Depends on:
      T13.3. Verify by `bunx tsc --noEmit` and a manual check: no component rule
      is broken, no import of a deleted file remains.
- [x] **T13.5 — Turn status**: write failing tests for `readTurnStatus` — the
      `submitted` state, a streaming turn with text, a tool part in
      `input-available`, a tool part in `output-available`, an `input-streaming`
      fall-through, and the `ready`/`error` idle state — then implement it. Add
      the `status` prop and the French labels to `MessageBubble`, render the
      in-flight assistant bubble in `ChatPanel`, and delete `ToolActivity`. Files:
      `src/server/agent/turn-status.ts`, `turn-status.test.ts`,
      `src/components/app/MessageBubble.tsx`, `MessageBubble.css`,
      `src/components/app/ChatPanel.tsx`, `ChatPanel.css`. Depends on: T13.4.
- [x] **T13.6 — Reference cleanup**: remove every reference to a deleted component.
      Fix the `Grid` JSDoc example, the `src/components/AGENTS.md` example, the
      `src/components/README.md` folder list and prose, and the `DESIGN.md`
      right-column entry (load the `design-system-tokens` skill; keep the entry
      valid and name the component that exists). Files:
      `src/components/layout/Grid.tsx`, `src/components/AGENTS.md`,
      `src/components/README.md`, `DESIGN.md`. Depends on: T13.5.
- [x] **T13.7 — Gates**: run the gates in this order and paste the exact output
      into the Implementation Notes:

  ```sh
  bun fmt
  bun fmt --check
  bun run lint
  bun test
  bunx tsc --noEmit
  ```

  Depends on: T13.6.

## Acceptance Criteria

1. `#page-toggle` is gone: no checkbox, no `isRetrievalVisible` state, no
   `#page-toggle` rule in `ChatPage.css`.
2. `RetrievalPanel`, `RetrievalHit`, `RetrievalHit.css`, `ToolActivity`, and
   `ToolActivity.css` are deleted, and no reference to them remains anywhere:
   source, import, JSDoc example, `README.md`, `AGENTS.md`, or `DESIGN.md`.
3. The right column renders `SourcesPanel`, grouped by query: each group shows the
   tool's query (or the continuation marker) and the sources that call returned.
   The panel resets on each new user question.
4. The "Nouvelle session" button clears the conversation and the sources panel.
5. While the agent builds its answer, the assistant bubble shows the French turn
   state: "Réflexion…" (thinking), "Récupération des données…" (data fetching), then
   "Fusion des résultats…" (merging). The line disappears when the answer text
   streams.
6. When the agent's turn is finalized, the session's cached searches are dropped.
   A `fetchNextPage` that reuses a cursor from a finished turn returns the
   unknown-cursor error instead of a page. Abort and cancellation also drop them.
7. `collectTurnActivity` reads only the last turn, and `readTurnStatus` follows the
   mapping in section 6.
8. No component rule is broken: layout primitives only, region rules scoped under
   their id, tokens only, no `border-radius` or `box-shadow`.
9. `bun fmt --check`, `bun run lint`, `bun test`, and `bunx tsc --noEmit` all pass.

## Risks and mitigations

| Risk                                                           | Impact                         | Mitigation                                                                                                                               |
| -------------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `onEnd` is not accepted by `createAgentUIStreamResponse`       | The lifecycle rule cannot wire | The option is documented in `UIMessageStreamOptions`; if the type rejects it, the coder **stops** and reports, and never works around it |
| Clearing at the end of a turn breaks a cross-turn continuation | A reused cursor fails          | Intended: the binding must not outlive the turn. The tool already returns an error object, so the model recovers by searching again      |
| Lifting `useChat` restructures `ChatPanel`                     | A display regression           | `ChatPanel` becomes presentational; the front-end has no test seam, so a manual check and `bunx tsc --noEmit` cover it                   |
| `fetchNextPage` has no query text in its input                 | An ambiguous group label       | The group is labelled "Suite (page suivante)"                                                                                            |
| The turn status is derived from client-observable states only  | A phase may be brief           | The mapping reads `status` and the tool part states; no server progress event is added, so no server change is needed                    |

## Glossary

- **Binding**: the cached search a conversation can continue — the query
  parameters (text, weights, min score, candidate limit) plus the retrieval
  cursor. `SearchSessionStore` holds one per saved search, under an opaque token.
- **Candidate**: one record that Qdrant returns for one index. A bounded query
  returns a candidate set, not the whole collection.
- **Turn**: one user question and the assistant answer it produces, including the
  tool calls the agent runs to build that answer. One `POST /api/chat` request is
  one turn.
- **Turn status**: the coarse phase of the turn in flight — `thinking`, `fetching`,
  `merging`, or `answering` — derived on the client from the chat status and the
  tool part states.
- **`onEnd`**: the documented callback of `UIMessageStreamOptions` that runs when
  the response stream ends, whether it completed, aborted, or was cancelled.
- **Session**: the identity a conversation carries, read from the request body's
  `id` (`src/server/chat.ts:99`). It keys the per-session agent cache and the
  search session store.

## Implementation Notes

### Architectural decisions

- **Session store clear (T13.1).** `clear(sessionId)` iterates the entry map and
  deletes every entry whose `sessionId` matches. The entry map is keyed by token,
  so a scan is the only way to find a session's entries. The scan is bounded by
  the entry-count limit, so it stays cheap.
- **End-of-turn cleanup (T13.2).** `createChatHandler` passes
  `onEnd: () => { dependencies.sessions.clear(sessionId); }` to
  `createAgentUIStreamResponse`. The callback ignores its options. The AI SDK
  invokes it when the UI message stream ends, whether the turn completed, the
  request aborted, or the consumer cancelled. This is the documented member of
  `UIMessageStreamOptions`
  (`node_modules/ai/docs/07-reference/01-ai-sdk-core/02-stream-text.mdx`, the
  `toUIMessageStream` options table). `createAgentUIStreamResponse` accepts
  `...UIMessageStreamOptions`
  (`node_modules/ai/docs/07-reference/01-ai-sdk-core/18-create-agent-ui-stream-response.mdx`).
  The installed type accepts `onEnd` with no change, so no workaround was needed.
- **Turn collector (T13.3).** `collectTurnActivity` finds the last `user` message
  with `findLastIndex` and reads only the messages after it. It returns one
  `TurnQuery` per `output-available` tool part, in message order, and keeps the
  per-call source order. `collectSources`, its dedup map, and its `compareId`
  helper are removed because nothing imports them after the UI rewrite.
- **UI ownership (T13.4).** `ChatPage` owns `useChat` and derives
  `queries = collectTurnActivity(messages)`. `ChatPanel` is presentational: it
  receives `messages`, `status`, `error`, `onSend`, and `onStop`, and keeps only
  the composer draft. `SourcesPanel` groups by `TurnQuery`. The `#page-toggle`
  checkbox, its state, and its CSS rule are removed. The "Nouvelle session"
  button calls `setMessages([])`. `RetrievalPanel`, `RetrievalHit`,
  `RetrievalHit.css`, `ToolActivity`, and `ToolActivity.css` are deleted.
- **Turn status (T13.5).** `turn-status.ts` is a pure module. `readTurnStatus`
  maps `submitted` to `thinking`, an idle `ready`/`error` to `answering`, and a
  streaming turn from the last message: answer text first, then a tool part in
  `input-available`, then a tool part in `output-available`, else `thinking`.
  `MessageBubble` maps `thinking`, `fetching`, and `merging` to the French
  labels and hides the line for `answering`. `ChatPanel` renders the in-flight
  assistant bubble even before text arrives, including the `submitted` phase
  before any assistant message exists.
- **Cancellation test timing.** The stream teardown that runs `onEnd` settles
  after a few event-loop turns. The cancelled-stream test waits for the
  observable store state with a bounded `until` helper instead of a fixed delay.
  The test stays hermetic: it awaits event-loop turns, not wall-clock time.

### Deviations from the Scope Boundary

- **`src/server/agent/tools.test.ts` was modified.** The Contract makes `clear` a
  required member of `SearchSessionStore`. That member is additive, but the eight
  fake stores in `tools.test.ts` did not satisfy the new type, so
  `bunx tsc --noEmit` failed. I added `clear: () => {}` to the shared
  `createFakeSessions` helper and to the seven inline fake stores. The change is
  test-only and mechanical. The updated Scope Boundary now lists this file.
- **`src/components/ui/Panel.tsx` was modified (JSDoc only).** Its `@example`
  named `id="retrieval-panel"`, a region of the deleted panel. Acceptance
  criterion 2 forbids any reference to a deleted component, including a JSDoc
  example, so I changed the id to `sources-panel`. The updated Scope Boundary now
  lists this file under "May modify" (JSDoc example only), so the edit is in
  scope.
- **`memos/README.md` is not part of this ticket.** The working tree already held
  an uncommitted edit to that file before this session. `bun fmt` formats the
  whole project, so it reformatted the file as a side effect. I did not author
  the content change and did not revert it, because reverting would discard the
  earlier uncommitted work. The CTO should decide what to do with that file.

### Reference cleanup

The ticket deletes `RetrievalPanel`, `RetrievalHit`, and `ToolActivity`. The
PascalCase component names no longer appear outside `tickets/`. The lowercase
region ids of the deleted components (`retrieval-panel`, `retrieval-hit`) and the
shared class (`retrieval-hit`) are also gone from the component tree.

- `src/components/layout/Grid.tsx` — the `@example` now names `<SourcesPanel />`,
  the component that fills the second grid column.
- `src/components/AGENTS.md` — the REQUIRED example now composes `VStack` and
  `Text`. The region-id example now reads `#sources-panel` and the shared-class
  example now reads `.source-item`, so neither names a deleted region.
- `src/components/README.md` — the `app/` folder list now names `ChatPanel`,
  `MessageBubble`, `MarkdownText`, and `SourcesPanel`. The "list row" sentence
  now reads "A chat message is `MessageBubble`". The prose now describes
  `SourcesPanel` grouping by the search that returned it and `MessageBubble`
  showing the in-bubble turn status. The `source` glossary entry matches. The
  region-id example now reads `#sources-panel`.
- `DESIGN.md` — the front-matter `components:` entry `RetrievalPanel` is renamed
  to `SourcesPanel` with the same `--color-surface-card` background and
  `--color-surface-alt` border. No token was added or renamed.
- `src/components/ui/Panel.tsx` — the JSDoc `@example` id now reads
  `sources-panel`.

The verification grep returns no match outside `tickets/`. The PascalCase check
covers the component names:

```text
$ grep -rn "RetrievalPanel\|RetrievalHit\|ToolActivity" \
    --include=*.ts --include=*.tsx --include=*.md --include=*.css . \
    --exclude-dir=node_modules --exclude-dir=.git | grep -v '^\./tickets/'
# (no output)

$ grep -rn "retrieval-panel\|retrieval-hit\|tool-activity" \
    --include=*.ts --include=*.tsx --include=*.md --include=*.css . \
    --exclude-dir=node_modules --exclude-dir=.git | grep -v '^\./tickets/'
# (no output)
```

The lowercase check still matches the historical tickets under `tickets/done`,
which this ticket does not touch.

### Review fixes

The independent review returned POLISH_REQUIRED with no blocker. Three fixes:

- **Stale comments in `src/components/app/ChatPanel.css`.** The header comment
  said the rules cannot reach "the retrieval panel", which no longer exists. It
  now says "so nothing here can reach the page". The `#chat-panel-messages`
  comment said "The only scrolling area on the page", which became false when
  `#sources-panel` gained its own scroll. It now says "The conversation scrolls
  on its own, as the source list does".
- **The abort test now isolates the abort path.** The old test aborted after the
  handler returned, so `onEnd` could have fired on normal completion. The test
  now drives the handler with `openStreamModel`, a mock whose stream emits text
  but no `finish` chunk and never closes. It reads one chunk to confirm the turn
  is streaming, aborts, and waits for the session token to disappear. A prove-it
  run with `onEnd` removed made the test fail, so completion cannot explain the
  cleanup. The completed-turn and client-cancel tests are unchanged.
- **The abort test avoids an undeclared import.** An earlier revision typed the
  stream with `LanguageModelV4StreamPart` from `@ai-sdk/provider`, which is only
  a transitive dependency of `ai` and is not declared in `package.json`. The
  test now relies on contextual typing: `MockLanguageModelV4` types the
  `doStream` return value, so `new ReadableStream(...)` is inferred as
  `ReadableStream<LanguageModelV4StreamPart>` without naming the type. No
  dependency was added and no undeclared package is imported.
- **This note now matches the actual grep**, and the `Panel.tsx` deviation is
  recorded as in scope because the Scope Boundary now lists the file.

### JSDoc

Every JSDoc block touched by the change matches the new behaviour:
`SearchSessionStore` documents `clear`; `sources.ts` documents `TurnQuery` and
`collectTurnActivity` and no longer documents `collectSources`; `turn-status.ts`
documents its types and `readTurnStatus`; `SourcesPanelProps`, `MessageBubbleProps`
(the `status` prop), and `ChatPanelProps` document their props; `ChatPage`
documents the header button and the owned hook. The module headers of
`sources.ts` and `chat.ts` were updated where the old sentence no longer held.

### Gate output

```text
===== bun fmt =====
Formatted 0 files, 179 unchanged [14.20ms]
exit=0
===== bun fmt --check =====
All 179 files are formatted.
exit=0
===== bun run lint =====
$ biome lint .
Checked 109 files in 49ms. No fixes applied.
exit=0
===== bun test =====
bun test v1.4.4 (38afee6c8)

 608 pass
 0 fail
 4740 expect() calls
Ran 608 tests across 35 files. [3.31s]
exit=0
===== bunx tsc --noEmit =====
exit=0
```
