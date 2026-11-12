# Scripts

Command-line tools that build the local data and run the proof of concept. Git
does not commit the data these scripts produce.

## Index

- `index-dataset.ts` imports one configured dataset into its Qdrant collection.
  It reads the corpus through the generic dataset reader, embeds the content
  field, and upserts one dense vector and one BM25 vector per record. Run it
  with:

  ```sh
  bun run index [--dataset slogans|citations] [--drop] [--limit N] [--batch-size N]
  ```

  Flags:

  - `--dataset <name>`: the dataset to import. The names are the keys of
    `datasetConfigurations`, `slogans` and `citations`. Defaults to `slogans`.
    Every path, field name, collection name, vector name, payload index, and
    dimension comes from that dataset configuration.
  - `--drop`: delete the collection of the selected dataset before the run. Only
    that collection is named.
  - `--limit N`: index the next N records that are absent, so repeated runs
    make progress through the corpus. A run that covers the whole corpus
    publishes `ready`; a run that stops short publishes nothing.
  - `--batch-size N`: records per embedding and upsert batch. Defaults to 256.
  - `--help`: print the usage and exit with code 0.

  The run is **non-destructive by default**. It creates the collection when it
  is absent and never deletes a collection. Without `--drop`, it reads the
  identifiers that the collection already holds with a scroll, then skips every
  corpus record whose identifier is present: no embedding, no upsert. An
  interrupted import therefore continues on the next run, and the second run
  pays only for the records that are absent.

  The run publishes a ready generation only when the corpus stream ends by
  itself. A run stopped by `--limit` is truncated: it publishes nothing, and the
  state stays `rebuilding`. A partial import must not serve queries.

  Each dataset owns one state file. `slogans` keeps `data/index-state.json`,
  because `scripts/index-syntax.ts` refuses a custom `--collection` whose state
  path resolves to that default. Other datasets use
  `data/index-state.<name>.json`, for example `data/index-state.citations.json`.
  `INDEX_STATE_PATH` overrides the path for every dataset, but a path that
  resolves to another dataset's state file is refused.

  A run compares its configuration fingerprint, which covers the dataset, the
  collection, the embedding provider and model, the token width, the vector
  dimensions, and the BM25 options, with the persisted one. A difference is
  refused before any write, because two embedding spaces in one collection
  produce wrong scores without an error. `--drop` starts a new collection and
  skips the comparison.

  **Known limitation:** Qdrant applies one BM25 option set to a whole
  collection, and `BM25_LANGUAGE` is one process-wide value. The citation corpus
  holds French and English quotes, so one language stems the other badly. The
  indexer keeps `bm25Options(process.env)` for every dataset. This is a known
  limitation of the current indexer, not a property of Qdrant. A separate ticket
  owns per-dataset BM25.

- `smoke-retrieval.ts` runs a few example queries against the indexed collection
  for a quick manual check. Run it with `bun run scripts/smoke-retrieval.ts`.

- `qdrant-baseline.ts` captures the answers of one collection and compares two
  captures. The comparison proves that an upgrade kept the points and the exact
  scores. Run it with:

  ```sh
  bun run scripts/qdrant-baseline.ts capture --collection slogans --out .tmp/qdrant-baseline-1.19.1.json
  bun run scripts/qdrant-baseline.ts compare --before .tmp/qdrant-baseline-1.19.1.json --after .tmp/qdrant-baseline-1.20.0.json
  ```

  `capture` reads `QDRANT_URL` and the collection schema from
  `src/config/datasets.ts`. It scrolls every identifier, runs the three queries
  of `smoke-retrieval.ts` with the configured embedder, and writes pretty JSON.
  The JSON records the server version, the point count, the query texts, the
  exact dense and sparse scores, and the hybrid identifier order. The script
  never writes to the collection.

  `compare` prints the diff as pretty JSON and exits `1` when a blocker exists,
  `0` otherwise. A blocker is data loss or score drift: a different collection,
  a different point count, a different query set, a lost identifier, or an exact
  score that moved by more than `1e-6`. Exact scores compare by identifier, so a
  reorder is not a finding. A version change and a hybrid reorder are warnings,
  because the approximate search may return the same points in another order.
  An unknown subcommand, a missing flag, or an unreadable file exits `2`.

## Qdrant

- `qdrant.ts` starts and stops the local Qdrant server. It reads the host and
  the HTTP port from `qdrant/config/config.yaml`, writes a PID file and a log
  file under `.tmp/`, and prints the admin dashboard URL.
  - `bun run qdrant:start` starts Qdrant in the background.
  - `bun run qdrant:stop` stops Qdrant with a clean termination signal.

  The script is safe to run twice. A start against a running server reports the
  existing URL. A stop against a stopped server reports that Qdrant is not
  running. If the server does not become healthy, read `.tmp/qdrant.log`. Each
  message starts with an icon and a color. Colors turn off when the output is
  not a terminal.

## Syntax

- `show-syntax-tree.ts` parses one sentence with the configured UDPipe model and
  prints its syntax tree as a flat table and as an indented tree. Run it with
  `bun run show-syntax-tree "Le garçon regarde le soleil"`.
- `compare-syntax.ts` parses two sentences and prints their syntax similarity
  score. A score of one means the two trees have the same shape. Run it with
  `bun run compare-syntax "Le garçon regarde le soleil" "Un chat mange une souris"`.
  It accepts `--mode coarse`, the only mode implemented in this ticket.
- `index-syntax.ts` adds the `ast` vector to records that already exist in the
  collection, without deleting the collection. It encodes the grammatical
  structure of every record, keeps the dense vector, the BM25 vector, and the
  business payload unchanged, and publishes a ready state only after it accounts
  for every record. It clears the `ast` vector of every excluded record, so a
  record that cannot be represented is never left searchable by its old vector.

  ```sh
  bun run scripts/index-syntax.ts --mode coarse
  bun run scripts/index-syntax.ts --mode coarse --batch-size 64 --limit 20
  INDEX_STATE_PATH=.tmp/probe-state.json \
    bun run scripts/index-syntax.ts --collection t0004-task13-probe
  ```

  Flags:

  - `--mode coarse`: the only mode implemented today. The `detailed` name is
    accepted by the flag parser and refused with a clear message, because that
    mode is deferred to a future ticket.
  - `--batch-size N`: identifiers per payload fetch, per vector update, and per
    vector clear. Defaults to 128.
  - `--generation <id>`: the generation to backfill. Defaults to the current
    generation. The run refuses a generation that is not ready, a generation
    that already holds the other syntax mode, and a generation that holds the
    same mode under a different configuration. A configuration change, such as a
    parser, model, abstraction, or encoder bump, needs a new generation from the
    full indexer, not a backfill.
  - `--limit N`: stop after N identifiers. The reported `eligible` count is
    truncated too, so the coverage stays consistent. A truncated run publishes
    `pending`, never `ready`, because it does not account for every record.
  - `--collection <name>`: run against another collection with the same dataset
    schema. The vector names, the payload fields, and the payload indexes stay
    those of the dataset schema. Use it for a probe collection.

  `--collection` needs `INDEX_STATE_PATH`, and the path must not resolve to the
  default file. The generation state describes one collection, so a run against
  another collection that still wrote the default `data/index-state.json` would
  publish probe coverage into the real generation. The script therefore compares
  resolved paths and refuses `data/index-state.json`, `./data/index-state.json`,
  and `data/../data/index-state.json` alike, with `CustomCollectionStateError`:

  ```sh
  INDEX_STATE_PATH=.tmp/probe-state.json \
    bun run scripts/index-syntax.ts --collection t0004-task13-probe
  ```

  The run records every record that it could not index, with its identifier and a
  reason. A missing parser model aborts the run before anything is published. The
  script reads `INDEX_STATE_PATH` and the Qdrant environment, like the full
  indexer.

## Citations

- `build-citations.ts` reads the French and English Wikiquote dumps and writes
  `datasets/citations.txt`. Run it with `bun run scripts/build-citations.ts`.
- `citations/` holds the helpers:
  - `wikitext.ts` parses templates, links, and markup.
  - `extract.ts` extracts citation records from French and English pages.
  - `pages.ts` parses dump pages, filters author pages, and filters quotes.
  - `extract.test.ts` and `pages.test.ts` are the unit tests.

### Citation source

The build reads two MediaWiki XML dumps. They are not RDF and Git does not
commit them. Download them into `.tmp/` before the build:

```
curl -sSL -o .tmp/frwikiquote-pages-articles.xml.bz2 \
  https://dumps.wikimedia.org/frwikiquote/latest/frwikiquote-latest-pages-articles.xml.bz2
curl -sSL -o .tmp/enwikiquote-pages-articles.xml.bz2 \
  https://dumps.wikimedia.org/enwikiquote/latest/enwikiquote-latest-pages-articles.xml.bz2
bun run scripts/build-citations.ts
```

The build keeps short quotes only: at most three sentences and at most 500
characters. It reads the author of a quote from the source reference, never
from a link inside the quote text. It sets the author to `Anonymous` when the
source gives none. A missing `year` stays absent.

Useful flags:

- `--lang fr|en|both` limits the languages.
- `--limit N` truncates the output for a quick check.
- `--max-pages N` limits the pages read per dump.
- `--dry` runs without writing a file.
- `--out PATH` writes to another path.

The source dumps are published by the Wikimedia Foundation under the Creative
Commons Attribution-ShareAlike 4.0 license and the GNU Free Documentation
License.

## Local setup

- `init.sh` prepares everything the application and the tests need locally. It
  downloads the Qdrant binary and Web UI into `qdrant/`, and the pinned French
  parser model into `models/`. Run it with `bun run init`.

  The Qdrant server version defaults to `1.20.0`. After the download and before
  the extraction, the script computes the SHA-256 of the release tarball and
  compares it with the pinned value. A mismatch removes the tarball, prints the
  expected and the actual hash, and exits `1`. The pinned version and the pinned
  hash move together, so one upgrade changes both lines in `scripts/init.sh`.

  Set `QDRANT_VERSION` and `QDRANT_SHA256` to install another release. An empty
  `QDRANT_SHA256` skips the check; a user who sets `QDRANT_VERSION=latest` must
  clear the hash too, because the pinned hash describes one release only. An
  empty value is written `QDRANT_SHA256=`, with nothing after the equal sign. A
  host with neither `sha256sum` nor `shasum` is an error, not a silent skip.

Useful flags:

- `--skip-qdrant` installs only the parser model.
- `--skip-model` installs only Qdrant.
- `--force` reinstalls a component that is already present.
- `--model NAME`, `--model-url URL`, `--model-path PATH` override the parser
  model source.

The script is idempotent. It skips a component that is already present.

## Glossary

- **baseline**: a JSON record of what a running server answers for a fixed query
  set, used to compare two versions.
- **BM25**: a ranking method that scores records by their matching words.
- **blocker**: a comparison finding that proves data loss or score drift, and
  that stops an upgrade.
- **collection**: the named set of points that Qdrant stores.
- **dense vector**: the fixed-length vector that carries the meaning of a text.
- **dump**: a compressed XML file that contains the pages of a Wikimedia wiki.
- **fingerprint**: a short value computed from a configuration, used to compare
  two configurations.
- **model**: a trained data file that a parser loads.
- **point**: one record in a collection.
- **Qdrant**: the vector database that stores the hybrid index.
- **resume**: continue an interrupted import by skipping the records that the
  collection already holds.
- **UDPipe**: a trainable pipeline for tokenization, tagging, lemmatization, and
  dependency parsing.
- **upsert**: a write that inserts a point, or replaces the point with the same
  identifier.
- **warning**: a comparison finding that an upgrade may cause, and that a human
  must read before validation.
- **Wikiquote**: a free compendium of sourced quotes, published by the Wikimedia Foundation.
- **wikitext**: the source markup of a wiki page.
