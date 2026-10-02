import { describe, expect, test } from "bun:test"
import type { ExactDenseQuery, HybridQuery, QueryHit } from "./qdrant"
import { createRetriever, createWeightedRetriever } from "./retrieval"

const BM25 = { language: "french", ascii_folding: true, avg_len: 7 }

/** Create a retriever whose dependencies record calls and return fixed hits. */
const createFakes = (hits: QueryHit[] = []) => {
	const queries: HybridQuery[] = []
	const denseQueries: string[] = []
	const dependencies = {
		embedder: {
			embedDenseQuery: async (text: string) => {
				denseQueries.push(text)

				return [0.1, 0.2]
			},
		},
		client: {
			queryHybrid: async (query: HybridQuery) => {
				queries.push(query)

				return hits
			},
		},
		bm25: BM25,
	}

	return { dependencies, queries, denseQueries }
}

describe("retrieveHybrid", () => {
	test("builds a hybrid query with shared BM25 options and a year filter", async () => {
		const { dependencies, queries, denseQueries } = createFakes()
		const retriever = createRetriever(dependencies)

		await retriever.retrieveHybrid("sucre", { topK: 3, yearFrom: 2004, yearTo: 2005 })

		expect(denseQueries).toEqual(["sucre"])
		expect(queries).toEqual([
			{
				dense: [0.1, 0.2],
				text: "sucre",
				bm25Options: BM25,
				limit: 3,
				prefetchLimit: 12,
				filter: { must: [{ key: "annee", range: { gte: 2004, lte: 2005 } }] },
			},
		])
	})

	test("defaults topK and omits the filter when no year bound is set", async () => {
		const { dependencies, queries } = createFakes()
		const retriever = createRetriever(dependencies)

		await retriever.retrieveHybrid("sucre")

		expect(queries[0]?.limit).toBe(5)
		expect(queries[0]?.prefetchLimit).toBe(20)
		expect(queries[0]?.filter).toBeUndefined()
	})

	test("builds a one-sided year filter", async () => {
		const { dependencies, queries } = createFakes()
		const retriever = createRetriever(dependencies)

		await retriever.retrieveHybrid("sucre", { yearFrom: 2004 })
		await retriever.retrieveHybrid("sucre", { yearTo: 2005 })

		expect(queries[0]?.filter).toEqual({ must: [{ key: "annee", range: { gte: 2004 } }] })
		expect(queries[1]?.filter).toEqual({ must: [{ key: "annee", range: { lte: 2005 } }] })
	})

	test("returns an empty list for a blank query without calling the model", async () => {
		const { dependencies, queries, denseQueries } = createFakes()
		const retriever = createRetriever(dependencies)

		expect(await retriever.retrieveHybrid("   ")).toEqual([])
		expect(denseQueries).toEqual([])
		expect(queries).toEqual([])
	})

	test("returns an empty list when Qdrant has no hits", async () => {
		const { dependencies } = createFakes([])
		const retriever = createRetriever(dependencies)

		expect(await retriever.retrieveHybrid("sucre")).toEqual([])
	})

	test("maps payload fields to typed hits", async () => {
		const { dependencies } = createFakes([
			{
				id: 2,
				score: 0.5,
				payload: { id: 2, annee: 2004, marque: "Danone", campagne: "", slogan: "Un peu de sucre" },
			},
		])
		const retriever = createRetriever(dependencies)

		expect(await retriever.retrieveHybrid("sucre")).toEqual([
			{
				score: 0.5,
				id: 2,
				annee: 2004,
				marque: "Danone",
				campagne: "",
				slogan: "Un peu de sucre",
			},
		])
	})
})

/** Create a weighted retriever over fixed identifiers and cosine scores. */
const createWeightedFakes = (
	ids: Array<number | string>,
	cosines: Record<string | number, number>,
	options: { batchSize?: number } = {},
) => {
	const denseQueries: string[] = []
	const batches: Array<Array<number | string>> = []
	const scrollCalls: Array<unknown> = []
	const dependencies = {
		embedder: {
			embedDenseQuery: async (text: string) => {
				denseQueries.push(text)

				return [0.1, 0.2]
			},
		},
		client: {
			scrollIds: async (request?: unknown) => {
				scrollCalls.push(request)

				return ids
			},
			queryDenseExact: async (query: ExactDenseQuery) => {
				batches.push(query.ids)

				return {
					scores: query.ids
						.filter((id) => cosines[id] !== undefined)
						.map((id) => ({ id, score: cosines[id] ?? 0 })),
					missing: [],
				}
			},
			querySparseExact: async () => ({ scores: [], missing: [] }),
		},
		bm25: BM25,
		idBatchSize: options.batchSize,
	}

	return { dependencies, denseQueries, batches, scrollCalls }
}

describe("retrieveWeighted (semantic-only)", () => {
	test("scores every eligible identifier without a top-K cutoff", async () => {
		const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
		const cosines: Record<number, number> = {}
		for (const id of ids) {
			cosines[id] = id / 100
		}
		const { dependencies } = createWeightedFakes(ids, cosines)
		const retriever = createWeightedRetriever(dependencies)

		const page = await retriever.retrieveWeighted({
			text: "sucre",
			weights: { semantic: 1 },
			minScore: 0,
			pageSize: 100,
		})

		expect(page.results).toHaveLength(10)
		expect(page.results[0]).toMatchObject({ id: 10, score: 0.1 })
	})

	test("normalizes cosine and clips negative values to zero", async () => {
		const { dependencies } = createWeightedFakes([1, 2], { 1: 0.8, 2: -0.5 })
		const retriever = createWeightedRetriever(dependencies)

		const page = await retriever.retrieveWeighted({
			text: "sucre",
			weights: { semantic: 1 },
			minScore: 0,
		})

		expect(page.results).toEqual([
			{
				id: 1,
				score: 0.8,
				scores: { semantic: 0.8 },
				annee: 0,
				marque: "",
				campagne: "",
				slogan: "",
			},
			{ id: 2, score: 0, scores: { semantic: 0 }, annee: 0, marque: "", campagne: "", slogan: "" },
		])
	})

	test("applies an inclusive threshold at the boundary", async () => {
		const { dependencies } = createWeightedFakes([1, 2, 3], { 1: 0.8, 2: 0.5, 3: 0.4999999 })
		const retriever = createWeightedRetriever(dependencies)

		const page = await retriever.retrieveWeighted({
			text: "sucre",
			weights: { semantic: 1 },
			minScore: 0.5,
		})

		expect(page.results.map((hit) => hit.id)).toEqual([1, 2])
	})

	test("returns an empty page when no record qualifies", async () => {
		const { dependencies } = createWeightedFakes([1, 2], { 1: 0.2, 2: 0.3 })
		const retriever = createWeightedRetriever(dependencies)

		const page = await retriever.retrieveWeighted({
			text: "sucre",
			weights: { semantic: 1 },
			minScore: 0.9,
		})

		expect(page.results).toEqual([])
		expect(page.nextCursor).toBeUndefined()
	})

	test("a zero threshold includes zero-score records", async () => {
		const { dependencies } = createWeightedFakes([1, 2], { 1: 0.9, 2: -1 })
		const retriever = createWeightedRetriever(dependencies)

		const page = await retriever.retrieveWeighted({
			text: "sucre",
			weights: { semantic: 1 },
			minScore: 0,
		})

		expect(page.results.map((hit) => hit.id)).toEqual([1, 2])
	})

	test("batches identifier score requests", async () => {
		const ids = [1, 2, 3, 4, 5]
		const cosines: Record<number, number> = { 1: 0.1, 2: 0.2, 3: 0.3, 4: 0.4, 5: 0.5 }
		const { dependencies, batches } = createWeightedFakes(ids, cosines, { batchSize: 2 })
		const retriever = createWeightedRetriever(dependencies)

		await retriever.retrieveWeighted({ text: "sucre", weights: { semantic: 1 }, minScore: 0 })

		expect(batches).toEqual([[1, 2], [3, 4], [5]])
	})

	test("passes the year filter to the scroll and the score query", async () => {
		const { dependencies, scrollCalls } = createWeightedFakes([1], { 1: 0.5 })
		const retriever = createWeightedRetriever(dependencies)

		await retriever.retrieveWeighted({
			text: "sucre",
			weights: { semantic: 1 },
			minScore: 0,
			filters: { yearFrom: 2004, yearTo: 2005 },
		})

		expect(scrollCalls[0]).toEqual({
			filter: { must: [{ key: "annee", range: { gte: 2004, lte: 2005 } }] },
		})
	})

	test("returns an empty page for a blank query without embedding", async () => {
		const { dependencies, denseQueries, scrollCalls } = createWeightedFakes([1], { 1: 1 })
		const retriever = createWeightedRetriever(dependencies)

		const page = await retriever.retrieveWeighted({
			text: "   ",
			weights: { semantic: 1 },
			minScore: 0,
		})

		expect(page.results).toEqual([])
		expect(denseQueries).toEqual([])
		expect(scrollCalls).toEqual([])
	})

	test("returns an empty page when the collection has no identifiers", async () => {
		const { dependencies, denseQueries } = createWeightedFakes([], {})
		const retriever = createWeightedRetriever(dependencies)

		const page = await retriever.retrieveWeighted({
			text: "sucre",
			weights: { semantic: 1 },
			minScore: 0,
		})

		expect(page.results).toEqual([])
		expect(denseQueries).toEqual([])
	})

	test("sets nextCursor when more qualifying records remain", async () => {
		const ids = [1, 2, 3]
		const { dependencies } = createWeightedFakes(ids, { 1: 0.9, 2: 0.8, 3: 0.7 })
		const retriever = createWeightedRetriever(dependencies)

		const page = await retriever.retrieveWeighted({
			text: "sucre",
			weights: { semantic: 1 },
			minScore: 0,
			pageSize: 2,
		})

		expect(page.results.map((hit) => hit.id)).toEqual([1, 2])
		expect(page.nextCursor).toBe("2")
	})

	test("orders ties by identifier ascending", async () => {
		const { dependencies } = createWeightedFakes([3, 1, 2], { 1: 0.5, 2: 0.5, 3: 0.5 })
		const retriever = createWeightedRetriever(dependencies)

		const page = await retriever.retrieveWeighted({
			text: "sucre",
			weights: { semantic: 1 },
			minScore: 0,
		})

		expect(page.results.map((hit) => hit.id)).toEqual([1, 2, 3])
	})

	test("reports the normalization version, weights, and generation", async () => {
		const { dependencies } = createWeightedFakes([1], { 1: 0.5 })
		const retriever = createWeightedRetriever(dependencies)

		const page = await retriever.retrieveWeighted({
			text: "sucre",
			weights: { semantic: 1 },
			minScore: 0.25,
			generation: "gen-42",
		})

		expect(page.metadata).toEqual({
			weights: { syntax: 0, semantic: 1, keyword: 0 },
			minScore: 0.25,
			normalizationVersion: "1",
			generation: "gen-42",
		})
	})

	test("rejects invalid weights", async () => {
		const { dependencies } = createWeightedFakes([1], { 1: 0.5 })
		const retriever = createWeightedRetriever(dependencies)

		await expect(
			retriever.retrieveWeighted({ text: "sucre", weights: { semantic: 0.5 }, minScore: 0 }),
		).rejects.toThrow(/invalid weights/)
	})

	test("rejects an out-of-range threshold", async () => {
		const { dependencies } = createWeightedFakes([1], { 1: 0.5 })
		const retriever = createWeightedRetriever(dependencies)

		await expect(
			retriever.retrieveWeighted({ text: "sucre", weights: { semantic: 1 }, minScore: 2 }),
		).rejects.toThrow(/minScore/)
	})

	test("rejects an unsupported index in this slice", async () => {
		const { dependencies } = createWeightedFakes([1], { 1: 0.5 })
		const retriever = createWeightedRetriever(dependencies)

		await expect(
			retriever.retrieveWeighted({ text: "sucre", weights: { keyword: 1 }, minScore: 0 }),
		).rejects.toThrow(/semantic index only/)
	})
})
