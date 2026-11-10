# T0006 — Resumable dataset import

- **Track**: indexing pipeline
- **Wave**: 1 (independent)
- **Status**: done
- **Owner**: coding sub-agent, supervised by CTO
- **Started**: 2026-11-10
- **Depends on**: T0001, T0002
- **Blocks**: nothing
- **References**:
  - `tickets/done/T0001-hybrid-slogan-retrieval/spec.md` — the initial destructive indexer.
  - `src/config/datasets.ts` — the two dataset configurations and their record models.
  - `docs/Qdrant - 1.19.1/documentation/manage-data/points/index.md` — upsert, scroll, delete.
  - `docs/Qdrant - 1.19.1/documentation/manage-data/collections/index.md` — collection creation.
  - `src/lib/index-state.ts` — generation state, writer token, publication.
  - `memos/qdrant-nixos-setup.md` — the deployment that runs this import.

## Context & Goal

The initial indexer is a demo tool. Each run deletes the collection, recreates
it, and rewrites every point. That behavior is correct for a corpus of 236
slogans. It is wrong for the production corpora: about 265,000 slogans, and the
citation corpus, both imported over hours on one CPU.

Today, one interruption loses the whole run:

- `scripts/index-slogans.ts` deletes the collection on every start;
- every run reads the corpus from the first record and embeds it again;
- a run truncated by `--limit` publishes a `ready` state with a partial count;
- the script is hard-wired to the slogan dataset, so the citation corpus needs a
  second copy of the same code.

The goal is one command that imports **either** configured dataset, survives an
interruption, and needs one explicit flag for the destructive behavior.

## Scope Boundary

Allowed to create or modify **only** these files:

- `scripts/index-dataset.ts` — **renamed** from `scripts/index-slogans.ts`
- `scripts/index-dataset.test.ts` (new)
- `src/lib/index-config.ts` (new)
- `src/lib/index-config.test.ts` (new)
- `src/lib/embedder.ts` — export `DEFAULT_DENSE_MODEL` only
- `package.json` — the `index` script target only
- `scripts/README.md`
- `memos/qdrant-nixos-setup.md` — correct a fact only
- root `README.md` — the `index` command description only
- `tickets/in_progress/T0006-resumable-dataset-import/plan.md`

Do **not** touch `src/lib/qdrant.ts`, `src/lib/index-state.ts`,
`src/lib/retrieval.ts`, `src/server/**`, `scripts/index-syntax.ts` (still the
slogan-shaped syntax backfill), or any UI file.

`scripts/index-syntax.ts` keeps referring to the default state path. The rename
must not change that file, so the slogan state path stays
`data/index-state.json`; see section 3.

## Contract

### 1. The dataset is a parameter

The CLI accepts `--dataset <name>`, where the name is a key of
`datasetConfigurations` (`"slogans"` or `"citations"`). The default is
`slogans`, so `bun run index` keeps its current meaning.

Every dataset-specific value comes from the configuration object, never from a
constant in the script:

| Value             | Source                                            |
| ----------------- | ------------------------------------------------- |
| corpus file       | `configuration.filePath`                          |
| content field     | `configuration.contentField`                      |
| identifier field  | `configuration.identifierField`                   |
| collection        | `configuration.collectionSchema.collection`       |
| vector names      | `configuration.collectionSchema.dense/sparse`     |
| payload indexes   | `configuration.collectionSchema.payloadIndexes`   |
| dense dimensions  | `configuration.embeddingSize` and `dense.size`    |
| reader and schema | `configuration.schema`, `.validator`, `.defaults` |

The function must stay type-safe across the two record models. Do not index a
union type with a `string` key and do not scatter `as` casts. Resolve the
dataset once, through a dispatch table that maps each name to a session built
from its own `DatasetConfiguration<T>`:

```ts
/** One dataset bound to its reader, its fields, and its collection. */
export type DatasetImportSession<T extends object> = {
  /** Dataset name from the configuration. */
  name: DatasetName;
  /** Configuration entry for this dataset. */
  configuration: DatasetConfiguration<T>;
  /** Read the content field of one record. */
  readContent: (record: T) => string;
  /** Read the identifier field of one record. */
  readIdentifier: (record: T) => number | string;
};
```

`indexDataset` is generic over `T`, and the CLI picks the session with a
`satisfies`-checked map, so each dataset keeps its own inferred record type.
A `DatasetImportSession` built from a `DatasetConfiguration<T>` must not need a
cast to read the content field; if your design needs one, the design is wrong.

An unknown `--dataset` value exits with code 1 and lists the valid names.

### 2. Deletion behind `--drop`

`deleteCollection()` runs **only** when the caller sets `drop: true`.

When `drop` is false:

- `ensureCollection()` still runs, so a missing collection is created;
- the run reads the identifiers that the collection already holds with
  `scrollIds()`;
- a corpus record whose identifier is in that set is **skipped**: no embedding,
  no upsert.

When `drop` is true:

- `deleteCollection()` runs, then `ensureCollection()`;
- `scrollIds()` is not called, because the collection is empty by construction.

Only the collection of the selected dataset is dropped. The other dataset's
collection is never named, never read, and never deleted.

### 3. Resume is the default

A record is "already indexed" when its identifier is present in the collection.
`upsert` replaces a point, so a re-run cannot corrupt a point it rewrites. The
skip exists to avoid the cost of re-embedding, not to protect the data.

The corpus must be the same between the chunks of one import. A point whose
identifier left the corpus stays in the collection. `--drop` is the only way to
remove it.

The state file is per dataset:

```ts
/** State file path for one dataset. */
export const datasetStatePath = (dataset: DatasetName): string => (dataset === "slogans" ? "data/index-state.json" : `data/index-state.${dataset}.json`);
```

`slogans` keeps the existing path because `scripts/index-syntax.ts` reads and
refuses that exact default. A shared state file would let a citation run publish
into the slogan generation. `INDEX_STATE_PATH` still overrides the path for
every dataset; a probe run sets it, as `scripts/index-syntax.ts` already
requires.

`datasetStatePath` lives in `src/lib/index-config.ts`, next to the fingerprint,
so a future ticket can move `index-syntax.ts` onto it.

### 4. Configuration identity guards the resume

Two chunks of one import must use the same dataset, collection, dense model, and
BM25 options. A change of `EMBEDDING_MODEL` between two chunks writes vectors
from a different space into the same collection, and no error is raised.

Add `src/lib/index-config.ts`:

```ts
/** Values that make two dense index chunks comparable. */
export type DenseIndexIdentity = {
  /** Dataset name. */
  dataset: DatasetName;
  /** Qdrant collection of the dataset. */
  collection: string;
  /** Embedding provider name, for example `local`. */
  provider: string;
  /** Dense model identifier. */
  model: string;
  /** Token width that the model pads every text to. */
  maxLength: number;
  /** Dense vector dimensions. */
  dimensions: number;
  /** BM25 options, shared with query time. */
  bm25: Bm25Options;
};

/** Read the identity from the environment and the selected dataset. */
export const denseIndexIdentity = (
  dataset: DatasetName,
  env: EmbedderEnv & Bm25Env,
  dimensions: number
): DenseIndexIdentity;

/** Stable fingerprint of an identity, as the first 16 hex characters of SHA-256. */
export const denseIndexConfigId = async (identity: DenseIndexIdentity): Promise<string>;

/** State file path for one dataset. */
export const datasetStatePath: (dataset: DatasetName) => string;
```

Rules:

- `provider` is `EMBEDDING_PROVIDER ?? "local"`;
- `model` is `EMBEDDING_MODEL ?? DEFAULT_DENSE_MODEL`, with the constant exported
  from `src/lib/embedder.ts` instead of duplicating the string;
- `maxLength` is `resolveMaxLength(env)`, already exported from `src/lib/embedder.ts`;
- `bm25` is `bm25Options(env)` from `src/lib/bm25.ts`;
- the fingerprint covers every field, including `dataset` and `collection`;
- the canonical JSON sorts the keys, so two identities with the same values in a
  different order give the same string;
- the same identity always gives the same fingerprint, and a change of one field
  changes it.

Mirror the approach of `syntaxConfigId` in `src/lib/syntax/config.ts`. Do not
import from `src/lib/syntax/`: that module belongs to another ticket.

`indexDataset` compares the run fingerprint with `state.current.configId` when
`drop` is false and the persisted value exists. A difference throws
`IndexConfigurationMismatchError`, a typed error carrying both values. Nothing is
written and nothing is published. `--drop` bypasses the comparison.

### 5. Dense dimensions are verified before any write

The embedder reports `dims`. The collection is declared with
`configuration.collectionSchema.dense.size`. A mismatch writes vectors that the
collection rejects, or worse, that it accepts at the wrong width after a future
schema change.

Before the first write, compare `embedder.dims` with
`configuration.embeddingSize` **and** with
`configuration.collectionSchema.dense.size`. A difference throws
`DenseDimensionMismatchError`, naming the three values. This check runs before
`ensureCollection`, so a misconfigured run creates nothing.

### 6. Function shape

```ts
export type IndexerDependencies = {
  /** Qdrant collection operations. */
  client: Pick<QdrantClient, "deleteCollection" | "ensureCollection" | "scrollIds" | "upsert">;
  /** Dense embedder for the content field. */
  embedder: Pick<Embedder, "embedDenseDocuments" | "dims">;
  /** BM25 options, shared with query time. */
  bm25: Bm25Options;
  /** Durable index generation state. */
  state: Pick<IndexStateStore, "read" | "beginRebuild" | "publish">;
  /** Sink for progress and rejection messages. */
  log?: (message: string) => void;
  /** Fingerprint of the run configuration. */
  configId?: string;
};

export type IndexOptions = {
  /** Corpus file. Defaults to the dataset configuration path. */
  filePath?: string;
  /** Maximum number of new records to index in this run. */
  limit?: number;
  /** Delete the collection before the run. Defaults to `false`. */
  drop?: boolean;
  /** Records per embedding and upsert batch. Defaults to 256. */
  batchSize?: number;
};

export type IndexSummary = {
  /** Dataset that the run imported. */
  dataset: DatasetName;
  /** Valid records read from the corpus, including skipped ones. */
  accepted: number;
  /** Rejected blocks read from the corpus. */
  rejected: number;
  /** Valid records that the collection already held. */
  skipped: number;
  /** Points written in this run. */
  indexed: number;
  /** Points in the collection after the run: `existing + indexed`. */
  total: number;
  /** Whether the run published a ready state. */
  published: boolean;
};
```

Keep `BATCH_SIZE = 256` as the default of `batchSize`.

### 7. Publication

`publish` runs **only** when the corpus stream ended by itself and no fatal error
occurred.

A run stopped by `limit` is truncated. It publishes nothing, and the state stays
`rebuilding` with its writer token. The next run recovers: `beginRebuild` writes
a new generation and a new token, and `scrollIds` skips what the previous chunks
wrote.

`recordCount` is the size of the identifier set after the run. That set holds the
identifiers read before the run that are still present, plus every identifier
this run wrote, so a repeated identifier inside the corpus is never counted
twice. `published` is `false` on a truncated run.

This mirrors the rule that `scripts/index-syntax.ts` already applies: a
truncated run reports `pending`, never `ready`.

A `--drop` run followed by `--limit` is truncated too: the collection then holds
the slice, and the state stays `rebuilding`. A partial import must not serve
queries.

Record this consequence in the Implementation Notes: `beginRebuild` replaces the
current generation record, so a resumed dense run erases the `syntax` block of
the previous generation while the `ast` vectors stay in the collection. The
syntax backfill runs again after the dense import. Task 16c owns a durable
answer.

### 8. Progress output

Every flush logs one line with the run counters:

```text
Indexed 51200 (skipped 0, rejected 12) in 754s, 67 records/s
```

The rate is `indexed / elapsedSeconds`, rounded to an integer. A run with no
elapsed time prints no rate.

### 9. CLI

```text
bun run index [--dataset slogans|citations] [--drop] [--limit N] [--batch-size N]
```

- `--dataset <name>`: dataset to import. Defaults to `slogans`.
- `--drop`: delete the collection of that dataset first.
- `--limit N`: stop after N new records. A positive integer.
- `--batch-size N`: records per embedding and upsert batch. A positive integer,
  default 256.
- `--help`: usage, exit code 0.
- an unknown flag or a bad value exits with code 1 and a clear message;
- the run prints the summary as JSON at the end.

The CLI resolves the dataset, builds the embedder, builds the fingerprint from
the environment and `embedder.dims`, and passes it as `configId`. It creates the
client from `configuration.collectionSchema` and the state store from
`INDEX_STATE_PATH ?? datasetStatePath(dataset)`.

### 10. Known limitation: BM25 is a single language per run

Qdrant applies one BM25 option set to a whole collection. `BM25_LANGUAGE` is a
process environment value today, shared by the ingest and the query side.

The citation corpus holds French and English quotes, so one value stems one
language badly. This ticket does **not** change that: it keeps
`bm25Options(process.env)` for every dataset and records the limitation in the
notes and in `scripts/README.md`. A separate ticket owns per-dataset BM25.

The fingerprint covers the BM25 options, so a language change between two chunks
is refused instead of silently mixing two tokenizers.

## TDD Tasks

- [ ] **6.1 — Configuration identity**: failing tests for `denseIndexIdentity`,
      `denseIndexConfigId`, and `datasetStatePath`.
- [ ] **6.2 — Dataset dispatch**: failing tests that `citations` reads
      `datasets/citations.txt`, targets the `citations` collection, and uses
      `quote` as content and `id` as identifier; and that an unknown dataset name
      is refused.
- [ ] **6.3 — Non-destructive default**: failing tests that the default run calls
      `ensureCollection` and never `deleteCollection`, and that `--drop` calls
      both in order and skips `scrollIds`.
- [ ] **6.4 — Resume**: failing tests that present identifiers are skipped, that
      the embedder sees only the new texts, and that the summary reports
      `skipped` and `total`.
- [ ] **6.5 — Publication safety**: failing tests for the truncated run (no
      publish, state stays rebuilding) and the complete run (`recordCount` is
      the total).
- [ ] **6.6 — Configuration and dimension guards**: failing tests for a
      fingerprint difference, a dimension mismatch, and `--drop` bypassing the
      fingerprint comparison.
- [ ] **6.7 — Implementation and documentation**: `git mv` the script, implement,
      update `package.json`, `scripts/README.md`, and the root `README.md`.
- [ ] **6.8 — Gates**: `bun fmt`, `bun fmt --check`, `bun run lint`, `bun test`,
      `bunx tsc --noEmit`.

## Acceptance Criteria

- `bun run index` imports the slogan dataset and behaves like today, except that
  it never deletes the collection.
- `bun run index --dataset citations` imports the citation corpus into the
  `citations` collection, with `quote` as content and `id` as identifier.
- A run without `--drop` never deletes a collection.
- An interrupted import continues on the next run, and the second run embeds
  only the records that are absent.
- A truncated run publishes no ready state.
- Two chunks with different dataset, collection, or embedding configuration are
  refused before any write.
- An embedder whose dimension differs from the collection is refused before any
  write.
- No file outside the scope boundary is modified.
- Every quality gate is green.

## Glossary

- **chunk**: one run of the indexer that covers part of the corpus.
- **collection**: the named set of points that Qdrant stores.
- **dense vector**: the fixed-length vector that carries the meaning of a text.
- **dimension**: the number of values in a dense vector.
- **fingerprint**: a short value computed from a configuration, used to compare
  two configurations.
- **idempotent**: an operation that gives the same result when it runs twice.
- **point**: one record in a collection.
- **upsert**: a write that inserts a point, or replaces the point with the same
  identifier.
