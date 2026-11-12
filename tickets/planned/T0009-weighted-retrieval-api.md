# T0009 — Weighted multi-vector retrieval API and HTTP surface

- **Track**: Retrieval and API
- **Wave**: 1 (independent — builds on the syntax index that T0004 delivered)
- **Status**: planned
- **Depends on**: nothing (the syntax index and its backfill are delivered; T0004 is closed)
- **Blocks**: T0008, T0010
- **References**:
  - `tickets/done/T0004-french-syntax-weighted-retrieval/spec.md` — sections 4, 5,
    and 6 define the component score, the weighted query, and the pagination
    contract. This ticket carries the remainder of that work (Tasks 14 and 15 of
    the closed plan).
  - `tickets/done/T0004-french-syntax-weighted-retrieval/scoring-decision.md` —
    the approved normalization formulas and their parameters.
  - `memos/qdrant-multivector-behavior.md` — the measured `max_sim` behavior and
    the unbounded raw score.
  - `src/lib/retrieval.ts`, `src/lib/retrieval.test.ts` — the semantic + keyword
    weighted slice that this ticket completes.
  - `src/lib/retrieval-contract.ts` — `WeightedQuery`, `WeightedHit`,
    `WeightedResultPage`, `IndexWeights`.
  - `src/lib/scoring.ts`, `src/lib/scoring.test.ts` — `normalizeMultivectorMaxSim`,
    `combineScores`, `scoreAndOrder`, `validateWeights`.
  - `src/lib/result-pages.ts` — the snapshot cursor store and its error types.
  - `src/lib/qdrant.ts` — `queryAstExact`, `scrollIds`, `queryDenseExact`,
    `querySparseExact`.
  - `src/lib/index-state.ts` — `assertSyntaxReady`, `SyntaxNotReadyError`,
    `StaleGenerationError`, `SyntaxIndexCoverage`.
  - `src/lib/syntax/encoder.ts`, `src/lib/syntax/parser.ts`,
    `src/lib/syntax/config.ts` — the query-side syntax encoder.
  - `src/server/api.ts`, `src/server/api.test.ts`, `src/server/index.ts` — the
    HTTP surface.
  - `.agents/skills/qdrant-advisor/SKILL.md` — the Qdrant tool skill. Load it
    before you design the query.
  - Qdrant Search documentation:
    - <https://qdrant.tech/documentation/search/search/> — section "Payload and
      Vector in the Result" documents `with_vectors`.

## Context & Goal

T0004 delivered the parser, the coarse encoder, the `ast` multivector, and its
backfill. It also delivered a weighted retriever that scores `semantic` and
`keyword` and paginates the result. One piece is missing: the retriever rejects
any query with a positive `syntax` weight, and the HTTP endpoint still speaks the
old `topK` contract.

This ticket closes the gap. It makes the three indexes **uniform**: one query
selects any subset of `syntax`, `semantic`, and `keyword` by a fractional weight,
scores every eligible record, applies a minimum score, and returns a stable
paginated page. A caller that wants only one index sets its weight to `1` and the
other weights to `0`. A caller that wants all three sets three weights that sum
to `1`.

"Done" means: a single query can select `syntax` alone, each other index alone,
or all three combined; every eligible record at or above the threshold appears
exactly once when the caller follows every cursor; and `GET /api/slogans`
accepts the new parameters and rejects the obsolete ones.

This is the bridge that the conversational agent needs. T0008 builds its tools on
this API, and it must not start on the obsolete `topK` path.

## Scope Boundary

Create or modify **only** these paths.

### May modify

- `src/lib/retrieval.ts`, `src/lib/retrieval.test.ts` — add the `syntax` index to
  the weighted query, and remove the hard-coded year filter.
- `src/lib/retrieval-contract.ts` — the query and result types; the year-typed
  `RetrievalFilters` becomes the generic `PayloadFilter`.
- `src/lib/result-pages.ts` — type the snapshot binding filter as
  `PayloadFilter`.
- `src/lib/qdrant.ts`, `src/lib/qdrant.test.ts` — return the record row count
  from the exact ast query.
- `src/lib/scoring.ts`, `src/lib/scoring.test.ts` — only if the syntax
  normalization needs a change. Prefer the existing
  `normalizeMultivectorMaxSim`.
- `src/server/api.ts`, `src/server/api.test.ts` — the weighted HTTP parameters,
  without `yearFrom` or `yearTo`.
- `src/server/index.ts` — wire the weighted retriever and the syntax dependency.
- `.env.sample` — document any new environment value (for example the syntax
  model path), when one is added.
- `README.md` — describe the weighted request, when the endpoint changes.

### Must not touch

- `src/lib/slogan-retrieval.ts`. The legacy retriever stays until every caller
  migrates. T0010 removes it.
- `src/lib/index-state.ts`. Its contract is already correct. Use it; do not
  change it.
- `src/lib/syntax/**`. The parser, the encoder, and the configuration are
  delivered. Consume them; do not change them.
- `src/components/**` and `src/server/chat.ts`. T0008 and T0010 own the callers.
- `scripts/**`. The evaluation and the caller migration are T0010.
- `design-tokens.css`, `color-variants.css`, `DESIGN.md`. This ticket adds no
  visual change.
- `.agents/skills/**`, `skills-lock.json`, and the root `AGENTS.md`. The CTO owns
  the tool-skill registry.
- `node_modules/**`, except the documented `node_modules/ai/docs/**` tree. Never
  read `node_modules/**/src/**`.

### Append-only shared files

None.

## Contract

Every unit and integration test is written against this section.

### 1. The filter stays, and becomes generic

`WeightedQuery`, `IndexWeights`, `WeightedHit`, and `WeightedResultPage` keep
their shape in `src/lib/retrieval-contract.ts`, with one change: the year-typed
filter becomes the generic Qdrant payload filter. The three index names are
`syntax`, `semantic`, and `keyword`. The weights are nonnegative finite numbers
with a sum of `1` within `WEIGHT_TOLERANCE`; at least one weight is positive.
This ticket adds no new index name.

This ticket **removes the hard-coded year fields and keeps the filter generic**:

- In `src/lib/retrieval-contract.ts`, replace `RetrievalFilters` with the
  transport's generic `PayloadFilter` type:
  `filters?: PayloadFilter` on `WeightedQuery`. `PayloadFilter` is exported by
  `src/lib/qdrant.ts` (`{ must?: FilterCondition[] }`).
- In `src/lib/retrieval.ts`, remove `buildFilter` and the `filterField`
  dependency, and pass `query.filters` straight to `scrollIds`,
  `queryDenseExact`, `querySparseExact`, and `queryAstExact`. Delete the two
  tests that assert the year filter reaches the transport; replace them with a
  test that a generic filter reaches the transport unchanged.
- In `src/lib/result-pages.ts`, keep the `filters` field of `SnapshotBinding`,
  but type it as `PayloadFilter | undefined` and serialize it to a stable string
  in the binding key (replace `normalizeFilters` with a stable JSON key).
- In the HTTP surface, remove `yearFrom` and `yearTo` (section 5).

The removed fields were the pair `yearFrom`/`yearTo`, hard-coded for one dataset.
They are not shared by every collection. The retrieval layer now carries the
generic `PayloadFilter` that the transport already supports. How the HTTP API
exposes a generic filter — the parameter shape and the field names it may target
— is a separate ticket.

### 2. The syntax index joins the weighted query

`createWeightedRetriever` currently throws when `weights.syntax > 0`. This ticket
removes that rejection and scores the syntax index like the other two.

The retriever gains the dependencies it needs to encode the query text:

```ts
/** Dependencies that weighted retrieval needs. Tests inject fakes. */
export type WeightedRetrieverDependencies = {
  // … the existing fields stay, except `filterField`, which section 1 removes …
  /** Qdrant transport operations for the exhaustive path. */
  client: Pick<QdrantClient, "scrollIds" | "fetchPayloads" | "queryDenseExact" | "querySparseExact" | "queryAstExact">;
  /**
   * Syntax query encoder and its configuration identity.
   *
   * Required when a query selects the syntax index. Absent or `undefined` when the caller never selects syntax.
   */
  syntax?: {
    /** Parse one text into sentence trees. */
    parser: Parser;
    /** Encode the parsed tree into one vector per sentence. */
    encode: typeof encodeTree;
    /** Encoder configuration. Defaults to `DEFAULT_ENCODER_CONFIG`. */
    encoderConfig?: EncoderConfig;
    /** Syntax mode. The only implemented mode is `coarse`. */
    mode: SyntaxMode;
    /** Configuration identifier published by the backfill. */
    configId: string;
  };
  /** Syntax readiness and generation checks. Required when syntax is selected. */
  state?: Pick<IndexStateStore, "assertSyntaxReady">;
};
```

Behavior when `weights.syntax > 0`:

- Call `state.assertSyntaxReady(generation, syntax.configId)` before any query.
  A missing, pending, or config-mismatched syntax state throws
  `SyntaxNotReadyError`; a changed generation throws `StaleGenerationError`. Both
  reach the caller unchanged.
- Parse and encode the query text with `parser.parse`, `abstractTree`,
  `encodeTree`, and `syntax.mode`. The rows are `vectors.map((v) => v.values)`.
  This mirrors the backfill in `scripts/index-syntax.ts`.
- Encode the query **once** per request, before the identifier batches.
- For each identifier batch, call `queryAstExact({ rows, ids, filter, withRows:
true })`.
- Normalize each raw score with
  `normalizeMultivectorMaxSim(raw, rows.length, recordRows)`, where `recordRows`
  is the row count returned by the transport (section 3).
- A record that Qdrant does not return for the ast query has no `ast` vector. It
  is **outside the syntax eligibility scope** and contributes no syntax score.
  The retriever uses `onMissing: "skip"` for the ast query, exactly as the
  closed plan records ("Records without an ast vector are never returned by the
  ast query").
- A blank `query.text` still returns an empty page without a parser call.

The combined score is `sum(weight[index] * normalizedScore[index])` over the
selected indexes, as `combineScores` already computes. Ordering, the threshold,
the snapshot, and the cursor are unchanged.

### 3. The record row count comes from the same ast query

`normalizeMultivectorMaxSim(raw, queryRows, recordRows)` needs the record row
count. The transport returns it in the same response, so no extra request and no
payload change are needed.

Qdrant documents `with_vectors` on the query endpoint: "Additional parameters
`with_vectors` and `with_payload` alter this behavior"
(<https://qdrant.tech/documentation/search/search/>, section "Payload and Vector
in the Result"). The stored `ast` value is a matrix, so its row count is the
length of the returned matrix.

Change `src/lib/qdrant.ts`:

```ts
/** One raw score for one identifier and one index. */
export type IndexScore = {
  /** Record identifier. */
  id: number | string;
  /** Raw score from Qdrant, exactly as returned. */
  score: number;
  /**
   * Number of rows of the stored vector, when the query asked for it.
   *
   * Only the ast query sets this. It is the row count of the returned matrix, which is the sentence count of the record.
   */
  rows?: number;
};

/** Parameters of an exact ast score query. */
export type ExactAstQuery = {
  // … the existing fields stay …
  /** Ask Qdrant for the stored ast matrix, so the transport can report its row count. */
  withRows?: boolean;
};
```

`queryAstExact` adds `"with_vectors":[<ast name>]` to the request body when
`withRows` is true, and sets `rows` on each returned `IndexScore` from the length
of the returned matrix. When `withRows` is false it behaves exactly as today.

The request body is built by hand in `queryAstExact`; keep the documented JSON
shape and add the `with_vectors` key beside `with_payload`.

### 4. Readiness, eligibility, and error types

The retriever throws typed errors; the HTTP layer maps them to status codes
(section 5). The types already exist:

- `SyntaxNotReadyError` and `StaleGenerationError` from `src/lib/index-state.ts`.
- `ParserUnavailableError` from `src/lib/syntax/parser.ts`.
- `CursorMismatchError`, `CursorExpiredError`, and `SnapshotCapacityError` from
  `src/lib/result-pages.ts`.

A query that does **not** select syntax works without a parser, without a syntax
state, and without a ready syntax index. The syntax dependency is only read when
`weights.syntax > 0`.

### 5. The HTTP surface

`GET /api/slogans` keeps `q`, and replaces `topK`, `mode`, `yearFrom`, and
`yearTo` with the weighted parameters.

| Parameter  | Required | Rule                                                                  |
| ---------- | -------- | --------------------------------------------------------------------- |
| `q`        | yes      | Non-empty after trim, else HTTP 400.                                  |
| `weights`  | yes      | A JSON object, one entry per selected index. `validateWeights` rules. |
| `minScore` | yes      | A finite number in `[0, 1]`.                                          |
| `pageSize` | no       | A positive integer. Delivery size, not match eligibility.             |
| `cursor`   | no       | An opaque continuation token.                                         |

A request that carries `topK`, `mode`, `yearFrom`, or `yearTo` is rejected with
HTTP 400. A request with an unknown index name, an invalid weight, a missing
threshold, a non-JSON `weights` value, or a `minScore` outside `[0, 1]` is
rejected with HTTP 400. The handler never normalizes invalid weights and never
supplies a hidden default.

The endpoint does not expose a filter parameter yet. The retrieval layer accepts
the generic `PayloadFilter` from its direct callers; the HTTP parameter shape for
a generic filter is a separate ticket.

Success response:

```ts
{
  /** Qualifying records, ordered by combined score descending. */
  results: Array<{
    id: number | string;
    score: number;
    scores: IndexScores;
    annee: number;
    marque: string;
    campagne: string;
    slogan: string;
  }>;
  /** Present exactly when more qualifying records remain. */
  nextCursor?: string;
  /** Scoring metadata: weights, minScore, normalizationVersion, generation, syntaxConfigId. */
  metadata: WeightedResultMetadata;
}
```

The typed record fields come from the payload through a field configuration that
the handler receives. Define the mapping dependency on `ApiDependencies`:

```ts
/** Payload field names that map one weighted hit to a typed response record. */
export type SloganFields = {
  /** Numeric field for the year output. */
  year: string;
  /** String field for the brand output. */
  brand: string;
  /** String field for the campaign output. */
  campaign: string;
  /** String field for the slogan output. */
  content: string;
};

/** Dependencies of the JSON API. Tests inject a fake retriever. */
export type ApiDependencies = {
  /** Weighted retriever over the slogan collection. */
  retriever: Pick<WeightedRetriever, "retrieveWeighted">;
  /** Payload field names for the typed response. */
  fields: SloganFields;
};
```

Error mapping:

| Thrown                   | HTTP | Body        |
| ------------------------ | ---- | ----------- |
| `ApiError(400, …)`       | 400  | `{ error }` |
| `CursorMismatchError`    | 400  | `{ error }` |
| `SnapshotCapacityError`  | 503  | `{ error }` |
| `StaleGenerationError`   | 409  | `{ error }` |
| `CursorExpiredError`     | 410  | `{ error }` |
| `SyntaxNotReadyError`    | 503  | `{ error }` |
| `ParserUnavailableError` | 503  | `{ error }` |
| Any other error          | 500  | `{ error }` |

`OPTIONS` returns `204` with the CORS headers; a non-`GET` method returns `405`,
both unchanged.

### 6. Documented Qdrant surface

| Call                                      | Documented behavior                                                              | Source                                                                                          |
| ----------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `POST …/points/query` with `with_vectors` | "Additional parameters `with_vectors` and `with_payload` alter this behavior."   | <https://qdrant.tech/documentation/search/search/> — section "Payload and Vector in the Result" |
| `max_sim`                                 | `score = sum over i of max over j of Sim(A_i, B_j)`. The raw score is unbounded. | `memos/qdrant-multivector-behavior.md`, section 3                                               |

**Documentation rule for this ticket.** Read the `qdrant-advisor` tool skill and
the Qdrant documentation before you change the query. Never read dependency
source. When the documented surface does not cover a behavior, measure the
running server, record the result in `memos/qdrant-multivector-behavior.md`, and
report to the CTO.

## TDD Tasks

- [ ] **T9.1 — The transport reports the record row count**: write failing tests
      for `queryAstExact` with `withRows: true` — the request body carries
      `with_vectors` and the name of the ast vector, each returned `IndexScore`
      carries the matrix row count, and `withRows: false` leaves the body
      unchanged — then implement it. Files: `src/lib/qdrant.ts`,
      `src/lib/qdrant.test.ts`. Verify: `bun test src/lib/qdrant.test.ts`.
      Depends on: nothing.
- [ ] **T9.2 — The syntax index scores in the weighted query**: write failing
      tests — syntax alone (`weights={syntax:1}`), all three combined, the raw
      `max_sim` normalized by `max(queryRows, recordRows)`, a record without an
      `ast` vector outside the syntax scope, a blank query without a parser call
      — then implement the syntax branch. Files: `src/lib/retrieval.ts`,
      `src/lib/retrieval.test.ts`, `src/lib/retrieval-contract.ts`. Verify:
      `bun test src/lib/retrieval.test.ts`. Depends on: T9.1.
- [ ] **T9.2b — Make the filter generic**: write a failing test that a generic
      `PayloadFilter` reaches the transport unchanged, then replace
      `RetrievalFilters` with `PayloadFilter` on `WeightedQuery` in
      `src/lib/retrieval-contract.ts`, remove `buildFilter` and the `filterField`
      dependency from `src/lib/retrieval.ts` and pass `query.filters` straight
      through, and type `SnapshotBinding.filters` as `PayloadFilter` with a
      stable JSON binding key in `src/lib/result-pages.ts`. Delete the two
      year-filter tests. Verify: `bun test src/lib/retrieval.test.ts
src/lib/result-pages.test.ts` and `bunx tsc --noEmit`. Depends on: T9.2.
- [ ] **T9.3 — Readiness and eligibility errors**: write failing tests for a
      missing, pending, and config-mismatched syntax state, a changed generation,
      and a missing parser model — each throws its typed error, and a query
      without a positive syntax weight never reads the syntax dependency. Files:
      `src/lib/retrieval.ts`, `src/lib/retrieval.test.ts`. Verify:
      `bun test src/lib/retrieval.test.ts`. Depends on: T9.2.
- [ ] **T9.4 — The weighted HTTP parameters**: write failing tests for the
      parameter validation, the obsolete-parameter rejection (`topK`, `mode`,
      `yearFrom`, `yearTo`), the response shape, and each error mapping in
      section 5, with a fake retriever — then implement the handler. Files:
      `src/server/api.ts`, `src/server/api.test.ts`. Verify:
      `bun test src/server/api.test.ts`. Depends on: T9.2b.
- [ ] **T9.5 — Wiring**: build the weighted retriever with the syntax dependency
      and the syntax state store, and pass the slogan field configuration to the
      handler. Files: `src/server/index.ts`. Verify: `bun run dev` starts and a
      `syntax`-weighted request answers. Depends on: T9.4.
- [ ] **T9.6 — Gates**: run the project commands from `AGENTS.md` —
      `bun fmt --check`, `bun run lint`, `bunx tsc --noEmit`, `bun test`. Depends
      on: T9.1–T9.5, including T9.2b.

## Acceptance Criteria

Each criterion is observable and testable.

1. A single query selects `syntax` alone, `semantic` alone, `keyword` alone, and
   all three combined, with weights that sum to `1`.
2. A record's syntax component score equals `max_sim / max(queryRows,
recordRows)`, in `[0, 1]`.
3. A record with no `ast` vector is outside the syntax eligibility scope and
   never breaks the query.
4. A query without a positive syntax weight works without a parser and without a
   ready syntax index.
5. A query with a positive syntax weight against a missing or incompatible syntax
   state fails with `SyntaxNotReadyError`; against a changed generation it fails
   with `StaleGenerationError`.
6. Every eligible record at or above `minScore` appears exactly once when the
   caller follows all cursors. A cursor from another query, an expired cursor,
   and a malformed cursor each fail explicitly.
7. `GET /api/slogans` accepts `q`, `weights`, `minScore`, `pageSize`, and
   `cursor`, and returns the typed record fields, the combined score, the
   per-index scores, `nextCursor` when more remain, and the metadata.
8. `GET /api/slogans` rejects `topK`, `mode`, `yearFrom`, and `yearTo` with
   HTTP 400.
9. The error status codes match the table in section 5.
10. The filter is generic: `WeightedQuery.filters` and `SnapshotBinding.filters`
    are typed `PayloadFilter`, no year field name remains, and a generic filter
    reaches the transport unchanged.

## Risks and Mitigations

| Risk                                                                        | Impact               | Mitigation                                                                                                   |
| --------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------ |
| `with_vectors` is not accepted on the ast query                             | Blocked transport    | Measure the running server first; record the result in the memo; report the gap                              |
| Returning the ast matrix per record is costly on a large corpus             | Slow queries         | The bridge accepts the cost; T0010 measures it and proposes a cheaper row-count source                       |
| The syntax state does not store the unsupported id set                      | Weak integrity check | The bridge treats a record without an `ast` vector as outside the syntax scope; T0010 may add a strict check |
| A caller keeps an obsolete parameter (`topK`, `mode`, `yearFrom`, `yearTo`) | Broken request       | The handler rejects each with a clear 400; T0010 migrates the remaining callers                              |

## Glossary

- **Combined score**: the weighted sum of the selected component scores, in
  `[0, 1]`.
- **Component score**: the normalized score of one index for one record, in
  `[0, 1]`.
- **Cursor**: an opaque token that points to the next page of one scored query.
- **`max_sim`**: the Qdrant multivector comparator. Its score is the sum, over
  the query rows, of the best match against the record rows. It is unbounded.
- **Payload filter**: the generic Qdrant filter (`PayloadFilter`) that selects
  eligible records before scoring. It targets the filter fields of a collection,
  not a field name hard-coded for one dataset.
- **Row**: one sentence of a record in the `ast` matrix. The row count is the
  sentence count.
- **`syntax` index**: the public index backed by the `ast` multivector.
- **Weight**: the fractional contribution of one index to the combined score.
  The weights sum to `1`.
- **Weighted query**: one query that selects one or more indexes by weight,
  scores every eligible record, applies a minimum score, and returns one page.
