import { describe, expect, test } from "bun:test"
import { countSentences, isAcceptableQuote, MAX_QUOTE_SENTENCES } from "./pages"
import type { RawCitation } from "./wikitext"

/** Build a minimal citation for the quote length tests. */
const citation = (quote: string): RawCitation => ({
	author: "Anonymous",
	work: "Test",
	year: undefined,
	lang: "en",
	trad: "",
	quote,
})

describe("countSentences", () => {
	test("counts plain sentences", () => {
		expect(countSentences("To be, or not to be: that is the question.")).toBe(1)
		expect(countSentences("First. Second. Third.")).toBe(3)
		expect(countSentences("First. Second. Third. Fourth.")).toBe(4)
	})

	test("ignores abbreviations, initials, and decimals", () => {
		expect(countSentences("Mr. H. G. Wells wrote this in 1895. It changed things.")).toBe(2)
		expect(countSentences("Pi is about 3.14159 and that is enough.")).toBe(1)
	})

	test("treats text without terminal punctuation as one sentence", () => {
		expect(countSentences("A quote without an ending mark")).toBe(1)
	})
})

describe("isAcceptableQuote", () => {
	test("accepts a short quote of up to three sentences", () => {
		expect(isAcceptableQuote(citation("This is one complete sentence."))).toBe(true)
		expect(isAcceptableQuote(citation("This is one sentence. And this is another one."))).toBe(true)
		expect(
			isAcceptableQuote(citation("One sentence here. Two sentences now. Three sentences done.")),
		).toBe(true)
	})

	test("rejects a quote with more than three sentences", () => {
		expect(MAX_QUOTE_SENTENCES).toBe(3)
		expect(
			isAcceptableQuote(
				citation("One sentence here. Two sentences now. Three sentences done. Four and out."),
			),
		).toBe(false)
	})

	test("rejects a quote that is too long or too short", () => {
		expect(isAcceptableQuote(citation("Too short"))).toBe(false)
		expect(isAcceptableQuote(citation(`${"word ".repeat(140)}`))).toBe(false)
	})
})
