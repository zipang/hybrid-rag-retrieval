import { type Citation, citationJsonSchema, citationValidator } from "../models/citation"
import { type Slogan, sloganJsonSchema, sloganValidator } from "../models/slogan"
import type { DatasetReader } from "../utils/data-utils"

/** Keys whose values are required strings in a record model. */
type RequiredStringKey<T> = {
	[K in keyof T]-?: T[K] extends string ? K : never
}[keyof T] &
	string

/** Dataset settings that connect a record model to its corpus fields. */
export type DatasetConfiguration<T extends object> = DatasetReader<T> & {
	/** Local path to the UTF-8 corpus file. */
	filePath: string
	/** Record property that supplies searchable text. */
	contentField: RequiredStringKey<T>
	/** Record property that identifies the source record. */
	identifierField: RequiredStringKey<T>
}

/** Typed reader settings for each supported corpus. */
export const datasetConfigurations = {
	slogans: {
		filePath: "datasets/slogans.txt",
		schema: sloganJsonSchema,
		validator: sloganValidator,
		defaults: { campagne: "" },
		contentField: "slogan",
		identifierField: "id",
	} satisfies DatasetConfiguration<Slogan>,
	citations: {
		filePath: "datasets/citations.txt",
		schema: citationJsonSchema,
		validator: citationValidator,
		contentField: "quote",
		identifierField: "id",
	} satisfies DatasetConfiguration<Citation>,
}

/** Names of the configured datasets. */
export type DatasetName = keyof typeof datasetConfigurations
