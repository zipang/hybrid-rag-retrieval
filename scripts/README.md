# Scripts

Command-line tools that build the local data and run the proof of concept. Git
does not commit the data these scripts produce.

## Slogans

- `index-slogans.ts` reads `datasets/slogans.txt` through the generic dataset
  reader, embeds each slogan, and upserts dense and BM25 vectors to Qdrant.
  Run it with `bun run scripts/index-slogans.ts`.
- `smoke-retrieval.ts` runs a few example queries against the indexed collection
  for a quick manual check. Run it with `bun run scripts/smoke-retrieval.ts`.

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
