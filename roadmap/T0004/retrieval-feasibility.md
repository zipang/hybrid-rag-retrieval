# Retrieval Feasibility: Complete Qdrant Score Enumeration

Ticket: `T0004` — related spec: `spec.md`, related plan: `plan.md`

Status: complete. This document is the evidence for Checkpoint A, Task 2.

## Objective

Prove that the reference retrieval transport can score every eligible record
for the dense and keyword indexes. The transport must return raw scores that do
not depend on a candidate cutoff, a page, or an identifier batch.

The experiment also answers one high-risk question from the plan: does a
per-identifier filter change the BM25 corpus statistics?

## Environment

- Qdrant `1.19.1`, started from `qdrant/` on `http://127.0.0.1:6333`.
- Isolated collection `t0004_completeness`. It has one `dense` vector (size 4,
  cosine distance) and one `bm25` sparse vector with `modifier: "idf"`.
- Test: `src/lib/qdrant-completeness.test.ts` (9 tests). The suite skips itself
  when Qdrant is unreachable, and it deletes its own collection after the run.

Run the proof:

```sh
(cd qdrant && ./qdrant --config-path config/config.yaml) &
bun test src/lib/qdrant-completeness.test.ts
```

## Method

The collection holds six deterministic points. The dense query vector is
`[1, 0, 0, 0]`, so every point has a known cosine score. The BM25 query text is
`alpha beta`. Identifiers 1 and 5 share the same dense vector and the same text,
so they must receive tied scores. Identifiers 3 and 6 share no term with the
query, so sparse search must omit them.

The test queries each index three ways and compares the raw scores:

1. one global exact query over the whole collection;
2. one query per identifier batch, under a `has_id` filter;
3. one query per single identifier, under a `has_id` filter.

## Results

Exact dense global query:

| Identifier | Score |
| --- | --- |
| 1 | 1.0 |
| 5 | 1.0 |
| 2 | 0.8 |
| 6 | 0.6 |
| 3 | 0.0 |
| 4 | -1.0 |

Exact dense query on the batch `[1, 2]`: identifier 1 scores `1.0` and
identifier 2 scores `0.8`. These values equal the global values.

BM25 global query:

| Identifier | Score |
| --- | --- |
| 2 | 1.9104025 |
| 1 | 1.905278 |
| 5 | 1.905278 |
| 4 | 0.74570036 |
| 3 | absent |
| 6 | absent |

BM25 query on the single identifier 2: score `1.9104025`. This value equals the
global value. The same holds for every other identifier.

The findings are:

1. An exact dense query returns the same raw score in the global query and in an
   identifier batch. Negative cosine scores appear in the result. A `params:
   { exact: true }` request scans all selected vectors and returns a stable
   order.
2. A BM25 query returns the same raw score in the global query, in an identifier
   batch, and under a single-identifier filter. The identifier filter is a
   retrieval filter. It does not change the IDF corpus.
3. Sparse search returns only records with an overlapping term. It omits the
   other records. The transport assigns a zero keyword score to each omitted
   record.
4. A payload filter changes which records appear. It does not change the raw
   score of a record that appears in both the filtered and the unfiltered
   result.
5. Identical vectors and identical texts receive tied scores. A tie-breaker on
   the point identifier is necessary for a stable order.
6. The scroll API returns the complete identifier set of the collection.

The Qdrant documentation confirms the mechanism. IDF statistics are computed
over the whole shard by default. The `params.idf` search parameter can scope the
statistics to a payload filter, but this scope is independent of the retrieval
filter. The default matches the transport design.

## Decisions

- Adopt the identifier-batch exact scoring path from the plan. The proof shows
  that batching does not change raw dense or BM25 scores.
- Keep the default global IDF statistics. Do not send `params.idf`.
- Assign zero to a keyword nonmatch after the sparse query completes.
- Treat a missing dense vector as an index-integrity failure, not as a zero
  match.
- Sort the final result by combined score descending, then by the point
  identifier as the tie-breaker.
- Do not reimplement BM25 or IDF in the application.

## Limits and risks

- Exact dense search scans the selected vectors for each batch. The cost grows
  with the corpus size and the batch count. The plan measures this cost at
  Checkpoint C.
- The transport batch size controls transport only. It must never determine which
  records qualify.
- A scoped `params.idf.corpus` changes the statistics. Never combine a scoped
  IDF corpus with per-batch scoring unless the corpus filter covers the whole
  index generation.
- This experiment uses the default BM25 text-processing options. The production
  index uses the project options (`language`, `ascii_folding`, `avg_len`). The
  invariance result does not depend on the option values, because the test
  compares the same options on both sides. Ingest and query options must still
  match.

## References

- [Local Qdrant exact search and pagination](../../docs/Qdrant%20-%201.19.1/documentation/search/search/index.md)
- [Local Qdrant BM25 inference](../../docs/Qdrant%20-%201.19.1/documentation/inference/inference-bm25/index.md)
- [Local Qdrant full-text search](../../docs/Qdrant%20-%201.19.1/documentation/search/text-search/full-text-search/index.md)
- [Local Qdrant per-tenant IDF statistics](../../docs/Qdrant%20-%201.19.1/documentation/manage-data/multitenancy/index.md#per-tenant-idf-statistics)
- [Local Qdrant scroll points](../../docs/Qdrant%20-%201.19.1/documentation/manage-data/points/index.md#scroll-points)

## Glossary

- **BM25**: A ranking method that scores a record by its matching words and by
  the rarity of those words in the corpus.
- **Corpus statistics**: The document count and the term frequencies that a
  keyword score uses.
- **Exact search**: A vector search that scans every selected vector instead of
  using an approximate index.
- **IDF (Inverse Document Frequency)**: A keyword weight that gives a rarer term
  more influence than a common term.
- **Identifier batch**: A fixed list of record identifiers that one transport
  request scores together.
- **Named vector**: A vector field with its own name and configuration in a
  collection.
- **Point**: One indexed record, made of a vector and a payload.
- **Scroll**: A Qdrant operation that returns all records that match a filter,
  one page at a time.
- **Sparse vector**: A vector with few non-zero values. It represents keywords.
