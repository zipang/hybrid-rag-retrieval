import { describe, expect, test } from "bun:test"
import { citationJsonSchema, validateCitation } from "./citation"
import { sloganJsonSchema, validateSlogan } from "./slogan"

describe("record models", () => {
	test("coerces slogan years and accepts a missing optional campaign", () => {
		const result = validateSlogan({
			id: "1",
			annee: "2004",
			marque: "Danone",
			slogan: "Un peu de sucre, beaucoup d'idées",
		})

		expect(result.error).toBeUndefined()
		expect(result.value).toEqual({
			id: 1,
			annee: 2004,
			marque: "Danone",
			slogan: "Un peu de sucre, beaucoup d'idées",
		})
	})

	test("rejects a slogan with an empty required field", () => {
		const result = validateSlogan({
			id: "1",
			annee: "2004",
			marque: "Danone",
			slogan: "",
		})

		expect(result.error).toBeDefined()
	})

	test("coerces citation years and accepts a blank translation", () => {
		const result = validateCitation({
			id: "3",
			author: "William Shakespeare",
			work: "Hamlet",
			year: "1603",
			lang: "fr",
			trad: "",
			quote: "Quelque chose est pourri dans l'État de Danemark",
		})

		expect(result.error).toBeUndefined()
		expect(result.value).toEqual({
			id: 3,
			author: "William Shakespeare",
			work: "Hamlet",
			year: 1603,
			lang: "fr",
			trad: "",
			quote: "Quelque chose est pourri dans l'État de Danemark",
		})
	})

	test("accepts a citation with an unknown year and an anonymous author", () => {
		const result = validateCitation({
			id: "7",
			author: "Anonymous",
			work: "Proverbes",
			lang: "fr",
			trad: "",
			quote: "Un proverbe sans date.",
		})

		expect(result.error).toBeUndefined()
		expect(result.value).toEqual({
			id: 7,
			author: "Anonymous",
			work: "Proverbes",
			lang: "fr",
			trad: "",
			quote: "Un proverbe sans date.",
		})
	})

	test("rejects a citation with a non-numeric year", () => {
		const result = validateCitation({
			id: "3",
			author: "William Shakespeare",
			work: "Hamlet",
			year: "unknown",
			lang: "fr",
			trad: "",
			quote: "Une citation",
		})

		expect(result.error).toBeDefined()
	})

	test("requires schema and field descriptions with an explicit usage role", () => {
		for (const recordSchema of [sloganJsonSchema, citationJsonSchema]) {
			expect(recordSchema.description?.trim()).toBeTruthy()

			for (const property of Object.values(recordSchema.properties)) {
				expect(property.description?.trim()).toBeTruthy()
				expect(property.description).toMatch(/^(Content field|Filter field|Record identifier):/)
			}
		}
	})

	test("declares source field labels in corpus order", () => {
		expect(Object.values(sloganJsonSchema.properties).map((property) => property.title)).toEqual([
			"Id",
			"Année",
			"Marque",
			"Campagne",
			"Slogan",
		])
		expect(Object.values(citationJsonSchema.properties).map((property) => property.title)).toEqual([
			"id",
			"author",
			"work",
			"year",
			"lang",
			"trad",
			"quote",
		])
	})
})
