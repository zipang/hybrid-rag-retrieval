# Implementation Plan: [T0004] French Syntax Index and Weighted Threshold Retrieval

Ticket: `T0004`  
Specification: [spec.md](spec.md), approved by the user.  
Plan status: Ready for review. Application implementation has not started.

## Overview

Add French grammatical-tree vectors and replace rank-based retrieval with explicit weighted matching scores.
Return every eligible record meeting `minScore`, with stable pagination.
Deliver a semantic-only complete retrieval slice first. Extend it with keyword scoring, then syntax scoring.

## Architecture Decisions

### Separate parsing, abstraction, encoding, and retrieval

Place grammatical components in `src/lib/syntax/`.
The parser adapter returns validated grammatical annotations.
Abstraction removes vocabulary and selects the indexing profile.
The deterministic encoder uses only abstract structure.
Retrieval orchestrates selected indexes, normalization, combination, thresholding, and pagination.
Keep HTTP input handling and Qdrant transport separate from scoring logic.

### Use one active syntax profile per collection generation

Store the active profile and complete parser/model/encoder identity with the index generation.
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
                       |                                                  |
2 Qdrant proof --------+--> 4 scoring contracts --> 5 generation state      |
                                                 |                        |
                                                 v                        v
                                     6 exhaustive score transport --> 12 syntax storage
                                                 |                        |
                                                 v                        v
                                     7 semantic threshold slice      13 syntax backfill
                                                 |                        |
                                                 v                        v
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
  - Verify: Human review of the test data trees and the expected profile relationships. Do not auto-generate expected parses from the selected parser.
  - Files: `src/lib/syntax/test-data/french.json`, `roadmap/T0004/evaluation.md`.
  - Depends: None. Scope: Small.

- [x] **Task 2: Prove complete Qdrant score enumeration**
  - Acceptance: An isolated collection reproduces exact dense and BM25 scores across identifier batches, including sparse nonmatches and tied scores.
  - Acceptance: Compare the paginated union with exhaustive known identifiers. Verify batch filters do not change corpus IDF scores.
  - Verify: `bun test src/lib/qdrant-completeness.test.ts` against the isolated Qdrant collection. Remove only that test collection afterward.
  - Files: `src/lib/qdrant-completeness.test.ts`, `roadmap/T0004/retrieval-feasibility.md`.
  - Depends: None. Scope: Small.

### Checkpoint A: Completeness feasibility

Review Tasks 1–2 before production scoring work.
Require a complete result proof, including zero thresholds and mixed moderate-score matches.
If the proposed batch approach fails, revise the transport design before continuing.

- [x] **Task 3: Select the French parser**
  - Acceptance: Test the JavaScript/WASM lead first against required heads, labels, word classes, morphology, and Bun execution.
  - Acceptance: Compare qualifying local alternatives. Record quality, versions, licenses, memory, and warm latency. Obtain dependency approval.
  - Verify: Reproducible parser experiment on the reviewed test data set. Mirror selected official documentation through the librarian workflow before adoption.
  - Files: `roadmap/T0004/parser-decision.md`, `roadmap/T0004/evaluation.md`, root `AGENTS.md`, selected local documentation mirror.
  - Depends: Task 1. Scope: Small decision artifact. Documentation acquisition is a bounded librarian operation.

- [x] **Task 4: Define weighted score contracts**
  - Acceptance: Typed contracts distinguish index weights, component scores, combined scores, index generations, and result pages.
  - Acceptance: Validate normalization, weight tolerance, inclusive thresholds, and deterministic identifier ordering with finite-value checks.
  - Acceptance: Normalize the raw Qdrant multivector score with `rawMaxSim / max(queryRows, recordRows)`, so the syntax component score stays in `[0, 1]`.
  - Verify: `bun test src/lib/scoring.test.ts`. Review and freeze the BM25 scale and caller defaults before API migration.
  - Files: `src/lib/scoring.ts`, `src/lib/scoring.test.ts`, `src/lib/retrieval-contract.ts`, `roadmap/T0004/scoring-decision.md`.
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

- [ ] **Task 11: Implement coarse profile abstraction and tree encoding**
  - Acceptance: The `coarse` profile implements the approved feature rules without lexical data. Identical canonical trees yield identical vectors.
  - Acceptance: The abstraction and the encoder take a profile parameter, so the `detailed` profile slots in later without a rewrite. Only `coarse` is implemented and validated in this ticket.
  - Acceptance: Evaluate connected features, choose dimensions and weights, and freeze encoder identity against the held-out items.
  - Acceptance: Weight features by grammatical role, not uniformly. Core-role edges (`root`, `nsubj`, `obj`) weigh more than modifier edges (`advmod`, `det`, `expl`). Checkpoint B measured that uniform weights over-weight a single missing node. See `memos/syntax-trees.md`, section 9. The exact weights and the risk of gap compression stay open for this task.
  - Acceptance: Move the reference scorer into the repository as a reproducible evaluation tool, and drive the frozen weights from it.
  - Verify: `bun test src/lib/syntax/abstraction.test.ts src/lib/syntax/encoder.test.ts`, plus `scripts/evaluate-syntax.ts --profile coarse` on the held-out split. Meet specification targets before database backfill.
  - Files: `src/lib/syntax/abstraction.ts`, `src/lib/syntax/abstraction.test.ts`, `src/lib/syntax/encoder.ts`, `src/lib/syntax/encoder.test.ts`, `scripts/evaluate-syntax.ts`, `roadmap/T0004/evaluation.md`.
  - Depends: Tasks 1, 4, 10. Scope: Medium.

### Checkpoint E: Syntax quality

Review the two supplied French examples with the `coarse` profile.
Require identical coarse representations.
Verify lexical metadata never enters the encoder and review held-out ranking-case results.
Review the frozen role weights against the role-weighting finding from Checkpoint B (`memos/syntax-trees.md`, section 9).

- [ ] **Task 12: Add syntax schema and vector updates**
  - Acceptance: Create the named multivector with the `max_sim` comparator through documented Qdrant operations. Validate dimension, comparator, and configuration compatibility.
  - Acceptance: Update syntax values without replacing existing dense vectors, BM25 vectors, or business payload fields.
  - Acceptance: Store one matrix row per sentence and keep one point per record. Keep the row count within the Qdrant limit `rows * size < 1,048,576`.
  - Verify: `bun test src/lib/qdrant.test.ts src/lib/index-state.test.ts`, plus an isolated collection preservation test.
  - Files: `src/lib/qdrant.ts`, `src/lib/qdrant.test.ts`, `src/lib/index-state.ts`, `src/lib/index-state.test.ts`.
  - Depends: Tasks 5–6, 11. Scope: Medium.

- [ ] **Task 13: Deliver syntax backfill**
  - Acceptance: Implement `index-syntax.ts --profile coarse` over existing records with complete coverage and exclusion accounting. The flag accepts the profile name, so the deferred `detailed` profile needs no interface change.
  - Acceptance: Clear stale syntax values on failed or excluded records. Prevent mixed profiles and publish readiness only after validation.
  - Verify: `bun test scripts/index-syntax.test.ts`. Run the `coarse` profile on an isolated test collection and compare other vectors before and after.
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
  - Acceptance: Implement the `coarse` profile evaluation command and report grammar quality, ranking, full-result equality, and runtime measurements.
  - Acceptance: Include corpus size, vector dimensions, normalization parameters, memory, page cost, and component timings in reports.
  - Verify: Run `evaluate-syntax.ts --profile coarse` against an isolated collection. Compare all results with the exhaustive reference.
  - Files: `scripts/evaluate-syntax.ts`, `scripts/evaluate-syntax.test.ts`, `roadmap/T0004/evaluation.md`.
  - Depends: Tasks 11, 14, 16c. Scope: Medium.

- [ ] **Task 17b: Document migration and close verification**
  - Acceptance: Document parser setup, syntax backfill, weighted API requests, continuation handling, cursor bounds, and API migration.
  - Acceptance: Record approved operational targets and all specification success criteria, including explicit exclusions and complete matching.
  - Verify: `bun test`, `bun run lint`, `bun run smoke`, and both specification curl examples. Format edited source files with Biome.
  - Files: root `README.md`, `scripts/README.md`, `roadmap/T0004/spec.md`, `roadmap/T0004/evaluation.md`, `roadmap/T0004/plan.md`.
  - Depends: Tasks 16a–16c, 17a. Scope: Medium.

### Checkpoint H: Release review

Review measured quality, complete-result correctness, and corpus-scale costs with the user.
Require all specification criteria before declaring completion.
If runtime costs exceed approved limits, revise the design rather than weaken result completeness silently.
Plan approval is required before application implementation. A commit requires a separate explicit user request.

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| JavaScript parser lacks morphology or Bun compatibility | High | Test the WASM lead early. Use an approved local fallback with complete annotations. |
| Batch filtering changes keyword score statistics | High | Prove score equivalence in Task 2 before implementing weighted scoring. |
| Exhaustive scoring costs grow with corpus size | High | Measure early. Use bounded transport and explicit capacity errors. Preserve completeness. |
| Query snapshots exceed memory | High | Bound lifetime and storage. Evaluate disk storage before release when needed. Never truncate matches. |
| Rebuild races mix index generations | High | Coordinate all project write paths and reject changed-generation queries and cursors. |
| Hash collisions erase tree differences | Medium | Evaluate connected features and dimensions against the reviewed connection-change cases. |
| Parser mistakes alter expected trees | Medium | Separate manual-tree encoder tests from actual parser evaluations. |
| BM25 transformation gives misleading thresholds | Medium | Tune on the development items and validate held-out threshold behavior. Publish score semantics. |
| API migration breaks chat or retrieval panel | High | Migrate each known caller before removing the legacy internal path. |
| Hard-coded dataset fields block other collections | High | Track A removes the slogan collection name and field names from the transport. Prove with a second collection. |

## Scheduling and Parallel Work

Tasks 1 and 2 are independent research units.
After Task 4, parser and encoder work can progress independently from pagination and semantic/keyword retrieval.
Qdrant transport, generation state, and indexing changes share files and must proceed sequentially.
Track A changes `qdrant.ts` and `retrieval.ts`. Schedule Track A before Phase 3 changes that add the syntax vector to the same transport.
Caller migrations can proceed independently after the final API contract is stable.
These are scheduling opportunities, not instructions to spawn implementation agents.

## Deferred Work

The project defers these items to a future ticket. Each item is out of scope for
this ticket, but the code keeps a seam for it, so the future work does not force
a rewrite.

### Detailed syntax profile

The `coarse` profile is enough to prove the end-to-end system. The `detailed`
profile adds the grammatical features to the syntax vector.

- The `detailed` profile retains an allowlist of features: `Definite`, `Gender`,
  `Mood`, `Number`, `Person`, `Tense`, `VerbForm`, and `Voice`.
- The `coarse` profile removes all features.
- The abstraction and the encoder take a profile parameter. A future ticket adds
  the `detailed` branch. The interfaces do not change.
- The syntax index stores one active profile per generation. The deferred work
  adds the second profile and its reindex run.
- The specification records the full profile table in `spec.md`, section 1.

The future ticket must:
- implement the `detailed` branch in `abstraction.ts`.
- add the detailed feature weights and dimensions.
- evaluate the detailed profile on the reviewed test data set.
- run a `detailed` backfill.
- revalidate the syntax success targets for the detailed profile.

## Decisions to Resolve at Checkpoints

- Checkpoint B: parser/model versions, dependency approval, normalization parameters, and caller thresholds.
- Checkpoint C: corpus-size measurements and generation publication guarantees.
- Checkpoint E: coarse encoder dimensions, features, weights, and quality targets.
- Checkpoint H: snapshot storage, lifetime, page bounds, and measured release latency targets.

Every research decision must produce an artifact. Stop for review when a decision changes an approved requirement.

## Glossary

- **Backfill:** Addition of syntax vectors to existing indexed records.
- **Collection schema:** The typed description of one Qdrant collection: its name, its vectors, and its payload index fields.
- **Component score:** A normalized matching score from one selected index.
- **Dataset coupling:** A transport that knows the field names of one dataset. The project removes it in Track A.
- **Exact search:** A vector search that does not use approximate nearest-neighbor candidate selection.
- **Generation:** A fixed version of indexed data and scoring configuration.
- **Held-out item:** A test data set entry reserved from parameter tuning.
- **IDF:** A keyword weight based on how frequently a term occurs across the corpus.
- **Profile:** The indexing setting that chooses which grammatical details the syntax vector keeps. The `coarse` profile keeps the structure only. The `detailed` profile also keeps an allowlist of features.
- **Query snapshot:** The complete ordered results and metadata retained for stable page delivery.
- **Sparse nonmatch:** A record without overlapping keyword-vector entries. Its keyword score is zero.
- **Threshold:** The inclusive minimum combined score required for a record to qualify.
- **Track A:** The task group that makes the Qdrant transport dataset-agnostic.
- **Vertical slice:** A small working retrieval path from query input through scoring to results.
- **Weighted score:** The sum of component scores multiplied by their selected contribution weights.
