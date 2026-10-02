import { describe, expect, test } from "bun:test"
import { datasetConfigurations } from "./datasets"

describe("datasetConfigurations", () => {
	test("maps slogans to its corpus fields and keeps an empty campaign default", () => {
		const slogans = datasetConfigurations.slogans

		expect(slogans.filePath).toBe("datasets/slogans.txt")
		expect(slogans.contentField).toBe("slogan")
		expect(slogans.identifierField).toBe("id")
		expect(slogans.schema.properties.annee.title).toBe("Année")
		expect(slogans.defaults).toEqual({ campagne: "" })
	})

	test("maps citations to its corpus fields and quote content", () => {
		const citations = datasetConfigurations.citations

		expect(citations.filePath).toBe("datasets/citations.txt")
		expect(citations.contentField).toBe("quote")
		expect(citations.identifierField).toBe("id")
		expect(citations.schema.properties.year.title).toBe("year")
		expect(citations.defaults).toEqual({})
	})

	test("describes a slogan collection schema", () => {
		expect(datasetConfigurations.slogans.collectionSchema).toEqual({
			collection: "slogans",
			dense: { name: "dense", size: 1024, distance: "Cosine" },
			sparse: { name: "bm25", modifier: "idf" },
			payloadIndexes: [
				{ name: "annee", schema: "integer" },
				{ name: "marque", schema: "keyword" },
			],
		})
	})

	test("describes a citation collection schema with citation field names", () => {
		expect(datasetConfigurations.citations.collectionSchema).toEqual({
			collection: "citations",
			dense: { name: "dense", size: 1024, distance: "Cosine" },
			sparse: { name: "bm25", modifier: "idf" },
			payloadIndexes: [
				{ name: "author", schema: "keyword" },
				{ name: "work", schema: "keyword" },
				{ name: "year", schema: "integer" },
				{ name: "lang", schema: "keyword" },
			],
		})
	})
})
