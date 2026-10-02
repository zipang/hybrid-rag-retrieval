import { describe, expect, test } from "bun:test"
import type { ExactDenseQuery, ExactSparseQuery } from "./qdrant"
import { createWeightedRetriever } from "./retrieval"
import { normalizeBm25 } from "./scoring"

/** BM25 options shared by the weighted fakes. */
const BM25 = { language: "french", ascii_folding: true, avg_len: 7 }

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
			fetchPayloads: async (requested: Array<number | string>) =>
				new Map(requested.map((id) => [id, { annee: 2005, marque: "Brand", slogan: "Texte" }])),
		},
		bm25: BM25,
		filterField: "annee",
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
				scores: { semantic: 0.8, keyword: 0 },
				payload: { annee: 2005, marque: "Brand", slogan: "Texte" },
			},
			{
				id: 2,
				score: 0,
				scores: { semantic: 0, keyword: 0 },
				payload: { annee: 2005, marque: "Brand", slogan: "Texte" },
			},
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

	test("uses a custom configured filter field name", async () => {
		const { dependencies, scrollCalls } = createWeightedFakes([1], { 1: 0.5 })
		const retriever = createWeightedRetriever({ ...dependencies, filterField: "published" })

		await retriever.retrieveWeighted({
			text: "vers",
			weights: { semantic: 1 },
			minScore: 0,
			filters: { yearFrom: 1900 },
		})

		expect(scrollCalls[0]).toEqual({
			filter: { must: [{ key: "published", range: { gte: 1900 } }] },
		})
	})

	test("attaches the record payload to each hit", async () => {
		const { dependencies } = createWeightedFakes([1], { 1: 0.5 })
		const retriever = createWeightedRetriever(dependencies)

		const page = await retriever.retrieveWeighted({
			text: "sucre",
			weights: { semantic: 1 },
			minScore: 0,
		})

		expect(page.results[0]?.payload).toEqual({ annee: 2005, marque: "Brand", slogan: "Texte" })
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

	test("sets an opaque nextCursor when more qualifying records remain", async () => {
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
		expect(typeof page.nextCursor).toBe("string")
		expect(page.nextCursor).not.toBe("2")
	})

	test("follows a cursor to the next page without rescoring", async () => {
		const ids = [1, 2, 3, 4]
		const { dependencies, denseQueries, batches } = createWeightedFakes(ids, {
			1: 0.9,
			2: 0.8,
			3: 0.7,
			4: 0.6,
		})
		const retriever = createWeightedRetriever(dependencies)

		const first = await retriever.retrieveWeighted({
			text: "sucre",
			weights: { semantic: 1 },
			minScore: 0,
			pageSize: 2,
		})
		const second = await retriever.retrieveWeighted({
			text: "sucre",
			weights: { semantic: 1 },
			minScore: 0,
			pageSize: 2,
			cursor: first.nextCursor ?? "",
		})

		expect(first.results.map((hit) => hit.id)).toEqual([1, 2])
		expect(second.results.map((hit) => hit.id)).toEqual([3, 4])
		expect(second.nextCursor).toBeUndefined()
		expect(denseQueries).toEqual(["sucre"])
		expect(batches).toEqual([[1, 2, 3, 4]])
	})

	test("rejects a cursor from a different query", async () => {
		const ids = [1, 2, 3]
		const { dependencies } = createWeightedFakes(ids, { 1: 0.9, 2: 0.8, 3: 0.7 })
		const retriever = createWeightedRetriever(dependencies)

		const first = await retriever.retrieveWeighted({
			text: "sucre",
			weights: { semantic: 1 },
			minScore: 0,
			pageSize: 2,
		})

		await expect(
			retriever.retrieveWeighted({
				text: "autre",
				weights: { semantic: 1 },
				minScore: 0,
				pageSize: 2,
				cursor: first.nextCursor ?? "",
			}),
		).rejects.toThrow(/cursor does not match/)
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

	test("rejects the syntax index until it is available", async () => {
		const { dependencies } = createWeightedFakes([1], { 1: 0.5 })
		const retriever = createWeightedRetriever(dependencies)

		await expect(
			retriever.retrieveWeighted({ text: "sucre", weights: { syntax: 1 }, minScore: 0 }),
		).rejects.toThrow(/syntax index is not available/)
	})
})

/** Create a weighted retriever over fixed dense and sparse scores. */
const createCombinedFakes = (options: {
	ids: Array<number | string>
	semantic?: Record<string | number, number>
	keyword?: Record<string | number, number>
}) => {
	const denseQueries: string[] = []
	const sparseQueries: string[] = []
	const dependencies = {
		embedder: {
			embedDenseQuery: async (text: string) => {
				denseQueries.push(text)

				return [0.1, 0.2]
			},
		},
		client: {
			scrollIds: async () => options.ids,
			queryDenseExact: async (query: ExactDenseQuery) => ({
				scores: query.ids
					.filter((id) => options.semantic?.[id] !== undefined)
					.map((id) => ({ id, score: options.semantic?.[id] ?? 0 })),
				missing: [],
			}),
			querySparseExact: async (query: ExactSparseQuery) => {
				sparseQueries.push(query.text)

				return {
					scores: query.ids
						.filter((id) => options.keyword?.[id] !== undefined)
						.map((id) => ({ id, score: options.keyword?.[id] ?? 0 })),
					missing: query.ids.filter((id) => options.keyword?.[id] === undefined),
				}
			},
			fetchPayloads: async (requested: Array<number | string>) =>
				new Map(requested.map((id) => [id, { annee: 2005 }])),
		},
		bm25: BM25,
		filterField: "annee",
	}

	return { dependencies, denseQueries, sparseQueries }
}

describe("retrieveWeighted (keyword and combined)", () => {
	test("scores a keyword-only query and gives nonmatches zero", async () => {
		const { dependencies, denseQueries } = createCombinedFakes({
			ids: [1, 2, 3],
			keyword: { 1: 3, 2: 1 },
		})
		const retriever = createWeightedRetriever(dependencies)

		const page = await retriever.retrieveWeighted({
			text: "sucre",
			weights: { keyword: 1 },
			minScore: 0,
		})

		expect(denseQueries).toEqual([])
		expect(page.results.map((hit) => hit.id)).toEqual([1, 2, 3])
		expect(page.results[0]?.scores.keyword).toBeCloseTo(0.5, 12)
		expect(page.results[1]?.scores.keyword).toBeCloseTo(0.25, 12)
		expect(page.results[2]?.scores.keyword).toBe(0)
	})

	test("combines semantic and keyword with explicit weights", async () => {
		const { dependencies } = createCombinedFakes({
			ids: [1, 2],
			semantic: { 1: 1, 2: 0 },
			keyword: { 1: 0, 2: 3 },
		})
		const retriever = createWeightedRetriever(dependencies)

		const page = await retriever.retrieveWeighted({
			text: "sucre",
			weights: { semantic: 0.5, keyword: 0.5 },
			minScore: 0,
		})

		expect(page.results[0]).toMatchObject({ id: 1, score: 0.5 })
		expect(page.results[1]).toMatchObject({ id: 2, score: 0.25 })
	})

	test("a moderate keyword contribution qualifies a zero-semantic record", async () => {
		const { dependencies } = createCombinedFakes({
			ids: [1],
			semantic: { 1: 0 },
			keyword: { 1: 9 },
		})
		const retriever = createWeightedRetriever(dependencies)

		const page = await retriever.retrieveWeighted({
			text: "sucre",
			weights: { semantic: 0.5, keyword: 0.5 },
			minScore: 0.3,
		})

		expect(page.results.map((hit) => hit.id)).toEqual([1])
		expect(page.results[0]?.score).toBeGreaterThan(0.3)
	})

	test("a zero threshold includes keyword nonmatches", async () => {
		const { dependencies } = createCombinedFakes({ ids: [1, 2], keyword: { 1: 3 } })
		const retriever = createWeightedRetriever(dependencies)

		const page = await retriever.retrieveWeighted({
			text: "sucre",
			weights: { keyword: 1 },
			minScore: 0,
		})

		expect(page.results.map((hit) => hit.id)).toEqual([1, 2])
		expect(page.results[1]?.score).toBe(0)
	})

	test("keeps component scores when a cursor continues a keyword page", async () => {
		const { dependencies, sparseQueries } = createCombinedFakes({
			ids: [1, 2, 3],
			keyword: { 1: 9, 2: 4, 3: 1 },
		})
		const retriever = createWeightedRetriever(dependencies)

		const first = await retriever.retrieveWeighted({
			text: "sucre",
			weights: { keyword: 1 },
			minScore: 0,
			pageSize: 2,
		})
		const second = await retriever.retrieveWeighted({
			text: "sucre",
			weights: { keyword: 1 },
			minScore: 0,
			pageSize: 2,
			cursor: first.nextCursor ?? "",
		})

		expect(second.results.map((hit) => hit.id)).toEqual([3])
		expect(second.results[0]?.scores.keyword).toBeCloseTo(normalizeBm25(1), 12)
		expect(sparseQueries).toEqual(["sucre"])
	})
})
