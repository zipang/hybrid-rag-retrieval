# Implementation Plan: [T0004] French Syntax Index and Weighted Threshold Retrieval

Ticket: `T0004`  
Specification: [spec.md](spec.md), approved by the user.  
Plan status: Implementation in progress. Task 12 is delivered and under review. Tasks 13 to 17b are open.

## Overview

Add French grammatical-tree vectors and replace rank-based retrieval with explicit weighted matching scores.
Return every eligible record meeting `minScore`, with stable pagination.
Deliver a semantic-only complete retrieval slice first. Extend it with keyword scoring, then syntax scoring.

## Architecture Decisions

### Separate parsing, abstraction, encoding, and retrieval

Place grammatical components in `src/lib/syntax/`.
The parser adapter returns validated grammatical annotations.
Abstraction removes vocabulary and selects the indexing mode.
The deterministic encoder uses only abstract structure.
Retrieval orchestrates selected indexes, normalization, combination, thresholding, and pagination.
Keep HTTP input handling and Qdrant transport separate from scoring logic.

### Use one active syntax mode per collection generation

Store the active mode and complete parser/model/encoder identity with the index generation.
Add `syntax` as a multivector with the `max_sim` comparator through Qdrant's documented vector-schema operation.
Backfill existing point vectors without deleting the collection.
Block syntax reads during a syntax rebuild and publish readiness after coverage validation.
Unselected syntax must not block semantic or keyword retrieval.

Use a dedicated metadata collection or equivalent durable control record for generation and readiness state.
Do not insert control records into the searchable slogan collection.
Finalize the metadata layout in Task 5 after testing cross-process rebuild detection.

### Keep the Qdrant transport independent of one dataset

The transport must work for any collection with any payload fields. It must not
know the slogan field names. The current client hard-codes the collection name
`slogans` and the payload fields `annee` and `marque`:

- `createQdrantClient` hard-codes the default collection and the vector layout.
- `ensureCollection` creates the `annee` and `marque` payload indexes.
- `src/lib/retrieval.ts` builds year filters with the field name `annee` and
  reads the payload fields `annee`, `marque`, and `slogan`.

This coupling prevents the client from querying another collection. The project
separates the transport from the dataset description:

- The transport receives a **schema** that names the collection, the vectors, and
  the payload indexes.
- The transport receives filters and field names from the caller, not from a
  constant.
- The dataset configuration in `src/config/datasets.ts` supplies the schema.
- The slogan field names live in the slogan schema, not in the transport.

This work is Track A. It does not change the T0004 scoring contract. It removes
the sentence "The client queries the slogan collection" from the transport's
responsibilities.

### Guarantee completeness before optimization

Use this reference production baseline:

1. Read and validate the selected index generation and readiness state.
2. Enumerate every eligible point identifier using filtered Qdrant scroll batches.
3. Score each selected index for every identifier batch.
4. Compute normalized component scores and their weighted sum.
5. Retain every score at or above the inclusive threshold.
6. Sort by combined score, then by a canonical point-identifier tie-breaker.
7. Recheck generation and readiness before publishing the result snapshot.
8. Deliver pages from the stable result snapshot.

For dense indexes, query each identifier batch with exact search and a limit equal to the batch's identifier count.
Apply no individual score threshold. A component below `minScore` can still contribute to a qualifying weighted sum.
For keyword scores, query the same identifier batch through Qdrant BM25 inference.
Sparse search is exact but omits nonoverlapping records. Assign those records zero keyword scores after verifying query completion.
Combine identifier membership with existing payload filters.

This approach avoids local reimplementation of Qdrant's BM25 inference and corpus-wide IDF statistics.
Task 2 must prove that identifier batching leaves raw scores unchanged.
If batch filters change BM25 statistics, stop and design a validated exhaustive alternative before implementing weighted retrieval.

An internal batch limit controls transport only. It never determines which records qualify.
At `minScore=0`, include all eligible records, including keyword nonmatches.
Do not introduce approximate candidate pruning without a proof of completeness and specification review.

### Normalize scores independently of result batches

Adopt positive cosine clipping if test data set review validates the approved proposal.
Evaluate the proposed BM25 transformation `rawScore / (rawScore + scale)`.
Choose `scale` on the development items and check threshold behavior on the held-out items.
Persist the formula, parameters, and normalization version.
Do not use RRF, DBSF, page maxima, or candidate statistics as the public matching score.

### Materialize stable pages

Store complete ordered matching results in a bounded, expiring query snapshot.
Use an opaque cursor that identifies the snapshot and next position.
Bind the snapshot to query text, filters, weights, threshold, scoring version, and index generation.
Snapshot stored record fields as well as scores, so later pages do not retrieve changed payloads.

Proposed initial operational bounds: page size defaults to 50, maximum page size is 200, and snapshot lifetime is 10 minutes.
Validate these values through the performance checkpoint before release.
Reject expired cursors with HTTP 410 and changed-generation cursors with HTTP 409.
Reject invalid or query-mismatched cursors with HTTP 400.

Use explicit memory or disk limits for snapshots. Return a documented capacity error rather than truncate matching results.
The first implementation may use process-local snapshots. Server restart then expires their cursors explicitly.
Task 5 must define writer coordination across the server and indexing scripts.
All project write paths must mark a generation as rebuilding before mutation and publish a new generation after completion.
Direct external writes invalidate the generation contract and must be documented as unsupported during paginated retrieval.

### Migrate callers without adding new UI controls

Introduce a typed `retrieveWeighted` operation that returns a result page and metadata.
Keep the old path only during intermediate slices so each task leaves the application usable.
Remove the old public `topK` and `mode` contracts after migrating callers.
The retrieval panel must follow continuation pages instead of treating page size as a total result limit.
The chat tool must expose continuation information and distinguish an initial page from complete results.
Select explicit legacy semantic/keyword weights and a minimum score at the scoring review checkpoint.

## Dependency Graph

```text
1 reviewed test data set ----+----> 3 parser decision ---> 10 parser adapter ---> 11 tree encoder
                       |                                                         |
                       |                                                         v
                       |                                          11a punctuation evaluation
                       |                                                         |
                       |                                                         v
                       |                                          11b punctuation marks
                       |                                                         |
2 Qdrant proof --------+--> 4 scoring contracts --> 5 generation state             |
                                                 |                                |
                                                 v                                v
                                     6 exhaustive score transport ---------> 12 syntax storage
                                                 |                                |
                                                 v                                v
                                     7 semantic threshold slice      13 syntax backfill
                                                 |                                |
                                                 v                                v
                                     8 stable pagination ---------> 14 syntax retrieval
                                                 |
                                                 v
                                     9 keyword weighted slice
                                                 |
                                    9 + 14 ----> 15 API migration --> 16 caller migration
                                                                         |
                                                                  17 release validation
```

Track A removes the hard-coded dataset coupling from the transport:

```text
6 exhaustive score transport --+--> A1 schema contract --> A2 schema-driven transport
                               |                                  |
7 semantic + 9 keyword --------+--> A3 dataset fields in retrieval -+
                                                                  |
                                                                  v
                                                          A4 second-collection proof
```

Task numbers define dependencies. Syntax, weighted-retrieval, and Track A work
can progress independently after their shared contracts stabilize.

## Task List

### Phase 1: Prove the high-risk requirements

- [x] **Task 1: Create reviewed French evaluation test data set**
  - Acceptance: At least 30 reviewed triplets cover vocabulary changes, morphological differences, connection changes, fragments, and multiple sentences.
  - Acceptance: Freeze judgments and separate development items from held-out evaluation items.
  - Verify: Human review of the test data trees and the expected mode relationships. Do not auto-generate expected parses from the selected parser.
  - Files: `src/lib/syntax/test-data/french.json`, `tickets/in_progress/T0004-french-syntax-weighted-retrieval/evaluation.md`.
  - Depends: None. Scope: Small.

- [x] **Task 2: Prove complete Qdrant score enumeration**
  - Acceptance: An isolated collection reproduces exact dense and BM25 scores across identifier batches, including sparse nonmatches and tied scores.
  - Acceptance: Compare the paginated union with exhaustive known identifiers. Verify batch filters do not change corpus IDF scores.
  - Verify: `bun test src/lib/qdrant-completeness.test.ts` against the isolated Qdrant collection. Remove only that test collection afterward.
  - Files: `src/lib/qdrant-completeness.test.ts`, `tickets/in_progress/T0004-french-syntax-weighted-retrieval/retrieval-feasibility.md`.
  - Depends: None. Scope: Small.

### Checkpoint A: Completeness feasibility

Review Tasks 1–2 before production scoring work.
Require a complete result proof, including zero thresholds and mixed moderate-score matches.
If the proposed batch approach fails, revise the transport design before continuing.

- [x] **Task 3: Select the French parser**
  - Acceptance: Test the JavaScript/WASM lead first against required heads, labels, word classes, morphology, and Bun execution.
  - Acceptance: Compare qualifying local alternatives. Record quality, versions, licenses, memory, and warm latency. Obtain dependency approval.
  - Verify: Reproducible parser experiment on the reviewed test data set. Mirror selected official documentation through the librarian workflow before adoption.
  - Files: `tickets/in_progress/T0004-french-syntax-weighted-retrieval/parser-decision.md`, `tickets/in_progress/T0004-french-syntax-weighted-retrieval/evaluation.md`, root `AGENTS.md`, selected local documentation mirror.
  - Depends: Task 1. Scope: Small decision artifact. Documentation acquisition is a bounded librarian operation.

- [x] **Task 4: Define weighted score contracts**
  - Acceptance: Typed contracts distinguish index weights, component scores, combined scores, index generations, and result pages.
  - Acceptance: Validate normalization, weight tolerance, inclusive thresholds, and deterministic identifier ordering with finite-value checks.
  - Acceptance: Normalize the raw Qdrant multivector score with `rawMaxSim / max(queryRows, recordRows)`, so the syntax component score stays in `[0, 1]`.
  - Verify: `bun test src/lib/scoring.test.ts`. Review and freeze the BM25 scale and caller defaults before API migration.
  - Files: `src/lib/scoring.ts`, `src/lib/scoring.test.ts`, `src/lib/retrieval-contract.ts`, `tickets/in_progress/T0004-french-syntax-weighted-retrieval/scoring-decision.md`.
  - Depends: Tasks 1–2. Scope: Medium.

### Checkpoint B: Research decisions

Review Tasks 3–4 with the user.
Confirm parser adoption, normalization formulas, weights, and explicit caller thresholds.
Record decisions in the specification when they resolve its pending items.

### Phase 2: Deliver complete weighted retrieval

- [x] **Task 5: Persist index generation state**
  - Acceptance: Durable state distinguishes rebuilding and ready generations. Server and scripts can detect concurrent writes.
  - Acceptance: Prevent publication after a generation changes during score enumeration. Define recovery for interrupted writers.
  - Verify: `bun test src/lib/index-state.test.ts`, including concurrent reader/writer and failed rebuild cases.
  - Files: `src/lib/index-state.ts`, `src/lib/index-state.test.ts`, `scripts/index-slogans.ts`, `scripts/index-slogans.test.ts`.
  - Depends: Tasks 2, 4. Scope: Medium.

- [x] **Task 6: Add exhaustive Qdrant transport operations**
  - Acceptance: Scroll all filtered identifiers and query exact dense or sparse scores within identifier batches.
  - Acceptance: Distinguish expected sparse nonmatches from missing dense vectors and failed responses. Preserve raw scores.
  - Verify: `bun test src/lib/qdrant.test.ts src/lib/qdrant-completeness.test.ts`.
  - Files: `src/lib/qdrant.ts`, `src/lib/qdrant.test.ts`, `src/lib/qdrant-completeness.test.ts`.
  - Depends: Tasks 2, 4–5. Scope: Medium.

- [x] **Task 7: Deliver semantic-only threshold retrieval**
  - Acceptance: `retrieveWeighted` handles semantic-only queries over all eligible identifiers with filters, component scores, and inclusive thresholds.
  - Acceptance: Exhaustive reference tests cover empty responses, negative cosine, threshold boundaries, and moderate combined-score test cases prepared for later slices.
  - Verify: `bun test src/lib/retrieval.test.ts src/lib/scoring.test.ts`. Keep existing callers working through the intermediate legacy path.
  - Files: `src/lib/retrieval.ts`, `src/lib/retrieval.test.ts`, `src/lib/retrieval-contract.ts`.
  - Depends: Tasks 4–6. Scope: Medium.

### Checkpoint C: Complete semantic slice

Compare all qualifying identifiers against an exhaustive local reference.
Measure cost on representative corpus sizes before extending the scorer.
No fixed candidate cutoff may enter this path.

- [x] **Task 8: Deliver stable result pagination**
  - Acceptance: Snapshots preserve ordered records and scores. Every qualifying identifier appears once across all pages.
  - Acceptance: Bound storage and lifetime. Detect cursor mismatch, expiration, and generation changes without silent truncation.
  - Verify: `bun test src/lib/result-pages.test.ts src/lib/retrieval.test.ts`, including ties, restarts, and capacity errors.
  - Files: `src/lib/result-pages.ts`, `src/lib/result-pages.test.ts`, `src/lib/retrieval.ts`, `src/lib/retrieval.test.ts`.
  - Depends: Tasks 5, 7. Scope: Medium.

- [x] **Task 9: Deliver keyword-weighted threshold retrieval**
  - Acceptance: Keyword-only and semantic/keyword queries use fixed normalization and exact weighted scores. Nonoverlapping records score zero.
  - Acceptance: Moderate contributions can qualify outside each index's small top-K set. Scores remain stable across page and batch sizes.
  - Verify: `bun test src/lib/retrieval.test.ts src/lib/scoring.test.ts src/lib/qdrant-completeness.test.ts`.
  - Files: `src/lib/retrieval.ts`, `src/lib/retrieval.test.ts`, `src/lib/scoring.ts`, `src/lib/scoring.test.ts`.
  - Depends: Tasks 4, 6–8. Scope: Medium.

### Checkpoint D: Weighted matching correctness

Compare full result lists against the exhaustive scorer for keyword-only and mixed weights.
Verify threshold zero includes keyword nonmatches.
Confirm no response-relative normalization or RRF matching scores remain in the new path.

### Phase 2b: Make the Qdrant transport dataset-agnostic

Track A removes the hard-coded slogan coupling from the transport. It does not
change the scoring contract. It can run in parallel with Phase 3 because it
touches `src/lib/qdrant.ts`, `src/lib/retrieval.ts`, and the dataset config, not
the syntax modules.

- [x] **Task A1: Define the collection schema contract**
  - Acceptance: A typed schema names the collection, the dense vector (name, size, distance), the sparse vector (name, modifier), and the payload index fields (name, schema).
  - Acceptance: The schema has no slogan field names and no default collection name. The slogan schema supplies those values at the call site.
  - Acceptance: The transport validates the schema and reports a clear error for a missing or invalid field.
  - Verify: `bun test src/lib/qdrant-schema.test.ts`.
  - Files: `src/lib/qdrant-schema.ts`, `src/lib/qdrant-schema.test.ts`, `src/config/datasets.ts`, `src/config/datasets.test.ts`.
  - Depends: Tasks 4, 6. Scope: Small.

- [x] **Task A2: Pass the schema and field names into the transport**
  - Acceptance: `createQdrantClient` takes a schema instead of raw environment defaults. The collection name, vector layout, and payload indexes come from the schema.
  - Acceptance: `ensureCollection` creates the payload indexes named by the schema, not fixed `annee` and `marque`.
  - Acceptance: The transport accepts an optional filter and fields per call. It reads no payload field by a hard-coded name.
  - Verify: `bun test src/lib/qdrant.test.ts src/lib/qdrant-completeness.test.ts`. Add a case with a non-slogan collection and different field names.
  - Files: `src/lib/qdrant.ts`, `src/lib/qdrant.test.ts`, `src/lib/qdrant-completeness.test.ts`.
  - Depends: Task A1. Scope: Medium.

- [x] **Task A3: Move dataset field names out of retrieval**
  - Acceptance: `src/lib/retrieval.ts` receives the content field, the identifier field, and the filter fields from configuration, not from constants.
  - Acceptance: The year filter builder reads a configured field name and a configured value range. The hit mapper reads configured field names.
  - Acceptance: No slogan field name appears in `src/lib/retrieval.ts`.
  - Verify: `bun test src/lib/retrieval.test.ts`, including a second dataset shape with different filter and content fields.
  - Files: `src/lib/retrieval.ts`, `src/lib/retrieval.test.ts`, `src/lib/retrieval-contract.ts`.
  - Depends: Tasks A1–A2, 7, 9. Scope: Medium.

- [x] **Task A4: Add a second collection end-to-end proof**
  - Acceptance: A second, non-slogan collection (different collection name, vector layout, and payload fields) can be created, indexed, and queried through the same client and retriever.
  - Acceptance: The existing slogan path keeps its behavior. No slogan field name leaks into the shared transport.
  - Verify: `bun test src/lib/qdrant-completeness.test.ts`, plus a new isolated integration test against Qdrant `1.19.1`.
  - Files: `src/lib/qdrant.ts`, `src/lib/retrieval.ts`, `src/config/datasets.ts`, a new integration test file.
  - Depends: Tasks A1–A3. Scope: Medium.

### Checkpoint A2: Transport genericity

Review that the transport has no dataset-specific field name or collection name.
Review the schema contract and the second-collection proof.
Confirm the slogan path is unchanged and the tests still pass.
Status: passed. `bun test` covers a second collection with custom vector and field names.

### Phase 3: Deliver French syntax indexing

- [x] **Task 10: Implement the selected parser adapter**
  - Acceptance: Validate heads, roots, connectivity, cycles, sentence boundaries, and grammatical annotations behind an injectable adapter.
  - Acceptance: Return explicit parse and availability errors. Reuse the loaded local model rather than initialize it per query.
  - Verify: `bun test src/lib/syntax/parser.test.ts`. Run real French parser integration tests with the pinned local model.
  - Files: `src/lib/syntax/parser.ts`, `src/lib/syntax/parser.test.ts`, `src/lib/syntax/udpipe-engine.ts`, `src/lib/syntax/config.ts`, `src/lib/syntax/config.test.ts`, `package.json`, `scripts/init.sh`.
  - Notes: Added the `udpipe-wasm` runtime dependency. Merged the Qdrant setup into one `scripts/init.sh` that also downloads the pinned model with a checksum check. Integration tests skip when the model is absent.
  - Depends: Tasks 1, 3–4. Scope: Medium, at most five files after adapter selection.

- [x] **Task 11: Implement coarse mode abstraction and tree encoding**
  - Acceptance: The `coarse` mode implements the approved feature rules without lexical data. Identical canonical trees yield identical vectors.
  - Acceptance: The abstraction and the encoder take a mode parameter, so the `detailed` mode slots in later without a rewrite. Only `coarse` is implemented and validated in this ticket.
  - Acceptance: Evaluate connected features, choose dimensions and weights, and freeze encoder identity against the held-out items.
  - Acceptance: Weight features by grammatical role, not uniformly. Core-role edges (`root`, `nsubj`, `obj`) weigh more than modifier edges (`advmod`, `det`, `expl`). Checkpoint B measured that uniform weights over-weight a single missing node. See `memos/syntax-trees.md`, section 9. The exact weights and the risk of gap compression stay open for this task.
  - Acceptance: Move the reference scorer into the repository as a reproducible evaluation tool, and drive the frozen weights from it.
  - Verify: `bun test src/lib/syntax/abstraction.test.ts src/lib/syntax/encoder.test.ts`, plus `scripts/evaluate-syntax.ts --mode coarse` on the held-out split. Meet specification targets before database backfill.
  - Files: `src/lib/syntax/abstraction.ts`, `src/lib/syntax/abstraction.test.ts`, `src/lib/syntax/encoder.ts`, `src/lib/syntax/encoder.test.ts`, `scripts/evaluate-syntax.ts`, `tickets/in_progress/T0004-french-syntax-weighted-retrieval/evaluation.md`.
  - Notes: The `coarse` encoder, the role weights, and the reference scorer are committed. Tasks 11a and 11b change the feature set, so the final encoder identity freeze moves to Task 11b (encoder version `coarse-3`).
  - Depends: Tasks 1, 4, 10. Scope: Medium.

- [x] **Task 11a: Evaluate the punctuation loss on the test data set**
  - Acceptance: Build reviewed punctuation-only pairs that differ only by a mark. Cover the terminal marks `.`, `?`, and `!`, and an internal comma. Reuse existing texts, so the set adds no text.
  - Acceptance: Measure the current `coarse` score for every punctuation-only pair. Report each pair that scores equal although its marks differ.
  - Acceptance: Confirm the parser attaches each mark to the head of the clause or phrase it belongs to, following the UD `punct` rules.
  - Acceptance: Decide, with the user, that the punctuation marks enter the `ast` vector. Record the decision in `memos/syntax-trees.md` and `tickets/in_progress/T0004-french-syntax-weighted-retrieval/evaluation.md`.
  - Verify: `bun test src/lib/syntax/test-data.test.ts` and `scripts/evaluate-syntax.ts --mode coarse` on the pairs. Human review of the expected relations.
  - Files: `src/lib/syntax/test-data/french.json`, `src/lib/syntax/test-data.test.ts`, `scripts/evaluate-syntax.ts`, `tickets/in_progress/T0004-french-syntax-weighted-retrieval/evaluation.md`, `memos/syntax-trees.md`.
  - Notes: `scripts/evaluate-syntax.ts` derives the variants from `Quelle belle journée !` (terminal marks) and `Voir, c'est croire` (internal comma). Before the change, every cross-mark pair scored `1.000000`.
  - Depends: Tasks 1, 10–11. Scope: Small.

- [x] **Task 11b: Re-include the punctuation marks in the syntax tree**
  - Acceptance: Keep every `PUNCT` node in its position, with the governor the parser assigned. Do not drop or remap it.
  - Acceptance: Read the punctuation `LEMMA` into a `punctuationMark` field on the abstract node. Drop `FORM` and `LEMMA` for every other token, so content-word vocabulary never enters the encoder.
  - Acceptance: The encoder gives the mark an explicit weight. `Il vient` and `Il vient ?` no longer score `1.0`; `?` and `!` differ; a `.` and no mark differ; the same mark stays identical.
  - Acceptance: Revise the mode table and the functional requirement in `spec.md`. Record the punctuation-mark exception and its source.
  - Acceptance: Freeze a new encoder version (`coarse-3`) and re-evaluate the held-out split. Meet the specification target before the syntax backfill.
  - Verify: `bun test src/lib/syntax/abstraction.test.ts src/lib/syntax/encoder.test.ts` and `scripts/evaluate-syntax.ts --mode coarse` on the held-out split. Update `bun test src/lib/syntax/test-data.test.ts`.
  - Files: `src/lib/syntax/abstraction.ts`, `src/lib/syntax/abstraction.test.ts`, `src/lib/syntax/encoder.ts`, `src/lib/syntax/encoder.test.ts`, `src/lib/syntax/test-data/french.json`, `tickets/in_progress/T0004-french-syntax-weighted-retrieval/spec.md`, `tickets/in_progress/T0004-french-syntax-weighted-retrieval/evaluation.md`, `memos/syntax-trees.md`.
  - Depends: Task 11a. Scope: Medium.

### Checkpoint E: Syntax quality

Review the two supplied French examples with the `coarse` mode.
Require identical coarse representations.
Verify lexical metadata never enters the encoder and review held-out ranking-case results.
Review the frozen role weights against the role-weighting finding from Checkpoint B (`memos/syntax-trees.md`, section 9).
Review the punctuation evaluation (Task 11a) and the punctuation-mark feature (Task 11b).
Confirm that `Il vient`, `Il vient ?`, and `Il vient !` no longer score `1.0`, and that two texts with the same mark stay identical.
Status: passed. The `coarse` mode reaches `100%` ranking and structural accuracy on the expected trees. Every different-mark pair scores below one, and two texts with the same mark stay identical. The encoder identity is frozen at version `coarse-3`.

- [x] **Task 12: Add syntax schema and vector updates**
  - Acceptance: Create the named multivector with the `max_sim` comparator through documented Qdrant operations. Validate dimension, comparator, and configuration compatibility.
  - Acceptance: Update syntax values without replacing existing dense vectors, BM25 vectors, or business payload fields.
  - Acceptance: Store one matrix row per sentence and keep one point per record. Keep the row count within the Qdrant limit `rows * size < 1,048,576`.
  - Verify: `bun test src/lib/qdrant.test.ts src/lib/index-state.test.ts`, plus an isolated collection preservation test.
  - Files: `src/lib/qdrant.ts`, `src/lib/qdrant.test.ts`, `src/lib/index-state.ts`, `src/lib/index-state.test.ts`.
  - Depends: Tasks 5–6, 11b. Scope: Medium.

- [x] **Task 13: Deliver syntax backfill**
  - Acceptance: Implement `index-syntax.ts --mode coarse` over existing records with complete coverage and exclusion accounting. The flag accepts the mode name, so the deferred `detailed` mode needs no interface change.
  - Acceptance: Clear stale syntax values on failed or excluded records. Prevent mixed modes and publish readiness only after validation.
  - Verify: `bun test scripts/index-syntax.test.ts`. Run the `coarse` mode on an isolated test collection and compare other vectors before and after.
  - Files: `scripts/index-syntax.ts`, `scripts/index-syntax.test.ts`, `src/lib/syntax/config.ts`, `src/lib/syntax/config.test.ts`.
  - Depends: Tasks 10–12. Scope: Medium.

- [ ] **Task 14: Deliver syntax-weighted retrieval**
  - Acceptance: Syntax-only and three-index queries use persisted syntax configuration and exact combined matching scores.
  - Acceptance: Skip unselected dependencies. Selected syntax enforces readiness and the documented unsupported-record eligibility policy.
  - Verify: `bun test src/lib/retrieval.test.ts src/lib/syntax/config.test.ts`. Check all weight combinations against exhaustive test data set scores.
  - Files: `src/lib/retrieval.ts`, `src/lib/retrieval.test.ts`, `src/lib/retrieval-contract.ts`.
  - Depends: Tasks 9, 13. Scope: Medium.

### Checkpoint F: All indexes work together

Verify syntax alone, each other index alone, and all three combined.
Check partial syntax coverage, parser unavailability, and unselected parser independence.
Follow all pages and compare matching identifiers against the reference scorer.

### Phase 4: Publish the API and migrate callers

- [ ] **Task 15: Publish weighted API parameters**
  - Acceptance: Validate `weights`, `minScore`, `pageSize`, and `cursor`. Reject obsolete `topK` and `mode` parameters.
  - Acceptance: Preserve filters and record fields. Expose scores, metadata, cursors, and documented 400/409/410/503 errors.
  - Verify: `bun test src/server/api.test.ts src/lib/retrieval.test.ts`. Exercise both specification curl examples.
  - Files: `src/server/api.ts`, `src/server/api.test.ts`, `src/server/index.ts`.
  - Depends: Tasks 8–9, 14. Scope: Medium.

- [ ] **Task 16a: Migrate the chat tool contract**
  - Acceptance: Remove tool `topK` and RRF assumptions. Use explicit scoring settings and expose continuation metadata.
  - Acceptance: Distinguish a page from complete results. Preserve citations and existing provider behavior.
  - Verify: `bun test src/server/chat.test.ts`. Manual chat smoke check with reviewed retrieval settings.
  - Files: `src/server/chat.ts`, `src/server/chat.test.ts`.
  - Depends: Tasks 4, 15. Scope: Small.

- [ ] **Task 16b: Migrate the retrieval panel**
  - Acceptance: Use explicit weights and threshold. Follow continuation pages without treating page size as a total match limit.
  - Acceptance: Keep existing display fields. Show an empty response correctly and handle expired cursors without duplicate records.
  - Verify: Manual browser checks for empty, single-page, and multiple-page results. Follow component README and AGENTS rules.
  - Files: `src/components/app/RetrievalPanel.tsx`, its stylesheet only if continuation handling needs presentation changes.
  - Depends: Task 15. Scope: Small. No new syntax or weight controls.

- [ ] **Task 16c: Integrate full indexing and smoke callers**
  - Acceptance: Full indexing optionally populates syntax using the active configuration and generation lifecycle.
  - Acceptance: Smoke checks use weighted parameters and test complete pages. Remove the remaining legacy retrieval path after caller migration.
  - Verify: `bun test scripts/index-slogans.test.ts src/lib/retrieval.test.ts` and `bun run smoke` against the ready test index.
  - Files: `scripts/index-slogans.ts`, `scripts/index-slogans.test.ts`, `scripts/smoke-retrieval.ts`, `src/lib/retrieval.ts`, `src/lib/retrieval.test.ts`.
  - Depends: Tasks 13, 15, 16a–16b. Scope: Medium.

### Checkpoint G: Caller migration

Search application sources and scripts for remaining `topK`, `retrieveHybrid`, and fused-score assumptions.
Verify deliberate obsolete-parameter tests are the only remaining public contract references.
Run the API, chat, retrieval panel, and smoke flows before final evaluation.

### Phase 5: Measure and document release readiness

- [ ] **Task 17a: Deliver reproducible evaluation commands**
  - Acceptance: Implement the `coarse` mode evaluation command and report grammar quality, ranking, full-result equality, and runtime measurements.
  - Acceptance: Include corpus size, vector dimensions, normalization parameters, memory, page cost, and component timings in reports.
  - Verify: Run `evaluate-syntax.ts --mode coarse` against an isolated collection. Compare all results with the exhaustive reference.
  - Files: `scripts/evaluate-syntax.ts`, `scripts/evaluate-syntax.test.ts`, `tickets/in_progress/T0004-french-syntax-weighted-retrieval/evaluation.md`.
  - Depends: Tasks 11, 14, 16c. Scope: Medium.

- [ ] **Task 17b: Document migration and close verification**
  - Acceptance: Document parser setup, syntax backfill, weighted API requests, continuation handling, cursor bounds, and API migration.
  - Acceptance: Record approved operational targets and all specification success criteria, including explicit exclusions and complete matching.
  - Verify: `bun test`, `bun run lint`, `bun run smoke`, and both specification curl examples. Format edited source files with Biome.
  - Files: root `README.md`, `scripts/README.md`, `tickets/in_progress/T0004-french-syntax-weighted-retrieval/spec.md`, `tickets/in_progress/T0004-french-syntax-weighted-retrieval/evaluation.md`, `tickets/in_progress/T0004-french-syntax-weighted-retrieval/plan.md`.
  - Depends: Tasks 16a–16c, 17a. Scope: Medium.

### Checkpoint H: Release review

Review measured quality, complete-result correctness, and corpus-scale costs with the user.
Require all specification criteria before declaring completion.
If runtime costs exceed approved limits, revise the design rather than weaken result completeness silently.
Plan approval is required before application implementation. A commit requires a separate explicit user request.

## Risks and Mitigations

| Risk                                                    | Impact | Mitigation                                                                                                              |
| ------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------- |
| JavaScript parser lacks morphology or Bun compatibility | High   | Test the WASM lead early. Use an approved local fallback with complete annotations.                                     |
| Batch filtering changes keyword score statistics        | High   | Prove score equivalence in Task 2 before implementing weighted scoring.                                                 |
| Exhaustive scoring costs grow with corpus size          | High   | Measure early. Use bounded transport and explicit capacity errors. Preserve completeness.                               |
| Query snapshots exceed memory                           | High   | Bound lifetime and storage. Evaluate disk storage before release when needed. Never truncate matches.                   |
| Rebuild races mix index generations                     | High   | Coordinate all project write paths and reject changed-generation queries and cursors.                                   |
| Hash collisions erase tree differences                  | Medium | Evaluate connected features and dimensions against the reviewed connection-change cases.                                |
| Parser mistakes alter expected trees                    | Medium | Separate manual-tree encoder tests from actual parser evaluations.                                                      |
| Punctuation removal erases sentence type                | Medium | Task 11a measures the loss on the test data set. Task 11b keeps the punctuation nodes in position and weights the mark. |
| BM25 transformation gives misleading thresholds         | Medium | Tune on the development items and validate held-out threshold behavior. Publish score semantics.                        |
| API migration breaks chat or retrieval panel            | High   | Migrate each known caller before removing the legacy internal path.                                                     |
| Hard-coded dataset fields block other collections       | High   | Track A removes the slogan collection name and field names from the transport. Prove with a second collection.          |

## Scheduling and Parallel Work

Tasks 1 and 2 are independent research units.
After Task 4, parser and encoder work can progress independently from pagination and semantic/keyword retrieval.
Qdrant transport, generation state, and indexing changes share files and must proceed sequentially.
Track A changes `qdrant.ts` and `retrieval.ts`. Schedule Track A before Phase 3 changes that add the `ast` vector to the same transport.
Caller migrations can proceed independently after the final API contract is stable.
These are scheduling opportunities, not instructions to spawn implementation agents.

## Deferred Work

The project defers these items to a future ticket. Each item is out of scope for
this ticket, but the code keeps a seam for it, so the future work does not force
a rewrite.

### Detailed syntax mode

The `coarse` mode is enough to prove the end-to-end system. The `detailed`
mode adds the grammatical features to the `ast` vector.

- The `detailed` mode retains an allowlist of features: `Definite`, `Gender`,
  `Mood`, `Number`, `Person`, `Tense`, `VerbForm`, and `Voice`.
- The `coarse` mode removes all features but keeps the punctuation marks.
- The abstraction and the encoder take a mode parameter. A future ticket adds
  the `detailed` branch. The interfaces do not change.
- The syntax index stores one active mode per generation. The deferred work
  adds the second mode and its reindex run.
- The specification records the full mode table in `spec.md`, section 1.

The future ticket must:

- implement the `detailed` branch in `abstraction.ts`.
- add the detailed feature weights and dimensions.
- evaluate the detailed mode on the reviewed test data set.
- run a `detailed` backfill.
- revalidate the syntax success targets for the detailed mode.

## Decisions to Resolve at Checkpoints

- Checkpoint B: parser/model versions, dependency approval, normalization parameters, and caller thresholds.
- Checkpoint C: corpus-size measurements and generation publication guarantees.
- Checkpoint E: coarse encoder dimensions, features, weights, quality targets, and the punctuation-mark decision from Task 11a.
- Checkpoint H: snapshot storage, lifetime, page bounds, and measured release latency targets.

Every research decision must produce an artifact. Stop for review when a decision changes an approved requirement.

## Glossary

- **Backfill:** Addition of `ast` vectors to existing indexed records.
- **Collection schema:** The typed description of one Qdrant collection: its name, its vectors, and its payload index fields.
- **Component score:** A normalized matching score from one selected index.
- **Dataset coupling:** A transport that knows the field names of one dataset. The project removes it in Track A.
- **Exact search:** A vector search that does not use approximate nearest-neighbor candidate selection.
- **Generation:** A fixed version of indexed data and scoring configuration.
- **Held-out item:** A test data set entry reserved from parameter tuning.
- **IDF:** A keyword weight based on how frequently a term occurs across the corpus.
- **Mode:** The indexing setting that chooses which grammatical details the `ast` vector keeps. The `coarse` mode keeps the structure only. The `detailed` mode also keeps an allowlist of features. Both modes keep the punctuation marks.
- **Query snapshot:** The complete ordered results and metadata retained for stable page delivery.
- **Punctuation mark:** The symbol of a punctuation node, for example `?`, `!`, `.`, or `,`. Both modes keep it in position with the parser governor, and the encoder weights it. Tasks 11a and 11b evaluate and encode it.
- **Sparse nonmatch:** A record without overlapping keyword-vector entries. Its keyword score is zero.
- **Threshold:** The inclusive minimum combined score required for a record to qualify.
- **Track A:** The task group that makes the Qdrant transport dataset-agnostic.
- **Vertical slice:** A small working retrieval path from query input through scoring to results.
- **Weighted score:** The sum of component scores multiplied by their selected contribution weights.

## Implementation Notes

### Task 12 — Syntax schema, vector storage, and publication state

#### Design decisions

- `CollectionSchema` gains an optional `ast` multivector. `validateSchema` checks the name,
  the row size, the `max_sim` comparator, and the name clash with `dense.name` and `sparse.name`.
  `multiVectorConfig(schema)` is the single writer of the `multivector_config` shape, and both
  `vectorConfig` (collection creation) and the transport's vector-schema update read it, so the
  two call sites cannot drift.
- The transport exposes three operations, and `Point`/`PointVectors` stay unchanged. A point
  upsert writes the dense and BM25 vectors only. Task 12 stores the abstract tree through
  `updateAstVectors`, which sends the `ast` key alone, so the dense vector, the BM25 vector,
  and the business payload are never rewritten.
- `ensureAstVector` reads `GET /collections/{name}` and inspects `config.params.vectors`. The
  helper accepts the single unnamed description, the map keyed by vector name, and a list of
  named descriptions, so a shape change cannot silently return "absent". An existing definition is
  then validated against `schema.ast` before the method reports it as compatible.
- `queryAstExact` reuses `withIds`, `params: { exact: true }`, and the `onMissing` policy of
  `queryDenseExact`. It returns the raw score and never clamps it.
- `MULTIVECTOR_SUBVECTOR_LIMIT` (`1_048_576`) and `maxMultiVectorRows(size)` are exported.
  `MultiVectorLimitError` names the record, the row count, the row size, and the limit. Every
  matrix is checked before the request, on both the write and the query path, and rows are never
  truncated. With the frozen 256-dimension encoder the maximum is 4095 rows.
- `index-state.ts` adds `syntax?: SyntaxIndexState` to the generation record plus `publishSyntax`
  and `assertSyntaxReady`. `publishSyntax` refuses a foreign writer token, a changed generation,
  a `ready` state whose `indexed + unsupported + failed` differs from `eligible`, a `ready` state
  whose exclusion list length differs from `unsupported + failed`, a duplicate exclusion
  identifier, and any exclusion with no identifier or a blank reason. Publishing the syntax state
  does not publish the generation: the record stays `rebuilding` until `publish` runs, and
  `publish` keeps the nested syntax state.
- `assertSyntaxReady` throws `StaleGenerationError` for a changed generation and
  `SyntaxNotReadyError` with a `reason` of `missing`, `pending`, or `config-mismatch` otherwise.
  The `configId` check is the "reject incompatible runtime configuration" rule of the spec.
  `assertReady` is unchanged.

#### Review fixes (independent audit)

**B1 — silent exclusions.** `validateSyntaxCoverage` now requires
`exclusions.length === coverage.unsupported + coverage.failed` in addition to the sum check, and
rejects a duplicate exclusion identifier. A `ready` state that reports five unsupported records and
lists none is refused with `InvalidSyntaxCoverageError`. The `SyntaxIndexState.exclusions` JSDoc now
states the real rule instead of the contradictory "never empty without a reason list".

**B2 — stored definition validation.** The collection-info reader now returns a
`Map<string, StoredVectorDescription>` (`size`, `multivector_config.comparator`) instead of a set of
names. When the `ast` name already exists, `ensureAstVector` compares the stored `size` and
comparator with `schema.ast` and raises `IncompatibleAstVectorError` with the vector name and
both shapes. A `size: 128` definition and a plain dense vector with no `multivector_config` both
fail fast instead of failing on the first query. The reader still accepts the three documented
shapes, including an array of named descriptions.

**Quality items.** A matrix with no row now raises `MultiVectorValueError` before any request, on
both `updateAstVectors` and `queryAstExact`, so an empty parse never leaves a record
searchable. `maxMultiVectorRows` rejects a non-positive or non-integer size. `jsonVectorValue` uses
`Number.isSafeInteger` for the decimal-point path, so `1e21` keeps its valid exponent form. A
non-finite value raises the typed `MultiVectorValueError`, which carries the offending value, so a
backfill can record the record as failed. `DenseVectorConfig` is renamed `VectorDescription`,
`multiVectorConfig` takes a `MultiVectorSchema` and `vectorConfig` guards once, the collection-info
reader uses `in`/`typeof` for both branches, `request` has a JSDoc block, and
`ExactDenseQuery.ids` and `ExactAstQuery.ids` document that the identifiers must already satisfy
`filter` (the `missing` computation is unchanged).

Deliberately not implemented: `publishSyntax` still accepts a published generation, because a
syntax-only backfill never rewrites the dense, BM25, or payload data. The generation lifecycle
belongs to Task 13.

#### Naming of the index and the stored vector

The public index name and the Qdrant vector name differ on purpose, and the mapping lives in one
place: the JSDoc of `CollectionSchema.ast`.

```text
public index name  : syntax   (API weights, IndexName, spec §4)
Qdrant vector name : ast      (CollectionSchema.ast, storage, queries)
```

The vector stores the encoded abstract tree, so `ast` names what is stored. The index names the
search kind, so `syntax` stays parallel to `semantic` and `keyword`. The rename changed the storage
names only: `CollectionSchema.ast`, `multiVectorConfig()`, `ensureAstVector`, `updateAstVectors`,
`queryAstExact`, `ExactAstQuery`, and `IncompatibleAstVectorError`. Every public index-state name
(`SyntaxIndexState`, `publishSyntax`, `assertSyntaxReady`, and the rest) keeps the word `syntax`,
because those types describe the index. `spec.md` §3 was updated to name the vector `ast` and to
state the mapping; §4 keeps the public index names unchanged. The `ast vector` glossary entry in
`README.md` records the same mapping for readers.

#### Verified documentation gaps and server behavior (local Qdrant 1.19.1)

The measurements below are recorded in full, with the probe commands and the
checks to repeat after an upgrade, in `memos/qdrant-multivector-behavior.md`.

- The prose of "Adding and Removing Named Vectors" says the body accepts only `size` and
  `distance`. The server also accepts `multivector_config` in that body. After the call,
  `GET /collections/{name}` reports `config.params.vectors.<name>.multivector_config.comparator`.
- The documented body key `"dense"` is a vector **type** discriminator, not the vector name:
  the vector name comes from the path. Sending the vector name as the body key fails with
  `Format error in JSON body: data did not match any variant of untagged enum VectorNameConfig`.
  The transport keeps the documented `dense` key and records this in a code comment.
- A JSON matrix whose rows are all integers is read as the legacy sparse-vector form
  `[[indices], [values]]` and is rejected with
  `Wrong input: Conversion between sparse and regular vectors failed`. The transport therefore
  serializes every matrix value with a decimal point (`1.0`, not `1`). The numeric value does not
  change. A unit test asserts the raw request text.
- `max_sim` is unbounded above: two identical query rows against a two-row record score `2.0`.
  A record with an `ast` vector but no matching row scores `0.0` and is still returned; a record
  with no `ast` vector is absent from the response, which is the `MissingVectorError` signal.
- Records without an `ast` vector are never returned by the ast query, so the missing-vector
  detection needs no extra request.

#### Isolated integration probe (deleted afterwards)

Ran against `http://127.0.0.1:6333` on collection `t0004-task12-probe`, then deleted it. The
`slogans` collection was never touched. Observed: `ensureAstVector` returned `true`, then
`false`; `updateAstVectors` stored two rows on point 1 while the dense vector, the BM25 vector,
and the payload stayed byte-identical; `queryAstExact` returned the raw `2.0`; the collection
info reported the `max_sim` configuration; a 4096-row matrix raised `MultiVectorLimitError`
without a request.

A second probe recreated `t0004-task12-probe` with a plain dense `syntax` vector of size 128 and
confirmed that `ensureAstVector` raises `IncompatibleAstVectorError` with
`found = { size: 128 }`. The collection was deleted afterwards, so `slogans` is the only
collection left on the local server.

#### Deliberately left to later tasks

- Task 13 adds `syntax` to the dataset schema in `src/config/datasets.ts`, implements the backfill
  script, and decides the exclusion reasons and the coverage numbers it publishes.
- Task 16c decides whether the full indexer also passes syntax through `upsert`, and wires
  `publishSyntax` and `assertSyntaxReady` into the generation lifecycle.
- Task 14 normalizes the raw `max_sim` score to `[0, 1]` with
  `rawMaxSim / max(queryRows, recordRows)`.

#### Gate output

```text
$ bun fmt
Formatted 0 files, 180 unchanged [11.34ms]

$ bun fmt --check
All 180 files are formatted.

$ bun run lint
$ biome lint .
Checked 87 files in 74ms. No fixes applied.

$ bun test
bun test v1.4.4 (38afee6c8)

 375 pass
 0 fail
 4208 expect() calls
Ran 375 tests across 25 files. [4.22s]
```

### Task 13 — Syntax backfill

#### Configuration identity

`src/lib/syntax/config.ts` now owns the whole reproducible identity and the single source of
each component:

- `PARSER_PACKAGE_NAME = "udpipe-wasm"`. `parserPackageVersion()` reads **`bun.lock`**, not the
  range in `package.json`. The manifest declares `^0.1.0`, so a lockfile bump inside that range
  would leave a manifest-only identity unchanged while the parser code changed. The lock file pins
  the resolved version and its `sha512-` integrity, so `parserPackageVersion()` returns
  `udpipe-wasm@0.1.0+sha512.en9Ex7j8` — resolved version plus the first 8 characters of the
  integrity in base64.
  - `readParserPackageIdentity(lockText?)` is exported as the parsing seam. Without an argument it
    reads `bun.lock`; with one it parses the given text and never touches the cache, so a test
    cannot poison the process-wide identity. Eight tests cover the injected text: the version and
    integrity prefix, a changed version, a changed integrity, a versioned `udpipe-wasm@…` key, the
    ambiguity message, the missing-entry message, the versionless message, and the non-`sha512`
    message.
  - The lock lookup accepts a plain `udpipe-wasm` key and a `udpipe-wasm@…` key. Bun uses the plain
    key for a single resolution and versioned keys when several resolve. Two matches at once raise
    a message that names both keys instead of claiming the package does not resolve.
  - Only a **resolved string** is cached. A failed read or parse leaves the cache empty, so the next
    call retries; the earlier version cached the promise and repeated a rejection for the life of
    the process. The cache is `string | undefined`, never a promise.
  - The text is parsed with `Bun.JSONC.parse`, because the lock file holds trailing commas.
- `UDPIPE_MODEL_RELEASE`, `UDPIPE_MODEL_NAME`, `UDPIPE_MODEL_FILE`, and `UDPIPE_MODEL_SHA256`
  mirror `scripts/init.sh`. `DEFAULT_MODEL_PATH` is derived from the file name, so the script and
  the code cannot disagree. `syntaxModelRevision()` returns
  `ud-2.5-191206:french-gsd-ud-2.5-191206.udpipe:sha256:3b10…ea30`.
- `SYNTAX_LANGUAGE = "fr"`, `encoderVersion` and `dimensions` come from `DEFAULT_ENCODER_CONFIG`.
- `ABSTRACTION_VERSIONS` (`coarse-1`, `detailed-0`) lives in `config.ts`, not in `abstraction.ts`,
  because `abstraction.ts` is outside this ticket's scope. The `coarse` rule set is frozen; the
  `detailed` value is declared only, because that branch is deferred.
- `syntaxConfigId(fields)` hashes the canonical JSON of the fields with
  `crypto.subtle.digest("SHA-256", …)`, keeps the first 16 lowercase hex characters, and sorts the
  keys first, so key insertion order cannot change the result. `buildSyntaxIndexConfiguration(mode)`
  takes the mode as a parameter, so the deferred mode needs no interface change.

`src/config/datasets.ts` declares `ast: { name: "ast", size: DEFAULT_ENCODER_CONFIG.dimensions,
distance: "Cosine", comparator: "max_sim" }` in both dataset schemas. `datasets.test.ts` asserts
**both** `ast.size === 256` (a literal) **and** `ast.size === DEFAULT_ENCODER_CONFIG.dimensions`.
The earlier version derived both sides from the encoder constant, so it could not fail; the pair of
assertions now catches a silent dimension change on either side.

#### Backfill behaviour

`scripts/index-syntax.ts` exposes `indexSyntax(dependencies, options)`, `schemaForCollection(name)`,
`resolveCliTarget({ collection, statePath })`, and the CLI. The run:

1. reads the state, resolves `options.generation ?? current.generation`, then calls
   `assertReady(generation)`, so a rebuild owned by another writer is refused before any write;
2. builds the configuration and refuses a generation whose stored syntax mode differs, with
   `SyntaxModeClashError`;
3. refuses a generation whose stored `configId` differs, with `SyntaxConfigurationChangeError`;
4. calls `ensureAstVector()` and lets `IncompatibleAstVectorError` propagate;
5. enumerates identifiers with `scrollIds()`, applies `--limit`, and takes that count as
   `eligible`;
6. fetches payloads per batch, reads `datasetConfigurations.slogans.contentField`, parses,
   abstracts, and encodes one row per sentence;
7. writes successes with one `updateAstVectors` call per identifier batch, and retries a failed
   batch one record at a time, so one bad record marks only itself failed;
8. clears the `ast` vector of every excluded record, in identifier batches;
9. publishes once, with one exclusion entry per excluded record.

The `ast` name comes straight from `datasetConfigurations.slogans.collectionSchema.ast.name`. A
schema without an `ast` vector raises `InvalidSchemaError("ast", …)`; there is no `?? "ast"`
fallback that could silently guess a vector name.

Exclusion policy:

| Cause                                       | Bucket        | Reason                      |
| ------------------------------------------- | ------------- | --------------------------- |
| payload has no string content field         | `unsupported` | `missing content field`     |
| `EmptyInputError` / `ParseValidationError`  | `unsupported` | the error message           |
| `AbstractionError`                          | `unsupported` | the error message           |
| encoder yields zero rows or any zero vector | `unsupported` | `empty structure`           |
| `ParserUnavailableError`                    | abort         | rethrown, nothing published |
| any other error, including a failed update  | `failed`      | the error message           |
| a failed clear of that record               | `failed`      | `clear failed: <message>`   |

`AbstractionError` is deterministic and structural — an empty sentence or a sentence with no root —
so it joins the unsupported branch instead of `failed`.

The zero-vector rule honours the encoder JSDoc ("the caller must treat that as an error before
indexing"). A run with `indexed === 0` and `eligible > 0` still publishes when every record is
listed as an exclusion, because `publishSyntax` validates
`indexed + unsupported + failed === eligible` and `exclusions.length === unsupported + failed`. An
empty collection publishes `ready` with `{ eligible: 0, indexed: 0, unsupported: 0, failed: 0 }`.

#### Truncation: a partial run publishes `pending`, never `ready`

`--limit N` narrows the identifier set, so it narrows `eligible`. The run computes
`truncated = ids.length < scrolled.length`. When the run is truncated it logs
`Warning: --limit covered n of m records, so this run publishes pending, not ready` and publishes
`status: "pending"` with the real coverage of the slice. Records outside the slice are never
enumerated, so publishing `ready` would claim complete coverage of a generation that does not have
it. `assertSyntaxReady` treats a `pending` syntax state as not ready, so reads stay blocked until a
full run accounts for every record. A `--limit` at or above the collection size is not truncated
and still publishes `ready`.

#### Configuration changes need a new generation

A re-run in the same mode after a parser, model, abstraction, or encoder bump produces a new
`configId` while the old `ready` state keeps being served and the stored vectors are overwritten in
place. The run therefore compares `record.syntax?.configuration.configId` with the newly built
`configId` and refuses on a difference with `SyntaxConfigurationChangeError`, which names the
generation, the persisted fingerprint, and the requested one, and states that a configuration
change needs a new generation rather than a backfill. The mode clash is checked first, because a
mode difference also changes the fingerprint; the caller then gets the more specific error. A
re-run with the same configuration, including a re-run that finishes a `pending` truncation, is
accepted.

#### Collection override and the state file are coupled

`resolveCliTarget({ collection, statePath })` returns the schema and the state path of one CLI run.
The generation state describes exactly one collection, so a run against another collection without
its own state file would publish probe coverage into the real generation. When `--collection` names
a collection other than the dataset default and `INDEX_STATE_PATH` is unset, blank, or **resolves to
the default file**, the target resolver throws `CustomCollectionStateError`, whose message names the
collection and tells the caller to set `INDEX_STATE_PATH`. The comparison is
`resolve(statePath) === resolve(DEFAULT_INDEX_STATE_PATH)`, so `data/index-state.json`,
`./data/index-state.json`, `data/../data/index-state.json`, and the absolute form of the default are
all refused; a genuinely different path is accepted, and a default-collection run needs no path at
all. Verified through the CLI as well as in the unit tests.

#### Clearing stale syntax values

`QdrantClient.deleteVectors(ids, vectors, options?)` is a generic transport operation: the vector
names come from the caller, so it is not tied to `ast`. It calls the documented endpoint of
Qdrant 1.19.1, `docs/Qdrant - 1.19.1/documentation/manage-data/points/index.md`, section
"Delete Vectors" (available since v1.2.0):

```http
POST /collections/{collection_name}/points/vectors/delete?wait=true
{ "points": [2], "vectors": ["ast"] }
```

Verified behaviour, on the local 1.19.1 server: the point keeps `dense`, keeps `bm25`, keeps its
payload, and loses only `ast`; the point itself is never deleted. The operation is **idempotent** on
an existing point: deleting `ast` twice succeeds again. Deleting `ast` for a point id that does not
exist fails with `Not found: No point with id 99 found`.

**Verified batch fact (1.19.1):** a batch that mixes a present and an absent point, such as
`{"points": [1, 99]}`, returns the absent-point error **and still clears point 1**. The batch is
applied partially, then the error is raised. A reviewer claim that a whole batch can be skipped does
not hold for this version. Relying on that partial application is still undocumented behaviour, so
`deleteVectors` treats it as a defensive boundary rather than a guarantee:

1. the batch request runs first;
2. if it answers an absent point, the same identifiers are retried **one at a time**; each
   single-identifier request is unambiguous, so a success and an already-absent answer both count
   as cleared, and anything else throws;
3. any other failure on the first request (`5xx`, a missing collection) throws immediately, with no
   retry.

A vanished point is recognised by the documented message `No point with id`, not by status 404,
because a missing collection also answers 404. The JSDoc of the method records the endpoint, the
preservation guarantee, the idempotence, and the partial-application fact, so the per-identifier
fallback is not mistaken for a correctness requirement. The signature is unchanged:
`(ids, vectors, { wait?, log? })`.

The backfill clears through `deleteVectors(ids, [ast.name])` in batches of `batchSize`. A batch
whose clear throws is logged, and its records move to `failed` with the reason
`clear failed: <message>`; they are never left counted as `unsupported` with a possibly stale
vector. `cleared` counts the identifiers the run asked Qdrant to delete.

#### Live probe (isolated collection through the CLI, deleted afterwards)

Ran against `http://127.0.0.1:6333` on `t0004-task13-probe`, seeded with four points that carry a
real 1024-dimension dense vector, a Qdrant BM25 vector, and a full payload. Point 4 holds a blank
text and a **pre-existing** `ast` vector, so the run must clear it rather than write one. The run
used `INDEX_STATE_PATH=.tmp/probe-state.json`.

First the refusal, with no state path:

```text
$ bun run scripts/index-syntax.ts --collection t0004-task13-probe
[index-syntax] failed: --collection t0004-task13-probe needs its own state file: set
INDEX_STATE_PATH to a path other than the default, because the default state file describes the
slogans collection
```

Then the real run:

```text
$ INDEX_STATE_PATH=.tmp/probe-state.json bun run scripts/index-syntax.ts --collection t0004-task13-probe
[index-syntax] Generation a9791475-…: mode coarse, configuration ccd33e7a68f91bd7, encoder coarse-3
[index-syntax] The ast vector definition already exists
[index-syntax] Enumerated 4 eligible record(s)
[index-syntax] Excluded 4 (unsupported): input text is blank
[index-syntax] Published a9791475-… as ready: eligible 4, indexed 3, unsupported 1, failed 0, cleared 1
```

Before and after comparison:

```text
point 1: dense true, bm25 true, payload true, ast 1 row(s)
point 2: dense true, bm25 true, payload true, ast 1 row(s)
point 3: dense true, bm25 true, payload true, ast 1 row(s)
point 4: dense true, bm25 true, payload true, ast absent
preserved true
syntax status ready
syntax coverage {"eligible":4,"indexed":3,"unsupported":1,"failed":0}
```

Point 4 started with an `ast` vector and ended without one, which is the real clear. A second run
with `--limit 2` on the same collection logged `Warning: --limit covered 2 of 4 records, so this
run publishes pending, not ready` and published `as pending: eligible 2, indexed 2, unsupported 0,
failed 0, cleared 0`, which is the truncation rule confirmed against the live server.

The probe collection, `.tmp/probe-state.json`, the before-snapshot, and the seed script were
deleted afterwards. `slogans` and `data/index-state.json` were never touched; `slogans` is again the
only collection on the local server, and `git status` shows no change to `data/index-state.json`.

#### Gate output

```text
$ bun fmt
Formatted 0 files, 182 unchanged [11.35ms]

$ bun fmt --check
All 182 files are formatted.

$ bun run lint
$ biome lint .
Checked 89 files in 52ms. No fixes applied.

$ bun test
bun test v1.4.4 (38afee6c8)

 435 pass
 0 fail
 4345 expect() calls
Ran 435 tests across 26 files. [3.39s]

$ bunx tsc --noEmit
(no output)
```

#### Deliberately left to later tasks

- Task 16c wires the backfill into the full indexer and passes the active configuration and the
  generation lifecycle through.
- Task 14 normalizes the raw `max_sim` score to `[0, 1]` and applies the unsupported-record
  eligibility policy at query time.
