import { describe, expect, test } from "bun:test"
import type { HybridQuery, QueryHit } from "./qdrant"
import { createRetriever } from "./retrieval"

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
