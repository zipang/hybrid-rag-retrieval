# Qdrant multivector behavior that the local mirror does not state

Ticket: `T0004` — related spec:
`tickets/in_progress/T0004-french-syntax-weighted-retrieval/spec.md`, section 3.

This memo records the Qdrant 1.19.1 behaviors that the project needs and that
the local documentation mirror does not state, or states incompletely. Each
entry gives the source, the command that produced the observation, and the rule
that the code applies as a result.

The project must not read dependency source to learn an API. When the documents
do not cover a behavior, the project measures the running server and writes the
result here. A future upgrade must re-run the checks in the last section.

## Method

Every measurement below ran against the local server, started by
`bun run qdrant:start`:

```sh
curl -s http://127.0.0.1:6333/
# {"title":"qdrant - vector search engine","version":"1.19.1", ...}
```

Each probe used a throwaway collection named `cto-probe-*`. A probe never
touched `slogans` or `citations`. Each probe collection was deleted after the
measurement.

The reference mirror is `docs/Qdrant - 1.19.1/`.

## 1. The vector-add endpoint accepts `multivector_config`

**Source.** `documentation/manage-data/collections/index.md`, section "Update
Vector Schema", near line 240. The prose says:

> The request body only accepts properties that define the vector space (size
> and distance for dense vectors).

The example shows only `size` and `distance`.

**Measured.** The server accepts `multivector_config` in the same body:

```http
PUT /collections/cto-probe-syntax/vectors/syntax
{"dense":{"size":8,"distance":"Cosine",
          "multivector_config":{"comparator":"max_sim"}}}
```

The answer is `{"result":{"operation_id":2,"status":"acknowledged"},"status":"ok"}`
and `GET /collections/cto-probe-syntax` then reports:

```json
"syntax": {"size": 8, "distance": "Cosine",
           "multivector_config": {"comparator": "max_sim"}}
```

**Consequence.** The project adds the `ast` vector to an existing collection
without recreating it. The specification forbids a recreation, because a
recreation would drop the dense vector, the BM25 vector, and the payload.

**Risk.** This behavior is not promised. A later version can reject the body.
Task 16c must re-run this check before it relies on the endpoint.

## 2. The body key `dense` is a type, not a vector name

**Source.** Same section. The example writes `{"dense": {...}}` and takes the
vector name from the URL path.

**Measured.** A body key that repeats the vector name is rejected. With the
vector named `ast`, the body `{"ast": {...}}` returns:

```text
Format error in JSON body: data did not match any variant of untagged enum VectorNameConfig
```

The body key `dense` on the same path returns
`{"result":{"operation_id":7,"status":"acknowledged"},"status":"ok"}`.

**Consequence.** The vector is named `ast` in the schema, but the body key stays
`dense`. The code records this in a comment at the call site.

## 3. `max_sim` is a sum of maxima, so the score is unbounded

**Source.** `documentation/manage-data/vectors/index.md`, line 160 and the
formula at line 162:

```
score = sum over i of max over j of Sim(vectorA_i, vectorB_j)
```

**Measured.** A query matrix of two rows against a record of the same two rows
scores `2.0`:

```
point 1: score 2.0
point 2: score 1.3828342
```

**Consequence.** The transport returns the raw score. It does not clamp. Task 14
must normalize the value to `[0, 1]` before it combines indexes, because the
retrieval contract states that each index score is in `[0, 1]`.

**Risk.** A naive normalization that divides by one saturates at a record that
holds two sentences. The plan proposes `rawMaxSim / max(queryRows, recordRows)`.
Task 14 must validate that rule on the reviewed test data set.

## 4. A batch vector delete applies the batch before it reports an absent point

**Source.** `documentation/manage-data/points/index.md`, section "Delete
Vectors", near line 460. The section states that the operation keeps the other
vectors and does not delete the point. It says nothing about an identifier that
does not exist.

**Measured.** Two points exist, with `dense` and `ast`. The request removes the
`ast` vector of point `1` and also names the absent point `99`:

```http
POST /collections/cto-probe-mix/points/vectors/delete?wait=true
{"points":[1,99],"vectors":["ast"]}
```

The answer is an error:

```json
{ "status": { "error": "Not found: No point with id 99 found" }, "time": 0.002031154 }
```

The state after the error:

```
point 1: ['dense']          <- ast removed, dense kept
point 2: ['ast', 'dense']   <- untouched
```

**Consequence.** The server applies the valid part of the batch, then reports
the absent identifier. A stale vector does not survive.

**Risk.** The partial application is not promised. The transport must not
depend on it. The `deleteVectors` operation therefore retries the identifiers
one at a time when the batch answer names an absent point. A single-identifier
request has one unambiguous outcome. The retry is a defensive layer, not a
correctness requirement for version 1.19.1.

## 5. A missing collection and an absent point both answer 404

**Measured.** An absent point returns:

```
Not found: No point with id 99 found
```

An absent collection returns:

```
Not found: Collection `cto-probe-absent` doesn't exist!
```

Both answers carry the 404 status.

**Consequence.** The transport cannot use the status code to tolerate an absent
point, because that would also hide a missing collection, which is a
configuration error. The code matches the message text `No point with id`
instead.

**Risk.** A message change in a later version breaks the tolerance. The failure
mode is safe: the run raises an error instead of hiding one.

## 6. A vector delete is idempotent on an existing point

**Measured.** A second delete of the same vector on the same point returns
again:

```json
{ "result": { "operation_id": 3, "status": "completed" }, "status": "ok", "time": 0.002506052 }
```

The operation does not fail and does not delete the point.

**Consequence.** A retried clear is safe. The backfill can re-run without a
special case.

## 7. A matrix of integer rows is read as a sparse vector

**Measured.** Two points exist, both with `dense` only. The request writes the
`ast` vector of point `1` as a matrix of integer rows:

```http
PUT /collections/cto-probe-int/points/vectors?wait=true
{"points":[{"id":1,"vector":{"ast":[[1,2],[3,4]]}}]}
```

The answer is an error:

```json
{ "status": { "error": "Wrong input: Conversion between sparse and regular vectors failed" }, "time": 0.002287503 }
```

The same request with `[[1.0,2.0],[3.0,4.0]]` returns
`{"result":{"operation_id":5,"status":"completed"},"status":"ok"}`.

**Consequence.** Qdrant reads a matrix of integer rows as the legacy sparse
form, a pair of an index list and a value list. The transport writes every
matrix value with a decimal point. The value does not change. `1` becomes
`1.0`. The transport keeps a raw-body test for this case.

**Note on the message.** The error text depends on the row shape. The matrix
`[[1,2],[3,4]]` produces
`Wrong input: Conversion between sparse and regular vectors failed`. A matrix of
integer unit rows, recorded in `memos/syntax-trees.md` section "Transport quirks
on Qdrant 1.19.1", produces `indices: must be unique`. Both errors come from the
same misreading, so the project treats the shape as the cause, not the message.

**Risk.** None for the score. The encoder produces floats, so the guard costs
nothing and removes an edge case.

## 8. The sub-vector limit is a hard limit

**Source.** `documentation/manage-data/vectors/index.md`, line 223:

> The maximum number of sub-vectors is `number_of_sub_vectors * vector_size <
1,048,576`. The limit is not configurable.

**Consequence.** With the encoder dimension of 256, one record can hold at most
4095 rows. `4095 * 256 = 1_048_320` is accepted. `4096 * 256 = 1_048_576` is
refused. The transport checks the count before the request and never truncates
a matrix.

## Checks to repeat after an upgrade

Run these checks before the project upgrades Qdrant or changes the vector
layout. Each check uses a throwaway collection.

1. Add a vector definition with `multivector_config` to an existing collection.
   Read the collection information and confirm the comparator.
2. Send an update-vectors request with one vector key only. Read the point and
   confirm that the other vectors and the payload are unchanged.
3. Query with a two-row matrix against a record with the same two rows. Confirm
   that the score is `2.0`, not `1.0`.
4. Delete one vector on a batch that contains an absent identifier. Confirm that
   the present identifiers are cleared.
5. Try to store `4096` rows of `256` dimensions. Confirm that the server refuses
   the request.

## Glossary

- **`ast` vector**: the Qdrant multivector that stores one encoded abstract
  tree per record, with one row per sentence. It backs the `syntax` search
  index.
- **batch**: one request that names several point identifiers.
- **comparator**: the function that Qdrant uses to score two matrices, for
  example `max_sim`.
- **`max_sim`**: the score `sum over i of max over j of Sim(A_i, B_j)`. It is a
  sum of maxima, so the score can be larger than one.
- **multivector**: a vector value that holds a matrix, with one row per sentence
  of the record.
- **point**: one record in a Qdrant collection, with its vectors and its
  payload.
- **sparse vector**: a vector with few non-zero values, stored as an index list
  and a value list. Qdrant uses this form for BM25.
- **stale vector**: a vector that belongs to a record that now fails an
  encoding run. The record must not answer a query through that vector.
- **sub-vector limit**: the hard cap `rows * size < 1,048,576` on one
  multivector.
