# T0010 — Migrate the callers, evaluate, and document the weighted retrieval

- **Track**: Retrieval application and release
- **Wave**: 2 (integration — needs the weighted API and the agent)
- **Status**: planned
- **Depends on**: T0009, T0008
- **Blocks**: nothing
- **References**:
  - `tickets/done/T0004-french-syntax-weighted-retrieval/plan.md` — Tasks 16b,
    16c, 17a, and 17b are the remainder of that work and this ticket carries
    them. The chat tool migration (Task 16a) is carried by T0008.
  - `tickets/done/T0004-french-syntax-weighted-retrieval/evaluation.md` — the
    encoder evaluation that this ticket extends with the retrieval measurements.
  - `tickets/planned/T0009-weighted-retrieval-api.md` — the weighted query and
    the HTTP surface.
  - `src/components/app/RetrievalPanel.tsx`, `src/components/app/RetrievalHit.tsx`
    — the retrieval panel that still calls `topK`.
  - `scripts/smoke-retrieval.ts` — the smoke script that still uses the legacy
    retriever.
  - `scripts/index-dataset.ts`, `scripts/index-dataset.test.ts` — the full
    indexer.
  - `scripts/evaluate-syntax.ts` — the existing encoder evaluation command.
  - `scripts/index-syntax.ts` — the syntax backfill that the full indexer must
    reuse.
  - `src/lib/slogan-retrieval.ts`, `src/lib/slogan-retrieval.test.ts` — the
    legacy retriever to remove.
  - `src/server/index.ts` — the wiring that builds the legacy retriever.
  - `memos/` and `memos/AGENTS.md` — where the measurements are recorded.

## Context & Goal

T0009 delivers the weighted retrieval API and the HTTP surface. T0008 delivers
the conversational agent on that API. What remains from T0004 is the rest of the
application: the retrieval panel, the smoke script, the full indexer, the
evaluation, and the release documentation.

This ticket finishes the migration. It moves every remaining caller to the
weighted API, makes the full indexer populate the `ast` vector, adds the ranking
and full-result measurements to the evaluation command, removes the legacy
retriever, and documents the migration.

"Done" means: no caller uses the obsolete `topK` contract, the full indexer can
build every index in one run, the evaluation reports grammar quality, ranking,
full-result equality, and runtime, and the README explains the weighted request.

## Scope Boundary

Create or modify **only** these paths.

### May create

- `memos/syntax-weighted-retrieval-evaluation.md` — the retrieval measurements,
  with their method, their numbers, and a glossary.

### May modify

- `src/components/app/RetrievalPanel.tsx`, `src/components/app/RetrievalHit.tsx`,
  and `src/components/app/RetrievalHit.css` — weighted parameters and cursor
  following.
- `src/components/README.md` — when the panel behavior changes.
- `scripts/smoke-retrieval.ts` — weighted parameters and complete pages.
- `scripts/index-dataset.ts`, `scripts/index-dataset.test.ts` — populate the
  `ast` vector and publish the syntax state during a full run.
- `scripts/evaluate-syntax.ts`, `scripts/evaluate-syntax.test.ts` — ranking,
  full-result equality, and runtime measurements.
- `scripts/README.md`, root `README.md` — the migration and the new commands.
- `src/server/index.ts` — remove the legacy retriever wiring.
- `src/lib/slogan-retrieval.ts`, `src/lib/slogan-retrieval.test.ts` — remove,
  once no caller imports them.
- `memos/AGENTS.md` — replace the stale "local mirror under `docs/`" rule with
  the tool-skill and official-documentation rule.

### Must not touch

- `src/lib/retrieval.ts`, `src/lib/qdrant.ts`, `src/lib/scoring.ts`,
  `src/lib/result-pages.ts`, `src/lib/index-state.ts`. T0009 owns them. If a
  measurement reveals a defect, report it to the CTO; do not fix it here.
- `src/lib/syntax/**`. The parser, the encoder, and the configuration are
  delivered.
- `src/server/chat.ts`, `src/server/agent/**`. T0008 owns them.
- `design-tokens.css`, `color-variants.css`, `DESIGN.md`. The panel adds no new
  token and no ad-hoc style; it composes the existing primitives.
- `.agents/skills/**`, `skills-lock.json`, the root `AGENTS.md`. The CTO owns the
  tool-skill registry.
- `node_modules/**`, except the documented `node_modules/ai/docs/**` tree.

### Append-only shared files

None.

## Contract

Every unit and integration test is written against this section.

### 1. The retrieval panel follows the weighted API

`RetrievalPanel` calls `GET /api/slogans` with `weights`, `minScore`, and
`pageSize`. It no longer sends `topK`. It keeps its typed record fields.

- The default weights are `{ syntax: 0.5, semantic: 0.3, keyword: 0.2 }` and the
  default minimum score is documented in the panel. The values are a constant in
  the component, not a user control. This ticket adds no new UI control for
  weights or syntax.
- A `nextCursor` in the response is a signal that more records exist. The panel
  keeps the current page and loads the next page when the user asks for it. Page
  size is a delivery size, never a total result limit.
- An empty `results` list shows the empty state. An expired cursor shows an error
  and does not duplicate records.

### 2. The smoke script uses the weighted API

`scripts/smoke-retrieval.ts` builds the weighted retriever, runs the example
queries with explicit weights and a minimum score, follows every cursor, and
prints the complete ranked list. It fails with a non-zero exit code when a query
returns no record.

### 3. The full indexer populates the syntax index

`scripts/index-dataset.ts` gains an optional syntax pass, behind the same
configuration and generation lifecycle as the backfill. When syntax is enabled:

- It encodes and writes the `ast` vector for every eligible record.
- It publishes the syntax state with the coverage counts, through
  `publishSyntax`, after the dense pass and only when the run accounts for every
  record.
- A truncated run (`--limit`) publishes neither the dense generation nor the
  syntax state as ready.
- The pass reuses `scripts/index-syntax.ts` and `src/lib/syntax/**`. It does not
  duplicate the encoding logic.

When syntax is not enabled, the run behaves exactly as today.

### 4. The evaluation command reports four families of measurement

`scripts/evaluate-syntax.ts --mode coarse` reports, in addition to its current
structural and parser accuracy:

- **Ranking**: the ranking of the reviewed queries against the test data set,
  compared with the frozen reference order.
- **Full-result equality**: for each query, the identifiers returned by the
  weighted retrieval equal the identifiers the exhaustive reference scores, when
  the caller follows every cursor.
- **Runtime**: corpus size, vector dimensions, normalization parameters, memory,
  page cost, and component timings.

The reference uses `multivectorSimilarity` and `scoreAndOrder` from
`src/lib/scoring.ts`. The command is hermetic: it does not require a live Qdrant
server for the encoder part, and it documents the collection it needs for the
retrieval part.

### 5. The legacy retriever is removed

After the panel, the smoke script, the API, and the chat handler no longer import
it, remove `src/lib/slogan-retrieval.ts` and `src/lib/slogan-retrieval.test.ts`,
and remove the legacy retriever from `src/server/index.ts`.

The removal is complete only when a search of the sources finds no remaining
`retrieveHybrid`, `topK`, `mode`, `yearFrom`, or `yearTo` reference outside a
deliberate obsolete-parameter test in `src/server/api.test.ts`.

### 6. The documentation records the migration

The root `README.md` and `scripts/README.md` describe:

- The weighted request: `q`, `weights`, `minScore`, `pageSize`, `cursor`.
- The migration from `topK` to `minScore` and `pageSize`, and the removal of
  `mode`, `yearFrom`, and `yearTo`.
- How to follow a cursor, the cursor lifetime, and the page-size bounds.
- How to run the full indexer with syntax, the backfill, and the evaluation.

## TDD Tasks

- [ ] **T10.1 — The panel on the weighted API**: write the failing component
      behavior test — the request carries `weights`, `minScore`, and `pageSize`;
      a `nextCursor` loads the next page; an empty list shows the empty state —
      then implement it. Files: `src/components/app/RetrievalPanel.tsx` and its
      test. Verify: `bun test` for the panel. Depends on: T0009.
- [ ] **T10.2 — The smoke script**: update the script to the weighted API and
      cursor following. Files: `scripts/smoke-retrieval.ts`. Verify: `bun run
smoke` against a ready index. Depends on: T0009.
- [ ] **T10.3 — Full indexing populates syntax**: write failing tests for the
      optional syntax pass — a full run publishes the syntax state, a truncated
      run publishes nothing ready, a disabled run is unchanged — then implement
      it. Files: `scripts/index-dataset.ts`, `scripts/index-dataset.test.ts`.
      Verify: `bun test scripts/index-dataset.test.ts`. Depends on: T0009.
- [ ] **T10.4 — Evaluation reports ranking and full-result equality**: extend the
      command and write its test. Files: `scripts/evaluate-syntax.ts`,
      `scripts/evaluate-syntax.test.ts`, `memos/syntax-weighted-retrieval-evaluation.md`.
      Verify: `bun run scripts/evaluate-syntax.ts --mode coarse`. Depends on:
      T10.2.
- [ ] **T10.5 — Remove the legacy retriever**: delete the module and its test,
      and remove the wiring. Files: `src/lib/slogan-retrieval.ts`,
      `src/lib/slogan-retrieval.test.ts`, `src/server/index.ts`. Verify: `bunx
tsc --noEmit` and a source search for `retrieveHybrid`. Depends on: T0008,
      T10.1, T10.2.
- [ ] **T10.6 — Documentation**: update the READMEs and `memos/AGENTS.md`. Files:
      root `README.md`, `scripts/README.md`, `memos/AGENTS.md`. Depends on:
      T10.3–T10.5.
- [ ] **T10.7 — Gates**: run the project commands from `AGENTS.md` —
      `bun fmt --check`, `bun run lint`, `bunx tsc --noEmit`, `bun test`, and
      `bun run smoke`. Depends on: T10.1–T10.6.

## Acceptance Criteria

Each criterion is observable and testable.

1. No caller sends `topK`, `mode`, `yearFrom`, or `yearTo`. A source search
   finds them only in the deliberate obsolete-parameter test.
2. The retrieval panel requests weighted results and follows every cursor
   without treating page size as a total match limit.
3. The full indexer builds the `ast` vector and publishes the syntax state in one
   run, and a truncated run publishes nothing ready.
4. The evaluation command reports grammar quality, ranking, full-result
   equality, and runtime, and its full-result identifiers equal the exhaustive
   reference.
5. `src/lib/slogan-retrieval.ts` is removed and no source imports it.
6. The READMEs describe the weighted request, the cursor handling, and the new
   commands.
7. Every project gate is green.

## Risks and Mitigations

| Risk                                                 | Impact            | Mitigation                                                                       |
| ---------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------- |
| The full indexer and the backfill diverge            | Two encodings     | The full pass reuses `scripts/index-syntax.ts`; one test asserts the shared path |
| The panel treats `pageSize` as a total limit         | Missing records   | A test follows every cursor and compares the identifier set with the reference   |
| The legacy removal breaks a caller the search missed | Build failure     | `bunx tsc --noEmit` is the authority; remove only after it is clean              |
| The evaluation needs a live Qdrant server            | Non-hermetic test | The encoder part is hermetic; the retrieval part documents its collection        |

## Glossary

- **Backfill**: the addition of `ast` vectors to records that already exist.
- **Cursor**: an opaque token that points to the next page of one scored query.
- **Full-result equality**: the property that following every cursor returns the
  same record identifiers as the exhaustive reference scorer.
- **Full indexer**: the command that builds the dense vector, the BM25 vector,
  and the payload indexes in one run.
- **Legacy retriever**: the pre-T0004 module `src/lib/slogan-retrieval.ts`, which
  fuses one dense prefetch and one BM25 prefetch with Qdrant RRF under a `topK`
  limit.
- **Minimum score**: the combined score at or above which a record qualifies.
- **Page size**: the number of records in one delivered page. It never changes
  which records qualify.
- **Weighted request**: a request that selects one or more indexes by weight and
  applies a minimum score.
