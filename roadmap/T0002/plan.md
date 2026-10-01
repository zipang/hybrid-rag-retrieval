# Implementation Plan: [T0002] Schema-Driven Dataset Extraction

Ticket: `T0002` — spec: `roadmap/T0002/spec.md`

## Overview

Move corpus files from `data/` to `datasets/`. Add record models under `src/models/`. Each model exports its JSON Schema, its `tjs` validator, its inferred TypeScript type, and a validation function. Keep corpus and field settings in `src/config/datasets.ts`. Refactor text extraction for slogans and citations. Update T0001 so its later Qdrant work uses these generic contracts.

## Architecture Decisions

- **Record contract:** `src/models/slogan.ts` and `src/models/citation.ts` own the record JSON Schema and exports. Each module exports its schema definition, `tjs` validator, inferred type, and validation function. Property keys are canonical field names. Titles provide fallback labels. The generic reader does not contain record field names.
- **Dataset configuration:** `src/config/datasets.ts` owns the corpus path, model schema, content field, and identifier field. Source labels stay in schema property titles. T0001 owns Qdrant collection settings.
- **Corpus location:** Rename `data/` to `datasets/`. Update the root README, `.gitignore`, dataset README, and dataset agent instructions. Keep corpus files ignored by Git.
- **Reader:** Keep the in-memory and streaming readers in `src/utils/data-utils.ts`. Pass each dataset schema and validator as input. Match property keys first and titles second. Do not require field lines to follow schema order.
- **Rejected records:** Skip invalid records, count them, and continue to the next block. Return counts from the reader so T0001 can report them during indexing.
- **Tests:** Write focused tests before changing each behavior. Use inline or checked-in test fixtures. Do not require ignored corpus files or a live Qdrant instance for unit tests.

## Dependency Graph

```text
Rename corpus directory ────────────────────────┐
                                                │
tjs dependency → record models → generic reader ├→ T0001 spec and plan update
                          └→ dataset configuration┘
```

T0002 ends after it provides generic extraction and updates T0001's ticket context. T0001 owns Qdrant helpers, indexing, and any related query work.

## Task List

### Phase 1: Dataset and model foundation

- [x] **Task 1: Rename the corpus directory**
  - Acceptance: Rename `data/` to `datasets/` and preserve any local corpus files without changing their contents. Move the tracked dataset instructions. Update the root README and `.gitignore`. Rewrite the dataset README to describe the generic block format and schema-based setup. Git ignores corpus files and keeps only the directory README and agent instructions.
  - Verify: Compare the local corpus files before and after the move. `git check-ignore datasets/citations.txt` reports the corpus file as ignored. Confirm `datasets/README.md` and `datasets/AGENTS.md` remain trackable.
  - Files: `README.md`, `.gitignore`, `data/README.md` → `datasets/README.md`, `data/AGENTS.md` → `datasets/AGENTS.md`
  - Depends: None
  - Scope: Medium

- [x] **Task 2: Add TJS record models**
  - Acceptance: Add `tjs` 7.0.0 to `package.json` and `bun.lock`. Add slogan and citation model modules under `src/models/`. Each module exports a JSON Schema definition, a `tjs` validator, an inferred record type, and a validation function. Numeric text fields coerce to numbers. Tests check valid records, invalid records, optional fields, and type exports.
  - Verify: `bun install`, `bun test src/models/models.test.ts`, and `bun run lint` pass. No TypeScript compiler is configured, so no separate static type check runs. Do not add a compiler dependency in this ticket.
  - Files: `package.json`, `bun.lock`, `src/models/slogan.ts`, `src/models/citation.ts`, `src/models/models.test.ts`
  - Depends: None
  - Scope: Medium

### Checkpoint: Foundation

- [x] The corpus path and Git ignore rules use `datasets/`.
- [x] Both models validate their dataset records and expose inferred types.
- [x] `bun test` and `bun run lint` pass.

### Phase 2: Generic read and dataset configuration

- [x] **Task 3: Generalize the text readers**
  - Acceptance: Add generic in-memory and streaming readers that accept a model schema and validator. Match each line by its schema property title. Validate and coerce each block. Skip invalid blocks, count rejections, and continue. Preserve the current slogan reader behavior through schema-backed wrappers where needed.
  - Verify: `bun test src/utils/data-utils.test.ts` covers both datasets, equivalent in-memory and streaming output, trailing blocks, missing fields, coercion, and rejection counts.
  - Files: `src/utils/data-utils.ts`, `src/utils/data-utils.test.ts`
  - Depends: Task 2
  - Scope: Small

- [x] **Task 4: Add dataset configurations**
  - Acceptance: Add typed configurations for slogans and citations. Each configuration links the matching model schema and validator to a `datasets/` path, content field, and identifier field. Do not duplicate source labels in configuration. Do not add Qdrant collection settings in T0002. Reject invalid configuration at compile time where the type contract can express it.
  - Verify: `bun test src/config/datasets.test.ts` checks both configurations and their schema titles. `bun run lint` passes.
  - Files: `src/config/datasets.ts`, `src/config/datasets.test.ts`
  - Depends: Tasks 1, 2
  - Scope: Small

### Checkpoint: Generic extraction

- [x] Both schemas parse matching fixture blocks through the same reader implementation.
- [x] Existing slogan tests pass without field-specific parser logic.
- [x] Invalid blocks do not stop streaming.

### Phase 3: Update the T0001 handoff

- [x] **Task 5: Update the T0001 specification and plan**
  - Acceptance: Update `roadmap/T0001/spec.md` and `roadmap/T0001/plan.md` to use the new `datasets/` path and the T0002 model, reader, and dataset configuration contracts. Keep Qdrant helpers and indexing implementation in T0001. Update the T0001 tasks that still describe the hard-coded slogan parser. Do not add Qdrant code to T0002.
  - Verify: Check that T0001 no longer plans a duplicate corpus parser. Confirm its Qdrant and indexing tasks depend on the T0002 extraction contract. Check all corpus paths and commands in both ticket documents.
  - Files: `roadmap/T0001/spec.md`, `roadmap/T0001/plan.md`
  - Depends: Tasks 1–4
  - Scope: Small

### Checkpoint: T0001 handoff

- [x] T0001 uses the generic T0002 reader and model exports.
- [x] T0001 retains ownership of Qdrant helpers and indexing behavior.
- [x] T0001 contains no duplicate parser task or stale `data/` corpus path.

### Phase 4: Schema descriptions and query context

- [x] **Task 6: Require descriptions in record schemas**
  - Acceptance: Add a shared schema type that requires a root description and a description on every property. Add non-empty descriptions to all slogan and citation schema fields. Each property description starts with `Content field`, `Filter field`, or `Record identifier`.
  - Verify: `bun test src/models/models.test.ts` checks every property description and role. `bun run lint` passes.
  - Files: `src/models/schema.ts`, `src/models/slogan.ts`, `src/models/citation.ts`, `src/models/models.test.ts`, `datasets/AGENTS.md`
  - Depends: Tasks 2, 4
  - Scope: Medium

- [x] **Task 7: Document field roles and query-agent use**
  - Acceptance: Document the content, filter, and identifier roles for every field in both datasets. Explain how query agents use these descriptions as context. Update T0001's specification and chat task to use schema descriptions when it builds query context. Keep Qdrant implementation in T0001.
  - Verify: Compare every table entry in `datasets/README.md` with its schema description. Confirm T0001's chat task names the content and filter roles. Run `bun run lint`.
  - Files: `datasets/README.md`, `roadmap/T0002/spec.md`, `roadmap/T0002/plan.md`, `roadmap/T0001/spec.md`, `roadmap/T0001/plan.md`
  - Depends: Task 6
  - Scope: Medium

### Phase 5: Match source labels from JSON Schema

- [x] **Task 8: Add source labels to schema properties**
  - Acceptance: Require a `title` on every property in `DescribedRecordSchema`. Treat property keys as canonical names. Set each title to the legacy source label when it differs from its key. Keep schema properties in the customary corpus order for readability.
  - Verify: `bun test src/models/models.test.ts` checks every title and its expected order for slogans and citations.
  - Files: `src/models/schema.ts`, `src/models/slogan.ts`, `src/models/citation.ts`, `src/models/models.test.ts`
  - Depends: Task 6
  - Scope: Medium

- [x] **Task 9: Resolve keys before title fallbacks**
  - Acceptance: Pass each model schema through dataset configuration. Remove duplicate source-label maps. Make the reader match source lines to property keys first and titles second. Keep line matching independent of field order.
  - Verify: `bun test src/config/datasets.test.ts src/utils/data-utils.test.ts` checks canonical keys, title fallbacks, colliding key/title values, and out-of-order slogan lines.
  - Files: `src/config/datasets.ts`, `src/config/datasets.test.ts`, `src/utils/data-utils.ts`, `src/utils/data-utils.test.ts`
  - Depends: Task 8
  - Scope: Medium

- [x] **Task 10: Document schema labels and order behavior**
  - Acceptance: Document that property keys are canonical, titles are fallback labels, and properties follow customary corpus order. State that the reader checks keys before titles and accepts lines in any order. Update the project glossary, dataset instructions, T0002 spec, and plan.
  - Verify: Compare the field table, schema titles, and parser behavior for both datasets.
  - Files: `README.md`, `datasets/README.md`, `datasets/AGENTS.md`, `roadmap/T0002/spec.md`, `roadmap/T0002/plan.md`
  - Depends: Tasks 8, 9
  - Scope: Medium

- [x] **Task 11: Update the T0001 schema handoff**
  - Acceptance: Update T0001's spec and plan to state that property keys are canonical labels and titles are fallback labels. State that the query agent uses schema descriptions for content and filter context. Keep Qdrant indexing in T0001.
  - Verify: Confirm both T0001 documents refer to schema titles and descriptions. Confirm no file-label map remains in the planned data flow.
  - Files: `roadmap/T0001/spec.md`, `roadmap/T0001/plan.md`
  - Depends: Tasks 8–10
  - Scope: Small

### Phase 6: Rejection diagnostics

- [x] **Task 12: Include a reason in each rejected event**
  - Acceptance: Each rejected reader event includes its block number and a reason. Report missing separators, unknown labels, and TJS validation errors with useful field context. Keep logging outside the reader.
  - Verify: `bun test src/utils/data-utils.test.ts` checks each rejection reason and confirms the reader continues after an invalid block.
  - Files: `src/utils/data-utils.ts`, `src/utils/data-utils.test.ts`, `datasets/README.md`, `roadmap/T0002/spec.md`, `roadmap/T0002/plan.md`
  - Depends: Task 9
  - Scope: Medium

- [x] **Task 13: Require the T0001 importer to log rejections**
  - Acceptance: Update T0001's spec and plan. The importer logs each rejected record with its corpus path, block number, and reason. It continues to later blocks and reports accepted and rejected totals.
  - Verify: Confirm the T0001 indexing task includes a test with an invalid block followed by a valid block. Confirm the log includes the file, block, and reason.
  - Files: `roadmap/T0001/spec.md`, `roadmap/T0001/plan.md`, `roadmap/T0002/plan.md`
  - Depends: Task 12
  - Scope: Small

### Checkpoint: Complete

- [x] All T0002 success criteria in `roadmap/T0002/spec.md` pass.
- [x] `bun test` and `bun run lint` pass.
- [x] Biome reports no issues in edited source files.
- [x] Ready for human review.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| TJS infers a broad type from a widened schema object | High | Keep schema definitions as readonly literals and add type-focused checks before implementing the generic reader. |
| Corpus files are ignored and absent in a clean checkout | Medium | Keep unit tests independent from local corpus files. Use matching fixtures in tests. |
| The current project has no declared TypeScript compiler or type-check script | Medium | Use an existing compiler if available. Ask before adding a compiler dependency. |
| Directory rename changes ignore behavior | Low | Verify the new ignore rules with `git check-ignore` and confirm documentation files remain trackable. |
| T0001 keeps stale assumptions about the slogan parser | Medium | Update its spec and plan after the generic extraction contract is complete. |

## Open Questions

- None. This ticket does not add a separate TypeScript compiler dependency.

## Glossary

- **BM25**: A ranking method that scores records by their matching words.
- **Content field**: The text field that carries the record's meaning and enters semantic and lexical indexing.
- **Dataset configuration**: Settings that link a corpus file and record model to content and identifier fields.
- **Filter field**: A metadata field that narrows results without entering content indexing.
- **JSON Schema**: A JSON structure that declares record fields, types, and validation rules.
- **Query agent**: An LLM that uses schema descriptions to choose content and filter fields for a search.
- **Record identifier**: The source ID that lets the system identify a record.
- **Record model**: A module that exports a record's JSON Schema, inferred TypeScript type, and validator.
- **Schema title**: The JSON Schema `title` field that stores the exact source label for a corpus field.
- **Streaming reader**: A reader that processes one record block at a time instead of loading the full file into memory.
- **Type inference**: The process that derives a TypeScript type from a value, such as a schema literal.
