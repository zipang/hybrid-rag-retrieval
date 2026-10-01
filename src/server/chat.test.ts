import { describe, expect, test } from "bun:test"
import type { RetrievalOptions, SloganHit } from "../lib/retrieval"
import { buildSystemPrompt, createChatHandler, searchSlogans } from "./chat"

const HIT: SloganHit = {
	score: 0.5,
	id: 2,
	annee: 2004,
	marque: "Danone",
	campagne: "",
	slogan: "Un peu de sucre",
}

/** Create a handler with a retriever that records each call. */
const createTestHandler = (
	retrieve: (query: string, options?: RetrievalOptions) => Promise<SloganHit[]>,
	env: Record<string, string | undefined> = {},
) => {
	const calls: Array<{ query: string; options?: RetrievalOptions }> = []
	const handler = createChatHandler({
		retriever: {
			retrieveHybrid: async (query, options) => {
				calls.push({ query, options })

				return retrieve(query, options)
			},
		},
		env,
		identity: { userAgent: "test/1.0", sessionId: "test-session" },
	})

	return { handler, calls }
}

describe("buildSystemPrompt", () => {
	test("repeats the content and filter field descriptions from the schema", () => {
		const prompt = buildSystemPrompt()

		expect(prompt).toContain("slogan: Content field:")
		expect(prompt).toContain("annee: Filter field:")
		expect(prompt).toContain("marque: Filter field:")
	})
})

describe("searchSlogans", () => {
	test("calls the retriever and shapes the result for the model", async () => {
		const calls: Array<{ query: string; options?: RetrievalOptions }> = []
		const retriever = {
			retrieveHybrid: async (query: string, options?: RetrievalOptions) => {
				calls.push({ query, options })

				return [HIT]
			},
		}

		const result = await searchSlogans(retriever, {
			query: "sucre",
			topK: 3,
			yearFrom: 2004,
			yearTo: 2005,
		})

		expect(calls).toEqual([{ query: "sucre", options: { topK: 3, yearFrom: 2004, yearTo: 2005 } }])
		expect(result).toEqual([
			{ score: 0.5, annee: 2004, marque: "Danone", slogan: "Un peu de sucre" },
		])
	})
})

describe("createChatHandler", () => {
	test("returns a clear 500 when the API key is missing", async () => {
		const { handler, calls } = createTestHandler(async () => [HIT])
		const response = await handler(
			new Request("http://localhost/api/chat", {
				method: "POST",
				body: JSON.stringify({ messages: [{ role: "user", parts: [] }] }),
			}),
		)

		expect(response.status).toBe(500)
		expect(await response.json()).toEqual({
			error: "AI_API_KEY is not set; the chat endpoint needs an LLM provider.",
		})
		expect(calls).toEqual([])
	})

	test("rejects an empty message list with 400", async () => {
		const { handler } = createTestHandler(async () => [HIT], { AI_API_KEY: "test" })
		const response = await handler(
			new Request("http://localhost/api/chat", { method: "POST", body: JSON.stringify({}) }),
		)

		expect(response.status).toBe(400)
		expect(await response.json()).toEqual({
			error: 'Body must contain a non-empty "messages" array.',
		})
	})

	test("rejects a non-POST method with 405", async () => {
		const { handler } = createTestHandler(async () => [HIT])
		const response = await handler(new Request("http://localhost/api/chat"))

		expect(response.status).toBe(405)
	})

	test("answers a preflight request with 204", async () => {
		const { handler } = createTestHandler(async () => [HIT])
		const response = await handler(new Request("http://localhost/api/chat", { method: "OPTIONS" }))

		expect(response.status).toBe(204)
	})
})
