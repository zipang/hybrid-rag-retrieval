import { schema } from "tjs"
import type { DescribedRecordSchema } from "./schema"

/** JSON Schema for one citation record. */
export const citationJsonSchema = {
	description:
		"A citation record. Use the quote as indexed content. Use the other fields as filters or as the record identifier.",
	type: "object",
	properties: {
		id: {
			title: "id",
			type: "string",
			minLength: 1,
			description:
				"Record identifier: Unique source ID. Keep it in record metadata. Do not embed it or use it as a user filter.",
		},
		author: {
			title: "author",
			type: "string",
			minLength: 1,
			description:
				"Filter field: Author of the quoted source. Use it for exact-match filters. Exclude it from content indexing.",
		},
		work: {
			title: "work",
			type: "string",
			minLength: 1,
			description:
				"Filter field: Title of the work that contains the citation. Use it for exact-match filters. Exclude it from content indexing.",
		},
		year: {
			title: "year",
			type: "integer",
			description:
				"Filter field: Publication year of the cited work. Use it for year filters. Exclude it from content indexing.",
		},
		lang: {
			title: "lang",
			type: "string",
			minLength: 1,
			description:
				"Filter field: Language code of the citation text. Use it for exact-match filters. Exclude it from content indexing.",
		},
		trad: {
			title: "trad",
			type: "string",
			description:
				"Filter field: Translator credit. Use a non-empty value for exact-match filters. Exclude it from content indexing.",
		},
		quote: {
			title: "quote",
			type: "string",
			minLength: 1,
			description:
				"Content field: Citation text. Use it for dense semantic embeddings and BM25 lexical indexing. Do not use it as a metadata filter.",
		},
	},
	required: ["id", "author", "work", "year", "lang", "quote"],
	additionalProperties: false,
} as const satisfies DescribedRecordSchema

/** TJS validator for citation records. */
export const citationValidator = schema(citationJsonSchema, { coerce: { integer: true } })

/** Type inferred from the citation JSON Schema. */
export type Citation = typeof citationValidator.type

/** Validate and coerce a value against the citation JSON Schema. */
export const validateCitation = (value: unknown) => citationValidator.validate(value)
