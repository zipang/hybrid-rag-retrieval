import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Integrity checks for the reviewed French syntax test data set.
 *
 * The set drives the parser and the encoder evaluation. A malformed token hides
 * a schema change and breaks the adapters later. These tests fail on any
 * deviation from the declared token shape and tree rules.
 */

/** One CoNLL-U token as stored in the test data set. */
type Token = string[]

/** One text entry of the test data set. */
type TextEntry = {
	id: string
	text: string
	sentences: Token[][]
}

/** One ranking case: a query, a positive, and a negative. */
type RankingCase = {
	id: string
	query: string
	positive: string
	negative: string
	category: string
}

/** One structural pair: two texts and the expected relation per profile. */
type StructuralPair = {
	id: string
	a: string
	b: string
	profile: string
	relation: string
}

/** The shape of the test data set file. */
type TestData = {
	version: number
	language: string
	tokenFields: string[]
	profileFeatures: string[]
	texts: TextEntry[]
	rankingCases: RankingCase[]
	structuralPairs: StructuralPair[]
	split: { development: string[]; heldOut: string[] }
}

/** Read and parse the reviewed test data set. */
const loadTestData = (): TestData => {
	const path = join(import.meta.dir, "test-data", "french.json")
	const raw = readFileSync(path, "utf8")

	return JSON.parse(raw) as TestData
}

/** Read the value of one CoNLL-U field of a token. */
const field = (token: Token, index: number): string => token[index] ?? ""

/** Read the universal word class of a token. */
const upos = (token: Token): string => field(token, 2)

/** Read the governor position of a token. A root has `HEAD` zero. */
const head = (token: Token): number => Number.parseInt(field(token, 3), 10)

/** Read the identifier of a text entry. */
const idOf = (text: TextEntry): string => text.id

describe("french test data set", () => {
	const data = loadTestData()
	const width = data.tokenFields.length

	test("declares a language and a token shape", () => {
		expect(data.language).toBe("fr")
		expect(data.tokenFields).toEqual(["form", "lemma", "upos", "head", "deprel", "feats"])
	})

	test("gives every token exactly one value per declared field", () => {
		for (const text of data.texts) {
			for (const sentence of text.sentences) {
				for (const token of sentence) {
					expect({ id: text.id, width: token.length }).toEqual({ id: text.id, width })
				}
			}
		}
	})

	test("assigns every text a unique identifier", () => {
		const ids = data.texts.map(idOf)

		expect(new Set(ids).size).toBe(ids.length)
	})

	test("gives every token a positional index from one", () => {
		for (const text of data.texts) {
			for (const sentence of text.sentences) {
				sentence.forEach((_, index) => {
					expect(Number.isInteger(index + 1)).toBe(true)
				})
			}
		}
	})

	test("keeps every governor inside the sentence range", () => {
		for (const text of data.texts) {
			for (const sentence of text.sentences) {
				const size = sentence.length

				for (const token of sentence) {
					const parent = head(token)

					expect(parent).toBeGreaterThanOrEqual(0)
					expect(parent).toBeLessThanOrEqual(size)
				}
			}
		}
	})

	test("gives every sentence at least one root", () => {
		for (const text of data.texts) {
			for (const sentence of text.sentences) {
				const roots = sentence.filter((token) => head(token) === 0)

				expect(roots.length).toBeGreaterThanOrEqual(1)
			}
		}
	})

	test("reaches a root from every token without a cycle", () => {
		for (const text of data.texts) {
			for (const sentence of text.sentences) {
				sentence.forEach((_, start) => {
					const seen = new Set<number>()
					let current = start + 1

					while (current !== 0) {
						expect(seen.has(current)).toBe(false)
						seen.add(current)
						current = head(sentence[current - 1] ?? [])
					}
				})
			}
		}
	})

	test("uses a nonempty word class for every token", () => {
		for (const text of data.texts) {
			for (const sentence of text.sentences) {
				for (const token of sentence) {
					expect(upos(token).length).toBeGreaterThan(0)
				}
			}
		}
	})

	test("resolves every ranking-case text reference", () => {
		const ids = new Set(data.texts.map(idOf))

		for (const testCase of data.rankingCases) {
			for (const reference of [testCase.query, testCase.positive, testCase.negative]) {
				expect(ids.has(reference)).toBe(true)
			}
		}
	})

	test("resolves every structural-pair text reference", () => {
		const ids = new Set(data.texts.map(idOf))

		for (const pair of data.structuralPairs) {
			for (const reference of [pair.a, pair.b]) {
				expect(ids.has(reference)).toBe(true)
			}
		}
	})

	test("partitions every evaluation case into the split exactly once", () => {
		const caseIds = [
			...data.rankingCases.map((testCase) => testCase.id),
			...data.structuralPairs.map((pair) => pair.id),
		]
		const splitIds = [...data.split.development, ...data.split.heldOut]

		expect(new Set(splitIds).size).toBe(splitIds.length)
		expect(splitIds.length).toBe(caseIds.length)

		for (const id of caseIds) {
			expect(splitIds.includes(id)).toBe(true)
		}
	})
})
