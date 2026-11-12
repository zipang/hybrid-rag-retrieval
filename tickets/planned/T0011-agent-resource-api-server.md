# T0011 — Agent resource API server

- **Track**: Agent resources
- **Wave**: 2 (integration — serves the resources that T0008 loads)
- **Status**: planned
- **Depends on**: T0008
- **Blocks**: nothing
- **References**:
  - `tickets/in_progress/T0008-conversational-retrieval-agent.md` — owns the
    resource layer: the `agents/` directory, `AgentResource`,
    `loadAgentResource`, and `listAgentResources`. This ticket waits for it.
  - `src/server/agent/resource.ts` — the loader and the types this ticket serves.
  - `src/server/api.ts` — `ApiError`, `CORS_HEADERS`, `jsonResponse`.
  - `src/server/index.ts` — the Bun route table.
  - `AGENTS.md` — the project rules.

## Context & Goal

An agent is a resource: a Markdown document with a YAML frontmatter, loaded at
runtime from the `agents/` directory. T0008 owns that resource layer and uses it
for the chat. This ticket exposes the same resources over HTTP, so any client —
the browser, an external tool, a test — can list the available agents and read
one.

"Done" means: `GET /api/retrieval-agents` lists every resource as a summary, and
`GET /api/retrieval-agents/<id>` returns one full resource, using the loader that
T0008 delivers. The endpoint adds no new resource format; it is a thin HTTP
surface over `loadAgentResource` and `listAgentResources`.

## Scope Boundary

Create or modify **only** these paths.

### May create

- `src/server/agents.ts`, `src/server/agents.test.ts` — the handler factory.

### May modify

- `src/server/index.ts` — add the two routes.
- `README.md` — document the two endpoints.

### Must not touch

- `src/server/agent/**` — owned by T0008. This ticket imports from it, never
  edits it.
- `src/server/chat.ts` and `src/server/chat.test.ts` — owned by T0008.
- `agents/**` — the resources themselves. This ticket serves them; it does not
  change them.
- `src/lib/**`, `src/components/**`, `DESIGN.md`, `design-tokens.css`,
  `color-variants.css`, the root `AGENTS.md`, `.agents/**`, `skills-lock.json`.
- `node_modules/**`, except the documented `node_modules/ai/docs/**` tree.

### Append-only shared files

- `src/server/index.ts` — add routes; do not remove or reorder the existing ones.

## Contract

Every unit and integration test is written against this section.

### 1. The resource layer this ticket serves

From `src/server/agent/resource.ts` (T0008). Source: the T0008 Contract §6.

```ts
/** One agent resource: a Markdown document with a YAML frontmatter. */
export type AgentResource = {
  id: string;
  description: string;
  language: string;
  instructions: string;
};

/** Listing form of a resource, without the body. */
export type AgentResourceSummary = Pick<AgentResource, "id" | "description" | "language">;

/** Read one resource from `AGENTS_DIR`. Throws when the file is missing. */
export const loadAgentResource: (id: string) => AgentResource;

/** List the available resources, sorted by id. */
export const listAgentResources: () => AgentResourceSummary[];
```

### 2. The handler

```ts
/** Dependencies of the agents endpoint. Tests inject fakes. */
export type AgentsDependencies = {
  /** Read one resource by id. */
  loadAgent: (id: string) => AgentResource;
  /** List the available resources. */
  listAgents: () => AgentResourceSummary[];
};

/** Create the agents endpoint handler. */
export const createAgentsHandler: (dependencies: AgentsDependencies) => (request: Request) => Promise<Response>;
```

Rules, each with a test:

- `GET /api/retrieval-agents` returns `200` with the JSON array from
  `listAgents()`.
- `GET /api/retrieval-agents/<id>` returns `200` with the JSON object from
  `loadAgent(id)`.
- An unknown id returns `404` with a JSON error body. `loadAgent` throws for an
  unknown id; the handler maps that throw to `404` and never leaks the internal
  message.
- `OPTIONS` returns `204` with `CORS_HEADERS`.
- A method other than `GET` or `OPTIONS` returns `405`.
- The handler reads the id from the path segment after `/api/retrieval-agents/`.
  An empty id (a trailing slash) returns `404`.
- The handler never throws; every failure becomes a JSON response.

Use `jsonResponse`, `CORS_HEADERS`, and `ApiError` from `src/server/api.ts`
(quoted below), so the CORS and the error shape match the rest of the API.

```ts
/** CORS headers for the JSON API. */
export const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type"
};

/** Build a JSON response with the CORS headers. */
export const jsonResponse: (body: unknown, status?: number) => Response;

/** An API error with an HTTP status and a client message. */
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string);
}
```

### 3. The routes

`src/server/index.ts` adds:

```ts
routes: {
  "/api/retrieval-agents": (request) => agents(request),
  "/api/retrieval-agents/:id": (request) => agents(request)
}
```

The handler is built once, with the real loader:
`createAgentsHandler({ loadAgent: loadAgentResource, listAgents: listAgentResources })`.

## TDD Tasks

- [ ] **T11.1 — Handler**: write failing tests with fake `loadAgent` and
      `listAgents` — the list body, the single body, an unknown id `404`,
      `OPTIONS` `204`, a non-`GET` method `405`, an empty id `404`, and no throw
      on failure — then implement `createAgentsHandler`. Files:
      `src/server/agents.ts`, `src/server/agents.test.ts`. Verify:
      `bun test src/server/agents.test.ts`. Depends on: T0008.
- [ ] **T11.2 — Routes and documentation**: wire the two routes in
      `src/server/index.ts` and document the endpoints in `README.md`. Files:
      `src/server/index.ts`, `README.md`. Verify: a manual `curl` of both
      endpoints. Depends on: T11.1.
- [ ] **T11.3 — Gates**: run the gates in this order and paste the exact output
      into the Implementation Notes:

  ```sh
  bun fmt
  bun fmt --check
  bun run lint
  bun test
  bunx tsc --noEmit
  ```

  Depends on: T11.2.

## Acceptance Criteria

1. `GET /api/retrieval-agents` returns `200` and a JSON array of summaries, one
   per resource in `AGENTS_DIR`.
2. `GET /api/retrieval-agents/<id>` returns `200` and the full resource for a
   known id.
3. An unknown id returns `404` with a JSON error body.
4. `OPTIONS` returns `204`; a non-`GET` method returns `405`.
5. The handler never throws, and no internal error message or secret reaches the
   client.
6. `src/server/agent/**`, `src/server/chat.ts`, and `agents/**` are unchanged.
7. `bun fmt --check`, `bun run lint`, `bun test`, and `bunx tsc --noEmit` all
   pass.

## Glossary

- **Agent resource**: one Markdown document with a YAML frontmatter that holds an
  agent's instructions. It lives in `agents/` and is loaded at runtime.
- **`AGENTS_DIR`**: the environment variable that names the resource directory.
  Its default is `agents/`.
- **Loader**: the function `loadAgentResource` that reads one resource from disk
  and validates it.
- **Summary**: the `id`, `description`, and `language` of a resource, without its
  body. The list endpoint returns summaries.
