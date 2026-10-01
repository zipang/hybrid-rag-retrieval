import { schema } from "tjs"
import type { DescribedRecordSchema } from "./schema"

/** JSON Schema for one slogan record. */
export const sloganJsonSchema = {
	description:
		"An advertising slogan record. Use the slogan as indexed content. Use the other fields as filters or as the record identifier.",
	type: "object",
	properties: {
		id: {
			title: "Id",
			type: "string",
			minLength: 1,
			description:
				"Record identifier: Unique source ID. Keep it in record metadata. Do not embed it or use it as a user filter.",
		},
		annee: {
			title: "Année",
			type: "integer",
			description:
				"Filter field: Publication year. Use it for year filters. Exclude it from semantic and lexical content indexing.",
		},
		marque: {
			title: "Marque",
			type: "string",
			minLength: 1,
			description:
				"Filter field: Brand or issuing organization. Use it for exact-match filters. Exclude it from content indexing.",
		},
		campagne: {
			title: "Campagne",
			type: "string",
			description:
				"Filter field: Campaign name. Use non-empty values for exact-match filters. Exclude it from content indexing. The reader defaults a missing value to an empty string.",
		},
		slogan: {
			title: "Slogan",
			type: "string",
			minLength: 1,
			description:
				"Content field: Advertising text. Use it for dense semantic embeddings and BM25 lexical indexing. Do not use it as a metadata filter.",
		},
	},
	required: ["id", "annee", "marque", "slogan"],
	additionalProperties: false,
} as const satisfies DescribedRecordSchema

/** TJS validator for slogan records. */
export const sloganValidator = schema(sloganJsonSchema, { coerce: { integer: true } })

/** Type inferred from the slogan JSON Schema. */
export type Slogan = typeof sloganValidator.type

/** Validate and coerce a value against the slogan JSON Schema. */
export const validateSlogan = (value: unknown) => sloganValidator.validate(value)
