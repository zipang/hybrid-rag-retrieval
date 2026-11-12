import type { CollectionSchema, MultiVectorSchema } from "./qdrant-schema";
import {
	InvalidSchemaError,
	multiVectorConfig,
	validateSchema,
	vectorConfig
} from "./qdrant-schema";

/** Environment variables that configure the Qdrant connection. */
export type QdrantEnv = {
	/** Base URL of the Qdrant HTTP API. Defaults to the local instance. */
	QDRANT_URL?: string;
	/** Extra environment values, so `process.env` is assignable. */
	[key: string]: string | undefined;
};

/** Qdrant BM25 inference object stored in the sparse vector. */
export type Bm25Inference = {
	/** Text to tokenize and score on the server. */
	text: string;
	/** Qdrant inference model identifier. */
	model: "qdrant/bm25";
	/** Text-processing options shared with query time. */
	options?: Record<string, unknown>;
};

/** Named vectors attached to one point. */
export type PointVectors = {
	/** Client-side dense embedding. */
	dense: number[];
	/** Server-side BM25 inference input. */
	bm25: Bm25Inference;
};

/**
 * One point to upsert into the collection.
 *
 * An upsert writes the dense and BM25 vectors only. The ast multivector is stored after the point
 * exists, through {@link QdrantClient.updateAstVectors}, so a syntax rebuild never rewrites the
 * other vectors or the payload.
 */
export type Point = {
	/** Unsigned integer point id. */
	id: number;
	/** Dense and sparse vectors for the point. */
	vector: PointVectors;
	/** Record fields stored next to the vectors. */
	payload: Record<string, unknown>;
};

/** One scored point returned by the Query API. */
export type QueryHit = {
	/** Point id. */
	id: number | string;
	/** Relevance score returned by the query. */
	score: number;
	/** Record fields stored with the point. Present when the query asks for the payload. */
	payload: Record<string, unknown>;
};

/** One scored point with the stored vectors that a query asked for. */
type QueryHitWithVector = QueryHit & {
	/** Stored vectors, keyed by vector name, when the query asked for them. */
	vector?: Record<string, unknown>;
};

/** A single payload condition. */
export type FilterCondition =
	| { key: string; range: { gte?: number; lte?: number } }
	| { key: string; match: { value: string | number | boolean } }
	| { has_id: Array<number | string> };

/** Payload filter applied to a hybrid query. */
export type PayloadFilter = {
	/** Conditions the point must satisfy. */
	must?: FilterCondition[];
};

/** One raw score for one identifier and one index. */
export type IndexScore = {
	/** Record identifier. */
	id: number | string;
	/** Raw score from Qdrant, exactly as returned. */
	score: number;
	/**
	 * Number of rows of the stored vector, when the query asked for it.
	 *
	 * Only the ast query sets this. It is the row count of the returned matrix, which is the
	 * sentence count of the record.
	 */
	rows?: number;
};

/** Result of an exact score query for one identifier batch. */
export type ExactScoreResult = {
	/** Scores returned by Qdrant, in the Qdrant order. */
	scores: IndexScore[];
	/** Identifiers that Qdrant did not return for this index. */
	missing: Array<number | string>;
};

/** One page of identifiers from a scroll operation. */
export type IdentifierPage = {
	/** Identifiers on this page. */
	ids: Array<number | string>;
	/** Offset for the next page, or `undefined` on the last page. */
	nextOffset?: number | string;
};

/** How a dense query treats an identifier with no dense vector. */
export type DenseMissingPolicy = "throw" | "skip";

/** Parameters of an exact dense score query. */
export type ExactDenseQuery = {
	/** Dense query vector. */
	vector: number[];
	/**
	 * Identifiers to score. The query returns only these.
	 *
	 * The identifiers must already satisfy `filter`. The transport reports every identifier that
	 * Qdrant does not return as `missing`, so an identifier that `filter` removes looks like a
	 * record without a dense vector.
	 */
	ids: Array<number | string>;
	/** Payload filter applied on top of the identifier set. */
	filter?: PayloadFilter;
	/** What to do when an identifier has no dense vector. Defaults to `throw`. */
	onMissing?: DenseMissingPolicy;
};

/** Parameters of an exact sparse score query. */
export type ExactSparseQuery = {
	/** Raw query text scored by Qdrant BM25. */
	text: string;
	/** BM25 options; must match ingestion. */
	bm25Options?: Record<string, unknown>;
	/** Identifiers to score. The query returns only these. */
	ids: Array<number | string>;
	/** Payload filter applied on top of the identifier set. */
	filter?: PayloadFilter;
};

/**
 * Parameters of an exact ast score query.
 *
 * `rows` is the query matrix. Each row is one sentence of the query text, encoded with the same
 * frozen encoder configuration as the stored records.
 */
export type ExactAstQuery = {
	/** Query matrix, one row per sentence. */
	rows: number[][];
	/**
	 * Identifiers to score. The query returns only these.
	 *
	 * The identifiers must already satisfy `filter`. The transport reports every identifier that
	 * Qdrant does not return as `missing`, so an identifier that `filter` removes looks like a
	 * record without an ast vector.
	 */
	ids: Array<number | string>;
	/** Payload filter applied on top of the identifier set. */
	filter?: PayloadFilter;
	/** What to do when an identifier has no ast vector. Defaults to `throw`. */
	onMissing?: DenseMissingPolicy;
	/**
	 * Ask Qdrant for the stored ast matrix, so the transport can report its row count.
	 *
	 * The stored `ast` value is a multivector, so its row count is the sentence count of the
	 * record. The transport reads that count from the returned matrix and never stores it.
	 */
	withRows?: boolean;
};

/**
 * Parameters of one bounded query on one named vector.
 *
 * This is the bounded counterpart of the exact score queries. The query asks Qdrant for at most
 * `limit` hits, so the work is bounded by the requested candidate count and never by the collection
 * size.
 */
export type VectorQuery = {
	/** Named vector to search, for example `dense`, `bm25`, or `ast`. */
	using: string;
	/** Query value: a dense vector, a BM25 inference object, or multivector rows. */
	query: unknown;
	/** Maximum number of hits. Required. */
	limit: number;
	/** Payload filter, applied before the search. */
	filter?: PayloadFilter;
};

/** Parameters of a hybrid dense + BM25 query. */
export type HybridQuery = {
	/** Dense query vector computed client-side. */
	dense: number[];
	/** Raw query text scored by Qdrant BM25. */
	text: string;
	/** BM25 options; must match ingestion. */
	bm25Options?: Record<string, unknown>;
	/** Maximum number of fused results. */
	limit: number;
	/** Candidates per prefetch. Defaults to `limit`. */
	prefetchLimit?: number;
	/** Payload filter applied to both prefetches. */
	filter?: PayloadFilter;
};

/** Qdrant client bound to one collection. */
export type QdrantClient = {
	/** Configured base URL of the Qdrant API. */
	readonly url: string;
	/** Configured collection name. */
	readonly collection: string;
	/** Collection schema that this client was created from. */
	readonly schema: CollectionSchema;
	/** Create the collection and its payload indexes when absent. */
	ensureCollection: () => Promise<boolean>;
	/** Delete the collection when it exists. */
	deleteCollection: () => Promise<void>;
	/** Upsert points in a single request. */
	upsert: (points: Point[], options?: { wait?: boolean }) => Promise<void>;
	/** Run a dense + BM25 query fused with RRF. */
	queryHybrid: (query: HybridQuery) => Promise<QueryHit[]>;
	/** Run one bounded query on one named vector. */
	queryVector: (query: VectorQuery) => Promise<Array<Pick<QueryHit, "id" | "score">>>;
	/** Scroll the complete identifier set that matches a filter. */
	scrollIds: (options?: {
		filter?: PayloadFilter;
		pageSize?: number;
	}) => Promise<Array<number | string>>;
	/** Read the payloads for a list of identifiers. */
	fetchPayloads: (
		ids: Array<number | string>
	) => Promise<Map<number | string, Record<string, unknown>>>;
	/** Score one identifier batch with an exact dense search. */
	queryDenseExact: (query: ExactDenseQuery) => Promise<ExactScoreResult>;
	/** Score one identifier batch with a sparse BM25 search. */
	querySparseExact: (query: ExactSparseQuery) => Promise<ExactScoreResult>;
	/**
	 * Add the ast multivector definition to an existing collection.
	 *
	 * @returns `true` when the definition was added, `false` when a compatible definition already
	 *   existed.
	 */
	ensureAstVector: () => Promise<boolean>;
	/** Replace the ast vector value of existing points, and keep every other vector. */
	updateAstVectors: (
		points: Array<{ id: number | string; rows: number[][] }>,
		options?: { wait?: boolean }
	) => Promise<void>;
	/** Score one identifier batch with an exact ast multivector search. */
	queryAstExact: (query: ExactAstQuery) => Promise<ExactScoreResult>;
	/**
	 * Delete one or more named vectors from existing points.
	 *
	 * Every other vector and the payload stay unchanged, and the point is never deleted. The vector
	 * names come from the caller, so the operation is not tied to the `ast` vector.
	 *
	 * @param ids Identifiers to clear. An empty list sends no request.
	 * @param vectors Vector names to delete, for example `["ast"]`.
	 * @param options `wait` defaults to `true`. `log` receives one message per point that Qdrant
	 *   reports as already absent.
	 */
	deleteVectors: (
		ids: Array<number | string>,
		vectors: string[],
		options?: { wait?: boolean; log?: (message: string) => void }
	) => Promise<void>;
};

/**
 * Qdrant hard limit on the sub-vector count of one multivector.
 *
 * The documented rule is `number_of_sub_vectors * vector_size < 1,048,576`. The limit is not
 * configurable. The transport checks it before every request and never truncates rows.
 */
export const MULTIVECTOR_SUBVECTOR_LIMIT = 1_048_576;

/**
 * Maximum number of rows that one ast matrix may hold for a row size.
 *
 * @param size Dimensions of one row. Must be a positive safe integer.
 * @returns The largest row count that satisfies `rows * size < 1,048,576`.
 * @throws {RangeError} When `size` is not a positive safe integer.
 */
export const maxMultiVectorRows = (size: number): number => {
	if (!Number.isSafeInteger(size) || size <= 0) {
		throw new RangeError(`vector size must be a positive safe integer, got ${String(size)}`);
	}

	return Math.floor((MULTIVECTOR_SUBVECTOR_LIMIT - 1) / size);
};

/** Error raised when an expected vector is absent from a scored record. */
export class MissingVectorError extends Error {
	/** Vector name with the missing value. */
	readonly vector: string;
	/** Identifiers with no value for the vector. */
	readonly ids: Array<number | string>;

	/** Create the error with the vector name and the affected identifiers. */
	constructor(vector: string, ids: Array<number | string>) {
		super(`${ids.length} record(s) have no ${vector} vector: ${ids.join(", ")}`);
		this.name = "MissingVectorError";
		this.vector = vector;
		this.ids = ids;
	}
}

/**
 * Error raised when a stored ast vector definition does not match the schema.
 *
 * The transport compares the definition reported by Qdrant with `schema.ast`. A different size, a
 * missing multivector configuration, or a different comparator becomes this error instead of an
 * opaque failure on the first query.
 */
export class IncompatibleAstVectorError extends Error {
	/** Vector name with the incompatible definition. */
	readonly vector: string;
	/** Shape that the schema requires. */
	readonly expected: { size: number; comparator: string };
	/** Shape that the collection reports. */
	readonly found: { size?: number; comparator?: string };

	/** Create the error with the vector name and both shapes. */
	constructor(
		vector: string,
		expected: { size: number; comparator: string },
		found: { size?: number; comparator?: string }
	) {
		super(
			`the stored ${vector} vector is incompatible with the schema: expected size ` +
				`${expected.size} and comparator ${expected.comparator}, found size ` +
				`${String(found.size)} and comparator ${String(found.comparator)}`
		);
		this.name = "IncompatibleAstVectorError";
		this.vector = vector;
		this.expected = expected;
		this.found = found;
	}
}

/**
 * Error raised when an ast matrix value cannot be serialized.
 *
 * A non-finite value or an empty matrix is a data error of one record. The transport raises this
 * typed error so a backfill can record the record as failed instead of aborting the whole run.
 */
export class MultiVectorValueError extends Error {
	/** Record identifier, or `"query"` for a query matrix. */
	readonly id: number | string;
	/** Offending value, or `undefined` when the matrix carries no row at all. */
	readonly value: number | undefined;

	/** Create the error for one record and one offending value. */
	constructor(id: number | string, value: number | undefined, reason: string) {
		super(`invalid ast vector for ${id}: ${reason}`);
		this.name = "MultiVectorValueError";
		this.id = id;
		this.value = value;
	}
}

/** Default base URL of a locally started Qdrant instance. */
const DEFAULT_URL = "http://127.0.0.1:6333";

/**
 * Error raised when an ast matrix has more rows than Qdrant accepts.
 *
 * The transport raises this error before it sends a request. It never truncates the matrix, because
 * a truncated matrix would silently change the score.
 */
export class MultiVectorLimitError extends Error {
	/** Record identifier whose matrix is too large. */
	readonly id: number | string;
	/** Row count of the rejected matrix. */
	readonly rows: number;
	/** Dimensions of one row. */
	readonly size: number;
	/** Qdrant sub-vector element limit, `rows * size < limit`. */
	readonly limit: number;

	/** Create the error for one record and one matrix shape. */
	constructor(id: number | string, rows: number, size: number, limit: number) {
		super(
			`ast matrix for ${id} has ${rows} rows of ${size} dimensions, which exceeds the ` +
				`Qdrant limit of ${limit} sub-vector elements (rows * size < ${limit})`
		);
		this.name = "MultiVectorLimitError";
		this.id = id;
		this.rows = rows;
		this.size = size;
		this.limit = limit;
	}
}

/**
 * Serialize one vector value as JSON, always with a decimal point.
 *
 * Qdrant reads a JSON matrix whose rows are all integers as its legacy sparse-vector form
 * (`[[indices], [values]]`) and rejects it, with a message that depends on the row shape, such as
 * `indices: must be unique` or `Conversion between sparse and regular vectors failed`. A float
 * keeps the documented multivector shape unambiguous, and the numeric value does not change. The
 * encoder produces floats, so this guard costs nothing and removes the edge case.
 *
 * Only a safe integer gets the decimal suffix. A larger integer such as `1e21` is already written
 * in exponent form by `JSON.stringify`, and `1e+21.0` would not be valid JSON.
 */
const jsonVectorValue = (id: number | string, value: number): string => {
	if (!Number.isFinite(value)) {
		throw new MultiVectorValueError(id, value, "every value must be finite");
	}

	if (Number.isSafeInteger(value)) {
		return `${value}.0`;
	}

	return JSON.stringify(value);
};

/** Serialize one ast matrix as JSON with float values. */
const jsonMatrix = (id: number | string, rows: number[][]): string =>
	`[${rows.map((row) => `[${row.map((value) => jsonVectorValue(id, value)).join(",")}]`).join(",")}]`;

/** Serialize one `update vectors` entry, which carries the ast vector only. */
const jsonVectorUpdate = (id: number | string, name: string, rows: number[][]): string =>
	`{"id":${JSON.stringify(id)},"vector":{${JSON.stringify(name)}:${jsonMatrix(id, rows)}}}`;

/** Vector shape that Qdrant reports for one stored vector, as far as this transport reads it. */
export type StoredVectorDescription = {
	/** Dimensions, when the description reports one. */
	size?: number;
	/** Multivector configuration, when the description reports one. */
	multivector_config?: { comparator?: string };
};

/** Read a stored vector description from an unknown Qdrant value. */
const toStoredDescription = (entry: unknown): StoredVectorDescription => {
	if (typeof entry !== "object" || entry === null) {
		return {};
	}

	const description: StoredVectorDescription = {};
	const { size, multivector_config } = entry as {
		size?: unknown;
		multivector_config?: unknown;
	};

	if (typeof size === "number") {
		description.size = size;
	}

	if (typeof multivector_config === "object" && multivector_config !== null) {
		const { comparator } = multivector_config as { comparator?: unknown };

		description.multivector_config = {
			...(typeof comparator === "string" ? { comparator } : {})
		};
	}

	return description;
};

/**
 * Return whether an error reports a point that does not exist.
 *
 * A missing collection also answers 404, so the check reads the documented point message instead of
 * the status code.
 */
const isMissingPointError = (error: unknown): boolean =>
	error instanceof Error && /no point with id/i.test(error.message);

/** Read the message of an unknown error. */
const describeError = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

/** Read the error message from a Qdrant error body. */
const extractErrorMessage = (body: unknown): string => {
	if (typeof body !== "object" || body === null || !("status" in body)) {
		return "unknown error";
	}

	const { status } = body as { status: unknown };

	if (typeof status !== "object" || status === null || !("error" in status)) {
		return "unknown error";
	}

	const { error } = status as { error?: unknown };

	return typeof error === "string" ? error : "unknown error";
};

/**
 * Create a thin `fetch` client for one Qdrant collection.
 *
 * The client takes a {@link CollectionSchema}. The schema supplies the collection name, the vector
 * names, the vector layout, and the payload index fields. The client creates the collection from
 * that schema, then creates the payload indexes named by the schema. Qdrant recommends creating
 * payload indexes before ingesting data so the filterable HNSW graph can use them.
 *
 * The client carries no dataset-specific field name. A caller passes filters and field names per
 * call.
 */
export const createQdrantClient = (
	schema: CollectionSchema,
	env: QdrantEnv = {},
	fetchImpl: typeof fetch = fetch
): QdrantClient => {
	validateSchema(schema);

	const url = (env.QDRANT_URL ?? DEFAULT_URL).replace(/\/+$/, "");
	const collection = schema.collection;
	const base = `/collections/${encodeURIComponent(collection)}`;
	const denseName = schema.dense.name;
	const sparseName = schema.sparse.name;

	/** Read the schema ast vector, or raise when the schema has none. */
	const requireAstVector = (): MultiVectorSchema => {
		if (schema.ast === undefined) {
			throw new InvalidSchemaError("ast", "is required for the ast vector operations");
		}

		return schema.ast;
	};

	/** Reject an empty matrix or one that Qdrant cannot store, before any request is sent. */
	const assertRows = (id: number | string, rows: number[][], size: number): void => {
		if (rows.length === 0) {
			throw new MultiVectorValueError(id, undefined, "the matrix must have at least one row");
		}

		if (rows.length * size >= MULTIVECTOR_SUBVECTOR_LIMIT) {
			throw new MultiVectorLimitError(id, rows.length, size, MULTIVECTOR_SUBVECTOR_LIMIT);
		}
	};

	/** Send one request with an already serialized body, and unwrap the Qdrant envelope. */
	const send = async <T>(method: string, path: string, body?: string): Promise<T> => {
		const response = await fetchImpl(`${url}${path}`, {
			method,
			headers: { "content-type": "application/json" },
			body
		});
		const text = await response.text();
		const parsed: unknown = text.length === 0 ? {} : JSON.parse(text);

		if (!response.ok) {
			throw new Error(
				`Qdrant ${method} ${path} failed (${response.status}): ${extractErrorMessage(parsed)}`
			);
		}

		return (parsed as { result: T }).result;
	};

	/**
	 * Send one request with a JSON body, and unwrap the Qdrant `result` field.
	 *
	 * @param method HTTP method.
	 * @param path Path relative to the configured base URL.
	 * @param body Value to serialize as JSON, or `undefined` for no body.
	 */
	const request = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
		return send<T>(method, path, body === undefined ? undefined : JSON.stringify(body));
	};

	const collectionExists = async (): Promise<boolean> => {
		const result = await request<{ exists: boolean }>("GET", `${base}/exists`);

		return result.exists;
	};

	/**
	 * Read the vector descriptions of the collection, keyed by vector name.
	 *
	 * Qdrant reports `config.params.vectors` in one of three shapes: a single vector description
	 * for an unnamed vector, a map keyed by vector name, or a list of named descriptions. The
	 * helper accepts all three, so a schema change in a future version cannot break detection. An
	 * unnamed vector has no name, so it contributes no entry.
	 */
	const collectionVectors = async (): Promise<Map<string, StoredVectorDescription>> => {
		const result = await request<{ config?: { params?: { vectors?: unknown } } }>("GET", base);
		const vectors = result.config?.params?.vectors;
		const descriptions = new Map<string, StoredVectorDescription>();

		if (Array.isArray(vectors)) {
			for (const entry of vectors) {
				if (typeof entry !== "object" || entry === null || !("name" in entry)) {
					continue;
				}

				const { name } = entry as { name?: unknown };

				if (typeof name === "string") {
					descriptions.set(name, toStoredDescription(entry));
				}
			}

			return descriptions;
		}

		if (typeof vectors !== "object" || vectors === null) {
			return descriptions;
		}

		if ("size" in vectors) {
			return descriptions;
		}

		for (const [name, entry] of Object.entries(vectors)) {
			descriptions.set(name, toStoredDescription(entry));
		}

		return descriptions;
	};

	const ensureCollection = async (): Promise<boolean> => {
		if (await collectionExists()) {
			return false;
		}

		await request("PUT", base, vectorConfig(schema));

		for (const field of schema.payloadIndexes ?? []) {
			await request("PUT", `${base}/index`, {
				field_name: field.name,
				field_schema: field.schema
			});
		}

		return true;
	};

	const deleteCollection = async (): Promise<void> => {
		if (!(await collectionExists())) {
			return;
		}

		await request("DELETE", base);
	};

	const upsert = async (points: Point[], options: { wait?: boolean } = {}): Promise<void> => {
		const wait = options.wait ?? true;
		const mapped = points.map((point) => ({
			id: point.id,
			vector: {
				[denseName]: point.vector.dense,
				[sparseName]: point.vector.bm25
			},
			payload: point.payload
		}));

		await request("PUT", `${base}/points?wait=${wait}`, { points: mapped });
	};

	const queryHybrid = async (query: HybridQuery): Promise<QueryHit[]> => {
		const prefetchLimit = query.prefetchLimit ?? query.limit;
		const bm25: Bm25Inference = { text: query.text, model: "qdrant/bm25" };

		if (query.bm25Options !== undefined) {
			bm25.options = query.bm25Options;
		}

		const prefetch: Record<string, unknown>[] = [
			{ query: query.dense, using: denseName, limit: prefetchLimit },
			{ query: bm25, using: sparseName, limit: prefetchLimit }
		];

		if (query.filter !== undefined) {
			for (const stage of prefetch) {
				stage.filter = query.filter;
			}
		}

		const result = await request<{ points: QueryHit[] }>("POST", `${base}/points/query`, {
			prefetch,
			query: { rrf: {} },
			limit: query.limit,
			with_payload: true
		});

		return result.points;
	};

	/**
	 * Run one bounded query on one named vector.
	 *
	 * The request follows the documented Query API, `POST
	 * /collections/{collection_name}/points/query`, with the body `{ query, using, limit,
	 * with_payload: false }` plus the `filter` when present. This is the same shape that
	 * {@link queryHybrid} uses for one prefetch. Because the query sets `with_payload: false`, the
	 * method returns the identifiers and the scores only.
	 */
	const queryVector = async (
		query: VectorQuery
	): Promise<Array<Pick<QueryHit, "id" | "score">>> => {
		const body: Record<string, unknown> = {
			query: query.query,
			using: query.using,
			limit: query.limit,
			with_payload: false
		};

		if (query.filter !== undefined) {
			body.filter = query.filter;
		}

		const result = await request<{ points: Array<Pick<QueryHit, "id" | "score">> }>(
			"POST",
			`${base}/points/query`,
			body
		);

		return result.points;
	};

	/** Combine a payload filter with an identifier restriction. */
	const withIds = (
		filter: PayloadFilter | undefined,
		ids: Array<number | string>
	): PayloadFilter => {
		const must: FilterCondition[] = filter?.must === undefined ? [] : [...filter.must];

		must.push({ has_id: ids });

		return { must };
	};

	const scrollIds = async (
		options: { filter?: PayloadFilter; pageSize?: number } = {}
	): Promise<Array<number | string>> => {
		const pageSize = options.pageSize ?? 256;
		const ids: Array<number | string> = [];
		let offset: number | string | undefined;

		for (;;) {
			const body: Record<string, unknown> = {
				limit: pageSize,
				with_payload: false,
				with_vector: false
			};

			if (options.filter !== undefined) {
				body.filter = options.filter;
			}

			if (offset !== undefined) {
				body.offset = offset;
			}

			const result = await request<{
				points: Array<{ id: number | string }>;
				next_page_offset?: number | string | null;
			}>("POST", `${base}/points/scroll`, body);

			for (const point of result.points) {
				ids.push(point.id);
			}

			const next = result.next_page_offset;

			if (next === undefined || next === null) {
				break;
			}

			offset = next;
		}

		return ids;
	};

	const fetchPayloads = async (
		ids: Array<number | string>
	): Promise<Map<number | string, Record<string, unknown>>> => {
		const payloads = new Map<number | string, Record<string, unknown>>();

		if (ids.length === 0) {
			return payloads;
		}

		const points = await request<
			Array<{ id: number | string; payload?: Record<string, unknown> }>
		>("POST", `${base}/points`, {
			ids,
			with_payload: true,
			with_vector: false
		});

		for (const point of points) {
			payloads.set(point.id, point.payload ?? {});
		}

		return payloads;
	};

	const queryDenseExact = async (query: ExactDenseQuery): Promise<ExactScoreResult> => {
		if (query.ids.length === 0) {
			return { scores: [], missing: [] };
		}

		const result = await request<{ points: QueryHit[] }>("POST", `${base}/points/query`, {
			query: query.vector,
			using: denseName,
			filter: withIds(query.filter, query.ids),
			params: { exact: true },
			limit: query.ids.length,
			with_payload: false
		});

		const scores: IndexScore[] = result.points.map((point) => ({
			id: point.id,
			score: point.score
		}));
		const returned = new Set(scores.map((entry) => entry.id));
		const missing = query.ids.filter((id) => !returned.has(id));

		if (missing.length > 0 && (query.onMissing ?? "throw") === "throw") {
			throw new MissingVectorError("dense", missing);
		}

		return { scores, missing };
	};

	const querySparseExact = async (query: ExactSparseQuery): Promise<ExactScoreResult> => {
		if (query.ids.length === 0) {
			return { scores: [], missing: [] };
		}

		const bm25: Bm25Inference = { text: query.text, model: "qdrant/bm25" };

		if (query.bm25Options !== undefined) {
			bm25.options = query.bm25Options;
		}

		const result = await request<{ points: QueryHit[] }>("POST", `${base}/points/query`, {
			query: bm25,
			using: sparseName,
			filter: withIds(query.filter, query.ids),
			limit: query.ids.length,
			with_payload: false
		});

		const scores: IndexScore[] = result.points.map((point) => ({
			id: point.id,
			score: point.score
		}));
		const returned = new Set(scores.map((entry) => entry.id));
		const missing = query.ids.filter((id) => !returned.has(id));

		return { scores, missing };
	};

	/**
	 * Add the ast multivector definition to an existing collection.
	 *
	 * The operation follows the documented vector-schema update, `PUT
	 * /collections/{collection_name}/vectors/{vector_name}`. The body key `dense` names the vector
	 * _type_, not the vector: Qdrant takes the vector name from the path. The name of the body key
	 * must stay `dense` even when the schema names the vector `ast`.
	 *
	 * The definition is added asynchronously. Existing points gain no value until
	 * {@link updateAstVectors} writes one.
	 *
	 * When the collection already lists the vector, the method compares its `size` and its
	 * `multivector_config.comparator` with the schema. A different shape raises
	 * {@link IncompatibleAstVectorError} instead of failing later on the first query.
	 *
	 * @returns `true` when this call added the definition, `false` when a compatible definition
	 *   already existed.
	 */
	const ensureAstVector = async (): Promise<boolean> => {
		const ast = requireAstVector();
		const vectors = await collectionVectors();
		const existing = vectors.get(ast.name);

		if (existing !== undefined) {
			const found = {
				...(existing.size === undefined ? {} : { size: existing.size }),
				...(existing.multivector_config?.comparator === undefined
					? {}
					: { comparator: existing.multivector_config.comparator })
			};
			const expected = { size: ast.size, comparator: ast.comparator };

			if (found.size !== expected.size || found.comparator !== expected.comparator) {
				throw new IncompatibleAstVectorError(ast.name, expected, found);
			}

			return false;
		}

		await request("PUT", `${base}/vectors/${encodeURIComponent(ast.name)}`, {
			dense: multiVectorConfig(ast)
		});

		return true;
	};

	/**
	 * Write the ast vector of existing points and keep every other vector and payload.
	 *
	 * The request sends only the `ast` key, so Qdrant leaves the dense vector, the BM25 vector, and
	 * the business payload unchanged. Every listed point must already exist.
	 */
	const updateAstVectors = async (
		points: Array<{ id: number | string; rows: number[][] }>,
		options: { wait?: boolean } = {}
	): Promise<void> => {
		const { name, size } = requireAstVector();

		for (const point of points) {
			assertRows(point.id, point.rows, size);
		}

		if (points.length === 0) {
			return;
		}

		const wait = options.wait ?? true;
		const entries = points.map((point) => jsonVectorUpdate(point.id, name, point.rows));

		await send(
			"PUT",
			`${base}/points/vectors?wait=${wait}`,
			`{"points":[${entries.join(",")}]}`
		);
	};

	/**
	 * Score one identifier batch with an exact ast multivector search.
	 *
	 * Qdrant computes `score = Σᵢ maxⱼ Sim(Aᵢ, Bⱼ)`, so the raw score is not bounded by one: two
	 * identical rows score `2.0`. This method returns the raw score unchanged. Normalization to
	 * `[0, 1]` belongs to the retrieval layer, so do not clamp here.
	 */
	const queryAstExact = async (query: ExactAstQuery): Promise<ExactScoreResult> => {
		const { name, size } = requireAstVector();

		assertRows("query", query.rows, size);

		if (query.ids.length === 0) {
			return { scores: [], missing: [] };
		}

		// The body is built by hand, so the documented `with_vectors` key sits beside
		// `with_payload`. When `withRows` is true, Qdrant returns the stored ast matrix and the
		// transport reads its row count.
		const withVectors =
			query.withRows === true ? `,"with_vectors":[${JSON.stringify(name)}]` : "";

		const result = await send<{ points: QueryHitWithVector[] }>(
			"POST",
			`${base}/points/query`,
			`{"query":${jsonMatrix("query", query.rows)},"using":${JSON.stringify(
				name
			)},"filter":${JSON.stringify(withIds(query.filter, query.ids))},"params":{"exact":true},"limit":${query.ids.length},"with_payload":false${withVectors}}`
		);

		const scores: IndexScore[] = result.points.map((point) => {
			const entry: IndexScore = { id: point.id, score: point.score };

			if (query.withRows === true) {
				const matrix = point.vector?.[name];

				entry.rows = Array.isArray(matrix) ? matrix.length : 0;
			}

			return entry;
		});
		const returned = new Set(scores.map((entry) => entry.id));
		const missing = query.ids.filter((id) => !returned.has(id));

		if (missing.length > 0 && (query.onMissing ?? "throw") === "throw") {
			throw new MissingVectorError(name, missing);
		}

		return { scores, missing };
	};

	/**
	 * Delete named vectors from existing points, and keep every other vector and the payload.
	 *
	 * The operation follows the documented "Delete Vectors" endpoint of Qdrant 1.19.1:
	 *
	 * ```http
	 * POST /collections/{collection_name}/points/vectors/delete?wait=true
	 * { "points": [2], "vectors": ["ast"] }
	 * ```
	 *
	 * Qdrant keeps the other vectors and the payload of each point, and never deletes the point.
	 * The operation is idempotent on an existing point: a second delete of the same vector succeeds
	 * again.
	 *
	 * A point that Qdrant reports as `Not found: No point with id … found` is already in the target
	 * state, so the method resolves and reports it through `options.log` instead of aborting the
	 * caller's sweep. Every other failure, including a `5xx` and a missing collection, still
	 * throws.
	 *
	 * Measured on 1.19.1: a batch that mixes a present and an absent point applies the rest of the
	 * batch and _then_ reports the absent point. The per-identifier fallback below is therefore a
	 * defensive layer, not a correctness requirement. If a future version skips a whole batch, the
	 * fallback still clears every present identifier, because each single-identifier request is
	 * unambiguous: a success clears the identifier, and an already-absent answer means it is
	 * already in the target state.
	 *
	 * @param ids Identifiers to clear. An empty list sends no request.
	 * @param vectors Vector names to delete. An empty list sends no request.
	 * @param options `wait` defaults to `true`; `log` receives one message per absent point.
	 */
	const deleteVectors = async (
		ids: Array<number | string>,
		vectors: string[],
		options: { wait?: boolean; log?: (message: string) => void } = {}
	): Promise<void> => {
		if (ids.length === 0 || vectors.length === 0) {
			return;
		}

		const wait = options.wait ?? true;

		/** Delete the named vectors of one identifier set. */
		const post = async (batch: Array<number | string>): Promise<void> => {
			await request("POST", `${base}/points/vectors/delete?wait=${wait}`, {
				points: batch,
				vectors
			});
		};

		try {
			await post(ids);

			return;
		} catch (error) {
			// Only a vanished point is tolerated. A missing collection also answers 404, so the
			// check matches the documented point message, not the status code.
			if (!isMissingPointError(error)) {
				throw error;
			}

			options.log?.(
				`batch of ${ids.length} reported an absent point (${describeError(error)})`
			);
		}

		for (const id of ids) {
			try {
				await post([id]);
			} catch (error) {
				if (!isMissingPointError(error)) {
					throw error;
				}

				options.log?.(`${id}: already absent from the collection, nothing to delete`);
			}
		}
	};

	return {
		url,
		collection,
		schema,
		ensureCollection,
		deleteCollection,
		upsert,
		queryHybrid,
		queryVector,
		scrollIds,
		fetchPayloads,
		queryDenseExact,
		querySparseExact,
		ensureAstVector,
		updateAstVectors,
		queryAstExact,
		deleteVectors
	};
};
