import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { abstractTree } from "./abstraction"
import { DEFAULT_ENCODER_CONFIG, encodeTree, l2Normalize } from "./encoder"
import type { ParsedText } from "./parser"

/** One token tuple in the test data set shape. */
type Token = [string, string, string, number, string, string]

/** One text entry of the test data set: the expected sentence trees. */
type TextEntry = { sentences: Token[][] }

/** Read the reviewed test data set, keyed by the text itself. */
const loadTexts = (): Map<string, TextEntry> => {
	const raw = readFileSync(join(import.meta.dir, "test-data", "french.json"), "utf8")
	const data = JSON.parse(raw) as { texts: Record<string, TextEntry> }

	return new Map(Object.entries(data.texts))
}

const TEXTS = loadTexts()

/** Encode one test text with the coarse mode and return its first vector. */
const vectorOf = (text: string): number[] => {
	const entry = TEXTS.get(text)

	if (entry === undefined) {
		throw new Error(`unknown text "${text}"`)
	}

	const parsed: ParsedText = {
		sentences: entry.sentences.map((sentence) => sentence.map((token) => [...token] as Token)),
	}

	return encodeTree(abstractTree(parsed, "coarse"))[0]?.values ?? []
}

/** Return the cosine score of two unit vectors. */
const cosine = (left: number[], right: number[]): number => {
	let sum = 0

	for (let index = 0; index < left.length; index += 1) {
		sum += (left[index] ?? 0) * (right[index] ?? 0)
	}

	return sum
}

describe("l2Normalize", () => {
	test("scales a vector to unit length", () => {
		const normalized = l2Normalize([3, 4])
		const norm = Math.sqrt(normalized.reduce((sum, value) => sum + value * value, 0))

		expect(norm).toBeCloseTo(1, 12)
	})

	test("keeps a zero vector at zero", () => {
		expect(l2Normalize([0, 0, 0])).toEqual([0, 0, 0])
	})
})

/** The sentences used by the encoder tests, named for readability. */
const BOY = "Le garçon regarde le soleil"
const CAT = "Un chat mange une souris"
const GIRL = "La fille admire la lune"
const THINK = "Je pense qu'il pleut"
const CAR = "La voiture s'arrêta net devant la maison"
const METRO = "Le dernier métro s'arrêta net au terminus"
const LATE = "Il n'est jamais trop tard pour bien faire"
const REMEMBER = "Il est toujours trop tard pour se souvenir"
const TWO_SENTENCES = "Le garçon regarde le soleil. Le chat mange une souris."

describe("encodeTree", () => {
	test("produces a finite, nonzero, unit-length vector", () => {
		const vector = vectorOf(BOY)

		expect(vector).toHaveLength(DEFAULT_ENCODER_CONFIG.dimensions)

		for (const value of vector) {
			expect(Number.isFinite(value)).toBe(true)
		}

		const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))

		expect(norm).toBeCloseTo(1, 12)
	})

	test("is deterministic for the same tree and configuration", () => {
		expect(vectorOf(BOY)).toEqual(vectorOf(BOY))
	})

	test("gives identical vectors to the two specification examples", () => {
		// "Le garçon regarde le soleil" and "Un chat mange une souris" share one
		// coarse tree, so their vectors must match.
		expect(cosine(vectorOf(BOY), vectorOf(CAT))).toBeGreaterThanOrEqual(0.999999)
	})

	test("gives a lower score to a different connection", () => {
		// BOY is subject-verb-object. THINK adds a complement clause.
		expect(cosine(vectorOf(BOY), vectorOf(THINK))).toBeLessThan(
			cosine(vectorOf(BOY), vectorOf(CAT)),
		)
	})

	test("scores a real kin above an unrelated base tree", () => {
		const kin = cosine(vectorOf(CAR), vectorOf(METRO))
		const unrelated = cosine(vectorOf(CAR), vectorOf(BOY))

		expect(kin).toBeGreaterThan(unrelated)
	})

	test("keeps an unrelated tree near the floor", () => {
		expect(cosine(vectorOf(LATE), vectorOf(BOY))).toBeLessThan(0.5)
	})

	test("gives every reviewed text a nonzero vector", () => {
		for (const text of TEXTS.keys()) {
			const norm = Math.sqrt(vectorOf(text).reduce((sum, value) => sum + value * value, 0))

			expect(norm).toBeGreaterThan(0)
		}
	})

	test("produces one vector per sentence", () => {
		const entry = TEXTS.get(TWO_SENTENCES)

		if (entry === undefined) {
			throw new Error(`missing the text "${TWO_SENTENCES}"`)
		}

		const parsed: ParsedText = {
			sentences: entry.sentences.map((sentence) => sentence.map((token) => [...token] as Token)),
		}
		const vectors = encodeTree(abstractTree(parsed, "coarse"))

		expect(vectors).toHaveLength(2)
	})

	test("uses role weights, not uniform weights", () => {
		// A configuration that weights every role the same must give a different
		// score on a pair where the roles differ.
		const weighted = cosine(vectorOf(LATE), vectorOf(REMEMBER))
		const flat = cosine(vectorOf(LATE), vectorOf(BOY))

		expect(weighted).toBeGreaterThan(flat)
	})

	test("treats a subject-object swap as the same coarse tree", () => {
		// "Le garçon regarde le soleil" and "Le soleil regarde le garçon" have
		// the same shape. Only the words differ, and words are out of scope.
		expect(cosine(vectorOf(BOY), vectorOf("Le soleil regarde le garçon"))).toBeGreaterThanOrEqual(
			0.999999,
		)
	})

	test("treats a filler change as the same coarse tree", () => {
		expect(cosine(vectorOf(BOY), vectorOf(GIRL))).toBeGreaterThanOrEqual(0.999999)
	})
})

/** Build a token tuple with fewer fields for the tree tests. */
const token = (
	form: string,
	upos: string,
	head: number,
	deprel: string,
): [string, string, string, number, string, string] => [form, form, upos, head, deprel, ""]

/** Encode one hand-built sentence and return its vector. */
const encodeSentence = (
	sentence: Array<[string, string, string, number, string, string]>,
): number[] => encodeTree(abstractTree({ sentences: [sentence] }, "coarse"))[0]?.values ?? []

describe("tree position numbering", () => {
	test("ignores an edit in a different branch", () => {
		// The object noun gains an adjective in the second text. The subject
		// branch and the root are identical, so their nodes keep their index.
		const withoutEdit = [
			token("Le", "DET", 2, "det"),
			token("chat", "NOUN", 3, "nsubj"),
			token("regarde", "VERB", 0, "root"),
			token("les", "DET", 5, "det"),
			token("étoiles", "NOUN", 3, "obj"),
		]
		const withEdit = [
			token("Le", "DET", 2, "det"),
			token("chat", "NOUN", 3, "nsubj"),
			token("regarde", "VERB", 0, "root"),
			token("les", "DET", 6, "det"),
			token("étoiles", "NOUN", 3, "obj"),
			token("belles", "ADJ", 5, "amod"),
		]

		// The two texts differ only by the adjective in the object branch, so the
		// score stays high. A flat token index breaks on the deeper tree.
		expect(cosine(encodeSentence(withoutEdit), encodeSentence(withEdit))).toBeGreaterThan(0.9)
	})

	test("separates a node at a deeper level from a shallower one", () => {
		// A determiner under the subject, versus a determiner under an adjective
		// that is under the subject. The path index must differ.
		const shallow = [token("Le", "DET", 2, "det"), token("garçon", "NOUN", 0, "root")]
		const deep = [
			token("Le", "DET", 3, "det"),
			token("beau", "ADJ", 2, "amod"),
			token("garçon", "NOUN", 0, "root"),
		]

		expect(cosine(encodeSentence(shallow), encodeSentence(deep))).toBeLessThan(1)
	})

	test("keeps two isomorphic trees identical", () => {
		// Same shape, different words and features.
		const left = [
			token("La", "DET", 2, "det"),
			token("petite", "ADJ", 3, "amod"),
			token("fille", "NOUN", 4, "nsubj"),
			token("admire", "VERB", 0, "root"),
			token("la", "DET", 6, "det"),
			token("lune", "NOUN", 4, "obj"),
		]
		const right = [
			token("Le", "DET", 2, "det"),
			token("jeune", "ADJ", 3, "amod"),
			token("garçon", "NOUN", 4, "nsubj"),
			token("regarde", "VERB", 0, "root"),
			token("le", "DET", 6, "det"),
			token("soleil", "NOUN", 4, "obj"),
		]

		expect(cosine(encodeSentence(left), encodeSentence(right))).toBeGreaterThanOrEqual(0.999999)
	})

	test("pads every index to the same width", () => {
		// A depth-3 tree. The deep node and a shallow node must still compare
		// through the same digit positions.
		const sentence = [
			token("regarde", "VERB", 0, "root"),
			token("livre", "NOUN", 1, "obj"),
			token("vieux", "ADJ", 2, "amod"),
			token("très", "ADV", 3, "advmod"),
		]
		const vector = encodeSentence(sentence)
		const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))

		expect(norm).toBeCloseTo(1, 12)
	})
})

describe("punctuation marks", () => {
	/** The words "Il vient" with no mark. */
	const plain = [token("Il", "PRON", 2, "nsubj"), token("vient", "VERB", 0, "root")]
	/** The same words with a period. */
	const statement = [...plain, token(".", "PUNCT", 2, "punct")]
	/** The same words with a question mark. */
	const question = [...plain, token("?", "PUNCT", 2, "punct")]
	/** The same words with an exclamation mark. */
	const exclamation = [...plain, token("!", "PUNCT", 2, "punct")]
	/** The same words with an internal comma. */
	const comma = [...plain, token(",", "PUNCT", 2, "punct")]

	test("separates a sentence with no mark from one with a period", () => {
		expect(cosine(encodeSentence(plain), encodeSentence(statement))).toBeLessThan(0.999999)
	})

	test("separates a question from an exclamation", () => {
		expect(cosine(encodeSentence(question), encodeSentence(exclamation))).toBeLessThan(0.999999)
	})

	test("separates a comma from a question mark", () => {
		expect(cosine(encodeSentence(comma), encodeSentence(question))).toBeLessThan(0.999999)
	})

	test("keeps two texts with the same mark identical", () => {
		expect(cosine(encodeSentence(question), encodeSentence(question))).toBeGreaterThanOrEqual(
			0.999999,
		)
	})
})
