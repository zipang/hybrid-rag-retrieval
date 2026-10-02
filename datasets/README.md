# Datasets

This directory holds local corpus files. Git does not commit these files.
Get each corpus from its source after you clone the project.

## Text format

A corpus is a UTF-8 text file with one record per block. A line with `---`
separates blocks. Each field uses the form `label: value`. The schema model
defines the record fields. Use each schema property key as the canonical label
in new corpus files. The property `title` stores a fallback label for existing
or alternate corpus formats.

The reader checks each line label against property keys first. It checks
property titles second. It does not depend on property or line order.

Example citation block:

```
id: 1
author: William Shakespeare
work: Hamlet
year: 1603
lang: en
trad:
quote: To be, or not to be: that is the question
---
```

The reader converts values to the types in the schema. It rejects a block when
the block does not pass validation. It then reads the next block. The `id`
field of each dataset uses the `integer` type, so the reader coerces the source
`Id` text to a number.

## Citation corpus source

The citation corpus comes from the French and English Wikiquote dumps. Wikiquote
is a free quote compendium. The Wikimedia Foundation publishes it under the
Creative Commons Attribution-ShareAlike 4.0 license and the GNU Free
Documentation License.

`scripts/build-citations.ts` reads the two MediaWiki XML dumps and writes
`citations.txt`. Download the dumps into `.tmp/` first:

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
source gives none. A missing `year` stays absent. The build fills a missing
year from a work-title index built from dated citations.

## Add a dataset

1. Put the corpus file in this directory.
2. Add its JSON Schema, inferred type, and validation function in `src/models/`.
3. Set each property's `title` to the legacy source label when it differs from the property key.
4. Add its path in `src/config/datasets.ts`.
5. Set its content field and identifier field in the dataset configuration.
6. Add tests for valid, invalid, and out-of-order records.
7. Run `bun test`.

## Field roles and query context

Every record schema has a description. Every property description starts with a
role label. Use `Content field` for text that enters dense and lexical search.
Use `Filter field` for metadata that narrows search results. Use
`Record identifier` for the source record ID.

Property keys are the primary source labels. Titles are fallback labels for
existing corpus files. Query agents use property keys as stable field names and
read descriptions to select content and filters.

The shared schema type requires each description. Tests reject empty descriptions
and descriptions without a role label.

| Dataset | Field | Role | Intended use |
|---|---|---|---|
| Slogans | `id` | Record identifier | Keep the source ID for record identity. Do not embed or filter on it. |
| Slogans | `annee` | Filter field | Filter by publication year. Exclude it from content indexing. |
| Slogans | `marque` | Filter field | Filter by brand or issuing organization. Exclude it from content indexing. |
| Slogans | `campagne` | Filter field | Filter by campaign when the value is not empty. Exclude it from content indexing. |
| Slogans | `slogan` | Content field | Use for dense semantic embeddings and BM25 lexical indexing. |
| Citations | `id` | Record identifier | Keep the source ID for record identity. Do not embed or filter on it. |
| Citations | `author` | Filter field | Filter by citation author. Exclude it from content indexing. |
| Citations | `work` | Filter field | Filter by the work that contains the citation. Exclude it from content indexing. |
| Citations | `year` | Filter field | Filter by the work's publication year. Exclude it from content indexing. |
| Citations | `lang` | Filter field | Filter by citation language. Exclude it from content indexing. |
| Citations | `trad` | Filter field | Filter by translator when the value is not empty. Exclude it from content indexing. |
| Citations | `quote` | Content field | Use for dense semantic embeddings and BM25 lexical indexing. |

Query agents use the JSON Schema descriptions as context. They search the
content field and apply filters to fields that have the `Filter field` role.
For example, a request for Danone slogans from 2004 uses `slogan` as content and
uses `marque` and `annee` as filters. A request for Hamlet citations about
ambition uses `quote` as content and `author` and `work` as filters.

These roles describe the intended use of each field. The project decides which
filter fields need a Qdrant payload index. A field that users filter on gets a
payload index, so Qdrant can filter quickly.

## Rejected records

The reader reports each rejected block with its block number and a reason. The
importer logs the corpus path, block number, and reason for each rejected block.
It then continues with the next block. Use the reason to find and correct the
source line.

## Version control

Git ignores corpus files. Git keeps only this `README.md` and `AGENTS.md`.
Do not commit corpus data.

## Glossary

- **BM25**: a ranking method that scores records by their matching words.
- **content field**: the text field that carries the meaning of a record and enters semantic and lexical indexing.
- **corpus**: the complete set of records that the project reads.
- **dataset configuration**: the settings that link a corpus file and its schema to the content field and the identifier field.
- **dense vector**: a list of numbers that represents the meaning of a text.
- **filter field**: a metadata field that narrows the results without entering the content index.
- **JSON Schema**: a JSON structure that declares the record fields, types, and validation rules.
- **lexical search**: a search that matches words instead of meaning.
- **MediaWiki dump**: a compressed XML file that contains the pages of a Wikimedia wiki.
- **query agent**: an LLM that uses the schema descriptions to choose the content field and the filter fields for a search.
- **record**: one item in a corpus, such as one slogan or one citation.
- **record identifier**: the source ID that identifies a record.
- **rejection reason**: a short message that explains why a block failed to parse or validate.
- **schema model**: a module that exports a JSON Schema, an inferred TypeScript type, and a validation function.
- **schema title**: the JSON Schema `title` field. It stores a fallback source label when the label differs from the property key.
- **Wikiquote**: a free compendium of sourced quotes, published by the Wikimedia Foundation.
- **wikitext**: the source markup of a wiki page.
