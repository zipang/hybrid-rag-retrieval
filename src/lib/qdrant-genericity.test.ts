import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { createQdrantClient, type Point } from "./qdrant"
import type { CollectionSchema } from "./qdrant-schema"
import { createWeightedRetriever } from "./retrieval"

/**
 * Track A genericity proof.
 *
 * This test builds a second, non-slogan collection with a different collection
 * name, different vector names, and different payload fields. It indexes and
 * queries that collection through the same client and the same weighted
 * retriever that the slogan path uses. It runs against a real local Qdrant
 * instance and an isolated collection. The suite skips itself when Qdrant is
 * unreachable.
 */

/** Base URL of the Qdrant HTTP API. */
const QDRANT_URL = (process.env.QDRANT_URL ?? "http://127.0.0.1:6333").replace(/\/+$/, "")

/** Schema of the second collection. The names differ from the slogan names. */
const SCHEMA: CollectionSchema = {
	collection: "t0004_poems",
	dense: { name: "embedding", size: 4, distance: "Cosine" },
	sparse: { name: "terms", modifier: "idf" },
	payloadIndexes: [
		{ name: "published", schema: "integer" },
		{ name: "poet", schema: "keyword" },
	],
}

/** One poetry record used by the proof. */
type Poem = {
	id: number
	published: number
	poet: string
	verse: string
	embedding: number[]
}

/** Deterministic poetry records. */
const POEMS: Poem[] = [
	{
		id: 1,
		published: 1857,
		poet: "Baudelaire",
		verse: "les fleurs du mal",
		embedding: [1, 0, 0, 0],
	},
	{
		id: 2,
		published: 1899,
		poet: "Verlaine",
		verse: "le ciel est par dessus le toit",
		embedding: [0.9, 0, 0, 0],
	},
	{ id: 3, published: 1871, poet: "Rimbaud", verse: "le bateau ivre", embedding: [0, 1, 0, 0] },
]

/** Return whether the local Qdrant server answers a short health request. */
const isQdrantReachable = async (): Promise<boolean> => {
	try {
		const response = await fetch(`${QDRANT_URL}/collections`, { signal: AbortSignal.timeout(2000) })

		return response.ok
	} catch {
		return false
	}
}

const suite = (await isQdrantReachable()) ? describe : describe.skip

suite("[T0004] dataset-agnostic transport proof", () => {
	const client = createQdrantClient(SCHEMA, { QDRANT_URL })

	beforeAll(async () => {
		await client.deleteCollection()
		await client.ensureCollection()

		const points: Point[] = POEMS.map((poem) => ({
			id: poem.id,
			vector: {
				dense: poem.embedding,
				bm25: { text: poem.verse, model: "qdrant/bm25" },
			},
			payload: { published: poem.published, poet: poem.poet, verse: poem.verse },
		}))

		await client.upsert(points)
	})

	afterAll(async () => {
		await client.deleteCollection()
	})

	test("creates the collection with the schema vector names and indexes", async () => {
		const response = await fetch(`${QDRANT_URL}/collections/${SCHEMA.collection}`)
		const body = (await response.json()) as {
			result: { config: { params: { vectors: Record<string, unknown> } } }
		}

		expect(Object.keys(body.result.config.params.vectors)).toEqual(["embedding"])
	})

	test("scrolls the complete identifier set of the second collection", async () => {
		const ids = await client.scrollIds()

		expect(new Set(ids)).toEqual(new Set(POEMS.map((poem) => poem.id)))
	})

	test("scores exact dense values through the custom vector name", async () => {
		const result = await client.queryDenseExact({ vector: [1, 0, 0, 0], ids: [1, 2, 3] })

		expect(result.missing).toEqual([])

		for (const entry of result.scores) {
			expect(entry.score).toBeGreaterThanOrEqual(0)
		}
	})

	test("answers a keyword query over the custom sparse vector name", async () => {
		const result = await client.querySparseExact({ text: "bateau ivre", ids: [1, 2, 3] })

		expect(result.scores.map((entry) => entry.id)).toContain(3)
		expect(result.missing).toContain(1)
	})

	test("filters on a custom payload field name", async () => {
		const filter = { must: [{ key: "published", range: { gte: 1871 } }] }
		const ids = await client.scrollIds({ filter })

		expect(new Set(ids)).toEqual(new Set([2, 3]))
	})

	test("runs the weighted retriever end to end over the second collection", async () => {
		const retriever = createWeightedRetriever({
			embedder: { embedDenseQuery: async () => [1, 0, 0, 0] },
			client,
			bm25: { language: "french" },
			filterField: "published",
		})

		const page = await retriever.retrieveWeighted({
			text: "les fleurs du mal",
			weights: { semantic: 1 },
			minScore: 0.5,
			filters: { yearFrom: 1850 },
		})

		expect(page.results.map((hit) => hit.id)).toEqual([1, 2])

		for (const hit of page.results) {
			expect(typeof hit.payload.poet).toBe("string")
			expect(hit.payload.published).toBeGreaterThanOrEqual(1850)
		}
	})

	test("runs a keyword-weighted query over the custom sparse vector name", async () => {
		const retriever = createWeightedRetriever({
			embedder: { embedDenseQuery: async () => [0, 0, 0, 0] },
			client,
			bm25: { language: "french" },
			filterField: "published",
		})

		const page = await retriever.retrieveWeighted({
			text: "bateau ivre",
			weights: { keyword: 1 },
			minScore: 0.1,
		})

		expect(page.results.map((hit) => hit.id)).toContain(3)
	})
})
