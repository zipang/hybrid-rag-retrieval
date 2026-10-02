import { describe, expect, test } from "bun:test"
import {
	type CollectionSchema,
	InvalidSchemaError,
	validateSchema,
	vectorConfig,
} from "./qdrant-schema"

/** A valid schema that carries no dataset-specific constant. */
const schema: CollectionSchema = {
	collection: "records",
	dense: { name: "dense", size: 1024, distance: "Cosine" },
	sparse: { name: "bm25", modifier: "idf" },
	payloadIndexes: [
		{ name: "year", schema: "integer" },
		{ name: "brand", schema: "keyword" },
	],
}

describe("validateSchema", () => {
	test("accepts a complete schema and returns it unchanged", () => {
		expect(validateSchema(schema)).toBe(schema)
	})

	test("rejects a blank collection name", () => {
		expect(() => validateSchema({ ...schema, collection: "  " })).toThrow(InvalidSchemaError)
	})

	test("rejects a blank dense vector name", () => {
		expect(() => validateSchema({ ...schema, dense: { ...schema.dense, name: "" } })).toThrow(
			InvalidSchemaError,
		)
	})

	test("rejects a non-positive dense size", () => {
		expect(() => validateSchema({ ...schema, dense: { ...schema.dense, size: 0 } })).toThrow(
			InvalidSchemaError,
		)
		expect(() => validateSchema({ ...schema, dense: { ...schema.dense, size: 1.5 } })).toThrow(
			InvalidSchemaError,
		)
	})

	test("rejects a blank sparse vector name", () => {
		expect(() => validateSchema({ ...schema, sparse: { ...schema.sparse, name: "" } })).toThrow(
			InvalidSchemaError,
		)
	})

	test("rejects the same name for the dense and sparse vectors", () => {
		expect(() => validateSchema({ ...schema, sparse: { name: "dense" } })).toThrow(
			InvalidSchemaError,
		)
	})

	test("rejects a blank payload index field name", () => {
		expect(() =>
			validateSchema({ ...schema, payloadIndexes: [{ name: "", schema: "integer" }] }),
		).toThrow(InvalidSchemaError)
	})

	test("reports the failing field name", () => {
		try {
			validateSchema({ ...schema, collection: "" })
		} catch (error) {
			expect(error).toBeInstanceOf(InvalidSchemaError)
			expect((error as InvalidSchemaError).field).toBe("collection")
		}
	})
})

describe("vectorConfig", () => {
	test("builds the vectors and sparse vectors body from the schema", () => {
		expect(vectorConfig(schema)).toEqual({
			vectors: { dense: { size: 1024, distance: "Cosine" } },
			sparse_vectors: { bm25: { modifier: "idf" } },
		})
	})

	test("uses the schema vector names, not fixed names", () => {
		const custom: CollectionSchema = {
			collection: "poems",
			dense: { name: "embedding", size: 768, distance: "Dot" },
			sparse: { name: "terms" },
		}

		expect(vectorConfig(custom)).toEqual({
			vectors: { embedding: { size: 768, distance: "Dot" } },
			sparse_vectors: { terms: {} },
		})
	})

	test("omits the modifier when the schema does not set one", () => {
		const custom: CollectionSchema = {
			collection: "poems",
			dense: { name: "embedding", size: 768, distance: "Dot" },
			sparse: { name: "terms", modifier: "none" },
		}

		expect(vectorConfig(custom).sparse_vectors.terms).toEqual({ modifier: "none" })
	})
})
