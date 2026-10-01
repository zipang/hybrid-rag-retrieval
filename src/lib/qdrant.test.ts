import { describe, expect, test } from "bun:test"
import { createQdrantClient, type Point } from "./qdrant"

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

	const client = createQdrantClient(
		{ QDRANT_URL: "http://qdrant.test:6333", QDRANT_COLLECTION: "slogans" },
		fetchImpl,
	)

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

	test("sends points and waits by default", async () => {
		const { client, calls } = createTestClient(() => jsonResponse())

		await client.upsert([point])

		expect(calls[0]?.method).toBe("PUT")
		expect(calls[0]?.url).toBe(`${BASE}/points?wait=true`)
		expect(calls[0]?.body).toEqual({ points: [point] })
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

describe("errors", () => {
	test("reports the Qdrant error message and status", async () => {
		const { client } = createTestClient(() => jsonResponse({ status: 500, error: "boom" }))

		await expect(client.ensureCollection()).rejects.toThrow(/500.*boom/s)
	})
})
