import { describe, expect, test } from "bun:test";
import {
	type CollectionSchema,
	InvalidSchemaError,
	type MultiVectorSchema,
	multiVectorConfig,
	validateSchema,
	vectorConfig
} from "./qdrant-schema";

/** A valid schema that carries no dataset-specific constant. */
const schema: CollectionSchema = {
	collection: "records",
	dense: { name: "dense", size: 1024, distance: "Cosine" },
	sparse: { name: "bm25", modifier: "idf" },
	payloadIndexes: [
		{ name: "year", schema: "integer" },
		{ name: "brand", schema: "keyword" }
	]
};

describe("validateSchema", () => {
	test("accepts a complete schema and returns it unchanged", () => {
		expect(validateSchema(schema)).toBe(schema);
	});

	test("rejects a blank collection name", () => {
		expect(() => validateSchema({ ...schema, collection: "  " })).toThrow(InvalidSchemaError);
	});

	test("rejects a blank dense vector name", () => {
		expect(() => validateSchema({ ...schema, dense: { ...schema.dense, name: "" } })).toThrow(
			InvalidSchemaError
		);
	});

	test("rejects a non-positive dense size", () => {
		expect(() => validateSchema({ ...schema, dense: { ...schema.dense, size: 0 } })).toThrow(
			InvalidSchemaError
		);
		expect(() => validateSchema({ ...schema, dense: { ...schema.dense, size: 1.5 } })).toThrow(
			InvalidSchemaError
		);
	});

	test("rejects a blank sparse vector name", () => {
		expect(() =>
			validateSchema({
				...schema,
				sparse: { ...schema.sparse, name: "" }
			})
		).toThrow(InvalidSchemaError);
	});

	test("rejects the same name for the dense and sparse vectors", () => {
		expect(() => validateSchema({ ...schema, sparse: { name: "dense" } })).toThrow(
			InvalidSchemaError
		);
	});

	test("rejects a blank payload index field name", () => {
		expect(() =>
			validateSchema({
				...schema,
				payloadIndexes: [{ name: "", schema: "integer" }]
			})
		).toThrow(InvalidSchemaError);
	});

	test("reports the failing field name", () => {
		try {
			validateSchema({ ...schema, collection: "" });
		} catch (error) {
			expect(error).toBeInstanceOf(InvalidSchemaError);
			expect((error as InvalidSchemaError).field).toBe("collection");
		}
	});
});

describe("vectorConfig", () => {
	test("builds the vectors and sparse vectors body from the schema", () => {
		expect(vectorConfig(schema)).toEqual({
			vectors: { dense: { size: 1024, distance: "Cosine" } },
			sparse_vectors: { bm25: { modifier: "idf" } }
		});
	});

	test("uses the schema vector names, not fixed names", () => {
		const custom: CollectionSchema = {
			collection: "poems",
			dense: { name: "embedding", size: 768, distance: "Dot" },
			sparse: { name: "terms" }
		};

		expect(vectorConfig(custom)).toEqual({
			vectors: { embedding: { size: 768, distance: "Dot" } },
			sparse_vectors: { terms: {} }
		});
	});

	test("omits the modifier when the schema does not set one", () => {
		const custom: CollectionSchema = {
			collection: "poems",
			dense: { name: "embedding", size: 768, distance: "Dot" },
			sparse: { name: "terms", modifier: "none" }
		};

		expect(vectorConfig(custom).sparse_vectors.terms).toEqual({
			modifier: "none"
		});
	});

	test("keeps the dense and sparse entries unchanged when ast is absent", () => {
		expect(vectorConfig(schema).vectors).not.toHaveProperty("ast");
	});

	test("emits the ast multivector with the max_sim comparator", () => {
		const withAst: CollectionSchema = {
			...schema,
			ast: { name: "ast", size: 256, distance: "Cosine", comparator: "max_sim" }
		};

		expect(vectorConfig(withAst)).toEqual({
			vectors: {
				dense: { size: 1024, distance: "Cosine" },
				ast: {
					size: 256,
					distance: "Cosine",
					multivector_config: { comparator: "max_sim" }
				}
			},
			sparse_vectors: { bm25: { modifier: "idf" } }
		});
	});

	test("emits multivector_config only when the schema has an ast vector", () => {
		expect(vectorConfig(schema).vectors.dense).not.toHaveProperty("multivector_config");
	});
});

describe("multiVectorConfig", () => {
	test("returns the Qdrant vector description of the ast vector", () => {
		const ast: MultiVectorSchema = {
			name: "ast",
			size: 256,
			distance: "Cosine",
			comparator: "max_sim"
		};

		expect(multiVectorConfig(ast)).toEqual({
			size: 256,
			distance: "Cosine",
			multivector_config: { comparator: "max_sim" }
		});
	});
});

describe("validateSchema ast multivector", () => {
	const withAst = (ast: CollectionSchema["ast"]): CollectionSchema => ({
		...schema,
		ast
	});

	test("accepts a valid ast multivector", () => {
		const candidate = withAst({
			name: "ast",
			size: 256,
			distance: "Cosine",
			comparator: "max_sim"
		});

		expect(validateSchema(candidate)).toBe(candidate);
	});

	test("rejects a blank ast name", () => {
		expect(() =>
			validateSchema(
				withAst({ name: "  ", size: 256, distance: "Cosine", comparator: "max_sim" })
			)
		).toThrow(InvalidSchemaError);
	});

	test("rejects a non-positive ast size", () => {
		expect(() =>
			validateSchema(
				withAst({ name: "ast", size: 0, distance: "Cosine", comparator: "max_sim" })
			)
		).toThrow(InvalidSchemaError);
		expect(() =>
			validateSchema(
				withAst({ name: "ast", size: 2.5, distance: "Cosine", comparator: "max_sim" })
			)
		).toThrow(InvalidSchemaError);
	});

	test("rejects a comparator other than max_sim", () => {
		expect(() =>
			validateSchema(
				withAst({
					name: "ast",
					size: 256,
					distance: "Cosine",
					// A future comparator must be a deliberate code change.
					comparator: "min_sim" as unknown as "max_sim"
				})
			)
		).toThrow(InvalidSchemaError);
	});

	test("rejects an ast name that clashes with the dense vector", () => {
		expect(() =>
			validateSchema(
				withAst({ name: "dense", size: 256, distance: "Cosine", comparator: "max_sim" })
			)
		).toThrow(InvalidSchemaError);
	});

	test("rejects an ast name that clashes with the sparse vector", () => {
		expect(() =>
			validateSchema(
				withAst({ name: "bm25", size: 256, distance: "Cosine", comparator: "max_sim" })
			)
		).toThrow(InvalidSchemaError);
	});

	test("reports the failing ast field name", () => {
		try {
			validateSchema(
				withAst({ name: "", size: 256, distance: "Cosine", comparator: "max_sim" })
			);
		} catch (error) {
			expect(error).toBeInstanceOf(InvalidSchemaError);
			expect((error as InvalidSchemaError).field).toBe("ast.name");
		}
	});
});
