/**
 * Collection schema contract for the Qdrant transport.
 *
 * The transport must work for any collection. It must not know the field names of one dataset. A
 * caller describes a collection with one `CollectionSchema` and passes it to the transport. The
 * transport then creates the collection, its vectors, and its payload indexes from that
 * description.
 *
 * The schema carries no dataset-specific constant. The dataset configuration in
 * `src/config/datasets.ts` builds a schema for each dataset and supplies it at the call site.
 */

/** Distance function of a dense vector. */
export type DenseDistance = "Cosine" | "Euclid" | "Dot" | "Manhattan";

/** Qdrant payload index schema kinds that this transport supports. */
export type PayloadIndexSchema = "integer" | "keyword" | "float" | "bool" | "datetime";

/** One dense named vector. */
export type DenseVectorSchema = {
	/** Vector name, for example `dense`. */
	name: string;
	/** Number of dimensions. */
	size: number;
	/** Distance function. */
	distance: DenseDistance;
};

/** One named dense multivector, scored with one comparator. */
export type MultiVectorSchema = {
	/** Vector name, for example `ast`. */
	name: string;
	/** Number of dimensions of each row. */
	size: number;
	/** Distance function. */
	distance: DenseDistance;
	/** Qdrant multivector comparator. Only `max_sim` is supported. */
	comparator: "max_sim";
};

/** One sparse named vector. */
export type SparseVectorSchema = {
	/** Vector name, for example `bm25`. */
	name: string;
	/** Optional Qdrant modifier, for example `idf`. */
	modifier?: "idf" | "none";
};

/** One payload index field. */
export type PayloadIndexField = {
	/** Payload field name. */
	name: string;
	/** Index schema kind. */
	schema: PayloadIndexSchema;
};

/** Complete description of one Qdrant collection. */
export type CollectionSchema = {
	/** Collection name. */
	collection: string;
	/** Dense named vector. */
	dense: DenseVectorSchema;
	/** Sparse named vector. */
	sparse: SparseVectorSchema;
	/**
	 * Optional abstract-tree multivector, scored with the `max_sim` comparator.
	 *
	 * This is the Qdrant vector that backs the public `syntax` index. The two names differ on
	 * purpose: `syntax` names the search kind that the API exposes, and `ast` names the storage key
	 * that holds the encoded abstract tree.
	 */
	ast?: MultiVectorSchema;
	/** Payload fields to index. */
	payloadIndexes?: PayloadIndexField[];
};

/** Error raised when a schema is missing a required value. */
export class InvalidSchemaError extends Error {
	/** The field that failed validation. */
	readonly field: string;

	/** Create the error for one schema field. */
	constructor(field: string, reason: string) {
		super(`invalid collection schema: ${field} ${reason}`);
		this.name = "InvalidSchemaError";
		this.field = field;
	}
}

/** Read a nonblank string field, or raise an {@link InvalidSchemaError}. */
const requireName = (value: unknown, field: string): string => {
	if (typeof value !== "string" || value.trim() === "") {
		throw new InvalidSchemaError(field, "must be a nonblank string");
	}

	return value;
};

/** Read a positive integer field, or raise an {@link InvalidSchemaError}. */
const requirePositiveInteger = (value: unknown, field: string): number => {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
		throw new InvalidSchemaError(field, "must be a positive safe integer");
	}

	return value;
};

/**
 * Validate a collection schema.
 *
 * The function checks the collection name, the dense vector name and size, the sparse vector name,
 * and every payload index field. It returns the schema unchanged so a caller can chain it, or
 * raises {@link InvalidSchemaError}.
 */
export const validateSchema = (schema: CollectionSchema): CollectionSchema => {
	requireName(schema.collection, "collection");
	requireName(schema.dense.name, "dense.name");
	requirePositiveInteger(schema.dense.size, "dense.size");
	requireName(schema.sparse.name, "sparse.name");

	if (schema.dense.name === schema.sparse.name) {
		throw new InvalidSchemaError("sparse.name", "must differ from dense.name");
	}

	if (schema.ast !== undefined) {
		requireName(schema.ast.name, "ast.name");
		requirePositiveInteger(schema.ast.size, "ast.size");
		requireName(schema.ast.comparator, "ast.comparator");

		if (schema.ast.comparator !== "max_sim") {
			throw new InvalidSchemaError("ast.comparator", "must be max_sim");
		}

		if (schema.ast.name === schema.dense.name) {
			throw new InvalidSchemaError("ast.name", "must differ from dense.name");
		}

		if (schema.ast.name === schema.sparse.name) {
			throw new InvalidSchemaError("ast.name", "must differ from sparse.name");
		}
	}

	for (const [index, field] of (schema.payloadIndexes ?? []).entries()) {
		requireName(field.name, `payloadIndexes[${index}].name`);
	}

	return schema;
};

/** Qdrant vector description, for a plain dense vector or a multivector. */
export type VectorDescription = {
	/** Dimensions. */
	size: number;
	/** Distance function. */
	distance: DenseDistance;
	/** Optional multivector configuration. */
	multivector_config?: MultiVectorConfig;
};

/** Qdrant multivector configuration. */
export type MultiVectorConfig = {
	/** Comparator used to score two matrices. */
	comparator: "max_sim";
};

/**
 * Build the Qdrant vector description of one abstract-tree multivector.
 *
 * This helper is the single writer of the `multivector_config` shape. Both collection creation and
 * the later vector-schema update read it, so the two call sites cannot drift.
 *
 * @param ast Abstract-tree multivector declared by a schema.
 * @returns The Qdrant vector description of that multivector.
 */
export const multiVectorConfig = (ast: MultiVectorSchema): VectorDescription => ({
	size: ast.size,
	distance: ast.distance,
	multivector_config: { comparator: ast.comparator }
});

/** Qdrant sparse vector description. */
export type SparseVectorConfig = {
	/** Optional modifier. */
	modifier?: "idf" | "none";
};

/** Build the Qdrant `vectors` and `sparse_vectors` body from a schema. */
export const vectorConfig = (
	schema: CollectionSchema
): {
	vectors: Record<string, VectorDescription>;
	sparse_vectors: Record<string, SparseVectorConfig>;
} => {
	const vectors: Record<string, VectorDescription> = {
		[schema.dense.name]: {
			size: schema.dense.size,
			distance: schema.dense.distance
		}
	};

	if (schema.ast !== undefined) {
		vectors[schema.ast.name] = multiVectorConfig(schema.ast);
	}

	return {
		vectors,
		sparse_vectors: {
			[schema.sparse.name]:
				schema.sparse.modifier === undefined ? {} : { modifier: schema.sparse.modifier }
		}
	};
};
