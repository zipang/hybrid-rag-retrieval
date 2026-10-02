import type { CollectionSchema, PayloadIndexField } from "../lib/qdrant-schema"
import { type Citation, citationJsonSchema, citationValidator } from "../models/citation"
import { type Slogan, sloganJsonSchema, sloganValidator } from "../models/slogan"
import type { DatasetReader } from "../utils/data-utils"

/** Keys whose values are required strings in a record model. */
type RequiredStringKey<T> = {
	[K in keyof T]-?: T[K] extends string ? K : never
}[keyof T] &
	string

/** Keys whose values are a string or a number in a record model. */
type RequiredIdentifierKey<T> = {
	[K in keyof T]-?: T[K] extends string | number ? K : never
}[keyof T] &
	string

/** Dataset settings that connect a record model to its corpus fields. */
export type DatasetConfiguration<T extends object> = DatasetReader<T> & {
	/** Local path to the UTF-8 corpus file. */
	filePath: string
	/** Record property that supplies searchable text. */
	contentField: RequiredStringKey<T>
	/** Record property that identifies the source record. */
	identifierField: RequiredIdentifierKey<T>
	/** Qdrant collection description for this dataset. */
	collectionSchema: CollectionSchema
	/** Default dense vector size for this dataset. */
	embeddingSize: number
}

/** Payload index fields for the slogan collection. */
const sloganIndexes: PayloadIndexField[] = [
	{ name: "annee", schema: "integer" },
	{ name: "marque", schema: "keyword" },
]

/** Payload index fields for the citation collection. */
const citationIndexes: PayloadIndexField[] = [
	{ name: "author", schema: "keyword" },
	{ name: "work", schema: "keyword" },
	{ name: "year", schema: "integer" },
	{ name: "lang", schema: "keyword" },
]

/** Typed reader settings for each supported corpus. */
export const datasetConfigurations = {
	slogans: {
		filePath: "datasets/slogans.txt",
		schema: sloganJsonSchema,
		validator: sloganValidator,
		defaults: { campagne: "" },
		contentField: "slogan",
		identifierField: "id",
		embeddingSize: 1024,
		collectionSchema: {
			collection: "slogans",
			dense: { name: "dense", size: 1024, distance: "Cosine" },
			sparse: { name: "bm25", modifier: "idf" },
			payloadIndexes: sloganIndexes,
		},
	} satisfies DatasetConfiguration<Slogan>,
	citations: {
		filePath: "datasets/citations.txt",
		schema: citationJsonSchema,
		validator: citationValidator,
		defaults: {},
		contentField: "quote",
		identifierField: "id",
		embeddingSize: 1024,
		collectionSchema: {
			collection: "citations",
			dense: { name: "dense", size: 1024, distance: "Cosine" },
			sparse: { name: "bm25", modifier: "idf" },
			payloadIndexes: citationIndexes,
		},
	} satisfies DatasetConfiguration<Citation>,
}

/** Names of the configured datasets. */
export type DatasetName = keyof typeof datasetConfigurations
