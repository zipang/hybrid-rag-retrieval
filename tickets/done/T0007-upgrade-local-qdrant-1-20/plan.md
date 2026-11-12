# T0007 — Plan

Ticket: [`spec.md`](spec.md)

## Goal

Move the development Qdrant from `1.19.1` to `1.20.0` without losing the local
collection, without silent score drift, and with the documentation mirror and
the installation script pinned to the new version.

## Decisions

### The upgrade is proven by a baseline, not by a smoke test

`bun run smoke` prints five results per query. That proves that search answers.
It does not prove that the same points and the same scores survive.

The ticket therefore captures a JSON baseline before the upgrade and compares a
second baseline after. Exact dense and sparse searches are the reference,
because they visit every candidate. Approximate hybrid results are compared as a
warning only: `1.20.0` changes the HNSW level assignment, so a reordered list is
expected and is not a defect.

The harness is a small library plus a script, not a test, because it needs a
live server and a real embedding model. The comparison logic is pure, so it is
unit-tested.

### The first 1.20.0 start opens a copy of the storage

The documented rule is explicit: a newer version migrates the storage to a new
format, and the migration is not reversible. A single-node development server
cannot be rolled back by reinstalling `1.19.1`.

The first start therefore opens `qdrant/storage` copied into a scratch
directory, on port 6433. The real storage is opened only after the comparison
is clean. `qdrant/storage.bak-1.19.1` stays as rollback material until the CEO
validates the ticket.

Rejected alternative: start 1.20.0 directly on `qdrant/storage` and rely on the
copy. The copy would then be a backup of a migrated directory, not of the
original.

### Version and hash are pinned together

`QDRANT_VERSION=latest` made the installed version depend on the day of the
installation, while the local mirror, the memos, and the NixOS derivation all
named a fixed version. The default becomes `1.20.0`, and the tarball SHA-256
becomes a second pinned value.

The script verifies the hash after the download and before extraction. A user
who opts out sets `QDRANT_SHA256=` explicitly. That is one flag more than
silently trusting a mutable URL.

Rejected alternative: verify only when the version equals the default. The
special case is harder to explain than an empty variable.

### The mirror list grows; the 1.19.1 copy stays

Agents must read the documentation of the version they work on. The development
machine runs `1.20.0`, so `docs/Qdrant - 1.20.0/` becomes the default mirror.

The `1.19.1` mirror stays on disk, for two reasons that appeared during
implementation:

1. the NixOS server still runs `1.19.1`, and it stays there until a separate
   ticket moves it, so the project still operates a `1.19.1` deployment;
2. the memos cite `1.19.1` pages as the source of measurements made on
   `1.19.1`; deleting the mirror would leave those claims unverifiable, and
   `memos/AGENTS.md` requires a verifiable source.

The risk that an agent reads the wrong mirror is answered by the wording of the
advertisement, not by deletion: root `AGENTS.md` names both mirrors, says that
`1.20.0` is the default for local work, and says that `1.19.1` documents the
server and the historical measurements.

`qdrant.tech` does not version its pages by URL, so the mirror cannot be
identified by its address. The ticket proves the version by content markers that
exist only in 1.20: `turbo8`/`turbo16`, BM25 on the payload index, and
`substring`.

### The NixOS server is out of scope

The user chose a development-only upgrade. The server keeps its `1.19.1`
derivation and its `1.19.1` memo. A new fact makes the future server ticket
smaller: `1.20.0` requires `GLIBC_2.39`, one step above `1.19.1`.

### New features are recorded, not adopted

The release adds BM25 scoring on the full-text payload index. That feature is
the most interesting one for this project, because it could answer the
one-language BM25 limitation of the citation corpus. It also changes the index
schema and the query shape, so it needs its own ticket and its own measurements.

## Tasks

- [x] **Task 7.1 — Baseline comparison** — `src/lib/qdrant-baseline.ts` and
      `src/lib/qdrant-baseline.test.ts`. Red first: identical snapshots give no
      finding; a version change is a warning; a collection name or point-count
      change is a blocker; a missing identifier is a blocker; a score drift
      above `1e-6` is a blocker; exact results compare by identifier, so a
      reorder is not a finding; a hybrid reorder is a warning with the common
      count; a query-text change is a blocker.
- [x] **Task 7.2 — Baseline CLI** — `scripts/qdrant-baseline.ts`. `capture` and
      `compare`, exit codes `0`/`1`/`2`, pretty JSON on stdout. Manual probe
      against the live `1.19.1` server.
- [x] **Task 7.3 — Reproducible install** — pin `QDRANT_VERSION=1.20.0` and
      `QDRANT_SHA256`, verify after download, update the help block and
      `scripts/README.md`.
- [x] **Task 7.4 — Capture the 1.19.1 baseline** — `.tmp/qdrant-baseline-1.19.1.json`.
      Keep the file until the ticket closes.
- [x] **Task 7.5 — Upgrade** — stop the server, copy the storage, start `1.20.0`
      on the copy at port 6433, capture, compare; then install on 6333, capture,
      compare. Keep `qdrant/storage.bak-1.19.1` until validation, then delete
      it.
- [x] **Task 7.6 — Documentation mirror** — `docs/Qdrant - 1.20.0/` is
      generated (577 files, 576 pages in `index.md`) and carries the three 1.20
      markers; `docs/Qdrant - 1.19.1/` stays for the server and the historical
      measurements; `AGENTS.md` advertises both and `docs/README.md` uses the
      1.20.0 path.
- [x] **Task 7.7 — Re-checks** — five multivector checks and two transport
      quirks on `1.20.0`; update `memos/qdrant-multivector-behavior.md` and
      `memos/syntax-trees.md`.
- [x] **Task 7.8 — Memo** — `memos/qdrant-1-20-upgrade.md` with facts, method,
      numbers, follow-ups, and a `## Glossary`.
- [x] **Task 7.9 — Gates** — `bun fmt`, `bun fmt --check`, `bun run lint`,
      `bun test`, `bunx tsc --noEmit`, and `bun run smoke` against the upgraded
      server.

## Test strategy

`src/lib/qdrant-baseline.test.ts` is hermetic. It builds snapshots as plain
objects and calls `compareBaselines`. No server, no model.

`scripts/qdrant-baseline.ts` is a live probe, outside the test suite. It is
exercised once on `1.19.1` and twice on `1.20.0` (copy and real storage).

The upgrade itself is verified by commands, not by a test:

```sh
bun run qdrant:stop
bun run scripts/qdrant-baseline.ts capture --collection slogans --out .tmp/qdrant-baseline-1.19.1.json
# copy storage, start 1.20.0 on 6433, capture, compare
bun run init --force --skip-model
bun run qdrant:start
bun run scripts/qdrant-baseline.ts capture --collection slogans --out .tmp/qdrant-baseline-1.20.0.json
bun run scripts/qdrant-baseline.ts compare \
  --before .tmp/qdrant-baseline-1.19.1.json \
  --after .tmp/qdrant-baseline-1.20.0.json
```

## Verification

```sh
bun fmt
bun fmt --check
bun run lint
bun test
bunx tsc --noEmit
bun run smoke
```

## Acceptance

See `spec.md`, section "Acceptance Criteria".

## Implementation Notes

### Baseline design

`src/lib/qdrant-baseline.ts` holds the pure comparison and
`scripts/qdrant-baseline.ts` holds the live probe. The comparison is a pure
function, so it is unit-tested with plain objects and no server, no model, and
no clock. `capturedAt` is ignored, because it always differs.

Exact dense and sparse results are the reference. An exact search visits every
candidate, so its score for one identifier is a fact that must survive the
upgrade. The comparison reads each exact result as an identifier-to-score map,
so the order that Qdrant happens to return is not a finding. A missing
identifier and a score drift above `1e-6` are blockers.

Hybrid results are approximate. Qdrant `1.20.0` changes the HNSW level
assignment, so the same five points can come back in another order without any
data problem. The comparison treats a different ordered list as a warning that
names the query and the count of common identifiers. A lost identifier in the
hybrid list is therefore reported, but it does not stop the upgrade on its own,
because the exact results already prove the data.

Findings are split into blockers and warnings, each sorted by query index; a
whole-snapshot finding uses index `-1`. The version difference is the only
expected warning, and it names both versions.

### Storage copy and the first 1.20.0 start

The upgrade rules state that a newer version migrates the storage to a new
format, and that the migration is not reversible. A single node cannot be rolled
back by reinstalling `1.19.1`. The first `1.20.0` start therefore opened
`/tmp/opencode/qdrant-scratch/storage`, a byte copy taken after
`bun run qdrant:stop`, on port `6433`. The original `qdrant/storage` was not
touched until the scratch comparison was clean. `cp -a qdrant/storage
qdrant/storage.bak-1.19.1` was made before the binary was replaced, and the
backup stays on disk.

The scratch start migrated the copy and recovered the `slogans` collection
`1/1 (100%)`. Its baseline had no blocker, only the version warning. The real
install then replaced the binary, started on `6333`, and produced the same
result plus a hybrid reorder warning.

### Pinned version and hash

`scripts/init.sh` now defaults to `QDRANT_VERSION=1.20.0` and
`QDRANT_SHA256=2361f3df0dedfef31f5444f9f15bd15d6b4a6cba6ad952daecc5fbe3867c5ee6`.
The script verifies the tarball after the download and before `tar -xzf`. A
mismatch prints the expected and the actual hash, removes the tarball, and exits
`1`. An empty `QDRANT_SHA256` disables the check, and the help text says that a
`QDRANT_VERSION=latest` user must clear it.

Deviation from the literal contract: the release tag is `v1.20.0`, and the old
URL builder used the raw `QDRANT_VERSION`, so a pinned `1.20.0` produced a 404.
The script now adds the `v` prefix when the value is a bare version, while the
variable keeps the documented value `1.20.0`. An explicit tag also works.

`--force` and `--skip-qdrant` keep their behavior. The Web UI stays on
`latest`.

### Baseline numbers

| Value          | Measurement                                                  |
| -------------- | ------------------------------------------------------------ |
| Version before | `1.19.1` (commit `6ab21cac18ebb6f4ae29102c7f8f5cc11affd5de`) |
| Version after  | `1.20.0` (commit `222b2e44ab1c3f17e8246396ead6558e45041df7`) |
| Collection     | `slogans`                                                    |
| Points         | `236` before and after                                       |
| Queries        | `3`                                                          |
| Dense result   | `236` identifiers per query                                  |
| Sparse result  | `1`, `42`, `0` matching points per query                     |
| Exact pairs    | `751` compared, largest absolute difference `0`              |

The first `1.20.0` comparison, on the scratch copy, printed one warning
(`version differs: before 1.19.1, after 1.20.0`). The second comparison, on the
real storage, printed the same warning plus
`query[1]: hybrid order differs for "slogans similaires à 'Un peu de sucre, beaucoup d'idées'" (5 of 5 identifiers in common)`. Identifiers `33` and `39` swapped. No blocker, so the upgrade was accepted. A second capture on `1.20.0` was identical to the first, so the new order is stable.

### Re-check results

All five multivector behaviors are unchanged on `1.20.0`:

1. The vector-add endpoint accepts `multivector_config`, and the info reports
   `max_sim`.
2. An update with one vector key keeps the other vectors and the payload.
3. Two equal rows score `2.0`.
4. A batch delete with an absent identifier clears the present identifier.
5. `4096` rows of `256` dimensions are refused.

The re-checks found **no behavioral change**. All five multivector behaviors
pass, and both transport quirks reproduce unchanged:

1. The vector-add endpoint accepts `multivector_config`, and the info reports
   `max_sim`.
2. An update with one vector key keeps the other vectors and the payload.
3. Two equal rows score `2.0`.
4. A batch delete with an absent identifier clears the present identifier.
5. `4096` rows of `256` dimensions are refused.

The first draft of this note reported two changed transport quirks. That verdict
was a comparison error, corrected after the review:

- The earlier probe ran only on `1.20.0`, with the `Cosine` distance, and had no
  `1.19.1` counterpart. The review measured both versions side by side, on a
  separate scratch storage on port `6533` with the `v1.19.1` release asset,
  using `distance: Dot`. The responses are identical: integer matrix rows are
  refused with the same message on both versions, and two identical float query
  rows are accepted with the same score on both versions.
- The error text depends on the matrix shape, not on the version.
  `[[1,0],[0,1]]` fails in the sparse conversion, and `[[1,1],[0,0]]` fails
  earlier, in validation, with `indices: must be unique`.

The wrong claims were removed from `memos/qdrant-1-20-upgrade.md`,
`memos/qdrant-multivector-behavior.md`, and `memos/syntax-trees.md`, and each
memo now holds the side-by-side measurement instead of a claim. The transport
rule did not change, and no production code needed a change.

The review also found two defects in the install script, both fixed:

- `QDRANT_SHA256="${QDRANT_SHA256:-...}"` turned an explicit empty value back
  into the pinned hash, so the documented `QDRANT_SHA256=` escape never worked.
  The line now uses `-`, which keeps an explicit empty value empty.
- A host with neither `sha256sum` nor `shasum` skipped the check silently.
  That case now prints an error and exits `1`, with the tarball removed.

### Gates

`bun fmt`:

```text
Formatted 0 files, 195 unchanged [12.57ms]
```

`bun fmt --check`:

```text
All 195 files are formatted.
```

`bun run lint`:

```text
$ biome lint .
Checked 95 files in 48ms. No fixes applied.
```

`bun test`:

```text
487 pass
0 fail
4503 expect() calls
Ran 487 tests across 29 files. [2.66s]
```

`bunx tsc --noEmit`:

```text
exit 0, no diagnostics
```

`bun run smoke`:

```text
Query: slogans sur les produits laitiers de 2005
Results: 5
Query: slogans similaires à 'Un peu de sucre, beaucoup d'idées'
Results: 5
Query: slogans sur le sucre
Results: 5
exit 0
```

### Scope note

Task 7.6, the documentation mirror, was done by the CTO, not by this run. The
coding run did not read, create, delete, or modify anything under `docs/`.

### Deviation: the 1.19.1 mirror stays

The spec first said to delete `docs/Qdrant - 1.19.1/`. The CTO changed that
during the mirror step, for the two reasons in the decision above. Root
`AGENTS.md` now advertises both mirrors and names `1.20.0` as the default for
local work. The spec, the plan, and the acceptance criteria were updated to
match.

### Two defects found in the audit that the gates did not catch

1. The first re-check report claimed two transport behaviors had changed. They
   had not: the `1.19.1` probe was missing, and the `1.20.0` probe used
   `Cosine` instead of `Dot`, which normalizes the rows and produces
   `1.9999999` instead of `1.0`. Re-measured side by side, every verdict is
   `Unchanged`. The three memos were corrected.
2. `QDRANT_SHA256="${QDRANT_SHA256:-…}"` re-applied the pinned hash to an
   explicitly empty value, so `QDRANT_SHA256=` never disabled the check. The
   line now uses `-` (unset only), and a missing SHA-256 tool is an error
   instead of a silent skip.

### Validation and cleanup, 2026-11-12

The CEO/PM opened `http://127.0.0.1:6333/dashboard`, saw Qdrant `1.20.0`, and
confirmed that the `slogans` collection holds its `dense` and `bm25` vectors.
That is the validation of the upgrade.

The rollback copy `qdrant/storage.bak-1.19.1` and the throwaway probe
directories under `/tmp/opencode/` (`qdrant119probe`, `qdrant120`, `initcheck`,
254 MB together) were then deleted. The development machine therefore has no
`1.19.1` storage any more; going back would need a re-import from
`datasets/slogans.txt`. The server after cleanup:

```json
{"version":"1.20.0","commit":"222b2e44ab1c3f17e8246396ead6558e45041df7"}
{"status":"green","optimizer_status":"ok","indexed_vectors_count":236,"points_count":236,"segments_count":8}
```

Note for the future: the dashboard itself is a separate download. Its version
is `qdrant-web-ui@0.2.20`, read from `qdrant/static/qdrant-web-ui.spdx.json`,
and it matches the latest `qdrant-web-ui` release of 2026-10-21. It is not tied
to the server version and it stays on `QDRANT_WEB_UI_VERSION=latest`.
