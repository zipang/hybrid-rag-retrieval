# T0006 — Plan

Ticket: [`spec.md`](spec.md)

## Goal

Make the dense indexer safe for long imports and independent of one dataset:
no deletion by default, resume after an interruption, no ready state after a
partial run, no silent mix of two configurations, and one command for both
`datasets/slogans.txt` and `datasets/citations.txt`.

## Decisions

### The dataset name selects a session, not a branch

`datasetConfigurations` holds two entries with two different record types
(`Slogan`, `Citation`). A union type cannot be indexed with a per-dataset string
key without a cast.

The design therefore binds one dataset to a **session** object that carries its
configuration and two typed field readers. The CLI holds a small map from
`DatasetName` to a session factory. Each factory call infers `T` from its own
`DatasetConfiguration<T>`, so no `as` appears anywhere.

Rejected alternative: one generic function with `record[contentField as keyof T]`.
It compiles only with casts, and a wrong field name becomes a runtime
`undefined` instead of a type error.

### Resume by identifier set, not by cursor

The run reads the identifiers already in the collection with `scrollIds()`, then
skips a corpus record whose identifier is in that set.

Why not a cursor in the state file:

- a cursor is a position in the file, not a statement about the collection, so a
  failed upsert after the cursor moved loses records;
- a changed corpus invalidates the cursor silently;
- the identifier set is the exact truth, and `scrollIds()` already exists.

Cost: one scroll per run, about 1,035 requests for 265,000 points at the default
page size of 256. On a local server this is seconds, and it runs once per chunk.

### One state file per dataset

A shared state file would let a citation run publish into the slogan generation.
`datasetStatePath("slogans")` therefore stays `data/index-state.json`, which is
the path that `scripts/index-syntax.ts` reads and refuses by resolved path.
Other datasets get `data/index-state.<name>.json`.

Rejected alternative: unify every dataset on `data/index-state.<name>.json`.
It breaks the syntax backfill, which is outside this ticket and still in
progress under T0004.

### Generation churn per chunk is accepted

`beginRebuild` writes a new generation and a new writer token at every start.
Chunks therefore do not share a generation identifier, and only the final chunk
publishes `ready`.

This is acceptable because the generation is a label for readers during a
rebuild, and the collection is not ready while the import runs. A durable
"resume the same generation" operation is not needed and would widen the scope
to `src/lib/index-state.ts`.

Consequence, recorded in the notes: a resumed dense run replaces the generation
record, so it drops the `syntax` block that the syntax backfill wrote. The `ast`
vectors stay in the collection, and the backfill runs again after the import.
Task 16c owns the durable fix.

### Fingerprint on every chunk

The identity covers the dataset, the collection, the provider, the model, the
token width, the dimensions, and the BM25 options. A difference from the
persisted `configId` is refused before any write, because two embedding spaces
in one collection produce wrong scores with no error.

`--drop` bypasses the guard, since it starts a new collection.

### BM25 stays a single language per run

The citation corpus holds French and English quotes, and Qdrant applies one BM25
option set per collection. Changing that needs a per-dataset BM25 option on the
query side too, and the query side is slogans-only today. This ticket keeps
`bm25Options(process.env)` and documents the limitation. The fingerprint at
least refuses a language change between two chunks.

## Tasks

- [x] **Task 6.1 — Configuration identity** — `src/lib/index-config.ts`,
      `src/lib/index-config.test.ts`, and `DEFAULT_DENSE_MODEL` exported from
      `src/lib/embedder.ts`. Red first: the fingerprint is stable for the same
      identity; it changes when the dataset, the collection, the provider, the
      model, the width, the dimensions, or one BM25 option changes; it ignores
      key order; `datasetStatePath` returns the legacy path for `slogans` and a
      per-dataset path otherwise.
- [x] **Task 6.2 — Dataset dispatch** — failing tests that a `citations` session
      reads `datasets/citations.txt`, targets the `citations` collection, and
      reads `quote` and `id`; and that an unknown dataset name is refused.
- [x] **Task 6.3 — Non-destructive default** — failing tests that the default
      run calls `ensureCollection` and never `deleteCollection`, that `--drop`
      calls both in that order and skips `scrollIds`, and that the dataset
      runners build their client from the schema of their own dataset.
- [x] **Task 6.4 — Resume** — failing tests that a present identifier is skipped,
      that the embedder receives only the new texts, that `upsert` receives only
      the new points, and that the summary reports `skipped` and `total`.
- [x] **Task 6.5 — Publication safety** — failing tests that a truncated run
      publishes nothing and leaves the state `rebuilding`, that a complete run
      publishes `existing + indexed`, and that a stream that ends by itself
      publishes.
- [x] **Task 6.6 — Guards** — failing test that a fingerprint difference raises
      `IndexConfigurationMismatchError` before any write, that a dimension
      mismatch raises `DenseDimensionMismatchError` before `ensureCollection`,
      and that `--drop` avoids the fingerprint comparison.
- [x] **Task 6.7 — CLI and documentation** — `git mv scripts/index-slogans.ts
scripts/index-dataset.ts`; `--dataset`, `--drop`, `--limit`,
      `--batch-size`, `--help`, unknown-flag refusal, summary as JSON;
      `package.json` `index` target; `scripts/README.md`; root `README.md`.
- [x] **Task 6.8 — Gates** — `bun fmt`, `bun fmt --check`, `bun run lint`,
      `bun test`, `bunx tsc --noEmit`.

## Test strategy

`scripts/index-dataset.test.ts` drives the function through fakes:

- a fake client that records the call order and exposes only
  `deleteCollection`, `ensureCollection`, `scrollIds`, and `upsert`;
- a fake embedder that records the texts it receives and reports `dims`;
- a real `IndexStateStore` over a temporary file, so the publication rules are
  exercised, not mocked;
- temporary corpus files written by the test, in the block format that
  `streamDataset` reads, one per dataset shape.

No live Qdrant and no real model in the test suite.

An optional live probe, outside the test suite: a throwaway citation collection
of ten records, one chunk of three, then a second chunk, then a comparison of the
point counts. The probe sets `INDEX_STATE_PATH` to a throwaway file.

## Verification

```sh
bun test scripts/index-dataset.test.ts src/lib/index-config.test.ts
bun test
bun run lint
bunx tsc --noEmit
```

## Acceptance

See `spec.md`, section "Acceptance Criteria".

## Implementation Notes

### The dataset name selects a session, not a branch

`scripts/index-dataset.ts` binds each dataset to a `DatasetImportSession<T>`:
the configuration, `readContent`, and `readIdentifier`. `createSloganSession`
fixes `T = Slogan` and `createCitationSession` fixes `T = Citation`. Each
factory keeps the concrete configuration, so `record[configuration.contentField]`
is typed `string` by the contextual `DatasetConfiguration<T>`; no `as` cast
appears anywhere in the script or the tests.

The CLI calls one of two runners in `datasetRunners`, a map checked with
`satisfies Record<DatasetName, DatasetRunner>`. Each runner calls the generic
`runSession<T>`, so the two record types never meet in one union. A union type
indexed by a string key would need a cast and would turn a wrong field name into
a runtime `undefined`; the session design prevents both.

The identifier is converted to a Qdrant point id by `pointIdOf`, which rejects a
non-integer identifier with a clear message instead of writing a point that no
scroll can match. The payload is copied entry by entry in `payloadOf`, because a
spread typed as generic `T` cannot satisfy `Record<string, unknown>` without a
cast.

`runSession` builds the client through `context.createClient`, which defaults to
`createQdrantClient`. The seam exists so a test can observe the schema that each
runner passes: `datasetRunners.citations` passes the citation schema and
`datasetRunners.slogans` the slogan schema, which proves that a run names only
its own dataset's collection. The CLI prints one bare `JSON.stringify(summary)`
line after the human `Done:` line, so a caller can parse it without stripping a
prefix.

### Resume uses the identifier set, not a cursor

The run reads `await client.scrollIds()` once, then skips a corpus record whose
identifier is in that set: no embedding, no upsert, and the counters report it
as `skipped`. `upsert` replaces a point, so the skip saves the embedding cost,
not the data. A cursor would record a file position, not a statement about the
collection: a failed upsert after the cursor moved would lose records, and a
changed corpus would invalidate the cursor silently. The identifier set is the
exact truth. `--drop` skips the scroll, because the collection is empty by
construction.

`scrollIds` reports `Array<number | string>`, and both datasets declare integer
identifiers. A string form such as `"1"` would miss the numeric lookup and
re-embed the whole corpus, the exact cost this ticket removes. `normalizeIdentifier`
therefore turns a string that names a safe integer into that number and leaves
every other value alone, and a test proves that a string `"1"` skips the record
whose identifier is `1`.

### `total` counts points, not writes

`total` is `existing.size` at the end of the run, not `existing.size + indexed`.
The set gains each identifier when the record enters the batch, so it states
what the collection holds after the run. A corpus of `1, 2, 2` therefore reports
`indexed: 2`, `skipped: 1`, and `recordCount: 2`, matching the two points in the
collection. The same rule makes `--limit 2` on `1, 2, 2` publish `ready`,
because the repeat is skipped before the limit check sees a new record. A second
occurrence inside one batch never reaches the embedder or the upsert.

### One state file per dataset

`datasetStatePath("slogans")` stays `data/index-state.json`, because
`scripts/index-syntax.ts` refuses a custom `--collection` whose state path
resolves to that default. Every other dataset gets
`data/index-state.<name>.json`, so a citation run cannot publish into the slogan
generation.

`INDEX_STATE_PATH` still overrides the path for every dataset, but the override
is checked. `resolveStatePath` compares its resolved form with the resolved
default of every other configured dataset and raises `ForeignStatePathError`
when they match, naming both datasets. A citation run that points at
`data/index-state.json` would otherwise publish citation counts into the slogan
generation. A path outside the defaults, such as `.tmp/probe-state.json`, is
accepted.

### Generation churn per chunk

`beginRebuild` writes a new generation and a new writer token at every start, so
chunks do not share a generation identifier and only the final chunk publishes
`ready`. Consequence: a resumed dense run replaces the generation record, so it
erases the `syntax` block that the syntax backfill wrote. The `ast` vectors stay
in the collection, and the syntax backfill runs again after the dense import.
Task 16c owns a durable answer. This ticket does not widen the scope to
`src/lib/index-state.ts`.

The call site omits the `writer` option on purpose. A truncated chunk leaves the
generation `rebuilding`, so passing the persisted writer would make
`beginRebuild` raise `ConcurrentWriteError` on the very next chunk and break
resume. Each chunk takes the generation over with a fresh token instead. A
second concurrent writer is still caught, because `publish` requires the token
that `beginRebuild` returned for that run.

### Fingerprint fields and error messages

`DenseIndexIdentity` covers `dataset`, `collection`, `provider`, `model`,
`maxLength`, `dimensions`, and `bm25`. `denseIndexConfigId` sorts the keys at
every level, serializes canonical JSON, hashes it with SHA-256, and keeps the
first 16 hexadecimal characters. The run compares the result with
`state.current.configId` when `drop` is false and the persisted value exists.
`--drop` bypasses the comparison.

The exact messages:

- `dataset <name> was indexed with configuration <persisted>, but this run builds <requested>; run with --drop to rebuild the collection`
- `the dense embedder returns <n> dimensions, but the dataset configuration expects <n> and the collection schema declares <n>`
- `unknown dataset "<name>"; valid names: slogans, citations`

The dimension guard runs before `state.read()` and before `ensureCollection`, so
a misconfigured run creates neither a state file nor a collection. A short
embedder output raises `IncompleteEmbeddingError` with both counts before any
point is built, so the run never writes a point with an empty dense vector.

`configId` is a required field of `IndexerDependencies`. A future caller cannot
disable the guard by omitting it.

### A truncated run publishes nothing, and truncation is exact

A run stopped by `--limit` publishes nothing, and the state stays `rebuilding`
with its writer token. This mirrors `scripts/index-syntax.ts`, which publishes
`pending` for a truncated run. `recordCount` on a complete run is the number of
distinct identifiers that the collection holds, `existing.size` after the run.

Truncation is decided by the corpus, not by hitting the limit. A run that stops
the moment it reaches `--limit` cannot tell a corpus of exactly that size from a
longer one, so `--limit 1000` on a corpus of 1000 new records would refuse to
publish a run that covered everything. The loop therefore sets `limitReached`
after the flush and keeps reading:

- a **known** identifier still counts toward `skipped`, and the loop continues;
- the first **new** valid record after the limit proves that work remains: the
  run sets `truncated = true` and breaks, and that record is never embedded and
  never upserted;
- if the stream ends first, the run covered the corpus and publishes `ready`.

The scan reads at most a handful of extra records, and a test proves both
branches: `--limit` equal to the number of new records publishes `ready` with
`total === existing.size`, and a smaller limit publishes nothing while the fake
embedder and `upsert` never receive the record that proved the truncation. A
third test runs a truncated chunk and a second run over the same state file and
collection: run 2 publishes `ready`, `skipped` equals run 1's `indexed`, and
`recordCount` equals the corpus size. `--limit` with `--drop` follows the same
rule, so a slice of a fresh collection never serves queries.

### BM25 stays one language per run

Qdrant applies one BM25 option set per collection, and `BM25_LANGUAGE` is a
process-wide value. The citation corpus holds French and English quotes, so one
value stems the other language badly. This ticket keeps `bm25Options(process.env)`
for every dataset and documents the limitation in `scripts/README.md`. The
fingerprint covers the BM25 options, so a language change between two chunks is
refused instead of silently mixing two tokenizers.

### No cast anywhere in the script

`scripts/index-dataset.ts` holds no `as` cast. The last one was in
`resolveStatePath`, where `const candidate = other as DatasetName` narrowed the
`string` of `Object.keys`. `isDatasetName` is already a type predicate
(`value is DatasetName`), so the loop calls it and the guard narrows the value to
`DatasetName` on its own. `Object.keys(datasetConfigurations)` returns `string[]`
because `Object.keys` always widens to `string`, and the predicate narrows each
element back, so no cast is needed at all.

The rest of the type safety comes from the design rather than from assertions:
`DatasetImportSession<T>` keeps each record type, `payloadOf` copies entries
instead of spreading a generic `T`, and `pointIdOf` validates the identifier at
run time.

### Close-out of the re-review

Three items closed. `resolveStatePath` now narrows with the `isDatasetName` type
predicate instead of asserting, so the script holds no `as` cast at all. The
two-run resume test asserts the identifiers that each run wrote, so a run that
wrote the wrong ids can no longer pass by supplying its own mistake to the next
chunk. `IncompleteEmbeddingError` is tested in both directions, with the counts
`1 / 2` and `4 / 2` and the exact message. The state-path test now also covers
`data/../data/index-state.citations.json`, which `resolve` folds to the same
file as the other spellings.

### Gate output

```text
$ bun fmt
Formatted 0 files, 189 unchanged [11.18ms]

$ bun fmt --check
All 189 files are formatted.

$ bun run lint
$ biome lint .
Checked 92 files in 44ms. No fixes applied.

$ bun test
bun test v1.4.4 (38afee6c8)

 474 pass
 0 fail
 4464 expect() calls
Ran 474 tests across 28 files. [2.80s]

$ bunx tsc --noEmit
(no output, exit code 0)
```

The CLI was exercised by hand: `--help` prints the usage and exits 0, an unknown
dataset exits 1 with the valid names, and an unknown flag exits 1 with the usage.
