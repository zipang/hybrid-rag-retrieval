import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Integrity checks for the reviewed French syntax test data set.
 *
 * The set drives the parser and the encoder evaluation. A malformed token hides
 * a schema change and breaks the adapters later. These tests fail on any
 * deviation from the declared token shape and tree rules.
 *
 * The file keys every text by its own sentence. A reference to a text is the
 * sentence string itself, so a reader sees what a case compares.
 */

/** One CoNLL-U token as stored in the test data set. */
type Token = string[]

/** One text entry: the expected sentence trees. */
type TextEntry = {
	sentences: Token[][]
}

/** One structural pair: two texts and the expected relation per mode. */
type StructuralPair = {
	id: string
	a: string
	b: string
	mode: string
	relation: string
}

/** The shape of the test data set file. */
type TestData = {
	version: number
	language: string
	tokenFields: string[]
	modeFeatures: string[]
	texts: Record<string, TextEntry>
	structuralPairs: StructuralPair[]
	split: { development: string[]; heldOut: string[] }
}

/** Read and parse the reviewed test data set. */
const loadTestData = (): TestData => {
	const path = join(import.meta.dir, "test-data", "french.jsonc")
	const raw = readFileSync(path, "utf8")

	return Bun.JSONC.parse(raw) as TestData
}

/** Read the value of one CoNLL-U field of a token. */
const field = (token: Token, index: number): string => token[index] ?? ""

/** Read the universal word class of a token. */
const upos = (token: Token): string => field(token, 2)

/** Read the governor position of a token. A root has `HEAD` zero. */
const head = (token: Token): number => Number.parseInt(field(token, 3), 10)

/** Every text of the data set as `[sentence, entry]` pairs. */
const entries = (data: TestData): Array<[string, TextEntry]> => Object.entries(data.texts)

describe("french test data set", () => {
	const data = loadTestData()
	const width = data.tokenFields.length

	test("declares a language and a token shape", () => {
		expect(data.language).toBe("fr")
		expect(data.tokenFields).toEqual(["form", "lemma", "upos", "head", "deprel", "feats"])
	})

	test("gives every token exactly one value per declared field", () => {
		for (const [sentence, entry] of entries(data)) {
			for (const tokens of entry.sentences) {
				for (const token of tokens) {
					expect({ sentence, width: token.length }).toEqual({ sentence, width })
				}
			}
		}
	})

	test("keys every text by a nonempty sentence", () => {
		for (const [sentence, entry] of entries(data)) {
			expect(sentence.trim().length).toBeGreaterThan(0)
			expect(entry.sentences.length).toBeGreaterThan(0)
		}
	})

	test("keeps every governor inside the sentence range", () => {
		for (const [sentence, entry] of entries(data)) {
			for (const tokens of entry.sentences) {
				const size = tokens.length

				for (const token of tokens) {
					const parent = head(token)

					expect({ sentence, parent }).toEqual({ sentence, parent })
					expect(parent).toBeGreaterThanOrEqual(0)
					expect(parent).toBeLessThanOrEqual(size)
				}
			}
		}
	})

	test("gives every sentence at least one root", () => {
		for (const entry of Object.values(data.texts)) {
			for (const tokens of entry.sentences) {
				const roots = tokens.filter((token) => head(token) === 0)

				expect(roots.length).toBeGreaterThanOrEqual(1)
			}
		}
	})

	test("reaches a root from every token without a cycle", () => {
		for (const entry of Object.values(data.texts)) {
			for (const tokens of entry.sentences) {
				tokens.forEach((_, start) => {
					const seen = new Set<number>()
					let current = start + 1

					while (current !== 0) {
						expect(seen.has(current)).toBe(false)
						seen.add(current)
						current = head(tokens[current - 1] ?? [])
					}
				})
			}
		}
	})

	test("uses a nonempty word class for every token", () => {
		for (const entry of Object.values(data.texts)) {
			for (const tokens of entry.sentences) {
				for (const token of tokens) {
					expect(upos(token).length).toBeGreaterThan(0)
				}
			}
		}
	})

	test("gives no content word a punctuation governor", () => {
		// A punctuation token cannot govern a content word. The abstraction
		// removes punctuation, so such a link would break the tree.
		for (const entry of Object.values(data.texts)) {
			for (const tokens of entry.sentences) {
				tokens.forEach((token) => {
					const parent = head(token)

					if (parent === 0) {
						return
					}

					const governor = tokens[parent - 1]

					expect(upos(governor ?? [])).not.toBe("PUNCT")
				})
			}
		}
	})

	test("resolves every structural-pair text reference", () => {
		const keys = new Set(Object.keys(data.texts))

		for (const pair of data.structuralPairs) {
			for (const [role, reference] of [
				["a", pair.a],
				["b", pair.b],
			] as const) {
				const present = keys.has(reference)

				expect(
					present,
					`${role} Test string ${JSON.stringify(reference)} is not present in the indexed texts keys (pair ${pair.id})`,
				).toBe(true)
			}
		}
	})

	test("partitions every evaluation case into the split exactly once", () => {
		const caseIds = data.structuralPairs.map((pair) => pair.id)
		const splitIds = [...data.split.development, ...data.split.heldOut]

		expect(new Set(splitIds).size).toBe(splitIds.length)
		expect(splitIds.length).toBe(caseIds.length)

		for (const id of caseIds) {
			expect(splitIds.includes(id)).toBe(true)
		}
	})
})
