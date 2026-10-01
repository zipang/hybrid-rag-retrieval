import { describe, expect, test } from "bun:test"
import { bm25Options } from "./bm25"

describe("bm25Options", () => {
	test("maps the environment variables to Qdrant options", () => {
		const options = bm25Options({
			BM25_LANGUAGE: "french",
			BM25_ASCII_FOLDING: "true",
			BM25_AVG_LEN: "7",
		})

		expect(options).toEqual({ language: "french", ascii_folding: true, avg_len: 7 })
	})

	test("returns an empty object for an empty environment", () => {
		expect(bm25Options()).toEqual({})
	})

	test("parses ascii_folding as a boolean and avg_len as a number", () => {
		const options = bm25Options({ BM25_ASCII_FOLDING: "false", BM25_AVG_LEN: "6.91" })

		expect(options).toEqual({ ascii_folding: false, avg_len: 6.91 })
	})

	test("skips blank and non-numeric values", () => {
		expect(bm25Options({ BM25_LANGUAGE: "", BM25_AVG_LEN: "many" })).toEqual({})
	})
})
