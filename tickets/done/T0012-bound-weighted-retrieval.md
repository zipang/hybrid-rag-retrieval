# T0012 — Bound the weighted retrieval

- **Track**: Retrieval application
- **Wave**: 1 (independent)
- **Status**: done
- **Owner**: coding sub-agent, supervised by CTO
- **Started**: 2026-11-12
- **Depends on**: nothing
- **Blocks**: T0010
- **References**:
  - `tickets/done/T0009-weighted-retrieval-api.md` — the exhaustive threshold
    design that this ticket replaces with a bounded one.
  - `src/lib/retrieval.ts` — `createWeightedRetriever`, `retrieveWeighted`.
  - `src/lib/qdrant.ts` — `scrollIds`, `queryHybrid`, and the exact query
    methods.
  - `src/lib/retrieval-contract.ts` — `WeightedQuery`, `WeightedResultPage`.
  - Qdrant Query API:
    - <https://skills.qdrant.tech/md/documentation/search/hybrid-queries/>
    - <https://skills.qdrant.tech/qdrant-search-quality/search-strategies/hybrid-search/search-types/SKILL.md>
  - `.agents/skills/qdrant-advisor/SKILL.md` — load it before you design.

## Context & Goal

`retrieveWeighted` is **exhaustive** on purpose: it scrolls the complete
identifier set (`scrollIds`) and scores every point with
`limit: ids.length`. On the 265 265-point remote collection a single query takes
~27 seconds and exceeds the Bun HTTP idle timeout. The retrieval must never scan
the whole collection.

"Done" means: `retrieveWeighted` asks Qdrant for a bounded candidate set per
selected index, using the Query API and **one `limit` value applied to every
index**, then fuses the weights and applies the threshold on those candidates
only. A query is bounded regardless of the collection size.

## Scope Boundary

Create or modify **only** these paths.

### May create

- `src/lib/qdrant.test.ts` — add cases to the existing suite when it exists.

### May modify

- `src/lib/retrieval.ts` and `src/lib/retrieval.test.ts`.
- `src/lib/qdrant.ts` and its test.
- `src/lib/retrieval-contract.ts` — add the candidate `limit` to `WeightedQuery`.
- `src/server/api.ts` — read an optional `limit` query parameter.
- `.env.sample` — document `RETRIEVAL_LIMIT` when it is added.

### Must not touch

- `src/server/agent/**`, `src/server/chat.ts`, `src/components/**`.
- `src/lib/slogan-retrieval.ts`, `src/lib/scoring.ts` (the normalization helpers
  stay as they are), `src/config/datasets.ts`.
- `DESIGN.md`, `design-tokens.css`, `color-variants.css`, the root `AGENTS.md`,
  `.agents/**`.
- `node_modules/**`, except the documented `node_modules/ai/docs/**` tree.

## Contract

Every unit and integration test is written against this section.

### 1. The candidate limit

```ts
/** One query for weighted threshold retrieval. */
export type WeightedQuery = {
  text: string;
  weights: IndexWeights;
  minScore: number;
  /** Delivery size for one page. It does not change match eligibility. */
  pageSize?: number;
  /** Candidate count requested from Qdrant for EACH selected index. One value applies to every index. Default 50. Bounded to `[1, 1000]`. */
  limit?: number;
  cursor?: string;
  filters?: PayloadFilter;
  generation?: string;
};
```

The `limit` is the candidate count per index, not the delivered page size.
`pageSize` still controls the delivered page and is unchanged.

### 2. The bounded query

Add one client method that runs a single bounded query on one named vector,
using the Query API. It is the bounded counterpart of the exact methods.

```ts
/** One bounded query on one named vector. */
export type VectorQuery = {
  /** Named vector to search, for example `dense`, `bm25`, or `ast`. */
  using: string;
  /** Query value: a dense vector, a BM25 inference object, or multivector rows. */
  query: unknown;
  /** Maximum number of hits. Required. */
  limit: number;
  /** Payload filter, applied before the search. */
  filter?: PayloadFilter;
};

/** One scored hit from a bounded query. */
export type QueryHit = {
  id: number | string;
  score: number;
  payload?: Record<string, unknown>;
};

/** Run one bounded query on one named vector. */
export const queryVector: (query: VectorQuery) => Promise<QueryHit[]>;
```

The request body is `{ query, using, limit, with_payload: false }` plus the
`filter` when present, sent to `POST {base}/points/query`. This is the shape the
existing `queryHybrid` already uses (`src/lib/qdrant.ts`).

### 3. The bounded retriever

`retrieveWeighted` no longer calls `scrollIds`. It:

1. Validates `weights` and `minScore` as today.
2. For each selected index (`weights[index] > 0`), runs one bounded query:
   - `semantic` → `queryVector({ using: "dense", query: <dense vector>, limit, filter })`;
   - `keyword` → `queryVector({ using: "bm25", query: { text, model: "qdrant/bm25", options: bm25Options }, limit, filter })`;
   - `syntax` → the syntax readiness check as today, then
     `queryVector({ using: "ast", query: <multivector rows>, limit, filter })`.
3. Collects the union of the returned identifiers as the candidate set. Each
   candidate keeps, per index, the score that index returned; an index that did
   not return the candidate contributes `0` for it.
4. Normalizes each index score with the existing helpers, fuses them with the
   weights, applies `minScore`, orders by combined score descending then id
   ascending, and paginates with the existing result-page store.

Rules, each with a test:

- No call to `scrollIds` remains on the `retrieveWeighted` path.
- Every `queryVector` call carries the same `limit` value.
- The candidate set is the union of the per-index hits; a candidate absent from
  one index scores `0` on it.
- The `limit` defaults to `50` and is clamped to `[1, 1000]`.
- A blank `text` still returns an empty page and reads no index.
- A query that does not select `syntax` still reads none of the syntax
  dependencies.
- Pagination still returns the same ranked order within the candidate set.

### 4. The HTTP surface

`GET /api/slogans` accepts an optional `limit` query parameter (integer, default
`50`, clamped to `[1, 1000]`) and passes it to `retrieveWeighted`. The existing
`weights`, `minScore`, `q`, `pageSize`, and `cursor` parameters are unchanged.

## TDD Tasks

- [x] **T12.1 — Bounded query**: write failing tests for `queryVector` — the
      request body (`query`, `using`, `limit`, `with_payload: false`, optional
      `filter`), the returned hits, and an empty result — then implement it.
      Files: `src/lib/qdrant.ts`, `src/lib/qdrant.test.ts`. Depends on: nothing.
- [x] **T12.2 — Bounded retriever**: write failing tests for `retrieveWeighted`
      with a fake client — one bounded query per selected index, the same `limit`
      everywhere, the union candidate set, a zero score for an index that did not
      return a candidate, the `limit` default and clamp, the threshold and the
      order, and pagination — then rewire `retrieveWeighted` and remove the
      `scrollIds` path. Files: `src/lib/retrieval.ts`,
      `src/lib/retrieval.test.ts`, `src/lib/retrieval-contract.ts`. Depends on:
      T12.1.
- [x] **T12.3 — HTTP surface**: read the optional `limit` parameter in
      `src/server/api.ts` and pass it through. Files: `src/server/api.ts`,
      `src/server/api.test.ts`. Depends on: T12.2.
- [x] **T12.4 — Gates**: run the gates in this order and paste the exact output
      into the Implementation Notes:

  ```sh
  bun fmt
  bun fmt --check
  bun run lint
  bun test
  bunx tsc --noEmit
  ```

  Depends on: T12.3.

## Acceptance Criteria

1. A query against a large collection is bounded: `retrieveWeighted` sends at
   most one bounded query per selected index, each carrying the same `limit`, and
   never scrolls the collection.
2. The candidate set is the union of the per-index hits; a candidate absent from
   one index scores `0` on it.
3. The default `limit` is `50`; a value outside `[1, 1000]` is clamped.
4. For the semantic and keyword indexes, the delivered page and its order are
   unchanged for a small collection: the same records qualify and the same order
   is returned. A syntax-weighted query keeps its rank order but may score a
   record differently, because the bounded query returns no stored matrix.
5. `GET /api/slogans` accepts and forwards the optional `limit`.
6. `src/server/agent/**`, `src/server/chat.ts`, and `src/components/**` are
   unchanged.
7. `bun fmt --check`, `bun run lint`, `bun test`, and `bunx tsc --noEmit` all
   pass.

## Risks and mitigations

| Risk                                                     | Impact                  | Mitigation                                                                                                                    |
| -------------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| A candidate `limit` that is too low loses recall         | Silent recall loss      | Qdrant recommends 20-100 candidates for a final limit of 10; the default is `50`, and the `limit` is configurable per request |
| The candidate-first design changes which records qualify | Behavior change         | A test pins the small-collection result and order against the previous behavior where it still holds                          |
| Multivector (`ast`) search is heavy and HNSW-hostile     | Slow syntax queries     | The default weights exclude `syntax`; the bounded `ast` path is opt-in by weight                                              |
| A shard returns `limit * shards` candidates              | More work than expected | The union is deduplicated by id; the bound is per index, not global                                                           |

## Glossary

- **Candidate set**: the records a query may consider. This ticket bounds it to
  the union of the per-index top hits instead of the whole collection.
- **`limit`**: the number of candidates requested from Qdrant for one index. One
  value applies to every selected index. Default `50`.
- **Query API**: Qdrant's `POST /points/query` endpoint. It runs a bounded search
  on one named vector, or a fusion of several prefetches.
- **Named vector**: one vector field of a point, for example `dense`, `bm25`, or
  `ast`.

## Implementation Notes

### Files changed

- `src/lib/qdrant.ts` — added `VectorQuery`, `QdrantClient.queryVector`, and its
  implementation. `queryVector` sends one `POST {base}/points/query` with
  `{ query, using, limit, with_payload: false }` plus the `filter` when present.
- `src/lib/qdrant.test.ts` — six `queryVector` cases: dense body, filter, no
  filter, BM25 inference body, multivector body, empty result.
- `src/lib/retrieval-contract.ts` — added `limit?` to `WeightedQuery`.
- `src/lib/retrieval.ts` — rewrote `retrieveWeighted` on the bounded path and
  removed the `scrollIds` / exact-score path.
- `src/lib/retrieval.test.ts` — rewrote the suite against a fake `queryVector`
  client.
- `src/server/api.ts` — added `readLimit` and forwarded the optional `limit`.
- `src/server/api.test.ts` — added the `limit` cases.

### Architectural decisions

1. **One bounded query per selected index.** `retrieveWeighted` calls
   `queryVector` once for each index whose weight is positive, each with the same
   candidate `limit`. The candidate set is the union of the returned ids. The
   `scrollIds` path is gone. A fake `scrollIds` spy in the tests throws if it is
   ever reached.
2. **Per-index scores on the union.** Each candidate keeps the normalized score
   of every index that returned it; an index that did not return the candidate
   contributes `0`. The delivered `scores` object always carries all three keys,
   so the page shape is unchanged.
3. **Dataset-agnostic vector names.** The retriever resolves the vector names
   from `dependencies.client.schema` (`schema.dense.name`, `schema.sparse.name`,
   `schema.ast.name`) rather than hard-coding `dense` / `bm25` / `ast`. For the
   slogan schema these resolve to exactly the contract strings. This keeps the
   out-of-scope `src/lib/qdrant-genericity.test.ts` (a live-Qdrant suite that
   runs a second collection with the names `embedding` and `terms`) green.
4. **`limit` bounds.** `WeightedQuery.limit` defaults to `50` and is clamped to
   `[1, 1000]`. `GET /api/slogans` reads an optional `limit`, returns
   `undefined` when absent (so the retriever default applies), rejects a
   non-integer value with a 400 through `Number.isSafeInteger`, and clamps a
   valid integer into `[1, 1000]`. This mirrors the existing `pageSize` handling.
5. **Removed dead code.** The exhaustive helpers (`batch`, `DEFAULT_ID_BATCH`,
   `idBatchSize`) and the exact-score dependencies were removed with the
   `scrollIds` path.

### Qdrant candidate-limit warning

The Qdrant documentation warns that a per-index candidate `limit` should sit
well above the final delivered limit. The hybrid-queries page states, for
grouped retrieval: "size per-prefetch `limit` well above the final document
`limit` (rule of thumb: `prefetch_limit ≥ final_limit × expected_chunks_per_document`)",
and the DBSF section adds "Increase the prefetch `limit` if you see unstable
rankings". The default candidate `limit` is `50`, which sits inside Qdrant's
20-100 recommendation for a final limit of 10, and it is configurable per request
through the `limit` parameter and the `WeightedQuery.limit` field. Sources:

- <https://skills.qdrant.tech/md/documentation/search/hybrid-queries/>
- <https://skills.qdrant.tech/qdrant-search-quality/search-strategies/hybrid-search/search-types/SKILL.md>

### Deviations

1. **Syntax normalization uses the query row count.** The bounded Query API
   returns only `{ id, score }`; with `with_payload: false` it does not return
   the stored ast matrix, so the record row count is unavailable. The syntax
   component is normalized with
   `normalizeMultivectorMaxSim(raw, queryRows, queryRows)`. The divisor is
   constant for one query, so it preserves the syntax rank order within the
   candidate set. The exhaustive path used
   `normalizeMultivectorMaxSim(raw, queryRows, recordRows)`; the two agree
   whenever `recordRows ≤ queryRows`.
2. **`QueryHit.payload` stays required.** The contract writes
   `payload?: Record<string, unknown>`. The pre-existing `QueryHit` type declares
   `payload` as required and is consumed by `src/lib/slogan-retrieval.ts`, a file
   this ticket must not touch (making it optional breaks that file's
   `hit.payload.id` access). `queryVector` therefore keeps `QueryHit` untouched
   and narrows its own return type to `Array<Pick<QueryHit, "id" | "score">>`, so
   the method never claims a payload it does not request. The review fixes below
   record this.

### Review fixes

1. **`queryVector` type honesty (D1 / Doc2 / Doc3).** The return type is narrowed
   to `Promise<Array<Pick<QueryHit, "id" | "score">>>`, so it matches the
   `with_payload: false` request. The contradictory JSDoc sentence is removed, and
   the `QueryHit` header no longer says "Fused score from the ranking method" (that
   described RRF fusion); `score` is documented as the relevance score returned by
   the query. `src/lib/slogan-retrieval.ts` is untouched.
2. **`readLimit` consistency (D4).** `readLimit` now rejects a non-safe-integer
   with the same `Number.isSafeInteger` guard as `readPageSize`, then clamps into
   `[1, 1000]`. The API test covers `"many"` and `"2.5"`. The decision-4 claim
   that it mirrors the `pageSize` handling is now accurate.
3. **Magic placeholder removed (D5).** `mergeHits` now takes a `normalize`
   callback instead of a `queryRows` number that only the syntax branch read.
   Each index supplies its own transformation, so the placeholder `0` is gone.
4. **Bounded syntax behaviour pinned (D3).** The candidate set is the union of the
   per-index hits, so a syntax-only query never returns a record that has no `ast`
   vector: such a record is never a candidate. The exhaustive path listed it with
   a zero syntax component. The test "a syntax-only query never lists a record
   without an ast vector" pins the new bounded behaviour.

### Gate output

```sh
$ bun fmt
Formatted 0 files, 181 unchanged [11.72ms]

$ bun fmt --check
All 181 files are formatted.

$ bun run lint
$ biome lint .
Checked 109 files in 49ms. No fixes applied.

$ bun test
bun test v1.4.4 (38afee6c8)

 585 pass
 0 fail
 4713 expect() calls
Ran 585 tests across 34 files. [2.77s]

$ bunx tsc --noEmit
(no output, exit 0)
```

### Candidate-limit default raised to 50

The default candidate `limit` changed from `10` to `50`, in all three places:

- `WeightedQuery.limit` (`src/lib/retrieval-contract.ts`) — default documented as
  `50`.
- `DEFAULT_CANDIDATE_LIMIT` (`src/lib/retrieval.ts`) — `50`.
- `readLimit` (`src/server/api.ts`) — returns `50` when the query parameter is
  absent, so `GET /api/slogans` always forwards a resolved candidate count.

Rationale: Qdrant recommends 20-100 candidates for a final limit of 10, so the
old default of `10` sat below the guidance. `50` sits inside the recommended
band. The clamp stays `[1, 1000]`. The retrieval test now expects `50`, and the
API test "defaults the limit to 50 when the parameter is absent" replaces the
former "omits the limit" case.

Gate output after the change:

```sh
$ bun fmt
Formatted 0 files, 181 unchanged [12.90ms]

$ bun fmt --check
All 181 files are formatted.

$ bun run lint
$ biome lint .
Checked 109 files in 52ms. No fixes applied.

$ bun test
bun test v1.4.4 (38afee6c8)

 590 pass
 0 fail
 4718 expect() calls
Ran 590 tests across 34 files. [2.79s]

$ bunx tsc --noEmit
(no output, exit 0)
```
