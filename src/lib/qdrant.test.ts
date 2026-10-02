import { describe, expect, test } from "bun:test"
import { createQdrantClient, type Point } from "./qdrant"
import type { CollectionSchema } from "./qdrant-schema"

/** Test collection schema with no dataset-specific constant. */
const SCHEMA: CollectionSchema = {
	collection: "slogans",
	dense: { name: "dense", size: 1024, distance: "Cosine" },
	sparse: { name: "bm25", modifier: "idf" },
	payloadIndexes: [
		{ name: "annee", schema: "integer" },
		{ name: "marque", schema: "keyword" },
	],
}

type StubCall = {
	method: string
	url: string
	body: unknown
}

type StubResponse = {
	status?: number
	result?: unknown
	error?: string
}

const BASE = "http://qdrant.test:6333/collections/slogans"

/** Build a JSON response that mimics the Qdrant envelope. */
const jsonResponse = (response: StubResponse = {}): Response => {
	const payload =
		response.error !== undefined
			? { status: { error: response.error }, time: 0 }
			: { result: response.result, status: "ok", time: 0 }

	return new Response(JSON.stringify(payload), {
		status: response.status ?? 200,
		headers: { "content-type": "application/json" },
	})
}

/** Create a client whose fetch records calls and defers replies to a handler. */
const createTestClient = (handler: (call: StubCall) => Response) => {
	const calls: StubCall[] = []
	const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
		const method = init?.method ?? "GET"
		const body = init?.body === undefined ? undefined : JSON.parse(String(init.body))
		const call: StubCall = { method, url, body }
		calls.push(call)

		return handler(call)
	}) as unknown as typeof fetch

	const client = createQdrantClient(SCHEMA, { QDRANT_URL: "http://qdrant.test:6333" }, fetchImpl)

	return { client, calls }
}

describe("ensureCollection", () => {
	test("creates the collection and payload indexes when absent", async () => {
		const { client, calls } = createTestClient((call) =>
			call.url.endsWith("/exists") ? jsonResponse({ result: { exists: false } }) : jsonResponse(),
		)

		expect(await client.ensureCollection()).toBe(true)
		expect(calls).toHaveLength(4)
		expect(calls[0]).toEqual({ method: "GET", url: `${BASE}/exists`, body: undefined })
		expect(calls[1]?.method).toBe("PUT")
		expect(calls[1]?.url).toBe(BASE)
		expect(calls[1]?.body).toEqual({
			vectors: { dense: { size: 1024, distance: "Cosine" } },
			sparse_vectors: { bm25: { modifier: "idf" } },
		})
		expect(calls[2]?.body).toEqual({ field_name: "annee", field_schema: "integer" })
		expect(calls[3]?.body).toEqual({ field_name: "marque", field_schema: "keyword" })
	})

	test("leaves an existing collection untouched", async () => {
		const { client, calls } = createTestClient(() => jsonResponse({ result: { exists: true } }))

		expect(await client.ensureCollection()).toBe(false)
		expect(calls).toHaveLength(1)
	})

	test("creates the collection from a custom schema with no slogan field names", async () => {
		const custom: CollectionSchema = {
			collection: "poems",
			dense: { name: "embedding", size: 768, distance: "Dot" },
			sparse: { name: "terms" },
			payloadIndexes: [
				{ name: "poet", schema: "keyword" },
				{ name: "published", schema: "datetime" },
			],
		}
		const calls: StubCall[] = []
		const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
			calls.push({
				method: init?.method ?? "GET",
				url,
				body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
			})

			return url.endsWith("/exists") ? jsonResponse({ result: { exists: false } }) : jsonResponse()
		}) as unknown as typeof fetch
		const client = createQdrantClient(custom, { QDRANT_URL: "http://qdrant.test:6333" }, fetchImpl)

		await client.ensureCollection()

		expect(calls[1]?.url).toBe("http://qdrant.test:6333/collections/poems")
		expect(calls[1]?.body).toEqual({
			vectors: { embedding: { size: 768, distance: "Dot" } },
			sparse_vectors: { terms: {} },
		})
		expect(calls[2]?.body).toEqual({ field_name: "poet", field_schema: "keyword" })
		expect(calls[3]?.body).toEqual({ field_name: "published", field_schema: "datetime" })
	})
})

describe("deleteCollection", () => {
	test("deletes the collection when it exists", async () => {
		const { client, calls } = createTestClient((call) =>
			call.method === "GET" ? jsonResponse({ result: { exists: true } }) : jsonResponse(),
		)

		await client.deleteCollection()

		expect(calls.map((call) => call.method)).toEqual(["GET", "DELETE"])
		expect(calls[1]?.url).toBe(BASE)
	})

	test("does nothing when the collection is absent", async () => {
		const { client, calls } = createTestClient(() => jsonResponse({ result: { exists: false } }))

		await client.deleteCollection()

		expect(calls).toHaveLength(1)
	})
})

describe("upsert", () => {
	const point: Point = {
		id: 1,
		vector: { dense: [0.1, 0.2], bm25: { text: "Un peu de sucre", model: "qdrant/bm25" } },
		payload: { id: "1", annee: 2005, marque: "Danone", slogan: "Un peu de sucre" },
	}

	test("sends points with the schema vector names and waits by default", async () => {
		const { client, calls } = createTestClient(() => jsonResponse())

		await client.upsert([point])

		expect(calls[0]?.method).toBe("PUT")
		expect(calls[0]?.url).toBe(`${BASE}/points?wait=true`)
		expect(calls[0]?.body).toEqual({
			points: [
				{
					id: point.id,
					vector: {
						dense: point.vector.dense,
						bm25: point.vector.bm25,
					},
					payload: point.payload,
				},
			],
		})
	})

	test("maps the vector kinds to custom schema vector names", async () => {
		const custom: CollectionSchema = {
			collection: "poems",
			dense: { name: "embedding", size: 4, distance: "Dot" },
			sparse: { name: "terms" },
		}
		const calls: StubCall[] = []
		const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
			calls.push({
				method: init?.method ?? "GET",
				url,
				body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
			})

			return jsonResponse()
		}) as unknown as typeof fetch
		const client = createQdrantClient(custom, { QDRANT_URL: "http://qdrant.test:6333" }, fetchImpl)

		await client.upsert([point])

		expect(calls[0]?.body).toEqual({
			points: [
				{
					id: point.id,
					vector: {
						embedding: point.vector.dense,
						terms: point.vector.bm25,
					},
					payload: point.payload,
				},
			],
		})
	})

	test("honors wait:false", async () => {
		const { client, calls } = createTestClient(() => jsonResponse())

		await client.upsert([point], { wait: false })

		expect(calls[0]?.url).toBe(`${BASE}/points?wait=false`)
	})
})

describe("queryHybrid", () => {
	test("builds prefetches, applies the filter, and returns hits", async () => {
		const hits = [{ id: 1, score: 0.5, payload: { slogan: "Un peu de sucre" } }]
		const { client, calls } = createTestClient(() => jsonResponse({ result: { points: hits } }))
		const filter = { must: [{ key: "annee", range: { gte: 2004, lte: 2005 } }] }

		const result = await client.queryHybrid({
			dense: [0.1, 0.2],
			text: "sucre",
			bm25Options: { language: "french", ascii_folding: true },
			limit: 3,
			filter,
		})

		expect(result).toEqual(hits)
		expect(calls[0]?.method).toBe("POST")
		expect(calls[0]?.url).toBe(`${BASE}/points/query`)
		expect(calls[0]?.body).toEqual({
			prefetch: [
				{ query: [0.1, 0.2], using: "dense", limit: 3, filter },
				{
					query: {
						text: "sucre",
						model: "qdrant/bm25",
						options: { language: "french", ascii_folding: true },
					},
					using: "bm25",
					limit: 3,
					filter,
				},
			],
			query: { rrf: {} },
			limit: 3,
			with_payload: true,
		})
	})

	test("defaults the prefetch limit and omits an empty filter", async () => {
		const { client, calls } = createTestClient(() => jsonResponse({ result: { points: [] } }))

		await client.queryHybrid({ dense: [0.1], text: "sucre", limit: 5 })

		expect(calls[0]?.body).toEqual({
			prefetch: [
				{ query: [0.1], using: "dense", limit: 5 },
				{ query: { text: "sucre", model: "qdrant/bm25" }, using: "bm25", limit: 5 },
			],
			query: { rrf: {} },
			limit: 5,
			with_payload: true,
		})
	})
})

describe("scrollIds", () => {
	test("follows pages until the next offset is absent", async () => {
		const { client, calls } = createTestClient((call) => {
			const offset = (call.body as { offset?: number } | undefined)?.offset

			if (offset === undefined) {
				return jsonResponse({ result: { points: [{ id: 1 }, { id: 2 }], next_page_offset: 2 } })
			}

			return jsonResponse({ result: { points: [{ id: 3 }] } })
		})

		const ids = await client.scrollIds()

		expect(ids).toEqual([1, 2, 3])
		expect(calls).toHaveLength(2)
		expect(calls[0]?.body).toEqual({ limit: 256, with_payload: false, with_vector: false })
		expect(calls[1]?.body).toEqual({
			limit: 256,
			with_payload: false,
			with_vector: false,
			offset: 2,
		})
	})

	test("applies the filter and the requested page size", async () => {
		const { client, calls } = createTestClient(() => jsonResponse({ result: { points: [] } }))
		const filter = { must: [{ key: "annee", range: { gte: 2004 } }] }

		await client.scrollIds({ filter, pageSize: 10 })

		expect(calls[0]?.body).toEqual({
			limit: 10,
			with_payload: false,
			with_vector: false,
			filter,
		})
	})

	test("stops on a null next offset", async () => {
		const { client } = createTestClient(() =>
			jsonResponse({ result: { points: [{ id: 7 }], next_page_offset: null } }),
		)

		expect(await client.scrollIds()).toEqual([7])
	})
})

describe("queryDenseExact", () => {
	test("sends an exact query restricted to the identifiers", async () => {
		const { client, calls } = createTestClient(() =>
			jsonResponse({
				result: {
					points: [
						{ id: 1, score: 1, payload: {} },
						{ id: 5, score: 1, payload: {} },
					],
				},
			}),
		)

		const result = await client.queryDenseExact({
			vector: [1, 0],
			ids: [1, 5, 9],
			onMissing: "skip",
		})

		expect(result.scores).toEqual([
			{ id: 1, score: 1 },
			{ id: 5, score: 1 },
		])
		expect(result.missing).toEqual([9])
		expect(calls[0]?.body).toEqual({
			query: [1, 0],
			using: "dense",
			filter: { must: [{ has_id: [1, 5, 9] }] },
			params: { exact: true },
			limit: 3,
			with_payload: false,
		})
	})

	test("throws on a missing dense vector by default", async () => {
		const { client } = createTestClient(() =>
			jsonResponse({ result: { points: [{ id: 1, score: 1, payload: {} }] } }),
		)

		await expect(client.queryDenseExact({ vector: [1, 0], ids: [1, 9] })).rejects.toThrow(
			/no dense vector/s,
		)
	})

	test("reports a missing dense vector when the policy is skip", async () => {
		const { client } = createTestClient(() =>
			jsonResponse({ result: { points: [{ id: 1, score: 1, payload: {} }] } }),
		)

		const result = await client.queryDenseExact({
			vector: [1, 0],
			ids: [1, 9],
			onMissing: "skip",
		})

		expect(result.missing).toEqual([9])
	})

	test("returns an empty result for an empty identifier batch", async () => {
		const { client, calls } = createTestClient(() => jsonResponse({ result: { points: [] } }))

		expect(await client.queryDenseExact({ vector: [1], ids: [] })).toEqual({
			scores: [],
			missing: [],
		})
		expect(calls).toHaveLength(0)
	})

	test("combines a payload filter with the identifier set", async () => {
		const { client, calls } = createTestClient(() => jsonResponse({ result: { points: [] } }))
		const filter = { must: [{ key: "annee", range: { gte: 2004 } }] }

		await client.queryDenseExact({ vector: [1], ids: [1, 2], filter, onMissing: "skip" })

		expect(calls[0]?.body).toMatchObject({
			filter: {
				must: [{ key: "annee", range: { gte: 2004 } }, { has_id: [1, 2] }],
			},
		})
	})
})

describe("querySparseExact", () => {
	test("sends a BM25 query restricted to the identifiers", async () => {
		const { client, calls } = createTestClient(() =>
			jsonResponse({
				result: {
					points: [
						{ id: 2, score: 1.9, payload: {} },
						{ id: 4, score: 0.7, payload: {} },
					],
				},
			}),
		)

		const result = await client.querySparseExact({
			text: "alpha beta",
			bm25Options: { language: "french" },
			ids: [1, 2, 3, 4],
		})

		expect(result.scores).toEqual([
			{ id: 2, score: 1.9 },
			{ id: 4, score: 0.7 },
		])
		expect(result.missing).toEqual([1, 3])
		expect(calls[0]?.body).toEqual({
			query: { text: "alpha beta", model: "qdrant/bm25", options: { language: "french" } },
			using: "bm25",
			filter: { must: [{ has_id: [1, 2, 3, 4] }] },
			limit: 4,
			with_payload: false,
		})
	})

	test("reports sparse nonmatches without throwing", async () => {
		const { client } = createTestClient(() =>
			jsonResponse({ result: { points: [{ id: 2, score: 1.9, payload: {} }] } }),
		)

		const result = await client.querySparseExact({ text: "alpha", ids: [1, 2] })

		expect(result.missing).toEqual([1])
	})

	test("preserves the raw score exactly", async () => {
		const { client } = createTestClient(() =>
			jsonResponse({ result: { points: [{ id: 1, score: 1.905278, payload: {} }] } }),
		)

		const result = await client.querySparseExact({ text: "alpha", ids: [1] })

		expect(result.scores[0]?.score).toBe(1.905278)
	})

	test("returns an empty result for an empty identifier batch", async () => {
		const { client, calls } = createTestClient(() => jsonResponse({ result: { points: [] } }))

		expect(await client.querySparseExact({ text: "alpha", ids: [] })).toEqual({
			scores: [],
			missing: [],
		})
		expect(calls).toHaveLength(0)
	})
})

describe("errors", () => {
	test("reports the Qdrant error message and status", async () => {
		const { client } = createTestClient(() => jsonResponse({ status: 500, error: "boom" }))

		await expect(client.ensureCollection()).rejects.toThrow(/500.*boom/s)
	})
})
