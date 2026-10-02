/** Environment variables that configure the Qdrant connection. */
export type QdrantEnv = {
	/** Base URL of the Qdrant HTTP API. Defaults to the local instance. */
	QDRANT_URL?: string
	/** Collection that stores the points. Defaults to `slogans`. */
	QDRANT_COLLECTION?: string
	/** Extra environment values, so `process.env` is assignable. */
	[key: string]: string | undefined
}

/** Name of the dense named vector. */
export const DENSE_VECTOR_NAME = "dense"

/** Name of the sparse BM25 named vector. */
export const BM25_VECTOR_NAME = "bm25"

/** Dense vector size of `intfloat/multilingual-e5-large`. */
export const DENSE_VECTOR_SIZE = 1024

/** Qdrant BM25 inference object stored in the sparse vector. */
export type Bm25Inference = {
	/** Text to tokenize and score on the server. */
	text: string
	/** Qdrant inference model identifier. */
	model: "qdrant/bm25"
	/** Text-processing options shared with query time. */
	options?: Record<string, unknown>
}

/** Named vectors attached to one point. */
export type PointVectors = {
	/** Client-side dense embedding. */
	dense: number[]
	/** Server-side BM25 inference input. */
	bm25: Bm25Inference
}

/** One point to upsert into the collection. */
export type Point = {
	/** Unsigned integer point id. */
	id: number
	/** Dense and sparse vectors for the point. */
	vector: PointVectors
	/** Record fields stored next to the vectors. */
	payload: Record<string, unknown>
}

/** One scored point returned by the Query API. */
export type QueryHit = {
	/** Point id. */
	id: number | string
	/** Fused score from the ranking method. */
	score: number
	/** Record fields stored with the point. */
	payload: Record<string, unknown>
}

/** A single payload condition. */
export type FilterCondition =
	| { key: string; range: { gte?: number; lte?: number } }
	| { key: string; match: { value: string | number | boolean } }
	| { has_id: Array<number | string> }

/** Payload filter applied to a hybrid query. */
export type PayloadFilter = {
	/** Conditions the point must satisfy. */
	must?: FilterCondition[]
}

/** One raw score for one identifier and one index. */
export type IndexScore = {
	/** Record identifier. */
	id: number | string
	/** Raw score from Qdrant, exactly as returned. */
	score: number
}

/** Result of an exact score query for one identifier batch. */
export type ExactScoreResult = {
	/** Scores returned by Qdrant, in the Qdrant order. */
	scores: IndexScore[]
	/** Identifiers that Qdrant did not return for this index. */
	missing: Array<number | string>
}

/** One page of identifiers from a scroll operation. */
export type IdentifierPage = {
	/** Identifiers on this page. */
	ids: Array<number | string>
	/** Offset for the next page, or `undefined` on the last page. */
	nextOffset?: number | string
}

/** How a dense query treats an identifier with no dense vector. */
export type DenseMissingPolicy = "throw" | "skip"

/** Parameters of an exact dense score query. */
export type ExactDenseQuery = {
	/** Dense query vector. */
	vector: number[]
	/** Identifiers to score. The query returns only these. */
	ids: Array<number | string>
	/** Payload filter applied on top of the identifier set. */
	filter?: PayloadFilter
	/** What to do when an identifier has no dense vector. Defaults to `throw`. */
	onMissing?: DenseMissingPolicy
}

/** Parameters of an exact sparse score query. */
export type ExactSparseQuery = {
	/** Raw query text scored by Qdrant BM25. */
	text: string
	/** BM25 options; must match ingestion. */
	bm25Options?: Record<string, unknown>
	/** Identifiers to score. The query returns only these. */
	ids: Array<number | string>
	/** Payload filter applied on top of the identifier set. */
	filter?: PayloadFilter
}

/** Parameters of a hybrid dense + BM25 query. */
export type HybridQuery = {
	/** Dense query vector computed client-side. */
	dense: number[]
	/** Raw query text scored by Qdrant BM25. */
	text: string
	/** BM25 options; must match ingestion. */
	bm25Options?: Record<string, unknown>
	/** Maximum number of fused results. */
	limit: number
	/** Candidates per prefetch. Defaults to `limit`. */
	prefetchLimit?: number
	/** Payload filter applied to both prefetches. */
	filter?: PayloadFilter
}

/** Qdrant client bound to one collection. */
export type QdrantClient = {
	/** Configured base URL of the Qdrant API. */
	readonly url: string
	/** Configured collection name. */
	readonly collection: string
	/** Create the collection and its payload indexes when absent. */
	ensureCollection: () => Promise<boolean>
	/** Delete the collection when it exists. */
	deleteCollection: () => Promise<void>
	/** Upsert points in a single request. */
	upsert: (points: Point[], options?: { wait?: boolean }) => Promise<void>
	/** Run a dense + BM25 query fused with RRF. */
	queryHybrid: (query: HybridQuery) => Promise<QueryHit[]>
	/** Scroll the complete identifier set that matches a filter. */
	scrollIds: (options?: {
		filter?: PayloadFilter
		pageSize?: number
	}) => Promise<Array<number | string>>
	/** Score one identifier batch with an exact dense search. */
	queryDenseExact: (query: ExactDenseQuery) => Promise<ExactScoreResult>
	/** Score one identifier batch with a sparse BM25 search. */
	querySparseExact: (query: ExactSparseQuery) => Promise<ExactScoreResult>
}

/** Error raised when an expected vector is absent from a scored record. */
export class MissingVectorError extends Error {
	/** Vector name with the missing value. */
	readonly vector: string
	/** Identifiers with no value for the vector. */
	readonly ids: Array<number | string>

	/** Create the error with the vector name and the affected identifiers. */
	constructor(vector: string, ids: Array<number | string>) {
		super(`${ids.length} record(s) have no ${vector} vector: ${ids.join(", ")}`)
		this.name = "MissingVectorError"
		this.vector = vector
		this.ids = ids
	}
}

/** Default base URL of a locally started Qdrant instance. */
const DEFAULT_URL = "http://127.0.0.1:6333"

/** Default collection name. */
const DEFAULT_COLLECTION = "slogans"

/** Read the error message from a Qdrant error body. */
const extractErrorMessage = (body: unknown): string => {
	if (typeof body !== "object" || body === null || !("status" in body)) {
		return "unknown error"
	}

	const { status } = body as { status: unknown }

	if (typeof status !== "object" || status === null || !("error" in status)) {
		return "unknown error"
	}

	const { error } = status as { error?: unknown }

	return typeof error === "string" ? error : "unknown error"
}

/**
 * Create a thin `fetch` client for one Qdrant collection.
 *
 * The client creates the collection with a `dense` (Cosine, size 1024) named
 * vector and a `bm25` sparse vector with the IDF modifier, then creates the
 * `annee` and `marque` payload indexes. Qdrant recommends creating payload
 * indexes before ingesting data so the filterable HNSW graph can use them.
 */
export const createQdrantClient = (
	env: QdrantEnv = {},
	fetchImpl: typeof fetch = fetch,
): QdrantClient => {
	const url = (env.QDRANT_URL ?? DEFAULT_URL).replace(/\/+$/, "")
	const collection = env.QDRANT_COLLECTION ?? DEFAULT_COLLECTION
	const base = `/collections/${encodeURIComponent(collection)}`

	const request = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
		const response = await fetchImpl(`${url}${path}`, {
			method,
			headers: { "content-type": "application/json" },
			body: body === undefined ? undefined : JSON.stringify(body),
		})
		const text = await response.text()
		const parsed: unknown = text.length === 0 ? {} : JSON.parse(text)

		if (!response.ok) {
			throw new Error(
				`Qdrant ${method} ${path} failed (${response.status}): ${extractErrorMessage(parsed)}`,
			)
		}

		return (parsed as { result: T }).result
	}

	const collectionExists = async (): Promise<boolean> => {
		const result = await request<{ exists: boolean }>("GET", `${base}/exists`)

		return result.exists
	}

	const ensureCollection = async (): Promise<boolean> => {
		if (await collectionExists()) {
			return false
		}

		await request("PUT", base, {
			vectors: { [DENSE_VECTOR_NAME]: { size: DENSE_VECTOR_SIZE, distance: "Cosine" } },
			sparse_vectors: { [BM25_VECTOR_NAME]: { modifier: "idf" } },
		})
		await request("PUT", `${base}/index`, { field_name: "annee", field_schema: "integer" })
		await request("PUT", `${base}/index`, { field_name: "marque", field_schema: "keyword" })

		return true
	}

	const deleteCollection = async (): Promise<void> => {
		if (!(await collectionExists())) {
			return
		}

		await request("DELETE", base)
	}

	const upsert = async (points: Point[], options: { wait?: boolean } = {}): Promise<void> => {
		const wait = options.wait ?? true

		await request("PUT", `${base}/points?wait=${wait}`, { points })
	}

	const queryHybrid = async (query: HybridQuery): Promise<QueryHit[]> => {
		const prefetchLimit = query.prefetchLimit ?? query.limit
		const bm25: Bm25Inference = { text: query.text, model: "qdrant/bm25" }

		if (query.bm25Options !== undefined) {
			bm25.options = query.bm25Options
		}

		const prefetch: Record<string, unknown>[] = [
			{ query: query.dense, using: DENSE_VECTOR_NAME, limit: prefetchLimit },
			{ query: bm25, using: BM25_VECTOR_NAME, limit: prefetchLimit },
		]

		if (query.filter !== undefined) {
			for (const stage of prefetch) {
				stage.filter = query.filter
			}
		}

		const result = await request<{ points: QueryHit[] }>("POST", `${base}/points/query`, {
			prefetch,
			query: { rrf: {} },
			limit: query.limit,
			with_payload: true,
		})

		return result.points
	}

	/** Combine a payload filter with an identifier restriction. */
	const withIds = (
		filter: PayloadFilter | undefined,
		ids: Array<number | string>,
	): PayloadFilter => {
		const must: FilterCondition[] = filter?.must === undefined ? [] : [...filter.must]

		must.push({ has_id: ids })

		return { must }
	}

	const scrollIds = async (
		options: { filter?: PayloadFilter; pageSize?: number } = {},
	): Promise<Array<number | string>> => {
		const pageSize = options.pageSize ?? 256
		const ids: Array<number | string> = []
		let offset: number | string | undefined

		for (;;) {
			const body: Record<string, unknown> = {
				limit: pageSize,
				with_payload: false,
				with_vector: false,
			}

			if (options.filter !== undefined) {
				body.filter = options.filter
			}

			if (offset !== undefined) {
				body.offset = offset
			}

			const result = await request<{
				points: Array<{ id: number | string }>
				next_page_offset?: number | string | null
			}>("POST", `${base}/points/scroll`, body)

			for (const point of result.points) {
				ids.push(point.id)
			}

			const next = result.next_page_offset

			if (next === undefined || next === null) {
				break
			}

			offset = next
		}

		return ids
	}

	const queryDenseExact = async (query: ExactDenseQuery): Promise<ExactScoreResult> => {
		if (query.ids.length === 0) {
			return { scores: [], missing: [] }
		}

		const result = await request<{ points: QueryHit[] }>("POST", `${base}/points/query`, {
			query: query.vector,
			using: DENSE_VECTOR_NAME,
			filter: withIds(query.filter, query.ids),
			params: { exact: true },
			limit: query.ids.length,
			with_payload: false,
		})

		const scores: IndexScore[] = result.points.map((point) => ({
			id: point.id,
			score: point.score,
		}))
		const returned = new Set(scores.map((entry) => entry.id))
		const missing = query.ids.filter((id) => !returned.has(id))

		if (missing.length > 0 && (query.onMissing ?? "throw") === "throw") {
			throw new MissingVectorError("dense", missing)
		}

		return { scores, missing }
	}

	const querySparseExact = async (query: ExactSparseQuery): Promise<ExactScoreResult> => {
		if (query.ids.length === 0) {
			return { scores: [], missing: [] }
		}

		const bm25: Bm25Inference = { text: query.text, model: "qdrant/bm25" }

		if (query.bm25Options !== undefined) {
			bm25.options = query.bm25Options
		}

		const result = await request<{ points: QueryHit[] }>("POST", `${base}/points/query`, {
			query: bm25,
			using: BM25_VECTOR_NAME,
			filter: withIds(query.filter, query.ids),
			limit: query.ids.length,
			with_payload: false,
		})

		const scores: IndexScore[] = result.points.map((point) => ({
			id: point.id,
			score: point.score,
		}))
		const returned = new Set(scores.map((entry) => entry.id))
		const missing = query.ids.filter((id) => !returned.has(id))

		return { scores, missing }
	}

	return {
		url,
		collection,
		ensureCollection,
		deleteCollection,
		upsert,
		queryHybrid,
		scrollIds,
		queryDenseExact,
		querySparseExact,
	}
}
