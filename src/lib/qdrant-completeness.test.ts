import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { createQdrantClient } from "./qdrant"
import type { CollectionSchema } from "./qdrant-schema"

/**
 * T0004 retrieval feasibility experiment.
 *
 * This test proves the transport assumption behind exhaustive weighted
 * retrieval: exact dense and sparse scores do not change when a query is
 * restricted to an identifier batch. It runs against a real local Qdrant
 * instance and an isolated collection. The suite skips itself when Qdrant is
 * unreachable, so the default `bun test` run stays green without a server.
 */

/** Base URL of the Qdrant HTTP API. */
const QDRANT_URL = (process.env.QDRANT_URL ?? "http://127.0.0.1:6333").replace(/\/+$/, "")

/** Isolated collection used by this experiment. */
const COLLECTION = "t0004_completeness"

/** Dense vector size of the small experiment collection. */
const DIMS = 4

/** Schema of the isolated experiment collection. */
const SCHEMA: CollectionSchema = {
	collection: COLLECTION,
	dense: { name: "dense", size: DIMS, distance: "Cosine" },
	sparse: { name: "bm25", modifier: "idf" },
}

/** Create a client bound to the isolated experiment collection. */
const createClient = () => createQdrantClient(SCHEMA, { QDRANT_URL })

/** Dense query vector. Each point has a known cosine score against it. */
const DENSE_QUERY = [1, 0, 0, 0]

/** BM25 query text. Only records that share a term appear in sparse results. */
const SPARSE_QUERY = "alpha beta"

/** Terms of the BM25 query, used to predict which records overlap. */
const SPARSE_TERMS = SPARSE_QUERY.split(" ")

/** Absolute tolerance for Qdrant score comparisons. */
const TOLERANCE = 1e-6

/** One deterministic test point. */
type TestPoint = {
	/** Point identifier. */
	id: number
	/** Dense vector. */
	dense: number[]
	/** BM25 source text. */
	text: string
	/** Payload flag used by the payload-filter experiment. */
	keep: boolean
}

/**
 * Test points. Identifiers 1 and 5 share a dense vector and a text, so they
 * must receive tied scores. Identifiers 3 and 6 share no term with the sparse
 * query, so sparse search omits them.
 */
const TEST_POINTS: TestPoint[] = [
	{ id: 1, dense: [1, 0, 0, 0], text: "alpha beta gamma", keep: true },
	{ id: 2, dense: [0.8, 0.6, 0, 0], text: "alpha beta", keep: true },
	{ id: 3, dense: [0, 1, 0, 0], text: "delta epsilon", keep: false },
	{ id: 4, dense: [-1, 0, 0, 0], text: "alpha", keep: true },
	{ id: 5, dense: [1, 0, 0, 0], text: "alpha beta gamma", keep: false },
	{ id: 6, dense: [0.6, 0.8, 0, 0], text: "zeta", keep: true },
]

/** Identifier batches used to prove that batching does not change scores. */
const ID_BATCHES: number[][] = [
	[1, 2],
	[3, 4],
	[5, 6],
]

/** Qdrant collection path for this experiment. */
const BASE = `/collections/${encodeURIComponent(COLLECTION)}`

/** One scored point returned by the Query API. */
type QueryPoint = {
	/** Point identifier. */
	id: number
	/** Index-specific raw score. */
	score: number
}

/** Build a filter that restricts a query to one list of identifiers. */
const idsFilter = (ids: number[]) => ({ must: [{ has_id: ids }] })

/** Return whether the local Qdrant server answers a short health request. */
const isQdrantReachable = async (): Promise<boolean> => {
	try {
		const response = await fetch(`${QDRANT_URL}/collections`, { signal: AbortSignal.timeout(2000) })

		return response.ok
	} catch {
		return false
	}
}

/** Send one JSON request to Qdrant and return its `result` field. */
const qdrant = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
	const response = await fetch(`${QDRANT_URL}${path}`, {
		method,
		headers: { "content-type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
	})
	const text = await response.text()
	const parsed: unknown = text.length === 0 ? {} : JSON.parse(text)

	if (!response.ok) {
		throw new Error(`Qdrant ${method} ${path} failed (${response.status}).`)
	}

	return (parsed as { result: T }).result
}

/** Return every point identifier through the scroll API. */
const scrollIds = async (): Promise<number[]> => {
	const result = await qdrant<{ points: Array<{ id: number }> }>("POST", `${BASE}/points/scroll`, {
		limit: TEST_POINTS.length,
		with_payload: false,
		with_vector: false,
	})

	return result.points.map((point) => point.id)
}

/** Run an exact dense query and return identifier to raw score. */
const denseScores = async (filter?: unknown): Promise<Map<number, number>> => {
	const body: Record<string, unknown> = {
		query: DENSE_QUERY,
		using: "dense",
		limit: TEST_POINTS.length,
		params: { exact: true },
	}

	if (filter !== undefined) {
		body.filter = filter
	}

	const result = await qdrant<{ points: QueryPoint[] }>("POST", `${BASE}/points/query`, body)

	return new Map(result.points.map((point) => [point.id, point.score]))
}

/** Run a BM25 query and return identifier to raw score for every overlap. */
const sparseScores = async (filter?: unknown): Promise<Map<number, number>> => {
	const body: Record<string, unknown> = {
		query: { text: SPARSE_QUERY, model: "qdrant/bm25" },
		using: "bm25",
		limit: TEST_POINTS.length,
	}

	if (filter !== undefined) {
		body.filter = filter
	}

	const result = await qdrant<{ points: QueryPoint[] }>("POST", `${BASE}/points/query`, body)

	return new Map(result.points.map((point) => [point.id, point.score]))
}

/** Assert two raw Qdrant scores within the experiment tolerance. */
const expectClose = (actual: number, expected: number): void => {
	expect(Math.abs(actual - expected)).toBeLessThanOrEqual(TOLERANCE)
}

const suite = (await isQdrantReachable()) ? describe : describe.skip

suite("[T0004] exhaustive Qdrant score enumeration", () => {
	beforeAll(async () => {
		await fetch(`${QDRANT_URL}${BASE}`, { method: "DELETE" })
		await qdrant("PUT", BASE, {
			vectors: { dense: { size: DIMS, distance: "Cosine" } },
			sparse_vectors: { bm25: { modifier: "idf" } },
		})
		await qdrant("PUT", `${BASE}/points?wait=true`, {
			points: TEST_POINTS.map((point) => ({
				id: point.id,
				vector: {
					dense: point.dense,
					bm25: { text: point.text, model: "qdrant/bm25" },
				},
				payload: { keep: point.keep },
			})),
		})
	})

	afterAll(async () => {
		await fetch(`${QDRANT_URL}${BASE}`, { method: "DELETE" })
	})

	test("scrolls a complete, exhaustive identifier set", async () => {
		const ids = await scrollIds()

		expect(new Set(ids)).toEqual(new Set(TEST_POINTS.map((point) => point.id)))
	})

	test("raw scores form a nondegenerate landscape", async () => {
		const dense = await denseScores()
		const sparse = await sparseScores()

		expectClose(dense.get(1) ?? Number.NaN, 1)
		expectClose(dense.get(2) ?? Number.NaN, 0.8)
		expectClose(dense.get(3) ?? Number.NaN, 0)
		expectClose(dense.get(4) ?? Number.NaN, -1)
		expectClose(dense.get(6) ?? Number.NaN, 0.6)

		for (const score of sparse.values()) {
			expect(score).toBeGreaterThan(0)
		}

		expect(sparse.get(1)).not.toBe(sparse.get(2))
		expect(sparse.get(2)).not.toBe(sparse.get(4))
	})

	test("dense exact scores are identical globally and across identifier batches", async () => {
		const global = await denseScores()
		const batched = new Map<number, number>()

		for (const batch of ID_BATCHES) {
			for (const [id, score] of await denseScores(idsFilter(batch))) {
				batched.set(id, score)
			}
		}

		expect(global.size).toBe(TEST_POINTS.length)
		expect(batched.size).toBe(TEST_POINTS.length)

		for (const [id, score] of global) {
			expectClose(batched.get(id) ?? Number.NaN, score)
		}
	})

	test("BM25 raw scores are identical globally and across identifier batches", async () => {
		const global = await sparseScores()
		const batched = new Map<number, number>()
		const matches = TEST_POINTS.filter((point) =>
			SPARSE_TERMS.some((term) => point.text.includes(term)),
		).map((point) => point.id)

		for (const batch of ID_BATCHES) {
			for (const [id, score] of await sparseScores(idsFilter(batch))) {
				batched.set(id, score)
			}
		}

		expect(new Set(global.keys())).toEqual(new Set(matches))
		expect(batched.size).toBe(global.size)

		for (const [id, score] of global) {
			expectClose(batched.get(id) ?? Number.NaN, score)
		}
	})

	test("sparse search omits nonoverlapping records instead of scoring zero", async () => {
		const global = await sparseScores()

		expect(global.has(3)).toBe(false)
		expect(global.has(6)).toBe(false)
	})

	test("a single-identifier filter preserves the global BM25 score", async () => {
		const global = await sparseScores()

		for (const point of TEST_POINTS) {
			const single = await sparseScores(idsFilter([point.id]))

			if (global.has(point.id)) {
				expectClose(single.get(point.id) ?? Number.NaN, global.get(point.id) ?? Number.NaN)
			} else {
				expect(single.has(point.id)).toBe(false)
			}
		}
	})

	test("a payload filter changes membership but not raw scores", async () => {
		const keepFilter = { must: [{ key: "keep", match: { value: true } }] }
		const denseGlobal = await denseScores()
		const denseKept = await denseScores(keepFilter)
		const sparseGlobal = await sparseScores()
		const sparseKept = await sparseScores(keepFilter)
		const keptIds = TEST_POINTS.filter((point) => point.keep).map((point) => point.id)

		expect(new Set(denseKept.keys())).toEqual(new Set(keptIds))

		for (const [id, score] of denseKept) {
			expectClose(score, denseGlobal.get(id) ?? Number.NaN)
		}

		for (const [id, score] of sparseKept) {
			expectClose(score, sparseGlobal.get(id) ?? Number.NaN)
		}
	})

	test("an identifier batch combined with a payload filter keeps raw scores", async () => {
		const keepFilter = { must: [{ has_id: [1, 2, 3] }, { key: "keep", match: { value: true } }] }
		const global = await sparseScores()
		const combined = await sparseScores(keepFilter)

		expect(new Set(combined.keys())).toEqual(new Set([1, 2]))

		for (const [id, score] of combined) {
			expectClose(score, global.get(id) ?? Number.NaN)
		}
	})

	test("identical vectors and texts receive tied scores", async () => {
		const dense = await denseScores()
		const sparse = await sparseScores()

		expect(dense.get(1)).toBe(dense.get(5))
		expectClose(sparse.get(1) ?? Number.NaN, sparse.get(5) ?? Number.NaN)
	})

	test("the client scroll returns the same complete identifier set", async () => {
		const client = createClient()
		const ids = await client.scrollIds({ pageSize: 2 })

		expect(new Set(ids)).toEqual(new Set(TEST_POINTS.map((point) => point.id)))
	})

	test("the client dense exact scores match the raw probes", async () => {
		const client = createClient()
		const ids = TEST_POINTS.map((point) => point.id)
		const global = await denseScores()
		const result = await client.queryDenseExact({ vector: DENSE_QUERY, ids })

		expect(result.missing).toEqual([])

		for (const entry of result.scores) {
			expectClose(entry.score, global.get(entry.id as number) ?? Number.NaN)
		}
	})

	test("the client sparse exact scores match the raw probes and report nonmatches", async () => {
		const client = createClient()
		const ids = TEST_POINTS.map((point) => point.id)
		const global = await sparseScores()
		const result = await client.querySparseExact({ text: SPARSE_QUERY, ids })

		expect(new Set(result.scores.map((entry) => entry.id))).toEqual(new Set(global.keys()))
		expect(new Set(result.missing)).toEqual(new Set([3, 6]))

		for (const entry of result.scores) {
			expectClose(entry.score, global.get(entry.id as number) ?? Number.NaN)
		}
	})

	test("the client raises on a missing dense vector", async () => {
		const client = createClient()

		await expect(client.queryDenseExact({ vector: DENSE_QUERY, ids: [999] })).rejects.toThrow(
			/no dense vector/s,
		)
	})
})
