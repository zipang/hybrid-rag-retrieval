import { describe, expect, test } from "bun:test"
import { buildEmbedder, createEmbedder, type DenseModel } from "./embedder"

describe("buildEmbedder", () => {
	const dense: DenseModel = {
		passageEmbed: async function* (texts) {
			yield texts.map((text) => [text.length, 0])
		},
		queryEmbed: async (query) => [query.length, 0],
	}

	test("delegates documents and queries to the dense model", async () => {
		const embedder = buildEmbedder(dense, 2)

		expect(embedder.dims).toBe(2)
		expect(await embedder.embedDenseDocuments(["ab", "cde"])).toEqual([
			[2, 0],
			[3, 0],
		])
		expect(await embedder.embedDenseQuery("abcd")).toEqual([4, 0])
	})

	test("flattens batches into a single document list", async () => {
		const batched: DenseModel = {
			passageEmbed: async function* (texts) {
				for (const text of texts) {
					yield [[text.length]]
				}
			},
			queryEmbed: async (query) => [query.length],
		}

		const embedder = buildEmbedder(batched, 1)

		expect(await embedder.embedDenseDocuments(["a", "bb", "ccc"])).toEqual([[1], [2], [3]])
	})
})

describe("createEmbedder", () => {
	test("rejects an unknown provider", async () => {
		await expect(createEmbedder({ EMBEDDING_PROVIDER: "does-not-exist" })).rejects.toThrow(
			/Unknown embedding provider/,
		)
	})

	test("asks for the API key of a cloud provider", async () => {
		await expect(createEmbedder({ EMBEDDING_PROVIDER: "openai" })).rejects.toThrow(
			/requires EMBEDDING_API_KEY/,
		)
	})

	test("reports the missing cloud adapter when a key is present", async () => {
		await expect(
			createEmbedder({ EMBEDDING_PROVIDER: "voyage", EMBEDDING_API_KEY: "secret" }),
		).rejects.toThrow(/no adapter/)
	})
})
