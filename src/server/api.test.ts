import { describe, expect, test } from "bun:test"
import type { RetrievalOptions, SloganHit } from "../lib/slogan-retrieval"
import { createSlogansHandler } from "./api"

const HIT: SloganHit = {
	score: 0.5,
	id: 2,
	annee: 2004,
	marque: "Danone",
	campagne: "",
	slogan: "Un peu de sucre",
}

type Retrieve = (query: string, options?: RetrievalOptions) => Promise<SloganHit[]>

/** Create the handler with a retriever that records each call. */
const createTestHandler = (retrieve: Retrieve) =>
	createSlogansHandler({ retriever: { retrieveHybrid: retrieve } })

describe("createSlogansHandler", () => {
	test("returns the retrieved results with CORS headers", async () => {
		const calls: Array<{ query: string; options?: RetrievalOptions }> = []
		const handler = createTestHandler(async (query, options) => {
			calls.push({ query, options })

			return [HIT]
		})

		const response = await handler(
			new Request("http://localhost/api/slogans?q=sucre&topK=2&yearFrom=2004&yearTo=2005"),
		)

		expect(response.status).toBe(200)
		expect(response.headers.get("access-control-allow-origin")).toBe("*")
		expect(await response.json()).toEqual({ results: [HIT] })
		expect(calls).toEqual([{ query: "sucre", options: { topK: 2, yearFrom: 2004, yearTo: 2005 } }])
	})

	test("rejects an empty query with 400", async () => {
		const handler = createTestHandler(async () => [HIT])

		for (const path of ["/api/slogans", "/api/slogans?q=", "/api/slogans?q=%20%20"]) {
			const response = await handler(new Request(`http://localhost${path}`))

			expect(response.status).toBe(400)
			expect(await response.json()).toEqual({ error: 'Query parameter "q" is required.' })
		}
	})

	test("rejects a non-integer parameter with 400", async () => {
		const handler = createTestHandler(async () => [HIT])
		const response = await handler(new Request("http://localhost/api/slogans?q=sucre&topK=many"))

		expect(response.status).toBe(400)
		expect(await response.json()).toEqual({
			error: 'Query parameter "topK" must be an integer.',
		})
	})

	test("maps a retrieval failure to 500", async () => {
		const handler = createTestHandler(async () => {
			throw new Error("qdrant is down")
		})
		const response = await handler(new Request("http://localhost/api/slogans?q=sucre"))

		expect(response.status).toBe(500)
		expect(await response.json()).toEqual({ error: "qdrant is down" })
	})

	test("rejects a non-GET method with 405", async () => {
		const handler = createTestHandler(async () => [HIT])
		const response = await handler(
			new Request("http://localhost/api/slogans?q=sucre", { method: "POST" }),
		)

		expect(response.status).toBe(405)
	})

	test("answers a preflight request with 204", async () => {
		const handler = createTestHandler(async () => [HIT])
		const response = await handler(
			new Request("http://localhost/api/slogans", { method: "OPTIONS" }),
		)

		expect(response.status).toBe(204)
		expect(response.headers.get("access-control-allow-origin")).toBe("*")
	})
})
