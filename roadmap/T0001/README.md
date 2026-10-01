# T0001 — Hybrid slogan retrieval and chat demo

Ticket: `T0001` — spec: `spec.md`, plan: `plan.md`

This demo indexes a slogan corpus in a local Qdrant instance. It answers a
natural-language question with a hybrid search and an LLM chat. The search
combines a dense (semantic) vector and a BM25 (keyword) vector.

## Prerequisites

- Bun `1.4` or later.
- The corpus file `datasets/slogans.txt`.
- About 3 GB of free disk for the local embedding model.
- An LLM API key for the chat. The retrieval API needs no key.

## Setup

1. Install the dependencies.

   ```bash
   bun install
   ```

2. Install the Qdrant binary and the Web UI.

   ```bash
   bash scripts/setup-qdrant.sh
   ```

3. Copy the environment file.

   ```bash
   cp .env.sample .env
   ```

4. Start Qdrant. Keep this terminal open.

   ```bash
   (cd qdrant && ./qdrant --config-path config/config.yaml)
   ```

5. Open http://localhost:6333/dashboard to check the server.

## Index the corpus

The index script drops and recreates the collection, so a rerun is safe.

```bash
bun run index
```

For a quick run, index the first 500 records.

```bash
bun run scripts/index-slogans.ts --limit 500
```

The first run downloads the local embedding model (about 1 GB). The run reports
each rejected block and the accepted and rejected totals.

## Query the collection

Start the server.

```bash
bun run dev
```

Run the smoke script. It runs the three example queries and prints the ranked
results.

```bash
bun run smoke
```

Or call the retrieval API directly.

```bash
curl "http://localhost:3000/api/slogans?q=sucre&yearFrom=2004&yearTo=2005&topK=5"
```

## Chat with the corpus

1. Put an LLM key in `.env` (`AI_API_KEY`, `AI_MODEL`, and `AI_PROVIDER_URL`).
2. Start the server with `bun run dev`.
3. Open http://localhost:3000.
4. Ask a question, for example `slogans sur le sucre`.

The chat calls the retrieval API as a tool. The answer cites the slogans with
their brand and year. Without a key the chat endpoint returns a clear error.
The retrieval panel still works.

## Environment

`.env.sample` lists every variable. The important ones are:

| Variable | Meaning |
|---|---|
| `QDRANT_URL` | Qdrant HTTP address. |
| `QDRANT_COLLECTION` | Collection name. |
| `EMBEDDING_MODEL` | Dense embedding model. |
| `EMBEDDING_MAX_LENGTH` | Padding width of the dense model. |
| `BM25_LANGUAGE` | Stemming and stopword language for BM25. |
| `AI_PROVIDER_URL` | OpenAI-compatible chat endpoint. |
| `AI_API_KEY` | Chat provider key. |
| `AI_MODEL` | Chat model name. |
| `PORT` | Server port. |

## Glossary

- **BM25**: A ranking method that scores records by their matching words.
- **Dense vector**: A list of numbers that represents the meaning of a text.
- **Embedding**: The vector form of a text.
- **Hybrid search**: A search that combines a dense retrieval and a keyword
  retrieval.
- **Payload**: The record fields that Qdrant stores next to a vector.
- **RRF (Reciprocal Rank Fusion)**: A method that merges ranked lists into one
  ranked list.
