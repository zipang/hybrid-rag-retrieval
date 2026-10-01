import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Point } from "../src/lib/qdrant"
import { indexSlogans } from "./index-slogans"

const REJECTED_BLOCK_CORPUS = [
	"Id: 1",
	"Année: twenty",
	"Marque: Brand A",
	"Slogan: Invalid year",
	"---",
	"Id: 2",
	"Année: 2004",
	"Marque: Danone",
	"Slogan: Un peu de sucre",
	"---",
].join("\n")

const THREE_VALID_BLOCKS_CORPUS = [
	"Id: 10",
	"Année: 2004",
	"Marque: Brand A",
	"Slogan: Premier",
	"---",
	"Id: 11",
	"Année: 2005",
	"Marque: Brand B",
	"Slogan: Deuxième",
	"---",
	"Id: 12",
	"Année: 2006",
	"Marque: Brand C",
	"Slogan: Troisième",
	"---",
].join("\n")

/** Write a temporary corpus, run the callback, then remove the directory. */
const withCorpus = async (content: string, run: (filePath: string) => Promise<void>) => {
	const directory = await mkdtemp(join(tmpdir(), "slogans-"))
	const filePath = join(directory, "slogans.txt")
	await writeFile(filePath, content, "utf8")

	try {
		await run(filePath)
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
}

/** Create fake dependencies that record calls, points, and log messages. */
const createFakes = () => {
	const calls: string[] = []
	const upserts: Point[][] = []
	const messages: string[] = []

	return {
		calls,
		upserts,
		messages,
		dependencies: {
			client: {
				deleteCollection: async () => {
					calls.push("deleteCollection")
				},
				ensureCollection: async () => {
					calls.push("ensureCollection")

					return true
				},
				upsert: async (points: Point[]) => {
					calls.push("upsert")
					upserts.push(points)
				},
			},
			embedder: {
				embedDenseDocuments: async (texts: string[]) => texts.map((text) => [text.length, 1]),
			},
			bm25: { language: "french", ascii_folding: true, avg_len: 7 },
			log: (message: string) => {
				messages.push(message)
			},
		},
	}
}

describe("indexSlogans", () => {
	test("logs a rejected block and indexes the following record", async () => {
		await withCorpus(REJECTED_BLOCK_CORPUS, async (filePath) => {
			const fakes = createFakes()
			const summary = await indexSlogans(fakes.dependencies, { filePath })

			expect(summary).toEqual({ accepted: 1, rejected: 1, indexed: 1 })
			expect(
				fakes.messages.some((message) => message.startsWith(`Rejected block 1 in ${filePath}:`)),
			).toBe(true)
			expect(fakes.calls).toEqual(["deleteCollection", "ensureCollection", "upsert"])

			const points = fakes.upserts[0] ?? []
			expect(points).toHaveLength(1)
			expect(points[0]).toEqual({
				id: 2,
				vector: {
					dense: ["Un peu de sucre".length, 1],
					bm25: {
						text: "Un peu de sucre",
						model: "qdrant/bm25",
						options: { language: "french", ascii_folding: true, avg_len: 7 },
					},
				},
				payload: {
					id: 2,
					annee: 2004,
					marque: "Danone",
					campagne: "",
					slogan: "Un peu de sucre",
				},
			})
		})
	})

	test("stops after the requested limit and truncates the batch", async () => {
		await withCorpus(THREE_VALID_BLOCKS_CORPUS, async (filePath) => {
			const fakes = createFakes()
			const summary = await indexSlogans(fakes.dependencies, { filePath, limit: 2 })

			expect(summary).toEqual({ accepted: 2, rejected: 0, indexed: 2 })
			expect(fakes.upserts.flat()).toHaveLength(2)
			expect(fakes.upserts.flat().map((point) => point.id)).toEqual([10, 11])
		})
	})

	test("rejects a non-numeric record identifier as an invalid block", async () => {
		const corpus = ["Id: abc", "Année: 2004", "Marque: Brand", "Slogan: Texte", "---"].join("\n")

		await withCorpus(corpus, async (filePath) => {
			const fakes = createFakes()
			const summary = await indexSlogans(fakes.dependencies, { filePath })

			expect(summary).toEqual({ accepted: 0, rejected: 1, indexed: 0 })
			expect(
				fakes.messages.some((message) => message.startsWith(`Rejected block 1 in ${filePath}:`)),
			).toBe(true)
			expect(fakes.upserts).toEqual([])
		})
	})
})
