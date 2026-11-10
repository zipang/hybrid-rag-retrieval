# Scripts

Command-line tools that build the local data and run the proof of concept. Git
does not commit the data these scripts produce.

## Slogans

- `index-slogans.ts` reads `datasets/slogans.txt` through the generic dataset
  reader, embeds each slogan, and upserts dense and BM25 vectors to Qdrant.
  Run it with `bun run scripts/index-slogans.ts`.
- `smoke-retrieval.ts` runs a few example queries against the indexed collection
  for a quick manual check. Run it with `bun run scripts/smoke-retrieval.ts`.

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

Useful flags:

- `--skip-qdrant` installs only the parser model.
- `--skip-model` installs only Qdrant.
- `--force` reinstalls a component that is already present.
- `--model NAME`, `--model-url URL`, `--model-path PATH` override the parser
  model source.

The script is idempotent. It skips a component that is already present.

## Glossary

- **BM25**: a ranking method that scores records by their matching words.
- **dump**: a compressed XML file that contains the pages of a Wikimedia wiki.
- **model**: a trained data file that a parser loads.
- **Qdrant**: the vector database that stores the hybrid index.
- **UDPipe**: a trainable pipeline for tokenization, tagging, lemmatization, and
  dependency parsing.
- **Wikiquote**: a free compendium of sourced quotes, published by the Wikimedia Foundation.
- **wikitext**: the source markup of a wiki page.
