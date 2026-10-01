# Spec: [T0001] Qdrant RAG Demo — Hybrid Slogan Retrieval + LLM Chat

Ticket: `T0001` — see `roadmap/T0001/`

## Objective

Build a minimalist end-to-end RAG proof of concept on the slogan corpus
(`datasets/slogans.txt`, ~265k records):

1. Install and run **Qdrant** locally (open-source, self-hosted) — **bare-metal install, no Docker**: download the static Linux binary from Qdrant GitHub releases and run it directly (`./qdrant` → HTTP `:6333`, gRPC `:6334`, storage in `./qdrant/storage`).
2. **Index** the slogans once into a single Qdrant collection using a
   **hybrid strategy**: one dense multilingual vector (client-side) + one
   Qdrant-native BM25 sparse vector per point, with payload fields (id, année,
   marque, campagne, slogan). The corpus `Id` is a typed integer, so it is the
   Qdrant point id (unsigned 64-bit) directly; the payload keeps `id` as an
   integer. Payload indexes (`annee` integer, `marque` keyword) are created
   **before** the points are ingested.
3. Expose a **retrieval API** (Bun) that fuses dense similarity and BM25 scores
   into one hybrid search endpoint (server-side RRF).
4. Ship a **minimal chat demo** (single HTML page served by the same Bun app)
   powered by the **Vercel AI SDK**, where any LLM provider can be plugged
   via environment variables and answers natural-language questions
   by calling the retrieval endpoint as a **tool**.

The user is the project owner, demoing locally. Success: the README example
queries ("slogans sur les produits laitiers de 2005", "slogans similaires à
'Un peu de sucre, beaucoup d'idées'", "slogans sur le sucre") return relevant
results, the search tolerates spelling variations (dense handles typos, BM25
`ascii_folding` handles accents), and the chat cites slogans.

This is a POC — **other indexing strategies and performance benchmarking are
deferred to follow-up tickets** (README's comparison goals).

T0002 provides the typed record model, dataset configuration, and generic text
reader. T0001 uses these contracts to read the slogan corpus. It does not add a
second slogan parser. Slogan property keys are the canonical field names.
Property titles support legacy corpus labels. The reader checks keys first,
then titles, independent of line order. The chat prompt uses schema descriptions
to identify the content field, filter fields, and record identifier.

During import, the indexing script logs every rejected block with the corpus
path, block number, and reason. It continues to later records and reports
accepted and rejected totals.

## Tech Stack

- **Runtime:** Bun (`bun ~1.4`) — HTTP via `Bun.serve()`, no framework.
- **Dataset extraction:** `tjs` JSON Schema models and generic readers from
  T0002. The slogan configuration points to `datasets/slogans.txt`.
- **Vector DB:** Qdrant, **bare-metal**: `qdrant-x86_64-unknown-linux-gnu.tar.gz` from [qdrant releases](https://github.com/qdrant/qdrant/releases), unzipped to `qdrant/` in the repo (gitignored, storage under `qdrant/storage`). HTTP client: `fetch` against `http://localhost:6333` (no official SDK dependency; the REST API is enough for a POC).
- **Embeddings (dense, local + swappable):**
  - Default: `fastembed` (ONNX, local, no API key) with the French-capable `intfloat/multilingual-e5-large` dense model (1024 dims). Dense vectors are computed client-side.
  - Provider is resolved from config so a cloud model (Voyage/OpenAI/Mistral) can replace it without touching the index pipeline logic.
- **Keyword side (sparse BM25):** delegated to Qdrant's **native server-side
  BM25 inference** (`qdrant/bm25`), which runs inside the Qdrant cluster — no
  cloud service and no custom tokenizer in the app. BM25 **defaults to English**
  stemming and stopwords, so the app sets `language: "french"`,
  `ascii_folding: true` (accent-insensitive, e.g. `idees` matches `idées`), and
  a slogan-sized `avg_len` (corpus average ≈ 7 words; the default `256` is wrong
  for short slogans).
  Lowercasing is BM25's default. The text-processing `options` are identical at
  ingest and query time, as Qdrant requires.
- **Hybrid search:** Qdrant Query API with a dense prefetch (the client-side
  query vector, sent as a raw array) and a BM25 prefetch
  (`{ text, model: "qdrant/bm25", options }`), fused server-side with
  `{ "rrf": {} }`. The `rrf` object form also exposes `k` and per-prefetch
  `weights` for later tuning.
- **Batched ingestion:** points are upserted in bounded batches that stay well
  under Qdrant's 32 MB REST request limit (1024-dim float vectors are ~4 KB
  each).
- **LLM:** Vercel AI SDK (`ai` + `@ai-sdk/openai-compatible` or provider packages); provider/model chosen via `.env`. Ollama works through the OpenAI-compatible adapter.
- **UI:** hand-written single HTML page (chat box + result list), no build step.

## Commands

```
wget https://github.com/qdrant/qdrant/releases/latest/download/qdrant-x86_64-unknown-linux-gnu.tar.gz   # one-time setup
tar -xzf qdrant-*.tar.gz  -C qdrant ./qdrant                                                            # unzip binary
(cd qdrant && ./qdrant --config-path config/config.yaml) &                                              # start Qdrant (storage in ./qdrant/storage)
bun install                                 # install dependencies
bun run scripts/index-slogans.ts            # parse + index datasets/slogans.txt into Qdrant
bun run scripts/smoke-retrieval.ts          # CLI sanity-check hybrid search queries
bun run dev                                 # Bun.serve() → API + demo UI on :3000
bun test                                    # unit tests
bunx biome check --write .                  # format + lint
```

Env contract, documented in `.env.sample` (copy it to `.env`; Bun loads `.env`
automatically): `QDRANT_URL`, `QDRANT_COLLECTION`, `EMBEDDING_PROVIDER`
(`local` default), `EMBEDDING_MODEL`, `EMBEDDING_MAX_LENGTH`, `BM25_LANGUAGE`,
`BM25_ASCII_FOLDING`, `BM25_AVG_LEN`, `AI_PROVIDER_URL`, `AI_API_KEY`, `AI_MODEL`, `PORT`.

## Project Structure

```
datasets/
  slogans.txt     → Local slogan corpus; ignored by Git
src/
  models/         → slogan JSON Schema, inferred type, and validator from T0002
  config/         → slogan corpus path and content and identifier fields from T0002
  utils/          → generic in-memory and streaming readers from T0002
  lib/            → dense embedder factory, qdrant client helpers, hybrid retrieval
  server/         → Bun.serve() entry: API routes + static demo page
demo/
  index.html      → chat UI (raw HTML/JS)
scripts/
  index-slogans.ts        → one-shot indexing script (idempotent: drops/recreates collection)
  smoke-retrieval.ts      → manual verification script
qdrant/                   → unzipped Qdrant binary + storage (gitignored)
```

## Code Style

Biome + tabs, JSDoc on every function, arrow functions, blank line before
control flow. Example:

```ts
import { datasetConfigurations } from "../config/datasets"
import { parseDataset } from "../utils/data-utils"

const text = "Id: 1\nAnnée: 2004\nMarque: Danone\nSlogan: Example\n---"
const sloganDataset = datasetConfigurations.slogans
const result = parseDataset(text, sloganDataset)
const records = result.events.filter((event) => event.type === "record")

// `records` contains values typed from the slogan JSON Schema.
```

## Testing Strategy

- `bun test` with tests colocated as `*.test.ts` next to sources.
- Unit tests: T0002 covers schema validation and generic corpus parsing. T0001
  covers retrieval request and filter shapes with a stubbed `fetch`.
- Integration is manual for the POC (requires the local Qdrant binary + indexing): verified via `scripts/smoke-retrieval.ts` and demo UI against the three README example queries.
- No coverage target for this POC.

## Boundaries

- **Always:** run `bunx biome check --write` before commits; keep the indexing script idempotent; keep Qdrant config in `.env`, never in code.
- **Ask first:** adding dependencies beyond fastembed + ai + an adapter; changing the collection schema once data is indexed; switching DB port/volume.
- **Never:** commit `.env` or secrets; bring in a web framework, Docker, or database clients outside the agreed stack; start benchmarking/eval work (out of scope).

## Success Criteria

- `bash scripts/setup-qdrant.sh` then `(cd qdrant && ./qdrant --config-path config/config.yaml)` starts Qdrant (no Docker). The collection contains all valid slogans read through the T0002 generic reader, with dense and BM25 vectors.
- `GET /api/slogans?q=<text>` returns top-k results with fused hybrid scores, filterable by year range.
- The demo chat answers the three README example queries correctly and displays slogan/brand/year with results retrieved via tool-calling.
- The chat uses the slogan schema descriptions to map user requests to the content and filter fields.
- The indexing script logs each rejected block with its source path, block number, and reason, then continues to later blocks.
- Local embedding model used by default; switching to a cloud model requires only env changes.
- Whole flow (install → index → query → chat) reproducible from the ticket docs.

## Open Questions

- Dense model choice: settled on `intfloat/multilingual-e5-large` (the only built-in French-capable dense model in fastembed-js). Changing it later is an `EMBEDDING_MODEL` alias change.
- Chunking: slogans are short; no chunking is expected. Index one point per valid slogan record from the T0002 reader.
- Point id mapping (resolved): the corpus `Id` values are all numeric and unique
  (265,266 values, 0 non-numeric, 0 duplicates). The schema types `id` as an
  integer, so the reader coerces it and the importer uses it as the Qdrant
  uint64 point id with no conversion. The payload keeps `id` as an integer.

## Glossary

- **BM25**: A ranking method that scores records by their matching words.
- **Dense vector**: A list of numbers that represents the meaning of a text.
- **JSON Schema**: A JSON structure that declares record fields, types, and validation rules.
- **Payload**: Record fields stored with a vector in Qdrant.
- **RRF**: A method that combines the ranks from multiple search results.
