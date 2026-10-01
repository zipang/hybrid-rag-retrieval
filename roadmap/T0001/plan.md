# Implementation Plan: [T0001] Qdrant RAG Demo — Hybrid Slogan Retrieval + LLM Chat

Ticket: `T0001` — spec: `roadmap/T0001/spec.md`

## Overview

Build the POC with a bare-metal Qdrant instance. A Bun script reads
`datasets/slogans.txt` through the generic T0002 reader. It writes dense and
Qdrant BM25 vectors to one collection. A retrieval API exposes hybrid search.
A raw-HTML chat page calls retrieval as a tool through the Vercel AI SDK. Each
phase leaves a runnable system.

## Architecture Decisions

- **Bare-metal Qdrant, REST via `fetch`.** No Docker, no official SDK. Setup is
  a shell script + `.gitignore`d `qdrant/` directory (binary + storage).
- **One collection, named vectors.** Collection `slogans` stores `dense`
  (multilingual-e5 embedding, computed client-side) and `bm25` (Qdrant-native
  BM25 sparse, `modifier: idf`) per point, with payload
  `{ id, annee, marque, campagne, slogan }`. One point per slogan. The numeric
  corpus `Id` is the Qdrant point id (uint64); the payload keeps `id` as a
  string. Payload indexes (`annee` integer, `marque` keyword) are created
  before points are ingested.
- **Keyword side is Qdrant's job.** BM25 inference (`qdrant/bm25`) runs inside
  the Qdrant cluster. Because BM25 defaults to English, the app sets
  `language: "french"`, `ascii_folding: true`, and a slogan-sized `avg_len`,
  and sends the same `options` at ingest and query time. Lowercasing is the
  default. The app ships no tokenizer.
- **Hybrid fusion = Qdrant Query API prefetch + RRF.** The dense prefetch sends
  the client-side query vector as a raw array; the BM25 prefetch sends
  `{ text, model: "qdrant/bm25", options }`. Both are fused server-side with
  `{ "rrf": {} }` (which also exposes `k` and per-prefetch `weights`), so the
  API stays thin and there is no client-side fusion code to maintain.
- **Embedder behind a factory.** `createEmbedder(env)` returns local
  (`fastembed`) by default and lets a cloud provider replace it through env
  only. Index pipeline never imports a concrete provider.
- **Dataset extraction comes from T0002.** Use the slogan record model,
  dataset configuration, and `streamDataset` events. Property keys are the
  canonical field names. Titles support legacy corpus labels. The reader checks
  keys first. Do not add a second parser or hard-code labels in the indexer.
- **Streaming, idempotent indexing.** Parse + embed + upsert in bounded batches
  that stay under Qdrant's 32 MB request limit; the script drops/recreates the
  collection, recreates the payload indexes, then upserts, so reruns are safe.
- **AI SDK with an OpenAI-compatible adapter.** One adapter covers OpenAI,
  Mistral, Ollama, and other compatible endpoints via `AI_PROVIDER_URL` /
  `AI_API_KEY` / `AI_MODEL`.

## Task List

T0002 is a prerequisite for the indexing tasks. It owns the dataset models,
schema titles, and generic in-memory and streaming readers.

### Phase 1: Foundation

- [x] **Task 1: Project scaffolding, env config, Qdrant setup**
  - Acceptance: `package.json` with deps (`ai`, provider adapter, `@fastembed`) and scripts (`dev`, `test`, `index`, `smoke`); `biome.jsonc` + `.editorconfig` matching tab/no-comment rules; `.env.sample` documents `QDRANT_URL`, `QDRANT_COLLECTION`, `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, `BM25_LANGUAGE`, `BM25_ASCII_FOLDING`, `BM25_AVG_LEN`, `AI_PROVIDER_URL`, `AI_API_KEY`, `AI_MODEL`, `PORT`; `scripts/setup-qdrant.sh` downloads + unzips the static Linux binary into `qdrant/`; `.gitignore` excludes `qdrant/`, `.env`, `node_modules/`.
  - Verify: `bun install` succeeds; `bash scripts/setup-qdrant.sh && (cd qdrant && ./qdrant --config-path config/config.yaml &)` responds on `curl localhost:6333`; `bunx biome check .` clean.
  - Files: `package.json`, `biome.jsonc`, `.editorconfig`, `.env.sample`, `.gitignore`, `scripts/setup-qdrant.sh`
  - Depends: None

- [x] **Task 2: Generic corpus reader from T0002**
  - Acceptance: T0002 provides `parseDataset` and `streamDataset`, with schemas and configuration for slogans and citations. Slogan property keys are canonical. Titles provide fallback labels such as `Id`, `Année`, `Marque`, `Campagne`, and `Slogan`. The reader checks keys before titles. Dataset configuration selects the schema, content field, and identifier field. It defaults a missing campaign to an empty string. Invalid blocks are rejected and counted.
  - Verify: `bun test src/models/models.test.ts src/utils/data-utils.test.ts src/config/datasets.test.ts` passes for both datasets. The stream reader keeps one block in memory.
  - Files: `src/models/`, `src/config/datasets.ts`, `src/utils/data-utils.ts`, `src/utils/data-utils.test.ts`
  - Depends: T0002 Tasks 2–4

- [x] **Task 3: Dense embedder factory (local + swappable)**
  - Acceptance: `createEmbedder(env)` returns an `Embedder` with `dims`, `embedDenseDocuments` and `embedDenseQuery`; local provider uses `fastembed` with the multilingual-e5-large dense model; unknown provider or missing cloud key throws a clear error; provider is selected by `EMBEDDING_PROVIDER`. The keyword/BM25 side is not in the app (Qdrant handles it).
  - Verify: `bun test src/lib/embedder.test.ts` passes against injected fake models; manual one-off prints dense dims (1024) and lengths.
  - Files: `src/lib/embedder.ts`, `src/lib/embedder.test.ts`
  - Depends: Task 1

- [x] **Task 4: Qdrant client helpers + collection schema**
  - Acceptance: thin `fetch` wrapper (`ensureCollection`, `upsert`, `queryHybrid`, `deleteCollection`) reads `QDRANT_URL`; `ensureCollection` creates `slogans` with a `dense` (Cosine, size 1024) named vector and a `bm25` sparse vector with `modifier: "idf"`, then creates payload indexes `annee` (integer) and `marque` (keyword); the collection is created only if absent (probe `GET /collections/{name}/exists`). `ensureCollection` must run before any upsert so the payload indexes exist before ingestion (required for Qdrant's filterable HNSW).
  - Verify: `bun test src/lib/qdrant.test.ts` passes with a stubbed `fetch`; manually, `curl localhost:6333/collections/slogans` shows both vector configs and the two payload indexes after running the helper.
  - Files: `src/lib/qdrant.ts`, `src/lib/qdrant.test.ts`
  - Depends: Task 1

### Checkpoint: Foundation
- [x] `bun test` green; Qdrant starts from the binary and the collection can be created
- [ ] Review with human before indexing the corpus

### Phase 2: Core Features

- [x] **Task 5: Index slogans through the generic reader**
  - Acceptance: `bun run scripts/index-slogans.ts` loads `datasetConfigurations.slogans` and consumes `streamDataset` events from `datasets/slogans.txt`. It logs every rejected block with the corpus path, block number, and reason. It continues to valid records and reports accepted and rejected totals. It reads each valid record's content and identifier through configuration. It computes dense embeddings client-side and upserts the dense vector plus Qdrant's BM25 inference vector. The script stays idempotent, batches points under Qdrant's 32 MB REST request limit, logs progress, exits non-zero on failure, and supports `--limit N` for smoke runs.
  - Verify: `bun test scripts/index-slogans.test.ts` confirms the importer logs the corpus path, block number, and reason, then indexes a following valid record. Also run `bun run scripts/index-slogans.ts --limit 500` and confirm Qdrant reports 500 points.
  - Files: `scripts/index-slogans.ts`, `scripts/index-slogans.test.ts`
  - Depends: T0002 Tasks 2–4, T0001 Tasks 3–4

- [x] **Task 6: Hybrid retrieval**
  - Acceptance: `retrieveHybrid(query, { topK, yearFrom, yearTo })` embeds the query (dense) and issues a Qdrant Query API request with two prefetches — dense sent as a raw vector (`{ query: [...], using: "dense", limit }`) and BM25 as `{ query: { text, model: "qdrant/bm25", options }, using: "bm25" }`, with the **same** `options` as ingestion — fused server-side with `{ "rrf": {} }`; prefetch `limit` is `>= topK`; applies year-range payload filters (`range: { gte, lte }` on `annee`); requests `with_payload: true`; returns ranked `{ score, id, annee, marque, campagne, slogan }`; empty query or zero hits returns an empty list, never throws.
  - Verify: `bun test src/lib/retrieval.test.ts` passes (request shape, filter shape, empty result); manual smoke against indexed data.
  - Files: `src/lib/retrieval.ts`, `src/lib/retrieval.test.ts`
  - Depends: Tasks 3, 4

- [x] **Task 7: Retrieval API endpoint**
  - Acceptance: `GET /api/slogans?q=&topK=&yearFrom=&yearTo=` returns `{ results: [...] }` JSON with CORS; invalid/empty `q` returns 400 with a message; errors are caught and mapped to JSON status codes; `Bun.serve()` entrypoint serves static files from `demo/`.
  - Verify: with Qdrant running and data indexed, `curl "localhost:3000/api/slogans?q=sucre&yearFrom=2004&yearTo=2005"` returns relevant slogans; `bun test src/server/api.test.ts` covers the parameter/error cases with a stubbed retrieval.
  - Files: `src/server/index.ts`, `src/server/api.ts`, `src/server/api.test.ts`
  - Depends: Task 6

- [x] **Task 8: Chat endpoint with AI SDK tool calling**
  - Acceptance: `POST /api/chat` streams a response via the AI SDK; the model is configured from env through an OpenAI-compatible adapter; a `searchSlogans` tool wraps `retrieveHybrid`; the system prompt uses the T0002 slogan schema descriptions to identify the content and filter fields, and instructs the model to answer only from retrieved slogans with brand/year context.
  - Verify: with a valid `AI_API_KEY`/`AI_MODEL`, `curl -N` against `/api/chat` returns a streamed answer that invoked the tool for the query "slogans sur le sucre"; without a key the endpoint returns a clear 500 JSON error.
  - Files: `src/server/index.ts`, `src/server/chat.ts`, `src/server/chat.test.ts`
  - Depends: Task 7

### Checkpoint: Core Features
- [ ] End-to-end: HTTP query returns hybrid results; chat returns an answer grounded in retrieved slogans
- [ ] Review the three README example queries with the human before UI polish

### Phase 3: Polish

- [x] **Task 9: Demo chat UI**
  - Acceptance: `demo/index.html` is a single raw HTML/JS page (no build step) with a message list, input, streaming token rendering, and a toggle/listing of the slogans the last turn retrieved; it posts to `/api/chat` and renders markdown-free plain text.
  - Verify: open `localhost:3000`; ask each README example query; answers stream and cited slogans match `/api/slogans` results.
  - Files: `demo/index.html`
  - Depends: Task 8

- [x] **Task 10: Smoke script + ticket docs**
  - Acceptance: `bun run scripts/smoke-retrieval.ts` runs the three README example queries and prints ranked results for manual inspection; a short `roadmap/T0001/README.md` documents setup → index → query → chat; `.env.sample` is complete.
  - Verify: smoke script produces non-empty sensible results for all three queries; a fresh reader can follow the README from zero.
  - Files: `scripts/smoke-retrieval.ts`, `roadmap/T0001/README.md`
  - Depends: Tasks 5, 7

### Checkpoint: Complete
- [ ] All spec success criteria met
- [ ] `bunx biome check .` clean, `bun test` green
- [ ] Ready for human review

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Local embedding of ~265k slogans is slow / memory-heavy | Med | `--limit` flag for quick runs; batch + stream; revisit model choice if indexing exceeds a practical budget |
| Multilingual dense model download is large (~1GB) and slow on first run | Low | Download once and cache (fastembed `cacheDir`); document in README |
| Qdrant binary URL/arch changes across releases | Low | Pin a documented release URL in `setup-qdrant.sh`; fail loudly if download 404s |
| Provider adapter mismatch (Ollama vs OpenAI tool-call format) | Med | Use the OpenAI-compatible adapter; keep model config env-driven; verify with at least two endpoints |
| Payload filter syntax on year range is easy to get wrong | Low | Unit-test the filter shape; verify against real data in the smoke script |
| BM25 defaults to English, and ingest/query options drift | High | Set `language: "french"`, `ascii_folding: true`, and `avg_len` from env; build one `bm25Options(env)` helper shared by indexing and retrieval |
| BM25 `avg_len` left at default `256` for short slogans | Med | Set `BM25_AVG_LEN` to the corpus average token count; revisit after indexing |
| Point id type mismatch (numeric string vs uint64) | Low | Resolved: the record schemas type `id` as `integer`, so the reader coerces it and the importer casts nothing |
| Payload indexes created after ingestion | Med | Recreate the indexes inside the drop/recreate path before upsert |

## Open Questions

- Dense model: settled on `intfloat/multilingual-e5-large` (only built-in French-capable model in fastembed-js).
- Whether the chat UI shows retrieved slogans inline or in a side panel —
  decide in Task 9 once responses are visible.

## Glossary

- **BM25**: A ranking method that scores records by their matching words.
- **Dense vector**: A list of numbers that represents the meaning of a text.
- **Payload**: Record fields stored with a vector in Qdrant.
- **RRF**: A method that combines the ranks from multiple search results.
