import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { multivectorSimilarity } from "../scoring"
import { abstractTree } from "./abstraction"
import { DEFAULT_ENCODER_CONFIG, encodeTree } from "./encoder"
import type { ParsedText, ParsedToken } from "./parser"

/**
 * Integrity and judgment checks for the reviewed French syntax comparisons.
 *
 * This data set is the readable, growing replacement for the ranking cases of
 * `french.jsonc`. Each entry under `tests` names one query, the sentences that
 * share its grammatical shape (`equal`), and the sentences that do not
 * (`different`). Every sentence is stored once under `references`, keyed by the
 * sentence string itself, with its expected Universal Dependencies tree.
 *
 * A comparison is judged with the frozen coarse encoder:
 *
 * - an `equal` sentence must score the identical structure (`>= 1`);
 * - a `different` sentence must score below the identical structure (`< 1`).
 *
 * The tests fail on a missing reference or on a broken judgment. They never
 * load the parser model: the trees are the frozen input.
 */

/** One CoNLL-U token as stored in the references. */
type Token = string[]

/** One text entry: the expected sentence trees. */
type TextEntry = { sentences: Token[][] }

/** One comparison: a query, its equal sentences, and its different sentences. */
type Comparison = {
	query: string
	equal: string[]
	different: string[]
}

/** The shape of the comparison data set file. */
type Dataset = {
	tests: Comparison[]
	references: Record<string, TextEntry>
}

/** The score at or above which two trees count as identical. */
const IDENTICAL_SCORE = 0.999999

/** Read and parse the comparison data set. */
const loadDataset = (): Dataset => {
	const path = join(import.meta.dir, "test-data", "french-dataset.jsonc")

	return Bun.JSONC.parse(readFileSync(path, "utf8")) as Dataset
}

/** Read the value of one CoNLL-U field of a token. */
const field = (token: Token, index: number): string => token[index] ?? ""

/** Read the universal word class of a token. */
const upos = (token: Token): string => field(token, 2)

/** Read the governor position of a token. A root has `HEAD` zero. */
const head = (token: Token): number => Number.parseInt(field(token, 3), 10)

/** Encode one reference text with the coarse mode into one vector per sentence. */
const encode = (entry: TextEntry): number[][] => {
	const parsed: ParsedText = {
		sentences: entry.sentences.map((sentence) =>
			sentence.map((token) => [...token] as ParsedToken),
		),
	}

	return encodeTree(abstractTree(parsed, "coarse"), DEFAULT_ENCODER_CONFIG).map(
		(vector) => vector.values,
	)
}

describe("french comparison data set", () => {
	const data = loadDataset()
	const references = new Map(Object.entries(data.references))

	test("names a query, an equal set, and a different set for every comparison", () => {
		expect(data.tests.length).toBeGreaterThan(0)

		for (const comparison of data.tests) {
			expect(comparison.query.trim().length).toBeGreaterThan(0)
			expect(comparison.equal.length).toBeGreaterThan(0)
			expect(comparison.different.length).toBeGreaterThan(0)
		}
	})

	test("resolves every comparison text reference", () => {
		for (const comparison of data.tests) {
			const references_ = [
				["query", comparison.query],
				...comparison.equal.map((text) => ["equal", text] as const),
				...comparison.different.map((text) => ["different", text] as const),
			] as const

			for (const [role, text] of references_) {
				const present = references.has(text)

				expect(
					present,
					`${role} Test string ${JSON.stringify(text)} is not present in the indexed references keys`,
				).toBe(true)
			}
		}
	})

	test("gives every token exactly one value per reference field", () => {
		for (const [text, entry] of references) {
			for (const tokens of entry.sentences) {
				for (const token of tokens) {
					expect({ text, width: token.length }).toEqual({ text, width: 6 })
				}
			}
		}
	})

	test("keeps every governor inside the sentence range", () => {
		for (const [text, entry] of references) {
			for (const tokens of entry.sentences) {
				const size = tokens.length

				for (const token of tokens) {
					const parent = head(token)

					expect({ text, parent }).toEqual({ text, parent })
					expect(parent).toBeGreaterThanOrEqual(0)
					expect(parent).toBeLessThanOrEqual(size)
				}
			}
		}
	})

	test("gives every reference sentence at least one root", () => {
		for (const [text, entry] of references) {
			for (const tokens of entry.sentences) {
				const roots = tokens.filter((token) => head(token) === 0)

				expect(roots.length, `${text} has no root`).toBeGreaterThanOrEqual(1)
			}
		}
	})

	test("reaches a root from every token without a cycle", () => {
		for (const [text, entry] of references) {
			for (const tokens of entry.sentences) {
				tokens.forEach((_, start) => {
					const seen = new Set<number>()
					let current = start + 1

					while (current !== 0) {
						expect(seen.has(current), `${text} has a cycle at token ${current}`).toBe(false)
						seen.add(current)
						current = head(tokens[current - 1] ?? [])
					}
				})
			}
		}
	})

	test("gives no content word a punctuation governor", () => {
		for (const [text, entry] of references) {
			for (const tokens of entry.sentences) {
				tokens.forEach((token) => {
					const parent = head(token)

					if (parent === 0) {
						return
					}

					expect(upos(tokens[parent - 1] ?? []), `${text} token ${field(token, 0)}`).not.toBe(
						"PUNCT",
					)
				})
			}
		}
	})

	test("scores every equal sentence at the identical structure", () => {
		for (const comparison of data.tests) {
			const query = references.get(comparison.query)

			if (query === undefined) {
				continue
			}

			const queryVectors = encode(query)

			for (const text of comparison.equal) {
				const entry = references.get(text)

				if (entry === undefined) {
					continue
				}

				const score = multivectorSimilarity(queryVectors, encode(entry))

				expect(
					score,
					`equal ${JSON.stringify(text)} for ${JSON.stringify(comparison.query)}`,
				).toBeGreaterThanOrEqual(IDENTICAL_SCORE)
			}
		}
	})

	test("scores every different sentence below the identical structure", () => {
		for (const comparison of data.tests) {
			const query = references.get(comparison.query)

			if (query === undefined) {
				continue
			}

			const queryVectors = encode(query)

			for (const text of comparison.different) {
				const entry = references.get(text)

				if (entry === undefined) {
					continue
				}

				const score = multivectorSimilarity(queryVectors, encode(entry))

				expect(
					score,
					`different ${JSON.stringify(text)} for ${JSON.stringify(comparison.query)}`,
				).toBeLessThan(IDENTICAL_SCORE)
			}
		}
	})
})
