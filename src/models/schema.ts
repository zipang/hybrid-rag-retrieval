import type { JsonSchemaBase } from "tjs"

/** Supported role labels for a record field description. */
export type FieldDescription =
	| `Content field: ${string}`
	| `Filter field: ${string}`
	| `Record identifier: ${string}`

/** JSON Schema contract with a title and role description for each field. */
export type DescribedRecordSchema = Omit<JsonSchemaBase, "type" | "properties"> & {
	type: "object"
	description: string
	properties: Record<string, JsonSchemaBase & { title: string; description: FieldDescription }>
}
