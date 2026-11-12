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

### The mirror moves; the 1.19.1 copy does not stay

Agents must read the documentation of the version the project runs. Keeping
both mirrors lets an agent read the wrong one. `docs/Qdrant - 1.19.1/` is
deleted from disk after `docs/Qdrant - 1.20.0/` exists.

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

- [ ] **Task 7.1 — Baseline comparison** — `src/lib/qdrant-baseline.ts` and
      `src/lib/qdrant-baseline.test.ts`. Red first: identical snapshots give no
      finding; a version change is a warning; a collection name or point-count
      change is a blocker; a missing identifier is a blocker; a score drift
      above `1e-6` is a blocker; exact results compare by identifier, so a
      reorder is not a finding; a hybrid reorder is a warning with the common
      count; a query-text change is a blocker.
- [ ] **Task 7.2 — Baseline CLI** — `scripts/qdrant-baseline.ts`. `capture` and
      `compare`, exit codes `0`/`1`/`2`, pretty JSON on stdout. Manual probe
      against the live `1.19.1` server.
- [ ] **Task 7.3 — Reproducible install** — pin `QDRANT_VERSION=1.20.0` and
      `QDRANT_SHA256`, verify after download, update the help block and
      `scripts/README.md`.
- [ ] **Task 7.4 — Capture the 1.19.1 baseline** — `.tmp/qdrant-baseline-1.19.1.json`.
      Keep the file until the ticket closes.
- [ ] **Task 7.5 — Upgrade** — stop the server, copy the storage, start `1.20.0`
      on the copy at port 6433, capture, compare; then install on 6333, capture,
      compare. Keep `qdrant/storage.bak-1.19.1`.
- [ ] **Task 7.6 — Documentation mirror** — `librarian` + `index-tool-docs`
      produce `docs/Qdrant - 1.20.0/`; check the three markers; delete
      `docs/Qdrant - 1.19.1/`; update `AGENTS.md` and `docs/README.md`.
- [ ] **Task 7.7 — Re-checks** — five multivector checks and two transport
      quirks on `1.20.0`; update `memos/qdrant-multivector-behavior.md` and
      `memos/syntax-trees.md`.
- [ ] **Task 7.8 — Memo** — `memos/qdrant-1-20-upgrade.md` with facts, method,
      numbers, follow-ups, and a `## Glossary`.
- [ ] **Task 7.9 — Gates** — `bun fmt`, `bun fmt --check`, `bun run lint`,
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
