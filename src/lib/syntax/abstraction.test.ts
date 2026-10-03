import { describe, expect, test } from "bun:test"
import {
	AbstractionError,
	abstractSentence,
	abstractTree,
	COARSE_UPOS_EQUIVALENCE,
	canonicalFeatures,
	canonicalUpos,
	DETAILED_FEATURE_ALLOWLIST,
} from "./abstraction"
import type { ParsedSentence, ParsedText } from "./parser"

/** Build a token helper for the tests. */
const token = (
	form: string,
	lemma: string,
	upos: string,
	head: number,
	deprel: string,
	feats = "",
): ParsedSentence[number] => [form, lemma, upos, head, deprel, feats]

/** One simple sentence: the boy looks at the sun. */
const SIMPLE: ParsedSentence = [
	token("Le", "le", "DET", 2, "det", "Definite=Def|Gender=Masc|Number=Sing|PronType=Art"),
	token("garçon", "garçon", "NOUN", 3, "nsubj", "Gender=Masc|Number=Sing"),
	token("regarde", "regarder", "VERB", 0, "root", "Mood=Ind|Tense=Pres"),
	token("le", "le", "DET", 5, "det", "Definite=Def|Gender=Masc"),
	token("soleil", "soleil", "NOUN", 3, "obj", "Gender=Masc|Number=Sing"),
]

describe("canonicalUpos", () => {
	test("maps a proper noun onto a common noun for the coarse mode", () => {
		// A named month and a common noun share one nominal class.
		expect(canonicalUpos("PROPN", "coarse")).toBe("NOUN")
		expect(canonicalUpos("NOUN", "coarse")).toBe("NOUN")
	})

	test("keeps every other class unchanged for the coarse mode", () => {
		expect(canonicalUpos("VERB", "coarse")).toBe("VERB")
		expect(canonicalUpos("ADV", "coarse")).toBe("ADV")
	})

	test("keeps the raw class for the detailed mode", () => {
		expect(canonicalUpos("PROPN", "detailed")).toBe("PROPN")
	})

	test("declares only the noun equivalence", () => {
		expect(COARSE_UPOS_EQUIVALENCE).toEqual({ PROPN: "NOUN" })
	})
})

describe("canonicalFeatures", () => {
	test("removes every feature for the coarse mode", () => {
		expect(canonicalFeatures("Definite=Def|Gender=Masc", "coarse")).toBe("")
	})

	test("keeps only the allowlist for the detailed mode", () => {
		// PronType is not in the allowlist, so the detailed mode drops it.
		expect(canonicalFeatures("Definite=Def|Gender=Masc|PronType=Art", "detailed")).toBe(
			"Definite=Def|Gender=Masc",
		)
	})

	test("sorts the kept entries into a canonical order", () => {
		expect(canonicalFeatures("Number=Sing|Definite=Def|Gender=Masc", "detailed")).toBe(
			"Definite=Def|Gender=Masc|Number=Sing",
		)
	})

	test("returns an empty string when no allowlisted feature is present", () => {
		expect(canonicalFeatures("PronType=Art", "detailed")).toBe("")
		expect(canonicalFeatures("", "detailed")).toBe("")
	})

	test("declares the allowlist from the specification", () => {
		expect([...DETAILED_FEATURE_ALLOWLIST]).toEqual([
			"Definite",
			"Gender",
			"Mood",
			"Number",
			"Person",
			"Tense",
			"VerbForm",
			"Voice",
		])
	})
})

describe("abstractSentence", () => {
	test("keeps the structure and drops the vocabulary and the features", () => {
		const abstract = abstractSentence(SIMPLE, "coarse")

		expect(abstract.nodes).toEqual([
			{ upos: "DET", deprel: "det", head: 2, feats: "" },
			{ upos: "NOUN", deprel: "nsubj", head: 3, feats: "" },
			{ upos: "VERB", deprel: "root", head: 0, feats: "" },
			{ upos: "DET", deprel: "det", head: 5, feats: "" },
			{ upos: "NOUN", deprel: "obj", head: 3, feats: "" },
		])
		expect(abstract.root).toBe(3)
	})

	test("keeps the full label for the detailed mode", () => {
		const sentence: ParsedSentence = [
			token("La", "le", "DET", 2, "det", "Definite=Def"),
			token("lettre", "lettre", "NOUN", 4, "nsubj:pass", "Gender=Fem"),
			token("a", "avoir", "AUX", 4, "aux:pass", "Tense=Pres"),
			token("été", "être", "AUX", 4, "aux:pass", "Tense=Past"),
			token("lue", "lire", "VERB", 0, "root", "VerbForm=Part"),
		]
		const abstract = abstractSentence(sentence, "detailed")

		expect(abstract.nodes[1]?.deprel).toBe("nsubj:pass")
		expect(abstract.nodes[1]?.feats).toBe("Gender=Fem")
	})

	test("uses the base label for the coarse mode", () => {
		const sentence: ParsedSentence = [
			token("La", "le", "DET", 2, "det"),
			token("lettre", "lettre", "NOUN", 3, "nsubj:pass"),
			token("lue", "lire", "VERB", 0, "root"),
		]
		const abstract = abstractSentence(sentence, "coarse")

		expect(abstract.nodes[1]?.deprel).toBe("nsubj")
	})

	test("keeps punctuation nodes in position with their mark", () => {
		const sentence: ParsedSentence = [
			token("Le", "le", "DET", 2, "det"),
			token("chat", "chat", "NOUN", 3, "nsubj"),
			token("dort", "dormir", "VERB", 0, "root"),
			token(".", ".", "PUNCT", 3, "punct"),
		]
		const abstract = abstractSentence(sentence, "coarse")

		expect(abstract.nodes.map((node) => node.upos)).toEqual(["DET", "NOUN", "VERB", "PUNCT"])
		expect(abstract.nodes[3]?.punctuationMark).toBe(".")
		expect(abstract.nodes[0]?.punctuationMark).toBeUndefined()
		expect(abstract.root).toBe(3)
	})

	test("keeps a question mark as the punctuation mark", () => {
		const sentence: ParsedSentence = [
			token("Il", "il", "PRON", 2, "nsubj"),
			token("vient", "venir", "VERB", 0, "root"),
			token("?", "?", "PUNCT", 2, "punct"),
		]
		const abstract = abstractSentence(sentence, "coarse")

		expect(abstract.nodes[2]?.punctuationMark).toBe("?")
	})

	test("raises when a sentence is empty", () => {
		expect(() => abstractSentence([], "coarse")).toThrow(AbstractionError)
	})

	test("raises when a sentence has no root", () => {
		const sentence: ParsedSentence = [
			token("Le", "le", "DET", 2, "det"),
			token("chat", "chat", "NOUN", 1, "nsubj"),
		]

		expect(() => abstractSentence(sentence, "coarse")).toThrow(AbstractionError)
	})
})

describe("abstractTree", () => {
	test("keeps the sentence boundaries", () => {
		const parsed: ParsedText = {
			sentences: [
				[token("Le", "le", "DET", 2, "det"), token("chat", "chat", "NOUN", 0, "root")],
				[token("Le", "le", "DET", 2, "det"), token("chien", "chien", "NOUN", 0, "root")],
			],
		}
		const tree = abstractTree(parsed, "coarse")

		expect(tree.mode).toBe("coarse")
		expect(tree.sentences).toHaveLength(2)
	})

	test("raises when the text has no sentence", () => {
		expect(() => abstractTree({ sentences: [] }, "coarse")).toThrow(AbstractionError)
	})
})
