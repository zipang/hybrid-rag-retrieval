# Spec: [T0002] Schema-Driven Dataset Extraction

Ticket: `T0002` — spec: `roadmap/T0002/spec.md`

## Objective

Let the project owner define and read datasets with different record fields without adding field-specific parsing code. Prepare the generic readers for the indexing work in T0001.

The first two datasets are slogans and citations. Their UTF-8 corpus files live in `datasets/`. Each record contains `name: value` lines, and `---` separates records.

Each model in `src/models/` exports its JSON Schema definition, the TypeScript type that `tjs` infers from that definition, and a validation function. Property keys are the canonical field names. Each property `title` stores a fallback label for existing corpus text. The root schema and every property must have a non-empty `description`. Each property description states whether it is content, a filter, or a record identifier. The generic reader matches each line by property key first and title second. It checks and coerces text values, such as a year, to the declared type.

Dataset configuration stays separate from the record model. It links a model to its corpus path, content field, and identifier field. The model schema owns field structure, canonical keys, and fallback titles.

Schema properties follow the customary field order in each corpus for readability. The reader does not depend on this order because property keys and titles identify fields.

Query agents use property descriptions to select the content field and filter fields. T0001 owns the later Qdrant indexing and query behavior.

If a block is malformed or fails schema validation, the reader emits a rejection event with the block number and reason. It continues to the next block. The T0001 importer logs each rejection with the corpus path, block number, and reason. T0002 does not implement Qdrant indexing.

Success means the same generic reader can process both datasets. The existing slogan behavior remains covered by tests. T0001's specification and plan describe how its indexing work will use these readers and dataset declarations.

## Tech Stack

- Runtime: Bun 1.4 with TypeScript.
- Validation and type inference: `tjs` 7.0.0, the current npm release checked for this spec.
- Schema format: JSON Schema objects declared in TypeScript model modules, so `tjs` can infer each record type.
- Tests and lint: Bun test and Biome.

## Commands

```sh
bun install
bun test
bun run lint
bunx biome check --write <edited-files>
```

T0002 adds no indexing command. T0001 defines the indexing commands after it adopts the generic readers.

## Project Structure

```text
datasets/
  slogans.txt                 → Existing slogan corpus; local data stays untracked
  citations.txt               → Citation corpus; local data stays untracked
src/
  utils/data-utils.ts         → Generic in-memory and streaming text readers
  models/
    schema.ts                 → Shared JSON Schema type with required descriptions
    slogan.ts                 → Slogan JSON Schema, inferred type, and validator
    citation.ts               → Citation JSON Schema, inferred type, and validator
  config/datasets.ts          → Corpus paths, content fields, and identifiers
src/utils/data-utils.test.ts  → Generic reader and slogan regression tests
```

Rename the current `data/` directory to `datasets/`. Update its README, agent instructions, the root README, and `.gitignore` to use the new path.

Schema property keys define canonical field labels. Property titles provide fallback labels for existing corpus text. Dataset configuration identifies the content field, identifier field, and corpus path. T0001 may add indexing settings when it implements Qdrant ingestion.

## Code Style

Use TypeScript, tabs, arrow functions, and JSDoc for every function. Add a blank line before control statements and `return` statements. Use the project Biome configuration.

```ts
import { schema } from "tjs"
import type { DescribedRecordSchema } from "./schema"

export const sloganJsonSchema = {
	description: "A slogan record. Use the slogan as content and metadata fields as filters.",
	type: "object",
	properties: {
		id: { title: "Id", type: "string", description: "Record identifier: The source ID for this record." },
		annee: { title: "Année", type: "integer", description: "Filter field: Use for year filters. Do not index as content." },
		slogan: { title: "Slogan", type: "string", minLength: 1, description: "Content field: Use for semantic and lexical indexing." },
	},
	required: ["id", "annee", "slogan"],
} as const satisfies DescribedRecordSchema

export const sloganValidator = schema(sloganJsonSchema, { coerce: { integer: true } })

export type Slogan = typeof sloganValidator.type

/** Validate a value against the slogan JSON Schema. */
export const validateSlogan = (value: unknown) => sloganValidator.validate(value)
```

Each model exports its JSON Schema definition, inferred record type, and validator function. Dataset configuration holds corpus paths and selected fields. Schema property keys and titles define text labels. Do not hard-code record fields in the generic reader.
The model type requires a description on the root schema and on every property. Tests also check that each description is non-empty and states a field role.

## Testing Strategy

- Run tests with `bun test`.
- Keep tests next to the source as `*.test.ts`.
- Test field extraction by property key and title fallback, required and optional fields, numeric coercion, invalid-record rejection, and rejection counts.
- Test that rejection events include the block number and a useful reason for malformed lines, unknown labels, and schema validation failures.
- Test that property keys take priority over colliding titles and that the reader accepts lines in any order.
- Test that in-memory and streaming readers return equivalent typed records.
- Test citations with a small fixture that matches `datasets/citations.txt`. Keep tests independent of local corpus files because Git ignores them.
- Retain regression coverage for slogan records, including the existing empty `campagne` behavior.
- Test that each model has a non-empty root description and a non-empty role description for every property.
- Check that T0001's updated specification and plan use the generic readers and dataset configuration. Keep Qdrant implementation and indexing tests in T0001.

## Boundaries

- **Always:** Keep record structure in exported JSON Schema definitions under `src/models/`. Treat property keys as canonical field names and titles as fallback labels. Require a non-empty role description on every schema property. Keep file settings in dataset configuration. Match property keys before titles. Include the block number and rejection reason in every rejected event. Keep corpus files untracked. Update T0001's spec and plan to log each rejection with the corpus path, block number, and reason.
- **Ask first:** Add input formats beyond the current text-block format. Change retrieval behavior, query APIs, or the user interface in T0002. Add dependencies beyond the requested `tjs` package.
- **Never:** Treat an invalid record as valid. Commit dataset files, credentials, or other secrets. Add dataset-specific field parsing to the generic reader. Implement Qdrant indexing in T0002.

## Success Criteria

- The generic in-memory reader returns records whose TypeScript types come from the JSON Schema definitions exported by `src/models/`.
- The generic streaming reader returns the same valid records as the in-memory reader and keeps only one record block in memory.
- The slogan schema and declaration preserve the current parser behavior, including the `campagne` empty-string value when that field is absent.
- The citation schema and declaration parse `id`, `author`, `work`, `year`, `lang`, `trad`, and `quote` from a fixture that matches `datasets/citations.txt`. The `year` field is a number, and blank `trad` values remain valid.
- Both model schemas have a non-empty root description and a non-empty description for every property. Each property description identifies its content, filter, or record-identifier role.
- Property keys match canonical field names, and titles provide fallback labels for both corpus formats.
- The reader tries property keys before titles and accepts text blocks whose lines appear in a different order.
- Each rejected event includes its block number and a reason that identifies the malformed line, unknown label, or validation error.
- T0001's import task logs each rejected event and continues through the corpus.
- `datasets/README.md` documents the field roles for both datasets and explains how query agents use the descriptions.
- When `datasets/citations.txt` exists locally, a manual run can also parse that corpus. T0001 owns indexing. Unit tests do not require this ignored file.
- An invalid record does not stop import. The importer reports its rejected-record count.
- T0001's spec and plan use the T0002 model exports and generic reader as inputs to its planned indexing work.
- `bun test` and `bun run lint` pass.

## Open Questions

- None. This ticket does not add a separate TypeScript compiler dependency.

## Glossary

- **BM25**: A ranking method that scores records by their matching words.
- **Content field**: The text field that carries the record's meaning and enters semantic and lexical indexing.
- **Dataset configuration**: A configuration that links a dataset file and record model to its content field and identifier field.
- **Filter field**: A metadata field that narrows results without entering content indexing.
- **JSON Schema**: A JSON document that declares the fields, types, and validation rules for a record.
- **Lexical search**: Search that matches words instead of meaning.
- **Query agent**: An LLM that uses schema descriptions to choose content and filter fields for a search.
- **Record**: One item in a dataset, such as one slogan or citation.
- **Record identifier**: The source ID that lets the system identify a record.
- **Record model**: A module that exports a record's JSON Schema, inferred TypeScript type, and validation function.
- **Rejection reason**: A short message that describes why a dataset block failed to parse or validate.
- **Schema title**: The JSON Schema `title` field that stores a fallback source label when it differs from the property key.
- **Streaming reader**: A reader that processes one record block at a time instead of loading the full file into memory.
- **Type inference**: TypeScript's process of deriving a type from a value, such as a schema literal.
- **Validator**: A function that checks a record against its JSON Schema and returns the validation result.
