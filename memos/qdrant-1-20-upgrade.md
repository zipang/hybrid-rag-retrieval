# Qdrant 1.20.0 — development environment upgrade

The development machine ran Qdrant `1.19.1` and now runs `1.20.0`. This memo
records the release facts, the upgrade rules, the storage-copy procedure, the
baseline measurements, and the behaviors that were re-checked.

The NixOS server does not move in this upgrade. It stays on `1.19.1` until a
separate ticket moves it; see `memos/qdrant-nixos-setup.md`.

The upgrade ran on 2026-11-12. The server answered `GET /` with:

```json
{ "title": "qdrant - vector search engine", "version": "1.20.0", "commit": "222b2e44ab1c3f17e8246396ead6558e45041df7" }
```

Before the upgrade, the same call answered `1.19.1` with commit
`6ab21cac18ebb6f4ae29102c7f8f5cc11affd5de`.

## 1. Release facts

Asset:
`https://github.com/qdrant/qdrant/releases/download/v1.20.0/qdrant-x86_64-unknown-linux-gnu.tar.gz`

| Value             | Measurement                                                        |
| ----------------- | ------------------------------------------------------------------ |
| Tarball size      | `33,618,587` bytes                                                 |
| Tarball SHA-256   | `2361f3df0dedfef31f5444f9f15bd15d6b4a6cba6ad952daecc5fbe3867c5ee6` |
| Tarball SRI       | `sha256-I2Hz3w3t/vMfVET58VvRXWtKbLpq2VLa7MX744Z8XuY=`              |
| Tarball content   | one file, `qdrant`                                                 |
| Binary size       | `92,812,720` bytes                                                 |
| Binary Build ID   | `76a21c62bf01d8436e0790318c498753d026322e`                         |
| Highest GLIBC tag | `GLIBC_2.39`                                                       |

The commands that produced the values:

```sh
curl -sSL -o qdrant.tar.gz \
  https://github.com/qdrant/qdrant/releases/download/v1.20.0/qdrant-x86_64-unknown-linux-gnu.tar.gz
sha256sum qdrant.tar.gz
stat -c %s qdrant.tar.gz
tar -tzf qdrant.tar.gz
tar -xzf qdrant.tar.gz qdrant
stat -c %s qdrant
readelf -n qdrant | grep -i "build id"
strings qdrant | grep -o 'GLIBC_2\.[0-9]*' | sort -V | tail -1
```

The hash was measured again before the install, on the same file, and it
matched. The installed `qdrant/qdrant` has the same size and Build ID as the
tarball content, so it is the same build.

`GLIBC_2.39` is one step above the `GLIBC_2.38` requirement of `1.19.1`. The
development machine provides it. The server channel must provide it too when
that machine moves.

## 2. Upgrade rules

The upgrade page states:

> If you are several versions behind, multiple updates might be required to
> reach the latest version. When upgrading Qdrant, upgrade to the latest patch
> version of each intermediate minor version first.

It also states:

> A Qdrant node with version 1.17 will be compatible with a node with version
> 1.16, but not with a node with version 1.15. If you run a single node
> cluster, you also can not skip versions to ensure that all data migrations are
> properly applied.

Source: <https://qdrant.tech/documentation/upgrades/>, read on 2026-11-12. The
local copy is `docs/Qdrant - 1.20.0/documentation/upgrades/index.md`.

`1.19` to `1.20` is one consecutive minor step, so the rule allows the direct
move.

The FAQ states:

> We do not support downgrading a cluster on any of our products. If you deploy
> a newer version of Qdrant, your data is automatically migrated to the newer
> storage format. This migration is not reversible.

Source: <https://qdrant.tech/documentation/faq/qdrant-fundamentals/>, read on
2026-11-12. The local copy is
`docs/Qdrant - 1.20.0/documentation/faq/qdrant-fundamentals/index.md`.

Three consequences drive the procedure:

1. The first start of `1.20.0` is irreversible for the storage that it opens.
   The first start therefore opens a **copy** of the storage, never the
   original.
2. The original storage is copied to `qdrant/storage.bak-1.19.1` before the
   binary is replaced. That copy is the rollback material.
3. The development server is a single node, so the upgrade includes a short
   downtime. That is acceptable on a development machine.

The upgrade page also states that a single-node cluster needs a restart, which
is the downtime above.

## 3. Upgrade-relevant changes in 1.20.0

The release notes list many features. The table keeps the entries that can
affect this repository, and why.

| Change                                                                                                                            | Why it matters here                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| BM25 scoring on the full-text payload index                                                                                       | A possible answer to the one-language BM25 limitation. Not adopted here.              |
| Vector names that escape the segment directory are rejected                                                                       | The client uses `dense`, `bm25`, and `ast`, so no effect. Checked by the live probes. |
| HNSW level assignment follows the paper (`floor()`)                                                                               | Approximate hybrid ranking may move slightly. Exact scores must not.                  |
| `must_not` is no longer ignored when it equals an indexed `must`                                                                  | The filters use `must` only today.                                                    |
| `timeout` on the get-points API                                                                                                   | Unused today. Listed as a follow-up.                                                  |
| `hnsw_config.inline_storage`, TurboQuant, nested and `code` indexes, `substring` match, `created_at`, formula `acosh`/`max`/`min` | Unused today. Listed as follow-ups.                                                   |

Source: <https://github.com/qdrant/qdrant/releases/tag/v1.20.0>, read on
2026-11-12.

The notes list no change to the crash format, the REST paths, or the payload
format. The baseline diff below proves that claim on the real collection
instead of trusting it.

## 4. Reproducible installation

`scripts/init.sh` now pins the version and the tarball hash:

```sh
QDRANT_VERSION="${QDRANT_VERSION:-1.20.0}"
QDRANT_SHA256="${QDRANT_SHA256-2361f3df0dedfef31f5444f9f15bd15d6b4a6cba6ad952daecc5fbe3867c5ee6}"
```

The hash line uses `-` and not `:-`, so an explicitly empty value stays empty
and skips the check. With `:-`, an empty value would fall back to the pinned
hash, and `QDRANT_SHA256=` would not do what the help text promises.

After the download and before `tar -xzf`, the script computes the SHA-256 of
the tarball. A mismatch removes the file, prints the expected and the actual
hash, and exits `1`. An empty `QDRANT_SHA256` disables the check, because
`QDRANT_VERSION=latest` cannot match a pinned hash. A host with neither
`sha256sum` nor `shasum` is an error, not a silent skip: the script prints the
missing tool and exits `1` with the tarball removed.

The release tag carries a `v` prefix. The script adds the prefix when
`QDRANT_VERSION` is a bare version such as `1.20.0`, so the URL becomes
`releases/download/v1.20.0/...`. The variable keeps the documented value
`1.20.0`, and an explicit tag such as `v1.20.0` also works.

Measured behavior of the script:

```sh
QDRANT_DEST_DIR=/tmp/opencode/hashcheck \
  QDRANT_SHA256=0000000000000000000000000000000000000000000000000000000000000000 \
  bash scripts/init.sh --force --skip-model
# ERROR: checksum mismatch for /tmp/opencode/hashcheck/qdrant.tar.gz.
#   expected 0000...
#   got      2361f3df0dedfef31f5444f9f15bd15d6b4a6cba6ad952daecc5fbe3867c5ee6
# exit 1, and the tarball is removed
```

```sh
QDRANT_DEST_DIR=/tmp/opencode/hashcheck QDRANT_SHA256= \
  bash scripts/init.sh --force --skip-model
# Installed: /tmp/opencode/hashcheck/qdrant
# exit 0
```

The same install with a `PATH` that holds no `sha256sum` and no `shasum`:

```sh
env -i PATH=/tmp/opencode/toolcheck/bin QDRANT_DEST_DIR=/tmp/opencode/toolcheck/dest \
  /bin/bash scripts/init.sh --force --skip-model
# ERROR: no SHA-256 tool found (sha256sum or shasum).
# Set QDRANT_SHA256= to skip the check.
# exit 1, and the tarball is removed
```

The empty-hash install on that `PATH` succeeds, which proves the two branches
are independent.

The second install produced a binary of `92,812,720` bytes with Build ID
`76a21c62bf01d8436e0790318c498753d026322e`.

`--force` still re-downloads, and `--skip-qdrant` still skips the Qdrant step.
The Web UI version stays `latest`, and this upgrade does not touch it.

## 5. Storage-copy procedure

The procedure ran these steps, in this order:

1. `bun run scripts/qdrant-baseline.ts capture --collection slogans --out .tmp/qdrant-baseline-1.19.1.json`
   while `1.19.1` still answered on port `6333`.
2. `bun run qdrant:stop`.
3. `cp -a qdrant/storage qdrant/storage.bak-1.19.1`.
4. Copy the storage, and a copy of `qdrant/config/config.yaml`, into
   `/tmp/opencode/qdrant-scratch`. Start the verified `1.20.0` binary there with
   `QDRANT__SERVICE__HTTP_PORT=6433` and
   `QDRANT__SERVICE__GRPC_PORT=6434`. Compare the first `1.20.0` baseline on
   port `6433` with the `1.19.1` baseline, then stop the scratch server.
5. `bun run init --force --skip-model`, then `bun run qdrant:start`. Capture the
   baseline on port `6333` and compare it again.
6. Keep the server on `6333` with `1.20.0`, and keep
   `qdrant/storage.bak-1.19.1`.

The scratch start is the step that matters. The migration rewrites the storage
in place, and Qdrant cannot downgrade a migrated directory. A scratch start
proves that the migration runs without risking the original data. The real
start happens only after the scratch comparison is clean.

The scratch log showed the migration on a copy:

```text
Loading collection: slogans
Recovered collection slogans: 1/1 (100%)
Qdrant HTTP listening on 6433
```

It also warned that the copy lives on `tmpfs`, which is expected for
`/tmp/opencode`.

## 6. Baseline measurements

The baseline is a JSON record of the answers of the `slogans` collection for the
three example queries of `scripts/smoke-retrieval.ts`. Exact dense and sparse
scores are the reference, because an exact search visits every candidate.
Hybrid results are approximate, so a reorder is a warning only.

The `1.19.1` baseline had:

| Value             | Measurement                                  |
| ----------------- | -------------------------------------------- |
| Version           | `1.19.1`                                     |
| Collection        | `slogans`                                    |
| Points            | `236`                                        |
| Queries           | `3`                                          |
| Dense result size | `236` identifiers per query                  |
| Sparse result     | `1`, `42`, and `0` matching points per query |
| Exact comparisons | `751` dense and sparse score pairs           |

A sparse exact search returns only the points that match at least one query
term, so its result is smaller than the dense result. The third query matches
no point, which is also what the `1.19.1` baseline recorded.

The scratch `1.20.0` comparison printed:

```json
{
  "blockers": [],
  "warnings": ["version differs: before 1.19.1, after 1.20.0"]
}
```

The real `1.20.0` comparison, on port `6333`, printed:

```json
{
  "blockers": [],
  "warnings": ["version differs: before 1.19.1, after 1.20.0", "query[1]: hybrid order differs for \"slogans similaires à 'Un peu de sucre, beaucoup d'idées'\" (5 of 5 identifiers in common)"]
}
```

The second warning means the same five points came back in another order:
`[172, 52, 39, 33, 118]` on `1.19.1` and `[172, 52, 33, 39, 118]` on
`1.20.0`. Identifiers `33` and `39` swapped. Both snapshots share all five
identifiers, so no point was lost.

A second capture on `1.20.0` was identical to the first `1.20.0` capture, so the
new order is stable and not a random reorder between runs.

The exact comparison covered `751` score pairs. The largest absolute difference
was `0`. Every point kept its identifier and its score, which proves that the
data survived the migration and that the exact scores did not drift.

## 7. Re-checks after the upgrade

The five multivector behaviors and the two transport quirks were re-run on
`1.20.0`, each with a throwaway `cto-probe-*` collection. The full commands and
responses are in `memos/qdrant-multivector-behavior.md`, section "Re-check on
Qdrant 1.20.0", and in `memos/syntax-trees.md`, section "Re-check on Qdrant
1.20.0, 2026-11-12".

A re-check can only report a change against the same probe on the old version.
The `1.19.1` side therefore ran on a separate scratch storage on port `6533`,
with the binary from the `v1.19.1` release asset; the scratch storage was
deleted afterwards. Both sides used the collection `cto-probe-quirk`, with a
`syntax` multivector of size `2`, comparator `max_sim`, and `distance: Dot`.

| Check                                                  | Verdict   | Note                                                          |
| ------------------------------------------------------ | --------- | ------------------------------------------------------------- |
| Add a multivector definition with `multivector_config` | Unchanged | The info reports `max_sim`.                                   |
| Update one vector key only                             | Unchanged | The `dense` vector and the payload are unchanged.             |
| Two equal rows score `2.0`                             | Unchanged | The response is `2.0`, not `1.0`.                             |
| Batch delete with an absent identifier                 | Unchanged | The present identifier is cleared, the other point untouched. |
| `4096` rows of `256` dimensions                        | Unchanged | The server refuses `1048576` elements.                        |
| Integer matrix rows, upsert                            | Unchanged | Refused on both versions, with the same message per shape.    |
| Integer query rows, exact query                        | Unchanged | Refused on both versions with the sparse conversion error.    |
| Two identical float query rows                         | Unchanged | Accepted on both versions, same score.                        |

The two transport quirks were measured side by side:

| Probe                               | `1.19.1` response                                                                                                           | `1.20.0` response                                                                                                           |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Upsert `[[1,0],[0,1]]`              | `{"status":{"error":"Wrong input: Conversion between sparse and regular vectors failed"}}`                                  | `{"status":{"error":"Wrong input: Conversion between sparse and regular vectors failed"}}`                                  |
| Upsert `[[1,1],[0,0]]`              | `{"status":{"error":"Validation error in JSON body: [points[0].vector.?.indices: Validation error: must be unique [{}]]"}}` | `{"status":{"error":"Validation error in JSON body: [points[0].vector.?.indices: Validation error: must be unique [{}]]"}}` |
| Exact query `[[1,0],[1,0]]`         | `{"status":{"error":"Wrong input: Conversion between sparse and regular vectors failed"}}`                                  | `{"status":{"error":"Wrong input: Conversion between sparse and regular vectors failed"}}`                                  |
| Exact query `[[0.5,0.5],[0.5,0.5]]` | `{"points":[{"id":3,"version":3,"score":1.0}]}`                                                                             | `{"points":[{"id":3,"version":1,"score":1.0}]}`                                                                             |

Both quirks still reproduce for the integer form on both versions. The float
form is accepted on both versions. No error message changed.

The error text depends on the shape of the matrix, not on the server version.
The matrix `[[1,0],[0,1]]` fails in the sparse conversion, because the JSON
parser reads the outer array as a sparse vector. The matrix `[[1,1],[0,0]]`
fails earlier, in validation, because the first row repeats an index.

No code change was necessary. The rule stays the same: every matrix value is
written as a float, so Qdrant never reads a matrix as a sparse vector.

## 8. Follow-ups

These items came with `1.20.0` and are not part of this upgrade:

- BM25 scoring on the full-text payload index. It could replace server-side
  BM25 inference and answer the one-language BM25 limitation of the citation
  corpus. It changes the index schema and the query shape, so it needs its own
  ticket and its own measurements.
- A `nested` payload index for arrays of objects.
- The `substring` match, the `code` tokenizer, `created_at`, the get-points
  `timeout`, `hnsw_config.inline_storage`, and the TurboQuant datatypes.
- The NixOS server upgrade to `1.20.0`, including the `GLIBC_2.39` requirement
  and the new SRI hash.

## 9. Rollback material

`qdrant/storage.bak-1.19.1` held the storage as `1.19.1` left it. It stayed on
disk until validation. Qdrant cannot downgrade a migrated storage, so that copy
was the only way back to `1.19.1`.

The CEO/PM validated the upgrade on 2026-11-12, after checking the `1.20.0`
dashboard and the `slogans` collection with its `dense` and `bm25` vectors. The
copy was then deleted, together with the throwaway probe directories under
`/tmp/opencode/`.

A future reader must understand the consequence: the development machine has no
`1.19.1` storage any more. Going back would need a re-import from
`datasets/slogans.txt`. The remote NixOS server keeps its own `1.19.1` storage,
which the upgrade did not touch.

## References

- `scripts/init.sh`
- `scripts/qdrant-baseline.ts`
- `src/lib/qdrant-baseline.ts`
- `memos/qdrant-multivector-behavior.md`
- `memos/syntax-trees.md`
- `memos/qdrant-review.md`
- `memos/qdrant-nixos-setup.md`
- <https://qdrant.tech/documentation/upgrades/>
- <https://qdrant.tech/documentation/faq/qdrant-fundamentals/>
- <https://github.com/qdrant/qdrant/releases/tag/v1.20.0>
- `docs/Qdrant - 1.20.0/documentation/upgrades/index.md`
- `docs/Qdrant - 1.20.0/documentation/faq/qdrant-fundamentals/index.md`

## Glossary

- **baseline**: a JSON record of what a running server answers for a fixed query
  set, used to compare two versions.
- **blocker**: a comparison finding that proves data loss or score drift, and
  that stops the upgrade.
- **Build ID**: the identifier that the compiler writes into a binary, used to
  prove that two binary files are the same build.
- **downgrade**: a move to an older version. Qdrant does not support it, because
  the storage migration is one-way.
- **exact search**: a score computed against every candidate, with no
  approximate index. Its result must not change across an upgrade.
- **HNSW**: the graph index that makes nearest-neighbour search fast and
  approximate.
- **in-place upgrade**: a version change that keeps the existing storage
  directory.
- **minor version**: the second number of a version, for example `20` in
  `1.20.0`.
- **multivector**: a vector value that holds a matrix, with one row per sentence
  of the record.
- **scratch storage**: a copy of the storage directory, started on another port,
  used to test a migration without touching the original.
- **SRI hash**: a checksum written in the `sha256-<base64>` form that Nix uses.
- **tmpfs**: a filesystem that lives in memory and loses its files on restart.
- **warning**: a comparison finding that an upgrade may cause, and that a human
  must read before validation.
