import { describe, expect, test } from "bun:test"
import { extractEnglishCitations, extractFrenchCitations, parseFrenchHeading } from "./extract"
import { cleanText } from "./wikitext"

describe("wikitext cleaning", () => {
	test("removes links, emphasis, inline templates, and leading dialogue marks", () => {
		const cleaned = cleanText(": '''[[Victor Hugo|Hugo]]''' dit {{w|Paris}} <ref>note</ref>.")

		expect(cleaned).toBe("Hugo dit Paris .")
	})
})

describe("french extraction", () => {
	test("reads author, work, and year from a citation and its reference", () => {
		const page = [
			"== Poésie ==",
			"=== ''Les Orientales'', 1829 ===",
			"{{citation|citation=<poem>L'Alhambra ! l'Alhambra ! palais que les Génies</poem>}}",
			"{{Réf Livre|titre=Les Orientales|auteur=Victor Hugo|éditeur=C. Gosselin|année=1829|page=292}}",
		].join("\n")

		const citations = extractFrenchCitations(page, "Victor Hugo")

		expect(citations).toHaveLength(1)
		expect(citations[0]).toEqual({
			author: "Victor Hugo",
			work: "Les Orientales",
			year: 1829,
			lang: "fr",
			trad: "",
			quote: "L'Alhambra ! l'Alhambra ! palais que les Génies",
		})
	})

	test("reads the heading author on a theme page and prefers the original year", () => {
		const page = [
			"== Littérature ==",
			"==== [[Marie d'Agoult]], ''Nélida'', 1866 ====",
			"{{Citation|citation=Ô saint orgueil des chastetés délicates.}}",
			"{{Réf Livre|titre=Nélida|auteur=[[Marie d'Agoult]]|année=2010|année d'origine=1866}}",
		].join("\n")

		const citations = extractFrenchCitations(page, "Courage")

		expect(citations[0].author).toBe("Marie d'Agoult")
		expect(citations[0].work).toBe("Nélida")
		expect(citations[0].year).toBe(1866)
	})

	test("does not treat an italic work title in a heading as an author", () => {
		const heading = parseFrenchHeading("''[[La Résistible Ascension d'Arturo Ui]]''")

		expect(heading.author).toBe("")
		expect(heading.work).toBe("La Résistible Ascension d'Arturo Ui")
	})
})

describe("english extraction", () => {
	const shakespearePage = [
		"== Quotes ==",
		"=== ''Hamlet'' (1600–1) ===",
		"* To be or not to be, that is the question.",
		"** '''Hamlet,''' Act III, scene i.",
	].join("\n")

	test("reads work and year from the section heading", () => {
		const citations = extractEnglishCitations(shakespearePage, "William Shakespeare")

		expect(citations[0]).toEqual({
			author: "William Shakespeare",
			work: "Hamlet",
			year: 1600,
			lang: "en",
			trad: "",
			quote: "To be or not to be, that is the question.",
		})
	})

	test("reads the attributed author on a theme page", () => {
		const page = [
			"== Quotes ==",
			"* Well done is better than well said.",
			"** [[Benjamin Franklin]], ''Poor Richard's Almanack'' (1737).",
		].join("\n")

		const citations = extractEnglishCitations(page, "Honesty", { attributed: true })

		expect(citations[0].author).toBe("Benjamin Franklin")
		expect(citations[0].work).toBe("Poor Richard's Almanack")
		expect(citations[0].year).toBe(1737)
	})

	test("never reads the author from a link inside the quote body", () => {
		const page = [
			"=== ''Tlön, Uqbar, Orbis Tertius'' (1940) ===",
			"* All men who repeat one line of Shakespeare ''are'' [[William Shakespeare]].",
			"** Variant: today, the churches of Tlön maintain the same idea.",
		].join("\n")

		const byPage = extractEnglishCitations(page, "Jorge Luis Borges")
		const attributed = extractEnglishCitations(page, "Jorge Luis Borges", { attributed: true })

		expect(byPage[0].author).toBe("Jorge Luis Borges")
		expect(attributed[0].author).toBe("")
	})
})
