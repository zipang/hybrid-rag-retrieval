import { describe, expect, test } from "bun:test"
import { normalizePunct } from "./normalize-fr"

describe("normalizePunct", () => {
	test("appends a period when the text has no terminal mark", () => {
		expect(normalizePunct("Il vient")).toBe("Il vient.")
	})

	test("keeps an existing terminal mark", () => {
		expect(normalizePunct("Il vient.")).toBe("Il vient.")
		expect(normalizePunct("Il vient ?")).toBe("Il vient ?")
		expect(normalizePunct("Il vient !")).toBe("Il vient !")
		expect(normalizePunct("Il vient…")).toBe("Il vient…")
	})

	test("collapses a run of periods into the ellipsis character", () => {
		expect(normalizePunct("Il vient...")).toBe("Il vient…")
		expect(normalizePunct("Il vient....")).toBe("Il vient…")
	})

	test("normalizes curly and straight double quotes to guillemets", () => {
		expect(normalizePunct("Il a dit “bonjour”")).toBe("Il a dit « bonjour ».")
		expect(normalizePunct('Il a dit "bonjour"')).toBe("Il a dit « bonjour ».")
	})

	test("adds the inner guillemet spaces", () => {
		expect(normalizePunct("«mot»")).toBe("« mot ».")
	})

	test("normalizes a typographic apostrophe to the straight apostrophe", () => {
		expect(normalizePunct("C’est bien")).toBe("C'est bien.")
	})

	test("normalizes the en and em dashes to the hyphen", () => {
		expect(normalizePunct("Il est arrivé – enfin – à midi")).toBe("Il est arrivé - enfin - à midi.")
		expect(normalizePunct("Il est arrivé — enfin — à midi")).toBe("Il est arrivé - enfin - à midi.")
	})

	test("turns any typographic space into one ASCII space", () => {
		expect(normalizePunct("Où\u00a0es-tu\u00a0?")).toBe("Où es-tu ?")
	})

	test("puts a space before a double punctuation mark", () => {
		expect(normalizePunct("Où es-tu?")).toBe("Où es-tu ?")
		expect(normalizePunct("Bonjour!")).toBe("Bonjour !")
		expect(normalizePunct("Attention; danger")).toBe("Attention ; danger.")
	})

	test("keeps the numeric colon of a time", () => {
		expect(normalizePunct("Le train de 18:30")).toBe("Le train de 18:30.")
	})

	test("removes the space before a period or a comma", () => {
		expect(normalizePunct("Il vient .")).toBe("Il vient.")
		expect(normalizePunct("Un chat , un chien")).toBe("Un chat, un chien.")
	})

	test("drops a character outside the French Latin set", () => {
		expect(normalizePunct("Bonjour 😀")).toBe("Bonjour.")
	})

	test("collapses whitespace runs", () => {
		expect(normalizePunct("Il   vient")).toBe("Il vient.")
	})

	test("returns an empty string for an empty or blank text", () => {
		expect(normalizePunct("")).toBe("")
		expect(normalizePunct("   ")).toBe("")
	})
})
